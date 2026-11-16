-- ============================================================
-- UPGRADE: WALI KELAS MULTI (TAHAP 4A) — 2026-11-16
-- Tabel relasi wali_kelas_penugasan + sinkron otomatis dari data lama
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG
--   Satu guru bisa menjadi wali kelas LEBIH DARI SATU kelas, dan untuk
--   beberapa tahun pelajaran sekaligus. Model lama tidak bisa menyimpan itu:
--     * akun.wali_kelas            → SATU teks gabungan (mis. "X LP 1")
--     * akun.penugasan[TA].wali    → SATU string kelas (bukan daftar)
--   Frontend Tahap 4A mulai menulis penugasan[TA].wali sebagai ARRAY
--   (mis. ["X LP 1","X LP 2"]), tetapi SQL juga butuh sumber kebenaran
--   RELASIONAL agar kuasa akses (wali kelas / pembina), dokumen, dan
--   kueri lintas tabel tetap benar tanpa mengurai string.
--
-- ISI (semua idempotent — aman dijalankan berulang):
--   1) Helper  : fn_kelas_sama, fn_wali_list, fn_ta_berjalan
--   2) Tabel   : wali_kelas_penugasan (nis_nip, tahun_pelajaran, tingkat,
--                jurusan_kode, rombel, kelas_label GENERATED) + RLS + grant
--   3) Helper  : fn_wali_kelas_list, fn_wali_kelas_map, fn_kelas_murid,
--                fn_guru_wali_ada
--   4) Backfill dari penugasan[TA].wali dan akun.wali_kelas
--   5) Trigger : trg_sync_wali_penugasan (AFTER INSERT/UPDATE ON akun) →
--                tabel selalu sinkron, termasuk untuk jalur tulis LAMA
--                (Edge Function buat-akun, RPC, import massal, edit manual)
--   6) Fungsi  : fn_is_wali_kelas, akun_guru_ampu_murid, ubah_anggota_ekskul,
--                fn_akun_json (+ field wali_kelas_list & wali_kelas_map)
--   7) Verifikasi + reload cache skema PostgREST
--
-- KOMPATIBILITAS (penting)
--   Kolom LAMA (akun.wali_kelas, penugasan[TA].wali string) TIDAK dihapus dan
--   TETAP ditulis klien/Edge Function lama. Trigger bagian 5 menjaga tabel
--   baru selalu lengkap, jadi frontend boleh di-deploy terpisah (migrasi ini
--   aman dijalankan SEBELUM frontend baru dipasang).
--
-- ROLLBACK
--   drop trigger if exists trg_sync_wali_penugasan on akun;
--   drop function if exists fn_sync_wali_penugasan();
--   drop table if exists wali_kelas_penugasan;
--   drop function if exists fn_guru_wali_ada(text, text);
--   drop function if exists fn_kelas_murid(text);
--   drop function if exists fn_wali_kelas_map(text);
--   drop function if exists fn_wali_kelas_list(text, text);
--   drop function if exists fn_ta_berjalan();
--   drop function if exists fn_wali_list(jsonb);
--   drop function if exists fn_kelas_sama(text, text);
--   (fn_is_wali_kelas / akun_guru_ampu_murid / ubah_anggota_ekskul /
--    fn_akun_json kembali ke versi sebelumnya dengan menjalankan ulang berkas
--    20261027_role_hybrid_opsiC, 20261023_wajah_motor_mediapipe,
--    20261028b2_token_rpc_murid, dan 20261115_kelas_normalisasi.)
-- ============================================================

-- ============================================================
-- 1. HELPER DASAR
-- ============================================================
-- 1a. Dua kelas setara? ("10 RPL 1" ≡ "X RPL 1" ≡ "x rpl 1")
--     Dibandingkan sebagai komponen kanonik (fn_pecah_kelas); teks yang
--     jelas BUKAN kelas ("Semua Kelas", "Hadir", …) dibanding apa adanya.
create or replace function fn_kelas_sama(p_a text, p_b text)
returns boolean
language sql
immutable
as $$
  select case
    when coalesce(btrim(coalesce(p_a, '')), '') = '' then false
    when coalesce(btrim(coalesce(p_b, '')), '') = '' then false
    -- salah satu bukan kelas (tingkat/jurusan/rombel kosong) → banding teks
    when coalesce(ka.tingkat, '') = '' and coalesce(ka.jurusan_kode, '') = ''
         and ka.rombel is null then lower(btrim(p_a)) = lower(btrim(p_b))
    when coalesce(kb.tingkat, '') = '' and coalesce(kb.jurusan_kode, '') = ''
         and kb.rombel is null then lower(btrim(p_a)) = lower(btrim(p_b))
    else lower(fn_label_kelas(ka.tingkat, ka.jurusan_kode, ka.rombel))
       = lower(fn_label_kelas(kb.tingkat, kb.jurusan_kode, kb.rombel))
  end
  from fn_pecah_kelas(p_a) ka
  cross join fn_pecah_kelas(p_b) kb
$$;

comment on function fn_kelas_sama(text, text) is
  'Dua label kelas setara (kanonik: "10 RPL 1" = "X RPL 1"). Teks non-kelas dibanding apa adanya.';

