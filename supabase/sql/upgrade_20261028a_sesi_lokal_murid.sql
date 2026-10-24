-- ============================================================
-- UPGRADE 20261028a: SESI LOKAL MURID (TOKEN DARI SERVER) — 2026-10-28
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG
--   Selama ini sesi murid "password lokal" memakai anon key + NIS sebagai
--   identitas palsu (`kr-<nis>`), dan handler `akses_tabel` di Edge Function
--   mempercayai klaim itu apa adanya. Akibatnya siapa pun yang tahu NIS bisa
--   membaca/menulis data murid lain lewat REST (`from('akun')`).
--   Fase B menutup celah ini: akses `akun` dipindah ke RPC SECURITY DEFINER,
--   dan setiap RPC murid wajib menyertakan TOKEN SESI yang diterbitkan server.
--
-- ISI FILE INI (fase B1 — RLS `akun` MASIH OFF, aman & bisa di-rollback)
--   1) Tabel `sesi_lokal` — daftar sesi murid. Yang disimpan hanya
--      SHA-256 dari token (token mentah tidak pernah masuk DB).
--      RLS ON tanpa policy + revoke → tabel ini TIDAK punya jalur REST.
--   2) `fn_sesi_valid(p_token)` — gate tunggal: kembalikan NIS pemilik token
--      yang masih berlaku, atau NULL. Token diperpanjang otomatis (sliding
--      12 jam) saat dipakai.
--   3) `fn_sesi_buat(p_nis, p_peran)` — terbitkan token baru (internal).
--   4) `cek_login_murid(p_nis, p_password)` dibuat ulang — selain verifikasi
--      bcrypt seperti sebelumnya (kompatibel penuh: `status` + `akun` tetap),
--      kini juga mengembalikan `sesi_token` & `sesi_expires_at`.
--   5) `perpanjang_sesi(p_token)` & `logout_sesi(p_token)`.
--
-- PRASYARAT
--   `upgrade_20261027_role_hybrid_opsiC.sql` (helper fn_role/fn_nis/…) dan
--   `fix_20260903_kredensial.sql` (tabel akun_kredensial) sudah dijalankan.
--   Blok pre-flight di bawah akan MENOLAK eksekusi bila belum.
--
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

create extension if not exists pgcrypto;

-- ========== 0. PRE-FLIGHT (gagal cepat bila prasyarat kurang) ==========
do $$
declare
  v_rls boolean;
begin
  if to_regprocedure('public.fn_role()') is null then
    raise exception 'PRASYARAT GAGAL: fungsi fn_role() belum ada. Jalankan supabase/sql/upgrade_20261027_role_hybrid_opsiC.sql lebih dahulu.';
  end if;
  if to_regprocedure('public.fn_nis()') is null then
    raise exception 'PRASYARAT GAGAL: fungsi fn_nis() belum ada. Jalankan supabase/sql/upgrade_20261027_role_hybrid_opsiC.sql lebih dahulu.';
  end if;
  if to_regclass('public.akun_kredensial') is null then
    raise exception 'PRASYARAT GAGAL: tabel akun_kredensial belum ada. Jalankan supabase/sql/fix_20260903_kredensial.sql lebih dahulu.';
  end if;
  if to_regprocedure('public.crypt(text, text)') is null
     and to_regprocedure('extensions.crypt(text, text)') is null then
    raise exception 'PRASYARAT GAGAL: ekstensi pgcrypto tidak tersedia (crypt/digest).';
  end if;

  select relrowsecurity into v_rls from pg_class where oid = 'public.akun'::regclass;
  raise notice 'INFO: RLS pada public.akun saat ini = % (fase B1/B2 memang masih false; file 20261028c yang mengaktifkan).', v_rls;
end $$;

