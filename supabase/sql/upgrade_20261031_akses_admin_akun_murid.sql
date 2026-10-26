-- ============================================================
-- UPGRADE 20261031: AKSES ADMIN — "Registrasi Wajah Masal" & "Simpan Data" (Akun Murid) — 2026-10-31
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG
--   Menu "Data Akun Murid" memiliki dua aksi yang dikerjakan admin:
--     1) tombol **Wajah Masal** → `scanWajahMasal()` (web/js/app.js) →
--        `FaceWajah.registrasiOtomatisDariFoto()` → RPC `simpan_wajah_murid`
--        (upgrade_20261028b2, blok otorisasi);
--     2) tombol **Simpan Data** pada form Edit/Tambah → `simpanAkunMurid()` →
--        RPC `buat_akun_murid` (upgrade_20261015, blok otorisasi).
--   Di sisi klien kedua aksi SUDAH terbuka untuk admin
--   (`bisaImportMuridAktif()` / `bisaEditAkunMurid()`), tetapi SERVER masih bisa
--   menolak admin karena deteksi peran bergantung pada tautan
--   `akun.user_id = auth.uid()`:
--     * `fn_role()` = `select tipe from akun where user_id = auth.uid() limit 1`
--       (upgrade_20261027) — `limit 1` TANPA `order by`: bila satu user punya
--       lebih dari satu baris akun (mis. baris admin + baris murid/guru lama),
--       baris yang "kebetulan" terbaca bisa bukan 'admin' → `fn_is_admin()`
--       = false → `simpan_wajah_murid` menolak
--       ("Tidak berhak mengubah data wajah murid ini.");
--     * `buat_akun_murid` membaca peran dengan polanya sendiri
--       (`select ... from akun where user_id = auth.uid() limit 1`) → penolakan
--       "Hanya admin atau guru (wali/pembina) yang boleh mengelola akun murid.";
--     * baris admin/guru yang `user_id`-nya masih NULL (akun dibuat sebelum kolom
--       `user_id` ada, atau penautan sesi belum pernah terjadi) SELALU gagal,
--       walau emailnya sama dengan akun Supabase Auth.
--   Gejala di lapangan: tombol TAMPIL (klien mengizinkan) tetapi aksinya gagal
--   dengan pesan penolakan dari server.
--
-- ISI UPGRADE (idempotent — aman dijalankan berulang; tanpa perubahan
--                struktur tabel, tanpa kehilangan data)
--   1) `fn_role()` & `fn_nis()` dibuat ulang: deterministik + ADMIN-first
--      (order by tipe admin → guru → murid) sehingga baris duplikat tidak bisa
--      menyembunyikan status admin.
--   2) `fn_is_admin()` dibuat ulang: `exists (... tipe = 'admin')` — tidak lagi
--      bergantung pada satu baris hasil `limit 1`.
--   3) Backfill tautan `akun.user_id` untuk baris admin/guru yang masih NULL
--      dan emailnya cocok dengan `auth.users.email` (case-insensitive).
--   4) `buat_akun_murid(p_data)` dibuat ulang PERSIS seperti upgrade_20261015
--      (whitelist kolom & jalur insert/update tidak berubah), hanya blok
--      otorisasinya memakai `fn_is_admin()` / `fn_role()` / `fn_nis()`.
--   5) Grant `execute` (anon, authenticated) + blok verifikasi DO +
--      `notify pgrst, 'reload schema'`.
--
--   `simpan_wajah_murid` SENGAJA tidak dibuat ulang: versi terakhirnya
--   (upgrade_20261028b2) sudah memakai `fn_is_admin()`/`fn_is_guru()`, sehingga
--   blok 1–2 file ini sudah cukup membuat fitur "Wajah Masal" mengenali admin.
--
-- ROLLBACK
--   Jalankan ulang blok 1a/1b/1c dari
--     supabase/sql/upgrade_20261027_role_hybrid_opsiC.sql   (fn_role, fn_nis, fn_is_admin)
--   lalu blok 2 dari
--     supabase/sql/upgrade_20261015_edit_murid_akses_guru_wali.sql   (buat_akun_murid).
--   Backfill `user_id` tidak perlu dibatalkan — ia justru memperbaiki data.
-- ============================================================

-- ========== 1. DETEKSI PERAN: DETERMINISTIK & ADMIN-FIRST ==========

-- 1a. Tipe akun pemanggil ('admin' | 'guru' | 'murid' | '').
--     Bila satu auth.uid() punya beberapa baris akun, ADMIN selalu menang.
create or replace function fn_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select a.tipe
      from akun a
     where a.user_id = auth.uid()
     order by case a.tipe
                when 'admin' then 0
                when 'guru'  then 1
                when 'murid' then 2
                else 3
              end,
              a.nis_nip
     limit 1
  ), '');