-- 1b. Nilai penugasan[TA].wali apa pun (string LAMA, array BARU, null) → text[]
--     berisi label kelas yang bersih & unik (label kosong dibuang).
create or replace function fn_wali_list(p_wali jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce((
    select array_agg(distinct btrim(x))
      from unnest(case
             when jsonb_typeof(p_wali) = 'array'
               then coalesce((select array_agg(e)
                                from jsonb_array_elements_text(p_wali) as t(e)),
                             array[]::text[])
             when jsonb_typeof(p_wali) = 'string'
               then array[p_wali #>> '{}']
             else array[]::text[]
           end) as u(x)
     where coalesce(btrim(x), '') <> ''
  ), array[]::text[])
$$;

comment on function fn_wali_list(jsonb) is
  'Normalisasi nilai penugasan[TA].wali (string|array|null) → text[] label kelas bersih & unik.';

-- 1c. Tahun pelajaran berjalan (sumber: Master Data; cadangan: tahun kalender).
--     Sama dengan pola fallback RPC murid (20261028b2) & frontend app.js
--     (opsi "Pilih Tahun" terurut A-Z → pilihan pertama = TA terkecil).
create or replace function fn_ta_berjalan()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(btrim(coalesce((
      select min(m."Tahun Pelajaran")::text
        from master_data m
       where m."Tahun Pelajaran" is not null
         and btrim(coalesce(m."Tahun Pelajaran"::text, '')) <> ''
    ), '')), ''),
    to_char(now() at time zone 'Asia/Jakarta', 'YYYY') || '/' ||
    to_char((now() at time zone 'Asia/Jakarta') + interval '1 year', 'YYYY'))
$$;

comment on function fn_ta_berjalan() is
  'Tahun pelajaran berjalan (min Master Data, cadangan tahun kalender Asia/Jakarta).';

-- ============================================================
-- 2. TABEL RELASI wali_kelas_penugasan
--    Sumber kanonik "guru → kelas yang diwalikan (per tahun pelajaran)".
--    Satu baris = satu (nis_nip guru) × (tahun pelajaran) × (kelas).
-- ============================================================
create table if not exists wali_kelas_penugasan (
  id uuid primary key default gen_random_uuid(),
  nis_nip text not null default '',
  tahun_pelajaran text not null default '',
  tingkat text,
  jurusan_kode text,
  rombel integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- self-healing kolom (bila tabel sudah ada dari versi/percobaan sebelumnya)
alter table wali_kelas_penugasan
  add column if not exists nis_nip text not null default '',
  add column if not exists tahun_pelajaran text not null default '',
  add column if not exists tingkat text,
  add column if not exists jurusan_kode text,
  add column if not exists rombel integer,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- label kanonik (mis. "X LP 1") — turunan, tidak pernah diisi manual
alter table wali_kelas_penugasan
  add column if not exists kelas_label text
  generated always as (fn_label_kelas(tingkat, jurusan_kode, rombel)) stored;

create unique index if not exists wali_penugasan_uniq
  on wali_kelas_penugasan (btrim(nis_nip), upper(btrim(tahun_pelajaran)), kelas_label);
create index if not exists idx_wali_penugasan_nis
  on wali_kelas_penugasan (btrim(nis_nip), tahun_pelajaran);
create index if not exists idx_wali_penugasan_kelas
  on wali_kelas_penugasan (kelas_label);
create index if not exists idx_wali_penugasan_ta
  on wali_kelas_penugasan (tahun_pelajaran, tingkat, jurusan_kode, rombel);

comment on table wali_kelas_penugasan is
  'Relasi wali kelas (Tahap 4A): satu baris = satu (guru, tahun pelajaran, kelas). Sumber kebenaran wali kelas multi-kelas; disinkronkan trigger dari akun.penugasan[TA].wali & akun.wali_kelas.';
comment on column wali_kelas_penugasan.nis_nip is
  'NIS/NIP guru (akun.nis_nip, tipe guru/admin).';
comment on column wali_kelas_penugasan.jurusan_kode is
  'Kode jurusan (UPPER, mis. LP) — dipakai merakit kelas_label.';
comment on column wali_kelas_penugasan.kelas_label is
  'Label kelas kanonik turunan tingkat/jurusan_kode/rombel (mis. "X LP 1").';

-- RLS & privilege (pola sama dengan master_jurusan)
alter table wali_kelas_penugasan enable row level security;

drop policy if exists "wali_penugasan_baca_semua" on wali_kelas_penugasan;
create policy "wali_penugasan_baca_semua" on wali_kelas_penugasan
  for select using (true);

drop policy if exists "wali_penugasan_tulis_authenticated" on wali_kelas_penugasan;
create policy "wali_penugasan_tulis_authenticated" on wali_kelas_penugasan
  for all to authenticated using (true) with check (true);

revoke all on table wali_kelas_penugasan from anon, authenticated;
grant select on wali_kelas_penugasan to anon, authenticated;
grant insert, update, delete on wali_kelas_penugasan to authenticated;

-- ============================================================
-- 3. HELPER BACA (dipakai fungsi & RPC di bawah)
-- ============================================================
-- 3a. Daftar kelas wali seorang guru (label kanonik, urut A-Z).
--     Sumber: tabel wali_kelas_penugasan. Kolom lama akun.wali_kelas dipakai
--     sebagai cadangan HANYA bila tanpa filter TA (p_ta kosong), karena kolom
--     itu tidak menyimpan tahun pelajaran.
--     p_ta kosong ('') → semua tahun pelajaran.
create or replace function fn_wali_kelas_list(p_nis text, p_ta text default '')
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select array_agg(distinct c order by c)
      from (
        select w.kelas_label as c
          from wali_kelas_penugasan w
         where btrim(coalesce(w.nis_nip, '')) = btrim(coalesce(p_nis, ''))
           and (btrim(coalesce(p_ta, '')) = '' or btrim(w.tahun_pelajaran) = btrim(p_ta))
        union
        select btrim(x) as c
          from akun a
          cross join unnest(string_to_array(coalesce(a.wali_kelas, ''), ',')) as t(x)
         where btrim(coalesce(a.nis_nip, '')) = btrim(coalesce(p_nis, ''))
           and btrim(coalesce(p_ta, '')) = ''
      ) s
     where coalesce(btrim(c), '') <> ''
  ), array[]::text[])
$$;

comment on function fn_wali_kelas_list(text, text) is
  'Daftar kelas wali guru (label kanonik). p_ta kosong = semua tahun pelajaran.';