-- ============================================================
-- 1. TABEL SESI LOKAL
--    Yang disimpan hanya SHA-256 token (kolom `token_hash`), jadi bocornya
--    isi tabel tidak langsung memberi token yang bisa dipakai.
--    RLS ON + TANPA policy + revoke → tidak ada jalur REST sama sekali.
-- ============================================================
create table if not exists sesi_lokal (
  token_hash text primary key,
  nis_nip    text not null,
  peran      text not null default 'murid',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen  timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists sesi_lokal_nis_idx on sesi_lokal (nis_nip);
create index if not exists sesi_lokal_expires_idx on sesi_lokal (expires_at);

alter table sesi_lokal enable row level security;
-- Sengaja TANPA policy: hanya SECURITY DEFINER (fungsi di bawah) yang bisa akses.
revoke all on table sesi_lokal from anon, authenticated;

-- ========== 2. UTIL ==========

-- 2a. SHA-256 hex dari token (dipakai sebagai PK / pencarian).
create or replace function fn_sesi_hash(p_token text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

-- 2b. Format timestamptz → ISO-8601 UTC (agar klien JS mudah parse).
create or replace function fn_iso_utc(p_ts timestamptz)
returns text
language sql
immutable
as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;

-- ========== 3. GATE SESI (JANTUNG FASE B) ==========

-- 3a. Token → NIS pemilik bila sesi masih berlaku; NULL bila tidak.
--     Sliding expiry: token yang dipakai (jeda > 5 menit) diperpanjang 12 jam.
create or replace function fn_sesi_valid(p_token text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_nis  text;
begin
  if coalesce(trim(p_token), '') = '' then return null; end if;
  v_hash := fn_sesi_hash(p_token);

  select s.nis_nip into v_nis
  from sesi_lokal s
  where s.token_hash = v_hash
    and s.revoked_at is null
    and s.expires_at > now()
  limit 1;

  if v_nis is null then return null; end if;

  -- Perpanjang hanya bila sudah lewat 5 menit sejak pemakaian terakhir (hemat tulis).
  update sesi_lokal
     set last_seen  = now(),
         expires_at = now() + interval '12 hours'
   where token_hash = v_hash
     and last_seen < now() - interval '5 minutes';

  return v_nis;
end $$;

-- 3b. Buat sesi baru (internal — dipakai cek_login_murid & ubah_password_sendiri).
create or replace function fn_sesi_buat(
  p_nis    text,
  p_peran  text default 'murid',
  p_jam    integer default 12
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  v_exp   timestamptz;
begin
  v_token := encode(gen_random_bytes(32), 'hex');
  v_exp   := now() + make_interval(hours => greatest(coalesce(p_jam, 12), 1));

  -- Housekeeping: buang sesi kedaluwarsa/dicabut yang sudah lewat 1 hari.
  delete from sesi_lokal
   where (expires_at < now() - interval '1 day')
      or (revoked_at is not null and revoked_at < now() - interval '1 day');

  insert into sesi_lokal (token_hash, nis_nip, peran, expires_at)
  values (fn_sesi_hash(v_token), trim(p_nis), coalesce(nullif(trim(p_peran), ''), 'murid'), v_exp);

  return json_build_object(
    'token', v_token,
    'nis_nip', trim(p_nis),
    'peran', coalesce(nullif(trim(p_peran), ''), 'murid'),
    'expires_at', fn_iso_utc(v_exp)
  );
end $$;

-- 3c. Cabut SEMUA sesi milik satu NIS (dipakai saat password diganti).
create or replace function fn_sesi_cabut_nis(p_nis text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  update sesi_lokal set revoked_at = now()
   where nis_nip = trim(p_nis) and revoked_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- 3d. Gate akses data milik murid. Mengembalikan NIS yang BOLEH diakses.
--     FASE B1/B2 (kompatibilitas): bila token kosong/tidak valid, klaim
--     `p_nis_fallback` masih diterima selama NIS terdaftar sebagai murid.
--     FASE B2′ (fix_20261028d_sesi_wajib.sql) MENGGANTI fungsi ini sehingga
--     klaim tanpa token ditolak — satu titik ubah untuk mengunci semuanya.
create or replace function fn_akses_murid(p_token text, p_nis_fallback text default '')
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis   text;
  v_klaim text;
begin
  v_nis := fn_sesi_valid(p_token);
  if v_nis is not null then return v_nis; end if;

  v_klaim := trim(coalesce(p_nis_fallback, ''));
  if v_klaim <> '' and exists (
    select 1 from akun where nis_nip = v_klaim and tipe = 'murid'
  ) then
    return v_klaim;
  end if;

  return null;
end $$;

-- 3e. Versi massal (mis. ambil descriptor wajah banyak NIS).
--     p_nis_list kosong = semua murid (dipakai mode scan massal).
create or replace function fn_akses_murid_list(
  p_token text,
  p_nis_list text[] default '{}',
  p_nis_fallback text default ''
)
returns text[]
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis text;
begin
  v_nis := fn_akses_murid(p_token, p_nis_fallback);
  if v_nis is null then return '{}'::text[]; end if;

  if p_nis_list is null or array_length(p_nis_list, 1) is null then
    return array(select nis_nip from akun where tipe = 'murid' and coalesce(nis_nip, '') <> '');
  end if;

  return array(select a.nis_nip from akun a where a.tipe = 'murid' and a.nis_nip = any(p_nis_list));
end $$;

-- 3f. Tingkat akses modul ekstrakurikuler: 'tulis' | 'baca' | NULL.
--     - admin/guru (JWT)                   → 'tulis'
--     - murid ber-token & pemegang jabatan → 'tulis'
--     - murid ber-token (anggota biasa)    → 'baca'
--     - tanpa sesi valid                   → NULL
create or replace function fn_akses_ekskul(p_token text, p_nis_fallback text, p_ekskul text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis   text;
  v_baris akun%rowtype;
begin
  if fn_role() in ('admin', 'guru') then return 'tulis'; end if;

  v_nis := fn_akses_murid(p_token, p_nis_fallback);
  if v_nis is null then return null; end if;
  if coalesce(p_ekskul, '') = '' then return 'baca'; end if;

  select * into v_baris from akun where nis_nip = v_nis and tipe = 'murid' limit 1;
  if v_baris.id is null then return 'baca'; end if;

  if coalesce(v_baris.jabatan_ekskul_map ->> p_ekskul, '') <> ''
     or position(lower(p_ekskul) in lower(coalesce(v_baris.jabatan_ekskul, ''))) > 0 then
    return 'tulis';
  end if;

  return 'baca';
end $$;

-- ============================================================
-- 4. LOGIN MURID + MANAJEMEN SESI (titik masuk anon)
-- ============================================================

-- 4a. Verifikasi login murid (NIS + password) — SELARAS dengan versi
--     upgrade_20260926 (kolom `akun` & pesan error sama persis), hanya
--     ditambah penerbitan TOKEN SESI di dalam respons.
create or replace function cek_login_murid(p_nis text, p_password text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r akun%rowtype;
  v_hash text;
  v_sesi json;
begin
  select * into r from akun where nis_nip = p_nis and tipe = 'murid' limit 1;
  if r.id is null then
    return json_build_object('status', 'error', 'message', 'NIS tidak terdaftar.');
  end if;
  select password_hash into v_hash from akun_kredensial where nis_nip = p_nis;
  if v_hash is null or v_hash = '' then
    return json_build_object('status', 'error', 'message', 'Akun ini belum memiliki password lokal.');
  end if;
  if crypt(p_password, v_hash) = v_hash then
    v_sesi := fn_sesi_buat(r.nis_nip, 'murid', 12);
    return json_build_object(
      'status', 'success',
      'akun', json_build_object(
        'id', r.id,
        'user_id', r.user_id,
        'nama_lengkap', r.nama_lengkap,
        'nis_nip', r.nis_nip,
        'tipe', r.tipe,
        'email', r.email,
        'tingkat_kelas', r.tingkat_kelas,
        'jabatan', r.jabatan,
        'ekstrakurikuler', coalesce(r.ekstrakurikuler, ''),
        'jabatan_ekskul', coalesce(r.jabatan_ekskul, ''),
        'jabatan_ekskul_map', coalesce(r.jabatan_ekskul_map, '{}'::jsonb)
      ),
      'sesi_token', v_sesi ->> 'token',
      'sesi_peran', v_sesi ->> 'peran',
      'sesi_expires_at', v_sesi ->> 'expires_at'
    );
  end if;
  return json_build_object('status', 'error', 'message', 'Password salah.');
end $$;

-- 4b. Perpanjang sesi (sliding) — dipanggil klien saat aplikasi dibuka kembali.
create or replace function perpanjang_sesi(p_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis text;
  v_exp timestamptz;
begin
  v_nis := fn_sesi_valid(p_token);       -- sekaligus memperpanjang bila perlu
  if v_nis is null then
    return json_build_object('status', 'error', 'message', 'Sesi tidak valid atau sudah kedaluwarsa.');
  end if;
  select expires_at into v_exp from sesi_lokal where token_hash = fn_sesi_hash(p_token);
  return json_build_object(
    'status', 'success',
    'nis_nip', v_nis,
    'sesi_expires_at', fn_iso_utc(v_exp)
  );
end $$;

-- 4c. Logout (idempotent — token tak dikenal tetap dijawab sukses).
create or replace function logout_sesi(p_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if coalesce(trim(p_token), '') <> '' then
    update sesi_lokal set revoked_at = now()
     where token_hash = fn_sesi_hash(p_token) and revoked_at is null;
  end if;
  return json_build_object('status', 'success');
end $$;

-- ============================================================
-- 5. IZIN EKSEKUSI
--    Internal (fn_sesi_buat / fn_sesi_cabut_nis) sengaja TIDAK diberi izin
--    ke anon/authenticated — hanya dipanggil dari SECURITY DEFINER lain.
-- ============================================================
grant execute on function cek_login_murid(text, text) to anon, authenticated;
grant execute on function perpanjang_sesi(text) to anon, authenticated;
grant execute on function logout_sesi(text) to anon, authenticated;
grant execute on function fn_sesi_valid(text) to anon, authenticated;
grant execute on function fn_akses_murid(text, text) to anon, authenticated;
grant execute on function fn_akses_murid_list(text, text[], text) to anon, authenticated;
grant execute on function fn_akses_ekskul(text, text, text) to anon, authenticated;

revoke all on function fn_sesi_buat(text, text, integer) from public;
revoke all on function fn_sesi_cabut_nis(text) from public;

-- ============================================================
-- 6. VERIFIKASI & RELOAD CACHE SKEMA POSTGREST
-- ============================================================
do $$
declare v_n integer;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fn_sesi_valid','fn_akses_murid','fn_akses_murid_list','fn_akses_ekskul',
                       'cek_login_murid','perpanjang_sesi','logout_sesi');
  raise notice 'INFO: %/7 fungsi sesi lokal terpasang (harus 7).', v_n;
end $$;

notify pgrst, 'reload schema';