$$;

-- 1b. NIS/NIP pemanggil — urutan SAMA dengan fn_role() agar pasangan
--     (tipe, nis_nip) selalu berasal dari baris yang sama.
create or replace function fn_nis()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select a.nis_nip
      from akun a
     where a.user_id = auth.uid()
     order by case a.tipe
                when 'admin' then 0
                when 'guru'  then 1
                when 'murid' then 2
                else 3
              end,
              a.nis_nip
     limit 1
  ), '');
$$;

-- 1c. Admin? — berbasis EXISTS: tidak bergantung pada satu baris `limit 1`,
--     jadi baris duplikat tidak bisa lagi menyembunyikan status admin.
create or replace function fn_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from akun a
     where a.user_id = auth.uid()
       and a.tipe = 'admin'
  );
$$;

-- ========== 2. BACKFILL TAUTAN akun.user_id (admin & guru) ==========
-- Baris akun yang emailnya cocok dengan akun Supabase Auth tetapi `user_id`-nya
-- masih NULL → ditautkan. Deterministik: bila satu email punya beberapa akun
-- Auth, diambil yang paling awal dibuat (`created_at`).
with kandidat as (
  select lower(trim(u.email))                                  as email,
         (array_agg(u.id order by u.created_at, u.id))[1]      as user_id,
         count(*)                                              as jml
    from auth.users u
   where trim(coalesce(u.email, '')) <> ''
   group by 1
)
update akun a
   set user_id = k.user_id
  from kandidat k
 where a.user_id is null
   and a.tipe in ('admin', 'guru')
   and lower(trim(coalesce(a.email, ''))) = k.email;