-- 3b. Peta kelas wali per tahun pelajaran: {"2026/2027": ["X LP 1","X LP 2"]}
--     (dipakai frontend untuk memilih daftar kelas pada TA yang sedang aktif)
create or replace function fn_wali_kelas_map(p_nis text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(ta, kelas), '{}'::jsonb)
    from (
      select btrim(w.tahun_pelajaran) as ta,
             coalesce(jsonb_agg(distinct w.kelas_label order by w.kelas_label),
                      '[]'::jsonb) as kelas
        from wali_kelas_penugasan w
       where btrim(coalesce(w.nis_nip, '')) = btrim(coalesce(p_nis, ''))
         and coalesce(btrim(w.kelas_label), '') <> ''
       group by btrim(w.tahun_pelajaran)
    ) s
   where coalesce(btrim(ta), '') <> ''
$$;

comment on function fn_wali_kelas_map(text) is
  'Peta {tahun pelajaran → daftar kelas wali} seorang guru (label kanonik).';

-- 3c. Daftar kelas EFEKTIF murid: riwayat_kelas[TA].kelas (kelas per tahun
--     pelajaran) ∪ tingkat_kelas (kelas statis / TA aktif).
create or replace function fn_kelas_murid(p_nis text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select array_agg(distinct btrim(c) order by btrim(c))
      from akun m
      cross join lateral (
        select (e.value->>'kelas') as c
          from jsonb_each(
                 case when jsonb_typeof(coalesce(m.riwayat_kelas, '{}'::jsonb)) = 'object'
                      then m.riwayat_kelas else '{}'::jsonb end
               ) as e(ta, value)
        union all
        select m.tingkat_kelas
      ) x
     where btrim(coalesce(m.nis_nip, '')) = btrim(coalesce(p_nis, ''))
       and m.tipe = 'murid'
       and coalesce(btrim(c), '') <> ''
  ), array[]::text[])
$$;

comment on function fn_kelas_murid(text) is
  'Daftar kelas efektif murid (riwayat_kelas[*].kelas ∪ tingkat_kelas).';

-- 3d. Guru ini wali kelas mana pun? (gerbang akses ekskul & RLS)
--     p_ta kosong → semua tahun pelajaran. Bila p_ta diisi, kolom lama
--     akun.wali_kelas diabaikan (tidak menyimpan tahun pelajaran).
create or replace function fn_guru_wali_ada(p_nis text, p_ta text default '')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1
             from wali_kelas_penugasan w
            where btrim(coalesce(w.nis_nip, '')) = btrim(coalesce(p_nis, ''))
              and (btrim(coalesce(p_ta, '')) = '' or btrim(w.tahun_pelajaran) = btrim(p_ta))
         )
      or exists (
           -- cadangan data lama (Tahap 4B belum dijalankan)
           select 1
             from akun a
            where btrim(coalesce(a.nis_nip, '')) = btrim(coalesce(p_nis, ''))
              and (
                (btrim(coalesce(p_ta, '')) = ''
                 and coalesce(btrim(coalesce(a.wali_kelas, '')), '') <> '')
                or exists (
                     select 1
                       from jsonb_each(
                              case when jsonb_typeof(coalesce(a.penugasan, '{}'::jsonb)) = 'object'
                                   then a.penugasan else '{}'::jsonb end
                            ) as p(ta, v)
                      where coalesce(btrim(p.v->>'wali'), '') <> ''
                        and (btrim(coalesce(p_ta, '')) = '' or btrim(p.ta) = btrim(p_ta))
                   )
              )
         )
$$;

comment on function fn_guru_wali_ada(text, text) is
  'True bila guru terdaftar sebagai wali kelas (tabel relasi / data lama). p_ta kosong = semua TA.';

grant execute on function fn_kelas_sama(text, text) to anon, authenticated;
grant execute on function fn_wali_list(jsonb) to anon, authenticated;
grant execute on function fn_ta_berjalan() to anon, authenticated;
grant execute on function fn_wali_kelas_list(text, text) to anon, authenticated;
grant execute on function fn_wali_kelas_map(text) to anon, authenticated;
grant execute on function fn_kelas_murid(text) to anon, authenticated;
grant execute on function fn_guru_wali_ada(text, text) to anon, authenticated;

-- ============================================================
-- 4. BACKFILL dari data lama (idempotent: ON CONFLICT DO NOTHING)
-- ============================================================
-- 4a. Dari penugasan[TA].wali — string LAMA maupun array BARU.
insert into wali_kelas_penugasan (nis_nip, tahun_pelajaran, tingkat, jurusan_kode, rombel)
select distinct x.nis, x.ta, x.tingkat, x.jurusan_kode, x.rombel
  from (
    select btrim(a.nis_nip) as nis,
           btrim(p.ta) as ta,
           (fn_pecah_kelas(v.kelas)).tingkat      as tingkat,
           (fn_pecah_kelas(v.kelas)).jurusan_kode as jurusan_kode,
           (fn_pecah_kelas(v.kelas)).rombel       as rombel
      from akun a
      cross join jsonb_each(
             case when jsonb_typeof(coalesce(a.penugasan, '{}'::jsonb)) = 'object'
                  then a.penugasan else '{}'::jsonb end
           ) as p(ta, v)
      cross join unnest(fn_wali_list(p.v->'wali')) as v(kelas)
     where btrim(coalesce(a.nis_nip, '')) <> ''
       and coalesce(a.tipe, '') in ('guru', 'admin')
       and btrim(coalesce(p.ta, '')) <> ''
  ) x
 where coalesce(btrim(x.tingkat), '') <> ''
on conflict do nothing;