-- ========== 3. RPC: TAMBAH/EDIT AKUN MURID (otorisasi admin yang andal) ==========
-- Isi fungsi = PERSIS versi upgrade_20261015_edit_murid_akses_guru_wali.sql
-- (kolom yang ditulis, jalur insert/update, dan pesan error tidak berubah).
-- Yang diubah HANYA cara identifikasi pemanggil:
--   * DULU: `select coalesce(tipe,''), coalesce(nis_nip,'') from akun
--           where user_id = auth.uid() limit 1;` — tanpa `order by`, sehingga
--           baris akun duplikat bisa membuat admin terbaca sebagai non-admin.
--   * KINI: `fn_is_admin()` / `fn_role()` / `fn_nis()` — admin-first (blok 1).
create or replace function buat_akun_murid(p_data jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pemanggil_tipe text := '';
  v_pemanggil_nis  text := '';
  v_ada            boolean := false;
  v_nis text;
  v_pass text;
  v_lahir date;
begin
  -- Identifikasi pemanggil lewat sesi Auth (admin & guru punya auth.uid()).
  if fn_is_admin() then
    v_pemanggil_tipe := 'admin';   -- admin selalu menang (walau ada baris ganda)
  else
    v_pemanggil_tipe := coalesce(fn_role(), '');
  end if;
  v_pemanggil_nis := coalesce(fn_nis(), '');

  v_nis := trim(coalesce(p_data->>'nis', ''));
  if v_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;
  if coalesce(trim(coalesce(p_data->>'nama_lengkap', '')), '') = '' then
    return json_build_object('status', 'error', 'message', 'Nama lengkap wajib diisi.');
  end if;

  v_pass := trim(coalesce(p_data->>'password', ''));
  v_lahir := nullif(trim(coalesce(p_data->>'tgl_lahir', '')), '')::date;

  select exists (select 1 from akun where nis_nip = v_nis and tipe = 'murid') into v_ada;

  -- ========== OTORISASI ==========
  if v_pemanggil_tipe = 'admin' then
    null; -- boleh tambah & edit
  elsif v_pemanggil_tipe = 'guru' then
    -- Guru: EDIT saja pada murid yang diampu, tanpa ubah password.
    if not v_ada then
      return json_build_object('status', 'error', 'message', 'Guru hanya dapat mengedit murid yang sudah terdaftar (bukan menambah murid baru).');
    end if;
    if v_pass <> '' then
      return json_build_object('status', 'error', 'message', 'Guru tidak berhak mengubah password murid. Minta admin untuk reset password.');
    end if;
    if not akun_guru_ampu_murid(v_pemanggil_nis, v_nis) then
      return json_build_object('status', 'error', 'message', 'Anda hanya dapat mengedit murid yang Anda ampu (wali kelas atau pembina ekskul).');
    end if;
  else
    return json_build_object('status', 'error', 'message', 'Hanya admin atau guru (wali/pembina) yang boleh mengelola akun murid.');
  end if;

-- ========== PROSES ==========
  if v_ada then
    -- EDIT: perbarui profil; password hanya bila diisi (khusus admin)
    update akun set
      nama_lengkap     = coalesce(nullif(trim(p_data->>'nama_lengkap'), ''), nama_lengkap),
      nisn             = coalesce(nullif(trim(p_data->>'nisn'), ''), nisn),
      tahun_pelajaran  = coalesce(nullif(trim(p_data->>'tahun_pelajaran'), ''), tahun_pelajaran),
      semester         = coalesce(nullif(trim(p_data->>'semester'), ''), semester),
      tingkat_kelas    = coalesce(nullif(trim(p_data->>'tingkat_kelas'), ''), tingkat_kelas),
      jenis_kelamin    = coalesce(nullif(trim(p_data->>'jenis_kelamin'), ''), jenis_kelamin),
      tgl_lahir        = coalesce(v_lahir, tgl_lahir),
      agama            = coalesce(nullif(trim(p_data->>'agama'), ''), agama),
      golongan_darah   = coalesce(nullif(trim(p_data->>'golongan_darah'), ''), golongan_darah),
      jabatan          = coalesce(nullif(trim(p_data->>'jabatan'), ''), jabatan),
      email            = coalesce(nullif(trim(p_data->>'email'), ''), email),
      no_telepon       = coalesce(nullif(trim(p_data->>'no_telepon'), ''), no_telepon),
      ekstrakurikuler  = coalesce(nullif(trim(p_data->>'ekstrakurikuler'), ''), ekstrakurikuler),
      nama_ayah        = coalesce(nullif(trim(p_data->>'nama_ayah'), ''), nama_ayah),
      pekerjaan_ayah   = coalesce(nullif(trim(p_data->>'pekerjaan_ayah'), ''), pekerjaan_ayah),
      nama_ibu         = coalesce(nullif(trim(p_data->>'nama_ibu'), ''), nama_ibu),
      pekerjaan_ibu    = coalesce(nullif(trim(p_data->>'pekerjaan_ibu'), ''), pekerjaan_ibu),
      nama_wali        = coalesce(nullif(trim(p_data->>'nama_wali'), ''), nama_wali),
      alamat           = coalesce(nullif(trim(p_data->>'alamat'), ''), alamat),
      catatan_khusus   = coalesce(nullif(trim(p_data->>'catatan_khusus'), ''), catatan_khusus)
    where nis_nip = v_nis and tipe = 'murid';

    if v_pass <> '' then
      insert into akun_kredensial (nis_nip, password_hash)
      values (v_nis, crypt(v_pass, gen_salt('bf', 10)))
      on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();
    end if;
    return json_build_object('status', 'success', 'message', 'Data murid diperbarui.', 'aksi', 'update');
  else
    -- TAMBAH: password wajib (kosong → default 123456) — hanya admin yang sampai sini
    if v_pass = '' then v_pass := '123456'; end if;
    insert into akun (
      nama_lengkap, nis_nip, tipe, nisn, tahun_pelajaran, semester,
      jenis_kelamin, tgl_lahir, agama, golongan_darah,
      email, no_telepon, ekstrakurikuler, tingkat_kelas, jabatan,
      nama_ayah, pekerjaan_ayah, nama_ibu, pekerjaan_ibu, nama_wali,
      alamat, catatan_khusus
    ) values (
      trim(p_data->>'nama_lengkap'), v_nis, 'murid',
      nullif(trim(coalesce(p_data->>'nisn', '')), ''),
      nullif(trim(coalesce(p_data->>'tahun_pelajaran', '')), ''),
      nullif(trim(coalesce(p_data->>'semester', '')), ''),
      nullif(trim(coalesce(p_data->>'jenis_kelamin', '')), ''),
      v_lahir,
      nullif(trim(coalesce(p_data->>'agama', '')), ''),
      nullif(trim(coalesce(p_data->>'golongan_darah', '')), ''),
      nullif(trim(coalesce(p_data->>'email', '')), ''),
      nullif(trim(coalesce(p_data->>'no_telepon', '')), ''),
      nullif(trim(coalesce(p_data->>'ekstrakurikuler', '')), ''),
      nullif(trim(coalesce(p_data->>'tingkat_kelas', '')), ''),
      nullif(trim(coalesce(p_data->>'jabatan', '')), ''),
      nullif(trim(coalesce(p_data->>'nama_ayah', '')), ''),
      nullif(trim(coalesce(p_data->>'pekerjaan_ayah', '')), ''),
      nullif(trim(coalesce(p_data->>'nama_ibu', '')), ''),
      nullif(trim(coalesce(p_data->>'pekerjaan_ibu', '')), ''),
      nullif(trim(coalesce(p_data->>'nama_wali', '')), ''),
      nullif(trim(coalesce(p_data->>'alamat', '')), ''),
      nullif(trim(coalesce(p_data->>'catatan_khusus', '')), '')
    );
    insert into akun_kredensial (nis_nip, password_hash)
    values (v_nis, crypt(v_pass, gen_salt('bf', 10)))
    on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();
    return json_build_object('status', 'success', 'message', 'Murid baru tersimpan (password lokal aktif).', 'aksi', 'insert');
  end if;
end $$;

-- ========== 4. IZIN EKSEKUSI ==========
-- RPC yang dipakai frontend (anon = murid password lokal; authenticated = JWT).
grant execute on function fn_role()       to anon, authenticated;
grant execute on function fn_nis()        to anon, authenticated;
grant execute on function fn_is_admin()   to anon, authenticated;
grant execute on function buat_akun_murid(jsonb) to anon, authenticated;
-- Fitur "Wajah Masal" memakai RPC ini (versi 7 argumen, upgrade_20261028b2).
grant execute on function simpan_wajah_murid(text, jsonb, text, text, text, text, text) to anon, authenticated;

-- ========== 5. VERIFIKASI & RELOAD CACHE SKEMA POSTGREST ==========
do $$
declare
  v_jml    integer;
  v_sisa   integer;
  v_daftar text;
  v_ok     boolean;
begin
  -- a) Tidak ada overload ganda pada fungsi yang disentuh file ini.
  select count(*) into v_jml
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fn_role', 'fn_nis', 'fn_is_admin', 'buat_akun_murid');
  if v_jml <> 4 then
    raise warning 'PERINGATAN: % fungsi ditemukan utk fn_role/fn_nis/fn_is_admin/buat_akun_murid (harusnya 4) — cek overload ganda.', v_jml;
  else
    raise notice 'INFO: fn_role, fn_nis, fn_is_admin, buat_akun_murid — masing-masing 1 overload.';
  end if;

  -- b) buat_akun_murid versi BARU terpasang (otorisasi memakai fn_is_admin()).
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'buat_akun_murid'
       and pg_get_functiondef(p.oid) like '%fn_is_admin%'
  ) into v_ok;
  if not v_ok then
    raise warning 'PERINGATAN: buat_akun_murid masih versi LAMA (blok 3 belum terpasang) — admin/guru bisa tetap ditolak.';
  else
    raise notice 'INFO: buat_akun_murid versi baru aktif (admin dikenali via fn_is_admin).';
  end if;

  -- c) Grant yang dibutuhkan kedua fitur.
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'buat_akun_murid'
       and has_function_privilege('anon', p.oid, 'execute')
  ) into v_ok;
  if not v_ok then
    raise warning 'PERINGATAN: anon belum boleh mengeksekusi buat_akun_murid (fitur "Simpan Data") — cek blok 4.';
  else
    raise notice 'INFO: "Simpan Data" (buat_akun_murid) boleh dipanggil anon/authenticated.';
  end if;

  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'simpan_wajah_murid'
       and has_function_privilege('anon', p.oid, 'execute')
  ) into v_ok;
  if not v_ok then
    raise warning 'PERINGATAN: anon belum boleh mengeksekusi simpan_wajah_murid (fitur "Wajah Masal") — jalankan lebih dulu upgrade_20261028b2_token_rpc_murid.sql.';
  else
    raise notice 'INFO: "Wajah Masal" (simpan_wajah_murid) boleh dipanggil anon/authenticated.';
  end if;

  -- d) Sisa baris admin/guru yang BELUM tertaut ke auth.users → butuh tindakan manual.
  select count(*), coalesce(string_agg(nis_nip, ', ' order by nis_nip), '')
    into v_sisa, v_daftar
    from akun
   where tipe in ('admin', 'guru') and user_id is null;
  if v_sisa > 0 then
    raise warning 'PERINGATAN: % baris admin/guru belum tertaut user_id (%s). Login sekali di aplikasi (RPC taut_user_id_sesi) atau jalankan: select nis_nip, tipe, user_id, email from akun where tipe = ''admin'';', v_sisa, v_daftar;
  else
    raise notice 'INFO: semua baris admin/guru sudah tertaut user_id.';
  end if;
end $$;

notify pgrst, 'reload schema';