-- 4b. Dari kolom lama akun.wali_kelas — hanya untuk kelas yang belum
--     terwakili sama sekali pada guru tsb (agar tidak mengarang TA baru).
insert into wali_kelas_penugasan (nis_nip, tahun_pelajaran, tingkat, jurusan_kode, rombel)
select distinct x.nis, fn_ta_berjalan(), x.tingkat, x.jurusan_kode, x.rombel
  from (
    select btrim(a.nis_nip) as nis,
           fn_label_kelas((fn_pecah_kelas(btrim(v.kelas))).tingkat,
                          (fn_pecah_kelas(btrim(v.kelas))).jurusan_kode,
                          (fn_pecah_kelas(btrim(v.kelas))).rombel) as label,
           (fn_pecah_kelas(btrim(v.kelas))).tingkat      as tingkat,
           (fn_pecah_kelas(btrim(v.kelas))).jurusan_kode as jurusan_kode,
           (fn_pecah_kelas(btrim(v.kelas))).rombel       as rombel
      from akun a
      cross join unnest(string_to_array(coalesce(a.wali_kelas, ''), ',')) as v(kelas)
     where btrim(coalesce(a.nis_nip, '')) <> ''
       and coalesce(a.tipe, '') in ('guru', 'admin')
  ) x
 where coalesce(btrim(x.tingkat), '') <> ''
   and not exists (
         select 1
           from wali_kelas_penugasan w2
          where btrim(coalesce(w2.nis_nip, '')) = x.nis
            and w2.kelas_label = x.label
       )
on conflict do nothing;

-- ============================================================
-- 5. TRIGGER SINKRON: akun → wali_kelas_penugasan
--    Menangkap SELURUH jalur tulis lama (Edge Function buat-akun, RPC
--    simpan_penugasan_guru, import massal, edit manual) tanpa perlu
--    mengubah klien/EF. Relasi selalu dibangun ulang dari kolom akun
--    (state final), jadi urutan operasi apa pun tetap konsisten.
-- ============================================================
create or replace function fn_sync_wali_penugasan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ta text;
begin
  if coalesce(btrim(new.nis_nip), '') = '' then
    return new;
  end if;

  -- hanya guru/admin yang punya relasi wali; akun murid → bersihkan sisa baris
  if coalesce(new.tipe, '') not in ('guru', 'admin') then
    delete from wali_kelas_penugasan
     where btrim(coalesce(nis_nip, '')) = btrim(new.nis_nip);
    return new;
  end if;

  -- UPDATE yang tidak menyentuh data wali → tidak perlu apa-apa
  if tg_op = 'UPDATE'
     and coalesce(new.nis_nip, '') = coalesce(old.nis_nip, '')
     and coalesce(new.penugasan::text, '') = coalesce(old.penugasan::text, '')
     and coalesce(new.wali_kelas, '') = coalesce(old.wali_kelas, '') then
    return new;
  end if;

  -- Bangun ulang relasi guru ini (sumber: kolom akun → selalu state final).
  delete from wali_kelas_penugasan
   where btrim(coalesce(nis_nip, '')) = btrim(new.nis_nip);

  -- (a) penugasan[TA].wali → baris per (TA, kelas)
  insert into wali_kelas_penugasan (nis_nip, tahun_pelajaran, tingkat, jurusan_kode, rombel)
  select distinct x.nis, x.ta, x.tingkat, x.jurusan_kode, x.rombel
    from (
      select btrim(new.nis_nip) as nis,
             btrim(p.ta) as ta,
             (fn_pecah_kelas(v.kelas)).tingkat      as tingkat,
             (fn_pecah_kelas(v.kelas)).jurusan_kode as jurusan_kode,
             (fn_pecah_kelas(v.kelas)).rombel       as rombel
        from jsonb_each(
               case when jsonb_typeof(coalesce(new.penugasan, '{}'::jsonb)) = 'object'
                    then new.penugasan else '{}'::jsonb end
             ) as p(ta, v)
        cross join unnest(fn_wali_list(p.v->'wali')) as v(kelas)
       where btrim(coalesce(p.ta, '')) <> ''
    ) x
   where coalesce(btrim(x.tingkat), '') <> ''
  on conflict do nothing;

  -- (b) kolom lama wali_kelas → hanya kelas yang belum terwakili sama sekali
  v_ta := fn_ta_berjalan();
  insert into wali_kelas_penugasan (nis_nip, tahun_pelajaran, tingkat, jurusan_kode, rombel)
  select distinct x.nis, v_ta, x.tingkat, x.jurusan_kode, x.rombel
    from (
      select btrim(new.nis_nip) as nis,
             fn_label_kelas((fn_pecah_kelas(btrim(v.kelas))).tingkat,
                            (fn_pecah_kelas(btrim(v.kelas))).jurusan_kode,
                            (fn_pecah_kelas(btrim(v.kelas))).rombel) as label,
             (fn_pecah_kelas(btrim(v.kelas))).tingkat      as tingkat,
             (fn_pecah_kelas(btrim(v.kelas))).jurusan_kode as jurusan_kode,
             (fn_pecah_kelas(btrim(v.kelas))).rombel       as rombel
        from unnest(string_to_array(coalesce(new.wali_kelas, ''), ',')) as v(kelas)
    ) x
   where coalesce(btrim(x.tingkat), '') <> ''
     and not exists (
           select 1
             from wali_kelas_penugasan w2
            where btrim(coalesce(w2.nis_nip, '')) = x.nis
              and w2.kelas_label = x.label
         )
  on conflict do nothing;

  return new;
end $$;

comment on function fn_sync_wali_penugasan() is
  'Menjaga wali_kelas_penugasan sinkron dengan akun.penugasan[TA].wali & akun.wali_kelas (Tahap 4A).';

drop trigger if exists trg_sync_wali_penugasan on akun;
create trigger trg_sync_wali_penugasan
  after insert or update on akun
  for each row execute function fn_sync_wali_penugasan();

-- ============================================================
-- 6. FUNGSI AKSES & BACAAN (disesuaikan untuk wali kelas multi-kelas)
-- ============================================================
-- 6a. fn_is_wali_kelas — versi 20261027 + tabel relasi.
--     True bila akun pemanggil (by user_id ATAU NIS dari sesi) punya
--     minimal satu penugasan wali kelas (TA apa pun).
create or replace function fn_is_wali_kelas()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from akun a
     where (
             a.user_id = auth.uid()
             or (btrim(coalesce(fn_nis(), '')) <> ''
                 and btrim(coalesce(a.nis_nip, '')) = btrim(fn_nis()))
           )
       and fn_guru_wali_ada(a.nis_nip)
  );
$$;

-- 6b. akun_guru_ampu_murid — versi 20261023 + wali kelas MULTI & kelas
--     efektif per tahun pelajaran (riwayat_kelas ∪ tingkat_kelas).
--     Dipakai otorisasi Absen Mandiri, data wajah, ubah murid, dsb.
--     (1) pembina ekskul murid  → aturan lama, tidak berubah;
--     (2) wali kelas murid      → irisan {kelas wali guru} ∩ {kelas efektif murid}
--                                 dengan pembanding kanonik fn_kelas_sama
--                                 (sehingga "10 RPL 1" ≡ "X RPL 1").
create or replace function akun_guru_ampu_murid(p_guru_nis text, p_murid_nis text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if btrim(coalesce(p_guru_nis, '')) = '' or btrim(coalesce(p_murid_nis, '')) = '' then
    return false;
  end if;

  -- (1) Pembina ekskul murid (aturan lama).
  if exists (
    select 1
      from akun g
      join akun m
        on btrim(coalesce(m.nis_nip, '')) = btrim(coalesce(p_murid_nis, ''))
       and m.tipe = 'murid'
     where btrim(coalesce(g.nis_nip, '')) = btrim(coalesce(p_guru_nis, ''))
       and g.tipe = 'guru'
       and exists (
             select 1
               from unnest(string_to_array(coalesce(g.ekstrakurikuler, ''), ',')) as ge(x)
               cross join unnest(string_to_array(coalesce(m.ekstrakurikuler, ''), ',')) as me(x)
              where btrim(ge.x) <> ''
                and lower(btrim(ge.x)) = lower(btrim(me.x))
           )
  ) then
    return true;
  end if;

  -- (2) Wali kelas: satu kelas wali guru ≡ satu kelas efektif murid.
  return exists (
    select 1
      from unnest(fn_wali_kelas_list(p_guru_nis)) as wk(kelas)
      cross join unnest(fn_kelas_murid(p_murid_nis)) as mk(kelas)
     where fn_kelas_sama(wk.kelas, mk.kelas)
  );
end $$;

-- 6c. fn_akun_json — versi 20261115 + field wali_kelas_list/wali_kelas_map
--     pada mode 'guru_wali' & 'guru_dashboard' (dipakai peta wali kelas,
--     dropdown kelas absensi, dan dashboard guru).
create or replace function fn_akun_json(p_id uuid, p_mode text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case coalesce(nullif(trim(p_mode), ''), 'ringkas_murid')

    when 'penuh' then to_jsonb(a)

    -- ---------- profil staf/murid (whitelist 17 kolom; app.js bukaProfilAkun) ----------
    when 'profil_akun' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap,
      'gelar_depan', a.gelar_depan, 'gelar_belakang', a.gelar_belakang,
      'email', a.email, 'tingkat_kelas', a.tingkat_kelas, 'jabatan', a.jabatan,
      'wali_kelas', a.wali_kelas, 'mapel', a.mapel, 'ekstrakurikuler', a.ekstrakurikuler,
      'penugasan', a.penugasan, 'no_telepon', a.no_telepon,
      'jenis_kelamin', a.jenis_kelamin, 'agama', a.agama, 'nisn', a.nisn,
      'tipe', a.tipe, 'url_foto', a.url_foto)

    -- ---------- potongan kecil ----------
    when 'foto' then jsonb_build_object('url_foto', a.url_foto)
    when 'nis'  then jsonb_build_object('nis_nip', a.nis_nip)
    when 'jabatan_map' then jsonb_build_object(
      'jabatan_ekskul_map', coalesce(a.jabatan_ekskul_map, '{}'::jsonb))

    when 'identitas' then jsonb_build_object(
      'id', a.id, 'tipe', a.tipe, 'nis_nip', a.nis_nip, 'user_id', a.user_id,
      'email', a.email, 'nama_lengkap', a.nama_lengkap,
      'tingkat_kelas', a.tingkat_kelas, 'url_foto', a.url_foto)

    when 'wajah' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap,
      'tingkat_kelas', a.tingkat_kelas, 'url_foto', a.url_foto,
      'wajah_descriptor', a.wajah_descriptor, 'wajah_status', a.wajah_status)

    when 'peta_wajah' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'wajah_descriptor', a.wajah_descriptor,
      'wajah_status', a.wajah_status)

    -- ---------- guru/admin ----------
    when 'guru_ringkas' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap,
      'gelar_depan', a.gelar_depan, 'gelar_belakang', a.gelar_belakang)

    when 'guru_wali' then jsonb_build_object(
      'nama_lengkap', a.nama_lengkap, 'gelar_depan', a.gelar_depan,
      'gelar_belakang', a.gelar_belakang, 'wali_kelas', a.wali_kelas,
      'wali_kelas_list', to_jsonb(fn_wali_kelas_list(a.nis_nip)),
      'wali_kelas_map', fn_wali_kelas_map(a.nis_nip))

    when 'guru_kanal_absen' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap, 'mapel', a.mapel,
      'ekstrakurikuler', a.ekstrakurikuler, 'kunci_absen', a.kunci_absen)

    when 'guru_pembina' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap,
      'gelar_depan', a.gelar_depan, 'gelar_belakang', a.gelar_belakang,
      'no_telepon', a.no_telepon, 'ekstrakurikuler', a.ekstrakurikuler)

    when 'guru_penugasan' then jsonb_build_object(
      'id', a.id, 'nis_nip', a.nis_nip, 'penugasan', a.penugasan)

    when 'guru_penugasan_ringkas' then jsonb_build_object(
      'id', a.id, 'penugasan', a.penugasan)

    when 'guru_dashboard' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap, 'mapel', a.mapel,
      'ekstrakurikuler', a.ekstrakurikuler, 'wali_kelas', a.wali_kelas,
      'wali_kelas_list', to_jsonb(fn_wali_kelas_list(a.nis_nip)),
      'wali_kelas_map', fn_wali_kelas_map(a.nis_nip),
      'penugasan', a.penugasan, 'tingkat_kelas', a.tingkat_kelas,
      'captcha', a.captcha, 'kunci_absen', a.kunci_absen,
      'no_telepon', a.no_telepon, 'gelar_depan', a.gelar_depan,
      'gelar_belakang', a.gelar_belakang)

    -- ---------- murid: daftar (+ kelas terstruktur) ----------
    when 'list' then jsonb_build_object(
      'id', a.id, 'user_id', a.user_id, 'nis_nip', a.nis_nip, 'nisn', a.nisn,
      'nama_lengkap', a.nama_lengkap, 'tingkat_kelas', a.tingkat_kelas,
      'jabatan', a.jabatan, 'jabatan_ekskul', a.jabatan_ekskul, 'email', a.email,
      'ekstrakurikuler', a.ekstrakurikuler, 'tahun_pelajaran', a.tahun_pelajaran,
      'semester', a.semester, 'riwayat_kelas', a.riwayat_kelas, 'url_foto', a.url_foto,
      'tingkat', a.tingkat, 'jurusan_kode', a.jurusan_kode, 'jurusan', a.jurusan,
      'rombel', a.rombel, 'kelas_label', a.kelas_label)

    when 'export' then fn_akun_export(a.id)
    when 'cetak'  then fn_akun_export(a.id)
                        || jsonb_build_object('jabatan_ekskul_map', coalesce(a.jabatan_ekskul_map, '{}'::jsonb))

    when 'ringkas_murid' then jsonb_build_object(
      'id', a.id, 'nis_nip', a.nis_nip, 'nisn', a.nisn, 'nama_lengkap', a.nama_lengkap,
      'tingkat_kelas', a.tingkat_kelas, 'ekstrakurikuler', a.ekstrakurikuler,
      'riwayat_kelas', a.riwayat_kelas, 'tahun_pelajaran', a.tahun_pelajaran,
      'semester', a.semester,
      'tingkat', a.tingkat, 'jurusan_kode', a.jurusan_kode, 'jurusan', a.jurusan,
      'rombel', a.rombel, 'kelas_label', a.kelas_label)

    when 'ekskul_map' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'ekstrakurikuler', a.ekstrakurikuler,
      'riwayat_ekskul', a.riwayat_ekskul,
      'jabatan_ekskul_map', coalesce(a.jabatan_ekskul_map, '{}'::jsonb))

    when 'dashboard_murid' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nisn', a.nisn, 'nama_lengkap', a.nama_lengkap,
      'tingkat_kelas', a.tingkat_kelas, 'riwayat_kelas', a.riwayat_kelas,
      'jenis_kelamin', a.jenis_kelamin, 'agama', a.agama,
      'catatan_khusus', a.catatan_khusus, 'ekstrakurikuler', a.ekstrakurikuler,
      'jabatan', a.jabatan, 'jabatan_ekskul_map', coalesce(a.jabatan_ekskul_map, '{}'::jsonb),
      'riwayat_ekskul', a.riwayat_ekskul, 'tahun_pelajaran', a.tahun_pelajaran,
      'semester', a.semester, 'no_telepon', a.no_telepon)

    when 'anggota_ekskul' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap,
      'tingkat_kelas', a.tingkat_kelas, 'jabatan', a.jabatan,
      'no_telepon', a.no_telepon, 'tgl_lahir', a.tgl_lahir,
      'jabatan_ekskul_map', coalesce(a.jabatan_ekskul_map, '{}'::jsonb),
      'riwayat_ekskul', a.riwayat_ekskul, 'tahun_pelajaran', a.tahun_pelajaran,
      'tingkat', a.tingkat, 'jurusan_kode', a.jurusan_kode, 'jurusan', a.jurusan,
      'rombel', a.rombel, 'kelas_label', a.kelas_label)

    when 'pemilih' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap,
      'tingkat_kelas', a.tingkat_kelas, 'tahun_pelajaran', a.tahun_pelajaran,
      'ekstrakurikuler', a.ekstrakurikuler, 'jabatan', a.jabatan,
      'no_telepon', a.no_telepon)

    when 'pemilih_ringkas' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap,
      'tahun_pelajaran', a.tahun_pelajaran, 'tingkat_kelas', a.tingkat_kelas,
      'ekstrakurikuler', a.ekstrakurikuler)

    else to_jsonb(a)
  end
  from akun a
  where a.id = p_id
$$;

-- 6d. ubah_anggota_ekskul — versi 20261028b2 dengan gerbang "wali kelas
--     ATAU pembina ekskul" memakai fn_guru_wali_ada() (multi-kelas).
create or replace function ubah_anggota_ekskul(
  p_pemanggil text,
  p_ekskul text,
  p_nis_list text[],
  p_tambah boolean,
  p_ta text default null,
  p_smt text[] default null,
  p_token text default ''
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pemanggil text;
  v_tipe text;
  v_jabatan_map jsonb;
  v_wali_kelas text;
  v_ekstra text;
  v_nis text;
  v_ekstra_siswa text;
  v_baru text;
  v_ta text;
  v_total int := 0;
  v_riwayat jsonb;
  v_entri jsonb;
  v_eks_riwayat text;
  v_baru_riwayat text;
  v_jmap jsonb;
  v_smt jsonb;
  v_teks_smt text;
  v_smt_bersih text[] := array[]::text[];
  v_smt_entri text[];
begin

  -- 0) TA berjalan: parameter eksplisit, atau turunkan dari Master Data
  v_ta := coalesce(nullif(trim(coalesce(p_ta, '')), ''), (
    select min(m."Tahun Pelajaran")::text from master_data m
    where m."Tahun Pelajaran" is not null and trim(m."Tahun Pelajaran"::text) <> ''
  ), to_char(now() at time zone 'Asia/Jakarta', 'YYYY') || '/' ||
       to_char((now() at time zone 'Asia/Jakarta') + interval '1 year', 'YYYY'));

  -- 0a) Semester yang akan ditandai (hanya Ganjil/Genap; abaikan lainnya)
  if p_smt is not null then
    select array_agg(x) into v_smt_bersih
    from unnest(p_smt) as x
    where trim(coalesce(x, '')) in ('Ganjil', 'Genap');
  end if;
  v_smt_bersih := coalesce(v_smt_bersih, array[]::text[]);

  -- 1) Identitas pemanggil — DARI SESI, bukan dari parameter.
  if fn_role() in ('admin', 'guru') then
    v_pemanggil := fn_nis();
  else
    -- Fallback klaim NIS dikosongkan (parameter `p_pemanggil` hanya untuk
    -- kompatibilitas signature) → identitas HANYA dari sesi.
    v_pemanggil := fn_akses_murid(p_token, '');
    if coalesce(trim(coalesce(v_pemanggil, '')), '') = '' then
      return json_build_object('status', 'error', 'message', 'Sesi tidak valid. Silakan login ulang.');
    end if;
  end if;

  select tipe, jabatan_ekskul_map, wali_kelas, ekstrakurikuler
  into v_tipe, v_jabatan_map, v_wali_kelas, v_ekstra
  from akun
  where nis_nip = v_pemanggil;

  if not found then
    return json_build_object('status', 'error', 'message', 'Akun pemanggil tidak ditemukan.');
  end if;

  -- 2) Verifikasi hak akses per tipe
  if v_tipe = 'admin' then
    null;
  elsif v_tipe = 'guru' then
    if not fn_guru_wali_ada(v_pemanggil)
       and not (lower(trim(p_ekskul)) = any (
            select lower(trim(x))
            from unnest(string_to_array(coalesce(v_ekstra, ''), ',')) as t(x)
            where trim(x) <> ''
          ))
    then
      return json_build_object('status', 'error', 'message',
        'Hanya wali kelas atau pembina ' || p_ekskul || ' yang dapat mengubah anggota.');
    end if;
  elsif v_tipe = 'murid' then
    if v_jabatan_map is null or coalesce(trim(coalesce(v_jabatan_map->>p_ekskul, '')), '') = '' then
      return json_build_object('status', 'error', 'message', 'Hanya pengurus (menjabat) ' || p_ekskul || ' yang dapat mengubah anggota.');
    end if;
  else
    return json_build_object('status', 'error', 'message', 'Tipe akun pemanggil tidak dikenal.');
  end if;

  -- 3) Terapkan per NIS (gabung/buang nama ekskul, anti-duplikat) → kolom live + riwayat_ekskul[TA]
  if p_nis_list is null then
    p_nis_list := array[]::text[];
  end if;

  foreach v_nis in array p_nis_list loop
    if trim(coalesce(v_nis, '')) = '' then continue; end if;

    select ekstrakurikuler, coalesce(riwayat_ekskul, '{}'::jsonb)
    into v_ekstra_siswa, v_riwayat
    from akun
    where nis_nip = v_nis and tipe = 'murid'
    for update;

    if not found then continue; end if;

    -- a) Kolom live akun.ekstrakurikuler
    if p_tambah then
      if lower(trim(p_ekskul)) = any (
        select lower(trim(x)) from unnest(string_to_array(coalesce(v_ekstra_siswa, ''), ',')) as x where trim(x) <> ''
      ) then
        v_baru := v_ekstra_siswa;
      else
        v_baru := case
          when coalesce(trim(v_ekstra_siswa), '') = '' then trim(p_ekskul)
          else trim(v_ekstra_siswa) || ',' || trim(p_ekskul)
        end;
      end if;
    else
      select string_agg(x, ',') into v_baru
      from (
        select trim(x) as x
        from unnest(string_to_array(coalesce(v_ekstra_siswa, ''), ',')) as t(x)
        where trim(x) <> '' and lower(trim(x)) <> lower(trim(p_ekskul))
      ) s;
      v_baru := coalesce(v_baru, '');
    end if;

    -- b) Entri riwayat_ekskul[TA]
    v_entri := coalesce(v_riwayat->v_ta, '{}'::jsonb);
    v_eks_riwayat := coalesce(nullif(trim(coalesce(v_entri->>'ekskul', '')), ''), v_ekstra_siswa);
    if p_tambah then
      if lower(trim(p_ekskul)) = any (
        select lower(trim(x)) from unnest(string_to_array(v_eks_riwayat, ',')) as x where trim(x) <> ''
      ) then
        v_baru_riwayat := v_eks_riwayat;
      else
        v_baru_riwayat := case
          when coalesce(trim(v_eks_riwayat), '') = '' then trim(p_ekskul)
          else trim(v_eks_riwayat) || ',' || trim(p_ekskul)
        end;
      end if;
    else
      select string_agg(x, ',') into v_baru_riwayat
      from (
        select trim(x) as x
        from unnest(string_to_array(v_eks_riwayat, ',')) as t(x)
        where trim(x) <> '' and lower(trim(x)) <> lower(trim(p_ekskul))
      ) s;
      v_baru_riwayat := coalesce(v_baru_riwayat, '');
    end if;

    v_jmap := coalesce((v_entri->>'jabatan_map')::jsonb, coalesce(v_jabatan_map, '{}'::jsonb));
    v_jmap := coalesce(v_jmap, '{}'::jsonb);

    -- SEMESTER: gabungkan (union) semester yang sudah ada + yang baru untuk p_ekskul.
    --   smt[ekskul] = [Ganjil, Genap] → siswa ikut di kedua semester (skenario B).
    --   Menambah anggota tanpa p_smt → smt[ekskul] dibiarkan polos (kedua semester).
    v_smt := coalesce((v_entri->>'smt')::jsonb, '{}'::jsonb);
    if v_smt = 'null'::jsonb then v_smt := '{}'::jsonb; end if;
    v_teks_smt := coalesce(v_smt->>p_ekskul, '');
    v_smt_entri := array(
      select trim(x) from unnest(string_to_array(v_teks_smt, ',')) as t(x)
      where trim(x) in ('Ganjil', 'Genap')
    );
    if array_length(v_smt_bersih, 1) > 0 then
      select array_agg(distinct y) into v_smt_entri
      from (
        select unnest(v_smt_entri) as y
        union
        select unnest(v_smt_bersih)
      ) s;
    end if;

    update akun
       set ekstrakurikuler = v_baru,
           riwayat_ekskul = jsonb_set(
              coalesce(v_riwayat, '{}'::jsonb),
              array[v_ta],
              jsonb_build_object(
                'ekskul', v_baru_riwayat,
                'jabatan_map', v_jmap,
                'status', 'Aktif',
                'smt', case
                  when array_length(v_smt_entri, 1) > 0
                    then jsonb_set(coalesce(v_smt, '{}'::jsonb), array[p_ekskul], to_jsonb(v_smt_entri))
                  else v_smt
                end
              )
           )
     where nis_nip = v_nis;

    v_total := v_total + 1;
  end loop;

  return json_build_object('status', 'success', 'total', v_total);
end $$;

-- Izin eksekusi (idempotent — `create or replace` di atas tidak menghapus grant)
grant execute on function fn_is_wali_kelas() to authenticated, anon;
grant execute on function akun_guru_ampu_murid(text, text) to anon, authenticated;
grant execute on function ubah_anggota_ekskul(text, text, text[], boolean, text, text[], text) to anon, authenticated;
grant execute on function fn_akun_json(uuid, text) to anon, authenticated;

-- ============================================================
-- 7. VERIFIKASI & RELOAD CACHE SKEMA POSTGREST
-- ============================================================
do $$
declare
  v_tbl int;
  v_kol int;
  v_trg int;
  v_fn  int;
  v_isi int;
  v_guru int;
begin
  -- (a) tabel relasi ada
  select count(*) into v_tbl
    from information_schema.tables
   where table_schema = 'public' and table_name = 'wali_kelas_penugasan';

  if v_tbl <> 1 then
    raise exception 'WALI KELAS MULTI GAGAL: tabel wali_kelas_penugasan tidak ada.';
  end if;

  -- (b) 6 kolom kunci tersedia (termasuk kelas_label generated)
  select count(*) into v_kol
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'wali_kelas_penugasan'
     and column_name in ('nis_nip', 'tahun_pelajaran', 'tingkat',
                         'jurusan_kode', 'rombel', 'kelas_label');

  if v_kol <> 6 then
    raise exception 'WALI KELAS MULTI GAGAL: kolom tabel hanya % dari 6.', v_kol;
  end if;

  -- (c) trigger sinkron terpasang
  select count(*) into v_trg
    from pg_trigger
   where not tgisinternal and tgname = 'trg_sync_wali_penugasan';

  if v_trg <> 1 then
    raise exception 'WALI KELAS MULTI GAGAL: trigger trg_sync_wali_penugasan tidak terpasang.';
  end if;

  -- (d) 12 fungsi wajib tersedia
  select count(*) into v_fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fn_kelas_sama', 'fn_wali_list', 'fn_ta_berjalan',
                       'fn_wali_kelas_list', 'fn_wali_kelas_map', 'fn_kelas_murid',
                       'fn_guru_wali_ada', 'fn_sync_wali_penugasan',
                       'fn_is_wali_kelas', 'akun_guru_ampu_murid',
                       'ubah_anggota_ekskul', 'fn_akun_json');

  if v_fn <> 12 then
    raise exception 'WALI KELAS MULTI GAGAL: fungsi hanya % dari 12 terpasang.', v_fn;
  end if;

  -- (e) laporan backfill
  select count(*), count(distinct btrim(nis_nip)) into v_isi, v_guru
    from wali_kelas_penugasan;

  raise notice 'Wali kelas multi OK — wali_kelas_penugasan: % baris untuk % guru; kelas_label contoh: %.',
    v_isi, v_guru, coalesce((select string_agg(distinct kelas_label, ', ' order by kelas_label)
                               from (select kelas_label from wali_kelas_penugasan
                                      where coalesce(btrim(kelas_label), '') <> '' limit 5) t), '-');

  if v_isi = 0 then
    raise warning 'wali_kelas_penugasan masih KOSONG — relasi akan terisi otomatis saat penugasan/wali kelas guru disimpan (atau jalankan ulang backfill setelah data penugasan lengkap).';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- CARA PAKAI
--   1) Jalankan SELURUH berkas ini sekali di Supabase SQL Editor.
--   2) Aman dijalankan SEBELUM frontend baru di-deploy: kolom & jalur tulis
--      lama (penugasan[TA].wali string, akun.wali_kelas) tetap dipakai, dan
--      trigger bagian 5 menjaga tabel relasi tetap sinkron.
--   3) Setelah frontend Tahap 4A dipasang, penugasan[TA].wali boleh berisi
--      ARRAY (["X LP 1","X LP 2"]) — trigger menuliskannya ke tabel relasi.
--   4) Verifikasi cepat:
--      select * from wali_kelas_penugasan order by nis_nip, tahun_pelajaran, kelas_label;
--      select fn_wali_kelas_list('<NIP>'), fn_wali_kelas_map('<NIP>');
--      select fn_guru_wali_ada('<NIP>'), fn_is_wali_kelas();
-- ============================================================



