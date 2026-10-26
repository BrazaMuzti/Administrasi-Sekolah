-- ============================================================================
-- SIAKAD / SISIP — SKEMA DATABASE LENGKAP (VERSI SEKARANG)
-- Gabungan seluruh upgrade skema: 2026-09-03 s.d. 2026-10-31 (84 berkas)
--
-- CARA PAKAI (project Supabase BARU):
--   1) Buka Supabase Dashboard → SQL Editor → New query
--   2) Salin SELURUH isi file ini (atau upload file-nya) → Run
--   3) Verifikasi: Table Editor menampilkan semua tabel & kolom
--
-- Untuk project yang SUDAH berjalan dan hanya tertinggal beberapa upgrade,
-- jangan jalankan gabungan ini — pakai file satu-persatu di folder yang sama
-- (urut tanggal, jalankan hanya yang belum ada di database).
--
-- CATATAN:
--   - Tanpa data uji (uji_*.sql) & tanpa skrip diagnosa (diag_*.sql).
--   - Semua blok idempotent (IF NOT EXISTS / DROP IF EXISTS /
--     CREATE OR REPLACE) — aman dijalankan berulang.
--   - Urutan blok di bawah = urutan EKSEKUSI, bukan hasil sort nama berkas;
--     jangan diacak. Dua blok jadwal_pelajaran (20260920_fix_kolom &
--     20260920b_lepas_notnull) sengaja diletakkan SETELAH 20260929_jadwal_
--     pelajaran.sql karena bergantung pada tabel yang dibuat blok itu.
--   - Dua blok PALING AKHIR (20261028c RLS akun ketat & fix_20261028d sesi
--     wajib) mengandaikan frontend versi terbaru. Jalankan berurutan:
--     a → b → b2 → (deploy frontend) → c → d.
--   - Dihasilkan ulang oleh: npm run build:sql
--     (periksa tanpa menulis: npm run check:sql)
-- ============================================================================
-- ============================================================
-- [1/84] upgrade_20260903.sql
-- ============================================================
-- ============================================================
-- UPGRADE SKEMA SIAKAD — 2026-09-03
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) Tabel akun    : kolom profil guru/murid
--   2) Tabel master_data : 13 kolom gaya Sheets (nama persis)
--   3) RLS master_data : select untuk semua, tulis hanya authenticated
--
-- PENTING: bagian password & RPC murid KINI ada di
--   fix_20260903_kredensial.sql  (jalankan file itu juga)
-- Semua blok idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. TABEL AKUN ==========
alter table akun
  add column if not exists jabatan text,
  add column if not exists tingkat_kelas text,
  add column if not exists wali_kelas text,
  add column if not exists mapel text,
  add column if not exists ekstrakurikuler text;

-- ========== 2. TABEL MASTER_DATA (nama kolom persis gaya Sheets) ==========
alter table master_data
  add column if not exists "Nama Dinas" text,
  add column if not exists "Nama Sekolah" text,
  add column if not exists "URL LOGO 1" text,
  add column if not exists "URL LOGO 2" text,
  add column if not exists "Ket. Nama Dinas" text,
  add column if not exists "Alamat Sekolah" text,
  add column if not exists "Semester" text,
  add column if not exists "Tahun Pelajaran" text,
  add column if not exists "Tingkat/Kelas" text,
  add column if not exists "Mata Pelajaran" text,
  add column if not exists "Ekstrakurikuler" text,
  add column if not exists "Jabatan Kelas" text,
  add column if not exists "Jabatan Guru" text;

-- ========== 3 & 4: RPC MURID & PRIVILEGE KREDENSIAL ==========
-- Dipindah ke fix_20260903_kredensial.sql — jalankan file itu.

-- ========== 3. RLS MASTER_DATA ==========
-- Baca untuk semua (header/login perlu), tulis hanya user login (admin).
alter table master_data enable row level security;

drop policy if exists "master_data_baca_semua" on master_data;
create policy "master_data_baca_semua" on master_data
  for select using (true);

drop policy if exists "master_data_tulis_authenticated" on master_data;
create policy "master_data_tulis_authenticated" on master_data
  for insert to authenticated with check (true);

drop policy if exists "master_data_ubah_authenticated" on master_data;
create policy "master_data_ubah_authenticated" on master_data
  for update to authenticated using (true) with check (true);

drop policy if exists "master_data_hapus_authenticated" on master_data;
create policy "master_data_hapus_authenticated" on master_data
  for delete to authenticated using (true);

-- ============================================================
-- [2/84] fix_20260903_kredensial.sql
-- ============================================================
-- ============================================================
-- FIX KREDENSIAL MURID — 2026-09-03 (v2)
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- (melengkapi upgrade_20260903.sql; bagian kredensial di sana
--  sudah digantikan oleh file ini)
--
-- Perbaikan:
--   1) password_hash pindah ke tabel terpisah `akun_kredensial`
--      (RLS aktif TANPA policy → tak terbaca via API oleh siapa pun;
--       akses hanya lewat RPC security definer & service_role)
--   2) Privilege tabel akun dipulihkan → select * normal (403 hilang)
--   3) RPC murid dibuat ulang membaca hash dari akun_kredensial
--   4) Cache skema PostgREST direload di akhir
-- Semua blok idempotent — aman dijalankan berulang.
-- ============================================================

create extension if not exists pgcrypto;

-- ========== 1. TABEL KREDENSIAL (hash password murid) ==========
create table if not exists akun_kredensial (
  id uuid primary key default gen_random_uuid(),
  nis_nip text not null unique,
  password_hash text not null,
  updated_at timestamptz not null default now()
);
alter table akun_kredensial enable row level security;
-- Sengaja TANPA policy: REST API tidak punya jalur baca/tulis.

-- ========== 2. MIGRASI hash lama (jika kolom password_hash masih ada di akun) ==========
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'akun'
               and column_name = 'password_hash') then
    insert into akun_kredensial (nis_nip, password_hash)
    select nis_nip, password_hash from akun
    where nis_nip is not null and password_hash is not null and password_hash <> ''
    on conflict (nis_nip) do update set password_hash = excluded.password_hash;
    alter table akun drop column password_hash;
  end if;
end $$;

-- ========== 3. PULIHKAN PRIVILEGE TABEL AKUN (fix 403 select *) ==========
revoke all on table akun from anon, authenticated;
grant select on akun to anon;
grant select, insert, update, delete on akun to authenticated;

-- ========== 4. RPC MURID (security definer; hash di akun_kredensial) ==========

-- 4a. Verifikasi login murid (NIS + password). Dipanggil anon saat login.
create or replace function cek_login_murid(p_nis text, p_password text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r akun%rowtype;
  v_hash text;
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
    return json_build_object('status', 'success', 'akun', json_build_object(
      'id', r.id,
      'user_id', r.user_id,
      'nama_lengkap', r.nama_lengkap,
      'nis_nip', r.nis_nip,
      'tipe', r.tipe,
      'email', r.email,
      'tingkat_kelas', r.tingkat_kelas,
      'jabatan', r.jabatan
    ));
  end if;
  return json_build_object('status', 'error', 'message', 'Password salah.');
end $$;

-- 4b. Tambah / edit akun murid oleh admin (upsert berdasarkan nis_nip).
create or replace function buat_akun_murid(p_data jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis text;
  v_pass text;
begin
  if coalesce((select tipe from akun where user_id = auth.uid()), '') <> 'admin' then
    return json_build_object('status', 'error', 'message', 'Hanya admin yang boleh mengelola akun murid.');
  end if;

  v_nis := trim(coalesce(p_data->>'nis', ''));
  if v_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;
  if coalesce(trim(coalesce(p_data->>'nama_lengkap', '')), '') = '' then
    return json_build_object('status', 'error', 'message', 'Nama lengkap wajib diisi.');
  end if;

  v_pass := trim(coalesce(p_data->>'password', ''));
  if v_pass <> '' and length(v_pass) < 6 then
    return json_build_object('status', 'error', 'message', 'Password minimal 6 karakter.');
  end if;

  if exists (select 1 from akun where nis_nip = v_nis and tipe = 'murid') then
    -- EDIT: perbarui profil; password hanya bila diisi
    update akun set
      nama_lengkap    = coalesce(nullif(trim(p_data->>'nama_lengkap'), ''), nama_lengkap),
      tingkat_kelas   = coalesce(nullif(trim(p_data->>'tingkat_kelas'), ''), tingkat_kelas),
      jabatan         = coalesce(nullif(trim(p_data->>'jabatan'), ''), jabatan),
      email           = coalesce(nullif(trim(p_data->>'email'), ''), email),
      no_telepon      = coalesce(nullif(trim(p_data->>'no_telepon'), ''), no_telepon),
      ekstrakurikuler = coalesce(nullif(trim(p_data->>'ekstrakurikuler'), ''), ekstrakurikuler)
    where nis_nip = v_nis and tipe = 'murid';

    if v_pass <> '' then
      insert into akun_kredensial (nis_nip, password_hash)
      values (v_nis, crypt(v_pass, gen_salt('bf', 10)))
      on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();
    end if;
    return json_build_object('status', 'success', 'message', 'Data murid diperbarui.', 'aksi', 'update');
  else
    -- TAMBAH: password wajib (kosong → default 123456)
    if v_pass = '' then v_pass := '123456'; end if;
    insert into akun (nama_lengkap, nis_nip, tipe, email, tingkat_kelas, jabatan, no_telepon, ekstrakurikuler)
    values (
      trim(p_data->>'nama_lengkap'), v_nis, 'murid',
      nullif(trim(coalesce(p_data->>'email', '')), ''),
      nullif(trim(coalesce(p_data->>'tingkat_kelas', '')), ''),
      nullif(trim(coalesce(p_data->>'jabatan', '')), ''),
      nullif(trim(coalesce(p_data->>'no_telepon', '')), ''),
      nullif(trim(coalesce(p_data->>'ekstrakurikuler', '')), '')
    );
    insert into akun_kredensial (nis_nip, password_hash)
    values (v_nis, crypt(v_pass, gen_salt('bf', 10)))
    on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();
    return json_build_object('status', 'success', 'message', 'Murid baru tersimpan (password lokal aktif).', 'aksi', 'insert');
  end if;
end $$;

-- 4c. Import massal murid: array [{nis, nama_lengkap, tingkat_kelas, email,
--     no_telepon, ekstrakurikuler, password?}] + password default.
create or replace function import_akun_murid(p_rows jsonb, p_default_password text default '123456')
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  el jsonb;
  v_nis text;
  v_pass text;
  v_ok int := 0; v_upd int := 0; v_fail int := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  if coalesce((select tipe from akun where user_id = auth.uid()), '') <> 'admin' then
    return json_build_object('status', 'error', 'message', 'Hanya admin yang boleh mengelola akun murid.');
  end if;

  for el in select * from jsonb_array_elements(p_rows) loop
    v_nis := trim(coalesce(el->>'nis', ''));
    if v_nis = '' then
      v_fail := v_fail + 1;
      v_errors := v_errors || jsonb_build_array('Baris tanpa NIS dilewati.');
      continue;
    end if;
    v_pass := trim(coalesce(el->>'password', ''));
    if v_pass = '' then v_pass := coalesce(trim(p_default_password), '123456'); end if;
    if length(v_pass) < 6 then v_pass := '123456'; end if;

    begin
      if exists (select 1 from akun where nis_nip = v_nis and tipe = 'murid') then
        update akun set
          nama_lengkap    = coalesce(nullif(trim(el->>'nama_lengkap'), ''), nama_lengkap),
          tingkat_kelas   = coalesce(nullif(trim(el->>'tingkat_kelas'), ''), tingkat_kelas),
          email           = coalesce(nullif(trim(el->>'email'), ''), email),
          no_telepon      = coalesce(nullif(trim(el->>'no_telepon'), ''), no_telepon),
          ekstrakurikuler = coalesce(nullif(trim(el->>'ekstrakurikuler'), ''), ekstrakurikuler)
        where nis_nip = v_nis and tipe = 'murid';
        v_upd := v_upd + 1;
      else
        insert into akun (nama_lengkap, nis_nip, tipe, email, tingkat_kelas, no_telepon, ekstrakurikuler)
        values (
          coalesce(nullif(trim(el->>'nama_lengkap'), ''), 'Tanpa Nama'),
          v_nis, 'murid',
          nullif(trim(coalesce(el->>'email', '')), ''),
          nullif(trim(coalesce(el->>'tingkat_kelas', '')), ''),
          nullif(trim(coalesce(el->>'no_telepon', '')), ''),
          nullif(trim(coalesce(el->>'ekstrakurikuler', '')), '')
        );
        v_ok := v_ok + 1;
      end if;
      insert into akun_kredensial (nis_nip, password_hash)
      values (v_nis, crypt(v_pass, gen_salt('bf', 10)))
      on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();
    exception when others then
      v_fail := v_fail + 1;
      v_errors := v_errors || jsonb_build_array('NIS ' || v_nis || ': ' || SQLERRM);
    end;
  end loop;

  return json_build_object(
    'status', 'success',
    'ditambahkan', v_ok,
    'diperbarui', v_upd,
    'gagal', v_fail,
    'detail_gagal', v_errors
  );
end $$;

-- 4d. Reset password murid oleh admin (default saran: 123456).
create or replace function set_password_murid(p_nis text, p_password text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if coalesce((select tipe from akun where user_id = auth.uid()), '') <> 'admin' then
    return json_build_object('status', 'error', 'message', 'Hanya admin yang boleh mereset password.');
  end if;
  if length(trim(coalesce(p_password, ''))) < 6 then
    return json_build_object('status', 'error', 'message', 'Password minimal 6 karakter.');
  end if;
  if not exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') then
    return json_build_object('status', 'error', 'message', 'NIS tidak ditemukan.');
  end if;
  insert into akun_kredensial (nis_nip, password_hash)
  values (p_nis, crypt(p_password, gen_salt('bf', 10)))
  on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();
  return json_build_object('status', 'success', 'message', 'Password murid direset.');
end $$;

-- ========== 5. IZIN EKSEKUSI RPC ==========
grant execute on function cek_login_murid(text, text) to anon, authenticated;
grant execute on function buat_akun_murid(jsonb) to authenticated;
grant execute on function import_akun_murid(jsonb, text) to authenticated;
grant execute on function set_password_murid(text, text) to authenticated;

-- ========== 6. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [3/84] fix_master_data_insert.sql
-- ============================================================
-- ============================================================
-- FIX INSERT master_data (400 Bad Request) — 2026-09-03
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Penyebab: tabel dibuat manual via Table Editor sehingga bisa saja
-- memiliki (a) kolom id uuid NOT NULL tanpa default, dan/atau
-- (b) kolom legacy NOT NULL tanpa default (mis. keterangan).
-- Insert dari aplikasi hanya mengisi kolom tertentu → pelanggaran
-- NOT NULL → PostgREST membalas 400.
--
-- Isi (semua idempotent, tidak menyentuh data):
--   1) Set default gen_random_uuid() untuk kolom id uuid tanpa default
--      (master_data & akun)
--   2) Drop NOT NULL semua kolom non-PK tanpa default (master_data & akun)
--   3) Reload cache skema PostgREST
-- ============================================================

-- ========== 1. DEFAULT UNTUK KOLOM id UUID ==========
do $$
declare
  r record;
  v_tabel text;
  v_is_identity text;
begin
  foreach v_tabel in array array['master_data', 'akun'] loop
    for r in
      select c.column_name
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = v_tabel
        and c.column_name = 'id'
        and c.is_nullable = 'NO'
        and c.data_type = 'uuid'
        and c.column_default is null
    loop
      -- Lewati jika kolom sudah berupa identity (column_default-nya memang null)
      select a.attidentity::text into v_is_identity
      from pg_attribute a
      where a.attrelid = to_regclass('public.' || v_tabel)
        and a.attname = 'id'
        and a.attnum > 0
        and not a.attisdropped;
      if coalesce(v_is_identity, '') = '' then
        execute format('alter table %I alter column id set default gen_random_uuid();', v_tabel);
        raise notice 'id.% diberi default gen_random_uuid()', v_tabel;
      end if;
    end loop;
  end loop;
end $$;

-- ========== 2. DROP NOT NULL KOLOM NON-PK TANPA DEFAULT ==========
do $$
declare
  r record;
  v_sql text;
begin
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in ('master_data', 'akun')
      and c.is_nullable = 'NO'
      and c.column_default is null
      and not exists (
        select 1 from information_schema.key_column_usage k
        join information_schema.table_constraints t
          on t.constraint_name = k.constraint_name
         and t.constraint_schema = k.constraint_schema
         and t.constraint_type = 'PRIMARY KEY'
        where k.table_schema = c.table_schema
          and k.table_name = c.table_name
          and k.column_name = c.column_name
      )
  loop
    v_sql := format('alter table %I alter column %I drop not null;',
                    r.table_name, r.column_name);
    execute v_sql;
    raise notice 'NOT NULL dilepas: %.%', r.table_name, r.column_name;
  end loop;
end $$;

-- ========== 3. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [4/84] upgrade_20260904_akun.sql
-- ============================================================
-- ============================================================
-- UPGRADE AKUN (GURU & MURID) — 2026-09-04
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) Gelar guru        : gelar_depan, gelar_belakang
--   2) 14 kolom profil murid : nisn, tahun_pelajaran, semester,
--      jenis_kelamin, tgl_lahir, agama, golongan_darah, nama_ayah,
--      pekerjaan_ayah, nama_ibu, pekerjaan_ibu, nama_wali, alamat,
--      catatan_khusus
--   3) RPC buat_akun_murid & import_akun_murid dibuat ulang untuk
--      mendukung kolom baru (pola & aturan sama: password hash di
--      akun_kredensial, hanya admin)
--
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== 1. GELAR GURU ==========
alter table akun
  add column if not exists gelar_depan text,
  add column if not exists gelar_belakang text;

-- ========== 2. KOLOM PROFIL MURID ==========
alter table akun
  add column if not exists nisn text,
  add column if not exists tahun_pelajaran text,
  add column if not exists semester text,
  add column if not exists jenis_kelamin text,
  add column if not exists tgl_lahir date,
  add column if not exists agama text,
  add column if not exists golongan_darah text,
  add column if not exists nama_ayah text,
  add column if not exists pekerjaan_ayah text,
  add column if not exists nama_ibu text,
  add column if not exists pekerjaan_ibu text,
  add column if not exists nama_wali text,
  add column if not exists alamat text,
  add column if not exists catatan_khusus text;

-- ========== 3a. RPC: TAMBAH / EDIT AKUN MURID (dengan kolom baru) ==========
create or replace function buat_akun_murid(p_data jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis text;
  v_pass text;
  v_lahir date;
begin
  if coalesce((select tipe from akun where user_id = auth.uid()), '') <> 'admin' then
    return json_build_object('status', 'error', 'message', 'Hanya admin yang boleh mengelola akun murid.');
  end if;

  v_nis := trim(coalesce(p_data->>'nis', ''));
  if v_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;
  if coalesce(trim(coalesce(p_data->>'nama_lengkap', '')), '') = '' then
    return json_build_object('status', 'error', 'message', 'Nama lengkap wajib diisi.');
  end if;

  v_pass := trim(coalesce(p_data->>'password', ''));
  if v_pass <> '' and length(v_pass) < 6 then
    return json_build_object('status', 'error', 'message', 'Password minimal 6 karakter.');
  end if;

  v_lahir := nullif(trim(coalesce(p_data->>'tgl_lahir', '')), '')::date;

  if exists (select 1 from akun where nis_nip = v_nis and tipe = 'murid') then
    -- EDIT: perbarui profil; password hanya bila diisi
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
    -- TAMBAH: password wajib (kosong → default 123456)
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

-- ========== 3b. RPC: IMPORT MASSAL MURID (dengan kolom baru) ==========
create or replace function import_akun_murid(p_rows jsonb, p_default_password text default '123456')
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  el jsonb;
  v_nis text;
  v_pass text;
  v_lahir date;
  v_ok int := 0; v_upd int := 0; v_fail int := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  if coalesce((select tipe from akun where user_id = auth.uid()), '') <> 'admin' then
    return json_build_object('status', 'error', 'message', 'Hanya admin yang boleh mengelola akun murid.');
  end if;

  for el in select * from jsonb_array_elements(p_rows) loop
    v_nis := trim(coalesce(el->>'nis', ''));
    if v_nis = '' then
      v_fail := v_fail + 1;
      v_errors := v_errors || jsonb_build_array('Baris tanpa NIS dilewati.');
      continue;
    end if;
    v_pass := trim(coalesce(el->>'password', ''));
    if v_pass = '' then v_pass := coalesce(trim(p_default_password), '123456'); end if;
    if length(v_pass) < 6 then v_pass := '123456'; end if;

    begin
      v_lahir := nullif(trim(coalesce(el->>'tgl_lahir', '')), '')::date;
      if exists (select 1 from akun where nis_nip = v_nis and tipe = 'murid') then
        update akun set
          nama_lengkap     = coalesce(nullif(trim(el->>'nama_lengkap'), ''), nama_lengkap),
          nisn             = coalesce(nullif(trim(el->>'nisn'), ''), nisn),
          tahun_pelajaran  = coalesce(nullif(trim(el->>'tahun_pelajaran'), ''), tahun_pelajaran),
          semester         = coalesce(nullif(trim(el->>'semester'), ''), semester),
          jenis_kelamin    = coalesce(nullif(trim(el->>'jenis_kelamin'), ''), jenis_kelamin),
          tgl_lahir        = coalesce(v_lahir, tgl_lahir),
          agama            = coalesce(nullif(trim(el->>'agama'), ''), agama),
          golongan_darah   = coalesce(nullif(trim(el->>'golongan_darah'), ''), golongan_darah),
          tingkat_kelas    = coalesce(nullif(trim(el->>'tingkat_kelas'), ''), tingkat_kelas),
          jabatan          = coalesce(nullif(trim(el->>'jabatan'), ''), jabatan),
          email            = coalesce(nullif(trim(el->>'email'), ''), email),
          no_telepon       = coalesce(nullif(trim(el->>'no_telepon'), ''), no_telepon),
          ekstrakurikuler  = coalesce(nullif(trim(el->>'ekstrakurikuler'), ''), ekstrakurikuler),
          nama_ayah        = coalesce(nullif(trim(el->>'nama_ayah'), ''), nama_ayah),
          pekerjaan_ayah   = coalesce(nullif(trim(el->>'pekerjaan_ayah'), ''), pekerjaan_ayah),
          nama_ibu         = coalesce(nullif(trim(el->>'nama_ibu'), ''), nama_ibu),
          pekerjaan_ibu    = coalesce(nullif(trim(el->>'pekerjaan_ibu'), ''), pekerjaan_ibu),
          nama_wali        = coalesce(nullif(trim(el->>'nama_wali'), ''), nama_wali),
          alamat           = coalesce(nullif(trim(el->>'alamat'), ''), alamat),
          catatan_khusus   = coalesce(nullif(trim(el->>'catatan_khusus'), ''), catatan_khusus)
        where nis_nip = v_nis and tipe = 'murid';
        v_upd := v_upd + 1;
      else
        insert into akun (
          nama_lengkap, nis_nip, tipe, nisn, tahun_pelajaran, semester,
          jenis_kelamin, tgl_lahir, agama, golongan_darah,
          email, tingkat_kelas, jabatan, no_telepon, ekstrakurikuler,
          nama_ayah, pekerjaan_ayah, nama_ibu, pekerjaan_ibu, nama_wali,
          alamat, catatan_khusus
        ) values (
          coalesce(nullif(trim(el->>'nama_lengkap'), ''), 'Tanpa Nama'),
          v_nis, 'murid',
          nullif(trim(coalesce(el->>'nisn', '')), ''),
          nullif(trim(coalesce(el->>'tahun_pelajaran', '')), ''),
          nullif(trim(coalesce(el->>'semester', '')), ''),
          nullif(trim(coalesce(el->>'jenis_kelamin', '')), ''),
          v_lahir,
          nullif(trim(coalesce(el->>'agama', '')), ''),
          nullif(trim(coalesce(el->>'golongan_darah', '')), ''),
          nullif(trim(coalesce(el->>'email', '')), ''),
          nullif(trim(coalesce(el->>'tingkat_kelas', '')), ''),
          nullif(trim(coalesce(el->>'jabatan', '')), ''),
          nullif(trim(coalesce(el->>'no_telepon', '')), ''),
          nullif(trim(coalesce(el->>'ekstrakurikuler', '')), ''),
          nullif(trim(coalesce(el->>'nama_ayah', '')), ''),
          nullif(trim(coalesce(el->>'pekerjaan_ayah', '')), ''),
          nullif(trim(coalesce(el->>'nama_ibu', '')), ''),
          nullif(trim(coalesce(el->>'pekerjaan_ibu', '')), ''),
          nullif(trim(coalesce(el->>'nama_wali', '')), ''),
          nullif(trim(coalesce(el->>'alamat', '')), ''),
          nullif(trim(coalesce(el->>'catatan_khusus', '')), '')
        );
        v_ok := v_ok + 1;
      end if;
      insert into akun_kredensial (nis_nip, password_hash)
      values (v_nis, crypt(v_pass, gen_salt('bf', 10)))
      on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();
    exception when others then
      v_fail := v_fail + 1;
      v_errors := v_errors || jsonb_build_array('NIS ' || v_nis || ': ' || SQLERRM);
    end;
  end loop;

  return json_build_object(
    'status', 'success',
    'ditambahkan', v_ok,
    'diperbarui', v_upd,
    'gagal', v_fail,
    'detail_gagal', v_errors
  );
end $$;

-- ========== 4. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [5/84] upgrade_20260904_master_data_tambahan.sql
-- ============================================================
-- ============================================================
-- UPGRADE MASTER_DATA — 2026-09-04
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) 12 kolom daftar baru : Status Kehadiran, Jam Pelajaran per hari
--      (Senin-Sabtu), Jurusan, Kategori Nilai, Agama, Jadwal Ujian,
--      Kegiatan
--   2) 6 kolom identitas baru : NPSN, Kepala Sekolah, Telepon Sekolah,
--      Email Sekolah, Website Sekolah, Kurikulum
--
-- Semua idempotent — aman dijalankan berulang.
-- RLS tidak perlu diubah (policy berlaku di level tabel).
-- ============================================================

-- ========== 1. KOLOM DAFTAR BARU ==========
alter table master_data
  add column if not exists "Status Kehadiran" text,
  add column if not exists "Jam Pelajaran Senin" text,
  add column if not exists "Jam Pelajaran Selasa" text,
  add column if not exists "Jam Pelajaran Rabu" text,
  add column if not exists "Jam Pelajaran Kamis" text,
  add column if not exists "Jam Pelajaran Jumat" text,
  add column if not exists "Jam Pelajaran Sabtu" text,
  add column if not exists "Jurusan" text,
  add column if not exists "Kategori Nilai" text,
  add column if not exists "Agama" text,
  add column if not exists "Jadwal Ujian" text,
  add column if not exists "Kegiatan" text;

-- ========== 2. KOLOM IDENTITAS BARU ==========
alter table master_data
  add column if not exists "NPSN" text,
  add column if not exists "Kepala Sekolah" text,
  add column if not exists "Telepon Sekolah" text,
  add column if not exists "Email Sekolah" text,
  add column if not exists "Website Sekolah" text,
  add column if not exists "Kurikulum" text;

-- ========== 3. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [6/84] upgrade_20260904_absensi.sql
-- ============================================================
-- ============================================================
-- UPGRADE ABSENSI — 2026-09-04
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) Recreate tabel absensi (kolom lengkap + unique anti-duplikat)
--      CATATAN: tabel lama KOSONG, jadi tidak ada data yang hilang.
--   2) Kolom kunci absen guru di tabel akun (captcha, kunci_absen)
--   3) RLS + privilege
--
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. RECREATE TABEL ABSENSI ==========
drop table if exists absensi;
create table absensi (
  id uuid primary key default gen_random_uuid(),
  nis text not null,
  nama text,
  tanggal date not null,
  status text not null check (status in ('H','S','I','A')),
  keterangan text default '',
  mapel text default '',
  ekskul text default '',
  kelas text default '',
  tahun text,
  semester text,
  bulan text,
  id_guru text,
  metode text default 'Manual / QR',
  created_at timestamptz not null default now(),
  unique (nis, tanggal, mapel)
);
create index if not exists idx_absensi_nis_tanggal on absensi (nis, tanggal);
create index if not exists idx_absensi_kelas_mapel on absensi (kelas, mapel);

-- ========== 2. KUNCI ABSEN GURU (CAPTCHA) ==========
alter table akun
  add column if not exists captcha text default '1234',
  add column if not exists kunci_absen text default 'TUTUP';

-- ========== 3. RLS & PRIVILEGE ==========
-- absensi: murid lokal memakai anon key (pseudo-token), jadi select/insert/
-- update dibuka untuk anon + authenticated (posture sama dengan tabel lama).
alter table absensi enable row level security;

drop policy if exists "absensi_baca_semua" on absensi;
create policy "absensi_baca_semua" on absensi
  for select using (true);

drop policy if exists "absensi_tulis_semua" on absensi;
create policy "absensi_tulis_semua" on absensi
  for insert with check (true);

drop policy if exists "absensi_ubah_semua" on absensi;
create policy "absensi_ubah_semua" on absensi
  for update using (true) with check (true);

revoke all on table absensi from anon, authenticated;
grant select, insert, update, delete on absensi to anon, authenticated;

-- akun: pastikan kolom kunci bisa dibaca & diubah user terkait
grant select, update on akun to authenticated;

-- ========== 4. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [7/84] upgrade_20260904_absensi_d.sql
-- ============================================================
-- ============================================================
-- UPGRADE ABSENSI: STATUS D (DISPEN) — 2026-09-04
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi: ganti check constraint kolom status agar menerima 'D' (Dispen).
-- Idempotent — aman dijalankan berulang. Data tidak tersentuh.
-- ============================================================

alter table absensi drop constraint if exists absensi_status_check;
alter table absensi
  add constraint absensi_status_check
  check (status in ('H','S','I','A','D'));

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [8/84] upgrade_20260904_jurnal.sql
-- ============================================================
-- ============================================================
-- UPGRADE: JURNAL HARIAN GURU — 2026-09-04
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi: tabel jurnal_guru (agenda mengajar per pertemuan).
--
-- unique (nis_guru, kelas, mapel, tahun, pertemuan):
--   - Pertemuan otomatis melanjutkan, tetap bisa diedit tanpa duplikat.
-- RLS: guru/admin (authenticated) boleh baca/tulis.
-- Idempotent — aman dijalankan berulang.
-- ============================================================

create table if not exists jurnal_guru (
  id uuid primary key default gen_random_uuid(),
  nis_guru text not null,
  tanggal date not null,
  kelas text not null,
  mapel text not null,
  pertemuan int not null default 1,
  tahun text,
  semester text,
  bulan text,
  kompetensi_dasar text default '',
  materi text default '',
  kegiatan_kbm text default '',
  permasalahan text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (nis_guru, kelas, mapel, tahun, pertemuan)
);
create index if not exists idx_jurnal_guru_pertemuan
  on jurnal_guru (nis_guru, kelas, mapel, tahun);

alter table jurnal_guru enable row level security;

drop policy if exists "jurnal_baca_auth" on jurnal_guru;
create policy "jurnal_baca_auth" on jurnal_guru
  for select to authenticated using (true);

drop policy if exists "jurnal_tulis_auth" on jurnal_guru;
create policy "jurnal_tulis_auth" on jurnal_guru
  for insert to authenticated with check (true);

drop policy if exists "jurnal_ubah_auth" on jurnal_guru;
create policy "jurnal_ubah_auth" on jurnal_guru
  for update to authenticated using (true) with check (true);

revoke all on table jurnal_guru from anon, authenticated;
grant select, insert, update, delete on jurnal_guru to authenticated;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [9/84] upgrade_20260904_nilai.sql
-- ============================================================
-- ============================================================
-- UPGRADE INPUT NILAI — 2026-09-04
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) Recreate tabel nilai (JSONB per siswa per kategori per mapel)
--      CATATAN: tabel lama KOSONG, tidak ada data yang hilang.
--      Kolom dinamis (KD A 1, Prak A 1, Projek A, KET, dst.) disimpan
--      di kolom `data` (JSONB) — mengikuti konfigurasi tiap kategori.
--   2) Tabel nilai_konfigurasi (konfigurasi KD/bobot per kategori+mapel)
--   3) RLS + privilege (guru/admin = authenticated)
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. RECREATE TABEL NILAI ==========
drop table if exists nilai;
create table nilai (
  id uuid primary key default gen_random_uuid(),
  nis text not null,
  nama text default '',
  kategori text not null,
  mapel text not null default '',
  ekskul text not null default '',
  kelas text default '',
  tahun text default '',
  semester text default '',
  id_guru text default '',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (nis, kategori, mapel, ekskul, tahun, semester)
);
create index if not exists idx_nilai_filter
  on nilai (kategori, mapel, kelas, tahun, semester);

-- ========== 2. TABEL KONFIGURASI NILAI ==========
create table if not exists nilai_konfigurasi (
  id uuid primary key default gen_random_uuid(),
  kategori text not null,
  mapel text not null default '',
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (kategori, mapel)
);

-- ========== 3. RLS & PRIVILEGE ==========
alter table nilai enable row level security;

drop policy if exists "nilai_baca_auth" on nilai;
create policy "nilai_baca_auth" on nilai
  for select to authenticated using (true);

drop policy if exists "nilai_tulis_auth" on nilai;
create policy "nilai_tulis_auth" on nilai
  for insert to authenticated with check (true);

drop policy if exists "nilai_ubah_auth" on nilai;
create policy "nilai_ubah_auth" on nilai
  for update to authenticated using (true) with check (true);

alter table nilai_konfigurasi enable row level security;

drop policy if exists "nilaikfg_baca_auth" on nilai_konfigurasi;
create policy "nilaikfg_baca_auth" on nilai_konfigurasi
  for select to authenticated using (true);

drop policy if exists "nilaikfg_tulis_auth" on nilai_konfigurasi;
create policy "nilaikfg_tulis_auth" on nilai_konfigurasi
  for insert to authenticated with check (true);

drop policy if exists "nilaikfg_ubah_auth" on nilai_konfigurasi;
create policy "nilaikfg_ubah_auth" on nilai_konfigurasi
  for update to authenticated using (true) with check (true);

revoke all on table nilai from anon, authenticated;
grant select, insert, update, delete on nilai to authenticated;
revoke all on table nilai_konfigurasi from anon, authenticated;
grant select, insert, update, delete on nilai_konfigurasi to authenticated;

-- ========== 4. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [10/84] upgrade_20260904_ekskul.sql
-- ============================================================
-- ============================================================
-- UPGRADE EKSTRAKURIKULER — 2026-09-04
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) Tabel ekstrakurikuler: tambah pembina_nip & jadwal
--   2) Tabel agenda_ekskul (agenda kegiatan per ekskul)
--   3) Tabel dispensasi (riwayat surat dispensasi)
--   4) RLS & privilege (guru/admin = authenticated)
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. TABEL EKSTRAKURIKULER ==========
alter table ekstrakurikuler
  add column if not exists pembina_nip text default '',
  add column if not exists jadwal text default '';

alter table ekstrakurikuler enable row level security;

drop policy if exists "ekskul_baca_auth" on ekstrakurikuler;
create policy "ekskul_baca_auth" on ekstrakurikuler
  for select to authenticated using (true);

drop policy if exists "ekskul_baca_anon" on ekstrakurikuler;
create policy "ekskul_baca_anon" on ekstrakurikuler
  for select to anon using (true);

drop policy if exists "ekskul_tulis_auth" on ekstrakurikuler;
create policy "ekskul_tulis_auth" on ekstrakurikuler
  for insert to authenticated with check (true);

drop policy if exists "ekskul_ubah_auth" on ekstrakurikuler;
create policy "ekskul_ubah_auth" on ekstrakurikuler
  for update to authenticated using (true) with check (true);

drop policy if exists "ekskul_hapus_auth" on ekstrakurikuler;
create policy "ekskul_hapus_auth" on ekstrakurikuler
  for delete to authenticated using (true);

revoke all on table ekstrakurikuler from anon, authenticated;
grant select on ekstrakurikuler to anon, authenticated;
grant insert, update, delete on ekstrakurikuler to authenticated;

-- ========== 2. AGENDA KEGIATAN EKSKUL ==========
create table if not exists agenda_ekskul (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  tanggal date not null,
  kegiatan text not null,
  keterangan text default '',
  dibuat_oleh text default '',
  created_at timestamptz not null default now(),
  unique (ekskul, tanggal, kegiatan)
);
create index if not exists idx_agenda_ekskul on agenda_ekskul (ekskul, tanggal);

alter table agenda_ekskul enable row level security;

drop policy if exists "agenda_baca_auth" on agenda_ekskul;
create policy "agenda_baca_auth" on agenda_ekskul
  for select to authenticated using (true);

drop policy if exists "agenda_tulis_auth" on agenda_ekskul;
create policy "agenda_tulis_auth" on agenda_ekskul
  for insert to authenticated with check (true);

drop policy if exists "agenda_ubah_auth" on agenda_ekskul;
create policy "agenda_ubah_auth" on agenda_ekskul
  for update to authenticated using (true) with check (true);

drop policy if exists "agenda_hapus_auth" on agenda_ekskul;
create policy "agenda_hapus_auth" on agenda_ekskul
  for delete to authenticated using (true);

revoke all on table agenda_ekskul from anon, authenticated;
grant select, insert, update, delete on agenda_ekskul to authenticated;

-- ========== 3. RIWAYAT SURAT DISPENSASI ==========
create table if not exists dispensasi (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  nis text not null,
  nama text default '',
  kelas text default '',
  tanggal_izin date not null,
  alasan text default '',
  dibuat_oleh text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_dispensasi_ekskul on dispensasi (ekskul, tanggal_izin);

alter table dispensasi enable row level security;

drop policy if exists "dispensasi_baca_auth" on dispensasi;
create policy "dispensasi_baca_auth" on dispensasi
  for select to authenticated using (true);

drop policy if exists "dispensasi_tulis_auth" on dispensasi;
create policy "dispensasi_tulis_auth" on dispensasi
  for insert to authenticated with check (true);

drop policy if exists "dispensasi_hapus_auth" on dispensasi;
create policy "dispensasi_hapus_auth" on dispensasi
  for delete to authenticated using (true);

revoke all on table dispensasi from anon, authenticated;
grant select, insert, delete on dispensasi to authenticated;

-- ========== 4. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [11/84] upgrade_20260905_ekskul_pengurus.sql
-- ============================================================
-- ============================================================
-- UPGRADE EKSTRAKURIKULER (LANJUTAN) — 2026-09-05
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) agenda_ekskul: kolom "hari" untuk jadwal berulang
--      (Setiap Hari Senin-Minggu); tanggal boleh NULL
--   2) Akses pengurus ekskul (murid): murid password lokal memakai
--      anon key (pola sama dengan tabel absensi), sehingga:
--      - agenda_ekskul  : select/insert/update untuk anon
--      - dispensasi     : select/insert untuk anon
--      - akun           : update kolom "ekstrakurikuler" saja (kolom-level)
--
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== 1. KOLOM HARI AGENDA ==========
alter table agenda_ekskul
  add column if not exists hari text default '';

alter table agenda_ekskul alter column tanggal drop not null;

-- ========== 2. GRANT & POLICY ANON (PENGURUS EKSKUL) ==========
-- agenda_ekskul
revoke all on table agenda_ekskul from anon;
grant select, insert, update on agenda_ekskul to anon;

drop policy if exists "agenda_baca_anon" on agenda_ekskul;
create policy "agenda_baca_anon" on agenda_ekskul
  for select to anon using (true);

drop policy if exists "agenda_tulis_anon" on agenda_ekskul;
create policy "agenda_tulis_anon" on agenda_ekskul
  for insert to anon with check (true);

drop policy if exists "agenda_ubah_anon" on agenda_ekskul;
create policy "agenda_ubah_anon" on agenda_ekskul
  for update to anon using (true) with check (true);

-- dispensasi
revoke all on table dispensasi from anon;
grant select, insert on dispensasi to anon;

drop policy if exists "dispensasi_baca_anon" on dispensasi;
create policy "dispensasi_baca_anon" on dispensasi
  for select to anon using (true);

drop policy if exists "dispensasi_tulis_anon" on dispensasi;
create policy "dispensasi_tulis_anon" on dispensasi
  for insert to anon with check (true);

-- akun: anon hanya boleh mengubah kolom keanggotaan ekskul (kolom-level)
grant update (ekstrakurikuler) on akun to anon;

-- ========== 3. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [12/84] upgrade_20260906_sikap_teman.sql
-- ============================================================
-- ============================================================
-- UPGRADE SIKAP — TEMAN SEJAWAT & JURNAL PENILAIAN SIKAP — 2026-09-06
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) Tabel nilai_teman_sejawat (rating 1-4 per PENILAI per TARGET;
--      satu baris = satu penilai menilai satu teman)
--   2) Tabel jurnal_sikap (jurnal guru: hari/tanggal, kejadian,
--      aspek sikap, tindak lanjut — per kelas+mapel+tahun+semester)
--   3) RLS + privilege (guru/admin = authenticated)
--   4) RPC murid (security definer, bisa dipanggil anon — murid password
--      lokal tidak punya sesi Auth Supabase):
--      - sesi_teman_terbuka(): daftar mapel dengan sesi penilaian BUKA
--      - ambil_teman_sekelas(): teman sekelas + rating milik penilai
--      - simpan_penilaian_teman(): upsert rating (validasi sesi buka,
--        target sekelas, skor 1-4; tahun/semester dipaksa dari sesi guru)
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. TABEL TEMAN SEJAWAT ==========
create table if not exists nilai_teman_sejawat (
  id uuid primary key default gen_random_uuid(),
  penilai_nis text not null,
  target_nis text not null,
  kelas text default '',
  mapel text default '',
  tahun text default '',
  semester text default '',
  skor int not null check (skor between 1 and 4),
  id_guru text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (penilai_nis, target_nis, mapel, tahun, semester)
);
create index if not exists idx_nsts_target
  on nilai_teman_sejawat (target_nis, mapel, kelas, tahun, semester);
create index if not exists idx_nsts_penilai
  on nilai_teman_sejawat (penilai_nis, mapel, tahun, semester);

-- ========== 2. TABEL JURNAL SIKAP ==========
create table if not exists jurnal_sikap (
  id uuid primary key default gen_random_uuid(),
  kelas text default '',
  mapel text default '',
  tahun text default '',
  semester text default '',
  hari_tanggal text default '',
  kejadian text default '',
  aspek_sikap text default '',
  tindak_lanjut text default '',
  id_guru text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_jurnal_sikap_scope
  on jurnal_sikap (kelas, mapel, tahun, semester);

-- ========== 3. RLS & PRIVILEGE ==========
alter table nilai_teman_sejawat enable row level security;

drop policy if exists "nsts_baca_auth" on nilai_teman_sejawat;
create policy "nsts_baca_auth" on nilai_teman_sejawat
  for select to authenticated using (true);

drop policy if exists "nsts_tulis_auth" on nilai_teman_sejawat;
create policy "nsts_tulis_auth" on nilai_teman_sejawat
  for insert to authenticated with check (true);

drop policy if exists "nsts_ubah_auth" on nilai_teman_sejawat;
create policy "nsts_ubah_auth" on nilai_teman_sejawat
  for update to authenticated using (true) with check (true);

drop policy if exists "nsts_hapus_auth" on nilai_teman_sejawat;
create policy "nsts_hapus_auth" on nilai_teman_sejawat
  for delete to authenticated using (true);

alter table jurnal_sikap enable row level security;

drop policy if exists "jurnalsikap_baca_auth" on jurnal_sikap;
create policy "jurnalsikap_baca_auth" on jurnal_sikap
  for select to authenticated using (true);

drop policy if exists "jurnalsikap_tulis_auth" on jurnal_sikap;
create policy "jurnalsikap_tulis_auth" on jurnal_sikap
  for insert to authenticated with check (true);

drop policy if exists "jurnalsikap_ubah_auth" on jurnal_sikap;
create policy "jurnalsikap_ubah_auth" on jurnal_sikap
  for update to authenticated using (true) with check (true);

drop policy if exists "jurnalsikap_hapus_auth" on jurnal_sikap;
create policy "jurnalsikap_hapus_auth" on jurnal_sikap
  for delete to authenticated using (true);

revoke all on table nilai_teman_sejawat from anon, authenticated;
grant select, insert, update, delete on nilai_teman_sejawat to authenticated;
revoke all on table jurnal_sikap from anon, authenticated;
grant select, insert, update, delete on jurnal_sikap to authenticated;

-- ========== 4. RPC MURID (security definer) ==========
-- 4a. Daftar sesi penilaian teman yang sedang BUKA (per mapel Sikap).
create or replace function sesi_teman_terbuka()
returns json
language sql
security definer
set search_path = public, extensions
as $$
  select coalesce(json_agg(json_build_object(
    'mapel', k.mapel,
    'judul', k.config->'sikap_teman'->>'judul',
    'keterangan', k.config->'sikap_teman'->>'keterangan',
    'jumlah_teman', coalesce((k.config->'sikap_teman'->>'jumlah_teman')::int, 5),
    'tahun', coalesce(k.config->'sikap_teman'->>'sesi_tahun', ''),
    'semester', coalesce(k.config->'sikap_teman'->>'sesi_semester', '')
  ) order by k.mapel), '[]'::json)
  from nilai_konfigurasi k
  where k.kategori = 'Data Nilai Sikap'
    and coalesce((k.config->'sikap_teman'->>'sesi_buka')::boolean, false);
$$;

-- 4b. Teman sekelas + rating milik penilai (untuk mapel dengan sesi terbuka).
create or replace function ambil_teman_sekelas(p_nis text, p_mapel text default '')
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_penilai akun%rowtype;
  v_cfg jsonb;
begin
  select * into v_penilai from akun where nis_nip = p_nis and tipe = 'murid' limit 1;
  if v_penilai.id is null then
    return json_build_object('status', 'error', 'message', 'NIS penilai tidak terdaftar.');
  end if;

  select config into v_cfg from nilai_konfigurasi
    where kategori = 'Data Nilai Sikap'
      and mapel = coalesce(nullif(trim(p_mapel), ''), '')
    limit 1;

  return json_build_object(
    'status', 'success',
    'kelas', v_penilai.tingkat_kelas,
    'sesi_buka', coalesce((v_cfg->'sikap_teman'->>'sesi_buka')::boolean, false),
    'judul', coalesce(v_cfg->'sikap_teman'->>'judul', 'Berilah nilai untuk 5 teman'),
    'keterangan', coalesce(v_cfg->'sikap_teman'->>'keterangan', ''),
    'jumlah_teman', coalesce((v_cfg->'sikap_teman'->>'jumlah_teman')::int, 5),
    'kriteria', coalesce(v_cfg->'sikap_teman'->'kriteria', '{}'::jsonb),
    'tahun', coalesce(v_cfg->'sikap_teman'->>'sesi_tahun', ''),
    'semester', coalesce(v_cfg->'sikap_teman'->>'sesi_semester', ''),
    'teman', (
      select coalesce(json_agg(json_build_object(
        'nis', a.nis_nip, 'nama', a.nama_lengkap
      ) order by a.nama_lengkap), '[]'::json)
      from akun a
      where a.tipe = 'murid'
        and a.tingkat_kelas = v_penilai.tingkat_kelas
        and a.nis_nip <> p_nis
    ),
    'rating_saya', (
      select coalesce(json_object_agg(t.target_nis, t.skor), '{}'::json)
      from nilai_teman_sejawat t
      where t.penilai_nis = p_nis
        and t.mapel = coalesce(nullif(trim(p_mapel), ''), '')
        and t.tahun = coalesce(v_cfg->'sikap_teman'->>'sesi_tahun', '')
        and t.semester = coalesce(v_cfg->'sikap_teman'->>'sesi_semester', '')
    )
  );
end $$;

-- 4c. Simpan rating murid (upsert idempoten — dapat mengoreksi selama sesi buka).
--     Tahun/semester DIPAKSA dari sesi guru di config (murid tidak menentukan).
create or replace function simpan_penilaian_teman(
  p_penilai_nis text,
  p_mapel text default '',
  p_rows jsonb default '[]'::jsonb
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_penilai akun%rowtype;
  v_cfg jsonb;
  v_buka boolean;
  v_tahun text;
  v_semester text;
  el jsonb;
  v_target text;
  v_skor int;
  v_ok int := 0;
  v_fail int := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  select * into v_penilai from akun where nis_nip = p_penilai_nis and tipe = 'murid' limit 1;
  if v_penilai.id is null then
    return json_build_object('status', 'error', 'message', 'NIS penilai tidak terdaftar.');
  end if;

  -- Sesi harus dibuka guru pada konfigurasi kategori Sikap mapel terkait
  select config into v_cfg from nilai_konfigurasi
    where kategori = 'Data Nilai Sikap'
      and mapel = coalesce(nullif(trim(p_mapel), ''), '')
    limit 1;
  v_buka := coalesce((v_cfg->'sikap_teman'->>'sesi_buka')::boolean, false);
  if not v_buka then
    return json_build_object('status', 'error', 'message', 'Sesi penilaian teman sejawat belum dibuka guru.');
  end if;
  v_tahun := coalesce(v_cfg->'sikap_teman'->>'sesi_tahun', '');
  v_semester := coalesce(v_cfg->'sikap_teman'->>'sesi_semester', '');

  if jsonb_typeof(p_rows) <> 'array' then
    return json_build_object('status', 'error', 'message', 'Format data tidak valid.');
  end if;

  for el in select * from jsonb_array_elements(p_rows) loop
    v_target := trim(coalesce(el->>'nis', ''));
    v_skor := nullif(el->>'skor', '')::int;
    begin
      if v_target = '' or v_target = p_penilai_nis then
        v_fail := v_fail + 1;
        v_errors := v_errors || jsonb_build_array('Target tidak valid / menilai diri sendiri.');
        continue;
      end if;
      if v_skor is null or v_skor < 1 or v_skor > 4 then
        v_fail := v_fail + 1;
        v_errors := v_errors || jsonb_build_array('Skor harus angka 1-4.');
        continue;
      end if;
      -- Target wajib murid sekelas dengan penilai
      if not exists (
        select 1 from akun a
        where a.nis_nip = v_target
          and a.tipe = 'murid'
          and a.tingkat_kelas = v_penilai.tingkat_kelas
      ) then
        v_fail := v_fail + 1;
        v_errors := v_errors || jsonb_build_array('Target bukan teman sekelas: ' || v_target);
        continue;
      end if;

      insert into nilai_teman_sejawat
        (penilai_nis, target_nis, kelas, mapel, tahun, semester, skor)
      values
        (p_penilai_nis, v_target, v_penilai.tingkat_kelas,
         coalesce(nullif(trim(p_mapel), ''), ''), v_tahun, v_semester, v_skor)
      on conflict (penilai_nis, target_nis, mapel, tahun, semester)
      do update set skor = excluded.skor, updated_at = now();
      v_ok := v_ok + 1;
    exception when others then
      v_fail := v_fail + 1;
      v_errors := v_errors || jsonb_build_array('Gagal simpan untuk ' || v_target || ': ' || SQLERRM);
    end;
  end loop;

  return json_build_object(
    'status', 'success',
    'tersimpan', v_ok,
    'gagal', v_fail,
    'detail_gagal', v_errors
  );
end $$;

grant execute on function sesi_teman_terbuka() to anon, authenticated;
grant execute on function ambil_teman_sekelas(text, text) to anon, authenticated;
grant execute on function simpan_penilaian_teman(text, text, jsonb) to anon, authenticated;

-- ========== 5. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [13/84] upgrade_20260906_ekskul_surat.sql
-- ============================================================
-- ============================================================
-- UPGRADE EKSTRAKURIKULER — SURAT DISPENSASI & SUB-EKSKUL — 2026-09-06
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) ekstrakurikuler: kolom logo_url
--   2) dispensasi: kolom sub_ekskul, keterangan, detail (jsonb), surat_id
--   3) Tabel sub_ekstrakurikuler (daftar sub per ekskul)
--   4) Tabel anggota_sub_ekskul (penandaan sub per anggota)
--   5) Tabel preset_dispensasi (preset surat per ekskul / global)
--   6) RLS & privilege (guru/admin/pengurus; anon = murid password lokal)
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. LOGO EKSKUL ==========
alter table ekstrakurikuler
  add column if not exists logo_url text default '';

-- ========== 2. TAMBAHAN KOLOM DISPENSASI ==========
alter table dispensasi
  add column if not exists sub_ekskul text default '',
  add column if not exists keterangan text default '',
  add column if not exists detail jsonb default '{}'::jsonb,
  add column if not exists surat_id text default '';
create index if not exists idx_dispensasi_surat on dispensasi (surat_id);

-- ========== 3. SUB-EKSTRAKURIKULER ==========
create table if not exists sub_ekstrakurikuler (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  nama_sub text not null,
  urutan int default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ekskul, nama_sub)
);
create index if not exists idx_sub_ekskul on sub_ekstrakurikuler (ekskul);

alter table sub_ekstrakurikuler enable row level security;

drop policy if exists "subekskul_baca_auth" on sub_ekstrakurikuler;
create policy "subekskul_baca_auth" on sub_ekstrakurikuler
  for select to authenticated using (true);
drop policy if exists "subekskul_tulis_auth" on sub_ekstrakurikuler;
create policy "subekskul_tulis_auth" on sub_ekstrakurikuler
  for insert to authenticated with check (true);
drop policy if exists "subekskul_ubah_auth" on sub_ekstrakurikuler;
create policy "subekskul_ubah_auth" on sub_ekstrakurikuler
  for update to authenticated using (true) with check (true);
drop policy if exists "subekskul_hapus_auth" on sub_ekstrakurikuler;
create policy "subekskul_hapus_auth" on sub_ekstrakurikuler
  for delete to authenticated using (true);
drop policy if exists "subekskul_baca_anon" on sub_ekstrakurikuler;
create policy "subekskul_baca_anon" on sub_ekstrakurikuler
  for select to anon using (true);

revoke all on table sub_ekstrakurikuler from anon, authenticated;
grant select on sub_ekstrakurikuler to anon, authenticated;
grant insert, update, delete on sub_ekstrakurikuler to authenticated;

-- ========== 4. KEANGGOTAAN SUB-EKSKUL ==========
create table if not exists anggota_sub_ekskul (
  id uuid primary key default gen_random_uuid(),
  nis text not null,
  ekskul text not null,
  sub text default '',
  updated_at timestamptz not null default now(),
  unique (nis, ekskul)
);
create index if not exists idx_anggota_sub on anggota_sub_ekskul (ekskul, sub);

alter table anggota_sub_ekskul enable row level security;

drop policy if exists "angsub_baca_auth" on anggota_sub_ekskul;
create policy "angsub_baca_auth" on anggota_sub_ekskul
  for select to authenticated using (true);
drop policy if exists "angsub_tulis_auth" on anggota_sub_ekskul;
create policy "angsub_tulis_auth" on anggota_sub_ekskul
  for insert to authenticated with check (true);
drop policy if exists "angsub_ubah_auth" on anggota_sub_ekskul;
create policy "angsub_ubah_auth" on anggota_sub_ekskul
  for update to authenticated using (true) with check (true);
drop policy if exists "angsub_hapus_auth" on anggota_sub_ekskul;
create policy "angsub_hapus_auth" on anggota_sub_ekskul
  for delete to authenticated using (true);
-- Pengurus ekskul (murid password lokal) memakai anon key — pola 20260905
drop policy if exists "angsub_baca_anon" on anggota_sub_ekskul;
create policy "angsub_baca_anon" on anggota_sub_ekskul
  for select to anon using (true);
drop policy if exists "angsub_tulis_anon" on anggota_sub_ekskul;
create policy "angsub_tulis_anon" on anggota_sub_ekskul
  for insert to anon with check (true);
drop policy if exists "angsub_ubah_anon" on anggota_sub_ekskul;
create policy "angsub_ubah_anon" on anggota_sub_ekskul
  for update to anon using (true) with check (true);
drop policy if exists "angsub_hapus_anon" on anggota_sub_ekskul;
create policy "angsub_hapus_anon" on anggota_sub_ekskul
  for delete to anon using (true);

revoke all on table anggota_sub_ekskul from anon, authenticated;
grant select, insert, update, delete on anggota_sub_ekskul to authenticated;
grant select, insert, update, delete on anggota_sub_ekskul to anon;

-- ========== 5. PRESET SURAT DISPENSASI ==========
create table if not exists preset_dispensasi (
  id uuid primary key default gen_random_uuid(),
  ekskul text default '',
  nama_preset text not null,
  isi jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ekskul, nama_preset)
);
create index if not exists idx_preset_disp on preset_dispensasi (ekskul);

alter table preset_dispensasi enable row level security;

drop policy if exists "preset_baca_auth" on preset_dispensasi;
create policy "preset_baca_auth" on preset_dispensasi
  for select to authenticated using (true);
drop policy if exists "preset_tulis_auth" on preset_dispensasi;
create policy "preset_tulis_auth" on preset_dispensasi
  for insert to authenticated with check (true);
drop policy if exists "preset_ubah_auth" on preset_dispensasi;
create policy "preset_ubah_auth" on preset_dispensasi
  for update to authenticated using (true) with check (true);
drop policy if exists "preset_hapus_auth" on preset_dispensasi;
create policy "preset_hapus_auth" on preset_dispensasi
  for delete to authenticated using (true);

revoke all on table preset_dispensasi from anon, authenticated;
grant select, insert, update, delete on preset_dispensasi to authenticated;

-- ========== 6. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [14/84] upgrade_20260906_ekskul_surat_v2.sql
-- ============================================================
-- ============================================================
-- UPGRADE EKSTRAKURIKULER — SURAT DISPENSASI v2 — 2026-09-06
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) sub_ekstrakurikuler: kolom "anggota" (JSONB array NIS) —
--      keanggotaan sub digabung ke SATU tabel
--   2) Migrasi data dari anggota_sub_ekskul → sub_ekstrakurikuler.anggota
--   3) Drop tabel anggota_sub_ekskul (tidak lagi dipakai)
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. KOLOM ANGOTA PADA SUB-EKSKUL ==========
alter table sub_ekstrakurikuler
  add column if not exists anggota jsonb not null default '[]'::jsonb;

-- ========== 2. MIGRASI DATA KEANGGOTAAN LAMA ==========
-- Masukkan NIS dari anggota_sub_ekskul ke array anggota baris sub yang cocok
-- (hanya bila kolom anggota masih kosong — idempoten).
do $$
declare
  v_kol text;
begin
  if to_regclass('public.anggota_sub_ekskul') is not null then
    -- [PERBAIKAN 42703] kolom penyimpan nama sub dideteksi otomatis:
    -- skema v1 memakai kolom "sub" (bukan "nama_sub") — deteksi via information_schema, dipakai via %I.
    select case
      when exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'anggota_sub_ekskul'
                     and column_name = 'nama_sub') then 'nama_sub'
      when exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'anggota_sub_ekskul'
                     and column_name = 'sub') then 'sub'
      else null
    end into v_kol;
    if v_kol is not null then
      execute format($f$
        update sub_ekstrakurikuler s
        set anggota = q.anggota
        from (
          select ekskul, %I as nama_sub, jsonb_agg(distinct nis order by nis) as anggota
          from anggota_sub_ekskul
          where coalesce(%I, '') <> ''
          group by ekskul, %I
        ) q
        where s.ekskul = q.ekskul
          and s.nama_sub = q.nama_sub
          and coalesce(s.anggota, '[]'::jsonb) = '[]'::jsonb
      $f$, v_kol, v_kol, v_kol);
    end if;
  end if;
end $$;

-- ========== 3. DROP TABEL LAMA ==========
drop table if exists anggota_sub_ekskul;

-- ========== 4. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [15/84] upgrade_20260908_kalender.sql
-- ============================================================
-- ============================================================
-- UPGRADE: KALENDER PENDIDIKAN — 2026-09-08
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi: tabel kalender_pendidikan (event libur/kegiatan per tahun pelajaran).
--
-- tipe: libur | libur_siswa | awal_masuk | sumatif | rapor | budi_pekerti | custom
--   - libur & libur_siswa ikut mengunci absensi (Hadir Tatap Muka);
--   - kategori lain hanya penanda warna/tooltip.
-- tanggal_sampai: null/sama = acara satu hari; rentang dipecah per hari di aplikasi.
-- semester: 'Ganjil' | 'Genap' (tabel data dibagi per semester).
-- RLS: guru/admin (authenticated) boleh baca/tulis.
-- Idempotent — aman dijalankan berulang.
-- ============================================================

create table if not exists kalender_pendidikan (
  id uuid primary key default gen_random_uuid(),
  tahun text not null,
  semester text not null default 'Ganjil',
  tipe text not null default 'custom',
  tanggal_mulai date not null,
  tanggal_sampai date,
  nama text not null,
  keterangan text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_kalender_tahun_tgl
  on kalender_pendidikan (tahun, tanggal_mulai);

alter table kalender_pendidikan enable row level security;

drop policy if exists "kalender_baca_auth" on kalender_pendidikan;
create policy "kalender_baca_auth" on kalender_pendidikan
  for select to authenticated using (true);

drop policy if exists "kalender_tulis_auth" on kalender_pendidikan;
create policy "kalender_tulis_auth" on kalender_pendidikan
  for insert to authenticated with check (true);

drop policy if exists "kalender_update_auth" on kalender_pendidikan;
create policy "kalender_update_auth" on kalender_pendidikan
  for update to authenticated using (true) with check (true);

drop policy if exists "kalender_hapus_auth" on kalender_pendidikan;
create policy "kalender_hapus_auth" on kalender_pendidikan
  for delete to authenticated using (true);

-- ============================================================
-- [16/84] upgrade_20260909_administrasi_guru.sql
-- ============================================================
-- ============================================================
-- UPGRADE: ADMINISTRASI GURU LAINNYA — 2026-09-09
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Isi:
--   1) ALTER jurnal_guru  : + hari, jam_ke, pencapaian (Kegiatan Harian Guru)
--   2) remedial_pelaksanaan : Format Pelaksanaan Perbaikan dan Pengayaan
--   3) remedial_program     : Program Remedial/Pengayaan per KI/KD
--   4) bimbingan_penyuluhan : Lembar Bimbingan Penyuluhan (BK)
--   5) kunjungan_supervisi  : Lembar Kunjungan Kelas Supervisi
--   6) dokumen_guru         : Dokumen/link milik guru (opsi dibagikan)
--
-- Kepemilikan data: kolom nip_guru / pemilik_nip; scoping akses diberlakukan
-- di UI (guru = miliknya + yang dibagikan; admin = semua).
-- RLS: guru/admin (authenticated) boleh baca/tulis.
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1) JURNAL GURU: kolom kegiatan harian ==========
alter table jurnal_guru add column if not exists hari text default '';
alter table jurnal_guru add column if not exists jam_ke text default '';
alter table jurnal_guru add column if not exists pencapaian text default '';

-- ========== 2) REMEDIAL: FORMAT PELAKSANAAN ==========
create table if not exists remedial_pelaksanaan (
  id uuid primary key default gen_random_uuid(),
  tahun text not null,
  semester text default 'Ganjil',
  kelas text default '',
  mapel text default '',
  bentuk_evaluasi text default '',
  tanggal_pelaksanaan date,
  ki_kd text default '',
  program text default 'Perbaikan',
  jumlah_siswa int,
  tindakan text default '',
  hasil text default 'TUNTAS',
  nip_guru text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_rem_pelaksanaan_tahun
  on remedial_pelaksanaan (tahun, semester, kelas);

-- ========== 3) REMEDIAL: PROGRAM ==========
create table if not exists remedial_program (
  id uuid primary key default gen_random_uuid(),
  tahun text default '',
  semester text default 'Ganjil',
  kelas text default '',
  mapel text default '',
  ki_cp text default '',
  kd_tp text default '',
  ketercapaian text default '',
  tindak_lanjut text default 'Remedial Tes',
  nip_guru text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_rem_program_tahun
  on remedial_program (tahun, semester, kelas, mapel);

-- ========== 4) BIMBINGAN PENYULUHAN ==========
create table if not exists bimbingan_penyuluhan (
  id uuid primary key default gen_random_uuid(),
  tahun text default '',
  semester text default 'Ganjil',
  hari text default '',
  tanggal date,
  nama_siswa text default '',
  nis text default '',
  kelas text default '',
  mapel text default '',
  masalah text default '',
  jenis_bimbingan text default 'Pelajaran - Individu',
  tindak_lanjut text default '',
  nip_guru text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_bimbingan_tahun
  on bimbingan_penyuluhan (tahun, tanggal);

-- ========== 5) KUNJUNGAN KELAS SUPERVISI ==========
create table if not exists kunjungan_supervisi (
  id uuid primary key default gen_random_uuid(),
  tahun text default '',
  semester text default 'Ganjil',
  hari text default '',
  tanggal date,
  nama_guru text default '',
  jabatan text default '',
  nip text default '',
  kelas text default '',
  maksud text default '',
  kesan text default '',
  pesan text default '',
  tanda_tangan text default '',
  keterangan text default '',
  nip_pencatat text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_supervisi_tahun
  on kunjungan_supervisi (tahun, tanggal);

-- ========== 6) DOKUMEN LAINNYA (LINK EKSTERNAL) ==========
create table if not exists dokumen_guru (
  id uuid primary key default gen_random_uuid(),
  judul text not null,
  jenis text default 'Dokumen',
  url text not null default '',
  keterangan text default '',
  pemilik_nip text default '',
  pemilik_nama text default '',
  dibagikan boolean not null default false,
  tahun text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_dokumen_pemilik
  on dokumen_guru (pemilik_nip, tahun);

-- ========== RLS SEMUA TABEL ==========
alter table remedial_pelaksanaan enable row level security;
alter table remedial_program enable row level security;
alter table bimbingan_penyuluhan enable row level security;
alter table kunjungan_supervisi enable row level security;
alter table dokumen_guru enable row level security;

drop policy if exists "adm_baca_auth" on remedial_pelaksanaan;
create policy "adm_baca_auth" on remedial_pelaksanaan
  for select to authenticated using (true);
drop policy if exists "adm_tulis_auth" on remedial_pelaksanaan;
create policy "adm_tulis_auth" on remedial_pelaksanaan
  for insert to authenticated with check (true);
drop policy if exists "adm_ubah_auth" on remedial_pelaksanaan;
create policy "adm_ubah_auth" on remedial_pelaksanaan
  for update to authenticated using (true) with check (true);
drop policy if exists "adm_hapus_auth" on remedial_pelaksanaan;
create policy "adm_hapus_auth" on remedial_pelaksanaan
  for delete to authenticated using (true);

drop policy if exists "rmp_baca_auth" on remedial_program;
create policy "rmp_baca_auth" on remedial_program
  for select to authenticated using (true);
drop policy if exists "rmp_tulis_auth" on remedial_program;
create policy "rmp_tulis_auth" on remedial_program
  for insert to authenticated with check (true);
drop policy if exists "rmp_ubah_auth" on remedial_program;
create policy "rmp_ubah_auth" on remedial_program
  for update to authenticated using (true) with check (true);
drop policy if exists "rmp_hapus_auth" on remedial_program;
create policy "rmp_hapus_auth" on remedial_program
  for delete to authenticated using (true);

drop policy if exists "bpb_baca_auth" on bimbingan_penyuluhan;
create policy "bpb_baca_auth" on bimbingan_penyuluhan
  for select to authenticated using (true);
drop policy if exists "bpb_tulis_auth" on bimbingan_penyuluhan;
create policy "bpb_tulis_auth" on bimbingan_penyuluhan
  for insert to authenticated with check (true);
drop policy if exists "bpb_ubah_auth" on bimbingan_penyuluhan;
create policy "bpb_ubah_auth" on bimbingan_penyuluhan
  for update to authenticated using (true) with check (true);
drop policy if exists "bpb_hapus_auth" on bimbingan_penyuluhan;
create policy "bpb_hapus_auth" on bimbingan_penyuluhan
  for delete to authenticated using (true);

drop policy if exists "ksp_baca_auth" on kunjungan_supervisi;
create policy "ksp_baca_auth" on kunjungan_supervisi
  for select to authenticated using (true);
drop policy if exists "ksp_tulis_auth" on kunjungan_supervisi;
create policy "ksp_tulis_auth" on kunjungan_supervisi
  for insert to authenticated with check (true);
drop policy if exists "ksp_ubah_auth" on kunjungan_supervisi;
create policy "ksp_ubah_auth" on kunjungan_supervisi
  for update to authenticated using (true) with check (true);
drop policy if exists "ksp_hapus_auth" on kunjungan_supervisi;
create policy "ksp_hapus_auth" on kunjungan_supervisi
  for delete to authenticated using (true);

drop policy if exists "dkm_baca_auth" on dokumen_guru;
create policy "dkm_baca_auth" on dokumen_guru
  for select to authenticated using (true);
drop policy if exists "dkm_tulis_auth" on dokumen_guru;
create policy "dkm_tulis_auth" on dokumen_guru
  for insert to authenticated with check (true);
drop policy if exists "dkm_ubah_auth" on dokumen_guru;
create policy "dkm_ubah_auth" on dokumen_guru
  for update to authenticated using (true) with check (true);
drop policy if exists "dkm_hapus_auth" on dokumen_guru;
create policy "dkm_hapus_auth" on dokumen_guru
  for delete to authenticated using (true);

revoke all on table remedial_pelaksanaan from anon, authenticated;
grant select, insert, update, delete on remedial_pelaksanaan to authenticated;
revoke all on table remedial_program from anon, authenticated;
grant select, insert, update, delete on remedial_program to authenticated;
revoke all on table bimbingan_penyuluhan from anon, authenticated;
grant select, insert, update, delete on bimbingan_penyuluhan to authenticated;
revoke all on table kunjungan_supervisi from anon, authenticated;
grant select, insert, update, delete on kunjungan_supervisi to authenticated;
revoke all on table dokumen_guru from anon, authenticated;
grant select, insert, update, delete on dokumen_guru to authenticated;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [17/84] upgrade_20260910_penugasan_guru.sql
-- ============================================================
-- ============================================================
-- UPGRADE: PENUGASAN GURU PER TAHUN PELAJARAN — 2026-09-10
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Isi:
--   Kolom akun.penugasan (jsonb) untuk guru: penugasan Mapel Diampu,
--   Wali Kelas & Pembina Ekstrakurikuler PER TAHUN PELAJARAN.
--
-- Struktur:
--   { "2026/2027": { "mapel": ["Matematika"], "wali": "X RPL 1", "ekskul": ["Pramuka"] },
--     "2025/2026": { ... } }
--
-- Perilaku aplikasi: tahun pelajaran yang belum punya entri penugasan
-- otomatis memakai fallback kolom statis (wali_kelas / mapel / ekstrakurikuler),
-- sehingga data eksisting tetap berjalan tanpa migrasi manual.
--
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

alter table akun
  add column if not exists penugasan jsonb not null default '{}'::jsonb;

comment on column akun.penugasan is
  'Penugasan guru per tahun pelajaran: { "TA": { "mapel": [], "wali": "", "ekskul": [] } }. Tahun tanpa entri = fallback kolom statis (wali_kelas/mapel/ekstrakurikuler).';

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [18/84] upgrade_20260911_riwayat_siswa.sql
-- ============================================================
-- ============================================================
-- UPGRADE: RIWAYAT KELAS & STATUS SISWA PER TAHUN PELAJARAN — 2026-09-11
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Isi:
--   Kolom akun.riwayat_kelas (jsonb) untuk murid: kelas efektif & status
--   siswa PER TAHUN PELAJARAN (kenaikan kelas, pindah jurusan, dropout, lulus).
--
-- Struktur:
--   { "2026/2027": { "kelas": "X RPL 1", "status": "Aktif", "ket": "" },
--     "2027/2028": { "kelas": "XI RPL 1", "status": "Aktif",  "ket": "Naik" },
--     "2028/2029": { "kelas": "XI RPL 1", "status": "Pindah", "ket": "pindah ke SMKN 3" } }
--
-- status: Aktif | Lulus | Pindah | Dropout | Keluar
-- Perilaku aplikasi:
--   - Tahun tanpa entri → fallback kolom statis tingkat_kelas (status 'Aktif'),
--     sehingga data eksisting tetap berjalan tanpa migrasi manual.
--   - Dual-write: proses kenaikan/pindah juga memperbarui tingkat_kelas statis
--     = kelas TA aktif agar seluruh query existing tetap benar.
--   - Siswa non-Aktif disembunyikan dari daftar absensi/nilai/ekskul TA tersebut.
--
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

alter table akun
  add column if not exists riwayat_kelas jsonb not null default '{}'::jsonb;

comment on column akun.riwayat_kelas is
  'Riwayat kelas & status siswa per tahun pelajaran: { "TA": { "kelas": "", "status": "Aktif|Lulus|Pindah|Dropout|Keluar", "ket": "" } }. Tahun tanpa entri = fallback tingkat_kelas statis (Aktif).';

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [19/84] upgrade_20260912_nisn_sync.sql
-- ============================================================
-- ============================================================
-- UPGRADE: SINKRONISASI NISN + PERBAIKAN FORM AKUN MURID — 2026-09-12
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Isi:
--   1) kolom nisn tabel akun (pengaman; sudah ada via upgrade_20260904_akun.sql)
--   2) kolom nisn tabel bimbingan_penyuluhan (Administrasi Guru → Bimbingan Penyuluhan)
--   3) RPC buat_akun_murid dibuat ulang:
--        - Jalur EDIT : kolom opsional yang dikirim kosong ('') → DIKOSONGKAN (NULL),
--                       sehingga isian yang dihapus di form ikut terhapus di database.
--                       (Versi lama memperlakukan '' = pertahankan nilai lama.)
--        - Jalur TAMBAH: tidak berubah (kolom kosong tersimpan NULL).
--      Catatan: RPC import_akun_murid TIDAK diubah ('' = pertahankan) agar import
--               parsial tetap aman.
--
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== 1. NISN TABEL AKUN (pengaman) ==========
alter table akun
  add column if not exists nisn text;

-- ========== 2. NISN TABEL BIMBINGAN PENYULUHAN ==========
alter table bimbingan_penyuluhan
  add column if not exists nisn text default '';

-- ========== 3. RPC: TAMBAH / EDIT AKUN MURID (kolom kosong = dihapus) ==========
create or replace function buat_akun_murid(p_data jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis text;
  v_pass text;
  v_lahir date;
begin
  if coalesce((select tipe from akun where user_id = auth.uid()), '') <> 'admin' then
    return json_build_object('status', 'error', 'message', 'Hanya admin yang boleh mengelola akun murid.');
  end if;

  v_nis := trim(coalesce(p_data->>'nis', ''));
  if v_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;
  if coalesce(trim(coalesce(p_data->>'nama_lengkap', '')), '') = '' then
    return json_build_object('status', 'error', 'message', 'Nama lengkap wajib diisi.');
  end if;

  v_pass := trim(coalesce(p_data->>'password', ''));
  if v_pass <> '' and length(v_pass) < 6 then
    return json_build_object('status', 'error', 'message', 'Password minimal 6 karakter.');
  end if;

  v_lahir := nullif(trim(coalesce(p_data->>'tgl_lahir', '')), '')::date;

  if exists (select 1 from akun where nis_nip = v_nis and tipe = 'murid') then
    -- EDIT: perbarui profil; kolom opsional kosong = dikosongkan; password hanya bila diisi
    update akun set
      nama_lengkap     = coalesce(nullif(trim(p_data->>'nama_lengkap'), ''), nama_lengkap),
      nisn             = nullif(trim(p_data->>'nisn'), ''),
      tahun_pelajaran  = nullif(trim(p_data->>'tahun_pelajaran'), ''),
      semester         = nullif(trim(p_data->>'semester'), ''),
      tingkat_kelas    = nullif(trim(p_data->>'tingkat_kelas'), ''),
      jenis_kelamin    = nullif(trim(p_data->>'jenis_kelamin'), ''),
      tgl_lahir        = v_lahir,
      agama            = nullif(trim(p_data->>'agama'), ''),
      golongan_darah   = nullif(trim(p_data->>'golongan_darah'), ''),
      jabatan          = nullif(trim(p_data->>'jabatan'), ''),
      email            = nullif(trim(p_data->>'email'), ''),
      no_telepon       = nullif(trim(p_data->>'no_telepon'), ''),
      ekstrakurikuler  = nullif(trim(p_data->>'ekstrakurikuler'), ''),
      nama_ayah        = nullif(trim(p_data->>'nama_ayah'), ''),
      pekerjaan_ayah   = nullif(trim(p_data->>'pekerjaan_ayah'), ''),
      nama_ibu         = nullif(trim(p_data->>'nama_ibu'), ''),
      pekerjaan_ibu    = nullif(trim(p_data->>'pekerjaan_ibu'), ''),
      nama_wali        = nullif(trim(p_data->>'nama_wali'), ''),
      alamat           = nullif(trim(p_data->>'alamat'), ''),
      catatan_khusus   = nullif(trim(p_data->>'catatan_khusus'), '')
    where nis_nip = v_nis and tipe = 'murid';

    if v_pass <> '' then
      insert into akun_kredensial (nis_nip, password_hash)
      values (v_nis, crypt(v_pass, gen_salt('bf', 10)))
      on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();
    end if;
    return json_build_object('status', 'success', 'message', 'Data murid diperbarui.', 'aksi', 'update');
  else
    -- TAMBAH: password wajib (kosong → default 123456)
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

-- ========== 4. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [20/84] upgrade_20260913_jabatan_ekskul.sql
-- ============================================================
-- ============================================================
-- UPGRADE: JABATAN EKSTRAKURIKULER — 2026-09-13
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Isi:
--   1) kolom "Jabatan Ekstrakurikuler" tabel master_data (kategori baru
--      Master Data → tab Daftar)
--   2) kolom jabatan_ekskul tabel akun (jabatan ekskul milik murid)
--   3) RPC buat_akun_murid dibuat ulang dengan penanganan jabatan_ekskul
--      (jalur EDIT: kolom kosong '' → dikosongkan; jalur TAMBAH: tetap NULL).
--
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== 1. KATEGORI MASTER DATA: JABATAN EKSTRAKURIKULER ==========
alter table master_data
  add column if not exists "Jabatan Ekstrakurikuler" text;

-- ========== 2. KOLOM JABATAN EKSKUL TABEL AKUN ==========
alter table akun
  add column if not exists jabatan_ekskul text;

-- ========== 3. RPC: TAMBAH / EDIT AKUN MURID (kolom kosong = dihapus) ==========
create or replace function buat_akun_murid(p_data jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis text;
  v_pass text;
  v_lahir date;
begin
  if coalesce((select tipe from akun where user_id = auth.uid()), '') <> 'admin' then
    return json_build_object('status', 'error', 'message', 'Hanya admin yang boleh mengelola akun murid.');
  end if;

  v_nis := trim(coalesce(p_data->>'nis', ''));
  if v_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;
  if coalesce(trim(coalesce(p_data->>'nama_lengkap', '')), '') = '' then
    return json_build_object('status', 'error', 'message', 'Nama lengkap wajib diisi.');
  end if;

  v_pass := trim(coalesce(p_data->>'password', ''));
  if v_pass <> '' and length(v_pass) < 6 then
    return json_build_object('status', 'error', 'message', 'Password minimal 6 karakter.');
  end if;

  v_lahir := nullif(trim(coalesce(p_data->>'tgl_lahir', '')), '')::date;

  if exists (select 1 from akun where nis_nip = v_nis and tipe = 'murid') then
    -- EDIT: perbarui profil; kolom opsional kosong = dikosongkan; password hanya bila diisi
    update akun set
      nama_lengkap     = coalesce(nullif(trim(p_data->>'nama_lengkap'), ''), nama_lengkap),
      nisn             = nullif(trim(p_data->>'nisn'), ''),
      tahun_pelajaran  = nullif(trim(p_data->>'tahun_pelajaran'), ''),
      semester         = nullif(trim(p_data->>'semester'), ''),
      tingkat_kelas    = nullif(trim(p_data->>'tingkat_kelas'), ''),
      jenis_kelamin    = nullif(trim(p_data->>'jenis_kelamin'), ''),
      tgl_lahir        = v_lahir,
      agama            = nullif(trim(p_data->>'agama'), ''),
      golongan_darah   = nullif(trim(p_data->>'golongan_darah'), ''),
      jabatan          = nullif(trim(p_data->>'jabatan'), ''),
      jabatan_ekskul   = nullif(trim(p_data->>'jabatan_ekskul'), ''),
      email            = nullif(trim(p_data->>'email'), ''),
      no_telepon       = nullif(trim(p_data->>'no_telepon'), ''),
      ekstrakurikuler  = nullif(trim(p_data->>'ekstrakurikuler'), ''),
      nama_ayah        = nullif(trim(p_data->>'nama_ayah'), ''),
      pekerjaan_ayah   = nullif(trim(p_data->>'pekerjaan_ayah'), ''),
      nama_ibu         = nullif(trim(p_data->>'nama_ibu'), ''),
      pekerjaan_ibu    = nullif(trim(p_data->>'pekerjaan_ibu'), ''),
      nama_wali        = nullif(trim(p_data->>'nama_wali'), ''),
      alamat           = nullif(trim(p_data->>'alamat'), ''),
      catatan_khusus   = nullif(trim(p_data->>'catatan_khusus'), '')
    where nis_nip = v_nis and tipe = 'murid';

    if v_pass <> '' then
      insert into akun_kredensial (nis_nip, password_hash)
      values (v_nis, crypt(v_pass, gen_salt('bf', 10)))
      on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();
    end if;
    return json_build_object('status', 'success', 'message', 'Data murid diperbarui.', 'aksi', 'update');
  else
    -- TAMBAH: password wajib (kosong → default 123456)
    if v_pass = '' then v_pass := '123456'; end if;
    insert into akun (
      nama_lengkap, nis_nip, tipe, nisn, tahun_pelajaran, semester,
      jenis_kelamin, tgl_lahir, agama, golongan_darah,
      email, no_telepon, ekstrakurikuler, tingkat_kelas, jabatan, jabatan_ekskul,
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
      nullif(trim(coalesce(p_data->>'jabatan_ekskul', '')), ''),
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

-- ========== 4. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [21/84] upgrade_20260914_akses_murid.sql
-- ============================================================
-- ============================================================
-- UPGRADE AKSES MURID — 2026-09-14
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) Kolom gps di tabel absensi (persist lokasi absen mandiri)
--   2) RPC ubah_profil_murid        : murid edit data dirinya (whitelist)
--   3) RPC ubah_password_sendiri    : murid reset password sendiri
--                                     (verifikasi password lama)
--   4) RPC ambil_laporan_nilai_murid: murid (anon) membaca nilai miliknya
--
-- Murid lokal login dengan anon key (tanpa sesi Supabase Auth) — pola
-- sama dengan absensi & teman sejawat: verifikasi dilakukan di RPC
-- security-definer berdasarkan NIS pemanggil.
--
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. KOLOM GPS ABSENSI ==========
alter table absensi add column if not exists gps text default '';

-- ========== 2. RPC: EDIT PROFIL SENDIRI (WHITELIST) ==========
-- Murid hanya boleh mengubah kolom kontak & data pribadi.
-- NIS, NISN, nama, kelas, ekstrakurikuler, jabatan TIDAK bisa diubah.
create or replace function ubah_profil_murid(p_nis text, p_data jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_lahir date;
begin
  -- Verifikasi pemanggil benar-benar pemilik NIS (murid lokal/anon
  -- tidak punya auth.uid(), jadi kecocokan NIS + tipe murid adalah kuncinya).
  if not exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') then
    return json_build_object('status', 'error', 'message', 'Akun murid tidak ditemukan.');
  end if;

  v_lahir := nullif(trim(coalesce(p_data->>'tgl_lahir', '')), '')::date;

  update akun set
    email            = coalesce(p_data->>'email', email),
    no_telepon       = coalesce(p_data->>'no_telepon', no_telepon),
    alamat           = coalesce(p_data->>'alamat', alamat),
    nama_ayah        = coalesce(p_data->>'nama_ayah', nama_ayah),
    pekerjaan_ayah   = coalesce(p_data->>'pekerjaan_ayah', pekerjaan_ayah),
    nama_ibu         = coalesce(p_data->>'nama_ibu', nama_ibu),
    pekerjaan_ibu    = coalesce(p_data->>'pekerjaan_ibu', pekerjaan_ibu),
    nama_wali        = coalesce(p_data->>'nama_wali', nama_wali),
    tgl_lahir        = coalesce(v_lahir, tgl_lahir),
    jenis_kelamin    = coalesce(p_data->>'jenis_kelamin', jenis_kelamin),
    agama            = coalesce(p_data->>'agama', agama),
    golongan_darah   = coalesce(p_data->>'golongan_darah', golongan_darah)
  where nis_nip = p_nis and tipe = 'murid';

  return json_build_object('status', 'success', 'message', 'Profil berhasil diperbarui.');
end $$;

-- ========== 3. RPC: GANTI PASSWORD SENDIRI ==========
create or replace function ubah_password_sendiri(p_nis text, p_lama text, p_baru text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  if length(trim(coalesce(p_baru, ''))) < 6 then
    return json_build_object('status', 'error', 'message', 'Password baru minimal 6 karakter.');
  end if;

  select password_hash into v_hash from akun_kredensial where nis_nip = p_nis;
  if v_hash is null then
    return json_build_object('status', 'error', 'message', 'Kredensial tidak ditemukan. Hubungi admin.');
  end if;

  if crypt(coalesce(p_lama, ''), v_hash) <> v_hash then
    return json_build_object('status', 'error', 'message', 'Password lama salah.');
  end if;

  update akun_kredensial
    set password_hash = crypt(p_baru, gen_salt('bf', 10)), updated_at = now()
  where nis_nip = p_nis;

  return json_build_object('status', 'success', 'message', 'Password berhasil diganti.');
end $$;

-- ========== 4. RPC: LAPORAN NILAI MURID (READ-ONLY) ==========
create or replace function ambil_laporan_nilai_murid(p_nis text, p_tahun text, p_semester text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rows json;
begin
  if not exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') then
    return json_build_object('status', 'error', 'message', 'Akun murid tidak ditemukan.');
  end if;

  select coalesce(json_agg(row_to_json(t) order by t.kategori, t.mapel), '[]'::json)
    into v_rows
  from (
    select nis, nama, kategori, mapel, ekskul, kelas, tahun, semester, data
    from nilai
    where nis = p_nis
      and (p_tahun = '' or tahun = p_tahun)
      and (p_semester = '' or semester = p_semester)
  ) t;

  return json_build_object('status', 'success', 'nilai', v_rows);
end $$;

-- ========== 5. IZIN EKSEKUSI ==========
grant execute on function ubah_profil_murid(text, jsonb) to anon, authenticated;
grant execute on function ubah_password_sendiri(text, text, text) to anon, authenticated;
grant execute on function ambil_laporan_nilai_murid(text, text, text) to anon, authenticated;

-- ========== 6. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [22/84] upgrade_20260914_absensi_delete.sql
-- ============================================================
-- ============================================================
-- UPGRADE ABSENSI (DELETE) — 2026-09-14
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   Policy RLS DELETE untuk tabel absensi.
--   Wajib untuk tombol "Kosongkan Data" pada Input Hadir Masal
--   (Hadir Tatap Muka) yang kini menghapus permanen baris absensi
--   dari database. Tanpa policy ini, perintah delete diabaikan RLS
--   (0 baris terhapus) meski grant delete sudah ada.
--
-- Idempotent — aman dijalankan berulang.
-- ============================================================

drop policy if exists "absensi_hapus_semua" on absensi;
create policy "absensi_hapus_semua" on absensi
  for delete using (true);

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [23/84] upgrade_20260915_proses_kenaikan_rpc.sql
-- ============================================================
-- ============================================================
-- UPGRADE PROSES KENAIKAN KELAS (ADMIN-ONLY) — 2026-09-15
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   RPC proses_kenaikan_kelas(p_ta_tujuan, p_siswa):
--     - Hanya admin (akun.tipe = 'admin' utk auth.uid()) boleh eksekusi
--     - Update massal: tingkat_kelas + riwayat_kelas (merge jsonb
--       pada kunci TA tujuan) hanya untuk baris tipe = 'murid'
--     - Dipakai wizard "Proses Kenaikan Kelas" (mode Naik & Turun/Koreksi)
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== RPC: PROSES KENAIKAN / KOREKSI KELAS (ADMIN) ==========
create or replace function proses_kenaikan_kelas(p_ta_tujuan text, p_siswa jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tipe text;
  v_diperbarui int := 0;
begin
  if coalesce((select tipe from akun where user_id = auth.uid()), '') <> 'admin' then
    return json_build_object('status', 'error', 'message', 'Hanya admin yang boleh memproses kenaikan kelas.');
  end if;

  if coalesce(trim(p_ta_tujuan), '') = '' then
    return json_build_object('status', 'error', 'message', 'Tahun pelajaran tujuan tidak valid.');
  end if;
  if p_siswa is null or jsonb_typeof(p_siswa) <> 'array' or jsonb_array_length(p_siswa) = 0 then
    return json_build_object('status', 'error', 'message', 'Data siswa tidak valid.');
  end if;

  begin
    update akun a
    set tingkat_kelas = s.kelas,
        riwayat_kelas = coalesce(a.riwayat_kelas, '{}'::jsonb) || jsonb_build_object(
          p_ta_tujuan,
          jsonb_build_object('kelas', s.kelas, 'status', s.status, 'ket', s.ket)
        )
    from jsonb_to_recordset(p_siswa) as s(id uuid, kelas text, status text, ket text)
    where a.id = s.id
      and a.tipe = 'murid'
      and coalesce(trim(s.kelas), '') <> '';

    get diagnostics v_diperbarui = row_count;
  exception when others then
    return json_build_object('status', 'error', 'message', 'Gagal memperbarui data: ' || SQLERRM);
  end;

  return json_build_object('status', 'success', 'diperbarui', v_diperbarui);
end $$;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [24/84] upgrade_20260916_fase1.sql
-- ============================================================
-- ============================================================
-- UPGRADE FASE 1 MODUL ADMINISTRASI SEKOLAH — 2026-09-16
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi (4 tabel baru):
--   1) jadwal_ujian  : jadwal ujian per TA/semester/kelas (sumber kartu ujian)
--   2) pengumuman    : pengumuman sekolah ber-target (widget dashboard)
--   3) rapor_catatan : catatan wali kelas per siswa per TA + semester
--   4) arsip_surat   : arsip surat keterangan (generator surat resmi)
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== 1. JADWAL UJIAN ==========
create table if not exists jadwal_ujian (
  id uuid primary key default gen_random_uuid(),
  ta text not null,
  semester text default 'Ganjil',
  jenis text not null,
  tanggal date,
  jam_mulai text default '',
  jam_selesai text default '',
  kelas text default '',
  mapel text default '',
  pengawas text default '',
  ket text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_jadwal_ujian_ta on jadwal_ujian (ta, jenis, kelas);

-- ========== 2. PENGUMUMAN ==========
create table if not exists pengumuman (
  id uuid primary key default gen_random_uuid(),
  ta text not null,
  judul text not null,
  isi text default '',
  target text not null default 'semua',   -- semua | guru | murid | kelas
  kelas text default '',
  mulai date,
  akhir date,
  penulis text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_pengumuman_ta on pengumuman (ta);

-- ========== 3. CATATAN WALI KELAS (RAPOR) ==========
create table if not exists rapor_catatan (
  id uuid primary key default gen_random_uuid(),
  nis text not null,
  ta text not null,
  semester text not null,
  catatan text default '',
  updated_at timestamptz not null default now(),
  unique (nis, ta, semester)
);

-- ========== 4. ARSIP SURAT ==========
create table if not exists arsip_surat (
  id uuid primary key default gen_random_uuid(),
  ta text not null,
  jenis text not null,
  nomor_surat text not null,
  nis text default '',
  nama text default '',
  kelas text default '',
  payload jsonb default '{}'::jsonb,
  dibuat_oleh text default '',
  dibuat_at timestamptz not null default now()
);
create index if not exists idx_arsip_surat_jenis on arsip_surat (jenis, ta);

-- ========== PRIVILEGE ==========
grant select, insert, update, delete on jadwal_ujian, pengumuman, rapor_catatan, arsip_surat to authenticated;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [25/84] upgrade_20260917_fase2.sql
-- ============================================================
-- ============================================================
-- UPGRADE FASE 2 MODUL ADMINISTRASI SEKOLAH — 2026-09-17
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi (5 tabel baru):
--   1) poin_kategori : master kategori prestasi/pelanggaran + bobot poin
--   2) poin_siswa    : catatan poin per siswa (snapshot nama & bobot)
--   3) spp_tagihan   : tagihan SPP/Daftar Ulang per siswa per periode
--   4) kas_transaksi : buku kas sekolah (masuk/keluar) + no bukti
--   5) arsip_dokumen : arsip dokumen sekolah berkategori + link
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== 1. KATEGORI POIN ==========
create table if not exists poin_kategori (
  id uuid primary key default gen_random_uuid(),
  jenis text not null check (jenis in ('prestasi','pelanggaran')),
  nama text not null,
  poin int not null default 1,
  ket text default '',
  aktif boolean not null default true,
  created_at timestamptz not null default now(),
  unique (jenis, nama)
);

-- ========== 2. CATATAN POIN SISWA ==========
create table if not exists poin_siswa (
  id uuid primary key default gen_random_uuid(),
  nis text not null,
  nama text default '',
  kelas text default '',
  ta text not null,
  semester text default '',
  tanggal date,
  jenis text not null check (jenis in ('prestasi','pelanggaran')),
  kategori_id uuid,
  kategori_nama text default '',
  poin int not null default 0,
  catatan text default '',
  pelapor text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_poin_siswa_nis_ta on poin_siswa (nis, ta);

-- ========== 3. TAGIHAN SPP ==========
create table if not exists spp_tagihan (
  id uuid primary key default gen_random_uuid(),
  nis text not null,
  nama text default '',
  kelas text default '',
  ta text not null,
  semester text default '',
  jenis text not null default 'SPP',      -- SPP | Daftar Ulang | Lainnya
  periode text not null,                  -- YYYY-MM
  nominal numeric not null default 0,
  jatuh_tempo date,
  lunas boolean not null default false,
  tanggal_bayar date,
  metode text default '',
  petugas text default '',
  no_bukti text default '',
  ket text default '',
  created_at timestamptz not null default now(),
  unique (nis, ta, jenis, periode)
);
create index if not exists idx_spp_tagihan_ta on spp_tagihan (ta, jenis, kelas);

-- ========== 4. BUKU KAS SEKOLAH ==========
create table if not exists kas_transaksi (
  id uuid primary key default gen_random_uuid(),
  ta text not null,
  tanggal date,
  jenis text not null check (jenis in ('Masuk','Keluar')),
  kategori text default 'Lainnya',
  nis text default '',
  nominal numeric not null default 0,
  keterangan text default '',
  petugas text default '',
  no_bukti text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_kas_transaksi_ta on kas_transaksi (ta, jenis, tanggal);

-- ========== 5. ARSIP DOKUMEN SEKOLAH ==========
create table if not exists arsip_dokumen (
  id uuid primary key default gen_random_uuid(),
  ta text not null,
  kategori text default 'Lainnya',
  judul text not null,
  deskripsi text default '',
  link_url text default '',
  tanggal date,
  dibuat_oleh text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_arsip_dokumen_ta on arsip_dokumen (ta, kategori);

-- ========== PRIVILEGE ==========
grant select, insert, update, delete on poin_kategori, poin_siswa, spp_tagihan, kas_transaksi, arsip_dokumen to authenticated;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [26/84] upgrade_20260918_fase3.sql
-- ============================================================
-- ============================================================
-- UPGRADE FASE 3 MODUL ADMINISTRASI SEKOLAH — 2026-09-18
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi (4 tabel baru):
--   1) perpus_buku  : katalog buku perpustakaan (kode unik, eksemplar)
--   2) perpus_pinjam: peminjaman buku (snapshot buku & siswa, telat+denda)
--   3) inv_barang   : inventaris sarana prasarana (kode unik, kondisi)
--   4) inv_pinjam   : peminjaman barang (guru/murid/ekskul, kondisi kembali)
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== 1. KATALOG BUKU ==========
create table if not exists perpus_buku (
  id uuid primary key default gen_random_uuid(),
  kode text not null unique,
  judul text not null,
  pengarang text default '',
  penerbit text default '',
  tahun text default '',
  kategori text default 'Lainnya',
  eksemplar int not null default 1,
  lokasi text default '',
  ket text default '',
  aktif boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_perpus_buku_judul on perpus_buku (judul);

-- ========== 2. PEMINJAMAN BUKU ==========
create table if not exists perpus_pinjam (
  id uuid primary key default gen_random_uuid(),
  buku_id uuid,
  kode_buku text default '',
  judul_buku text default '',
  nis text not null,
  nama text default '',
  kelas text default '',
  ta text not null,
  semester text default '',
  tanggal_pinjam date,
  tenggat date,
  tanggal_kembali date,
  hari_telat int default 0,
  denda numeric default 0,
  status text not null default 'Dipinjam',   -- Dipinjam | Kembali
  ket text default '',
  petugas text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_perpus_pinjam_nis on perpus_pinjam (nis, ta);
create index if not exists idx_perpus_pinjam_status on perpus_pinjam (status);

-- ========== 3. INVENTARIS BARANG ==========
create table if not exists inv_barang (
  id uuid primary key default gen_random_uuid(),
  kode text not null unique,
  nama text not null,
  kategori text default 'Lainnya',           -- Elektronik | Perabot | Alat Olahraga | Laboratorium | Buku/ATK | Lainnya
  lokasi text default '',
  jumlah int not null default 1,
  kondisi text default 'Baik' check (kondisi in ('Baik','Rusak Ringan','Rusak Berat')),
  tahun_perolehan text default '',
  harga numeric default 0,
  sumber text default '',                    -- BOS | Komite | Hibah | Pembelian | Lainnya
  ket text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_inv_barang_kat on inv_barang (kategori);

-- ========== 4. PEMINJAMAN BARANG ==========
create table if not exists inv_pinjam (
  id uuid primary key default gen_random_uuid(),
  barang_id uuid,
  kode_barang text default '',
  nama_barang text default '',
  peminjam_tipe text default 'guru',         -- guru | murid | ekskul | lainnya
  peminjam_nama text default '',
  nis text default '',
  jumlah int not null default 1,
  tanggal_pinjam date,
  tanggal_rencana date,
  tanggal_kembali date,
  kondisi_kembali text default '',
  status text not null default 'Dipinjam',   -- Dipinjam | Dikembalikan
  ket text default '',
  petugas text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_inv_pinjam_status on inv_pinjam (status);

-- ========== PRIVILEGE ==========
grant select, insert, update, delete on perpus_buku, perpus_pinjam, inv_barang, inv_pinjam to authenticated;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [27/84] upgrade_20260919_fase4.sql
-- ============================================================
-- ============================================================
-- UPGRADE FASE 4 MODUL ADMINISTRASI SEKOLAH — 2026-09-19
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi (1 tabel baru):
--   ppdb_calon : calon peserta didik baru (PPDB) — pendaftaran, seleksi
--                bertahap (Baru→Verifikasi→Diterima/Ditolak), konversi
--                ke akun murid via RPC buat_akun_murid
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== CALON SISWA PPDB ==========
create table if not exists ppdb_calon (
  id uuid primary key default gen_random_uuid(),
  ta text not null,                        -- tahun pelajaran tujuan
  no_daftar text not null unique,          -- PDB-001/2027/2028
  nama text not null,
  nisn text default '',
  jenis_kelamin text default '',           -- L | P
  tempat_lahir text default '',
  tgl_lahir date,
  agama text default '',
  asal_sekolah text default '',
  alamat text default '',
  telepon text default '',
  nama_ayah text default '',
  pekerjaan_ayah text default '',
  nama_ibu text default '',
  pekerjaan_ibu text default '',
  nama_wali text default '',
  jalur text default 'Reguler',            -- Reguler | Prestasi | Afirmasi | Mutasi
  status text not null default 'Baru' check (status in ('Baru','Verifikasi','Diterima','Ditolak')),
  catatan text default '',
  berkas_link text default '',
  nis text default '',                     -- diisi saat konversi akun
  akun_dibuat boolean not null default false,
  tanggal_daftar date,
  dibuat_oleh text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_ppdb_calon_ta on ppdb_calon (ta, status);

-- ========== PRIVILEGE ==========
grant select, insert, update, delete on ppdb_calon to authenticated;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [28/84] upgrade_20260920_murid_rpc.sql
-- ============================================================
-- ============================================================
-- UPGRADE PERBAIKAN AKSES MURID (ANON) — 2026-09-20
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Latar belakang: sesi login murid memakai anon key (murid lokal
-- tanpa akun Supabase Auth), sedangkan tabel Fase 1-3 hanya di-grant
-- ke authenticated. Akibatnya widget Pengumuman/Poin & Pinjaman Saya
-- & Rapor Saya milik murid gagal membaca data.
--
-- Isi:
--   1) Grant select anon utk konten publik: pengumuman, perpus_buku
--   2) 3 RPC murid-scoped (security definer) utk data sensitif:
--        poin_murid, pinjaman_murid, catatan_wali_murid
--      (pola sama dgn ambil_laporan_nilai_murid / cek_login_murid)
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. GRANT SELECT ANON (PUBLIK) ==========
grant select on pengumuman  to anon;
grant select on perpus_buku to anon;

-- ========== 2. RPC: POIN SESEORANG MURID (by NIS) ==========
create or replace function poin_murid(p_nis text, p_ta text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entri json;
begin
  select coalesce(json_agg(json_build_object(
    'tanggal', e.tanggal,
    'jenis', e.jenis,
    'kategori_nama', e.kategori_nama,
    'poin', e.poin,
    'catatan', e.catatan,
    'pelapor', e.pelapor
  ) order by e.tanggal desc nulls last, e.created_at desc), '[]'::json)
  into v_entri
  from (
    select * from poin_siswa
    where nis = p_nis and ta = p_ta
    order by tanggal desc nulls last, created_at desc
    limit 50
  ) e;

  return json_build_object(
    'status', 'success',
    'total_pelanggaran', (select coalesce(sum(poin), 0) from poin_siswa where nis = p_nis and ta = p_ta and jenis = 'pelanggaran'),
    'total_prestasi',    (select coalesce(sum(poin), 0) from poin_siswa where nis = p_nis and ta = p_ta and jenis = 'prestasi'),
    'entri', v_entri
  );
end $$;

-- ========== 3. RPC: PINJAMAN BUKU MILIK MURID (by NIS) ==========
create or replace function pinjaman_murid(p_nis text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_rows json;
begin
  select coalesce(json_agg(json_build_object(
    'id', p.id,
    'kode_buku', p.kode_buku,
    'judul_buku', p.judul_buku,
    'tanggal_pinjam', p.tanggal_pinjam,
    'tenggat', p.tenggat,
    'tanggal_kembali', p.tanggal_kembali,
    'hari_telat', p.hari_telat,
    'denda', p.denda,
    'status', p.status,
    'ket', p.ket
  ) order by p.tanggal_pinjam desc nulls last), '[]'::json)
  into v_rows
  from (
    select * from perpus_pinjam
    where nis = p_nis
    order by tanggal_pinjam desc nulls last
    limit 100
  ) p;

  return json_build_object('status', 'success', 'pinjaman', v_rows);
end $$;

-- ========== 4. RPC: CATATAN WALI KELAS MILIK MURID ==========
create or replace function catatan_wali_murid(p_nis text, p_ta text, p_smt text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_catatan text;
begin
  select catatan into v_catatan
  from rapor_catatan
  where nis = p_nis and ta = p_ta and semester = p_smt
  limit 1;

  return json_build_object('status', 'success', 'catatan', coalesce(v_catatan, ''));
end $$;

-- ========== 5. GRANT EXECUTE RPC ==========
grant execute on function poin_murid(text, text) to anon, authenticated;
grant execute on function pinjaman_murid(text) to anon, authenticated;
grant execute on function catatan_wali_murid(text, text, text) to anon, authenticated;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [29/84] upgrade_20260921_rls_policies.sql
-- ============================================================
-- ============================================================
-- UPGRADE RLS POLICIES TABEL FASE 1-4 — 2026-09-21
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Latar belakang (hasil uji E2E 2026-09-21): RLS telah ENABLE di
-- tabel-tabel baru tetapi TANPA policy → semua insert/update/delete
-- ditolak (bahkan utk admin/guru authenticated), dan sebagian tabel
-- sensitif masih terbaca anon.
--
-- Isi:
--   1) RLS enable + policy "authenticated semua" pada 14 tabel Fase 1-4
--      (pola sama dgn tabel absensi: authenticated = penuh)
--   2) Policy anon: SELECT saja utk konten publik (pengumuman,
--      perpus_buku); sisanya revoke total dari anon
--   3) Penegasan grant authenticated (idempotent)
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. FUNGSI PEMBANTU (dinamis, dihapus di akhir) ==========
create temp table if not exists _tabel_fase (nama text);
delete from _tabel_fase;
insert into _tabel_fase (nama) values
  ('jadwal_ujian'), ('pengumuman'), ('rapor_catatan'), ('arsip_surat'),
  ('poin_kategori'), ('poin_siswa'), ('spp_tagihan'), ('kas_transaksi'), ('arsip_dokumen'),
  ('perpus_buku'), ('perpus_pinjam'), ('inv_barang'), ('inv_pinjam'),
  ('ppdb_calon');

-- ========== 2. RLS ENABLE + POLICY AUTHENTICATED (penuh) ==========
do $$
declare t text;
begin
  for t in select nama from _tabel_fase loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "fase_authenticated_all" on %I', t);
    execute format('create policy "fase_authenticated_all" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ========== 3. POLICY ANON: SELECT PUBLIK SAJA ==========
drop policy if exists "fase_anon_select" on pengumuman;
create policy "fase_anon_select" on pengumuman for select to anon using (true);

drop policy if exists "fase_anon_select" on perpus_buku;
create policy "fase_anon_select" on perpus_buku for select to anon using (true);

-- ========== 4. REVOKE ANON DARI TABEL SENSITIF ==========
-- Murid anon membaca data miliknya lewat RPC security definer
-- (poin_murid, pinjaman_murid, catatan_wali_murid, ambil_laporan_nilai_murid),
-- bukan langsung ke tabel — jadi tabel berikut ditutup total dari anon.
revoke all on poin_kategori, poin_siswa, spp_tagihan, kas_transaksi, arsip_dokumen,
             inv_barang, inv_pinjam, perpus_pinjam, jadwal_ujian, rapor_catatan,
             arsip_surat, ppdb_calon
  from anon;

-- ========== 5. PENEGASAN GRANT AUTHENTICATED ==========
grant select, insert, update, delete on
  jadwal_ujian, pengumuman, rapor_catatan, arsip_surat,
  poin_kategori, poin_siswa, spp_tagihan, kas_transaksi, arsip_dokumen,
  perpus_buku, perpus_pinjam, inv_barang, inv_pinjam, ppdb_calon
  to authenticated;

-- ========== 6. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [30/84] upgrade_20260922_nilai_murid_rpc.sql
-- ============================================================
-- ============================================================
-- UPGRADE RPC RAPOR MURID — 2026-09-22
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Latar belakang: RPC ambil_laporan_nilai_murid dibuat di luar repo
-- dan tidak ditemukan di DB produksi. Rapor murid kini memakai RPC
-- milik repo: ambil_rapor_nilai_murid (security definer, by-NIS,
-- pola sama dengan poin_murid/pinjaman_murid di upgrade_20260920).
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== RPC: NILAI RAPOR MILIK MURID (by NIS) ==========
create or replace function ambil_rapor_nilai_murid(p_nis text, p_ta text, p_smt text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_rows json;
begin
  select coalesce(json_agg(json_build_object(
    'kategori', r.kategori,
    'mapel', r.mapel,
    'ekskul', r.ekskul,
    'kelas', r.kelas,
    'tahun', r.tahun,
    'semester', r.semester,
    'data', r.data
  ) order by r.kategori, r.mapel), '[]'::json)
  into v_rows
  from (
    select kategori, mapel, ekskul, kelas, tahun, semester, data
    from nilai
    where nis = p_nis and tahun = p_ta and semester = p_smt
  ) r;

  return json_build_object('status', 'success', 'nilai', v_rows);
end $$;

-- ========== GRANT EXECUTE ==========
grant execute on function ambil_rapor_nilai_murid(text, text, text) to anon, authenticated;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [31/84] upgrade_20260926_ekskul_akses_guru.sql
-- ============================================================
-- ============================================================
-- UPGRADE: AKSES EKSTRAKURIKULER PENGURUS MURID + JABATAN EKSKUL MAP — 2026-09-26
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Isi:
--   1) Kolom baru akun.jabatan_ekskul_map (jsonb) — peta jabatan siswa
--      per ekskul: { "Paskibra": "Ketua", "Pramuka": "Sekretaris" }
--   2) Grant + policy anon (sesi murid password lokal = anon key):
--      - nilai                  : select/insert/update/delete (pengurus input nilai ekskul)
--      - sub_ekstrakurikuler    : insert/update/delete (kelola sub-ekskul)
--      - ekstrakurikuler        : insert/update (edit profil ekskul)
--      - agenda_ekskul          : delete (hapus agenda)
--      - dispensasi             : delete (hapus riwayat surat)
--      - akun                   : grant kolom jabatan_ekskul_map
--   3) RPC cek_login_murid dibuat ulang — kembalikan juga ekstrakurikuler
--      & jabatan_ekskul_map agar sesi murid lokal punya data keanggotaan.
--
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== 1. KOLOM PETA JABATAN EKSKUL ==========
alter table akun
  add column if not exists jabatan_ekskul_map jsonb default '{}'::jsonb;

-- ========== 2. GRANT & POLICY ANON (PENGURUS EKSKUL MURID) ==========
-- Catatan: keempat tabel ini RLS ENABLE — grant tanpa policy tetap ditolak,
-- jadi setiap grant disertai policy anon perintah yang sama.

-- 2a. nilai: pengurus ekskul mengisi nilai ekskul (murid lokal = anon key)
drop policy if exists "nilai_baca_anon" on nilai;
create policy "nilai_baca_anon" on nilai for select to anon using (true);
drop policy if exists "nilai_tulis_anon" on nilai;
create policy "nilai_tulis_anon" on nilai for insert to anon with check (true);
drop policy if exists "nilai_ubah_anon" on nilai;
create policy "nilai_ubah_anon" on nilai for update to anon using (true) with check (true);
drop policy if exists "nilai_hapus_anon" on nilai;
create policy "nilai_hapus_anon" on nilai for delete to anon using (true);
grant select, insert, update, delete on nilai to anon;

-- 2b. sub_ekstrakurikuler: kelola daftar sub & penempatan anggota
drop policy if exists "subekskul_tulis_anon" on sub_ekstrakurikuler;
create policy "subekskul_tulis_anon" on sub_ekstrakurikuler for insert to anon with check (true);
drop policy if exists "subekskul_ubah_anon" on sub_ekstrakurikuler;
create policy "subekskul_ubah_anon" on sub_ekstrakurikuler for update to anon using (true) with check (true);
drop policy if exists "subekskul_hapus_anon" on sub_ekstrakurikuler;
create policy "subekskul_hapus_anon" on sub_ekstrakurikuler for delete to anon using (true);
grant insert, update, delete on sub_ekstrakurikuler to anon;

-- 2c. ekstrakurikuler: edit profil ekskul (deskripsi, jadwal, pembina, logo)
drop policy if exists "ekskul_tulis_anon" on ekstrakurikuler;
create policy "ekskul_tulis_anon" on ekstrakurikuler for insert to anon with check (true);
drop policy if exists "ekskul_ubah_anon" on ekstrakurikuler;
create policy "ekskul_ubah_anon" on ekstrakurikuler for update to anon using (true) with check (true);
grant insert, update on ekstrakurikuler to anon;

-- 2d. agenda_ekskul: hapus agenda (select/insert/update sudah dari 20260905)
drop policy if exists "agenda_hapus_anon" on agenda_ekskul;
create policy "agenda_hapus_anon" on agenda_ekskul for delete to anon using (true);
grant delete on agenda_ekskul to anon;

-- 2d2. dispensasi: hapus riwayat surat oleh pengurus (select/insert sudah dari 20260905)
drop policy if exists "dispensasi_hapus_anon" on dispensasi;
create policy "dispensasi_hapus_anon" on dispensasi for delete to anon using (true);
grant delete on dispensasi to anon;

-- 2e. akun: kolom peta jabatan (disamping grant update(ekstrakurikuler) 20260905)
grant update (jabatan_ekskul_map) on akun to anon;

-- ========== 3. RPC LOGIN MURID: TAMBAH EKSKUL & JABATAN EKSKUL MAP ==========
create or replace function cek_login_murid(p_nis text, p_password text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r akun%rowtype;
  v_hash text;
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
    return json_build_object('status', 'success', 'akun', json_build_object(
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
    ));
  end if;
  return json_build_object('status', 'error', 'message', 'Password salah.');
end $$;

grant execute on function cek_login_murid(text, text) to anon, authenticated;

-- ========== 4. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [32/84] upgrade_20260927_sub_ekskul_anggota.sql
-- ============================================================
-- ============================================================
-- UPGRADE: SUB-EKSTRAKURIKULER KOLOM ANGGOTA (PERBAIKAN SIMPAN) — 2026-09-27
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Simpan Sub-Ekstrakurikuler gagal dengan error
--   "Could not find the 'anggota' column of 'sub_ekstrakurikuler'
--    in the schema cache" (PGRST204).
--   Penyebab: kolom "anggota" dibuat oleh upgrade_20260906_ekskul_surat_v2.sql
--   yang (a) belum terjalankan, atau (b) gagal di tengah run karena jebakan
--   re-run: langkah migrasi datanya membaca tabel anggota_sub_ekskul yang
--   sudah di-drop pada run sebelumnya → SQL Editor membatalkan seluruh run.
--
-- Isi (semua idempotent — aman dijalankan berulang):
--   1) sub_ekstrakurikuler: kolom "anggota" (jsonb, default '[]')
--   2) Migrasi data dari anggota_sub_ekskul → sub_ekstrakurikuler.anggota
--      DIJAGA to_regclass (aman walau tabel lama sudah terhapus)
--   3) Drop tabel anggota_sub_ekskul (tidak lagi dipakai)
--   4) Self-healing kolom fitur ekskul & surat (cegah PGRST204 serupa):
--      ekstrakurikuler (pembina_nip, jadwal, logo_url),
--      dispensasi (sub_ekskul, keterangan, detail, surat_id),
--      agenda_ekskul (hari + tanggal boleh NULL)
--   5) Reload cache skema PostgREST
--
-- Catatan: akses anon untuk pengurus ekskul murid ada di
--   upgrade_20260926_ekskul_akses_guru.sql — bila fitur pengurus murid
--   menyimpan sub/nilai/error "permission denied", jalankan file itu juga.
-- ============================================================

-- ========== 1. KOLOM ANGGOTA PADA SUB-EKSKUL ==========
alter table sub_ekstrakurikuler
  add column if not exists anggota jsonb not null default '[]'::jsonb;

-- ========== 2. MIGRASI DATA KEANGGOTAAN LAMA (ANTI-JEBAKAN RE-RUN) ==========
-- Hanya berjalan bila tabel anggota_sub_ekskul masih ada (to_regclass),
-- dan hanya mengisi baris sub yang kolom anggotanya masih kosong (idempoten).
do $$
declare
  v_kol text;
begin
  if to_regclass('public.anggota_sub_ekskul') is not null then
    -- [PERBAIKAN 42703] kolom penyimpan nama sub dideteksi otomatis:
    -- skema v1 memakai kolom "sub" (bukan "nama_sub") — deteksi via information_schema, dipakai via %I.
    select case
      when exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'anggota_sub_ekskul'
                     and column_name = 'nama_sub') then 'nama_sub'
      when exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'anggota_sub_ekskul'
                     and column_name = 'sub') then 'sub'
      else null
    end into v_kol;
    if v_kol is not null then
      execute format($f$
        update sub_ekstrakurikuler s
        set anggota = q.anggota
        from (
          select ekskul, %I as nama_sub, jsonb_agg(distinct nis order by nis) as anggota
          from anggota_sub_ekskul
          where coalesce(%I, '') <> ''
          group by ekskul, %I
        ) q
        where s.ekskul = q.ekskul
          and s.nama_sub = q.nama_sub
          and coalesce(s.anggota, '[]'::jsonb) = '[]'::jsonb
      $f$, v_kol, v_kol, v_kol);
    end if;
  end if;
end $$;

-- ========== 3. DROP TABEL LAMA ==========
drop table if exists anggota_sub_ekskul;

-- ========== 4. SELF-HEALING KOLOM FITUR EKSKUL & SURAT ==========
-- Semua "add column if not exists" — tidak mengubah kolom yang sudah ada.
alter table ekstrakurikuler
  add column if not exists pembina_nip text default '',
  add column if not exists jadwal text default '',
  add column if not exists logo_url text default '';

alter table dispensasi
  add column if not exists sub_ekskul text default '',
  add column if not exists keterangan text default '',
  add column if not exists detail jsonb default '{}'::jsonb,
  add column if not exists surat_id text default '';

alter table agenda_ekskul
  add column if not exists hari text default '';
alter table agenda_ekskul alter column tanggal drop not null;

-- ========== 5. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [33/84] upgrade_20260928_rpc_akun_murid.sql
-- ============================================================
-- ============================================================
-- UPGRADE: RPC AKUN MURID (PERBAIKAN SIMPAN PROFIL MURID) — 2026-09-28
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Menu murid "Data Akun Murid" → "Simpan Perubahan" gagal dengan error
--   "Could not find the function public.ubah_profil_murid(p_data, p_nis)
--    in the schema cache" (PGRST428).
--   Penyebab: RPC dari upgrade_20260914_akses_murid.sql belum terbentuk
--   di database. Menu yang sama juga memakai ubah_password_sendiri
--   (Ganti Password) dan menu "Laporan Nilai" memakai
--   ambil_laporan_nilai_murid — ketiganya dibuat ulang di sini.
--
-- Isi (semua idempotent — aman dijalankan berulang):
--   1) Self-healing kolom: absensi.gps (absen mandiri),
--      master_data."Jabatan Ekstrakurikuler" (Master Data + menu Ekskul),
--      akun.jabatan_ekskul (form murid & export)
--   2) RPC ubah_profil_murid        : murid edit data dirinya (whitelist)
--   3) RPC ubah_password_sendiri    : murid reset password sendiri
--                                     (verifikasi password lama)
--   4) RPC ambil_laporan_nilai_murid: murid (anon) membaca nilai miliknya
--   5) Grant execute + reload cache skema PostgREST
--
-- Murid lokal login dengan anon key (tanpa sesi Supabase Auth) — pola
-- sama dengan absensi & teman sejawat: verifikasi dilakukan di RPC
-- security-definer berdasarkan NIS pemanggil.
-- ============================================================

-- ========== 1. SELF-HEALING KOLOM ==========
alter table absensi add column if not exists gps text default '';

alter table master_data
  add column if not exists "Jabatan Ekstrakurikuler" text;

alter table akun
  add column if not exists jabatan_ekskul text;

-- ========== 2. RPC: EDIT PROFIL SENDIRI (WHITELIST) ==========
-- Murid hanya boleh mengubah kolom kontak & data pribadi.
-- NIS, NISN, nama, kelas, ekstrakurikuler, jabatan TIDAK bisa diubah.
create or replace function ubah_profil_murid(p_nis text, p_data jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_lahir date;
begin
  -- Verifikasi pemanggil benar-benar pemilik NIS (murid lokal/anon
  -- tidak punya auth.uid(), jadi kecocokan NIS + tipe murid adalah kuncinya).
  if not exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') then
    return json_build_object('status', 'error', 'message', 'Akun murid tidak ditemukan.');
  end if;

  v_lahir := nullif(trim(coalesce(p_data->>'tgl_lahir', '')), '')::date;

  update akun set
    email            = coalesce(p_data->>'email', email),
    no_telepon       = coalesce(p_data->>'no_telepon', no_telepon),
    alamat           = coalesce(p_data->>'alamat', alamat),
    nama_ayah        = coalesce(p_data->>'nama_ayah', nama_ayah),
    pekerjaan_ayah   = coalesce(p_data->>'pekerjaan_ayah', pekerjaan_ayah),
    nama_ibu         = coalesce(p_data->>'nama_ibu', nama_ibu),
    pekerjaan_ibu    = coalesce(p_data->>'pekerjaan_ibu', pekerjaan_ibu),
    nama_wali        = coalesce(p_data->>'nama_wali', nama_wali),
    tgl_lahir        = coalesce(v_lahir, tgl_lahir),
    jenis_kelamin    = coalesce(p_data->>'jenis_kelamin', jenis_kelamin),
    agama            = coalesce(p_data->>'agama', agama),
    golongan_darah   = coalesce(p_data->>'golongan_darah', golongan_darah)
  where nis_nip = p_nis and tipe = 'murid';

  return json_build_object('status', 'success', 'message', 'Profil berhasil diperbarui.');
end $$;

-- ========== 3. RPC: GANTI PASSWORD SENDIRI ==========
create or replace function ubah_password_sendiri(p_nis text, p_lama text, p_baru text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  if length(trim(coalesce(p_baru, ''))) < 6 then
    return json_build_object('status', 'error', 'message', 'Password baru minimal 6 karakter.');
  end if;

  select password_hash into v_hash from akun_kredensial where nis_nip = p_nis;
  if v_hash is null then
    return json_build_object('status', 'error', 'message', 'Kredensial tidak ditemukan. Hubungi admin.');
  end if;

  if crypt(coalesce(p_lama, ''), v_hash) <> v_hash then
    return json_build_object('status', 'error', 'message', 'Password lama salah.');
  end if;

  update akun_kredensial
    set password_hash = crypt(p_baru, gen_salt('bf', 10)), updated_at = now()
  where nis_nip = p_nis;

  return json_build_object('status', 'success', 'message', 'Password berhasil diganti.');
end $$;

-- ========== 4. RPC: LAPORAN NILAI MURID (READ-ONLY) ==========
create or replace function ambil_laporan_nilai_murid(p_nis text, p_tahun text, p_semester text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rows json;
begin
  if not exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') then
    return json_build_object('status', 'error', 'message', 'Akun murid tidak ditemukan.');
  end if;

  select coalesce(json_agg(row_to_json(t) order by t.kategori, t.mapel), '[]'::json)
    into v_rows
  from (
    select nis, nama, kategori, mapel, ekskul, kelas, tahun, semester, data
    from nilai
    where nis = p_nis
      and (p_tahun = '' or tahun = p_tahun)
      and (p_semester = '' or semester = p_semester)
  ) t;

  return json_build_object('status', 'success', 'nilai', v_rows);
end $$;

-- ========== 5. IZIN EKSEKUSI + RELOAD CACHE ==========
grant execute on function ubah_profil_murid(text, jsonb) to anon, authenticated;
grant execute on function ubah_password_sendiri(text, text, text) to anon, authenticated;
grant execute on function ambil_laporan_nilai_murid(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- [34/84] upgrade_20260929_jadwal_pelajaran.sql
-- ============================================================
-- ============================================================
-- UPGRADE: TABEL JADWAL PELAJARAN (PERBAIKAN SIMPAN JADWAL) — 2026-09-29
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Simpan "Jadwal Pelajaran" (menu Jadwal & Libur) gagal dengan error
--   semacam "Could not find the ... column of 'jadwal_pelajaran' in the
--   schema cache" (PGRST204).
--   Penyebab: tabel jadwal_pelajaran TIDAK PERNAH dibuat oleh migrasi repo
--   (ada sebagai sisa setup lama) — kolom yang ditulis aplikasi
--   ("ID Jadwal Murid", "Semester", dst.) belum tentu lengkap.
--
-- Isi (semua idempotent — aman dijalankan berulang):
--   1) create table if not exists jadwal_pelajaran (kolom persis yang
--      ditulis aplikasi) + add column if not exists per kolom
--      (memperbaiki tabel lama yang kolomnya kurang)
--   2) Index filter (Tahun, Tingkat/Kelas) & (ID Akun Guru, Tahun)
--   3) RLS + privilege: authenticated penuh (kelola jadwal),
--      anon select (absen mandiri murid & filter tanggal mingguan)
--   4) Reload cache skema PostgREST
-- ============================================================

-- ========== 1. TABEL + SELF-HEALING KOLOM ==========
create table if not exists jadwal_pelajaran (
  id uuid primary key default gen_random_uuid(),
  "ID Akun Guru" text default '',
  "ID Jadwal Murid" text default '',
  "Tahun" text default '',
  "Semester" text default '',
  "Waktu" text default '',
  "Mapel" text default '',
  "Tingkat/Kelas" text default '',
  created_at timestamptz not null default now()
);

alter table jadwal_pelajaran
  add column if not exists "ID Akun Guru" text default '',
  add column if not exists "ID Jadwal Murid" text default '',
  add column if not exists "Tahun" text default '',
  add column if not exists "Semester" text default '',
  add column if not exists "Waktu" text default '',
  add column if not exists "Mapel" text default '',
  add column if not exists "Tingkat/Kelas" text default '',
  add column if not exists created_at timestamptz default now();

create index if not exists idx_jadwal_filter on jadwal_pelajaran (Tahun, "Tingkat/Kelas");
create index if not exists idx_jadwal_guru on jadwal_pelajaran ("ID Akun Guru", Tahun);

-- ========== 2. RLS & PRIVILEGE ==========
alter table jadwal_pelajaran enable row level security;

drop policy if exists "jadwal_baca_auth" on jadwal_pelajaran;
create policy "jadwal_baca_auth" on jadwal_pelajaran
  for select to authenticated using (true);
drop policy if exists "jadwal_tulis_auth" on jadwal_pelajaran;
create policy "jadwal_tulis_auth" on jadwal_pelajaran
  for insert to authenticated with check (true);
drop policy if exists "jadwal_ubah_auth" on jadwal_pelajaran;
create policy "jadwal_ubah_auth" on jadwal_pelajaran
  for update to authenticated using (true) with check (true);
drop policy if exists "jadwal_hapus_auth" on jadwal_pelajaran;
create policy "jadwal_hapus_auth" on jadwal_pelajaran
  for delete to authenticated using (true);

-- Anon (murid password lokal) membaca jadwal utk absen mandiri & filter "Minggu Ini"
drop policy if exists "jadwal_baca_anon" on jadwal_pelajaran;
create policy "jadwal_baca_anon" on jadwal_pelajaran
  for select to anon using (true);

revoke all on table jadwal_pelajaran from anon, authenticated;
grant select, insert, update, delete on jadwal_pelajaran to authenticated;
grant select on jadwal_pelajaran to anon;

-- ========== 3. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [35/84] upgrade_20260920_fix_kolom_jadwal_pelajaran.sql
-- ============================================================
-- ============================================================
-- UPGRADE: PERBAIKAN NAMA KOLOM TABEL jadwal_pelajaran — 2026-09-20
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Simpan "Jadwal Pelajaran" (menu Jadwal & Libur → Tambah Jadwal) gagal
--   dengan error PGRST204: "Could not find the 'Mapel' column of
--   'jadwal_pelajaran' in the schema cache".
--
--   Penyebab: migrasi sebelumnya (upgrade_20260929_jadwal_pelajaran.sql)
--   membuat kolom Tahun, Semester, Waktu, Mapel TANPA tanda kutip ganda,
--   sehingga Postgres melipat nama kolom tsb menjadi huruf kecil semua
--   (tahun, semester, waktu, mapel). Aplikasi (web/js/app.js) mengirim
--   payload dengan key berhuruf kapital di awal ("Tahun", "Semester",
--   "Waktu", "Mapel") — PostgREST mencocokkan nama kolom secara case-
--   sensitive, sehingga kolom "Mapel" (dsb.) dianggap tidak ada.
--
-- Isi (idempotent — aman dijalankan berulang, tidak menghapus data):
--   1) Jika kolom lower-case lama (tahun/semester/waktu/mapel) ada dan
--      kolom ber-kapital ("Tahun"/dst.) belum ada → RENAME (data aman).
--   2) add column if not exists "Tahun"/"Semester"/"Waktu"/"Mapel" —
--      fallback untuk instalasi baru yang belum punya kolom sama sekali.
--   3) Reload cache skema PostgREST.
-- ============================================================

do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'jadwal_pelajaran' and column_name = 'tahun')
     and not exists (select 1 from information_schema.columns where table_name = 'jadwal_pelajaran' and column_name = 'Tahun') then
    alter table jadwal_pelajaran rename column tahun to "Tahun";
  end if;

  if exists (select 1 from information_schema.columns where table_name = 'jadwal_pelajaran' and column_name = 'semester')
     and not exists (select 1 from information_schema.columns where table_name = 'jadwal_pelajaran' and column_name = 'Semester') then
    alter table jadwal_pelajaran rename column semester to "Semester";
  end if;

  if exists (select 1 from information_schema.columns where table_name = 'jadwal_pelajaran' and column_name = 'waktu')
     and not exists (select 1 from information_schema.columns where table_name = 'jadwal_pelajaran' and column_name = 'Waktu') then
    alter table jadwal_pelajaran rename column waktu to "Waktu";
  end if;

  if exists (select 1 from information_schema.columns where table_name = 'jadwal_pelajaran' and column_name = 'mapel')
     and not exists (select 1 from information_schema.columns where table_name = 'jadwal_pelajaran' and column_name = 'Mapel') then
    alter table jadwal_pelajaran rename column mapel to "Mapel";
  end if;
end $$;

alter table jadwal_pelajaran
  add column if not exists "Tahun" text default '',
  add column if not exists "Semester" text default '',
  add column if not exists "Waktu" text default '',
  add column if not exists "Mapel" text default '';

notify pgrst, 'reload schema';

-- ============================================================
-- [36/84] upgrade_20260920b_lepas_notnull_legacy_jadwal_pelajaran.sql
-- ============================================================
-- ============================================================
-- UPGRADE: LEPAS NOT NULL KOLOM LEGACY TABEL jadwal_pelajaran — 2026-09-20
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Simpan "Jadwal Pelajaran" (menu Jadwal & Libur → Tambah Jadwal) gagal
--   dengan error: "null value in column "mata_pelajaran" of relation
--   "jadwal_pelajaran" violates not-null constraint".
--
--   Penyebab: tabel jadwal_pelajaran di database Anda adalah sisa setup
--   LAMA (dibuat manual di luar migrasi repo ini) yang punya kolom
--   snake_case sendiri (mis. mata_pelajaran, guru, kelas, hari, jam, dst.)
--   dengan constraint NOT NULL tanpa default. Migrasi repo hanya memakai
--   "add column if not exists" utk kolom yang DIPAKAI aplikasi ("Mapel",
--   "Tahun", dst.) — sehingga tidak pernah menyentuh/melonggarkan kolom
--   lama tsb. Karena aplikasi tidak pernah mengisi kolom lama itu, insert
--   ditolak Postgres.
--
--   Fix ini TIDAK menghapus kolom/data apa pun — hanya melepas constraint
--   NOT NULL pada kolom mana pun (selain "id") yang: (a) NOT NULL, (b)
--   tidak punya default, dan (c) BUKAN salah satu kolom yang dipakai
--   aplikasi. Dengan begitu kolom legacy apa pun (mata_pelajaran, guru,
--   kelas, hari, jam, dsb.) otomatis ikut diperbaiki tanpa perlu
--   menyebutkan nama-nama kolomnya satu per satu.
--
-- Aman dijalankan berulang (idempotent).
-- ============================================================

do $$
declare
  kolom record;
  kolom_dipakai_aplikasi text[] := array[
    'id', 'created_at',
    'ID Akun Guru', 'ID Jadwal Murid', 'Tahun', 'Semester', 'Waktu', 'Mapel', 'Tingkat/Kelas'
  ];
begin
  for kolom in
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jadwal_pelajaran'
      and is_nullable = 'NO'
      and column_default is null
      and column_name <> all (kolom_dipakai_aplikasi)
  loop
    execute format('alter table jadwal_pelajaran alter column %I drop not null', kolom.column_name);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- [37/84] upgrade_20260930_pengurus_tambah_anggota.sql
-- ============================================================
-- ============================================================
-- UPGRADE: PENGURUS EKSKUL DAFTARKAN ANGGOTA BARU — 2026-09-30
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Murid yang menjabat (pengurus) pada suatu ekstrakurikuler hanya bisa
--   menambahkan murid yang SUDAH punya akun sebagai anggota ekskul
--   (lewat UPDATE kolom ekstrakurikuler/jabatan_ekskul_map — akun anon
--   sudah punya izin update kolom tsb). Tidak bisa mendaftarkan siswa
--   yang BENAR-BENAR BARU (belum punya baris di tabel akun sama sekali)
--   karena akun anon tidak punya izin INSERT ke tabel akun, dan RPC
--   buat_akun_murid() mensyaratkan pemanggil bertipe admin.
--
-- ISI:
--   RPC daftar_anggota_ekskul_baru(p_pengurus_nis, p_ekskul, p_data):
--     - Verifikasi p_pengurus_nis adalah murid yang menjabat (punya entri
--       tidak kosong di jabatan_ekskul_map untuk p_ekskul).
--     - Validasi NIS baru belum terdaftar & nama lengkap wajib diisi.
--     - INSERT baris akun baru (tipe murid) + akun_kredensial (password
--       default '123456' bila tidak diisi), langsung diikutkan sebagai
--       anggota p_ekskul.
--   Dijalankan via security definer agar akun anon (murid lokal, tanpa
--   sesi Supabase Auth) tetap bisa memicu INSERT tanpa perlu grant insert
--   langsung ke tabel akun (mencegah insert sembarangan, mis. akun guru/admin palsu).
--
-- Idempotent — aman dijalankan berulang.
-- ============================================================

create or replace function daftar_anggota_ekskul_baru(p_pengurus_nis text, p_ekskul text, p_data jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis text;
  v_pass text;
  v_lahir date;
  v_jabatan_map jsonb;
begin
  -- Verifikasi pemanggil adalah murid yang menjabat (pengurus) pada p_ekskul.
  select jabatan_ekskul_map into v_jabatan_map
  from akun
  where nis_nip = p_pengurus_nis and tipe = 'murid';

  if v_jabatan_map is null or coalesce(trim(coalesce(v_jabatan_map->>p_ekskul, '')), '') = '' then
    return json_build_object('status', 'error', 'message', 'Hanya pengurus (menjabat) ekskul ini yang dapat mendaftarkan anggota baru.');
  end if;

  v_nis := trim(coalesce(p_data->>'nis', ''));
  if v_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;
  if coalesce(trim(coalesce(p_data->>'nama_lengkap', '')), '') = '' then
    return json_build_object('status', 'error', 'message', 'Nama lengkap wajib diisi.');
  end if;

  if exists (select 1 from akun where nis_nip = v_nis) then
    return json_build_object('status', 'error', 'message', 'NIS sudah terdaftar. Gunakan NIS lain atau tambahkan sebagai anggota lewat menu Tambah Anggota.');
  end if;

  v_pass := trim(coalesce(p_data->>'password', ''));
  if v_pass <> '' and length(v_pass) < 6 then
    return json_build_object('status', 'error', 'message', 'Password minimal 6 karakter.');
  end if;
  if v_pass = '' then v_pass := '123456'; end if;

  v_lahir := nullif(trim(coalesce(p_data->>'tgl_lahir', '')), '')::date;

  insert into akun (
    nama_lengkap, nis_nip, tipe, tahun_pelajaran, tingkat_kelas,
    ekstrakurikuler, tgl_lahir, jabatan_ekskul_map
  ) values (
    trim(p_data->>'nama_lengkap'), v_nis, 'murid',
    nullif(trim(coalesce(p_data->>'tahun_pelajaran', '')), ''),
    nullif(trim(coalesce(p_data->>'tingkat_kelas', '')), ''),
    p_ekskul,
    v_lahir,
    '{}'::jsonb
  );

  insert into akun_kredensial (nis_nip, password_hash)
  values (v_nis, crypt(v_pass, gen_salt('bf', 10)))
  on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();

  return json_build_object('status', 'success', 'message', 'Siswa baru berhasil didaftarkan sebagai anggota ' || p_ekskul || '.');
end $$;

-- ========== IZIN EKSEKUSI + RELOAD CACHE ==========
grant execute on function daftar_anggota_ekskul_baru(text, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- [38/84] upgrade_20260930b_fix_akun_grant_anon.sql
-- ============================================================
-- ============================================================
-- FIX: GRANT TABEL AKUN UNTUK ANON (PENGURUS EKSKUL MURID) — 2026-09-30 (b)
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Murid yang menjabat (mis. jabatan "Sekretaris") pada suatu
--   ekstrakurikuler gagal menambahkan SISWA YANG SUDAH PUNYA AKUN
--   sebagai anggota ekskul lewat menu Ekstrakurikuler → Tambah Anggota,
--   dengan pesan:
--     "0 anggota ditambahkan, N gagal: permission denied for table akun"
--
--   Penyebab: fungsi terapkanKeanggotaanEkskul() (web/js/app.js) memakai
--   sesi murid lokal (anon key, tanpa Supabase Auth) untuk membaca &
--   mengubah kolom akun.ekstrakurikuler:
--     select ekstrakurikuler from akun where nis_nip=... (perlu GRANT SELECT)
--     update akun set ekstrakurikuler=... (perlu GRANT UPDATE kolom)
--   Grant ini sudah pernah ditulis di fix_20260903_kredensial.sql,
--   upgrade_20260905_ekskul_pengurus.sql, dan upgrade_20260926_ekskul_akses_guru.sql
--   — tapi tampaknya belum (lengkap) ter-apply di database project ini.
--
-- ISI (idempotent — aman dijalankan berulang, TIDAK memakai revoke all
-- agar tidak menghapus privilege lain yang sudah berjalan):
--   1) grant select on akun to anon
--   2) grant update (ekstrakurikuler) on akun to anon
--   3) grant update (jabatan_ekskul_map) on akun to anon
--   4) Reload cache skema PostgREST
-- ============================================================

grant select on akun to anon;
grant update (ekstrakurikuler) on akun to anon;
grant update (jabatan_ekskul_map) on akun to anon;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [39/84] upgrade_20261001_kas_ekstrakurikuler.sql
-- ============================================================
-- ============================================================
-- UPGRADE 2026-10-01: KAS EKSTRAKURIKULER (Kas Umum + Kas Anggota)
-- Jalankan SELURUH file ini di Supabase Dashboard -> SQL Editor -> Run
--
-- LATAR BELAKANG:
--   Menu Ekstrakurikuler perlu 2 tab baru: "Kas Umum" (pemasukan/pengeluaran
--   operasional ekskul: belanja alat, konsumsi, dana BOS, sponsorship) dan
--   "Kas Anggota" (tagihan & pembayaran iuran harian/mingguan/bulanan siswa).
--
-- Akses (ditegakkan di client, web/js/app.js -> hakAksesKasUntuk):
--   - admin / guru (pembina ekskul terkait)      -> baca, tulis, edit
--   - murid dengan jabatan mengandung "Bendahara" -> baca, tulis, edit
--   - murid anggota biasa ekskul tsb              -> baca saja
--
-- Isi file ini:
--   1) Tabel kategori_kas       -- master kategori transaksi
--   2) Tabel kas_umum           -- transaksi kas operasional per ekskul
--   3) Tabel iuran_anggota      -- pembayaran iuran per anggota per periode
--   4) Trigger sync_iuran_ke_kas_umum -- iuran anggota otomatis tercatat sbg
--      pemasukan Kas Umum (sumber='iuran_anggota', ref_iuran_id)
--   5) RPC hitung_saldo_kas_umum(p_ekskul)       -- ringkasan Kas Umum
--   6) RPC matriks_iuran_anggota(p_ekskul, p_tahun, p_bulan) -- data matriks
--   7) Grant + RLS dasar (anon = sesi murid password lokal, sama seperti
--      modul ekskul lain di proyek ini)
--
-- CATATAN MANUAL (bukan SQL, lakukan di Supabase Dashboard):
--   Buat Storage bucket "kas-bukti" (public bucket, untuk lampiran nota/bukti
--   transaksi) melalui Dashboard -> Storage -> New bucket -> set Public.
-- ============================================================

-- ========== 1. TABEL KATEGORI_KAS ==========
create table if not exists kategori_kas (
  id uuid primary key default gen_random_uuid(),
  nama text not null unique,
  jenis text not null check (jenis in ('masuk', 'keluar', 'both')),
  aktif boolean not null default true,
  created_at timestamptz not null default now()
);

insert into kategori_kas (nama, jenis) values
  ('Iuran Anggota', 'masuk'),
  ('Dana BOS/Sekolah', 'masuk'),
  ('Sponsorship', 'masuk'),
  ('Donasi', 'masuk'),
  ('Belanja Alat', 'keluar'),
  ('Konsumsi', 'keluar'),
  ('Transport', 'keluar'),
  ('Lain-lain', 'both')
on conflict (nama) do nothing;

-- ========== 2. TABEL KAS_UMUM ==========
create table if not exists kas_umum (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  tanggal date not null default current_date,
  kategori_id uuid references kategori_kas(id) on delete set null,
  keterangan text,
  no_bukti text,
  bukti_url text,
  jumlah_masuk numeric(14, 2) not null default 0,
  jumlah_keluar numeric(14, 2) not null default 0,
  -- visibilitas: kombinasi dari 'pembina_jabatan','anggota','siswa_sekolah','guru','umum'
  visibilitas text[] not null default '{pembina_jabatan,anggota}',
  sumber text not null default 'manual' check (sumber in ('manual', 'iuran_anggota')),
  ref_iuran_id uuid,
  dibuat_oleh text,
  created_at timestamptz not null default now()
);
create index if not exists idx_kas_umum_ekskul_tgl on kas_umum (ekskul, tanggal desc);
create index if not exists idx_kas_umum_kategori on kas_umum (kategori_id);

-- Self-healing: kalau tabel sudah pernah dibuat versi lama, tambahkan kolom yang belum ada.
alter table kas_umum add column if not exists visibilitas text[] not null default '{pembina_jabatan,anggota}';
alter table kas_umum add column if not exists sumber text not null default 'manual';
alter table kas_umum add column if not exists ref_iuran_id uuid;
alter table kas_umum add column if not exists bukti_url text;

-- ========== 3. TABEL IURAN_ANGGOTA ==========
create table if not exists iuran_anggota (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  nis_nip text not null,
  periode_tipe text not null check (periode_tipe in ('harian', 'mingguan', 'bulanan')),
  periode_label text not null, -- contoh: 'M1', '2026-W05', '2026-01-15'
  tahun int not null,
  bulan int, -- 1-12
  nominal numeric(14, 2) not null,
  status text not null default 'lunas' check (status in ('lunas', 'menunggak')),
  tanggal_bayar date,
  metode text,
  dicatat_oleh text,
  created_at timestamptz not null default now(),
  unique (ekskul, nis_nip, periode_tipe, periode_label, tahun)
);
create index if not exists idx_iuran_ekskul_periode on iuran_anggota (ekskul, tahun, bulan);
create index if not exists idx_iuran_nis on iuran_anggota (nis_nip);

-- ========== 4. TRIGGER: SYNC IURAN ANGGOTA -> KAS UMUM ==========
create or replace function sync_iuran_ke_kas_umum()
returns trigger as $$
declare
  v_kat_id uuid;
begin
  select id into v_kat_id from kategori_kas where nama = 'Iuran Anggota' limit 1;
  insert into kas_umum (
    ekskul, tanggal, kategori_id, keterangan, jumlah_masuk,
    visibilitas, sumber, ref_iuran_id, dibuat_oleh
  ) values (
    new.ekskul,
    coalesce(new.tanggal_bayar, current_date),
    v_kat_id,
    'Iuran ' || new.periode_label || ' - ' || new.nis_nip,
    new.nominal,
    '{pembina_jabatan,anggota}',
    'iuran_anggota',
    new.id,
    new.dicatat_oleh
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_sync_iuran_kas_umum on iuran_anggota;
create trigger trg_sync_iuran_kas_umum
  after insert on iuran_anggota
  for each row execute function sync_iuran_ke_kas_umum();

-- Hapus baris iuran -> hapus juga baris kas_umum turunannya (jaga konsistensi saldo)
create or replace function sync_hapus_iuran_kas_umum()
returns trigger as $$
begin
  delete from kas_umum where ref_iuran_id = old.id and sumber = 'iuran_anggota';
  return old;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_sync_hapus_iuran_kas_umum on iuran_anggota;
create trigger trg_sync_hapus_iuran_kas_umum
  after delete on iuran_anggota
  for each row execute function sync_hapus_iuran_kas_umum();

-- ========== 5. RPC: RINGKASAN KAS UMUM ==========
create or replace function hitung_saldo_kas_umum(p_ekskul text)
returns json as $$
declare
  v_masuk numeric(14, 2);
  v_keluar numeric(14, 2);
begin
  select coalesce(sum(jumlah_masuk), 0), coalesce(sum(jumlah_keluar), 0)
    into v_masuk, v_keluar
    from kas_umum
   where ekskul = p_ekskul;

  return json_build_object(
    'ekskul', p_ekskul,
    'total_masuk', v_masuk,
    'total_keluar', v_keluar,
    'saldo', v_masuk - v_keluar
  );
end;
$$ language plpgsql stable security definer;

-- ========== 6. RPC: MATRIKS IURAN ANGGOTA ==========
-- Mengembalikan status pembayaran per anggota untuk tahun/bulan tertentu
-- (dipakai untuk render tabel matriks di tab "Kas Anggota" tanpa N+1 query).
create or replace function matriks_iuran_anggota(p_ekskul text, p_tahun int, p_bulan int)
returns json as $$
declare
  v_result json;
begin
  select coalesce(json_agg(row_to_json(t)), '[]'::json) into v_result
  from (
    select
      nis_nip,
      periode_tipe,
      periode_label,
      nominal,
      status,
      tanggal_bayar
    from iuran_anggota
    where ekskul = p_ekskul
      and tahun = p_tahun
      and (p_bulan is null or bulan = p_bulan)
    order by nis_nip, periode_label
  ) t;
  return v_result;
end;
$$ language plpgsql stable security definer;


-- ========== 7. GRANT + RLS (anon = sesi murid password lokal, pola proyek ini) ==========
alter table kategori_kas enable row level security;
alter table kas_umum enable row level security;
alter table iuran_anggota enable row level security;

drop policy if exists kategori_kas_select_all on kategori_kas;
create policy kategori_kas_select_all on kategori_kas for select using (true);

drop policy if exists kas_umum_select_all on kas_umum;
create policy kas_umum_select_all on kas_umum for select using (true);
drop policy if exists kas_umum_insert_all on kas_umum;
create policy kas_umum_insert_all on kas_umum for insert with check (true);
drop policy if exists kas_umum_update_all on kas_umum;
create policy kas_umum_update_all on kas_umum for update using (true);
drop policy if exists kas_umum_delete_all on kas_umum;
create policy kas_umum_delete_all on kas_umum for delete using (true);

drop policy if exists iuran_anggota_select_all on iuran_anggota;
create policy iuran_anggota_select_all on iuran_anggota for select using (true);
drop policy if exists iuran_anggota_insert_all on iuran_anggota;
create policy iuran_anggota_insert_all on iuran_anggota for insert with check (true);
drop policy if exists iuran_anggota_update_all on iuran_anggota;
create policy iuran_anggota_update_all on iuran_anggota for update using (true);
drop policy if exists iuran_anggota_delete_all on iuran_anggota;
create policy iuran_anggota_delete_all on iuran_anggota for delete using (true);

grant select on kategori_kas to anon, authenticated;
grant select, insert, update, delete on kas_umum to anon, authenticated;
grant select, insert, update, delete on iuran_anggota to anon, authenticated;
grant execute on function hitung_saldo_kas_umum(text) to anon, authenticated;
grant execute on function matriks_iuran_anggota(text, int, int) to anon, authenticated;

-- Reload cache skema PostgREST
notify pgrst, 'reload schema';


-- ============================================================
-- [40/84] upgrade_20261002_kas_masterdata_v2.sql
-- ============================================================
-- ============================================================
-- UPGRADE 2026-10-02: KAS EKSTRAKURIKULER v2 + MASTER DATA DRIVE LINKS
-- Jalankan SELURUH file ini di Supabase Dashboard -> SQL Editor -> Run
--
-- LATAR BELAKANG:
--   Lanjutan upgrade_20261001_kas_ekstrakurikuler.sql. Menambahkan:
--   1) Kolom link Google Drive manual (per kategori) di master_data,
--      dipakai al. sebagai target tombol "Upload Nota" di Kas Umum.
--   2) Kolom "deskripsi" pada kategori_kas (dipakai tombol "Kategori").
--   3) Tabel baru deskripsi_iuran (master judul+deskripsi iuran, dipakai
--      tombol "Deskripsi Iuran" & pilihan deskripsi pembayaran).
--   4) Kolom nama_siswa pada kas_umum (pengganti tampilan NIS di kolom
--      Keterangan) + kolom deskripsi_pembayaran pada iuran_anggota.
--   5) Update trigger sync_iuran_ke_kas_umum agar mengisi nama_siswa.
--   6) Tabel notifikasi (notifikasi transaksi kas ke murid/pembina/bendahara).
--
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. MASTER DATA: KOLOM LINK GOOGLE DRIVE (per kategori) ==========
alter table master_data add column if not exists "Drive Akun Murid" text;
alter table master_data add column if not exists "Drive Akun Guru" text;
alter table master_data add column if not exists "Drive Mata Pelajaran" text;
alter table master_data add column if not exists "Drive Ekstrakurikuler" text;
alter table master_data add column if not exists "Drive Administrasi Sekolah" text;

-- ========== 2. KATEGORI_KAS: KOLOM DESKRIPSI ==========
alter table kategori_kas add column if not exists deskripsi text default '';

-- ========== 3. TABEL DESKRIPSI_IURAN ==========
create table if not exists deskripsi_iuran (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  judul text not null,
  deskripsi text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_deskripsi_iuran_ekskul on deskripsi_iuran (ekskul);

-- ========== 4. KAS_UMUM: KOLOM NAMA_SISWA ==========
alter table kas_umum add column if not exists nama_siswa text;

-- ========== 5. IURAN_ANGGOTA: KOLOM DESKRIPSI_PEMBAYARAN ==========
alter table iuran_anggota add column if not exists deskripsi_pembayaran text default '';

-- ========== 6. UPDATE TRIGGER: SYNC IURAN ANGGOTA -> KAS UMUM (isi nama_siswa) ==========
create or replace function sync_iuran_ke_kas_umum()
returns trigger as $$
declare
  v_kat_id uuid;
  v_nama text;
begin
  select id into v_kat_id from kategori_kas where nama = 'Iuran Anggota' limit 1;
  select nama_lengkap into v_nama from akun where nis_nip = new.nis_nip and tipe = 'murid' limit 1;
  insert into kas_umum (
    ekskul, tanggal, kategori_id, keterangan, nama_siswa, jumlah_masuk,
    visibilitas, sumber, ref_iuran_id, dibuat_oleh
  ) values (
    new.ekskul,
    coalesce(new.tanggal_bayar, current_date),
    v_kat_id,
    coalesce(new.deskripsi_pembayaran, '') || ' Iuran ' || new.periode_label,
    coalesce(v_nama, new.nis_nip),
    new.nominal,
    '{pembina_jabatan,anggota}',
    'iuran_anggota',
    new.id,
    new.dicatat_oleh
  );
  return new;
end;
$$ language plpgsql security definer;

-- ========== 7. TABEL NOTIFIKASI ==========
create table if not exists notifikasi (
  id uuid primary key default gen_random_uuid(),
  ekskul text,
  target_nis_nip text,       -- nis siswa yang disebut dalam transaksi (kosong = notifikasi umum ekskul)
  untuk_peran text[] not null default '{}', -- kombinasi: 'murid','pembina','bendahara'
  judul text not null,
  pesan text not null,
  dibaca boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifikasi_target on notifikasi (target_nis_nip);
create index if not exists idx_notifikasi_ekskul on notifikasi (ekskul, created_at desc);

-- ========== 8. GRANT + RLS ==========
alter table deskripsi_iuran enable row level security;
alter table notifikasi enable row level security;

drop policy if exists deskripsi_iuran_select_all on deskripsi_iuran;
create policy deskripsi_iuran_select_all on deskripsi_iuran for select using (true);
drop policy if exists deskripsi_iuran_insert_all on deskripsi_iuran;
create policy deskripsi_iuran_insert_all on deskripsi_iuran for insert with check (true);
drop policy if exists deskripsi_iuran_update_all on deskripsi_iuran;
create policy deskripsi_iuran_update_all on deskripsi_iuran for update using (true);
drop policy if exists deskripsi_iuran_delete_all on deskripsi_iuran;
create policy deskripsi_iuran_delete_all on deskripsi_iuran for delete using (true);

drop policy if exists notifikasi_select_all on notifikasi;
create policy notifikasi_select_all on notifikasi for select using (true);
drop policy if exists notifikasi_insert_all on notifikasi;
create policy notifikasi_insert_all on notifikasi for insert with check (true);
drop policy if exists notifikasi_update_all on notifikasi;
create policy notifikasi_update_all on notifikasi for update using (true);
drop policy if exists notifikasi_delete_all on notifikasi;
create policy notifikasi_delete_all on notifikasi for delete using (true);

grant select, insert, update, delete on deskripsi_iuran to anon, authenticated;
grant select, insert, update, delete on notifikasi to anon, authenticated;

-- Reload cache skema PostgREST
notify pgrst, 'reload schema';

-- ============================================================
-- [41/84] upgrade_20261003_kas_anggota_rentang.sql
-- ============================================================
-- ============================================================
-- UPGRADE 2026-10-03: KAS ANGGOTA - FILTER RENTANG TANGGAL
-- Jalankan SELURUH file ini di Supabase Dashboard -> SQL Editor -> Run
--
-- LATAR BELAKANG:
--   Tab "Kas Anggota" (Menu Ekstrakurikuler) semula hanya bisa difilter per
--   Tahun + Bulan (RPC matriks_iuran_anggota). Diganti menjadi filter rentang
--   "Dari tanggal" s.d. "Sampai tanggal" agar konsisten dengan Kas Umum.
--
-- Isi file ini:
--   1) RPC iuran_anggota_rentang(p_ekskul, p_dari, p_sampai) -- data iuran per
--      rentang tanggal efektif (tanggal_bayar bila ada, atau tanggal turunan
--      dari tahun/bulan/periode_label untuk baris yang masih menunggak).
--
-- Idempotent — aman dijalankan berulang.
-- ============================================================

create or replace function iuran_anggota_rentang(p_ekskul text, p_dari date default null, p_sampai date default null)
returns json as $$
declare
  v_result json;
begin
  select coalesce(json_agg(row_to_json(t) order by t.tgl_efektif), '[]'::json) into v_result
  from (
    select
      i.id,
      i.nis_nip,
      i.periode_tipe,
      i.periode_label,
      i.tahun,
      i.bulan,
      i.deskripsi_pembayaran,
      i.nominal,
      i.status,
      i.tanggal_bayar,
      coalesce(
        i.tanggal_bayar,
        case
          when i.periode_tipe = 'harian' and i.periode_label ~ '^\d{4}-\d{2}-\d{2}$'
            then i.periode_label::date
          when i.periode_tipe = 'mingguan'
            then make_date(i.tahun, coalesce(i.bulan, 1), 1)
          else make_date(i.tahun, coalesce(i.bulan, 1), 1)
        end
      ) as tgl_efektif
    from iuran_anggota i
    where i.ekskul = p_ekskul
  ) t
  where (p_dari is null or t.tgl_efektif >= p_dari)
    and (p_sampai is null or t.tgl_efektif <= p_sampai);
  return v_result;
end;
$$ language plpgsql stable security definer;

grant execute on function iuran_anggota_rentang(text, date, date) to anon, authenticated;

-- Reload cache skema PostgREST
notify pgrst, 'reload schema';

-- ============================================================
-- [42/84] upgrade_20261005_kas_anggota_cicil.sql
-- ============================================================
-- ============================================================
-- UPGRADE 2026-10-05: KAS ANGGOTA - STATUS "CICIL" + TANGGAL AKHIR BAYAR
-- Jalankan SELURUH file ini di Supabase Dashboard -> SQL Editor -> Run
--
-- LATAR BELAKANG:
--   Tab "Kas Anggota" (Menu Ekstrakurikuler) hanya mengenal status
--   'lunas'/'menunggak'. Perlu status 'cicil' agar anggota bisa membayar
--   sebagian, dengan pencatatan akumulasi nominal yang sudah dibayar dan
--   sisa tagihan. Baris berstatus 'menunggak' juga perlu tenggat waktu
--   pembayaran (tanggal_akhir_bayar) yang ditentukan saat pencatatan iuran.
--
-- Isi file ini:
--   1) iuran_anggota.status: tambah nilai 'cicil' pada check constraint.
--   2) iuran_anggota.nominal_dibayar: akumulasi nominal yang sudah dibayar
--      (dipakai saat status 'cicil'; 0 bila 'menunggak', = nominal bila 'lunas').
--   3) iuran_anggota.tanggal_akhir_bayar: tenggat pembayaran, diisi saat
--      status 'menunggak' atau 'cicil'.
--   4) RPC iuran_anggota_rentang: sertakan kolom baru di hasil.
--
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. KOLOM BARU ==========
alter table iuran_anggota add column if not exists nominal_dibayar numeric(14, 2) not null default 0;
alter table iuran_anggota add column if not exists tanggal_akhir_bayar date;

-- Data lama: baris 'lunas' dianggap sudah dibayar penuh.
update iuran_anggota set nominal_dibayar = nominal where status = 'lunas' and nominal_dibayar = 0;

-- ========== 2. STATUS 'cicil' PADA CHECK CONSTRAINT ==========
alter table iuran_anggota drop constraint if exists iuran_anggota_status_check;
alter table iuran_anggota add constraint iuran_anggota_status_check
  check (status in ('lunas', 'menunggak', 'cicil'));

-- ========== 3. RPC iuran_anggota_rentang: SERTAKAN KOLOM BARU ==========
create or replace function iuran_anggota_rentang(p_ekskul text, p_dari date default null, p_sampai date default null)
returns json as $$
declare
  v_result json;
begin
  select coalesce(json_agg(row_to_json(t) order by t.tgl_efektif), '[]'::json) into v_result
  from (
    select
      i.id,
      i.nis_nip,
      i.periode_tipe,
      i.periode_label,
      i.tahun,
      i.bulan,
      i.deskripsi_pembayaran,
      i.nominal,
      i.status,
      i.tanggal_bayar,
      i.nominal_dibayar,
      i.tanggal_akhir_bayar,
      coalesce(
        i.tanggal_bayar,
        case
          when i.periode_tipe = 'harian' and i.periode_label ~ '^\d{4}-\d{2}-\d{2}$'
            then i.periode_label::date
          when i.periode_tipe = 'mingguan'
            then make_date(i.tahun, coalesce(i.bulan, 1), 1)
          else make_date(i.tahun, coalesce(i.bulan, 1), 1)
        end
      ) as tgl_efektif
    from iuran_anggota i
    where i.ekskul = p_ekskul
  ) t
  where (p_dari is null or t.tgl_efektif >= p_dari)
    and (p_sampai is null or t.tgl_efektif <= p_sampai);
  return v_result;
end;
$$ language plpgsql stable security definer;

grant execute on function iuran_anggota_rentang(text, date, date) to anon, authenticated;

-- Reload cache skema PostgREST
notify pgrst, 'reload schema';

-- ============================================================
-- [43/84] upgrade_20261006_import_murid_akses_guru.sql
-- ============================================================
-- ============================================================
-- UPGRADE: AKSES IMPORT DATA MURID UNTUK GURU (WALI KELAS/PEMBINA) — 2026-10-06
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Menu "Data Akun Murid" → "Import" sebelumnya hanya boleh dipakai admin
--   (RPC import_akun_murid menolak selain tipe = 'admin'). Sekarang guru
--   yang berperan sebagai wali kelas ATAU pembina ekstrakurikuler (kolom
--   flat akun.wali_kelas / akun.ekstrakurikuler terisi) juga diizinkan
--   import data murid, selaras dengan akses menu "Data Akun Murid" yang
--   memang sudah terbuka untuk admin & guru.
--
-- Isi (idempotent — aman dijalankan berulang):
--   1) RPC import_akun_murid dibuat ulang dengan pemeriksaan akses baru:
--        - tipe = 'admin'                              -> boleh
--        - tipe = 'guru' DAN (wali_kelas terisi ATAU
--          ekstrakurikuler terisi)                      -> boleh
--        - selain itu                                   -> ditolak
--      Logika upsert baris data TIDAK berubah.
--   2) Grant execute + reload cache skema PostgREST
-- ============================================================

create or replace function import_akun_murid(p_rows jsonb, p_default_password text default '123456')
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  el jsonb;
  v_nis text;
  v_pass text;
  v_lahir date;
  v_tipe text;
  v_wali text;
  v_ekskul text;
  v_ok int := 0; v_upd int := 0; v_fail int := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  select tipe, coalesce(wali_kelas, ''), coalesce(ekstrakurikuler, '')
    into v_tipe, v_wali, v_ekskul
  from akun where user_id = auth.uid();

  if coalesce(v_tipe, '') = 'admin' then
    -- admin: akses penuh
    null;
  elsif coalesce(v_tipe, '') = 'guru' and (v_wali <> '' or v_ekskul <> '') then
    -- guru wali kelas atau pembina ekskul: boleh import
    null;
  else
    return json_build_object('status', 'error', 'message', 'Hanya admin atau guru (wali kelas/pembina ekskul) yang boleh import data murid.');
  end if;

  for el in select * from jsonb_array_elements(p_rows) loop
    v_nis := trim(coalesce(el->>'nis', ''));
    if v_nis = '' then
      v_fail := v_fail + 1;
      v_errors := v_errors || jsonb_build_array('Baris tanpa NIS dilewati.');
      continue;
    end if;
    v_pass := trim(coalesce(el->>'password', ''));
    if v_pass = '' then v_pass := coalesce(trim(p_default_password), '123456'); end if;
    if length(v_pass) < 6 then v_pass := '123456'; end if;

    begin
      v_lahir := nullif(trim(coalesce(el->>'tgl_lahir', '')), '')::date;
      if exists (select 1 from akun where nis_nip = v_nis and tipe = 'murid') then
        update akun set
          nama_lengkap     = coalesce(nullif(trim(el->>'nama_lengkap'), ''), nama_lengkap),
          nisn             = coalesce(nullif(trim(el->>'nisn'), ''), nisn),
          tahun_pelajaran  = coalesce(nullif(trim(el->>'tahun_pelajaran'), ''), tahun_pelajaran),
          semester         = coalesce(nullif(trim(el->>'semester'), ''), semester),
          jenis_kelamin    = coalesce(nullif(trim(el->>'jenis_kelamin'), ''), jenis_kelamin),
          tgl_lahir        = coalesce(v_lahir, tgl_lahir),
          agama            = coalesce(nullif(trim(el->>'agama'), ''), agama),
          golongan_darah   = coalesce(nullif(trim(el->>'golongan_darah'), ''), golongan_darah),
          tingkat_kelas    = coalesce(nullif(trim(el->>'tingkat_kelas'), ''), tingkat_kelas),
          jabatan          = coalesce(nullif(trim(el->>'jabatan'), ''), jabatan),
          email            = coalesce(nullif(trim(el->>'email'), ''), email),
          no_telepon       = coalesce(nullif(trim(el->>'no_telepon'), ''), no_telepon),
          ekstrakurikuler  = coalesce(nullif(trim(el->>'ekstrakurikuler'), ''), ekstrakurikuler),
          nama_ayah        = coalesce(nullif(trim(el->>'nama_ayah'), ''), nama_ayah),
          pekerjaan_ayah   = coalesce(nullif(trim(el->>'pekerjaan_ayah'), ''), pekerjaan_ayah),
          nama_ibu         = coalesce(nullif(trim(el->>'nama_ibu'), ''), nama_ibu),
          pekerjaan_ibu    = coalesce(nullif(trim(el->>'pekerjaan_ibu'), ''), pekerjaan_ibu),
          nama_wali        = coalesce(nullif(trim(el->>'nama_wali'), ''), nama_wali),
          alamat           = coalesce(nullif(trim(el->>'alamat'), ''), alamat),
          catatan_khusus   = coalesce(nullif(trim(el->>'catatan_khusus'), ''), catatan_khusus)
        where nis_nip = v_nis and tipe = 'murid';
        v_upd := v_upd + 1;
      else
        insert into akun (
          nama_lengkap, nis_nip, tipe, nisn, tahun_pelajaran, semester,
          jenis_kelamin, tgl_lahir, agama, golongan_darah,
          email, tingkat_kelas, jabatan, no_telepon, ekstrakurikuler,
          nama_ayah, pekerjaan_ayah, nama_ibu, pekerjaan_ibu, nama_wali,
          alamat, catatan_khusus
        ) values (
          coalesce(nullif(trim(el->>'nama_lengkap'), ''), 'Tanpa Nama'),
          v_nis, 'murid',
          nullif(trim(coalesce(el->>'nisn', '')), ''),
          nullif(trim(coalesce(el->>'tahun_pelajaran', '')), ''),
          nullif(trim(coalesce(el->>'semester', '')), ''),
          nullif(trim(coalesce(el->>'jenis_kelamin', '')), ''),
          v_lahir,
          nullif(trim(coalesce(el->>'agama', '')), ''),
          nullif(trim(coalesce(el->>'golongan_darah', '')), ''),
          nullif(trim(coalesce(el->>'email', '')), ''),
          nullif(trim(coalesce(el->>'tingkat_kelas', '')), ''),
          nullif(trim(coalesce(el->>'jabatan', '')), ''),
          nullif(trim(coalesce(el->>'no_telepon', '')), ''),
          nullif(trim(coalesce(el->>'ekstrakurikuler', '')), ''),
          nullif(trim(coalesce(el->>'nama_ayah', '')), ''),
          nullif(trim(coalesce(el->>'pekerjaan_ayah', '')), ''),
          nullif(trim(coalesce(el->>'nama_ibu', '')), ''),
          nullif(trim(coalesce(el->>'pekerjaan_ibu', '')), ''),
          nullif(trim(coalesce(el->>'nama_wali', '')), ''),
          nullif(trim(coalesce(el->>'alamat', '')), ''),
          nullif(trim(coalesce(el->>'catatan_khusus', '')), '')
        );
        v_ok := v_ok + 1;
      end if;
      insert into akun_kredensial (nis_nip, password_hash)
      values (v_nis, crypt(v_pass, gen_salt('bf', 10)))
      on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();
    exception when others then
      v_fail := v_fail + 1;
      v_errors := v_errors || jsonb_build_array('NIS ' || v_nis || ': ' || SQLERRM);
    end;
  end loop;

  return json_build_object(
    'status', 'success',
    'ditambahkan', v_ok,
    'diperbarui', v_upd,
    'gagal', v_fail,
    'detail_gagal', v_errors
  );
end $$;

-- ========== IZIN EKSEKUSI + RELOAD CACHE ==========
grant execute on function import_akun_murid(jsonb, text) to authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- [44/84] upgrade_20261006b_add_anggota_akses_admin_pembina.sql
-- ============================================================
-- ============================================================
-- UPGRADE: AKSES ADMIN & PEMBINA TAMBAH ANGGOTA EKSKUL — 2026-10-06 (b)
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Modal "Tambah Anggota" / "Hapus Anggota" Ekstrakurikuler memakai
--   terapkanKeanggotaanEkskul() (web/js/app.js) yang melakukan SELECT +
--   UPDATE langsung ke tabel akun. Admin & guru/pembina masuk lewat
--   Supabase Auth (sesi `authenticated`) sedangkan kolom `ekstrakurikuler`
--   hanya di-grant untuk SELECT/UPDATE ke `anon` — sehingga sesi
--   `authenticated` justru gagal dengan:
--     "permission denied for table akun"
--
-- ISI:
--   RPC security definer ubah_anggota_ekskul(p_pemanggil, p_ekskul,
--   p_nis_list, p_tambah):
--     - Verifikasi pemanggil: ADMIN selalu boleh; GURU bila WALI KELAS
--       (kolom wali_kelas terisi) atau PEMBINA ekskul tsb (p_ekskul ada di
--       kolom ekstrakurikuler guru); MURID bila
--       jabatan_ekskul_map->>p_ekskul terisi (pengurus).
--     - Setiap NIS pada p_nis_list: gabung/buang nama ekskul pada kolom
--       ekstrakurikuler murid (anti-duplikat, sama persis dengan logika
--       gabungEkskulSiswa/buangEkskulSiswa di app.js).
--     - Dijalankan security definer, jadi sesi anon (murid lokal) maupun
--       authenticated (admin/pembina) mendapat hak yang sama.
--   Frontend memanggil RPC ini lebih dulu; bila RPC belum ada (PGRST202)
--   otomatis fallback ke jalur lama SELECT+UPDATE.
--
--  PEMBARUAN akses (deadline akses "Tambah Anggota"): akses guru DIPERSEMPIT
--  hanya untuk Wali kelas & Pembina ekskul tsb — tidak lagi "semua guru".
--  Senada dengan bolehKelolaAnggotaEkskul() di web/js/app.js.
--
-- Idempotent (create or replace) — aman dijalankan berulang.
-- ============================================================

create or replace function ubah_anggota_ekskul(p_pemanggil text, p_ekskul text, p_nis_list text[], p_tambah boolean)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tipe text;
  v_jabatan_map jsonb;
  v_wali_kelas text;
  v_ekstra text;
  v_nis text;
  v_ekstra_siswa text;
  v_baru text;
  v_total int := 0;
begin
  -- 1) Identitas pemanggil
  select tipe, jabatan_ekskul_map, wali_kelas, ekstrakurikuler
  into v_tipe, v_jabatan_map, v_wali_kelas, v_ekstra
  from akun
  where nis_nip = p_pemanggil;

  if not found then
    return json_build_object('status', 'error', 'message', 'Akun pemanggil tidak ditemukan.');
  end if;

  -- 2) Verifikasi hak akses per tipe
  if v_tipe = 'admin' then
    -- admin selalu boleh
    null;
  elsif v_tipe = 'guru' then
    -- Guru WALI KELAS (kolom wali_kelas terisi) atau PEMBINA ekskul ini
    -- (p_ekskul termasuk kolom ekstrakurikuler guru) yang boleh mengubah
    -- anggota. Guru biasa (bukan wali kelas / bukan pembina ekskul tsb)
    -- TIDAK diizinkan — senada dengan bolehKelolaAnggotaEkskul() di app.js.
    if coalesce(trim(coalesce(v_wali_kelas, '')), '') = ''
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
    -- pengurus: punya jabatan (tidak kosong) pada ekskul ini
    if v_jabatan_map is null or coalesce(trim(coalesce(v_jabatan_map->>p_ekskul, '')), '') = '' then
      return json_build_object('status', 'error', 'message', 'Hanya pengurus (menjabat) ' || p_ekskul || ' yang dapat mengubah anggota.');
    end if;
  else
    return json_build_object('status', 'error', 'message', 'Tipe akun pemanggil tidak dikenal.');
  end if;

  -- 3) Terapkan per NIS (gabung/buang nama ekskul, anti-duplikat)
  if p_nis_list is null then
    p_nis_list := array[]::text[];
  end if;

  foreach v_nis in array p_nis_list loop
    if trim(coalesce(v_nis, '')) = '' then continue; end if;

    select ekstrakurikuler into v_ekstra_siswa
    from akun
    where nis_nip = v_nis and tipe = 'murid'
    for update;

    if not found then continue; end if;

    if p_tambah then
      if lower(trim(p_ekskul)) = any (
        select lower(trim(x)) from unnest(string_to_array(v_ekstra_siswa, ',')) as x where trim(x) <> ''
      ) then
        v_baru := v_ekstra_siswa; -- sudah jadi anggota → tidak ada perubahan
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
        from unnest(string_to_array(v_ekstra_siswa, ',')) as t(x)
        where trim(x) <> '' and lower(trim(x)) <> lower(trim(p_ekskul))
      ) s;
      v_baru := coalesce(v_baru, '');
    end if;

    if coalesce(v_baru, '') = coalesce(v_ekstra_siswa, '') then continue; end if;

    update akun
    set ekstrakurikuler = v_baru
    where nis_nip = v_nis;

    v_total := v_total + 1;
  end loop;

  return json_build_object('status', 'success', 'total', v_total);
end $$;

-- ========== IZIN EKSEKUSI + RELOAD CACHE ==========
grant execute on function ubah_anggota_ekskul(text, text, text[], boolean) to anon, authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- [45/84] upgrade_20261006c_kunci_absen_ekskul_pengurus.sql
-- ============================================================
-- ============================================================
-- UPGRADE: PENGURUS EKSKUL GANTI KUNCI ABSEN (CAPTCHA) — 2026-10-06 (c)
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Panel "Kunci Absen Siswa (Captcha)" pada modal absensi hanya dirender
--   untuk sesi admin/guru (web/js/app.js showModalEditAbsen). Murid yang
--   menjabat sebagai pengurus ekskul tidak melihat panel sama sekali.
--   Selain itu, data kunci/captcha disimpan di BARIS PEMBINA
--   (updateKunciServer: .eq('nis_nip', nipGuru)); murid tidak punya
--   privilese UPDATE baris pembina (grant anon hanya kolom ekstrakurikuler
--   & jabatan_ekskul_map).
--
-- ISI:
--   RPC security definer ganti_kunci_absen_ekskul(p_pemanggil, p_ekskul,
--   p_captcha, p_kunci):
--     - Verifikasi pemanggil adalah MURID yang menjabat (jabatan_ekskul_map
--       memuat p_ekskul, tidak kosong).
--     - Update kolom captcha & kunci_absen pada SEMUA baris guru/admin yang
--       membina p_ekskul (kecocokan kolom ekstrakurikuler, atau mapel) —
--       sama dengan basis validasi absen_mandiri di utils.js, sehingga
--       "absen mandiri" dengan captcha baru langsung berlaku.
--     - Kunci dinormalisasi: selain 'BUKA' → 'TUTUP'; captcha di-upper-case
--       (validasi absen_mandiri case-insensitive).
--   Penulisan tetap satu-satunya untuk pengurus murid (tanpa grant UPDATE
--   lebar ke tabel akun).
--
-- Idempotent (create or replace) — aman dijalankan berulang.
-- ============================================================

create or replace function ganti_kunci_absen_ekskul(p_pemanggil text, p_ekskul text, p_captcha text, p_kunci text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_jabatan_map jsonb;
  v_total int;
begin
  -- 1) Pemanggil harus murid yang menjabat (pengurus) pada p_ekskul.
  select jabatan_ekskul_map into v_jabatan_map
  from akun
  where nis_nip = p_pemanggil and tipe = 'murid';

  if not found then
    return json_build_object('status', 'error', 'message', 'Hanya murid pengurus ekskul yang dapat mengganti kunci absen.');
  end if;

  if v_jabatan_map is null or coalesce(trim(coalesce(v_jabatan_map->>p_ekskul, '')), '') = '' then
    return json_build_object('status', 'error', 'message', 'Anda bukan pengurus (menjabat) pada ' || p_ekskul || '.');
  end if;

  -- 2) Perbarui kunci/captcha pada baris PEMBINA (guru/admin) ekskul ini.
  --    Kecocokan identik dengan validasi absen_mandiri: ekstrakurikuler
  --    berisi p_ekskul, atau mapel mengandung p_ekskul.
  update akun
  set captcha = upper(trim(coalesce(p_captcha, ''))),
      kunci_absen = case when p_kunci = 'BUKA' then 'BUKA' else 'TUTUP' end,
      updated_at = now()
  where tipe in ('guru', 'admin')
    and (
      lower(trim(p_ekskul)) = any (
        select lower(trim(x)) from unnest(string_to_array(ekstrakurikuler, ',')) as x where trim(x) <> ''
      )
      or mapel ilike '%' || p_ekskul || '%'
    );

  get diagnostics v_total = row_count;

  if v_total = 0 then
    return json_build_object('status', 'error', 'message', 'Pembina ' || p_ekskul || ' tidak ditemukan — kunci absen tidak diubah.');
  end if;

  return json_build_object('status', 'success', 'total', v_total, 'message', 'Kunci absen ' || p_ekskul || ' diperbarui.');
end $$;

-- ========== IZIN EKSEKUSI + RELOAD CACHE ==========
grant execute on function ganti_kunci_absen_ekskul(text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- [46/84] upgrade_20261007_akun_hp_ortu.sql
-- ============================================================
-- ============================================================
-- UPGRADE: NO HP ORANG TUA (AKUN MURID) — 2026-10-07
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Isi:
--   1) kolom no_telepon_ortu tabel akun (No HP Orang Tua, murid)
--   2) RPC buat_akun_murid dibuat ulang agar menyimpan no_telepon_ortu
--      (pola sama dengan kolom opsional lain: kosong = dikosongkan saat EDIT).
--
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== 1. KOLOM NO HP ORANG TUA ==========
alter table akun
  add column if not exists no_telepon_ortu text;

-- ========== 2. RPC: TAMBAH / EDIT AKUN MURID (dengan no_telepon_ortu) ==========
create or replace function buat_akun_murid(p_data jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis text;
  v_pass text;
  v_lahir date;
begin
  if coalesce((select tipe from akun where user_id = auth.uid()), '') <> 'admin' then
    return json_build_object('status', 'error', 'message', 'Hanya admin yang boleh mengelola akun murid.');
  end if;

  v_nis := trim(coalesce(p_data->>'nis', ''));
  if v_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;
  if coalesce(trim(coalesce(p_data->>'nama_lengkap', '')), '') = '' then
    return json_build_object('status', 'error', 'message', 'Nama lengkap wajib diisi.');
  end if;

  v_pass := trim(coalesce(p_data->>'password', ''));
  if v_pass <> '' and length(v_pass) < 6 then
    return json_build_object('status', 'error', 'message', 'Password minimal 6 karakter.');
  end if;

  v_lahir := nullif(trim(coalesce(p_data->>'tgl_lahir', '')), '')::date;

  if exists (select 1 from akun where nis_nip = v_nis and tipe = 'murid') then
    -- EDIT: perbarui profil; kolom opsional kosong = dikosongkan; password hanya bila diisi
    update akun set
      nama_lengkap     = coalesce(nullif(trim(p_data->>'nama_lengkap'), ''), nama_lengkap),
      nisn             = nullif(trim(p_data->>'nisn'), ''),
      tahun_pelajaran  = nullif(trim(p_data->>'tahun_pelajaran'), ''),
      semester         = nullif(trim(p_data->>'semester'), ''),
      tingkat_kelas    = nullif(trim(p_data->>'tingkat_kelas'), ''),
      jenis_kelamin    = nullif(trim(p_data->>'jenis_kelamin'), ''),
      tgl_lahir        = v_lahir,
      agama            = nullif(trim(p_data->>'agama'), ''),
      golongan_darah   = nullif(trim(p_data->>'golongan_darah'), ''),
      jabatan          = nullif(trim(p_data->>'jabatan'), ''),
      jabatan_ekskul   = nullif(trim(p_data->>'jabatan_ekskul'), ''),
      email            = nullif(trim(p_data->>'email'), ''),
      no_telepon       = nullif(trim(p_data->>'no_telepon'), ''),
      no_telepon_ortu  = nullif(trim(p_data->>'no_telepon_ortu'), ''),
      ekstrakurikuler  = nullif(trim(p_data->>'ekstrakurikuler'), ''),
      nama_ayah        = nullif(trim(p_data->>'nama_ayah'), ''),
      pekerjaan_ayah   = nullif(trim(p_data->>'pekerjaan_ayah'), ''),
      nama_ibu         = nullif(trim(p_data->>'nama_ibu'), ''),
      pekerjaan_ibu    = nullif(trim(p_data->>'pekerjaan_ibu'), ''),
      nama_wali        = nullif(trim(p_data->>'nama_wali'), ''),
      alamat           = nullif(trim(p_data->>'alamat'), ''),
      catatan_khusus   = nullif(trim(p_data->>'catatan_khusus'), '')
    where nis_nip = v_nis and tipe = 'murid';

    if v_pass <> '' then
      insert into akun_kredensial (nis_nip, password_hash)
      values (v_nis, crypt(v_pass, gen_salt('bf', 10)))
      on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();
    end if;
    return json_build_object('status', 'success', 'message', 'Data murid diperbarui.', 'aksi', 'update');
  else
    -- TAMBAH: password wajib (kosong → default 123456)
    if v_pass = '' then v_pass := '123456'; end if;
    insert into akun (
      nama_lengkap, nis_nip, tipe, nisn, tahun_pelajaran, semester,
      jenis_kelamin, tgl_lahir, agama, golongan_darah,
      email, no_telepon, no_telepon_ortu, ekstrakurikuler, tingkat_kelas, jabatan, jabatan_ekskul,
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
      nullif(trim(coalesce(p_data->>'no_telepon_ortu', '')), ''),
      nullif(trim(coalesce(p_data->>'ekstrakurikuler', '')), ''),
      nullif(trim(coalesce(p_data->>'tingkat_kelas', '')), ''),
      nullif(trim(coalesce(p_data->>'jabatan', '')), ''),
      nullif(trim(coalesce(p_data->>'jabatan_ekskul', '')), ''),
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

-- ========== 3. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [47/84] upgrade_20261007_jadwal_guru_custom.sql
-- ============================================================
-- ============================================================
-- UPGRADE: JADWAL PELAJARAN — GURU TANPA AKUN (CUSTOM) — 2026-10-07
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi: kolom "Guru Custom" di jadwal_pelajaran, dipakai saat slot jadwal
--      diajar oleh guru yang belum punya akun di tabel akun — admin bisa
--      mengetik nama guru secara manual (dipakai jg di legenda per Jurusan
--      pada tampilan "Lihat Jadwal → Per Kelas (Jurusan)").
-- Idempotent — aman dijalankan berulang.
-- ============================================================

alter table jadwal_pelajaran
  add column if not exists "Guru Custom" text default '';

notify pgrst, 'reload schema';

-- ============================================================
-- [48/84] upgrade_20261007_kalender_tipe_custom.sql
-- ============================================================
-- ============================================================
-- UPGRADE: KALENDER PENDIDIKAN — NAMA KATEGORI CUSTOM — 2026-10-07
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi: kolom tipe_custom di kalender_pendidikan, dipakai saat tipe = 'custom'
--      untuk menyimpan nama kategori bebas yang diketik admin (menggantikan
--      label baku "Kegiatan (Custom)" di tabel data & legenda kalender).
-- Idempotent — aman dijalankan berulang.
-- ============================================================

alter table kalender_pendidikan
  add column if not exists tipe_custom text default '';

notify pgrst, 'reload schema';

-- ============================================================
-- [49/84] upgrade_20261008_ekskul_menu_lengkap.sql
-- ============================================================
-- ============================================================
-- UPGRADE 2026-10-08: MENU EKSTRAKURIKULER LENGKAP
-- Jalankan SELURUH file ini di Supabase Dashboard -> SQL Editor -> Run
--
-- LATAR BELAKANG:
--   Menu Ekstrakurikuler dirombak jadi 5 grup tab baru + fitur Info Ekskul:
--   A) Info Ekskul: Pengumuman & Berita per-ekskul, notifikasi in-app untuk
--      Pengumuman/Agenda/Materi/Sertifikat, icon link folder Google Drive.
--   B) Grup tab baru (menggantikan tab lama, isi lama TIDAK dipindah datanya,
--      hanya diakses dari lokasi baru di UI):
--      1. "Persuratan & Proposal": arsip surat masuk/keluar, generator surat
--         otomatis, Surat Dispensasi (tabel lama dipakai ulang), Proposal
--         Kegiatan, LPJ.
--      2. "Profil & Anggota": tambah profil Pelatih + Formulir/Berkas
--         Pendaftaran anggota baru.
--      3. "Keuangan & Kas": Kas Umum & Kas Anggota (tabel lama dipakai ulang),
--         Inventaris ekskul (barang, kondisi, buku peminjaman alat).
--      4. "Jurnal & Program Kerja": Program Kerja, Jurnal Kegiatan/Logbook,
--         Modul/Materi Pembelajaran (tabel materi_tugas_ekskul dipakai ulang).
--      5. "Arsip & Penilaian": Nilai (RPC lama dipakai ulang via UI), Buku
--         Prestasi/Penghargaan (tabel sertifikat_prestasi_ekskul dipakai ulang).
--
-- Akses ditegakkan di client (web/js/app.js -> hakAksesEkskulUntuk), pola sama
-- dengan tabel ekskul lain di proyek ini: admin/guru/pengurus(pembina/pejabat)
-- = tulis+edit+baca, anggota = baca saja, RLS di DB longgar (anon = sesi murid
-- password lokal, sama seperti modul ekskul lain).
--
-- Isi file ini (semua idempotent — aman dijalankan berulang):
--   1) ekstrakurikuler: kolom drive_url, pelatih (jsonb array)
--   2) pengumuman_ekskul     -- Pengumuman & Berita per ekskul
--   3) materi_tugas_ekskul   -- Materi & Tugas / Modul Pembelajaran
--   4) sertifikat_prestasi_ekskul -- Sertifikat & Prestasi / Buku Prestasi
--   5) arsip_surat_ekskul    -- Arsip Surat Masuk & Keluar + Surat Otomatis
--   6) proposal_kegiatan_ekskul -- Proposal Kegiatan
--   7) lpj_ekskul            -- Laporan Pertanggungjawaban
--   8) pendaftaran_ekskul    -- Formulir & Berkas Pendaftaran anggota baru
--   9) proker_ekskul         -- Program Kerja Tahunan/Semester
--  10) jurnal_ekskul         -- Jurnal Kegiatan / Buku Harian (Logbook)
--  11) inventaris_ekskul + peminjaman_alat_ekskul -- Inventaris & peminjaman
--  12) RPC catat_notifikasi_ekskul(...) -- helper insert ke tabel notifikasi
--  13) Grant + RLS (anon & authenticated = penuh, sama pola modul ekskul lain)
--
-- CATATAN MANUAL (bukan SQL, lakukan di Supabase Dashboard):
--   Buat Storage bucket "ekskul-berkas" (public) untuk lampiran berkas
--   pendaftaran, bukti LPJ, lampiran proposal, dsb.
-- ============================================================

-- ========== 1. EKSTRAKURIKULER: kolom baru ==========
alter table ekstrakurikuler add column if not exists drive_url text default '';
alter table ekstrakurikuler add column if not exists pelatih jsonb not null default '[]'::jsonb;
-- pelatih: [{ "nama": "...", "spesialisasi": "...", "no_telepon": "...", "keterangan": "..." }, ...]

-- ========== 2. PENGUMUMAN & BERITA PER EKSKUL ==========
create table if not exists pengumuman_ekskul (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  judul text not null,
  isi text default '',
  lampiran_url text default '',
  penulis text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_pengumuman_ekskul_ekskul on pengumuman_ekskul (ekskul, created_at desc);

-- ========== 3. MATERI & TUGAS / MODUL PEMBELAJARAN ==========
create table if not exists materi_tugas_ekskul (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  jenis text not null default 'materi' check (jenis in ('materi', 'tugas')),
  judul text not null,
  deskripsi text default '',
  file_url text default '',
  tenggat date,
  penulis text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_materi_tugas_ekskul_ekskul on materi_tugas_ekskul (ekskul, created_at desc);

-- ========== 4. SERTIFIKAT & PRESTASI / BUKU PRESTASI ==========
create table if not exists sertifikat_prestasi_ekskul (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  nis_nip text default '',
  nama text not null,
  jenis text not null default 'prestasi' check (jenis in ('prestasi', 'sertifikat')),
  judul text not null,
  tingkat text default '',
  peringkat text default '',
  tanggal date,
  file_url text default '',
  keterangan text default '',
  penulis text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_sertifikat_prestasi_ekskul_ekskul on sertifikat_prestasi_ekskul (ekskul, tanggal desc);

-- ========== 5. ARSIP SURAT MASUK & KELUAR + SURAT OTOMATIS ==========
create table if not exists arsip_surat_ekskul (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  arah text not null default 'keluar' check (arah in ('masuk', 'keluar')),
  jenis text default '',            -- utk surat keluar otomatis: kode template
  nomor_surat text default '',
  perihal text not null,
  tanggal date not null default current_date,
  asal_tujuan text default '',      -- asal (surat masuk) / tujuan (surat keluar)
  isi_ringkas text default '',
  payload jsonb default '{}'::jsonb, -- data pengisi template surat otomatis
  file_url text default '',
  dibuat_oleh text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_arsip_surat_ekskul_ekskul on arsip_surat_ekskul (ekskul, tanggal desc);

-- ========== 6. PROPOSAL KEGIATAN ==========
create table if not exists proposal_kegiatan_ekskul (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  judul_kegiatan text not null,
  latar_belakang text default '',
  tujuan text default '',
  waktu_tempat text default '',
  anggaran numeric(14, 2) default 0,
  status text not null default 'diajukan' check (status in ('diajukan', 'disetujui', 'ditolak', 'selesai')),
  file_url text default '',
  dibuat_oleh text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_proposal_kegiatan_ekskul_ekskul on proposal_kegiatan_ekskul (ekskul, created_at desc);

-- ========== 7. LAPORAN PERTANGGUNGJAWABAN (LPJ) ==========
create table if not exists lpj_ekskul (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  proposal_id uuid references proposal_kegiatan_ekskul(id) on delete set null,
  judul_kegiatan text not null,
  ringkasan_pelaksanaan text default '',
  realisasi_anggaran numeric(14, 2) default 0,
  file_url text default '',
  dibuat_oleh text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_lpj_ekskul_ekskul on lpj_ekskul (ekskul, created_at desc);


-- ========== 8. FORMULIR & BERKAS PENDAFTARAN ANGGOTA BARU ==========
create table if not exists pendaftaran_ekskul (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  nis_nip text default '',
  nama text not null,
  kelas text default '',
  no_telepon text default '',
  alasan text default '',
  berkas_url text default '',
  status text not null default 'menunggu' check (status in ('menunggu', 'diterima', 'ditolak')),
  catatan text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_pendaftaran_ekskul_ekskul on pendaftaran_ekskul (ekskul, created_at desc);

-- ========== 9. PROGRAM KERJA (PROKER) TAHUNAN/SEMESTER ==========
create table if not exists proker_ekskul (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  ta text default '',
  semester text default '',
  program text not null,
  tujuan text default '',
  sasaran text default '',
  jadwal_rencana text default '',
  penanggung_jawab text default '',
  status text not null default 'rencana' check (status in ('rencana', 'berjalan', 'selesai', 'batal')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_proker_ekskul_ekskul on proker_ekskul (ekskul, ta, semester);

-- ========== 10. JURNAL KEGIATAN / BUKU HARIAN (LOGBOOK) ==========
create table if not exists jurnal_ekskul (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  tanggal date not null default current_date,
  kegiatan text not null,
  catatan text default '',
  jumlah_hadir int default 0,
  penulis text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_jurnal_ekskul_ekskul on jurnal_ekskul (ekskul, tanggal desc);

-- ========== 11. INVENTARIS EKSKUL + BUKU PEMINJAMAN ALAT ==========
create table if not exists inventaris_ekskul (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  nama_barang text not null,
  kode text default '',
  jumlah int not null default 1,
  kondisi text not null default 'Baik' check (kondisi in ('Baik', 'Rusak Ringan', 'Rusak Berat', 'Hilang')),
  lokasi text default '',
  tahun_perolehan int,
  keterangan text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_inventaris_ekskul_ekskul on inventaris_ekskul (ekskul);

create table if not exists peminjaman_alat_ekskul (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  barang_id uuid references inventaris_ekskul(id) on delete set null,
  nama_barang_snapshot text default '',
  peminjam text not null,
  jumlah int not null default 1,
  tanggal_pinjam date not null default current_date,
  tanggal_kembali date,
  kondisi_kembali text default '',
  status text not null default 'dipinjam' check (status in ('dipinjam', 'kembali')),
  catatan text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_peminjaman_alat_ekskul_ekskul on peminjaman_alat_ekskul (ekskul, status);

-- ========== 12. RPC: CATAT NOTIFIKASI EKSKUL (in-app, bukan push OS) ==========
-- Dipakai saat ada Pengumuman & Berita / Agenda Kegiatan / Materi & Tugas /
-- Sertifikat & Prestasi baru pada suatu ekskul, agar anggota melihatnya lewat
-- widget notifikasi dashboard (tabel "notifikasi" sudah ada sejak
-- upgrade_20261002_kas_masterdata_v2.sql).
create or replace function catat_notifikasi_ekskul(
  p_ekskul text, p_judul text, p_pesan text, p_untuk_peran text[] default '{murid}'
)
returns void as $$
begin
  insert into notifikasi (judul, pesan, ekskul, untuk_peran, created_at)
  values (p_judul, p_pesan, p_ekskul, p_untuk_peran, now());
end;
$$ language plpgsql security definer;

-- ========== 13. GRANT + RLS (anon = sesi murid password lokal, pola proyek ini) ==========
alter table pengumuman_ekskul enable row level security;
alter table materi_tugas_ekskul enable row level security;
alter table sertifikat_prestasi_ekskul enable row level security;
alter table arsip_surat_ekskul enable row level security;
alter table proposal_kegiatan_ekskul enable row level security;
alter table lpj_ekskul enable row level security;
alter table pendaftaran_ekskul enable row level security;
alter table proker_ekskul enable row level security;
alter table jurnal_ekskul enable row level security;
alter table inventaris_ekskul enable row level security;
alter table peminjaman_alat_ekskul enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'pengumuman_ekskul', 'materi_tugas_ekskul', 'sertifikat_prestasi_ekskul',
    'arsip_surat_ekskul', 'proposal_kegiatan_ekskul', 'lpj_ekskul',
    'pendaftaran_ekskul', 'proker_ekskul', 'jurnal_ekskul',
    'inventaris_ekskul', 'peminjaman_alat_ekskul'
  ]
  loop
    execute format('drop policy if exists %I_select_all on %I', t, t);
    execute format('create policy %I_select_all on %I for select using (true)', t, t);
    execute format('drop policy if exists %I_insert_all on %I', t, t);
    execute format('create policy %I_insert_all on %I for insert with check (true)', t, t);
    execute format('drop policy if exists %I_update_all on %I', t, t);
    execute format('create policy %I_update_all on %I for update using (true)', t, t);
    execute format('drop policy if exists %I_delete_all on %I', t, t);
    execute format('create policy %I_delete_all on %I for delete using (true)', t, t);
    execute format('grant select, insert, update, delete on %I to anon, authenticated', t);
  end loop;
end $$;

grant execute on function catat_notifikasi_ekskul(text, text, text, text[]) to anon, authenticated;

-- Reload cache skema PostgREST
notify pgrst, 'reload schema';



-- ============================================================
-- [50/84] upgrade_20261010_jadwal_piket_ekskul.sql
-- ============================================================
-- ============================================================
-- UPGRADE 2026-10-10: JADWAL PIKET EKSTRAKURIKULER
-- Jalankan SELURUH file ini di Supabase Dashboard -> SQL Editor -> Run
--
-- LATAR BELAKANG:
--   Tab "Jurnal & Program Kerja" di Menu Ekstrakurikuler diberi sub-tab
--   baru "Jadwal Piket". Jadwal disusun oleh admin/guru/pengurus:
--   pilih hari aktif (custom hari), generate otomatis (anggota dibagi
--   merata, 1 kali piket per minggu), lalu susun ulang via drag & drop
--   pada tabel (kolom = hari, baris = slot Piket 1..n). Hasil jadwal
--   tampil read-only di Info Ekskul (di atas kartu Pengurus).
--
--   Akses ditegakkan di client (web/js/app.js -> hakAksesEkskulUntuk),
--   pola sama dengan modul ekskul lain: admin/guru/pengurus = tulis+edit,
--   anggota = baca. RLS di DB longgar (anon = sesi murid password lokal).
--
-- Isi file ini (idempotent — aman dijalankan berulang):
--   1) Tabel jadwal_piket_ekskul — 1 baris per ekskul:
--      - ekskul : nama ekskul (unique)
--      - hari   : jsonb array hari aktif, cth ["Senin","Rabu","Jumat"]
--      - piket  : jsonb objek hari -> array [{nis, nama}, ...]
--   2) Grant + RLS (anon & authenticated = penuh, sama pola modul ekskul lain)
-- ============================================================

-- ========== 1. TABEL JADWAL PIKET ==========
create table if not exists jadwal_piket_ekskul (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null unique,
  hari jsonb not null default '["Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"]'::jsonb,
  piket jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- hari : ["Senin", ...] (urut DAFTAR_HARI_PIKET di app.js)
-- piket: { "Senin": [{ "nis": "...", "nama": "..." }, ...], ... }

-- ========== 2. GRANT + RLS (anon = sesi murid password lokal, pola proyek ini) ==========
alter table jadwal_piket_ekskul enable row level security;

do $$
begin
  drop policy if exists jadwal_piket_ekskul_select_all on jadwal_piket_ekskul;
  create policy jadwal_piket_ekskul_select_all on jadwal_piket_ekskul for select using (true);
  drop policy if exists jadwal_piket_ekskul_insert_all on jadwal_piket_ekskul;
  create policy jadwal_piket_ekskul_insert_all on jadwal_piket_ekskul for insert with check (true);
  drop policy if exists jadwal_piket_ekskul_update_all on jadwal_piket_ekskul;
  create policy jadwal_piket_ekskul_update_all on jadwal_piket_ekskul for update using (true);
  drop policy if exists jadwal_piket_ekskul_delete_all on jadwal_piket_ekskul;
  create policy jadwal_piket_ekskul_delete_all on jadwal_piket_ekskul for delete using (true);
  execute 'grant select, insert, update, delete on jadwal_piket_ekskul to anon, authenticated';
end $$;

-- Reload cache skema PostgREST
notify pgrst, 'reload schema';

-- ============================================================
-- [51/84] upgrade_20261011_akun_murid_foto_medsos.sql
-- ============================================================
-- ============================================================
-- UPGRADE: FOTO MURID (GOOGLE DRIVE), MEDIA SOSIAL & ALAMAT MAPS — 2026-10-11
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Isi:
--   1) Kolom baru tabel akun:
--        url_foto     text   → URL foto siswa (Google Drive shared link / thumbnail)
--        alamat_maps  text   → Tautan Google Maps alamat tempat tinggal siswa
--        media_sosial jsonb  → [{ "label": "Instagram", "url": "https://..." }, ...]
--   2) RPC buat_akun_murid  dibuat ulang agar menyimpan ketiga kolom baru
--   3) RPC ubah_profil_murid dibuat ulang agar murid bisa mengisi sendiri
--      alamat_maps & media_sosial (whitelist — NIS/nama/kelas tetap terkunci).
--   4) RPC baru simpan_foto_murid: satu-satunya pintu penulisan akun.url_foto
--      (dipakai Edge Function 'unggah-foto-murid'; verifikasi: admin atau
--      murid pemilik NIS).
--
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== 1. KOLOM BARU ==========
alter table akun
  add column if not exists url_foto text,
  add column if not exists alamat_maps text,
  add column if not exists media_sosial jsonb default '[]'::jsonb;

-- ========== 2. RPC: TAMBAH / EDIT AKUN MURID (url_foto, alamat_maps, media_sosial) ==========
create or replace function buat_akun_murid(p_data jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis text;
  v_pass text;
  v_lahir date;
  v_medsos jsonb;
begin
  if coalesce((select tipe from akun where user_id = auth.uid()), '') <> 'admin' then
    return json_build_object('status', 'error', 'message', 'Hanya admin yang boleh mengelola akun murid.');
  end if;

  v_nis := trim(coalesce(p_data->>'nis', ''));
  if v_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;
  if coalesce(trim(coalesce(p_data->>'nama_lengkap', '')), '') = '' then
    return json_build_object('status', 'error', 'message', 'Nama lengkap wajib diisi.');
  end if;

  v_pass := trim(coalesce(p_data->>'password', ''));
  if v_pass <> '' and length(v_pass) < 6 then
    return json_build_object('status', 'error', 'message', 'Password minimal 6 karakter.');
  end if;

  v_lahir := nullif(trim(coalesce(p_data->>'tgl_lahir', '')), '')::date;

  -- Media sosial: hanya terima array json — nilai tak valid dianggap kosong.
  if jsonb_typeof(p_data->'media_sosial') = 'array' then
    v_medsos := p_data->'media_sosial';
  else
    v_medsos := '[]'::jsonb;
  end if;

  if exists (select 1 from akun where nis_nip = v_nis and tipe = 'murid') then
    -- EDIT: perbarui profil; kolom opsional kosong = dikosongkan; password hanya bila diisi
    update akun set
      nama_lengkap     = coalesce(nullif(trim(p_data->>'nama_lengkap'), ''), nama_lengkap),
      nisn             = nullif(trim(p_data->>'nisn'), ''),
      tahun_pelajaran  = nullif(trim(p_data->>'tahun_pelajaran'), ''),
      semester         = nullif(trim(p_data->>'semester'), ''),
      tingkat_kelas    = nullif(trim(p_data->>'tingkat_kelas'), ''),
      jenis_kelamin    = nullif(trim(p_data->>'jenis_kelamin'), ''),
      tgl_lahir        = v_lahir,
      agama            = nullif(trim(p_data->>'agama'), ''),
      golongan_darah   = nullif(trim(p_data->>'golongan_darah'), ''),
      jabatan          = nullif(trim(p_data->>'jabatan'), ''),
      jabatan_ekskul   = nullif(trim(p_data->>'jabatan_ekskul'), ''),
      email            = nullif(trim(p_data->>'email'), ''),
      no_telepon       = nullif(trim(p_data->>'no_telepon'), ''),
      no_telepon_ortu  = nullif(trim(p_data->>'no_telepon_ortu'), ''),
      ekstrakurikuler  = nullif(trim(p_data->>'ekstrakurikuler'), ''),
      nama_ayah        = nullif(trim(p_data->>'nama_ayah'), ''),
      pekerjaan_ayah   = nullif(trim(p_data->>'pekerjaan_ayah'), ''),
      nama_ibu         = nullif(trim(p_data->>'nama_ibu'), ''),
      pekerjaan_ibu    = nullif(trim(p_data->>'pekerjaan_ibu'), ''),
      nama_wali        = nullif(trim(p_data->>'nama_wali'), ''),
      alamat           = nullif(trim(p_data->>'alamat'), ''),
      catatan_khusus   = nullif(trim(p_data->>'catatan_khusus'), ''),
      url_foto         = case when p_data ? 'url_foto'
                              then nullif(trim(p_data->>'url_foto'), '')
                              else url_foto end,
      alamat_maps      = nullif(trim(p_data->>'alamat_maps'), ''),
      media_sosial     = v_medsos
    where nis_nip = v_nis and tipe = 'murid';

    if v_pass <> '' then
      insert into akun_kredensial (nis_nip, password_hash)
      values (v_nis, crypt(v_pass, gen_salt('bf', 10)))
      on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();
    end if;
    return json_build_object('status', 'success', 'message', 'Data murid diperbarui.', 'aksi', 'update');
  else
    -- TAMBAH: password wajib (kosong → default 123456)
    if v_pass = '' then v_pass := '123456'; end if;
    insert into akun (
      nama_lengkap, nis_nip, tipe, nisn, tahun_pelajaran, semester,
      jenis_kelamin, tgl_lahir, agama, golongan_darah,
      email, no_telepon, no_telepon_ortu, ekstrakurikuler, tingkat_kelas, jabatan, jabatan_ekskul,
      nama_ayah, pekerjaan_ayah, nama_ibu, pekerjaan_ibu, nama_wali,
      alamat, catatan_khusus, url_foto, alamat_maps, media_sosial
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
      nullif(trim(coalesce(p_data->>'no_telepon_ortu', '')), ''),
      nullif(trim(coalesce(p_data->>'ekstrakurikuler', '')), ''),
      nullif(trim(coalesce(p_data->>'tingkat_kelas', '')), ''),
      nullif(trim(coalesce(p_data->>'jabatan', '')), ''),
      nullif(trim(coalesce(p_data->>'jabatan_ekskul', '')), ''),
      nullif(trim(coalesce(p_data->>'nama_ayah', '')), ''),
      nullif(trim(coalesce(p_data->>'pekerjaan_ayah', '')), ''),
      nullif(trim(coalesce(p_data->>'nama_ibu', '')), ''),
      nullif(trim(coalesce(p_data->>'pekerjaan_ibu', '')), ''),
      nullif(trim(coalesce(p_data->>'nama_wali', '')), ''),
      nullif(trim(coalesce(p_data->>'alamat', '')), ''),
      nullif(trim(coalesce(p_data->>'catatan_khusus', '')), ''),
      nullif(trim(coalesce(p_data->>'url_foto', '')), ''),
      nullif(trim(coalesce(p_data->>'alamat_maps', '')), ''),
      v_medsos
    );
    insert into akun_kredensial (nis_nip, password_hash)
    values (v_nis, crypt(v_pass, gen_salt('bf', 10)))
    on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();
    return json_build_object('status', 'success', 'message', 'Murid baru tersimpan (password lokal aktif).', 'aksi', 'insert');
  end if;
end $$;

-- ========== 3. RPC: EDIT PROFIL SENDIRI (WHITELIST + MAPS & MEDSOS) ==========
-- Murid boleh mengubah kolom kontak, data pribadi, alamat_maps & media_sosial.
-- NIS, NISN, nama, kelas, ekstrakurikuler, jabatan, url_foto TIDAK bisa diubah di sini.
create or replace function ubah_profil_murid(p_nis text, p_data jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_lahir date;
  v_medsos jsonb;
begin
  if not exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') then
    return json_build_object('status', 'error', 'message', 'Akun murid tidak ditemukan.');
  end if;

  v_lahir := nullif(trim(coalesce(p_data->>'tgl_lahir', '')), '')::date;
  if jsonb_typeof(p_data->'media_sosial') = 'array' then
    v_medsos := p_data->'media_sosial';
  else
    v_medsos := '[]'::jsonb;
  end if;

  update akun set
    email            = coalesce(p_data->>'email', email),
    no_telepon       = coalesce(p_data->>'no_telepon', no_telepon),
    alamat           = coalesce(p_data->>'alamat', alamat),
    alamat_maps      = coalesce(p_data->>'alamat_maps', alamat_maps),
    media_sosial     = case when p_data ? 'media_sosial' then v_medsos else media_sosial end,
    nama_ayah        = coalesce(p_data->>'nama_ayah', nama_ayah),
    pekerjaan_ayah   = coalesce(p_data->>'pekerjaan_ayah', pekerjaan_ayah),
    nama_ibu         = coalesce(p_data->>'nama_ibu', nama_ibu),
    pekerjaan_ibu    = coalesce(p_data->>'pekerjaan_ibu', pekerjaan_ibu),
    nama_wali        = coalesce(p_data->>'nama_wali', nama_wali),
    tgl_lahir        = coalesce(v_lahir, tgl_lahir),
    jenis_kelamin    = coalesce(p_data->>'jenis_kelamin', jenis_kelamin),
    agama            = coalesce(p_data->>'agama', agama),
    golongan_darah   = coalesce(p_data->>'golongan_darah', golongan_darah)
  where nis_nip = p_nis and tipe = 'murid';

  return json_build_object('status', 'success', 'message', 'Profil berhasil diperbarui.');
end $$;

-- ========== 4. RPC: SIMPAN FOTO MURID (URL DRIVE) ==========
-- Satu-satunya penulis akun.url_foto — dipanggil oleh Edge Function
-- 'unggah-foto-murid' setelah file benar-benar ter-Upload ke Google Drive.
-- Otorisasi: pemanggil harus admin ATAU murid pemilik NIS.
create or replace function simpan_foto_murid(
  p_nis text,
  p_url text,
  p_pemanggil_nis text,
  p_pemanggil_tipe text
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ada boolean;
begin
  p_nis := trim(coalesce(p_nis, ''));
  if p_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;

  select exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') into v_ada;
  if not v_ada then
    return json_build_object('status', 'error', 'message', 'Data murid tidak ditemukan.');
  end if;

  if p_pemanggil_tipe <> 'admin'
     and not (p_pemanggil_tipe = 'murid' and p_pemanggil_nis = p_nis) then
    return json_build_object('status', 'error', 'message', 'Tidak berhak mengganti foto murid ini.');
  end if;

  -- p_url = '' berarti menghapus foto (diputuskan pemilik NIS atau admin)
  update akun set url_foto = nullif(trim(coalesce(p_url, '')), '')
  where nis_nip = p_nis and tipe = 'murid';

  return json_build_object('status', 'success', 'message', 'Foto murid tersimpan.');
end $$;

-- ========== 5. IZIN EKSEKUSI + RELOAD CACHE ==========
grant execute on function buat_akun_murid(jsonb) to anon, authenticated;
grant execute on function ubah_profil_murid(text, jsonb) to anon, authenticated;
grant execute on function simpan_foto_murid(text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- [52/84] upgrade_20261013_akun_murid_keterangan_maps.sql
-- ============================================================
-- ============================================================
-- UPGRADE: DATA AKUN MURID — NO HP ORTU & KETERANGAN + PRATINJAU GOOGLE MAPS — 2026-10-13
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Isi:
--   1) RPC ubah_profil_murid dibuat ulang:
--      a) whitelist bertambah: no_telepon_ortu (No HP/WA Orang Tua/Wali)
--         & catatan_khusus (Keterangan) — kedua kolom ini SUDAH ada di tabel akun,
--         jadi TIDAK ada kolom baru (tanpa migrasi struktur).
--      b) + verifikasi kepemilikan (kebijakan keamanan): hanya admin ATAU murid
--         pemilik NIS yang boleh mengubah profil murid. RPC lama hanya mengecek
--         NIS itu ada padahal di-grant ke anon/authenticated — celah ditutup.
--
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== 1. RPC: EDIT PROFIL SENDIRI (WHITELIST + PEMILIK) ==========
-- Murid boleh mengubah kolom kontak, data pribadi, alamat_maps, media_sosial,
-- no_telepon_ortu & catatan_khusus.
-- NIS, NISN, nama, kelas, ekstrakurikuler, jabatan, url_foto TIDAK bisa diubah di sini.
create or replace function ubah_profil_murid(p_nis text, p_data jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_lahir date;
  v_medsos jsonb;
begin
  if not exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') then
    return json_build_object('status', 'error', 'message', 'Akun murid tidak ditemukan.');
  end if;

  -- Kebijakan kepemilikan: hanya admin, atau murid pemilik NIS ini.
  if coalesce((select tipe from akun where user_id = auth.uid()), '') <> 'admin'
     and not exists (
       select 1 from akun
       where user_id = auth.uid() and nis_nip = p_nis and tipe = 'murid'
     ) then
    return json_build_object('status', 'error', 'message', 'Tidak berhak mengubah profil murid ini.');
  end if;

  v_lahir := nullif(trim(coalesce(p_data->>'tgl_lahir', '')), '')::date;
  if jsonb_typeof(p_data->'media_sosial') = 'array' then
    v_medsos := p_data->'media_sosial';
  else
    v_medsos := '[]'::jsonb;
  end if;

  update akun set
    email            = coalesce(p_data->>'email', email),
    no_telepon       = coalesce(p_data->>'no_telepon', no_telepon),
    no_telepon_ortu  = coalesce(p_data->>'no_telepon_ortu', no_telepon_ortu),
    alamat           = coalesce(p_data->>'alamat', alamat),
    alamat_maps      = coalesce(p_data->>'alamat_maps', alamat_maps),
    media_sosial     = case when p_data ? 'media_sosial' then v_medsos else media_sosial end,
    nama_ayah        = coalesce(p_data->>'nama_ayah', nama_ayah),
    pekerjaan_ayah   = coalesce(p_data->>'pekerjaan_ayah', pekerjaan_ayah),
    nama_ibu         = coalesce(p_data->>'nama_ibu', nama_ibu),
    pekerjaan_ibu    = coalesce(p_data->>'pekerjaan_ibu', pekerjaan_ibu),
    nama_wali        = coalesce(p_data->>'nama_wali', nama_wali),
    tgl_lahir        = coalesce(v_lahir, tgl_lahir),
    jenis_kelamin    = coalesce(p_data->>'jenis_kelamin', jenis_kelamin),
    agama            = coalesce(p_data->>'agama', agama),
    golongan_darah   = coalesce(p_data->>'golongan_darah', golongan_darah),
    catatan_khusus   = coalesce(p_data->>'catatan_khusus', catatan_khusus)
  where nis_nip = p_nis and tipe = 'murid';

  return json_build_object('status', 'success', 'message', 'Profil berhasil diperbarui.');
end $$;

-- ========== 2. IZIN EKSEKUSI + RELOAD CACHE ==========
grant execute on function ubah_profil_murid(text, jsonb) to anon, authenticated;
notify pgrst, 'reload schema';

-- ============================================================
-- [53/84] upgrade_20261014_wajah.sql
-- ============================================================
-- ============================================================
-- UPGRADE: PENDAFTARAN WAJAH (FACE RECOGNITION) — 2026-10-14
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Isi:
--   1) Kolom baru tabel akun:
--        wajah_descriptor jsonb  → vektor 128 angka (deskriptor wajah face-api.js)
--        wajah_status    text    → 'aktif' | 'nonaktif' | NULL (belum terdaftar)
--   2) RPC baru simpan_wajah_murid: satu-satunya pintu penulisan kolom wajah
--      (verifikasi: admin ATAU murid pemilik NIS).
--
-- Catatan desain:
--   * Pencocokan wajah dilakukan SEPENUHNYA di sisi client (face-api.js + jarak
--     Euclidean) — tidak perlu pgvector. Kolom jsonb hanya menyimpan hasil
--     ekstraksi descriptor dari browser.
--   * Kolom tidak memiliki RLS khusus: RPC security definer adalah satu-satunya
--     penulisnya.
--
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== 1. KOLOM BARU ==========
alter table akun
  add column if not exists wajah_descriptor jsonb,
  add column if not exists wajah_status text;

-- ========== 2. RPC: SIMPAN / HAPUS DATA WAJAH MURID ==========
-- p_status:
--   'aktif'     → daftarkan/mutakhirkan wajah (p_descriptor wajib array 128 angka)
--   'nonaktif'  → nonaktifkan tanpa menghapus (descriptor lama tetap, tidak dipakai)
--   NULL/''     → hapus seluruh data wajah murid
-- Otorisasi: admin ATAU murid pemilik NIS (untuk keperluan kelola mandiri).
create or replace function simpan_wajah_murid(
  p_nis text,
  p_descriptor jsonb default null,
  p_status text default 'aktif',
  p_pemanggil_nis text default null,
  p_pemanggil_tipe text default null
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ada boolean;
  v_idx int;
  v_elemen jsonb;
  v_ok boolean := true;
begin
  p_nis := trim(coalesce(p_nis, ''));
  p_status := lower(trim(coalesce(p_status, '')));

  if p_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;

  select exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') into v_ada;
  if not v_ada then
    return json_build_object('status', 'error', 'message', 'Data murid tidak ditemukan.');
  end if;

  if p_pemanggil_tipe <> 'admin'
     and not (p_pemanggil_tipe = 'murid' and p_pemanggil_nis = p_nis) then
    return json_build_object('status', 'error', 'message', 'Tidak berhak mengubah data wajah murid ini.');
  end if;

  -- Validasi descriptor bila ingin menyimpan: harus array 128 angka
  if p_status = 'aktif' and p_descriptor is not null then
    if jsonb_typeof(p_descriptor) <> 'array' or jsonb_array_length(p_descriptor) <> 128 then
      return json_build_object('status', 'error', 'message', 'Deskriptor wajah harus berupa array 128 angka.');
    end if;
    for v_idx in 0 .. 127 loop
      v_elemen := p_descriptor->v_idx;
      if jsonb_typeof(v_elemen) not in ('number') or not (v_elemen #>> '{}')::double precision between -10 and 10 then
        v_ok := false;
        exit;
      end if;
    end loop;
    if not v_ok then
      return json_build_object('status', 'error', 'message', 'Deskriptor wajah berisi nilai tidak valid.');
    end if;
  end if;

  if p_status = 'aktif' and p_descriptor is not null then
    update akun
       set wajah_descriptor = p_descriptor,
           wajah_status     = 'aktif'
     where nis_nip = p_nis and tipe = 'murid';
    return json_build_object('status', 'success', 'message', 'Data wajah murid tersimpan.');
  elsif p_status = 'nonaktif' then
    update akun
       set wajah_status = 'nonaktif'
     where nis_nip = p_nis and tipe = 'murid';
    return json_build_object('status', 'success', 'message', 'Data wajah murid dinonaktifkan.');
  else
    -- hapus total (p_status NULL/'' atau p_descriptor NULL)
    update akun
       set wajah_descriptor = null,
           wajah_status     = null
     where nis_nip = p_nis and tipe = 'murid';
    return json_build_object('status', 'success', 'message', 'Data wajah murid dihapus.');
  end if;
end $$;

-- ========== 3. IZIN EKSEKUSI + RELOAD CACHE ==========
grant execute on function simpan_wajah_murid(text, jsonb, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- [54/84] upgrade_20261014b_fix_nilai_grant.sql
-- ============================================================
-- ============================================================
-- FIX: GRANT PRIVILEGE TABEL MODUL NILAI (42501 — MENU INPUT NILAI) — 2026-10-14 (b)
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Semua kategori di menu **Input Nilai** (Pengetahuan/Keterampilan/
--   Sikap/Ekstrakurikuler) gagal dimuat dengan pesan:
--     "Gagal memuat data. Periksa koneksi internet Anda."
--   Di DevTools → Network, permintaan pertama yang gagal adalah:
--     GET /rest/v1/nilai_konfigurasi?select=config&kategori=eq....&mapel=eq....
--     HTTP 401 { "code":"42501", "message":"permission denied for table nilai_konfigurasi" }
--
--   Penyebab: tabel-tabel modul nilai di database project ini TIDAK
--   memiliki GRANT privilege untuk role API (anon/authenticated) —
--   hanya punya RLS policy. PostgREST butuh PRIVILEGE TINGKAT TABEL;
--   RLS policy saja TIDAK cukup (permintaan ditolak sebelum RLS).
--   Grant yang sama sudah pernah ditulis di upgrade_20260904_nilai.sql
--   dan upgrade_20260906_sikap_teman.sql — tapi tidak (lengkap)
--   ter-apply di database project ini.
--
-- ISI (idempotent — aman dijalankan berulang; menyelaraskan database
-- live dengan isi GRANT di file migrasi asli):
--   1) nilai_konfigurasi  → select/insert/update/delete utk authenticated
--   2) nilai_teman_sejawat → select/insert/update/delete utk authenticated
--   3) jurnal_sikap        → select/insert/update/delete utk authenticated
--   4) Reload cache skema PostgREST
-- ============================================================

revoke all on table nilai_konfigurasi from anon, authenticated;
grant select, insert, update, delete on nilai_konfigurasi to authenticated;

revoke all on table nilai_teman_sejawat from anon, authenticated;
grant select, insert, update, delete on nilai_teman_sejawat to authenticated;

revoke all on table jurnal_sikap from anon, authenticated;
grant select, insert, update, delete on jurnal_sikap to authenticated;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [55/84] upgrade_20261014c_absen_mandiri_rpc.sql
-- ============================================================
-- ============================================================
-- UPGRADE: RPC ABSEN MANDIRI (PERBAIKAN TIDAK TERSIMPAN) — 2026-10-14
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Menu "Absen Mandiri" murid menampilkan "Berhasil Absen" namun baris
--   tidak/belum tampil di database. Sebelumnya penulisan dilakukan
--   LANGSUNG dari browser:
--     supaClient.from('absensi').upsert(...)
--   sehingga bergantung pada: (a) state browser (currentTahun/currentBulan
--   yang bisa basi → tanggal/tahun pelajaran salah), (b) hak tulis anon
--   pada tabel absensi, dan (c) validasi captcha client-side (membaca kolom
--   akun.captcha sebagai anon).
--
-- SOLUSI:
--   1) RPC `absen_mandiri` (security definer) — satu-satunya pintu tulis
--      absen mandiri:
--        * tanggal SELALU otomatis = hari ini WIB (bukan turunan bulan/tahun
--          dari browser);
--        * validasi captcha & sesi guru BUKA dilakukan DI SERVER (captcha
--          tidak lagi perlu dibaca klien → menutup kebocoran nilai captcha
--          ke peran anon);
--        * upsert ON CONFLICT (nis, tanggal, mapel) aman & idempotent;
--        * kolom wajah_cocok menampung verifikasi face scan (opsional).
--   2) Kolom baru absensi.wajah_cocok untuk face scan Absen Mandiri.
--   3) Self-healing kolom + RLS/grant tabel absensi (pola sama dengan
--      upgrade_20260928_rpc_akun_murid.sql).
--
-- Semua idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== 1. SELF-HEALING KOLOM ==========
alter table absensi add column if not exists gps text default '';
alter table absensi add column if not exists metode text default 'Manual / QR';
alter table absensi add column if not exists wajah_cocok boolean not null default false;

-- ========== 2. RLS + GRANT TABEL ABSENSI (kembalikan ke baseline) ==========
-- Murid lokal memakai anon key — absen mandiri kini lewat RPC, tapi
-- SELECT tetap dibuka untuk anon (baca dashboard/laporan murid) dan tulis
-- tetap dibuka untuk authenticated (guru/admin via save_absen_masal).
alter table absensi enable row level security;

drop policy if exists "absensi_baca_semua" on absensi;
create policy "absensi_baca_semua" on absensi
  for select using (true);

drop policy if exists "absensi_tulis_semua" on absensi;
create policy "absensi_tulis_semua" on absensi
  for insert with check (true);

drop policy if exists "absensi_ubah_semua" on absensi;
create policy "absensi_ubah_semua" on absensi
  for update using (true) with check (true);

drop policy if exists "absensi_hapus_semua" on absensi;
create policy "absensi_hapus_semua" on absensi
  for delete using (true);

revoke all on table absensi from anon, authenticated;
grant select, insert, update, delete on absensi to anon, authenticated;
-- ========== 3. RPC: ABSEN MANDIRI (SECURITY DEFINER) ==========
-- Parameter:
--   p_nis         → NIS murid pemanggil (identitas utk verifikasi)
--   p_nama, p_kelas → label untuk baris absensi
--   p_tahun       → label Tahun Pelajaran (mis. "2026/2027"); bila basi/tidak
--                   masuk akal, diturunkan otomatis dari tanggal
--   p_bulan       → label bulan Indonesia; bila basi, diganti dari tanggal
--   p_mapel       → mapel/ekstrakurikuler (dari jadwal murid)
--   p_captcha     → kode yang diumumkan guru pengampu (sesi kunci_absen 'BUKA')
--   p_gps         → koordinat GPS (opsional, teks)
--   p_wajah_cocok → true bila identitas diverifikasi face scan (opsional)
--   p_tanggal     → tanggal absen; default HARI INI WIB (biasanya tidak
--                   perlu dikirim — disediakan untuk pengujian/fleksibilitas)
create or replace function absen_mandiri(
  p_nis text,
  p_nama text default '',
  p_kelas text default '',
  p_tahun text default '',
  p_bulan text default '',
  p_mapel text default '',
  p_captcha text default '',
  p_gps text default '',
  p_wajah_cocok boolean default false,
  p_tanggal date default (now() at time zone 'Asia/Jakarta')::date
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tanggal date;
  v_tahun_tgl int;
  v_bulan text;
  v_semester text;
  v_tahun text;
  v_ketemu boolean;
  v_metode text;
  arr_bulan text[] := array['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
begin
  p_nis     := trim(coalesce(p_nis, ''));
  p_mapel   := trim(coalesce(p_mapel, ''));
  p_captcha := upper(trim(coalesce(p_captcha, '')));

  if p_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;
  if p_mapel = '' then
    return json_build_object('status', 'error', 'message', 'Pilih mapel/ekstrakurikuler dulu.');
  end if;
  if p_captcha = '' then
    return json_build_object('status', 'error', 'message', 'Kode captcha wajib diisi.');
  end if;

  -- Identitas: harus akun murid yang benar-benar ada
  if not exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') then
    return json_build_object('status', 'error', 'message', 'Akun murid tidak ditemukan.');
  end if;

  -- Tanggal: OTOMATIS hari ini WIB — tidak percaya bulan/tahun dari browser
  v_tanggal   := coalesce(p_tanggal, (now() at time zone 'Asia/Jakarta')::date);
  v_tahun_tgl := extract(year from v_tanggal);

  -- Bulan label (nama bulan Indonesia) — koreksi otomatis bila basi
  v_bulan := nullif(trim(coalesce(p_bulan, '')), '');
  if v_bulan is null or array_position(arr_bulan, v_bulan) is null then
    v_bulan := arr_bulan[extract(month from v_tanggal)::int];
  end if;

  -- Semester mengikuti bulan tanggal (Jul–Des = Ganjil, Jan–Jun = Genap)
  v_semester := case when extract(month from v_tanggal) >= 7 then 'Ganjil' else 'Genap' end;

  -- Tahun Pelajaran: pakai label klien bila format YYYY/YYYY dan memuat
  -- tahun tanggal atau tahun berikutnya; jika tidak, turunkan dari tanggal.
  v_tahun := nullif(trim(coalesce(p_tahun, '')), '');
  begin
    if v_tahun is null
       or v_tahun !~ '^[0-9]{4}/[0-9]{4}$'
       or ((split_part(v_tahun, '/', 1))::int not in (v_tahun_tgl, v_tahun_tgl + 1)
           and (split_part(v_tahun, '/', 2))::int not in (v_tahun_tgl, v_tahun_tgl + 1)) then
      v_tahun := v_tahun_tgl || '/' || (v_tahun_tgl + 1);
    end if;
  exception when others then
    v_tahun := v_tahun_tgl || '/' || (v_tahun_tgl + 1);
  end;

  -- Validasi captcha DI SERVER: guru/admin yang membuka sesi (kunci_absen 'BUKA')
  -- dengan mapel/ekstrakurikuler cocok. Kolom akun.captcha tidak dibaca klien.
  select exists (
    select 1 from akun g
     where g.tipe in ('guru', 'admin')
       and g.kunci_absen = 'BUKA'
       and upper(coalesce(g.captcha, '')) = p_captcha
       and (g.mapel ilike '%' || p_mapel || '%' or g.ekstrakurikuler ilike '%' || p_mapel || '%')
  ) into v_ketemu;

  if not coalesce(v_ketemu, false) then
    return json_build_object('status', 'error', 'message', 'Captcha salah atau sesi absen belum dibuka guru.');
  end if;

  v_metode := case when coalesce(p_wajah_cocok, false)
    then 'Absen Mandiri (Wajah+GPS)' else 'Absen Mandiri (GPS)' end;

  insert into absensi
    (nis, nama, tanggal, status, keterangan, mapel, ekskul, kelas, tahun, semester, bulan, metode, gps, wajah_cocok)
  values
    (p_nis, p_nama, v_tanggal, 'H', '', p_mapel, p_mapel, p_kelas, v_tahun, v_semester, v_bulan, v_metode, p_gps, coalesce(p_wajah_cocok, false))
  on conflict (nis, tanggal, mapel) do update set
    nama       = excluded.nama,
    status     = 'H',
    keterangan = '',
    kelas      = excluded.kelas,
    tahun      = excluded.tahun,
    semester   = excluded.semester,
    bulan      = excluded.bulan,
    metode     = excluded.metode,
    gps        = excluded.gps,
    wajah_cocok = excluded.wajah_cocok;

  return json_build_object(
    'status',   'success',
    'tanggal',  to_char(v_tanggal, 'YYYY-MM-DD'),
    'bulan',    v_bulan,
    'semester', v_semester,
    'tahun',    v_tahun,
    'metode',   v_metode
  );
end $$;

-- ========== 4. IZIN EKSEKUSI + RELOAD CACHE ==========
grant execute on function absen_mandiri(text, text, text, text, text, text, text, text, boolean, date) to anon, authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- [56/84] upgrade_20261014d_absen_mandiri_integrasi.sql
-- ============================================================
-- ============================================================
-- UPGRADE: ABSEN MANDIRI v2 — INTEGRASI KE REKAP GURU
-- (MATA PELAJARAN & EKSTRAKURIKULER) — 2026-10-14
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Setelah upgrade_20261014c, absen mandiri murid menampilkan "Berhasil"
--   dan barisnya MASUK tabel absensi, namun TIDAK MUNCUL di rekap guru
--   Mapel/Ekskul. Akar masalah (terbaca di web/js/utils.example.js →
--   get_dashboard_data):
--     1) Ekskul: rekap guru memfilter absensi dengan
--          .eq('kelas','Semua Kelas')
--        sedangkan RPC v1 menulis kelas = kelas asli siswa → baris absen
--        mandiri ekskul tidak pernah tampil di rekap ekstrakurikuler guru.
--     2) Mapel: rekap guru memfilter dengan KELAS EFEKTIF TA yang diambil
--        dari akun.riwayat_kelas[tahun].kelas (fallback tingkat_kelas),
--        sedangkan RPC v1 menulis p_kelas = akun.tingkat_kelas statis dari
--        sesi murid → setelah kenaikan/pindah kelas, baris tak muncul di
--        rekap mapel guru.
--     3) RPC v1 masih percaya p_tanggal dari browser
--        (v_tanggal := coalesce(p_tanggal, server)) padahal komentarnya
--        mengklaim "selalu WIB" → gadget dengan jam meleset menulis baris di
--        tanggal yang berada di luar rentang filter bulan guru.
--
-- SOLUSI:
--   1) `absen_mandiri` dibuat ulang dengan SIGNATURE BARU (overload v1
--      DIBUANG agar tidak bisa dipanggil lagi):
--        * parameter baru p_jenis ('Mapel'/'Ekskul') menentukan bucket kelas;
--        * tanggal SELALU (now() at time zone 'Asia/Jakarta')::date —
--          p_tanggal tetap diterima (kompatibilitas klien lama) tapi DIIGNOR;
--        * nama diambil dari akun.nama_lengkap;
--        * kelas Mapel = akun.riwayat_kelas[p_tahun]->>'kelas' (fallback
--          tingkat_kelas dari p_kelas), siswa non-Aktif di TA ditolak —
--          PERSIS logika get_dashboard_data → baris langsung muncul di rekap
--          guru pengampu;
--        * kelas Ekskul = 'Semua Kelas' + keanggotaan murid di ekskul itu
--          diverifikasi (akun.ekstrakurikuler) → tolak bila bukan anggota;
--        * captcha & sesi guru Kunci Absen 'BUKA' diverifikasi server
--          (dipertahankan dari v1).
--   2) Self-healing kolom/RLS/grant (pola sama dengan 14c) — idempotent.
--
-- Semua idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- Baris yang tadinya mendarat di kelas/tanggal salah (dari RPC v1) bisa
-- diperbaiki manual — lihat bagian 6 (diagnosa, tidak otomatis).
-- ============================================================

-- ========== 1. SELF-HEALING KOLOM ==========
alter table absensi add column if not exists gps text default '';
alter table absensi add column if not exists metode text default 'Manual / QR';
alter table absensi add column if not exists wajah_cocok boolean not null default false;

-- ========== 2. RLS + GRANT TABEL ABSENSI (kembalikan ke baseline) ==========
-- Murid lokal memakai anon key — absen mandiri kini lewat RPC, tapi
-- SELECT tetap dibuka untuk anon (baca dashboard/laporan murid) dan tulis
-- tetap dibuka untuk authenticated (guru/admin via save_absen_masal).
alter table absensi enable row level security;

drop policy if exists "absensi_baca_semua" on absensi;
create policy "absensi_baca_semua" on absensi
  for select using (true);

drop policy if exists "absensi_tulis_semua" on absensi;
create policy "absensi_tulis_semua" on absensi
  for insert with check (true);

drop policy if exists "absensi_ubah_semua" on absensi;
create policy "absensi_ubah_semua" on absensi
  for update using (true) with check (true);

drop policy if exists "absensi_hapus_semua" on absensi;
create policy "absensi_hapus_semua" on absensi
  for delete using (true);

revoke all on table absensi from anon, authenticated;
grant select, insert, update, delete on absensi to anon, authenticated;

-- ========== 3. RPC ABSEN MANDIRI v2 (SECURITY DEFINER) ==========
-- BUANG overload v1 (10 arg: ... boolean wajah_cocok, date p_tanggal) agar
-- payload lama tidak bisa lagi menulis dengan logika kelas statis.
drop function if exists absen_mandiri(text, text, text, text, text, text, text, text, boolean, date);

create or replace function absen_mandiri(
  p_nis text,
  p_nama text,
  p_kelas text,
  p_tahun text,
  p_bulan text,
  p_mapel text,
  p_captcha text,
  p_gps text,
  p_wajah_cocok boolean default false,
  p_tanggal date default null,   -- DITERIMA untuk kompatibilitas klien lama, TAPI DIIGNOR
  p_jenis text default 'Mapel'   -- 'Mapel' | 'Ekskul' → menentukan bucket kelas
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tanggal date;
  v_tahun_tgl int;
  v_bulan text;
  v_semester text;
  v_tahun text;
  v_ketemu boolean;
  v_metode text;
  v_kelas text := '';
  v_nama text := '';
  v_jenis text;
  v_riwayat jsonb;
  arr_bulan text[] := '{"Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"}';
begin
  -- Normalisasi masukan (pola 14c): captcha & mapel di-trim, captcha di-upper-case
  p_nis     := trim(coalesce(p_nis, ''));
  p_mapel   := trim(coalesce(p_mapel, ''));
  p_captcha := upper(trim(coalesce(p_captcha, '')));

  v_jenis := upper(coalesce(nullif(trim(p_jenis), ''), 'MAPEL'));
  if v_jenis not in ('MAPEL', 'EKSKUL') then
    return json_build_object('status', 'error', 'message', 'Jenis absen tidak valid (Mapel atau Ekskul).');
  end if;

  if p_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;
  if p_mapel = '' then
    return json_build_object('status', 'error', 'message', 'Pilih mata pelajaran / ekstrakurikuler terlebih dahulu.');
  end if;
  if p_captcha = '' then
    return json_build_object('status', 'error', 'message', 'Kode captcha wajib diisi.');
  end if;

  -- Identitas murid + data akun (nama & riwayat kelas DARI SERVER)
  select m.nama_lengkap, coalesce(m.riwayat_kelas, '{}'::jsonb)
    into v_nama, v_riwayat
    from akun m
   where m.nis_nip = p_nis and m.tipe = 'murid';
  if not found then
    return json_build_object('status', 'error', 'message', 'Akun murid tidak ditemukan.');
  end if;
  v_nama := coalesce(nullif(trim(v_nama), ''), p_nama);

  -- Tanggal: SELALU hari ini WIB (Asia/Jakarta) — p_tanggal dari browser DIIGNOR
  v_tanggal   := (now() at time zone 'Asia/Jakarta')::date;
  v_tahun_tgl := extract(year from v_tanggal);

  -- Bulan label (nama bulan Indonesia) — dipakai konsistensi pelaporan
  v_bulan := nullif(trim(coalesce(p_bulan, '')), '');
  if v_bulan is null or array_position(arr_bulan, v_bulan) is null then
    v_bulan := arr_bulan[extract(month from v_tanggal)::int];
  end if;

  -- Semester mengikuti bulan tanggal (Jul–Des = Ganjil, Jan–Jun = Genap)
  v_semester := case when extract(month from v_tanggal) >= 7 then 'Ganjil' else 'Genap' end;

  -- Tahun Pelajaran: pakai label klien bila format YYYY/YYYY dan memuat
  -- tahun tanggal atau tahun berikutnya; jika tidak, turunkan dari tanggal.
  v_tahun := nullif(trim(coalesce(p_tahun, '')), '');
  begin
    if v_tahun is null
       or v_tahun !~ '^[0-9]{4}/[0-9]{4}$'
       or ((split_part(v_tahun, '/', 1))::int not in (v_tahun_tgl, v_tahun_tgl + 1)
           and (split_part(v_tahun, '/', 2))::int not in (v_tahun_tgl, v_tahun_tgl + 1)) then
      v_tahun := v_tahun_tgl || '/' || (v_tahun_tgl + 1);
    end if;
  exception when others then
    v_tahun := v_tahun_tgl || '/' || (v_tahun_tgl + 1);
  end;

  -- KELAS: ditentukan SERVER dengan logika yang sama persis dengan
  -- get_dashboard_data (web/js/utils.example.js):
  --   * Ekskul → 'Semua Kelas' (rekap guru memakai .eq('kelas','Semua Kelas'))
  --   * Mapel  → riwayat_kelas[p_tahun].kelas; bila belum ada riwayat utk TA
  --              tsb, pakai tingkat_kelas (p_kelas dari sesi). Siswa non-Aktif
  --              pada TA ditolak (senada filter statusSiswa !== 'Aktif').
  if v_jenis = 'EKSKUL' then
    v_kelas := 'Semua Kelas';
    -- Keanggotaan: murid harus tercatat di akun.ekstrakurikuler
    if not exists (
      select 1
        from unnest(string_to_array(coalesce(
          (select m.ekstrakurikuler from akun m where m.nis_nip = p_nis and m.tipe = 'murid')
        , ''), ',')) u
       where upper(trim(u)) = upper(trim(p_mapel))
    ) then
      return json_build_object('status', 'error', 'message', 'Siswa bukan anggota ekstrakurikuler ' || p_mapel || '.');
    end if;
  else
    if v_riwayat ? v_tahun then
      if coalesce(v_riwayat->v_tahun->>'status', 'Aktif') <> 'Aktif' then
        return json_build_object('status', 'error', 'message', 'Siswa berstatus tidak aktif pada tahun pelajaran ' || v_tahun || '.');
      end if;
      v_kelas := coalesce(nullif(v_riwayat->v_tahun->>'kelas', ''), '');
    else
      v_kelas := coalesce(p_kelas, '');
    end if;
    if v_kelas = '' then
      return json_build_object('status', 'error', 'message', 'Kelas efektif siswa untuk ' || v_tahun || ' tidak ditemukan (riwayat_kelas/tingkat_kelas). Hubungi admin.');
    end if;
  end if;

  -- Validasi captcha DI SERVER: guru/admin yang membuka sesi (kunci_absen 'BUKA')
  -- dengan mapel/ekstrakurikuler cocok. Kolom akun.captcha tidak dibaca klien.
  select exists (
    select 1 from akun g
     where g.tipe in ('guru', 'admin')
       and g.kunci_absen = 'BUKA'
       and upper(coalesce(g.captcha, '')) = p_captcha
       and (g.mapel ilike '%' || p_mapel || '%' or g.ekstrakurikuler ilike '%' || p_mapel || '%')
  ) into v_ketemu;

  if not coalesce(v_ketemu, false) then
    return json_build_object('status', 'error', 'message', 'Captcha salah atau sesi absen belum dibuka guru.');
  end if;

  v_metode := case when coalesce(p_wajah_cocok, false)
    then 'Absen Mandiri (Wajah+GPS)' else 'Absen Mandiri (GPS)' end;

  insert into absensi
    (nis, nama, tanggal, status, keterangan, mapel, ekskul, kelas, tahun, semester, bulan, metode, gps, wajah_cocok)
  values
    (p_nis, v_nama, v_tanggal, 'H', '', p_mapel, p_mapel, v_kelas, v_tahun, v_semester, v_bulan, v_metode, p_gps, coalesce(p_wajah_cocok, false))
  on conflict (nis, tanggal, mapel) do update set
    nama        = excluded.nama,
    status      = 'H',
    keterangan  = '',
    kelas       = excluded.kelas,
    tahun       = excluded.tahun,
    semester    = excluded.semester,
    bulan       = excluded.bulan,
    metode      = excluded.metode,
    gps         = excluded.gps,
    wajah_cocok = excluded.wajah_cocok;

  return json_build_object(
    'status',   'success',
    'tanggal',  to_char(v_tanggal, 'YYYY-MM-DD'),
    'bulan',    v_bulan,
    'semester', v_semester,
    'tahun',    v_tahun,
    'kelas',    v_kelas,
    'jenis',    v_jenis,
    'metode',   v_metode
  );
end $$;

-- ========== 4. IZIN EKSEKUSI + RELOAD CACHE ==========
grant execute on function absen_mandiri(text, text, text, text, text, text, text, text, boolean, date, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ========== 5. VERIFIKASI CEPAT (opsional) ==========
-- Setelah frontend di-deploy & murid absen lagi, baris baru harus memakai
-- bucket yang benar (Ekskul → 'Semua Kelas'; Mapel → kelas efektif TA):
--   select nis, nama, tanggal, mapel, kelas, tahun, semester, bulan, metode
--     from absensi
--    where metode like 'Absen Mandiri%'
--      and tanggal >= date_trunc('month', (now() at time zone 'Asia/Jakarta')::date)
--    order by tanggal desc, nis;

-- ========== 6. DIAGNOSA BARIS TERSESAT DARI RPC v1 (opsional) ==========
-- JALANKAN MANUAL — bukan bagian dari upgrade. Menampilkan semua absen mandiri
-- beserta bucket yang ditulis RPC v1. Baris "tersesat":
--   * mapel = nama ekstrakurikuler tetapi kelas <> 'Semua Kelas'; atau
--   * tanggal di luar bulan berjalan (gadget murid pernah meleset).
-- Admin cukup meng-update kelas/tanggal baris tersebut secara manual.
--   select nis, nama, tanggal, mapel, kelas, tahun, semester, bulan, metode
--     from absensi
--    where metode like 'Absen Mandiri%'
--    order by tanggal desc, nis;

-- ============================================================
-- [57/84] upgrade_20261014e_wajah_multi.sql
-- ============================================================
-- ============================================================
-- UPGRADE: WAJAH MULTI-SAMPEL (AKURASI FACE SCAN) — 2026-10-14e
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Isi:
--   1) Migrasi data: `wajah_descriptor` yang lama berbentuk FLAT [128 angka]
--      dibungkus menjadi array-of-arrays [[128 angka], ...] — format multi-sampel.
--   2) RPC `simpan_wajah_murid` dibuat ulang dengan parameter baru `p_mode`:
--        'ganti'  → timpa SELURUH data wajah murid (terima 1 ATAU beberapa sampel)
--        'tambah' → sisipkan 1 sampel di belakang data yang ada
--      cap 6 sampel per murid (validasi ketat di sisi server).
--   3) Overload RPC v1 (5 parameter) di-drop; grant + reload cache.
--
-- Catatan desain:
--   * Pencocokan tetap SEPENUHNYA di browser (face-api.js): jarak MINIMUM ke
--     semua sampel per murid (min-distance matching), terinspirasi repo referensi
--     ManageWithNoobItGuy/GAS-attendance-facescanner-with-gps-V2 — TANPA Google
--     Sheets/Apps Script/GPS; data wajah tetap 100% disimpan di Supabase.
--   * Data lama yang masih flat TIDAK perlu didaftarkan ulang (kompatibel mundur:
--     frontend membaca flat maupun array-of-arrays).
--
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. MIGRASI DATA: FLAT → ARRAY-OF-ARRAYS ==========
-- Baris berformat LAMA: wajah_descriptor = [a1..a128] (elemen pertama angka).
-- Baris berformat BARU: wajah_descriptor = [[a1..a128], ...] (elemen pertama array).
update akun
   set wajah_descriptor = jsonb_build_array(wajah_descriptor)
 where wajah_descriptor is not null
   and jsonb_typeof(wajah_descriptor) = 'array'
   and jsonb_array_length(wajah_descriptor) = 128
   and jsonb_typeof(wajah_descriptor -> 0) = 'number';

-- ========== 2. RPC: SIMPAN / HAPUS DATA WAJAH (MULTI-SAMPEL) ==========
-- p_mode:
--   'ganti'  → mengganti seluruh koleksi sampel murid (p_descriptor boleh satu
--              vektor 128 ATAU array-of-arrays; maks 6 sampel).
--   'tambah' → menyisipkan SATU sampel (p_descriptor array 128) di belakang data
--              yang ada (otomatis membungkus data lama yang masih flat; cap 6).
-- p_status:
--   'aktif'     → daftarkan/mutakhirkan wajah (p_descriptor wajib terisi)
--   'nonaktif'  → nonaktifkan tanpa menghapus (sampel lama tetap, tidak dipakai)
--   NULL/''     → hapus seluruh data wajah murid
-- Otorisasi: admin ATAU murid pemilik NIS (untuk keperluan kelola mandiri).
create or replace function simpan_wajah_murid(
  p_nis text,
  p_descriptor jsonb default null,
  p_status text default 'aktif',
  p_pemanggil_nis text default null,
  p_pemanggil_tipe text default null,
  p_mode text default 'ganti'
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ada boolean;
  v_list jsonb;
  v_lama jsonb;
  v_baru jsonb;
  v_jumlah int;
  v_jumlah_lama int;
  v_i int;
  v_j int;
  v_sampel jsonb;
  v_elemen jsonb;
begin
  p_nis := trim(coalesce(p_nis, ''));
  p_status := lower(trim(coalesce(p_status, '')));
  p_mode := lower(trim(coalesce(p_mode, 'ganti')));

  if p_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;

  select exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') into v_ada;
  if not v_ada then
    return json_build_object('status', 'error', 'message', 'Data murid tidak ditemukan.');
  end if;

  if p_pemanggil_tipe <> 'admin'
     and not (p_pemanggil_tipe = 'murid' and p_pemanggil_nis = p_nis) then
    return json_build_object('status', 'error', 'message', 'Tidak berhak mengubah data wajah murid ini.');
  end if;

  -- ===== Normalisasi + validasi p_descriptor =====
  if p_descriptor is not null then
    if jsonb_typeof(p_descriptor) <> 'array' then
      return json_build_object('status', 'error', 'message', 'Deskriptor wajah harus berupa array 128 angka (atau array dari array semacam itu).');
    end if;
    -- Klien lama/kirimanku masih BISA mengirim flat [128 angka] → bungkus sekali.
    if jsonb_array_length(p_descriptor) = 128 and jsonb_typeof(p_descriptor -> 0) = 'number' then
      v_list := jsonb_build_array(p_descriptor);
    else
      v_list := p_descriptor;
    end if;

    v_jumlah := jsonb_array_length(v_list);
    if v_jumlah < 1 then
      return json_build_object('status', 'error', 'message', 'Minimal satu sampel wajah diperlukan.');
    end if;
    if p_mode = 'tambah' and v_jumlah <> 1 then
      return json_build_object('status', 'error', 'message', 'Mode tambah menerima tepat satu sampel (array 128 angka).');
    end if;
    if p_mode = 'ganti' and v_jumlah > 6 then
      return json_build_object('status', 'error', 'message', 'Maksimal 6 sampel wajah per murid (' || v_jumlah || ' diberikan).');
    end if;

    for v_i in 0 .. v_jumlah - 1 loop
      v_sampel := v_list -> v_i;
      if jsonb_typeof(v_sampel) <> 'array' or jsonb_array_length(v_sampel) <> 128 then
        return json_build_object('status', 'error', 'message', 'Setiap sampel wajah harus berupa array 128 angka.');
      end if;
      for v_j in 0 .. 127 loop
        v_elemen := v_sampel -> v_j;
        if jsonb_typeof(v_elemen) not in ('number') or not (v_elemen #>> '{}')::double precision between -10 and 10 then
          return json_build_object('status', 'error', 'message', 'Deskriptor wajah berisi nilai tidak valid.');
        end if;
      end loop;
    end loop;
  end if;

-- ===== Terapkan =====
  if p_status = 'aktif' and p_descriptor is not null then
    if p_mode = 'tambah' then
      select coalesce(wajah_descriptor, '[]'::jsonb) into v_lama
        from akun where nis_nip = p_nis and tipe = 'murid';
      -- Baris lama yang belum sempat dimigrasi (flat) → bungkus dulu sebelum append.
      if jsonb_typeof(v_lama) = 'array' and jsonb_array_length(v_lama) = 128 and jsonb_typeof(v_lama -> 0) = 'number' then
        v_lama := jsonb_build_array(v_lama);
      end if;
      if jsonb_typeof(v_lama) <> 'array' then
        v_lama := '[]'::jsonb;
      end if;
      v_jumlah_lama := jsonb_array_length(v_lama);
      if v_jumlah_lama + 1 > 6 then
        return json_build_object('status', 'error', 'message', 'Maksimal 6 sampel wajah per murid — gunakan mode ganti untuk mengganti seluruh data.');
      end if;
      v_baru := v_lama || v_list;
      update akun
         set wajah_descriptor = v_baru,
             wajah_status     = 'aktif'
       where nis_nip = p_nis and tipe = 'murid';
      return json_build_object('status', 'success', 'message', 'Data wajah murid tersimpan (' || jsonb_array_length(v_baru) || ' sampel).');
    else
      update akun
         set wajah_descriptor = v_list,
             wajah_status     = 'aktif'
       where nis_nip = p_nis and tipe = 'murid';
      return json_build_object('status', 'success', 'message', 'Data wajah murid tersimpan (' || jsonb_array_length(v_list) || ' sampel).');
    end if;
  elsif p_status = 'nonaktif' then
    update akun
       set wajah_status = 'nonaktif'
     where nis_nip = p_nis and tipe = 'murid';
    return json_build_object('status', 'success', 'message', 'Data wajah murid dinonaktifkan.');
  else
    -- hapus total (p_status NULL/'' atau p_descriptor NULL)
    update akun
       set wajah_descriptor = null,
           wajah_status     = null
     where nis_nip = p_nis and tipe = 'murid';
    return json_build_object('status', 'success', 'message', 'Data wajah murid dihapus.');
  end if;
end $$;

-- ========== 3. DROP OVERLOAD LAMA + IZIN + RELOAD CACHE ==========
drop function if exists simpan_wajah_murid(text, jsonb, text, text, text);

grant execute on function simpan_wajah_murid(text, jsonb, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- [58/84] upgrade_20261015_edit_murid_akses_guru_wali.sql
-- ============================================================
-- ============================================================
-- UPGRADE: IZINKAN GURU (WALI/PEMBINA) EDIT AKUN MURID — 2026-12-10
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Menu "Data Akun Murid" memperlihatkan tombol Edit (pensil) untuk
--   admin & guru (wali kelas / pembina ekskul) — lihat bisaEditAkunMurid()
--   di web/js/app.js. Namun RPC buat_akun_murid SQL selama ini hanya
--   mengizinkan admin, sehingga guru yang menekan Simpan selalu ditolak
--   ("Hanya admin yang boleh mengelola akun murid").
--
--   Edge Function 'unggah-foto-murid' juga hanya mengizinkan admin atau
--   murid pemilik NIS — guru (wali/pembina) ditolak saat mengganti foto.
--
-- ISI UPGRADE:
--   1) Helper akun_guru_ampu_murid(p_guru_nis, p_murid_nis):
--      benar jika guru adalah WALI KELAS murid tsb ATAU PEMBINA ekskul murid.
--   2) buat_akun_murid diubah:
--        - admin  : boleh tambah & edit (termasuk password), seperti dulu.
--        - guru   : EDIT saja, hanya murid yang diampu, TANPA ubah password.
--        - murid  : ditolak (murid edit profil via RPC sendiri).
--   3) simpan_foto_murid diubah: izinkan juga guru wali/pembina bersangkutan.
--
-- Idempotent (create or replace) — aman dijalankan berulang.
-- ============================================================

-- ========== 1. HELPER: GURU MENGAMPU MURID? ==========
create or replace function akun_guru_ampu_murid(p_guru_nis text, p_murid_nis text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if trim(coalesce(p_guru_nis, '')) = '' or trim(coalesce(p_murid_nis, '')) = '' then
    return false;
  end if;
  return exists (
    select 1
    from akun g
    join akun m on m.nis_nip = p_murid_nis and m.tipe = 'murid'
    where g.nis_nip = p_guru_nis and g.tipe = 'guru'
      and (
        (lower(trim(coalesce(g.wali_kelas, ''))) <> ''
         and lower(trim(g.wali_kelas)) = lower(trim(coalesce(m.tingkat_kelas, ''))))
        or exists (
          select 1
          from unnest(string_to_array(g.ekstrakurikuler, ',')) ge
          cross join unnest(string_to_array(m.ekstrakurikuler, ',')) me
          where trim(ge) <> '' and lower(trim(ge)) = lower(trim(me))
        )
      )
  );
end $$;

-- ========== 2. RPC: TAMBAH/EDIT AKUN MURID (dengan izin guru) ==========
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
  select coalesce(tipe, ''), coalesce(nis_nip, '')
    into v_pemanggil_tipe, v_pemanggil_nis
    from akun where user_id = auth.uid() limit 1;

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

-- ========== 3. RPC: SIMPAN FOTO MURID (juga izinkan guru wali/pembina) ==========
create or replace function simpan_foto_murid(
  p_nis text,
  p_url text,
  p_pemanggil_nis text,
  p_pemanggil_tipe text
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ada boolean;
begin
  p_nis := trim(coalesce(p_nis, ''));
  if p_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;

  select exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') into v_ada;
  if not v_ada then
    return json_build_object('status', 'error', 'message', 'Data murid tidak ditemukan.');
  end if;

  if p_pemanggil_tipe = 'admin'
     or (p_pemanggil_tipe = 'murid' and p_pemanggil_nis = p_nis)
     or (p_pemanggil_tipe = 'guru' and akun_guru_ampu_murid(p_pemanggil_nis, p_nis)) then
    null; -- diizinkan
  else
    return json_build_object('status', 'error', 'message', 'Tidak berhak mengganti foto murid ini.');
  end if;

  update akun set url_foto = nullif(trim(coalesce(p_url, '')), '')
  where nis_nip = p_nis and tipe = 'murid';

  return json_build_object('status', 'success', 'message', 'Foto murid tersimpan.');
end $$;

-- ========== 4. IZIN EKSEKUSI + RELOAD CACHE ==========
grant execute on function buat_akun_murid(jsonb) to anon, authenticated;
grant execute on function simpan_foto_murid(text, text, text, text) to anon, authenticated;
grant execute on function akun_guru_ampu_murid(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- [59/84] upgrade_20261016_wajah_akses_guru.sql
-- ============================================================
-- ============================================================
-- UPGRADE: IZINKAN GURU (WALI KELAS/PEMBINA) SIMPAN WAJAH MURID — 2026-12-11
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Menu "Data Akun Murid" kini menampilkan tombol "Wajah Masal" (dan "Upload Foto")
--   untuk admin & guru (wali kelas / pembina ekskul) — lihat bisaImportMuridAktif()
--   di web/js/app.js. Namun RPC `simpan_wajah_murid` selama ini hanya mengizinkan
--   admin atau murid pemilik NIS, sehingga guru yang menjalankan scan wajah masal
--   selalu ditolak ("Tidak berhak mengubah data wajah murid ini").
--
-- ISI UPGRADE:
--   1) Helper `akun_guru_ampu_murid` dibuat PASTI ada (create or replace,
--      idempotent) — bisa berdiri sendiri meski dijalankan sebelum upgrade_20261015.
--   2) `simpan_wajah_murid` diubah: selain admin & murid pemilik, guru DIIZINKAN
--      bila ia WALI KELAS murid tsb ATAU PEMBINA ekskul murid.
--
-- Idempotent (create or replace) — aman dijalankan berulang.
-- ============================================================

-- ========== 1. HELPER (PASTI ADA): GURU MENGAMPU MURID? ==========
create or replace function akun_guru_ampu_murid(p_guru_nis text, p_murid_nis text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if trim(coalesce(p_guru_nis, '')) = '' or trim(coalesce(p_murid_nis, '')) = '' then
    return false;
  end if;
  return exists (
    select 1
    from akun g
    join akun m on m.nis_nip = p_murid_nis and m.tipe = 'murid'
    where g.nis_nip = p_guru_nis and g.tipe = 'guru'
      and (
        (lower(trim(coalesce(g.wali_kelas, ''))) <> ''
         and lower(trim(g.wali_kelas)) = lower(trim(coalesce(m.tingkat_kelas, ''))))
        or exists (
          select 1
          from unnest(string_to_array(g.ekstrakurikuler, ',')) ge
          cross join unnest(string_to_array(m.ekstrakurikuler, ',')) me
          where trim(ge) <> '' and lower(trim(ge)) = lower(trim(me))
        )
      )
  );
end $$;

-- ========== 2. RPC: SIMPAN / HAPUS DATA WAJAH (MULTI-SAMPEL) — +IZIN GURU ==========
-- Otorisasi:
--   - admin                       : boleh penuh (termasuk masal).
--   - murid pemilik NIS           : kelola mandiri.
--   - guru (wali kelas/pembina)   : boleh pada murid yang diampu.
create or replace function simpan_wajah_murid(
  p_nis text,
  p_descriptor jsonb default null,
  p_status text default 'aktif',
  p_pemanggil_nis text default null,
  p_pemanggil_tipe text default null,
  p_mode text default 'ganti'
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ada boolean;
  v_list jsonb;
  v_lama jsonb;
  v_baru jsonb;
  v_jumlah int;
  v_jumlah_lama int;
  v_i int;
  v_j int;
  v_sampel jsonb;
  v_elemen jsonb;
begin
  p_nis := trim(coalesce(p_nis, ''));
  p_status := lower(trim(coalesce(p_status, '')));
  p_mode := lower(trim(coalesce(p_mode, 'ganti')));

  if p_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;

  select exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') into v_ada;
  if not v_ada then
    return json_build_object('status', 'error', 'message', 'Data murid tidak ditemukan.');
  end if;

  -- Otorisasi: admin, murid pemilik, atau guru wali kelas/pembina ekskul murid tsb.
  if p_pemanggil_tipe <> 'admin'
     and not (p_pemanggil_tipe = 'murid' and p_pemanggil_nis = p_nis)
     and not (p_pemanggil_tipe = 'guru' and akun_guru_ampu_murid(p_pemanggil_nis, p_nis)) then
    return json_build_object('status', 'error', 'message', 'Tidak berhak mengubah data wajah murid ini.');
  end if;


  -- ===== Normalisasi + validasi p_descriptor =====
  if p_descriptor is not null then
    if jsonb_typeof(p_descriptor) <> 'array' then
      return json_build_object('status', 'error', 'message', 'Deskriptor wajah harus berupa array 128 angka (atau array dari array semacam itu).');
    end if;
    -- Klien lama/kirimanku masih BISA mengirim flat [128 angka] → bungkus sekali.
    if jsonb_array_length(p_descriptor) = 128 and jsonb_typeof(p_descriptor -> 0) = 'number' then
      v_list := jsonb_build_array(p_descriptor);
    else
      v_list := p_descriptor;
    end if;

    v_jumlah := jsonb_array_length(v_list);
    if v_jumlah < 1 then
      return json_build_object('status', 'error', 'message', 'Minimal satu sampel wajah diperlukan.');
    end if;
    if p_mode = 'tambah' and v_jumlah <> 1 then
      return json_build_object('status', 'error', 'message', 'Mode tambah menerima tepat satu sampel (array 128 angka).');
    end if;
    if p_mode = 'ganti' and v_jumlah > 6 then
      return json_build_object('status', 'error', 'message', 'Maksimal 6 sampel wajah per murid (' || v_jumlah || ' diberikan).');
    end if;

    for v_i in 0 .. v_jumlah - 1 loop
      v_sampel := v_list -> v_i;
      if jsonb_typeof(v_sampel) <> 'array' or jsonb_array_length(v_sampel) <> 128 then
        return json_build_object('status', 'error', 'message', 'Setiap sampel wajah harus berupa array 128 angka.');
      end if;
      for v_j in 0 .. 127 loop
        v_elemen := v_sampel -> v_j;
        if jsonb_typeof(v_elemen) not in ('number') or not (v_elemen #>> '{}')::double precision between -10 and 10 then
          return json_build_object('status', 'error', 'message', 'Deskriptor wajah berisi nilai tidak valid.');
        end if;
      end loop;
    end loop;
  end if;

-- ===== Terapkan =====
  if p_status = 'aktif' and p_descriptor is not null then
    if p_mode = 'tambah' then
      select coalesce(wajah_descriptor, '[]'::jsonb) into v_lama
        from akun where nis_nip = p_nis and tipe = 'murid';
      -- Baris lama yang belum sempat dimigrasi (flat) → bungkus dulu sebelum append.
      if jsonb_typeof(v_lama) = 'array' and jsonb_array_length(v_lama) = 128 and jsonb_typeof(v_lama -> 0) = 'number' then
        v_lama := jsonb_build_array(v_lama);
      end if;
      if jsonb_typeof(v_lama) <> 'array' then
        v_lama := '[]'::jsonb;
      end if;
      v_jumlah_lama := jsonb_array_length(v_lama);
      if v_jumlah_lama + 1 > 6 then
        return json_build_object('status', 'error', 'message', 'Maksimal 6 sampel wajah per murid — gunakan mode ganti untuk mengganti seluruh data.');
      end if;
      v_baru := v_lama || v_list;
      update akun
         set wajah_descriptor = v_baru,
             wajah_status     = 'aktif'
       where nis_nip = p_nis and tipe = 'murid';
      return json_build_object('status', 'success', 'message', 'Data wajah murid tersimpan (' || jsonb_array_length(v_baru) || ' sampel).');
    else
      update akun
         set wajah_descriptor = v_list,
             wajah_status     = 'aktif'
       where nis_nip = p_nis and tipe = 'murid';
      return json_build_object('status', 'success', 'message', 'Data wajah murid tersimpan (' || jsonb_array_length(v_list) || ' sampel).');
    end if;
  elsif p_status = 'nonaktif' then
    update akun
       set wajah_status = 'nonaktif'
     where nis_nip = p_nis and tipe = 'murid';
    return json_build_object('status', 'success', 'message', 'Data wajah murid dinonaktifkan.');
  else
    -- hapus total (p_status NULL/'' atau p_descriptor NULL)
    update akun
       set wajah_descriptor = null,
           wajah_status     = null
     where nis_nip = p_nis and tipe = 'murid';
    return json_build_object('status', 'success', 'message', 'Data wajah murid dihapus.');
  end if;
end $$;


-- ========== 3. DROP OVERLOAD LAMA + IZIN + RELOAD CACHE ==========
drop function if exists simpan_wajah_murid(text, jsonb, text, text, text);

grant execute on function akun_guru_ampu_murid(text, text) to anon, authenticated;
grant execute on function simpan_wajah_murid(text, jsonb, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';


-- ============================================================
-- [60/84] upgrade_20261017_ubah_profil_guru.sql
-- ============================================================
-- ============================================================
-- UPGRADE: EDIT PROFIL GURU MANDIRI (Daftar Guru / Data Akun Guru) — 2026-10-17
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Menu "Data Akun Guru" kini memiliki tab "Daftar Guru" yang dapat dibuka
--   guru (bukan hanya admin). Pada tab itu guru melihat tabel guru TANPA kolom
--   Aksi; hanya baris miliknya sendiri yang punya tombol "Edit Profil".
--   Namun RLS tabel `akun` tidak mengizinkan anon/authenticated meng-update
--   baris akun sembarang, sehingga perlu RPC security-definer `ubah_profil_guru`
--   (pola sama dengan `ubah_profil_murid`) yang:
--     - membuat kepemilikan: admin ATAU guru pemilik NIP (via auth.uid()).
--     - hanya memperbarui kolom profil pribadi (bukan email / password / penugasan).
--
-- Idempotent (create or replace) — aman dijalankan berulang.
-- ============================================================

create or replace function ubah_profil_guru(p_nip text, p_data jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if trim(coalesce(p_nip, '')) = '' then
    return json_build_object('status', 'error', 'message', 'NIP wajib diisi.');
  end if;
  if not exists (select 1 from akun where nis_nip = p_nip and tipe = 'guru') then
    return json_build_object('status', 'error', 'message', 'Akun guru tidak ditemukan.');
  end if;

  -- Kebijakan kepemilikan: hanya admin, atau guru pemilik NIP ini.
  if coalesce((select tipe from akun where user_id = auth.uid()), '') <> 'admin'
     and not exists (
       select 1 from akun
       where user_id = auth.uid() and nis_nip = p_nip and tipe = 'guru'
     ) then
    return json_build_object('status', 'error', 'message', 'Anda hanya dapat mengedit profil guru milik Anda (atau oleh admin).');
  end if;

  update akun set
    nama_lengkap    = coalesce(p_data->>'nama_lengkap', nama_lengkap),
    gelar_depan     = coalesce(p_data->>'gelar_depan', gelar_depan),
    gelar_belakang  = coalesce(p_data->>'gelar_belakang', gelar_belakang),
    jabatan         = coalesce(p_data->>'jabatan', jabatan),
    no_telepon      = coalesce(p_data->>'no_telepon', no_telepon)
  where nis_nip = p_nip and tipe = 'guru';

  return json_build_object('status', 'success', 'message', 'Profil guru berhasil diperbarui.');
end $$;

-- ========== IZIN EKSEKUSI + RELOAD CACHE ==========
grant execute on function ubah_profil_guru(text, jsonb) to anon, authenticated;
notify pgrst, 'reload schema';

-- ============================================================
-- [61/84] upgrade_20261018_fix_nilai_grant_lengkap.sql
-- ============================================================
-- ============================================================
-- FIX LENGKAP: GRANT PRIVILEGE TABEL MODUL NILAI
-- (42501 / HTTP 401 — PERMISSION DENIED PADA MENU INPUT NILAI) — 2026-10-18
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- ------------------------------------------------------------------
-- LATAR BELAKANG:
--   Menu "Input Nilai" (Pengetahuan/Keterampilan/Sikap/Ekstrakurikuler)
--   gagal dimuat dengan pesan:
--     "Gagal memuat data. Periksa koneksi internet Anda."
--   Di DevTools → Network, permintaan yang gagal adalah:
--     GET /rest/v1/nilai_konfigurasi?select=config&kategori=eq....&mapel=eq....
--     HTTP 401 { "code":"42501", "message":"permission denied for table nilai_konfigurasi" }
--
--   Penyebab: tabel-tabel modul nilai di database project ini TIDAK
--   memiliki GRANT privilege tingkat tabel untuk role API `authenticated`.
--   RLS policy saja TIDAK cukup — PostgREST menolak permintaan SEBELUM
--   mengevaluasi RLS bila privilege tabel tidak ada.
--
--   File `upgrade_20261014b_fix_nilai_grant.sql` sudah menambahkan grant
--   untuk nilai_konfigurasi / nilai_teman_sejawat / jurnal_sikap. File ini
--   MELENGKAPI-nya dengan grant tabel `nilai` (utama, dipakai query
--   loadDataNilai & nilai pasangan) serta menegaskan ulang semuanya secara
--   idempotent aman dijalankan berulang.
--
-- ISI:
--   1) nilai_konfigurasi → select/insert/update/delete utk authenticated
--   2) nilai               → select/insert/update/delete utk authenticated
--   3) nilai_teman_sejawat → select/insert/update/delete utk authenticated
--   4) jurnal_sikap        → select/insert/update/delete utk authenticated
--   5) Reload cache skema PostgREST
-- ============================================================

revoke all on table nilai_konfigurasi from anon, authenticated;
grant select, insert, update, delete on nilai_konfigurasi to authenticated;

revoke all on table nilai from anon, authenticated;
grant select, insert, update, delete on nilai to authenticated;

revoke all on table nilai_teman_sejawat from anon, authenticated;
grant select, insert, update, delete on nilai_teman_sejawat to authenticated;

revoke all on table jurnal_sikap from anon, authenticated;
grant select, insert, update, delete on jurnal_sikap to authenticated;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [62/84] upgrade_kartu_id_card.sql
-- ============================================================
-- ============================================================
-- UPGRADE KARTU ID (KARTU PELAJAR) — konfigurasi baris identitas
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   Kolom konfigurasi kartu pelajar pada baris identitas master_data:
--     - "URL TTD Kepsek"        : tautan gambar tanda tangan (.png) Kepala Sekolah
--     - "URL Background Kartu"  : tautan gambar background kartu (depan)
--     - "Warna Header"          : hex warna header (banner) kartu
--     - "Warna Aksen"           : hex warna aksen (opsional)
--     - "URL Logo Belakang"     : logo untuk sisi belakang kartu
--     - "Konten Belakang"       : teks/bullet untuk sisi belakang kartu
-- Semua idempotent — aman dijalankan berulang.
-- ============================================================

alter table master_data
  add column if not exists "URL TTD Kepsek" text,
  add column if not exists "URL Background Kartu" text,
  add column if not exists "Warna Header" text,
  add column if not exists "Warna Aksen" text,
  add column if not exists "URL Logo Belakang" text,
  add column if not exists "Konten Belakang" text;

-- ============================================================
-- [63/84] upgrade_20261018b_jurusan_lengkap.sql
-- ============================================================
-- ============================================================
-- upgrade_20261018b_jurusan_lengkap.sql
-- Perbaikan: error PostgREST
--   "Could not find the 'Jurusan Lengkap' column of 'master_data'
--    in the schema cache"
-- ketika INPUT / EDIT (juga Wizard) jurusan di menu Master Data.
--
-- Penyebab: frontend (web/js/app.js) menulis kolom "Jurusan Lengkap"
--   (pasangan "Singkatan -> Nama Lengkap" jurusan) pada operasi
--   tambahMasterDaftarJurusan / simpanEditMasterDaftar /
--   bukaWizardJurusan / hapusMasterDaftar, tetapi kolom tsb belum
--   pernah dibuat di skema database.
--
-- Isi (idempotent, aman dijalankan berulang):
--   1) add column if not exists master_data."Jurusan Lengkap" text
--   2) reload schema cache PostgREST
-- ============================================================

alter table master_data
  add column if not exists "Jurusan Lengkap" text;

notify pgrst, 'reload schema';

-- ============================================================
-- [64/84] upgrade_20261018c_nip_kepala_sekolah.sql
-- ============================================================
-- ============================================================
-- upgrade_20261018c_nip_kepala_sekolah.sql
-- Menambah kolom "NIP Kepala Sekolah" pada tabel master_data.
--
-- Dipakai untuk menampilkan NIP Kepala Sekolah di kartu pelajar
-- (blok TTD/nama/NIP paling bawah, sejajar foto & QR).
-- Diisi lewat Master Data → tab Identitas Sekolah.
--
-- Isi (idempotent, aman dijalankan berulang):
--   1) add column if not exists master_data."NIP Kepala Sekolah" text
--   2) reload schema cache PostgREST
-- ============================================================

alter table master_data
  add column if not exists "NIP Kepala Sekolah" text;

notify pgrst, 'reload schema';

-- ============================================================
-- [65/84] fix_20261019_ubah_anggota_ekskul_updated_at.sql
-- ============================================================
-- ============================================================
-- FIX 2026-10-19: ubah_anggota_ekskul — kolom akun.updated_at TIDAK ADA
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   RPC ubah_anggota_ekskul melakukan "update akun set ekstrakurikuler = v_baru,
--   updated_at = now()". Tabel akun TIDAK memiliki kolom updated_at, sehingga
--   saat "Tambah Anggota" / "Import Anggota" Ekstrakurikuler dijalankan muncul:
--     column "updated_at" of relation "akun" does not exist
--
--   Perbaikan: hapus "updated_at = now()" dari statement update.
--   Idempotent (create or replace) — aman dijalankan berulang.
--
--   CATATAN: web/js/app.js juga sudah diperkuat agar otomatis fallback ke
--   jalur SELECT+UPDATE langsung bila RPC ini gagal (mis. sebelum file ini
--   dijalankan di DB online).
-- ============================================================

create or replace function ubah_anggota_ekskul(p_pemanggil text, p_ekskul text, p_nis_list text[], p_tambah boolean)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tipe text;
  v_jabatan_map jsonb;
  v_wali_kelas text;
  v_ekstra text;
  v_nis text;
  v_ekstra_siswa text;
  v_baru text;
  v_total int := 0;
begin
  -- 1) Identitas pemanggil
  select tipe, jabatan_ekskul_map, wali_kelas, ekstrakurikuler
  into v_tipe, v_jabatan_map, v_wali_kelas, v_ekstra
  from akun
  where nis_nip = p_pemanggil;

  if not found then
    return json_build_object('status', 'error', 'message', 'Akun pemanggil tidak ditemukan.');
  end if;

  -- 2) Verifikasi hak akses per tipe
  if v_tipe = 'admin' then
    -- admin selalu boleh
    null;
  elsif v_tipe = 'guru' then
    -- Guru WALI KELAS (kolom wali_kelas terisi) atau PEMBINA ekskul ini
    -- (p_ekskul termasuk kolom ekstrakurikuler guru) yang boleh mengubah
    -- anggota. Guru biasa (bukan wali kelas / bukan pembina ekskul tsb)
    -- TIDAK diizinkan — senada dengan bolehKelolaAnggotaEkskul() di app.js.
    if coalesce(trim(coalesce(v_wali_kelas, '')), '') = ''
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
    -- pengurus: punya jabatan (tidak kosong) pada ekskul ini
    if v_jabatan_map is null or coalesce(trim(coalesce(v_jabatan_map->>p_ekskul, '')), '') = '' then
      return json_build_object('status', 'error', 'message', 'Hanya pengurus (menjabat) ' || p_ekskul || ' yang dapat mengubah anggota.');
    end if;
  else
    return json_build_object('status', 'error', 'message', 'Tipe akun pemanggil tidak dikenal.');
  end if;

  -- 3) Terapkan per NIS (gabung/buang nama ekskul, anti-duplikat)
  if p_nis_list is null then
    p_nis_list := array[]::text[];
  end if;

  foreach v_nis in array p_nis_list loop
    if trim(coalesce(v_nis, '')) = '' then continue; end if;

    select ekstrakurikuler into v_ekstra_siswa
    from akun
    where nis_nip = v_nis and tipe = 'murid'
    for update;

    if not found then continue; end if;

    if p_tambah then
      if lower(trim(p_ekskul)) = any (
        select lower(trim(x)) from unnest(string_to_array(v_ekstra_siswa, ',')) as x where trim(x) <> ''
      ) then
        v_baru := v_ekstra_siswa; -- sudah jadi anggota → tidak ada perubahan
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
        from unnest(string_to_array(v_ekstra_siswa, ',')) as t(x)
        where trim(x) <> '' and lower(trim(x)) <> lower(trim(p_ekskul))
      ) s;
      v_baru := coalesce(v_baru, '');
    end if;

    if coalesce(v_baru, '') = coalesce(v_ekstra_siswa, '') then continue; end if;

    update akun
    set ekstrakurikuler = v_baru
    where nis_nip = v_nis;

    v_total := v_total + 1;
  end loop;

  return json_build_object('status', 'success', 'total', v_total);
end $$;

-- ========== IZIN EKSEKUSI + RELOAD CACHE ==========
grant execute on function ubah_anggota_ekskul(text, text, text[], boolean) to anon, authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- [66/84] upgrade_20261020_ekskul_riwayat_ta.sql
-- ============================================================
-- ============================================================
-- UPGRADE: RIWAYAT KEANGGOTAAN EKSTRAKURIKULER PER TAHUN PELAJARAN — 2026-10-20
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Keanggotaan siswa pada Ekstrakurikuler selama ini hanya tersimpan pada
--   kolom akun.ekstrakurikuler (daftar ekskul "live" siswa) TANPA dimensi
--   Tahun Pelajaran / angkatan. Akibatnya "Anggota Aktif" tidak berubah antar
--   tahun, dan menu Hadir Tatap Muka tidak dapat memisahkan keanggotaan per TA.
--
-- ISI (mengikuti pola akun.riwayat_kelas pada upgrade_20260911_riwayat_siswa.sql):
--   1) Kolom akun.riwayat_ekskul (jsonb) untuk murid: daftar ekskul, peta
--      jabatan & status keanggotaan PER TAHUN PELAJARAN.
--   2) Migrasi data eksisting: isi riwayat_ekskul[TA berjalan] dari
--      akun.ekstrakurikuler + akun.jabatan_ekskul_map (tanpa mengubah data lama).
--   3) RPC ubah_anggota_ekskul di-upgrade: parameter p_ta + dual-write ke
--      akun.ekstrakurikuler (live) DAN akun.riwayat_ekskul[TA] — persis pola
--      dual-write kenaikan kelas (tingkat_kelas ↔ riwayat_kelas).
--
-- Struktur riwayat_ekskul:
--   { "2026/2027": { "ekskul": "Pramuka, PMR", "jabatan_map": { "Pramuka":"Ketua" },
--                    "status": "Aktif" },
--     "2027/2028": { "ekskul": "Pramuka, Paskibra", "jabatan_map": {},
--                    "status": "Aktif" } }
--   status: Aktif | Keluar  (non-Aktif disembunyikan dari roster TA tsb.)
--   Kebijakan pemakaian (konsisten app.js & utils.example.js):
--     riwayat_ekskul MASIH KOSONG (migrasi belum dijalankan) → fallback ke
--     kolom akun.ekstrakurikuler (live), kompatibilitas data lama.
--     riwayat_ekskul SUDAH TERISI → keanggotaan ditentukan PER TA; TA tanpa
--     entri = bukan anggota TA tsb (roster kosong, TA baru).
--
-- Idempotent (create or replace / add column if not exists) — aman dijalankan berulang.
-- ============================================================

-- ========== 1. KOLOM RIWAYAT EKSKUL ==========
alter table akun
  add column if not exists riwayat_ekskul jsonb not null default '{}'::jsonb;

comment on column akun.riwayat_ekskul is
  'Riwayat keanggotaan ekstrakurikuler per tahun pelajaran: { "TA": { "ekskul": "Pramuka, PMR", "jabatan_map": {...}, "status": "Aktif|Keluar" } }. Tahun tanpa entri = fallback kolom ekstrakurikuler (live).';

-- ========== 2. MIGRASI DATA EKSISTING (sekali, idempotent) ==========
-- Isi riwayat_ekskul untuk TA berjalan (diambil dari Master Data) bagi murid
-- yang belum punya entri riwayat, agar roster per-TA konsisten sejak awal.
do $$
declare
  v_ta text := (select coalesce(
                 nullif(trim(min(m."Tahun Pelajaran")::text), ''),
                 to_char(now() at time zone 'Asia/Jakarta', 'YYYY') || '/' ||
                 to_char((now() at time zone 'Asia/Jakarta') + interval '1 year', 'YYYY'))
               from master_data m
               where m."Tahun Pelajaran" is not null
                 and trim(m."Tahun Pelajaran"::text) <> '');
  r record;
begin
  if v_ta is null or trim(v_ta) = '' then
    v_ta := to_char(now() at time zone 'Asia/Jakarta', 'YYYY') || '/' ||
            to_char((now() at time zone 'Asia/Jakarta') + interval '1 year', 'YYYY');
  end if;

  for r in
    select nis_nip, coalesce(trim(ekstrakurikuler), '') as ek,
           coalesce(jabatan_ekskul_map, '{}'::jsonb) as jmap
    from akun
    where tipe = 'murid'
      and coalesce(trim(ekstrakurikuler), '') <> ''
      and (riwayat_ekskul is null or riwayat_ekskul = '{}'::jsonb
           or not (riwayat_ekskul ? v_ta))
  loop
    update akun
       set riwayat_ekskul = jsonb_set(
              coalesce(riwayat_ekskul, '{}'::jsonb),
              array[v_ta],
              jsonb_build_object('ekskul', r.ek, 'jabatan_map', r.jmap, 'status', 'Aktif')
            )
     where nis_nip = r.nis_nip;
  end loop;
end $$;

-- ========== 3. RPC ubah_anggota_ekskul — DUAL-WRITE PER TA ==========
create or replace function ubah_anggota_ekskul(
  p_pemanggil text,
  p_ekskul text,
  p_nis_list text[],
  p_tambah boolean,
  p_ta text default null
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
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
begin
  -- 0) TA berjalan: parameter eksplisit, atau turunkan dari Master Data
  v_ta := coalesce(nullif(trim(coalesce(p_ta, '')), ''), (
    select min(m."Tahun Pelajaran")::text from master_data m
    where m."Tahun Pelajaran" is not null and trim(m."Tahun Pelajaran"::text) <> ''
  ), to_char(now() at time zone 'Asia/Jakarta', 'YYYY') || '/' ||
       to_char((now() at time zone 'Asia/Jakarta') + interval '1 year', 'YYYY'));

  -- 1) Identitas pemanggil
  select tipe, jabatan_ekskul_map, wali_kelas, ekstrakurikuler
  into v_tipe, v_jabatan_map, v_wali_kelas, v_ekstra
  from akun
  where nis_nip = p_pemanggil;

  if not found then
    return json_build_object('status', 'error', 'message', 'Akun pemanggil tidak ditemukan.');
  end if;

  -- 2) Verifikasi hak akses per tipe
  if v_tipe = 'admin' then
    null;
  elsif v_tipe = 'guru' then
    if coalesce(trim(coalesce(v_wali_kelas, '')), '') = ''
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

    update akun
       set ekstrakurikuler = v_baru,
           riwayat_ekskul = jsonb_set(
              coalesce(v_riwayat, '{}'::jsonb),
              array[v_ta],
              jsonb_build_object('ekskul', v_baru_riwayat, 'jabatan_map', v_jmap, 'status', 'Aktif')
           )
     where nis_nip = v_nis;

    v_total := v_total + 1;
  end loop;

  return json_build_object('status', 'success', 'total', v_total);
end $$;

-- ========== IZIN EKSEKUSI + RELOAD CACHE ==========
drop function if exists ubah_anggota_ekskul(text, text, text[], boolean);
grant execute on function ubah_anggota_ekskul(text, text, text[], boolean, text) to anon, authenticated;

notify pgrst, 'reload schema';


-- ============================================================
-- [67/84] upgrade_20261020b_piket_tabel_multi.sql
-- ============================================================
-- ============================================================
-- UPGRADE 2026-10-20(b): PIKET TABEL MULTI + MATRIK CEKLIS v2
-- Jalankan SELURUH file ini di Supabase Dashboard -> SQL Editor -> Run
--
-- LATAR BELAKANG:
--   Rework modul Piket Mobile (v2):
--     1) Tabel piket multi: satu ekskul bisa punya MANY tabel piket
--        (mis. "Piket 1", "Tabel Minggu A", "Piket Tugas Kelas").
--     2) Matrik transposé: baris = siswa, kolom = hari, sel = ceklis
--        hadir (✓/○) yang boleh ditulis oleh jabatan yang ditunjuk
--        (ceklis_jabatan) atau admin/guru.
--     3) Flag `lock` per tabel: bila di-lock, jadwal bekukan — hanya
--        ceklis hadir yang masih boleh (RLS tetap pola proyek ini:
--        anon & authenticated = penuh, akses ditegakkan di client).
--
-- Isi file ini (idempotent — aman dijalankan berulang):
--   1) Tabel tabel_piket_ekskul — banyak baris per ekskul:
--        ekskul         : nama ekskul
--        nama           : nama tabel (default 'Piket 1'), unique per ekskul
--        hari           : jsonb array hari aktif, cth ["Senin","Rabu"]
--        piket          : jsonb objek hari -> array [{nis,nama,cek,cek_by,cek_at}]
--        ceklis_jabatan : jsonb array jabatan yang boleh menulis tanda ceklis
--        lock           : boolean, jadwal bekukan bila true
--   2) Migrasi data satu kali dari jadwal_piket_ekskul (tabel lama
--      masih ada untuk rollback; UI baru baca/menulis tabel_piket_ekskul).
--   3) Grant + RLS (anon = sesi murid password lokal, pola proyek ini).
-- ============================================================

-- ========== 1. TABEL PIKET MULTI ==========
create table if not exists tabel_piket_ekskul (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  nama text not null default 'Piket 1',
  hari jsonb not null default '["Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"]'::jsonb,
  piket jsonb not null default '{}'::jsonb,
  ceklis_jabatan jsonb not null default '["Ketua","Wakil Ketua","Sekretaris 1","Sekretaris 2"]'::jsonb,
  lock boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ekskul, nama)
);
-- hari : ["Senin", ...] (urut DAFTAR_HARI_PIKET di app.js)
-- piket: { "Senin": [{ "nis": "...", "nama": "...", "cek": false, "cek_by": null, "cek_at": null }], ... }

-- ========== 2. MIGRASI DATA LAMA (jika tabel baru masih kosong) ==========
insert into tabel_piket_ekskul (ekskul, nama, hari, piket, created_at, updated_at)
select j.ekskul, 'Piket 1', j.hari, j.piket, j.created_at, j.updated_at
from jadwal_piket_ekskul j
where not exists (select 1 from tabel_piket_ekskul t where t.ekskul = j.ekskul);

-- ========== 3. GRANT + RLS (anon = sesi murid password lokal, pola proyek ini) ==========
alter table tabel_piket_ekskul enable row level security;

do $$
begin
  drop policy if exists tabel_piket_ekskul_select_all on tabel_piket_ekskul;
  create policy tabel_piket_ekskul_select_all on tabel_piket_ekskul for select using (true);
  drop policy if exists tabel_piket_ekskul_insert_all on tabel_piket_ekskul;
  create policy tabel_piket_ekskul_insert_all on tabel_piket_ekskul for insert with check (true);
  drop policy if exists tabel_piket_ekskul_update_all on tabel_piket_ekskul;
  create policy tabel_piket_ekskul_update_all on tabel_piket_ekskul for update using (true);
  drop policy if exists tabel_piket_ekskul_delete_all on tabel_piket_ekskul;
  create policy tabel_piket_ekskul_delete_all on tabel_piket_ekskul for delete using (true);
  execute 'grant select, insert, update, delete on tabel_piket_ekskul to anon, authenticated';
end $$;

-- Reload cache skema PostgREST
notify pgrst, 'reload schema';

-- ============================================================
-- [68/84] upgrade_20261021_ekskul_riwayat_semester.sql
-- ============================================================
-- ============================================================
-- UPGRADE: DIMENSI SEMESTER PADA KEANGGOTAAN EKSTRAKURIKULER — 2026-10-21
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   upgrade_20261020 menambah riwayat_ekskul[TA] = { ekskul, jabatan_map, status }
--   TANPA dimensi semester. Padahal dalam satu TA ada dua semester, dan keanggotaan
--   dapat berbeda tiap semester (siswa A ikut SM1 saja, B lanjut SM1→SM2, C ikut SM2 saja).
--   File ini menambah dimensi SEMESTER pada entri TA:
--     riwayat_ekskul[TA].smt = { "<Ekskul>": ["Ganjil","Genap"], ... }
--
-- KEBJAKAN (konsisten app.js & utils.example.js):
--   - SUATU Ekskul tanpa kunci `smt[ekskul]` → dianggap aktif di KEDUA semester
--     (perilaku lama), biar data yang sudah ada tidak berubah.
--   - `smt[ekskul]` berisi daftar semester ("Ganjil"/"Genap") tempat siswa mengikuti
--     ekskul itu pada TA tsb. Roster Info/Profil difilter per semester pilihan.
--   - RPC ubah_anggota_ekskul menerima p_smt (text[]) dan menggabungkannya (union)
--     ke smt[ekskul] sehingga keanggotaan lintas semester (skenario B) terjaga.
--
-- Idempotent (create or replace) — aman dijalankan berulang.
-- ============================================================


-- ========== 1. RPC ubah_anggota_ekskul — TAMBAH DIMENSI SEMESTER ==========
create or replace function ubah_anggota_ekskul(
  p_pemanggil text,
  p_ekskul text,
  p_nis_list text[],
  p_tambah boolean,
  p_ta text default null,
  p_smt text[] default null
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
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

  -- 1) Identitas pemanggil
  select tipe, jabatan_ekskul_map, wali_kelas, ekstrakurikuler
  into v_tipe, v_jabatan_map, v_wali_kelas, v_ekstra
  from akun
  where nis_nip = p_pemanggil;

  if not found then
    return json_build_object('status', 'error', 'message', 'Akun pemanggil tidak ditemukan.');
  end if;

  -- 2) Verifikasi hak akses per tipe
  if v_tipe = 'admin' then
    null;
  elsif v_tipe = 'guru' then
    if coalesce(trim(coalesce(v_wali_kelas, '')), '') = ''
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

-- ========== IZIN EKSEKUSI + RELOAD CACHE ==========
-- Hapus overload lama (5 argumen) lalu izinkan baris baru (6 argumen).
drop function if exists ubah_anggota_ekskul(text, text, text[], boolean, text);
grant execute on function ubah_anggota_ekskul(text, text, text[], boolean, text, text[]) to anon, authenticated;

notify pgrst, 'reload schema';


-- ============================================================
-- [69/84] upgrade_20261022_edupresensi.sql
-- ============================================================
-- ============================================================
-- UPGRADE: EDUPRESENSI → GEOFENCE GPS ABSEN MANDIRI — 2026-10-22
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Integratie (EduPresensi op hoofdaap Administrasi-Sekolah, SMKN 2 Banjar):
--   1) Konfiguratie in SISIP → Master Data → Konfigurasi (baris identitas):
--        * "Latitude Sekolah"     → koordinat GPS sekolah (teks)
--        * "Longitude Sekolah"    → koordinat GPS sekolah (teks)
--        * "Radius Geofence (m)"  → radius meter (default '150'; 0/kosong = UIT)
--      Student leest deze via anon READ (geen auth nodig) en de hoofdaap
--      blokkeerd Absen Mandiri (wajah + GPS) bila buiten de radius.
--   2) Self-healing kolom + RLS/grant tabel absensi (zelfde als
--      upgrade_20261014c_absen_mandiri_rpc.sql).
--
-- NB: RPC apart `absen_wajah_edupresensi` (standalone kiosk) is GESCHRAPT —
--     de hoofdaap gebruikt allang `absen_mandiri` (security definer, p_gps +
--     p_wajah_cocok). Dit bestand voegt alleen de kolommen master_data toe.
--
-- Idempotent — aman dijalankan berulang. Data lama niet geraakt.
-- ============================================================

-- ========== 0. GEOFENCE KONFIGURATIE (TABEL MASTER_DATA) ==========
-- Kolommen op baris identitas (rij met "Nama Sekolah"), stijl Google-Sheets
-- (teks) — zoals de rest van master_data. Gelezen door de hoofdaap bij elke
-- Absen Mandiri. Radius 0 / kosong → geofence UIT (kompatibilitas lama).
alter table master_data add column if not exists "Latitude Sekolah" text default '';
alter table master_data add column if not exists "Longitude Sekolah" text default '';
alter table master_data add column if not exists "Radius Geofence (m)" text default '150';

-- ========== 1. SELF-HEALING KOLOM ==========
alter table absensi add column if not exists gps text default '';
alter table absensi add column if not exists metode text default 'Manual / QR';
alter table absensi add column if not exists wajah_cocok boolean not null default false;

-- ========== 2. RLS + GRANT TABEL ABSENSI (garantie baseline) ==========
-- Murid lokal gebruikt anon key — SELECT blijft open voor anon (dashboard) en
-- tulis gebeurt via RPC security definer (+ backward-compat tulis anon/auth).
alter table absensi enable row level security;

drop policy if exists "absensi_baca_semua" on absensi;
create policy "absensi_baca_semua" on absensi
  for select using (true);

drop policy if exists "absensi_tulis_semua" on absensi;
create policy "absensi_tulis_semua" on absensi
  for insert with check (true);

drop policy if exists "absensi_ubah_semua" on absensi;
create policy "absensi_ubah_semua" on absensi
  for update using (true) with check (true);

drop policy if exists "absensi_hapus_semua" on absensi;
create policy "absensi_hapus_semua" on absensi
  for delete using (true);

revoke all on table absensi from anon, authenticated;
grant select, insert, update, delete on absensi to anon, authenticated;

-- ========== 3. RELOAD CACHE ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [70/84] upgrade_20261023_absen_mandiri_metode.sql
-- ============================================================
-- ============================================================
-- UPGRADE: ABSEN MANDIRI — DUA METODE: KODE CAPTCHA / FACE SCAN NIS
-- 2026-10-23
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Sejak upgrade_20261014c/14d, absen mandiri murid SIEMPRE memerlukan kode
--   captcha (zelf bij wajah): `absen_mandiri` mengembali 'Kode captcha wajib
--   diisi' bila p_captcha = '' en web/js/app.js blokkeerde jalankanAbsenMandiri
--   saat wajah cocok maar input captcha kosong. Gevolg: face scan is alleen
--   een "opsional extra" naast captcha — geen zelfstandige metode. Aanvraag:
--   siswa kiest EEN van DUA metode, allebei menulis 'H' (hadir) di absensi.
--
-- SOLUSI:
--   Metode 1 — Kode Captcha dari Guru   : kode invullen → hadir (flow lama).
--   Metode 2 — Face Scan sesuai akun NIS: scan wajah → cocok met eigen
--     descriptor (face.js single-label matcher, NIS eigen) → hadir DIRECT
--     tercatat ZONDER kode captcha.
--   `absen_mandiri` dibuat ulang met ZELFDE signature (11 param) maar validasi
--   captcha wordt VOORWAARDELIJK:
--     * p_captcha = ''  mag ALLEEN wanneer p_wajah_cocok = true;
--     * p_captcha <> '' → kode moet exact matchen (hoofdletters) zoals voorheen;
--     * in BEIDE methoden blijft de SESSIE-GATE verplicht: er moet een
--       guru/admin zijn met kunci_absen='BUKA' voor dit mapel/ekstrakurikuler.
--     * p_tanggal van browser blijft DIIGNOR (tanggal altijd WIB server).
--
-- Trust-model (zelfde als bestaande p_wajah_cocok): wajah-match gebeurt
-- client-side (face.js) tussen ingelogde NIS en zijn eigen geregistreerde
-- descriptor; foto's worden nooit verzonden. Geofence GPS (wanneer
-- geconfigureerd) en de sessie BUKA blijven gehandhaafd in beide methoden.
--
-- Semua idempotent — aman dijalankan berulang. Data lama niet aangeraakt.
-- ============================================================

-- ========== 1. SELF-HEALING KOLOM ==========
alter table absensi add column if not exists gps text default '';
alter table absensi add column if not exists metode text default 'Manual / QR';
alter table absensi add column if not exists wajah_cocok boolean not null default false;

-- ========== 2. RLS + GRANT TABEL ABSENSI (kembalikan ke baseline) ==========
-- Murid lokal memakai anon key — absen mandiri kini lewat RPC, maar SELECT
-- blijft open voor anon (dashboard/laporan murid lezen) en schrijven blijft
-- open voor authenticated (guru/admin via save_absen_masal).
alter table absensi enable row level security;

drop policy if exists "absensi_baca_semua" on absensi;
create policy "absensi_baca_semua" on absensi
  for select using (true);

drop policy if exists "absensi_tulis_semua" on absensi;
create policy "absensi_tulis_semua" on absensi
  for insert with check (true);

drop policy if exists "absensi_ubah_semua" on absensi;
create policy "absensi_ubah_semua" on absensi
  for update using (true) with check (true);

drop policy if exists "absensi_hapus_semua" on absensi;
create policy "absensi_hapus_semua" on absensi
  for delete using (true);

revoke all on table absensi from anon, authenticated;
grant select, insert, update, delete on absensi to anon, authenticated;

-- ========== 3. RPC ABSEN MANDIRI v3 — CAPTCHA VOORWAARDELIJK ==========
drop function if exists absen_mandiri(text, text, text, text, text, text, text, text, boolean, date, text);

create or replace function absen_mandiri(
  p_nis text,
  p_nama text,
  p_kelas text,
  p_tahun text,
  p_bulan text,
  p_mapel text,
  p_captcha text,
  p_gps text,
  p_wajah_cocok boolean default false,
  p_tanggal date default null,   -- DITERIMA voor compatibilitas klien lama, TAPI DIIGNOR
  p_jenis text default 'Mapel'   -- 'Mapel' | 'Ekskul' → bepaalt bucket kelas
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tanggal date;
  v_tahun_tgl int;
  v_bulan text;
  v_semester text;
  v_tahun text;
  v_ketemu boolean;
  v_sesi_buka boolean;
  v_metode text;
  v_kelas text := '';
  v_nama text := '';
  v_jenis text;
  v_riwayat jsonb;
  arr_bulan text[] := '{"Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"}';
begin
  -- Normalisasi masukan (pola 14c): captcha & mapel di-trim, captcha di-upper-case
  p_nis     := trim(coalesce(p_nis, ''));
  p_mapel   := trim(coalesce(p_mapel, ''));
  p_captcha := upper(trim(coalesce(p_captcha, '')));

  v_jenis := upper(coalesce(nullif(trim(p_jenis), ''), 'MAPEL'));
  if v_jenis not in ('MAPEL', 'EKSKUL') then
    return json_build_object('status', 'error', 'message', 'Jenis absen tidak valid (Mapel atau Ekskul).');
  end if;

  if p_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;
  if p_mapel = '' then
    return json_build_object('status', 'error', 'message', 'Pilih mata pelajaran / ekstrakurikuler terlebih dahulu.');
  end if;

  -- Identitas murid + data akun (nama & riwayat kelas DARI SERVER)
  select m.nama_lengkap, coalesce(m.riwayat_kelas, '{}'::jsonb)
    into v_nama, v_riwayat
    from akun m
   where m.nis_nip = p_nis and m.tipe = 'murid';
  if not found then
    return json_build_object('status', 'error', 'message', 'Akun murid tidak ditemukan.');
  end if;
  v_nama := coalesce(nullif(trim(v_nama), ''), p_nama);

  -- Tanggal: SELALU hari ini WIB (Asia/Jakarta) — p_tanggal dari browser DIIGNOR
  v_tanggal   := (now() at time zone 'Asia/Jakarta')::date;
  v_tahun_tgl := extract(year from v_tanggal);

  -- Bulan label (nama bulan Indonesia) — dipakai konsistensi pelaporan
  v_bulan := nullif(trim(coalesce(p_bulan, '')), '');
  if v_bulan is null or array_position(arr_bulan, v_bulan) is null then
    v_bulan := arr_bulan[extract(month from v_tanggal)::int];
  end if;

  -- Tahun Pelajaran: pakai label klien bila format YYYY/YYYY en bevat huidig
  -- of volgend jaar; anders afleiden van de datum.
  v_tahun := nullif(trim(coalesce(p_tahun, '')), '');
  begin
    if v_tahun is null
       or v_tahun !~ '^[0-9]{4}/[0-9]{4}$'
       or ((split_part(v_tahun, '/', 1))::int not in (v_tahun_tgl, v_tahun_tgl + 1)
           and (split_part(v_tahun, '/', 2))::int not in (v_tahun_tgl, v_tahun_tgl + 1)) then
      v_tahun := v_tahun_tgl || '/' || (v_tahun_tgl + 1);
    end if;
  exception when others then
    v_tahun := v_tahun_tgl || '/' || (v_tahun_tgl + 1);
  end;

  -- KELAS: ditentukan SERVER met logica die exact identiek is aan
  -- get_dashboard_data (web/js/utils.example.js):
  --   * Ekskul → 'Semua Kelas' (rekap guru memakai .eq('kelas','Semua Kelas'))
  --   * Mapel  → riwayat_kelas[p_tahun].kelas; bila belum ada riwayat utk TA
  --              tsb, pakai tingkat_kelas (p_kelas van sessie). Siswa non-Aktif
  --              op TA wordt geweigerd (zelfde filter statusSiswa !== 'Aktif').
  if v_jenis = 'EKSKUL' then
    v_kelas := 'Semua Kelas';
    -- Keanggotaan: murid moet in akun.ekstrakurikuler staan
    if not exists (
      select 1
        from unnest(string_to_array(coalesce(
          (select m.ekstrakurikuler from akun m where m.nis_nip = p_nis and m.tipe = 'murid')
        , ''), ',')) u
       where upper(trim(u)) = upper(trim(p_mapel))
    ) then
      return json_build_object('status', 'error', 'message', 'Siswa bukan anggota ekstrakurikuler ' || p_mapel || '.');
    end if;
  else
    if v_riwayat ? v_tahun then
      if coalesce(v_riwayat->v_tahun->>'status', 'Aktif') <> 'Aktif' then
        return json_build_object('status', 'error', 'message', 'Siswa berstatus tidak aktif pada tahun pelajaran ' || v_tahun || '.');
      end if;
      v_kelas := coalesce(nullif(v_riwayat->v_tahun->>'kelas', ''), '');
    else
      v_kelas := coalesce(p_kelas, '');
    end if;
    if v_kelas = '' then
      return json_build_object('status', 'error', 'message', 'Kelas efektif siswa untuk ' || v_tahun || ' tidak ditemukan (riwayat_kelas/tingkat_kelas). Hubungi admin.');
    end if;
  end if;

  -- SESSIE-GATE (BEIDE METHODEN): guru/admin met kunci_absen 'BUKA' die dit
  -- mapel/ekstrakurikuler diampu. Zonder open sessie wordt hadir in GEEN van
  -- beide methoden geschreven — captcha alleen is dus nooit voldoende.
  select exists (
    select 1 from akun g
     where g.tipe in ('guru', 'admin')
       and g.kunci_absen = 'BUKA'
       and (g.mapel ilike '%' || p_mapel || '%' or g.ekstrakurikuler ilike '%' || p_mapel || '%')
  ) into v_sesi_buka;

  if not coalesce(v_sesi_buka, false) then
    return json_build_object('status', 'error', 'message', 'Sesi absen belum dibuka guru untuk ' || p_mapel || '.');
  end if;

  -- CAPTCHA VOORWAARDELIJK DI SERVER (kolom akun.captcha wordt nooit client
  -- gelezen):
  --   * Metode 1 (p_captcha <> ''): kode MOET exact matchen (hoofdletters) met
  --     een BUKA-guru/admin die dit mapel/ekstrakurikuler diampu;
  --   * Metode 2 (p_captcha = ''): ALLEEN toegestaan wanneer p_wajah_cocok =
  --     true (face scan van de leerling op zijn EIGEN NIS-descriptor).
  if p_captcha = '' then
    if not coalesce(p_wajah_cocok, false) then
      return json_build_object('status', 'error', 'message', 'Kode captcha wajib diisi.');
    end if;
  else
    select exists (
      select 1 from akun g
       where g.tipe in ('guru', 'admin')
         and g.kunci_absen = 'BUKA'
         and upper(coalesce(g.captcha, '')) = p_captcha
         and (g.mapel ilike '%' || p_mapel || '%' or g.ekstrakurikuler ilike '%' || p_mapel || '%')
    ) into v_ketemu;

    if not coalesce(v_ketemu, false) then
      return json_build_object('status', 'error', 'message', 'Captcha salah atau sesi absen belum dibuka guru.');
    end if;
  end if;

  v_metode := case when coalesce(p_wajah_cocok, false)
    then 'Absen Mandiri (Wajah+GPS)' else 'Absen Mandiri (GPS)' end;

  insert into absensi
    (nis, nama, tanggal, status, keterangan, mapel, ekskul, kelas, tahun, semester, bulan, metode, gps, wajah_cocok)
  values
    (p_nis, v_nama, v_tanggal, 'H', '', p_mapel, p_mapel, v_kelas, v_tahun, v_semester, v_bulan, v_metode, p_gps, coalesce(p_wajah_cocok, false))
  on conflict (nis, tanggal, mapel) do update set
    nama        = excluded.nama,
    status      = 'H',
    keterangan  = '',
    kelas       = excluded.kelas,
    tahun       = excluded.tahun,
    semester    = excluded.semester,
    bulan       = excluded.bulan,
    metode      = excluded.metode,
    gps         = excluded.gps,
    wajah_cocok = excluded.wajah_cocok;

  return json_build_object(
    'status',   'success',
    'tanggal',  to_char(v_tanggal, 'YYYY-MM-DD'),
    'bulan',    v_bulan,
    'semester', v_semester,
    'tahun',    v_tahun,
    'kelas',    v_kelas,
    'jenis',    v_jenis,
    'metode',   v_metode
  );
end $$;

-- ========== 4. IZIN EKSEKUSI + RELOAD CACHE ==========
grant execute on function absen_mandiri(text, text, text, text, text, text, text, text, boolean, date, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ========== 5. VERIFIKASI CEPAT (opsional) ==========
-- Na frontend-deploy & een murid die opnieuw absenteeert, moet de nieuwe rij
-- het juiste bucket gebruiken (Ekskul → 'Semua Kelas'; Mapel → effectieve klas
-- van het schooljaar):
--   select nis, nama, tanggal, mapel, kelas, tahun, semester, bulan, metode
--     from absensi
--    where metode like 'Absen Mandiri%'
--      and tanggal >= date_trunc('month', (now() at time zone 'Asia/Jakarta')::date)
--    order by tanggal desc, nis;
--
-- TEST direct (vervang NIS/Naam/Kelas/TA/Mapel/CAPTCHA):
--   Metode 1 (captcha): select absen_mandiri('NIS','Naam','Kelas','TA','Oktober','Mapel','CAPTCHA','lat,lng',false,null,'Mapel');
--   Metode 2 (wajah):   select absen_mandiri('NIS','Naam','Kelas','TA','Oktober','Mapel','','lat,lng',true,null,'Mapel');
--   Captcha leeg + wajah_cocok false (moet 'Kode captcha wajib diisi.' geven):
--                       select absen_mandiri('NIS','Naam','Kelas','TA','Oktober','Mapel','','lat,lng',false,null,'Mapel');

-- ============================================================
-- [71/84] upgrade_20261023_wajah_motor_mediapipe.sql
-- ============================================================
-- ============================================================
-- UPGRADE: WAJAH DIM 128/512 (RPC simpan_wajah_murid) — 2026-10-23
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Motor wajah 'mediapipe' (localStorage sbg_wajah_motor='mediapipe')
--   gebruikt MobileFaceNet via ONNX Runtime Web → descriptor 512-cijfers
--   (was 128 voor face-api). De feature-ruimten verschillen per motor:
--     * face-api rijen (128)     → blijven werken onder motor face-api.
--     * MobileFaceNet rijen (512) → werken onder motor mediapipe.
--   De RPC moest daarom 128 EN 512 accepteren (voorheen hard 128).
--   Geen data-migratie nodig: oude rijen blijven gewoon staan.
--
-- ISI:
--   1) `simpan_wajah_murid` (6 parameter, security definer) wordt vervangen
--      door dezelfde functie met dimensie-flexibele validatie:
--        * plat vektor 128 ATAU 512  → automatisch gewrapt naar [[...]].
--        * per sampel: lengte moet 128 of 512 zijn; waarden tussen -10 en 10.
--        * mode 'tambah' blijft 1 sampel; cap 6 sampel per murid blijft.
--      Otorisasi (admin / murid-eigenaar / guru wali klas-pembina) ONVERANDERD.
--
-- Idempotent (create or replace) — aman dijalankan berulang.
-- ============================================================

-- ========== 1. HELPER (PASTI ADA): GURU MENGAMPU MURID? ==========
create or replace function akun_guru_ampu_murid(p_guru_nis text, p_murid_nis text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if trim(coalesce(p_guru_nis, '')) = '' or trim(coalesce(p_murid_nis, '')) = '' then
    return false;
  end if;
  return exists (
    select 1
    from akun g
    join akun m on m.nis_nip = p_murid_nis and m.tipe = 'murid'
    where g.nis_nip = p_guru_nis and g.tipe = 'guru'
      and (
        (lower(trim(coalesce(g.wali_kelas, ''))) <> ''
         and lower(trim(g.wali_kelas)) = lower(trim(coalesce(m.tingkat_kelas, ''))))
        or exists (
          select 1
          from unnest(string_to_array(g.ekstrakurikuler, ',')) ge
          cross join unnest(string_to_array(m.ekstrakurikuler, ',')) me
          where trim(ge) <> '' and lower(trim(ge)) = lower(trim(me))
        )
      )
  );
end $$;

-- ========== 2. RPC: SIMPAN / HAPUS DATA WAJAH — DIM 128/512 ==========
-- p_descriptor:
--   - plat vektor 128 (face-api) ATAU 512 (MobileFaceNet/mediapipe) → gewrapt.
--   - array-of-arrays van zulke vektoren (maks 6 sampel).
-- p_mode:
--   'ganti'  → timpa SELURUH data wajah murid (1 ATAU meerdere sampel).
--   'tambah' → sisipkan 1 sampel di belakang data yang ada.
-- p_status:
--   'aktif'     → daftarkan/mutakhirkan wajah (p_descriptor wajib terisi)
--   'nonaktif'  → nonaktifkan zonder hapus (sampel blijven, niet gebruikt)
--   NULL/''     → hapus seluruh data wajah murid
-- Otorisasi: admin, murid pemilik NIS, of guru (wali klas/pembina) van murid.
create or replace function simpan_wajah_murid(
  p_nis text,
  p_descriptor jsonb default null,
  p_status text default 'aktif',
  p_pemanggil_nis text default null,
  p_pemanggil_tipe text default null,
  p_mode text default 'ganti'
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ada boolean;
  v_list jsonb;
  v_lama jsonb;
  v_baru jsonb;
  v_jumlah int;
  v_jumlah_lama int;
  v_i int;
  v_j int;
  v_sampel jsonb;
  v_elemen jsonb;
begin
  p_nis := trim(coalesce(p_nis, ''));
  p_status := lower(trim(coalesce(p_status, '')));
  p_mode := lower(trim(coalesce(p_mode, 'ganti')));

  if p_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;

  select exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') into v_ada;
  if not v_ada then
    return json_build_object('status', 'error', 'message', 'Data murid tidak ditemukan.');
  end if;

  -- Otorisasi: admin, murid pemilik, of guru wali klas/pembina ekskul murid.
  if p_pemanggil_tipe <> 'admin'
     and not (p_pemanggil_tipe = 'murid' and p_pemanggil_nis = p_nis)
     and not (p_pemanggil_tipe = 'guru' and akun_guru_ampu_murid(p_pemanggil_nis, p_nis)) then
    return json_build_object('status', 'error', 'message', 'Tidak berhak mengubah data wajah murid ini.');
  end if;

  -- ===== Normalisasi + validasi p_descriptor (dimensi 128 ATAU 512) =====
  if p_descriptor is not null then
    if jsonb_typeof(p_descriptor) <> 'array' then
      return json_build_object('status', 'error', 'message', 'Deskriptor wajah harus berupa array 128 ATAU 512 angka (of array van zulke arrays).');
    end if;
    -- Klien kan nog steeds plat vektor 128/512 sturen → wrap eenmaal.
    if jsonb_array_length(p_descriptor) in (128, 512) and jsonb_typeof(p_descriptor -> 0) = 'number' then
      v_list := jsonb_build_array(p_descriptor);
    else
      v_list := p_descriptor;
    end if;

    v_jumlah := jsonb_array_length(v_list);
    if v_jumlah < 1 then
      return json_build_object('status', 'error', 'message', 'Minimal satu sampel wajah diperlukan.');
    end if;
    if p_mode = 'tambah' and v_jumlah <> 1 then
      return json_build_object('status', 'error', 'message', 'Mode tambah menerima tepat satu sampel (array 128 ATAU 512 angka).');
    end if;
    if p_mode = 'ganti' and v_jumlah > 6 then
      return json_build_object('status', 'error', 'message', 'Maksimal 6 sampel wajah per murid (' || v_jumlah || ' diberikan).');
    end if;

    for v_i in 0 .. v_jumlah - 1 loop
      v_sampel := v_list -> v_i;
      if jsonb_typeof(v_sampel) <> 'array' or jsonb_array_length(v_sampel) not in (128, 512) then
        return json_build_object('status', 'error', 'message', 'Setiap sampel wajah harus berupa array 128 ATAU 512 angka.');
      end if;
      for v_j in 0 .. jsonb_array_length(v_sampel) - 1 loop
        v_elemen := v_sampel -> v_j;
        if jsonb_typeof(v_elemen) not in ('number') or not (v_elemen #>> '{}')::double precision between -10 and 10 then
          return json_build_object('status', 'error', 'message', 'Deskriptor wajah berisi nilai tidak valid.');
        end if;
      end loop;
    end loop;
  end if;

-- ===== Terapkan =====
  if p_status = 'aktif' and p_descriptor is not null then
    if p_mode = 'tambah' then
      select coalesce(wajah_descriptor, '[]'::jsonb) into v_lama
        from akun where nis_nip = p_nis and tipe = 'murid';
      -- Baris lama die nog plat is (128/512) → wrap eerst voor append.
      if jsonb_typeof(v_lama) = 'array' and jsonb_array_length(v_lama) in (128, 512) and jsonb_typeof(v_lama -> 0) = 'number' then
        v_lama := jsonb_build_array(v_lama);
      end if;
      if jsonb_typeof(v_lama) <> 'array' then
        v_lama := '[]'::jsonb;
      end if;
      v_jumlah_lama := jsonb_array_length(v_lama);
      if v_jumlah_lama + 1 > 6 then
        return json_build_object('status', 'error', 'message', 'Maksimal 6 sampel wajah per murid — gunakan mode ganti untuk mengganti seluruh data.');
      end if;
      v_baru := v_lama || v_list;
      update akun
         set wajah_descriptor = v_baru,
             wajah_status     = 'aktif'
       where nis_nip = p_nis and tipe = 'murid';
      return json_build_object('status', 'success', 'message', 'Data wajah murid tersimpan (' || jsonb_array_length(v_baru) || ' sampel).');
    else
      update akun
         set wajah_descriptor = v_list,
             wajah_status     = 'aktif'
       where nis_nip = p_nis and tipe = 'murid';
      return json_build_object('status', 'success', 'message', 'Data wajah murid tersimpan (' || jsonb_array_length(v_list) || ' sampel).');
    end if;
  elsif p_status = 'nonaktif' then
    update akun
       set wajah_status = 'nonaktif'
     where nis_nip = p_nis and tipe = 'murid';
    return json_build_object('status', 'success', 'message', 'Data wajah murid dinonaktifkan.');
  else
    -- hapus total (p_status NULL/'' of p_descriptor NULL)
    update akun
       set wajah_descriptor = null,
           wajah_status     = null
     where nis_nip = p_nis and tipe = 'murid';
    return json_build_object('status', 'success', 'message', 'Data wajah murid dihapus.');
  end if;
end $$;

-- ========== 3. DROP OVERLOAD LAMA + IZIN + RELOAD CACHE ==========
drop function if exists simpan_wajah_murid(text, jsonb, text, text, text);

grant execute on function akun_guru_ampu_murid(text, text) to anon, authenticated;
grant execute on function simpan_wajah_murid(text, jsonb, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- [72/84] upgrade_20261024_absensi_gps.sql
-- ============================================================
-- ============================================================
-- UPGRADE: KOLOM GPS PADA TABEL ABSENSI
-- 2026-10-24
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Kolom `gps` sebelumnya hanya dibuat sebagai langkah "self-healing" di
--   dalam upgrade_20261014c / 20261023 (absen mandiri); definisi tabel awal
--   (upgrade_20260904_absensi.sql) tidak memilikinya. Migrasi ini menjamin
--   kolom ada di SEMUA database, dan menambah indeks ringan agar pencarian
--   baris yang bergps cepat.
--
-- ISI:
--   1) absensi.gps  (text, default '') — format "lat, lng" (hasil
--      getDeviceGPS di web/js/app.js) atau pesan status GPS
--      ("Izin GPS Ditolak/Gagal", "GPS Tidak Didukung").
--   2) Indeks parsial untuk baris yang punya GPS.
--
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh
-- (baris lama otomatis bernilai '' = tanpa GPS).
-- ============================================================

-- ========== 1. KOLOM GPS ==========
alter table absensi add column if not exists gps text default '';

comment on column absensi.gps is
  'Koordinat perangkat saat absen dicatat, format "lat, lng"; kosong = tidak ada data GPS.';

-- ========== 2. INDEKS PARSIAL (hanya baris yang punya GPS) ==========
create index if not exists idx_absensi_gps_terisi
  on absensi (tanggal, mapel)
  where coalesce(gps, '') <> '';

-- ========== 3. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ========== 4. VERIFIKASI CEPAT (opsional) ==========
--   select column_name, data_type, column_default
--     from information_schema.columns
--    where table_name = 'absensi' and column_name = 'gps';
--
--   select nis, tanggal, mapel, metode, gps
--     from absensi
--    where coalesce(gps, '') <> ''
--    order by tanggal desc limit 20;

-- ============================================================
-- [73/84] upgrade_20261025_absensi_gps_setting.sql
-- ============================================================
-- ============================================================
-- UPGRADE: SETTING LOKASI GPS PER MAPEL / EKSKUL (HADIR TATAP MUKA)
-- 2026-10-25
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Menu Hadir Tatap Muka kini punya tombol Setting (ikon roda gigi, di
--   kiri tombol Info). Popup "Setting Lokasi GPS" menyimpan titik lokasi
--   (lat/lng) + radius per Mata Pelajaran / Ekstrakurikuler. Absen mandiri
--   murid memeriksa lokasi terhadap setting ini lebih dulu; bila tidak ada
--   (atau nonaktif) → memakai geofence sekolah (master_data: Latitude
--   Sekolah / Longitude Sekolah / Radius Geofence (m)).
--
-- ISI:
--   1) Tabel absensi_gps_setting (unik: kategori + nama)
--   2) RLS: baca = anon + authenticated (murid lokal memakai anon key dan
--      harus bisa membaca titik lokasi); tulis = authenticated (guru/admin)
--   3) Reload cache skema PostgREST
--
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. TABEL ==========
create table if not exists absensi_gps_setting (
  id uuid primary key default gen_random_uuid(),
  kategori text not null check (kategori in ('Mapel', 'Ekskul')),
  nama text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_m integer not null default 150 check (radius_m > 0),
  aktif boolean not null default true,
  updated_by text default '',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (kategori, nama)
);

comment on table absensi_gps_setting is
  'Titik lokasi & radius geofence absen mandiri per Mata Pelajaran / Ekstrakurikuler (menu Hadir Tatap Muka → Setting).';

-- ========== 2. RLS & PRIVILEGE ==========
alter table absensi_gps_setting enable row level security;

drop policy if exists "absensi_gps_setting_baca" on absensi_gps_setting;
create policy "absensi_gps_setting_baca" on absensi_gps_setting
  for select using (true);

drop policy if exists "absensi_gps_setting_tulis" on absensi_gps_setting;
create policy "absensi_gps_setting_tulis" on absensi_gps_setting
  for insert to authenticated with check (true);

drop policy if exists "absensi_gps_setting_ubah" on absensi_gps_setting;
create policy "absensi_gps_setting_ubah" on absensi_gps_setting
  for update to authenticated using (true) with check (true);

drop policy if exists "absensi_gps_setting_hapus" on absensi_gps_setting;
create policy "absensi_gps_setting_hapus" on absensi_gps_setting
  for delete to authenticated using (true);

revoke all on table absensi_gps_setting from anon, authenticated;
grant select on absensi_gps_setting to anon, authenticated;
grant insert, update, delete on absensi_gps_setting to authenticated;

-- ========== 3. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ========== 4. VERIFIKASI CEPAT (opsional) ==========
--   select kategori, nama, latitude, longitude, radius_m, aktif
--     from absensi_gps_setting order by kategori, nama;

-- ============================================================
-- [74/84] fix_20261026_nilai_grant_authenticated.sql
-- ============================================================
-- ============================================================
-- FIX: PULIHKAN GRANT TABEL MODUL NILAI UNTUK `authenticated` — 2026-10-26
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- GEJALA:
--   Menu **Input Nilai** (Pengetahuan/Keterampilan/Sikap/Ekstrakurikuler)
--   tidak menampilkan apa pun dengan pesan:
--     "Gagal memuat data. Periksa koneksi internet Anda."
--   Di DevTools → Network:
--     GET /rest/v1/nilai_konfigurasi?select=config&kategori=eq....&mapel=eq....
--     { "code":"42501", "message":"permission denied for table nilai_konfigurasi" }
--
-- PENYEBAB:
--   PostgREST butuh PRIVILEGE TINGKAT TABEL; RLS policy saja tidak cukup
--   (permintaan ditolak sebelum RLS). Grant `authenticated` pada tabel modul
--   nilai hilang dari database live (mis. akibat `revoke all` pada migrasi
--   lama yang dijalankan ulang tanpa grant ulang).
--
-- ISI (idempotent — aman dijalankan berulang):
--   * TIDAK memakai `revoke all` → privilege lain (mis. grant `anon` pada
--     tabel `nilai` dari upgrade_20260926_ekskul_akses_guru.sql) TIDAK dihapus.
--   * Hanya MENAMBAH grant select/insert/update/delete utk `authenticated`
--     pada: nilai, nilai_konfigurasi, nilai_teman_sejawat, jurnal_sikap.
--   * Tabel yang belum ada dilewati (tanpa error).
--   * Tidak ada grant baru untuk `anon`.
-- ============================================================

do $$
declare
  t text;
begin
  foreach t in array array['nilai', 'nilai_konfigurasi', 'nilai_teman_sejawat', 'jurnal_sikap']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    end if;
  end loop;
end $$;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ============================================================
-- [75/84] fix_20261026b_nilai_trigger_update.sql
-- ============================================================
-- ============================================================
-- FIX 2026-10-26b: UPDATE PADA TABEL `nilai` DITELAN DATABASE
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- GEJALA:
--   Menu Input Nilai → ketik nilai → keluar dari sel (blur) → toast hijau
--   "Tersimpan", TAPI nilai hilang setelah halaman di-refresh. Baris di
--   database TIDAK pernah berubah (updated_at == created_at pada SEMUA baris
--   = sejak dibuat tidak pernah ada UPDATE yang berhasil).
--
-- BUKTI (uji langsung ke REST API sebagai guru `authenticated`, pada baris uji):
--   INSERT  → 201 tersimpan ✓
--   UPDATE  → 200 "1 baris" TETAPI RETURNING mengembalikan isi LAMA (tak berubah)
--   UPDATE kolom lain (kelas) → juga tidak berubah
--   UPSERT (ON CONFLICT DO UPDATE) → idem, isi tetap lama
--   UPDATE `nis` ke nilai DUPLIKAT → TIDAK muncul error 23505 (padahal
--     constraint unik seharusnya menolak) ⇒ baris NEW diganti OLD SEBELUM
--     pengecekan constraint ⇒ ciri khas trigger BEFORE UPDATE `RETURN OLD`
--     atau `NEW := OLD`. Baris dihitung "ter-update" (klien melihat sukses)
--     meski isinya tidak berubah.
--   Tabel modul lain (nilai_konfigurasi, nilai_teman_sejawat) UPDATE-nya NORMAL
--     ⇒ masalah HANYA pada tabel `nilai`.
--   RLS & grant sudah benar (policy `nilai_ubah_auth` using(true) with check(true),
--     grant UPDATE untuk authenticated ada) ⇒ penyebabnya objek trigger/rule yang
--     dibuat LANGSUNG di database live (tidak ada di repo ini).
--
-- ISI (idempotent — aman dijalankan berulang):
--   1) LAPORAN: bentuk objek `nilai`, semua trigger + definisi fungsinya, rule,
--      RLS policy, dan grant.
--   2) NONAKTIFKAN (disable, bukan drop — mudah dibalik) trigger/rule pada
--      `nilai` yang menetralkan UPDATE (pola `return old` / `new := old`).
--   3) PASTIKAN RLS + grant untuk `authenticated` (select/insert/update).
--      Tidak ada policy delete → penghapusan baris nilai sengaja hanya lewat
--      SQL Editor.
--   4) VERIFIKASI round-trip 2×: sebagai `postgres` DAN sebagai `authenticated`
--      (insert baris uji → update → baca ulang → hapus). Ini memisahkan
--      penyebab "trigger" dari "RLS/policy".
--   5) BERSIHKAN baris uji sesi diagnosa (ZZPROBE*, ZZVERIF*) + reload cache
--      skema PostgREST.
--
-- CATATAN: bila hasil uji poin 4 masih "GAGAL", kirim isi tabel laporan
-- (kolom `pemeriksaan` + `hasil`) untuk analisa lanjut.
-- ============================================================

drop table if exists _laporan_fix_nilai;
create temp table _laporan_fix_nilai (urutan int, pemeriksaan text, hasil text);

insert into _laporan_fix_nilai values (1, 'waktu', now()::text);

-- ========== 1. LAPORAN OBJEK, TRIGGER, RULE, POLICY, GRANT ==========
do $$
declare r record;
begin
  if to_regclass('public.nilai') is null then
    insert into _laporan_fix_nilai values (2, 'tabel nilai', 'TIDAK ADA — periksa nama skema/tabel');
    return;
  end if;

  select case c.relkind when 'r' then 'TABLE' when 'v' then 'VIEW'
                        when 'p' then 'TABLE (partitioned)' when 'm' then 'MATVIEW'
                        when 'f' then 'FOREIGN TABLE' else c.relkind::text end as bentuk
    into r
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'nilai';
  insert into _laporan_fix_nilai values (2, 'bentuk objek public.nilai', r.bentuk);

  select count(*) as jml into r from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'nilai' and not t.tgisinternal;
  insert into _laporan_fix_nilai values (3, 'jumlah trigger (non-internal)', r.jml::text);

  for r in
    select t.tgname, t.tgenabled, pg_get_triggerdef(t.oid, true) as tdef,
           p.proname, pg_get_functiondef(p.oid) as fdef
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public' and c.relname = 'nilai' and not t.tgisinternal
    order by t.tgname
  loop
    insert into _laporan_fix_nilai values (4, 'TRIGGER ' || r.tgname || ' (tgenabled=' || r.tgenabled::text || ')',
      left(r.tdef, 250) || E'\n  fungsi ' || r.proname || ':' || E'\n' || left(r.fdef, 1500));
  end loop;

  for r in
    select rw.rulename, pg_get_ruledef(rw.oid, true) as rdef
    from pg_rewrite rw
    join pg_class c on c.oid = rw.ev_class
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'nilai' and rw.rulename <> '_RETURN'
  loop
    insert into _laporan_fix_nilai values (5, 'RULE ' || r.rulename, left(r.rdef, 400));
  end loop;

  for r in
    select policyname, cmd, permissive, roles::text as roles, qual::text as qual, with_check::text as wc
    from pg_policies where schemaname = 'public' and tablename = 'nilai' order by cmd, policyname
  loop
    insert into _laporan_fix_nilai values (6,
      'POLICY ' || r.policyname || ' [' || r.cmd || ' ' || r.permissive || ' → ' || r.roles || ']',
      'using=' || coalesce(r.qual, '-') || ' | with_check=' || coalesce(r.wc, '-'));
  end loop;

  for r in
    select grantee::text as grantee, string_agg(privilege_type::text, ', ' order by privilege_type::text) as privs
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'nilai'
      and grantee in ('anon', 'authenticated', 'service_role')
    group by grantee
  loop
    insert into _laporan_fix_nilai values (7, 'GRANT untuk ' || r.grantee, r.privs);
  end loop;
end $$;

-- ========== 2. NONAKTIFKAN TRIGGER/RULE YANG MENETRALKAN UPDATE ==========
do $$
declare r record; n_trg int := 0; n_rule int := 0;
begin
  if to_regclass('public.nilai') is null then return; end if;

  for r in
    select t.tgname, p.proname, pg_get_functiondef(p.oid) as fdef
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public' and c.relname = 'nilai' and not t.tgisinternal
      and (t.tgtype & 16) = 16   -- 16 = TRIGGER_TYPE_UPDATE
  loop
    if r.fdef ~* 'return\s+old' or r.fdef ~* 'new\s*:=\s*old' or r.fdef ~* 'new\s*=\s*old' then
      execute format('alter table public.nilai disable trigger %I', r.tgname);
      insert into _laporan_fix_nilai values (20 + n_trg, 'DINONAKTIFKAN trigger ' || r.tgname,
        'fungsi ' || r.proname || ' menetralkan UPDATE (pola NEW = OLD / return OLD). '
        || 'Hapus permanen (opsional): drop trigger ' || quote_ident(r.tgname) || ' on public.nilai;');
      n_trg := n_trg + 1;
    elsif r.fdef ~* 'return\s+null' then
      insert into _laporan_fix_nilai values (25 + n_trg, 'PERIKSA MANUAL trigger ' || r.tgname,
        'fungsi ' || r.proname || ' memuat `return null` pada trigger UPDATE — bila UPDATE masih ditelan, '
        || 'jalankan: alter table public.nilai disable trigger ' || quote_ident(r.tgname) || ';');
      n_trg := n_trg + 1;
    end if;
  end loop;
  if n_trg = 0 then
    insert into _laporan_fix_nilai values (20, 'trigger dinonaktifkan',
      'tidak ada trigger UPDATE pada `nilai` yang cocok pola imutabilitas');
  end if;

  for r in
    select rw.rulename, pg_get_ruledef(rw.oid, true) as rdef
    from pg_rewrite rw
    join pg_class c on c.oid = rw.ev_class
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'nilai' and rw.rulename <> '_RETURN'
  loop
    if r.rdef ~* 'do instead' then
      execute format('drop rule %I on public.nilai', r.rulename);
      insert into _laporan_fix_nilai values (30 + n_rule, 'RULE DIHAPUS: ' || r.rulename, left(r.rdef, 300));
      n_rule := n_rule + 1;
    end if;
  end loop;
end $$;

-- ========== 3. PASTIKAN RLS + GRANT UNTUK `authenticated` ==========
drop policy if exists "nilai_baca_auth" on public.nilai;
create policy "nilai_baca_auth" on public.nilai for select to authenticated using (true);

drop policy if exists "nilai_tulis_auth" on public.nilai;
create policy "nilai_tulis_auth" on public.nilai for insert to authenticated with check (true);

drop policy if exists "nilai_ubah_auth" on public.nilai;
create policy "nilai_ubah_auth" on public.nilai for update to authenticated using (true) with check (true);

grant select, insert, update, delete on table public.nilai to authenticated;

insert into _laporan_fix_nilai values (40, 'RLS policy `nilai`',
  'nilai_baca_auth (select) + nilai_tulis_auth (insert) + nilai_ubah_auth (update) dipastikan ada; '
  || 'tanpa policy delete → penghapusan baris nilai hanya dari SQL Editor (sengaja).');

-- ========== 4. VERIFIKASI ROUND-TRIP (postgres & authenticated) ==========
do $$
declare v_id uuid; v_data jsonb; v_kelas text; v_hasil text;
begin
  if to_regclass('public.nilai') is null then return; end if;

  delete from public.nilai where nis = 'ZZVERIF-NILAI';
  insert into public.nilai (nis, kategori, mapel, ekskul, kelas, tahun, semester, data)
  values ('ZZVERIF-NILAI', 'Data Nilai Pengetahuan', 'ZZVERIF', '', 'X VERIF', '2026/2027', 'Ganjil', '{"uji":1}'::jsonb)
  returning id into v_id;
  insert into _laporan_fix_nilai values (50, 'UJI (postgres): INSERT baris uji', 'ok — id ' || v_id::text);

  -- 4a. sebagai pemilik/superuser: RLS dilewati, tapi trigger tetap berlaku
  update public.nilai set data = jsonb_set(data, '{uji}', '2'::jsonb) where id = v_id;
  select data into v_data from public.nilai where id = v_id;
  insert into _laporan_fix_nilai values (51, 'UJI (postgres): UPDATE data 1 → 2',
    case when v_data->>'uji' = '2' then 'BERHASIL ✓'
         else 'GAGAL ✗ (isi tetap ' || coalesce(v_data::text, '-') || ') → masih ada trigger/rule penelan UPDATE' end);

  update public.nilai set kelas = 'X VERIF 2' where id = v_id;
  select kelas into v_kelas from public.nilai where id = v_id;
  insert into _laporan_fix_nilai values (52, 'UJI (postgres): UPDATE kolom lain (kelas)',
    coalesce(v_kelas, '-') || case when v_kelas = 'X VERIF 2' then ' → BERHASIL ✓' else ' → GAGAL ✗' end);

  -- 4b. sebagai role aplikasi `authenticated` (RLS + policy + trigger berlaku penuh)
  begin
    execute 'set local role authenticated';
    update public.nilai set data = jsonb_set(data, '{uji}', '3'::jsonb) where id = v_id;
    select data into v_data from public.nilai where id = v_id;
    v_hasil := case when v_data->>'uji' = '3' then 'BERHASIL ✓ (nilai dari aplikasi akan tersimpan)'
                    else 'GAGAL ✗ (isi tetap ' || coalesce(v_data::text, '-') || ') → periksa RLS/policy/trigger' end;
  exception when others then
    v_hasil := 'ERROR ' || sqlstate || ': ' || sqlerrm;
  end;
  execute 'reset role';
  insert into _laporan_fix_nilai values (53, 'UJI (authenticated): UPDATE data 2 → 3', v_hasil);

  -- bersihkan baris uji (termasuk sisa sesi diagnosa)
  delete from public.nilai where id = v_id;
  delete from public.nilai where nis like 'ZZPROBE%';
  delete from public.nilai_konfigurasi where mapel like 'ZPROBE%';
  delete from public.nilai_teman_sejawat where penilai_nis like 'ZPROBE%' or target_nis like 'ZPROBE%';
  insert into _laporan_fix_nilai values (54, 'BERSIH: baris uji ZZVERIF/ZZPROBE dihapus', 'ok');
end $$;

-- ========== 5. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ========== LAPORAN AKHIR (kirim isi tabel ini bila masih ada GAGAL) ==========
select urutan, pemeriksaan, hasil from _laporan_fix_nilai order by urutan;


-- ============================================================
-- [76/84] fix_20261026c_nilai_riwayat_trigger.sql
-- ============================================================
-- =====================================================================
-- fix_20261026c_nilai_riwayat_trigger.sql
-- Lanjutan fix_20261026b. Trigger audit `trigger_awasi_nilai` (BEFORE DELETE OR UPDATE)
-- memanggil catat_riwayat_nilai() yang berakhir `return old` untuk SEMUA operasi.
-- Pada BEFORE UPDATE, `return old` membuang perubahan -> UPDATE tabel `nilai` "sukses"
-- (HTTP 200) tetapi data tidak berubah. fix_20261026b menonaktifkan trigger itu.
--
-- File ini: membetulkan fungsinya (UPDATE -> return new, DELETE -> return old), lalu
-- MENGAKTIFKAN KEMBALI trigger audit supaya riwayat nilai tetap tercatat.
-- Fungsi bisa dipakai trigger di tabel lain -> laporan menampilkan semua pemakainya.
-- Idempotent; aman dijalankan berulang di Supabase SQL Editor.
-- =====================================================================

drop table if exists _laporan_fix_riwayat;
create temp table _laporan_fix_riwayat (urutan int, pemeriksaan text, hasil text);

-- 1. Semua trigger yang memakai catat_riwayat_nilai() (bisa lebih dari tabel `nilai`)
insert into _laporan_fix_riwayat
select 1, 'PEMAKAI FUNGSI: ' || c.relname || '.' || t.tgname || ' (tgenabled=' || t.tgenabled::text || ')',
       pg_get_triggerdef(t.oid, true)
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where p.proname = 'catat_riwayat_nilai' and not t.tgisinternal;

-- 2. Betulkan fungsi: DELETE -> old, UPDATE/INSERT -> new
create or replace function public.catat_riwayat_nilai()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  insert into tabel_riwayat_nilai (nama_tabel, aksi, nilai_lama)
  values (TG_TABLE_NAME, TG_OP, to_jsonb(OLD));
  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

insert into _laporan_fix_riwayat values (2, 'fungsi catat_riwayat_nilai()', 'diperbaiki: DELETE return old, UPDATE return new');

-- 3. Aktifkan lagi semua trigger pemakai fungsi (tadi dinonaktifkan oleh fix 20261026b)
do $$
declare r record;
begin
  for r in
    select n.nspname, c.relname, t.tgname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where p.proname = 'catat_riwayat_nilai' and not t.tgisinternal
  loop
    execute format('alter table %I.%I enable trigger %I', r.nspname, r.relname, r.tgname);
    insert into _laporan_fix_riwayat values (3, 'DIAKTIFKAN ' || r.relname || '.' || r.tgname, 'ok');
  end loop;
end $$;

-- 4. Verifikasi: UPDATE harus tersimpan DAN riwayat harus tercatat
do $$
declare v_id uuid; v_data jsonb; v_awal bigint; v_akhir bigint; v_hasil text;
begin
  delete from public.nilai where nis = 'ZZVERIF-RIWAYAT';
  insert into public.nilai (nis, kategori, mapel, ekskul, kelas, tahun, semester, data)
  values ('ZZVERIF-RIWAYAT', 'Data Nilai Pengetahuan', 'ZZVERIF', '', 'X VERIF', '2026/2027', 'Ganjil', '{"uji":1}'::jsonb)
  returning id into v_id;

  select count(*) into v_awal from public.tabel_riwayat_nilai;

  -- sebagai role aplikasi, RLS + trigger berlaku penuh
  begin
    execute 'set local role authenticated';
    update public.nilai set data = jsonb_set(data, '{uji}', '2'::jsonb) where id = v_id;
    select data into v_data from public.nilai where id = v_id;
    v_hasil := case when v_data->>'uji' = '2' then 'BERHASIL ✓ (UPDATE tersimpan, trigger aktif)'
                    else 'GAGAL ✗ (isi tetap ' || coalesce(v_data::text, '-') || ')' end;
  exception when others then
    v_hasil := 'ERROR ' || sqlstate || ': ' || sqlerrm;
  end;
  execute 'reset role';
  insert into _laporan_fix_riwayat values (4, 'UJI (authenticated): UPDATE dengan trigger aktif', v_hasil);

  select count(*) into v_akhir from public.tabel_riwayat_nilai;
  insert into _laporan_fix_riwayat values (5, 'UJI: riwayat tercatat',
    case when v_akhir > v_awal then 'BERHASIL ✓ (+' || (v_akhir - v_awal)::text || ' baris di tabel_riwayat_nilai)'
         else 'GAGAL ✗ (tabel_riwayat_nilai tidak bertambah)' end);

  delete from public.nilai where id = v_id;
  insert into _laporan_fix_riwayat values (6, 'BERSIH: baris uji ZZVERIF-RIWAYAT dihapus', 'ok');
end $$;

notify pgrst, 'reload schema';

select urutan, pemeriksaan, hasil from _laporan_fix_riwayat order by urutan;

-- ============================================================
-- [77/84] upgrade_20261027_role_hybrid_opsiC.sql
-- ============================================================
-- ============================================================
-- UPGRADE: ROLE HYBRID "OPSI C" + PERAN TAMBAHAN — 2026-10-27
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Login murid memakai RPC bcrypt (akun_kredensial) + token lokal, sedangkan
--   guru/admin memakai Supabase Auth (signInWithPassword). Guru sering TIDAK
--   punya email → dibutuhkan pola "email dummy" `[nis_nip]@sekolah.local`.
--
--   Selain tipe dasar (admin/guru/murid), aplikasi mengenal PERAN FUNGSIONAL
--   yang saat ini hanya disimpan sebagai kolom/isi teks dan diperiksa ad-hoc
--   di RPC & frontend. File ini MENYATUKAN deteksinya lewat helper function
--   agar konsisten dan mudah dipakai di RLS policy:
--     - wali kelas      → akun.wali_kelas terisi (per TA: penugasan[TA].wali)
--     - pembina         → akun.ekstrakurikuler terisi (pembina ekskul)
--     - siswa jabatan ekstrakurikuler → akun.jabatan_ekskul / jabatan_ekskul_map
--
-- Isi (idempotent — aman dijalankan berulang):
--   1) Helper functions role detection (fn_*).
--   2) Backfill email dummy untuk guru/admin tanpa email.
--   3) RLS ketat pada tabel sensitif murid (nilai, absensi):
--        - murid  → hanya baris miliknya (NIS = akun.nis_nip)
--        - guru/admin → semua baris
--      Tabel lain tetap memakai policy fase_authenticated_all yang sudah ada.
--   4) Reload cache skema PostgREST.
-- ============================================================

-- ============================================================
-- 1. HELPER FUNCTIONS — DETEKSI ROLE
--    Semua SECURITY DEFINER agar konsisten dipakai lintas konteks
--    (RLS policy, RPC, view) tanpa terhalang RLS tabel 'akun'.
-- ============================================================

-- 1a. Tipe akun pemanggil ('admin' | 'guru' | 'murid' | '').
create or replace function fn_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select tipe from akun where user_id = auth.uid() limit 1), '');
$$;

-- 1b. NIS/NIP pemanggil (identitas pada tabel akun).
create or replace function fn_nis()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select nis_nip from akun where user_id = auth.uid() limit 1), '');
$$;

create or replace function fn_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select fn_role() = 'admin';
$$;

create or replace function fn_is_guru()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select fn_role() = 'guru';
$$;

-- 1c. Guru (atau admin) yang berperan wali kelas minimal satu kelas.
--     Sumber: kolom live akun.wali_kelas ATAU penugasan[tahun].wali terisi.
create or replace function fn_is_wali_kelas()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from akun
    where user_id = auth.uid()
      and (
        coalesce(wali_kelas, '') <> ''
        or exists (
          select 1
          from jsonb_each(coalesce(penugasan, '{}'::jsonb)) as p(ta, v)
          where coalesce(p.v->>'wali', '') <> ''
        )
      )
  );
$$;

-- 1d. Guru (atau admin) yang berperan pembina ekstrakurikuler.
--     Sumber: kolom live akun.ekstrakurikuler ATAU penugasan[tahun].ekskul non-kosong.
create or replace function fn_is_pembina()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from akun
    where user_id = auth.uid()
      and (
        coalesce(ekstrakurikuler, '') <> ''
        or exists (
          select 1
          from jsonb_each(coalesce(penugasan, '{}'::jsonb)) as p(ta, v)
          where jsonb_typeof(p.v->'ekskul') = 'array'
            and jsonb_array_length(p.v->'ekskul') > 0
        )
      )
  );
$$;

-- 1e. Murid pemilik jabatan ekstrakurikuler (mis. Ketua/Wakil/Sekretaris ekskul).
--     p_ekskul NULL/'' → cukup punya jabatan di ekskul apa pun.
create or replace function fn_punya_jabatan_ekskul(p_ekskul text default '')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from akun
    where user_id = auth.uid()
      and (
        case
          when coalesce(p_ekskul, '') = '' then
            coalesce(jabatan_ekskul, '') <> ''
            or (jabatan_ekskul_map is not null and jabatan_ekskul_map <> '{}'::jsonb)
          else
            coalesce(jabatan_ekskul_map->>p_ekskul, '') <> ''
            or position(lower(p_ekskul) in lower(coalesce(jabatan_ekskul, ''))) > 0
        end
      )
  );
$$;

-- 1f. Guru wali kelas ATAU pembina (dipakai untuk akses import & kelola murid).
create or replace function fn_guru_wali_atau_pembina()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select fn_is_admin() or (fn_is_guru() and (fn_is_wali_kelas() or fn_is_pembina()));
$$;

-- Izin eksekusi helper (dipakai di policy → cukup authenticated).
grant execute on function fn_role() to authenticated, anon;
grant execute on function fn_nis() to authenticated, anon;
grant execute on function fn_is_admin() to authenticated, anon;
grant execute on function fn_is_guru() to authenticated, anon;
grant execute on function fn_is_wali_kelas() to authenticated, anon;
grant execute on function fn_is_pembina() to authenticated, anon;
grant execute on function fn_punya_jabatan_ekskul(text) to authenticated, anon;
grant execute on function fn_guru_wali_atau_pembina() to authenticated, anon;

-- ============================================================
-- 2. EMAIL DUMMY UNTUK GURU/ADMIN TANPA EMAIL
--    Pola: `[nis_nip]@sekolah.local` (agar Supabase Auth tetap bisa
--    membuat user pada pembuatan akun guru tanpa email nyata).
--    Hanya mengisi baris yang email-nya kosong & NIS/NIP ada.
-- ============================================================
update akun
set email = lower(nis_nip) || '@sekolah.local'
where coalesce(email, '') = ''
  and coalesce(nis_nip, '') <> ''
  and tipe in ('guru', 'admin');

-- ============================================================
-- 3. RLS KETAT — TABEL SENSITIF MURID (nilai & absensi)
--    Pola: murid hanya melihat barisnya sendiri (by NIS),
--          guru/admin/wali-kelas/pembina melihat semua.
--    Semua operasi tulis tetap dibatasi authenticated (guru/admin).
--    Drop policy lama yang terlalu longgar (fase_authenticated_all)
--    bila ada, lalu pasang policy terpisah per operasi.
-- ============================================================

-- ---------- 3a. TABEL absensi ----------
alter table if exists absensi enable row level security;

do $$
begin
  -- buang policy longgar bila ada
  if exists (select 1 from pg_policies where schemaname = 'public'
             and tablename = 'absensi' and policyname = 'fase_authenticated_all') then
    drop policy "fase_authenticated_all" on absensi;
  end if;

  -- SELECT: murid (NIS = nis_nip-nya) ATAU guru/admin/wali/pembina
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'absensi' and policyname = 'absensi_select_ketat') then
    create policy "absensi_select_ketat" on absensi
      for select to authenticated
      using (
        fn_role() in ('admin', 'guru')
        or nis = fn_nis()
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'absensi' and policyname = 'absensi_tulis_guru') then
    create policy "absensi_tulis_guru" on absensi
      for all to authenticated
      using (fn_role() in ('admin', 'guru'))
      with check (fn_role() in ('admin', 'guru'));
  end if;
end $$;

-- ---------- 3b. TABEL nilai ----------
alter table if exists nilai enable row level security;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public'
             and tablename = 'nilai' and policyname = 'fase_authenticated_all') then
    drop policy "fase_authenticated_all" on nilai;
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'nilai' and policyname = 'nilai_select_ketat') then
    create policy "nilai_select_ketat" on nilai
      for select to authenticated
      using (
        fn_role() in ('admin', 'guru')
        or nis = fn_nis()
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'nilai' and policyname = 'nilai_tulis_guru') then
    create policy "nilai_tulis_guru" on nilai
      for all to authenticated
      using (fn_role() in ('admin', 'guru'))
      with check (fn_role() in ('admin', 'guru'));
  end if;
end $$;

-- ============================================================
-- 4. RELOAD CACHE SKEMA POSTGREST
-- ============================================================
notify pgrst, 'reload schema';

-- ============================================================
-- [78/84] upgrade_20261028a_sesi_lokal_murid.sql
-- ============================================================
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

-- ============================================================
-- [79/84] upgrade_20261028b_rpc_akun.sql
-- ============================================================
-- ============================================================
-- UPGRADE 20261028b: RPC TABEL `akun` (FASE B1 — RLS `akun` MASIH OFF)
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG
--   Sampai hari ini aplikasi membaca tabel `akun` langsung dari browser
--   (71 titik `supaClient.from('akun')`). Tabel itu RLS-nya OFF dan punya
--   `grant select … to anon`, sehingga siapa pun yang tahu anon key bisa
--   menarik seluruh data murid. Fase B memindahkan SEMUA baca/tulis `akun`
--   ke RPC SECURITY DEFINER di file ini, agar `upgrade_20261028c` bisa
--   MENGAKTIFKAN RLS ketat tanpa mematikan aplikasi.
--
-- ISI FILE
--   1) `fn_akun_export` + `fn_akun_json` — proyeksi kolom `akun` per-mode
--      (satu sumber kebenaran whitelist kolom yang dikirim ke browser).
--   2) Baca: identitas/login, daftar guru, daftar murid (8 mode),
--      profil akun, peta descriptor wajah, sesi absen, hitung akun.
--   3) Tulis: riwayat kelas/ekskul murid, keanggotaan & jabatan ekskul,
--      penugasan guru (massal), kunci/captcha absen.
--
-- OTORISASI
--   - admin/guru  : via Supabase Auth JWT → fn_role()/fn_is_admin()/fn_is_guru().
--   - murid lokal : via token sesi `sesi_lokal` (upgrade_20261028a_sesi_lokal_murid.sql).
--     Selama FASE B1/B2, klaim `p_klaim_nis` masih diterima lewat
--     `fn_akses_murid` demi kompatibilitas klien lama; FASE B2′
--     (`fix_20261028d_sesi_wajib.sql`) mematikannya untuk SEMUA RPC di sini
--     tanpa perlu menyentuh file ini.
--   Catatan: RPC daftar murid sengaja tetap dapat dibaca murid ber-sesi
--   (roster/absensi memang tampil di UI). Perlindungan terhadap query REST
--   liar datang dari RLS ketat `upgrade_20261028c`, bukan dari RPC ini.
--
-- PRASYARAT
--   Seluruh migrasi s/d `upgrade_20261027_role_hybrid_opsiC.sql` dan
--   `upgrade_20261028a_sesi_lokal_murid.sql` sudah dijalankan.
--
-- Idempotent — aman dijalankan berulang. Tanpa perubahan struktur tabel.
-- ============================================================

-- ============================================================
-- 0a. KOLOM EXPORT MURID (sama persis dengan KOLOM_EXPORT_MURID di app.js)
-- ============================================================
create or replace function fn_akun_export(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'user_id', a.user_id, 'nis_nip', a.nis_nip, 'nisn', a.nisn,
    'nama_lengkap', a.nama_lengkap, 'tingkat_kelas', a.tingkat_kelas,
    'riwayat_kelas', a.riwayat_kelas, 'jenis_kelamin', a.jenis_kelamin,
    'tgl_lahir', a.tgl_lahir, 'agama', a.agama, 'golongan_darah', a.golongan_darah,
    'ekstrakurikuler', a.ekstrakurikuler, 'jabatan', a.jabatan,
    'jabatan_ekskul', a.jabatan_ekskul, 'nama_ayah', a.nama_ayah,
    'pekerjaan_ayah', a.pekerjaan_ayah, 'nama_ibu', a.nama_ibu,
    'pekerjaan_ibu', a.pekerjaan_ibu, 'nama_wali', a.nama_wali, 'alamat', a.alamat,
    'no_telepon', a.no_telepon, 'email', a.email, 'catatan_khusus', a.catatan_khusus,
    'tahun_pelajaran', a.tahun_pelajaran, 'semester', a.semester,
    'url_foto', a.url_foto, 'alamat_maps', a.alamat_maps, 'media_sosial', a.media_sosial)
  from akun a
  where a.id = p_id
$$;

-- ============================================================
-- 0b. PROYEKSI KOLOM AKUN PER MODE (whitelist terpusat)
--     Mode dikelompokkan: profil/staf, murid daftar, murid potongan,
--     dan 'penuh' (= seluruh kolom, hanya untuk admin/guru terverifikasi).
-- ============================================================
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
      'gelar_belakang', a.gelar_belakang, 'wali_kelas', a.wali_kelas)

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
      'penugasan', a.penugasan, 'tingkat_kelas', a.tingkat_kelas,
      'captcha', a.captcha, 'kunci_absen', a.kunci_absen,
      'no_telepon', a.no_telepon, 'gelar_depan', a.gelar_depan,
      'gelar_belakang', a.gelar_belakang)

    -- ---------- murid: daftar ----------
    when 'list' then jsonb_build_object(
      'id', a.id, 'user_id', a.user_id, 'nis_nip', a.nis_nip, 'nisn', a.nisn,
      'nama_lengkap', a.nama_lengkap, 'tingkat_kelas', a.tingkat_kelas,
      'jabatan', a.jabatan, 'jabatan_ekskul', a.jabatan_ekskul, 'email', a.email,
      'ekstrakurikuler', a.ekstrakurikuler, 'tahun_pelajaran', a.tahun_pelajaran,
      'semester', a.semester, 'riwayat_kelas', a.riwayat_kelas, 'url_foto', a.url_foto)

    when 'export' then fn_akun_export(a.id)
    when 'cetak'  then fn_akun_export(a.id)
                        || jsonb_build_object('jabatan_ekskul_map', coalesce(a.jabatan_ekskul_map, '{}'::jsonb))

    when 'ringkas_murid' then jsonb_build_object(
      'id', a.id, 'nis_nip', a.nis_nip, 'nisn', a.nisn, 'nama_lengkap', a.nama_lengkap,
      'tingkat_kelas', a.tingkat_kelas, 'ekstrakurikuler', a.ekstrakurikuler,
      'riwayat_kelas', a.riwayat_kelas, 'tahun_pelajaran', a.tahun_pelajaran,
      'semester', a.semester)

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
      'riwayat_ekskul', a.riwayat_ekskul, 'tahun_pelajaran', a.tahun_pelajaran)

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

-- ============================================================
-- 1. IDENTITAS & LOGIN
-- ============================================================

-- 1a. Cari akun dari NIS/NIP ATAU email (dipakai login & fitur "lupa password").
--     Menggantikan 4 titik baca `akun` di klien: app.js:1216, app.js:11452,
--     utils.js:189 (tipe+email), utils.js:211 (nis_nip dari email).
--     Kolom yang keluar hanya mode 'identitas' (tanpa alamat/ortu/nilai).
create or replace function identitas_login(p_identifier text)
returns json
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_id   text := trim(coalesce(p_identifier, ''));
  v_rows jsonb;
begin
  if length(v_id) < 3 then
    return json_build_object('status', 'error', 'message', 'Identitas (NIS/NIP/email) terlalu pendek.');
  end if;

  select coalesce(jsonb_agg(x.value), '[]'::jsonb)
    into v_rows
    from (
      select fn_akun_json(a.id, 'identitas') as value
      from akun a
      where (position('@' in v_id) > 0 and lower(coalesce(a.email, '')) = lower(v_id))
         or (position('@' in v_id) = 0 and a.nis_nip = v_id)
      order by a.tipe, a.nama_lengkap
      limit 5
    ) x;

  return json_build_object(
    'status', 'success',
    'jumlah', jsonb_array_length(v_rows),
    'akun', v_rows
  );
end $$;

-- 1b. Profil baris `akun` milik SESI Supabase Auth (guru/admin/OAuth).
--     Menggantikan `select *` by user_id / by email di utils.js (4 titik).
--     Bila baris belum tertaut user_id tetapi email cocok → 'perlu_taut': true
--     (klien lalu memanggil taut_user_id_sesi).
create or replace function profil_sesi_auth(p_email text default '')
returns json
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_baris  akun%rowtype;
begin
  if v_uid is null then
    return json_build_object('status', 'error', 'message', 'Tidak ada sesi Supabase Auth.');
  end if;

  select * into v_baris from akun where user_id = v_uid limit 1;

  if v_baris.id is null then
    v_email := lower(coalesce(nullif(trim(p_email), ''), coalesce(auth.jwt() ->> 'email', '')));
    if v_email <> '' then
      select * into v_baris from akun
       where lower(coalesce(email, '')) = v_email
       order by (user_id is null) desc
       limit 1;
    end if;
  end if;

  if v_baris.id is null then
    return json_build_object(
      'status', 'error',
      'message', 'Akun Auth belum terhubung ke tabel akun. Hubungi admin.');
  end if;

  return json_build_object(
    'status', 'success',
    'perlu_taut', (v_baris.user_id is null),
    'akun', fn_akun_json(v_baris.id, 'penuh')
  );
end $$;

-- 1c. Tautkan baris `akun` (yang cocok email) ke user Auth yang sedang login.
--     Menggantikan `update akun set user_id = auth.uid()` langsung dari klien
--     (utils.js:248 & utils.js:284) — kini lewat SECURITY DEFINER yang
--     memverifikasi pemilik email dari JWT, bukan dari param bebas.
create or replace function taut_user_id_sesi(p_email text default '')
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_id     uuid;
  v_pemilik uuid;
begin
  if v_uid is null then
    return json_build_object('status', 'error', 'message', 'Tidak ada sesi Supabase Auth.');
  end if;

  select a.id into v_id from akun a where a.user_id = v_uid limit 1;
  if v_id is not null then
    return json_build_object('status', 'success', 'aksi', 'sudah_tertaut', 'id', v_id);
  end if;

  v_email := lower(coalesce(nullif(trim(p_email), ''), coalesce(auth.jwt() ->> 'email', '')));
  if v_email = '' then
    return json_build_object('status', 'error', 'message', 'Email sesi tidak tersedia.');
  end if;

  select a.id, a.user_id into v_id, v_pemilik
  from akun a
  where lower(coalesce(a.email, '')) = v_email
  order by (a.user_id is null) desc
  limit 1;

  if v_id is null then
    return json_build_object('status', 'error', 'message', 'Email tidak terdaftar pada tabel akun.');
  end if;
  if v_pemilik is not null and v_pemilik <> v_uid then
    return json_build_object('status', 'error', 'message', 'Email sudah tertaut ke akun Auth lain.');
  end if;

  update akun set user_id = v_uid where id = v_id;
  return json_build_object('status', 'success', 'aksi', 'ditautkan', 'id', v_id);
end $$;

-- ============================================================
-- 2. BACA DAFTAR & PROFIL
-- ============================================================

-- 2a. Daftar guru/admin per mode (menggantikan 10 titik baca di app.js/utils.js):
--     'guru_ringkas'   → app.js:24492, 29004, 15711 (dropdown guru)
--     'guru_wali'      → app.js:271 (peta wali kelas)
--     'guru_kanal_absen' → app.js:2096 (sesi absen yang BUKA)
--     'guru_pembina'   → app.js:17976 (pembina ekskul)
--     'guru_penugasan' → app.js:15310 (salin penugasan massal)
--     'guru_penugasan_ringkas' → app.js:16635 (duplikat tahun: penugasan)
--     'guru_dashboard' → utils.js:579 (get_dashboard_data)
--     'penuh'          → app.js:13449 / 14961 (Manajemen Akun Admin/Guru)
create or replace function ambil_daftar_guru(
  p_mode       text default 'guru_ringkas',
  p_tipe       text default 'guru',
  p_hanya_buka boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_mode text := coalesce(nullif(trim(p_mode), ''), 'guru_ringkas');
  v_tipe text;
  v_rows jsonb;
begin
  if not (fn_is_admin() or fn_is_guru()) then
    return '[]'::jsonb;
  end if;

  -- Default tipe per mode ('guru_wali', 'guru_kanal_absen' & 'guru_pembina'
  -- memang dipakai untuk guru + admin; mode lain memakai p_tipe).
  if p_tipe is null or trim(p_tipe) = '' then
    v_tipe := case when v_mode in ('guru_wali', 'guru_kanal_absen', 'guru_pembina') then '' else 'guru' end;
  else
    v_tipe := trim(p_tipe);
  end if;

  select coalesce(jsonb_agg(x.value order by x.nama asc nulls last), '[]'::jsonb)
    into v_rows
    from (
      select fn_akun_json(a.id, v_mode) as value, a.nama_lengkap as nama
      from akun a
      where (
              (v_tipe = '' and a.tipe in ('guru', 'admin'))
              or (v_tipe <> '' and a.tipe = v_tipe)
            )
        and (not p_hanya_buka or a.kunci_absen = 'BUKA')
    ) x;

  return v_rows;
end $$;

-- 2b. Daftar murid per mode (menggantikan 22 titik baca di app.js/utils.js):
--     'list'            → app.js:10097, 25391 (Data Akun Murid / cache rapor)
--     'export'          → app.js:10220, 10274, 11812, 11953, 12149, 12279
--     'cetak'           → app.js:10543 (form edit murid, + jabatan_ekskul_map)
--     'dashboard_murid' → utils.js:517 (get_dashboard_data)
--     'anggota_ekskul'  → app.js:173 (roster anggota ekskul, p_ekskul)
--     'pemilih'         → app.js:20640 (modal tambah anggota ekskul)
--     'pemilih_ringkas' → app.js:20799 (import daftar NIS massal)
--     'ekskul_map'      → app.js:21215 (migrasi keanggotaan antar TA)
--     'nis'             → app.js:13324 (cek NIS terdaftar saat import; p_nis_list)
create or replace function ambil_daftar_murid(
  p_mode      text default 'list',
  p_ekskul    text default '',
  p_nis_list  text[] default '{}',
  p_token     text default '',
  p_klaim_nis text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_mode   text := coalesce(nullif(trim(p_mode), ''), 'list');
  v_ekskul text := trim(coalesce(p_ekskul, ''));
  v_staf   boolean := (fn_is_admin() or fn_is_guru());
  v_rows   jsonb;
begin
  -- Staf (JWT admin/guru) ATAU murid dengan sesi lokal yang sah.
  if not v_staf and fn_akses_murid(p_token, p_klaim_nis) is null then
    return '[]'::jsonb;
  end if;

  -- Mode berisi data pribadi/ortu (nama orang tua, alamat, catatan khusus,
  -- nomor HP) hanya untuk staf terverifikasi lewat JWT.
  if not v_staf and v_mode in ('export', 'cetak', 'dashboard_murid', 'nis', 'penuh') then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(x.value order by x.nama asc nulls last), '[]'::jsonb)
    into v_rows
    from (
      select fn_akun_json(a.id, v_mode) as value, a.nama_lengkap as nama
      from akun a
      where a.tipe = 'murid'
        and (v_ekskul = '' or coalesce(a.ekstrakurikuler, '') ilike '%' || v_ekskul || '%')
        and (
              array_length(p_nis_list, 1) is null
              or a.nis_nip = any(p_nis_list)
            )
    ) x;

  return v_rows;
end $$;

-- 2c. Satu baris `akun` per mode (menggantikan baca 1-baris by nis/email/id):
--     'profil_akun'  → app.js:683, 687 (profil header)
--     'foto'         → app.js:774, 780, 1696, 1986 (foto avatar/id card)
--     'penuh'        → app.js:2374, 2571, 20124 (profil murid / kartu anggota)
--     'ringkas_murid'→ app.js:25404 (cari murid rapor)
--     'cetak'        → app.js:10543 (form edit murid lengkap)
--     'ekskul_map'   → app.js:21127 (hapus anggota: ekstrakurikuler+riwayat+jabatan)
--     'jabatan_map'  → app.js:20341 (kelola jabatan anggota ekskul)
--     'wajah'        → face.js:1298 (pendaftaran/verifikasi wajah 1 murid)
create or replace function ambil_akun_satu(
  p_nis_nip   text default '',
  p_email     text default '',
  p_id        text default '',
  p_mode      text default 'profil_akun',
  p_token     text default '',
  p_klaim_nis text default ''
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_mode   text := coalesce(nullif(trim(p_mode), ''), 'profil_akun');
  v_staf   boolean := (fn_is_admin() or fn_is_guru());
  v_sesi   text := fn_akses_murid(p_token, p_klaim_nis);  -- NIS pemilik sesi / NULL
  v_milik  boolean;
  v_publik boolean;
  v_pengurus boolean := false;
  v_baris  akun%rowtype;
begin
  select * into v_baris
  from akun a
  where (trim(coalesce(p_id, '')) <> '' and a.id::text = trim(p_id))
     or (trim(coalesce(p_nis_nip, '')) <> '' and a.nis_nip = trim(p_nis_nip))
     or (trim(coalesce(p_email, '')) <> '' and lower(coalesce(a.email, '')) = lower(trim(p_email)))
  order by (a.user_id is not null) desc, a.tipe
  limit 1;

  if v_baris.id is null then
    return json_build_object('status', 'error', 'message', 'Data akun tidak ditemukan.');
  end if;

  -- Sifat pemanggil (bila murid ber-sesi):
  --   v_publik   → mode yang isinya boleh dibaca untuk DIRINYA sendiri;
  --   v_pengurus → murid pemegang jabatan ekskul (kartu profil anggota ekskul,
  --                sejalan dengan bolehLihatKontakAnggotaEkskul() di app.js).
  v_publik := v_mode in ('profil_akun', 'foto', 'wajah', 'penuh', 'ringkas_murid', 'nis');
  v_milik  := (v_sesi is not null and v_baris.nis_nip = v_sesi);
  if v_sesi is not null then
    select coalesce(jabatan_ekskul, '') <> ''
           or (jabatan_ekskul_map is not null and jabatan_ekskul_map <> '{}'::jsonb)
      into v_pengurus
      from akun where nis_nip = v_sesi and tipe = 'murid';
    v_pengurus := coalesce(v_pengurus, false);
  end if;

  if not v_staf then
    if v_sesi is null then
      return json_build_object('status', 'error', 'message', 'Sesi tidak valid. Silakan login ulang.');
    end if;

    -- Mode khusus staf (form edit murid / ekspor) tidak boleh dari sesi murid.
    if v_mode in ('cetak', 'export', 'nis', 'list') then
      return json_build_object('status', 'error', 'message', 'Akses ditolak.');
    end if;

    -- Mode ekskul (roster/jabatan anggota): pemilik baris atau pengurus ekskul.
    if v_mode in ('ekskul_map', 'jabatan_map') and not (v_milik or v_pengurus) then
      return json_build_object('status', 'error', 'message', 'Akses ditolak.');
    end if;

    -- Mode publik: hanya barisnya sendiri ATAU (untuk anggota ekskul) pengurus.
    if v_publik and not (v_milik or v_pengurus) then
      return json_build_object('status', 'error', 'message', 'Akses ditolak.');
    end if;
  end if;

  return json_build_object('status', 'success', 'akun', fn_akun_json(v_baris.id, v_mode));
end $$;

-- 2d. Peta descriptor wajah (menggantikan face.js:786, 2023, 2301).
--     p_nis_list kosong = semua murid (scan massal). Murid ber-sesi boleh
--     membaca roster wajah sekolah (dipakai verifikasi absen & pengurus ekskul).
create or replace function ambil_peta_wajah(
  p_nis_list  text[] default '{}',
  p_aktif_saja boolean default false,
  p_token     text default '',
  p_klaim_nis text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_staf  boolean := (fn_is_admin() or fn_is_guru());
  v_boleh text[];
  v_rows  jsonb;
begin
  if v_staf then
    v_boleh := array(select a.nis_nip from akun a where a.tipe = 'murid');
  else
    v_boleh := fn_akses_murid_list(p_token, p_nis_list, p_klaim_nis);
  end if;

  if not v_staf and array_length(v_boleh, 1) is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(fn_akun_json(a.id, 'peta_wajah') order by a.nis_nip), '[]'::jsonb)
    into v_rows
    from akun a
   where a.tipe = 'murid'
     and a.wajah_descriptor is not null
     and (not p_aktif_saja or a.wajah_status = 'aktif')
     and (v_staf or a.nis_nip = any(v_boleh));

  return v_rows;
end $$;

-- 2e. Hitungan akun untuk Guru Dashboard (app.js:17492-17493 pakai count head:true).
create or replace function hitung_akun()
returns json
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_hasil json;
begin
  if not (fn_is_admin() or fn_is_guru()) then
    return json_build_object('murid', 0, 'guru', 0, 'admin', 0);
  end if;

  select json_build_object(
           'murid', count(*) filter (where a.tipe = 'murid'),
           'guru',  count(*) filter (where a.tipe = 'guru'),
           'admin', count(*) filter (where a.tipe = 'admin'))
    into v_hasil
    from akun a;

  return v_hasil;
end $$;

-- 2f. Validasi sesi absen mandiri (menggantikan fallback baca `akun` di
--     utils.js:399-413: kolom captcha/kunci_absen guru pembuka sesi).
--     Captcha DIBANDINGKAN DI SERVER — klien tidak lagi perlu kolom itu.
create or replace function cek_sesi_absen(
  p_mapel     text,
  p_captcha   text default '',
  p_token     text default '',
  p_klaim_nis text default ''
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_mapel   text := trim(coalesce(p_mapel, ''));
  v_captcha text := trim(coalesce(p_captcha, ''));
  v_sesi    text;
  v_buka    boolean;
  v_cocok   boolean;
  v_jumlah  integer;
begin
  if not (fn_is_admin() or fn_is_guru()) then
    v_sesi := fn_akses_murid(p_token, p_klaim_nis);
    if v_sesi is null then
      return json_build_object('status', 'error', 'message', 'Sesi tidak valid. Silakan login ulang.');
    end if;
  end if;

  select coalesce(bool_or(a.kunci_absen = 'BUKA'), false),
         coalesce(bool_or(a.kunci_absen = 'BUKA'
                          and upper(coalesce(a.captcha, '')) = upper(v_captcha)), false),
         count(*)::integer
    into v_buka, v_cocok, v_jumlah
    from akun a
   where a.tipe in ('guru', 'admin')
     and (coalesce(a.mapel, '') ilike '%' || v_mapel || '%'
          or coalesce(a.ekstrakurikuler, '') ilike '%' || v_mapel || '%');

  return json_build_object(
    'status', 'success',
    'sesi_buka', v_buka,
    'captcha_ok', (v_captcha <> '' and v_cocok),
    'jumlah', v_jumlah
  );
end $$;

-- ============================================================
-- 3. TULIS (riwayat, ekskul, penugasan, kunci absen)
-- ============================================================

-- 3a. Helper: pakai nilai baru bila benar-benar dikirim (JSON `null` dari klien
--     tetap dianggap "tidak diubah" — mencegah kolom terhapus tak sengaja).
create or replace function fn_jsonb_atau(p_baru jsonb, p_lama jsonb)
returns jsonb
language sql
immutable
as $$
  select case
           when p_baru is null or jsonb_typeof(p_baru) = 'null' then p_lama
           else p_baru
         end
$$;

-- 3b. Riwayat kelas & ekskul murid (menggantikan update akun di
--     app.js:12494 (dual-write TA aktif), 13407 (import murid),
--     12521 (dual-write riwayat ekskul), 21245 (migrasi keanggotaan antar TA)).
--     Hanya field yang dikirim yang berubah (null = abaikan).
create or replace function simpan_riwayat_murid(
  p_nis            text,
  p_riwayat_kelas  jsonb default null,
  p_tingkat_kelas  text default '',
  p_riwayat_ekskul jsonb default null,
  p_token          text default '',
  p_klaim_nis      text default ''
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis  text := trim(coalesce(p_nis, ''));
  v_staf boolean := (fn_is_admin() or fn_is_guru());
  v_sesi text;
  v_n    integer;
begin
  if v_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;

  v_sesi := fn_akses_murid(p_token, p_klaim_nis);
  if not v_staf and (v_sesi is null or v_sesi <> v_nis) then
    return json_build_object('status', 'error', 'message', 'Akses ditolak.');
  end if;

  if not exists (select 1 from akun where nis_nip = v_nis and tipe = 'murid') then
    return json_build_object('status', 'error', 'message', 'NIS murid tidak ditemukan.');
  end if;

  update akun
     set riwayat_kelas  = fn_jsonb_atau(p_riwayat_kelas, riwayat_kelas),
         tingkat_kelas  = coalesce(nullif(trim(coalesce(p_tingkat_kelas, '')), ''), tingkat_kelas),
         riwayat_ekskul = fn_jsonb_atau(p_riwayat_ekskul, riwayat_ekskul)
   where nis_nip = v_nis and tipe = 'murid';

  get diagnostics v_n = row_count;
  return json_build_object('status', 'success', 'baris', v_n);
end $$;

-- 3c. Keanggotaan & jabatan ekstrakurikuler (menggantikan update akun di
--     app.js:20539 (ubah anggota ekskul — fallback lama), 21158 (hapus
--     permanen anggota), 20348 (simpan jabatan anggota)).
--     Otorisasi: admin/guru ATAU murid pemegang jabatan ekskul tsb
--     (fn_akses_ekskul → 'tulis'). Murid biasa ditolak agar tidak bisa
--     menaikkan jabatan/keanggotaannya sendiri.
create or replace function simpan_ekskul_murid(
  p_nis                text,
  p_ekstrakurikuler    text default '',
  p_riwayat_ekskul     jsonb default null,
  p_jabatan_ekskul_map jsonb default null,
  p_ekskul             text default '',
  p_token              text default '',
  p_klaim_nis          text default ''
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis    text := trim(coalesce(p_nis, ''));
  v_ekskul text := trim(coalesce(p_ekskul, ''));
  v_akses  text;
  v_ada    boolean;
  v_n      integer;
begin
  if v_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;

  v_akses := fn_akses_ekskul(p_token, p_klaim_nis, v_ekskul);
  if coalesce(v_akses, '') <> 'tulis' then
    return json_build_object('status', 'error', 'message', 'Akses ditolak. Hanya admin/guru/pengurus ekskul yang boleh mengubah keanggotaan.');
  end if;

  select true into v_ada from akun where nis_nip = v_nis and tipe = 'murid';
  if v_ada is not true then
    return json_build_object('status', 'error', 'message', 'NIS murid tidak ditemukan.');
  end if;

  update akun
     set ekstrakurikuler    = coalesce(nullif(trim(coalesce(p_ekstrakurikuler, '')), ''), ekstrakurikuler),
         riwayat_ekskul     = fn_jsonb_atau(p_riwayat_ekskul, riwayat_ekskul),
         jabatan_ekskul_map = fn_jsonb_atau(p_jabatan_ekskul_map, jabatan_ekskul_map)
   where nis_nip = v_nis and tipe = 'murid';

  get diagnostics v_n = row_count;
  return json_build_object('status', 'success', 'baris', v_n);
end $$;

-- 3d. Penugasan guru (bulk) — menggantikan update akun di app.js:15318
--     (salin penugasan massal) & app.js:16641 (duplikat Tahun Pelajaran).
--     p_rows: [{ "id": <uuid>, "nis_nip": "<nip>", "penugasan": {...} }, …]
--     Hanya admin yang boleh mengubah penugasan guru.
create or replace function simpan_penugasan_guru(p_rows jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_r   jsonb;
  v_n   integer := 0;
  v_pn  jsonb;
  v_id  text;
  v_nis text;
begin
  if not fn_is_admin() then
    return json_build_object('status', 'error', 'message', 'Hanya admin yang boleh mengubah penugasan guru.');
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return json_build_object('status', 'error', 'message', 'Payload harus berupa array baris.');
  end if;

  for v_r in select value from jsonb_array_elements(p_rows) as t(value) loop
    v_pn  := v_r -> 'penugasan';
    v_id  := trim(coalesce(v_r ->> 'id', ''));
    v_nis := trim(coalesce(v_r ->> 'nis_nip', ''));

    if v_pn is null then continue; end if;

    if v_id <> '' then
      update akun set penugasan = v_pn where id::text = v_id and tipe = 'guru';
    elsif v_nis <> '' then
      update akun set penugasan = v_pn where nis_nip = v_nis and tipe = 'guru';
    else
      continue;
    end if;

    v_n := v_n + 1;
  end loop;

  return json_build_object('status', 'success', 'baris', v_n);
end $$;

-- 3e. Kunci/captcha absen guru (menggantikan update akun di app.js:4035 —
--     panel Kunci Absen guru sendiri — dan app.js:17902 — admin/ekskul).
--     Admin boleh menarget baris siapa pun; guru hanya barisnya sendiri
--     (dicocokkan lewat fn_nis() dari JWT, bukan dari param bebas).
--     Pengurus murid memakai RPC `ganti_kunci_absen_ekskul` yang sudah ada.
create or replace function simpan_kunci_absen(
  p_nis_nip text default '',
  p_captcha text default '',
  p_kunci   text default ''
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_target text := trim(coalesce(p_nis_nip, ''));
  v_kunci  text := upper(trim(coalesce(p_kunci, '')));
  v_cap    text := upper(trim(coalesce(p_captcha, '')));
  v_n      integer;
begin
  if v_target = '' then v_target := fn_nis(); end if;
  if v_target = '' then
    return json_build_object('status', 'error', 'message', 'NIS/NIP target tidak diketahui.');
  end if;

  if not fn_is_admin() and not (fn_is_guru() and v_target = fn_nis()) then
    return json_build_object('status', 'error', 'message', 'Akses ditolak.');
  end if;

  update akun
     set captcha     = coalesce(nullif(v_cap, ''), captcha),
         kunci_absen = case
                         when v_kunci = 'BUKA' then 'BUKA'
                         when v_kunci = 'TUTUP' then 'TUTUP'
                         else kunci_absen
                       end
   where nis_nip = v_target;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    return json_build_object('status', 'error', 'message', 'Baris akun dengan NIS/NIP tersebut tidak ditemukan.');
  end if;

  return json_build_object('status', 'success', 'baris', v_n);
end $$;

-- ============================================================
-- 4. IZIN EKSEKUSI
--    RPC di atas dipanggil dari browser: guru/admin memakai JWT Supabase,
--    murid memakai anon key + token sesi (param p_token).
-- ============================================================
grant execute on function identitas_login(text) to anon, authenticated;
grant execute on function profil_sesi_auth(text) to authenticated;
grant execute on function taut_user_id_sesi(text) to authenticated;

grant execute on function ambil_daftar_guru(text, text, boolean) to anon, authenticated;
grant execute on function ambil_daftar_murid(text, text, text[], text, text) to anon, authenticated;
grant execute on function ambil_akun_satu(text, text, text, text, text, text) to anon, authenticated;
grant execute on function ambil_peta_wajah(text[], boolean, text, text) to anon, authenticated;
grant execute on function hitung_akun() to authenticated;
grant execute on function cek_sesi_absen(text, text, text, text) to anon, authenticated;

grant execute on function simpan_riwayat_murid(text, jsonb, text, jsonb, text, text) to anon, authenticated;
grant execute on function simpan_ekskul_murid(text, text, jsonb, jsonb, text, text, text) to anon, authenticated;
grant execute on function simpan_penugasan_guru(jsonb) to authenticated;
grant execute on function simpan_kunci_absen(text, text, text) to authenticated;

-- ============================================================
-- 5. VERIFIKASI & RELOAD CACHE SKEMA POSTGREST
-- ============================================================
do $$
declare v_n integer;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fn_akun_export','fn_akun_json','fn_jsonb_atau',
                       'identitas_login','profil_sesi_auth','taut_user_id_sesi',
                       'ambil_daftar_guru','ambil_daftar_murid','ambil_akun_satu',
                       'ambil_peta_wajah','hitung_akun','cek_sesi_absen',
                       'simpan_riwayat_murid','simpan_ekskul_murid',
                       'simpan_penugasan_guru','simpan_kunci_absen');
  raise notice 'INFO: %/16 fungsi RPC akun terpasang (harus 16).', v_n;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- [80/84] upgrade_20261028b2_token_rpc_murid.sql
-- ============================================================
-- ============================================================
-- UPGRADE 20261028b2: TOKEN SESI UNTUK RPC MURID YANG MENULIS `akun` — 2026-10-28
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG
--   RPC murid yang sudah ada (`ubah_profil_murid`, `simpan_wajah_murid`,
--   `ubah_anggota_ekskul`, `daftar_anggota_ekskul_baru`,
--   `ganti_kunci_absen_ekskul`) mengandalkan NIS yang DIKIRIM KLIEN
--   (`p_nis` / `p_pengurus_nis` / `p_pemanggil`) sebagai bukti identitas.
--   Karena RPC itu di-grant ke anon, siapa pun yang tahu NIS seorang murid
--   bisa mengubah profil, menimpa descriptor wajah, atau mendaftarkan
--   anggota ekskul atas namanya.
--
-- ISI
--   Setiap RPC di atas dibuat ulang dengan TAMBAHAN parameter `p_token`
--   (token sesi `sesi_lokal` dari `upgrade_20261028a`) dan pengecekan
--   otorisasi lewat `fn_akses_murid` / `fn_akses_ekskul`. Logika bisnis di
--   dalamnya DISALIN APA ADANYA dari versi terakhir masing-masing
--   (20261013, 20261023, 20261021, 20260930, 20261006c) — hanya blok
--   otorisasi yang berubah.
--
--   Catatan `ubah_password_sendiri`: setelah password berganti, SEMUA sesi
--   lama murid itu dicabut dan server menerbitkan sesi baru (`sesi_token`
--   di respons) supaya klien bisa lanjut tanpa login ulang.
--
-- KOMPATIBILITAS
--   Parameter `p_token` punya nilai default '' dan parameter NIS lama
--   (`p_nis` / `p_pengurus_nis` / `p_pemanggil` / `p_pemanggil_nis`)
--   DIPERTAHANKAN hanya supaya signature tetap cocok dengan pemanggil lama —
--   nilainya TIDAK dipakai sebagai bukti identitas. Identitas murid diambil
--   dari sesi: SELURUH RPC di file ini memanggil `fn_akses_murid(p_token, '')`
--   (fallback klaim NIS dikosongkan), sehingga:
--     * pemanggil tanpa token sah → langsung ditolak ('Sesi tidak valid …' /
--       'Tidak berhak …') meski tahu NIS milik murid lain;
--     * staf (admin/guru) tetap lolos lewat JWT (`fn_is_admin()`/`fn_is_guru()`),
--       tidak bergantung pada parameter klien sama sekali.
--   Ini membuat RPC penulis `akun` sudah ketat sejak file ini dijalankan
--   (setara `fix_20261028d_sesi_wajib.sql`, yang menutup jalur sama untuk RPC
--   baca di `upgrade_20261028b_rpc_akun.sql`).
--
-- PRASYARAT: upgrade_20261028a_sesi_lokal_murid.sql sudah dijalankan.
--
-- DI LUAR RUANG LINGKUP FASE INI (disengaja):
--   * `absen_mandiri` — menulis tabel `absensi`, bukan `akun`, dan validasi
--     sesi absen (BUKA + captcha) sudah dipindah ke RPC `cek_sesi_absen`
--     (upgrade_20261028b). Penambahan `p_token` di RPC itu direncanakan
--     sebagai lanjutan agar seluruh alur absen mandiri juga berbasis sesi.
--   * Edge Function `unggah-foto-murid` — memakai service role di server
--     (lolos RLS) dan memverifikasi pemanggil lewat JWT/klaim; penggantian
--     klaim NIS menjadi token sesi direncanakan sebagai fase lanjutan.
--
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. UBAH PROFIL SENDIRI (whitelist + kepemilikan) ==========
-- Versi asli: upgrade_20261013_akun_murid_keterangan_maps.sql
drop function if exists ubah_profil_murid(text, jsonb);

create or replace function ubah_profil_murid(p_nis text, p_data jsonb, p_token text default '')
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_lahir date;
  v_medsos jsonb;
  v_sesi  text;
begin
  if not exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') then
    return json_build_object('status', 'error', 'message', 'Akun murid tidak ditemukan.');
  end if;

  -- Kebijakan kepemilikan: admin, ATAU murid pemilik sesi (token).
  -- Fallback klaim NIS dikosongkan → identitas HANYA dari sesi.
  v_sesi := fn_akses_murid(p_token, '');
  if not fn_is_admin() and (v_sesi is null or v_sesi <> p_nis) then
    return json_build_object('status', 'error', 'message', 'Tidak berhak mengubah profil murid ini.');
  end if;

  v_lahir := nullif(trim(coalesce(p_data->>'tgl_lahir', '')), '')::date;
  if jsonb_typeof(p_data->'media_sosial') = 'array' then
    v_medsos := p_data->'media_sosial';
  else
    v_medsos := '[]'::jsonb;
  end if;

  update akun set
    email            = coalesce(p_data->>'email', email),
    no_telepon       = coalesce(p_data->>'no_telepon', no_telepon),
    no_telepon_ortu  = coalesce(p_data->>'no_telepon_ortu', no_telepon_ortu),
    alamat           = coalesce(p_data->>'alamat', alamat),
    alamat_maps      = coalesce(p_data->>'alamat_maps', alamat_maps),
    media_sosial     = case when p_data ? 'media_sosial' then v_medsos else media_sosial end,
    nama_ayah        = coalesce(p_data->>'nama_ayah', nama_ayah),
    pekerjaan_ayah   = coalesce(p_data->>'pekerjaan_ayah', pekerjaan_ayah),
    nama_ibu         = coalesce(p_data->>'nama_ibu', nama_ibu),
    pekerjaan_ibu    = coalesce(p_data->>'pekerjaan_ibu', pekerjaan_ibu),
    nama_wali        = coalesce(p_data->>'nama_wali', nama_wali),
    tgl_lahir        = coalesce(v_lahir, tgl_lahir),
    jenis_kelamin    = coalesce(p_data->>'jenis_kelamin', jenis_kelamin),
    agama            = coalesce(p_data->>'agama', agama),
    golongan_darah   = coalesce(p_data->>'golongan_darah', golongan_darah),
    catatan_khusus   = coalesce(p_data->>'catatan_khusus', catatan_khusus)
  where nis_nip = p_nis and tipe = 'murid';

  return json_build_object('status', 'success', 'message', 'Profil berhasil diperbarui.');
end $$;

grant execute on function ubah_profil_murid(text, jsonb, text) to anon, authenticated;

-- ========== 2. GANTI PASSWORD SENDIRI (+ cabut sesi lama) ==========
-- Versi asli: upgrade_20260928_rpc_akun_murid.sql
drop function if exists ubah_password_sendiri(text, text, text);

create or replace function ubah_password_sendiri(p_nis text, p_lama text, p_baru text, p_token text default '')
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_sesi text;
  v_baru json;
begin
  if length(trim(coalesce(p_baru, ''))) < 6 then
    return json_build_object('status', 'error', 'message', 'Password baru minimal 6 karakter.');
  end if;

  -- Kepemilikan: admin, ATAU murid pemilik sesi (token).
  -- Fallback klaim NIS dikosongkan → identitas HANYA dari sesi.
  v_sesi := fn_akses_murid(p_token, '');
  if not fn_is_admin() and (v_sesi is null or v_sesi <> p_nis) then
    return json_build_object('status', 'error', 'message', 'Tidak berhak mengganti password akun ini.');
  end if;

  select password_hash into v_hash from akun_kredensial where nis_nip = p_nis;
  if v_hash is null then
    return json_build_object('status', 'error', 'message', 'Kredensial tidak ditemukan. Hubungi admin.');
  end if;

  if crypt(coalesce(p_lama, ''), v_hash) <> v_hash then
    return json_build_object('status', 'error', 'message', 'Password lama salah.');
  end if;

  update akun_kredensial
    set password_hash = crypt(p_baru, gen_salt('bf', 10)), updated_at = now()
  where nis_nip = p_nis;

  -- Semua sesi lama (termasuk token yang dikirim pemanggil) dicabut, lalu
  -- server menerbitkan sesi baru agar klien tidak terjebak logout.
  perform fn_sesi_cabut_nis(p_nis);
  v_baru := fn_sesi_buat(p_nis, 'murid', 12);

  return json_build_object(
    'status', 'success',
    'message', 'Password berhasil diganti.',
    'sesi_token', v_baru ->> 'token',
    'sesi_expires_at', v_baru ->> 'expires_at'
  );
end $$;

grant execute on function ubah_password_sendiri(text, text, text, text) to anon, authenticated;

-- ========== 3. PENGURUS EKSKUL GANTI KUNCI ABSEN (CAPTCHA) ==========
-- Versi asli: upgrade_20261006c_kunci_absen_ekskul_pengurus.sql
-- Identitas pemanggil TIDAK lagi dipercaya dari parameter: diambil dari sisi
-- server (JWT staf atau token sesi murid).
drop function if exists ganti_kunci_absen_ekskul(text, text, text, text);

create or replace function ganti_kunci_absen_ekskul(
  p_pemanggil text,
  p_ekskul text,
  p_captcha text,
  p_kunci text,
  p_token text default ''
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pemanggil text;
  v_jabatan_map jsonb;
  v_total int;
begin
  if fn_role() in ('admin', 'guru') then
    v_pemanggil := fn_nis();          -- staf: identitas dari JWT
  else
    -- Fallback klaim NIS dikosongkan (parameter `p_pemanggil` hanya untuk
    -- kompatibilitas signature) → identitas HANYA dari sesi.
    v_pemanggil := fn_akses_murid(p_token, '');
    if coalesce(trim(coalesce(v_pemanggil, '')), '') = '' then
      return json_build_object('status', 'error', 'message', 'Sesi tidak valid. Silakan login ulang.');
    end if;
  end if;

  -- 1) Pemanggil murid harus menjabat (pengurus) pada p_ekskul.
  if coalesce(trim(coalesce(v_pemanggil, '')), '') <> '' then
    select jabatan_ekskul_map into v_jabatan_map
    from akun
    where nis_nip = v_pemanggil and tipe = 'murid';
  end if;

  if coalesce(trim(coalesce(v_pemanggil, '')), '') <> '' and not fn_is_admin() and not fn_is_guru() then
    if v_jabatan_map is null or coalesce(trim(coalesce(v_jabatan_map->>p_ekskul, '')), '') = '' then
      return json_build_object('status', 'error', 'message', 'Anda bukan pengurus (menjabat) pada ' || p_ekskul || '.');
    end if;
  end if;

  -- 2) Perbarui kunci/captcha pada baris PEMBINA (guru/admin) ekskul ini.
  --    Kecocokan identik dengan validasi absen_mandiri: ekstrakurikuler
  --    berisi p_ekskul, atau mapel mengandung p_ekskul.
  update akun
  set captcha = upper(trim(coalesce(p_captcha, ''))),
      kunci_absen = case when p_kunci = 'BUKA' then 'BUKA' else 'TUTUP' end,
      updated_at = now()
  where tipe in ('guru', 'admin')
    and (
      lower(trim(p_ekskul)) = any (
        select lower(trim(x)) from unnest(string_to_array(ekstrakurikuler, ',')) as x where trim(x) <> ''
      )
      or mapel ilike '%' || p_ekskul || '%'
    );

  get diagnostics v_total = row_count;

  if v_total = 0 then
    return json_build_object('status', 'error', 'message', 'Pembina ' || p_ekskul || ' tidak ditemukan — kunci absen tidak diubah.');
  end if;

  return json_build_object('status', 'success', 'total', v_total, 'message', 'Kunci absen ' || p_ekskul || ' diperbarui.');
end $$;

grant execute on function ganti_kunci_absen_ekskul(text, text, text, text, text) to anon, authenticated;

-- ========== 4. PENGURUS EKSKUL DAFTARKAN ANGGOTA BARU ==========
-- Versi asli: upgrade_20260930_pengurus_tambah_anggota.sql
-- Identitas pengurus diambil dari sesi (JWT staf / token murid).
drop function if exists daftar_anggota_ekskul_baru(text, text, jsonb);

create or replace function daftar_anggota_ekskul_baru(
  p_pengurus_nis text,
  p_ekskul text,
  p_data jsonb,
  p_token text default ''
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pengurus text;
  v_nis text;
  v_pass text;
  v_lahir date;
  v_jabatan_map jsonb;
begin
  if fn_role() in ('admin', 'guru') then
    v_pengurus := trim(coalesce(fn_nis(), ''));   -- staf: identitas dari JWT
  else
    -- Fallback klaim NIS dikosongkan (parameter `p_pengurus_nis` hanya untuk
    -- kompatibilitas signature) → identitas HANYA dari sesi.
    v_pengurus := fn_akses_murid(p_token, '');
    if coalesce(trim(coalesce(v_pengurus, '')), '') = '' then
      return json_build_object('status', 'error', 'message', 'Sesi tidak valid. Silakan login ulang.');
    end if;

    -- Verifikasi pemanggil adalah murid yang menjabat (pengurus) pada p_ekskul.
    select jabatan_ekskul_map into v_jabatan_map
    from akun
    where nis_nip = v_pengurus and tipe = 'murid';

    if v_jabatan_map is null or coalesce(trim(coalesce(v_jabatan_map->>p_ekskul, '')), '') = '' then
      return json_build_object('status', 'error', 'message', 'Hanya pengurus (menjabat) ekskul ini yang dapat mendaftarkan anggota baru.');
    end if;
  end if;

  v_nis := trim(coalesce(p_data->>'nis', ''));
  if v_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;
  if coalesce(trim(coalesce(p_data->>'nama_lengkap', '')), '') = '' then
    return json_build_object('status', 'error', 'message', 'Nama lengkap wajib diisi.');
  end if;

  if exists (select 1 from akun where nis_nip = v_nis) then
    return json_build_object('status', 'error', 'message', 'NIS sudah terdaftar. Gunakan NIS lain atau tambahkan sebagai anggota lewat menu Tambah Anggota.');
  end if;

  v_pass := trim(coalesce(p_data->>'password', ''));
  if v_pass <> '' and length(v_pass) < 6 then
    return json_build_object('status', 'error', 'message', 'Password minimal 6 karakter.');
  end if;
  if v_pass = '' then v_pass := '123456'; end if;

  v_lahir := nullif(trim(coalesce(p_data->>'tgl_lahir', '')), '')::date;

  insert into akun (
    nama_lengkap, nis_nip, tipe, tahun_pelajaran, tingkat_kelas,
    ekstrakurikuler, tgl_lahir, jabatan_ekskul_map
  ) values (
    trim(p_data->>'nama_lengkap'), v_nis, 'murid',
    nullif(trim(coalesce(p_data->>'tahun_pelajaran', '')), ''),
    nullif(trim(coalesce(p_data->>'tingkat_kelas', '')), ''),
    p_ekskul,
    v_lahir,
    '{}'::jsonb
  );

  insert into akun_kredensial (nis_nip, password_hash)
  values (v_nis, crypt(v_pass, gen_salt('bf', 10)))
  on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();

  return json_build_object('status', 'success', 'message', 'Siswa baru berhasil didaftarkan sebagai anggota ' || p_ekskul || '.');
end $$;

grant execute on function daftar_anggota_ekskul_baru(text, text, jsonb, text) to anon, authenticated;

-- ========== 5. SIMPAN / HAPUS DATA WAJAH MURID ==========
-- Versi asli: upgrade_20261023_wajah_motor_mediapipe.sql
-- Otorisasi memakai SESI: admin; murid pemilik token; guru wali/pembina
-- (lewat fn_is_guru() + akun_guru_ampu_murid) — parameter pemanggil dari klien
-- tidak lagi menjadi bukti identitas.
drop function if exists simpan_wajah_murid(text, jsonb, text, text, text, text);

create or replace function simpan_wajah_murid(
  p_nis text,
  p_descriptor jsonb default null,
  p_status text default 'aktif',
  p_pemanggil_nis text default null,
  p_pemanggil_tipe text default null,
  p_mode text default 'ganti',
  p_token text default ''
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ada boolean;
  v_list jsonb;
  v_lama jsonb;
  v_baru jsonb;
  v_jumlah int;
  v_jumlah_lama int;
  v_i int;
  v_j int;
  v_sampel jsonb;
  v_elemen jsonb;
  v_sesi text;
begin
  p_nis := trim(coalesce(p_nis, ''));
  p_status := lower(trim(coalesce(p_status, '')));
  p_mode := lower(trim(coalesce(p_mode, 'ganti')));

  if p_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;

  select exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') into v_ada;
  if not v_ada then
    return json_build_object('status', 'error', 'message', 'Data murid tidak ditemukan.');
  end if;

  -- Otorisasi berbasis sesi (lihat header file).
  -- Fallback klaim NIS dikosongkan (parameter `p_pemanggil_nis` hanya untuk
  -- kompatibilitas signature) → identitas HANYA dari sesi.
  v_sesi := fn_akses_murid(p_token, '');
  if not fn_is_admin()
     and not (v_sesi is not null and v_sesi = p_nis)
     and not (fn_is_guru() and akun_guru_ampu_murid(fn_nis(), p_nis)) then
    return json_build_object('status', 'error', 'message', 'Tidak berhak mengubah data wajah murid ini.');
  end if;

  -- ===== Normalisasi + validasi p_descriptor (dimensi 128 ATAU 512) =====
  if p_descriptor is not null then
    if jsonb_typeof(p_descriptor) <> 'array' then
      return json_build_object('status', 'error', 'message', 'Deskriptor wajah harus berupa array 128 ATAU 512 angka (atau array dari array semacam itu).');
    end if;
    -- Klien kan nog steeds plat vektor 128/512 sturen → wrap eenmaal.
    if jsonb_array_length(p_descriptor) in (128, 512) and jsonb_typeof(p_descriptor -> 0) = 'number' then
      v_list := jsonb_build_array(p_descriptor);
    else
      v_list := p_descriptor;
    end if;

    v_jumlah := jsonb_array_length(v_list);
    if v_jumlah < 1 then
      return json_build_object('status', 'error', 'message', 'Minimal satu sampel wajah diperlukan.');
    end if;
    if p_mode = 'tambah' and v_jumlah <> 1 then
      return json_build_object('status', 'error', 'message', 'Mode tambah menerima tepat satu sampel (array 128 ATAU 512 angka).');
    end if;
    if p_mode = 'ganti' and v_jumlah > 6 then
      return json_build_object('status', 'error', 'message', 'Maksimal 6 sampel wajah per murid (' || v_jumlah || ' diberikan).');
    end if;

    for v_i in 0 .. v_jumlah - 1 loop
      v_sampel := v_list -> v_i;
      if jsonb_typeof(v_sampel) <> 'array' or jsonb_array_length(v_sampel) not in (128, 512) then
        return json_build_object('status', 'error', 'message', 'Setiap sampel wajah harus berupa array 128 ATAU 512 angka.');
      end if;
      for v_j in 0 .. jsonb_array_length(v_sampel) - 1 loop
        v_elemen := v_sampel -> v_j;
        if jsonb_typeof(v_elemen) not in ('number') or not (v_elemen #>> '{}')::double precision between -10 and 10 then
          return json_build_object('status', 'error', 'message', 'Deskriptor wajah berisi nilai tidak valid.');
        end if;
      end loop;
    end loop;
  end if;

-- ===== Terapkan =====
  if p_status = 'aktif' and p_descriptor is not null then
    if p_mode = 'tambah' then
      select coalesce(wajah_descriptor, '[]'::jsonb) into v_lama
        from akun where nis_nip = p_nis and tipe = 'murid';
      -- Baris lama die nog plat is (128/512) → wrap eerst voor append.
      if jsonb_typeof(v_lama) = 'array' and jsonb_array_length(v_lama) in (128, 512) and jsonb_typeof(v_lama -> 0) = 'number' then
        v_lama := jsonb_build_array(v_lama);
      end if;
      if jsonb_typeof(v_lama) <> 'array' then
        v_lama := '[]'::jsonb;
      end if;
      v_jumlah_lama := jsonb_array_length(v_lama);
      if v_jumlah_lama + 1 > 6 then
        return json_build_object('status', 'error', 'message', 'Maksimal 6 sampel wajah per murid — gunakan mode ganti untuk mengganti seluruh data.');
      end if;
      v_baru := v_lama || v_list;
      update akun
         set wajah_descriptor = v_baru,
             wajah_status     = 'aktif'
       where nis_nip = p_nis and tipe = 'murid';
      return json_build_object('status', 'success', 'message', 'Data wajah murid tersimpan (' || jsonb_array_length(v_baru) || ' sampel).');
    else
      update akun
         set wajah_descriptor = v_list,
             wajah_status     = 'aktif'
       where nis_nip = p_nis and tipe = 'murid';
      return json_build_object('status', 'success', 'message', 'Data wajah murid tersimpan (' || jsonb_array_length(v_list) || ' sampel).');
    end if;
  elsif p_status = 'nonaktif' then
    update akun
       set wajah_status = 'nonaktif'
     where nis_nip = p_nis and tipe = 'murid';
    return json_build_object('status', 'success', 'message', 'Data wajah murid dinonaktifkan.');
  else
    -- hapus total (p_status NULL/'' of p_descriptor NULL)
    update akun
       set wajah_descriptor = null,
           wajah_status     = null
     where nis_nip = p_nis and tipe = 'murid';
    return json_build_object('status', 'success', 'message', 'Data wajah murid dihapus.');
  end if;
end $$;

grant execute on function simpan_wajah_murid(text, jsonb, text, text, text, text, text) to anon, authenticated;

-- ========== 6. UBAH ANGGOTA EKSKUL (tambah/buang, per TA + semester) ==========
-- Versi asli: upgrade_20261021_ekskul_riwayat_semester.sql
-- Identitas pemanggil diambil dari sesi (JWT staf / token murid), bukan
-- dari parameter — lalu aturan per-tipe di bawah dinilai atas identitas itu.
drop function if exists ubah_anggota_ekskul(text, text, text[], boolean, text, text[]);

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
    if coalesce(trim(coalesce(v_wali_kelas, '')), '') = ''
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

grant execute on function ubah_anggota_ekskul(text, text, text[], boolean, text, text[], text) to anon, authenticated;

-- ============================================================
-- IZIN TAMBAHAN + VERIFIKASI + RELOAD CACHE SKEMA POSTGREST
-- ============================================================
do $$
declare v_n integer;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('ubah_profil_murid','ubah_password_sendiri','simpan_wajah_murid',
                       'ubah_anggota_ekskul','daftar_anggota_ekskul_baru','ganti_kunci_absen_ekskul')
     and p.pronargs = case p.proname
           when 'ubah_profil_murid'         then 3
           when 'ubah_password_sendiri'     then 4
           when 'simpan_wajah_murid'        then 7
           when 'ubah_anggota_ekskul'       then 7
           when 'daftar_anggota_ekskul_baru' then 4
           when 'ganti_kunci_absen_ekskul'  then 5
         end;
  raise notice 'INFO: %/6 RPC murid berbasis token terpasang (harus 6 — bila <6, cek error DROP/cast di atas).', v_n;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- [81/84] upgrade_20261028c_rls_akun_ketat.sql
-- ============================================================
-- ============================================================
-- UPGRADE 20261028c: RLS KETAT PADA `public.akun` — 2026-10-28
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- ⚠ JALANKAN HANYA SETELAH ketiga hal ini selesai:
--   1. `upgrade_20261028a_sesi_lokal_murid.sql`  (token sesi)
--   2. `upgrade_20261028b_rpc_akun.sql`          (RPC baca/tulis akun)
--   3. `upgrade_20261028b2_token_rpc_murid.sql`  (RPC murid ber-token)
--   dan frontend versi baru (`js/app.js?v=20261028a`) sudah ter-deploy.
--   Urutan aman: deploy frontend dulu → baru file ini.
--
-- LATAR BELAKANG
--   Tabel `akun` selama ini TIDAK punya RLS: izinnya murni GRANT
--   (`grant select … to anon` di fix_20260903_kredensial.sql, plus dua grant
--   kolom untuk pengurus ekskul di upgrade_20260926_ekskul_akses_guru.sql).
--   Artinya siapa pun yang punya anon key (yang selalu ter-bundle di browser)
--   bisa menarik SELURUH data murid (alamat, nama/pekerjaan orang tua, dst).
--   Setelah semua akses pindah ke RPC SECURITY DEFINER, RLS ketat di sini
--   menutup jalur REST langsung tanpa mematikan aplikasi.
--
-- ISI
--   1) `alter table akun enable row level security` — **TANPA** `force`
--      (force akan mematikan SEMUA RPC SECURITY DEFINER, termasuk RPC fase B).
--   2) Policy baca `authenticated`: baris sendiri ATAU staf (admin/guru).
--      (Murid lokal = anon + token → akses lewat RPC, bukan REST.)
--   3) Policy tulis `authenticated`: admin (all) + guru barisnya sendiri.
--   4) `revoke all on akun from anon` — termasuk 2 grant per-kolom lama
--      (`ekstrakurikuler`, `jabatan_ekskul_map`) yang kini tidak terpakai.
--
-- ROLLBACK (1 perintah): `alter table akun disable row level security;`
-- Idempotent — aman dijalankan berulang.
-- ============================================================

alter table akun enable row level security;

-- ========== 1. POLICY ==========
do $$
begin
  -- 1a. BACA: baris sendiri (JWT), atau staf admin/guru (semua baris).
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'akun' and policyname = 'akun_auth_baca') then
    create policy "akun_auth_baca" on akun
      for select to authenticated
      using (
        user_id = auth.uid()
        or nis_nip = fn_nis()
        or fn_role() in ('admin', 'guru')
      );
  end if;

  -- 1b. TULIS penuh: hanya admin (Manajemen Akun Admin/Guru, import, dsb).
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'akun' and policyname = 'akun_admin_tulis') then
    create policy "akun_admin_tulis" on akun
      for all to authenticated
      using (fn_is_admin())
      with check (fn_is_admin());
  end if;

  -- 1c. TULIS baris sendiri: guru (kunci/captcha absen, profil) — dibatasi
  --     ke barisnya sendiri agar tidak bisa menyentuh baris guru lain.
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'akun' and policyname = 'akun_guru_tulis_sendiri') then
    create policy "akun_guru_tulis_sendiri" on akun
      for update to authenticated
      using (nis_nip = fn_nis())
      with check (nis_nip = fn_nis());
  end if;

  -- 1d. Buang policy longgar warisan bila ada (mis. fase_authenticated_all).
  if exists (select 1 from pg_policies where schemaname = 'public'
             and tablename = 'akun' and policyname = 'fase_authenticated_all') then
    drop policy "fase_authenticated_all" on akun;
  end if;
end $$;

-- ========== 2. CABUT AKSES ANON (termasuk grant per-kolom lama) ==========
revoke all on table akun from anon;

-- Akses `authenticated` tetap (dibatasi policy di atas + RPC SECURITY DEFINER).
grant select, insert, update, delete on akun to authenticated;

-- ========== 3. VERIFIKASI & RELOAD CACHE SKEMA POSTGREST ==========
do $$
declare
  v_rls  boolean;
  v_force boolean;
  v_pol  integer;
  v_anon text;
begin
  select relrowsecurity, relforcerowsecurity into v_rls, v_force
  from pg_class where oid = 'public.akun'::regclass;

  select count(*) into v_pol
  from pg_policies where schemaname = 'public' and tablename = 'akun';

  select coalesce(array_to_string(relacl, ' | '), '(null)') into v_anon
  from pg_class where oid = 'public.akun'::regclass;

  raise notice 'INFO: akun → RLS=% (force=%, harus false), policy=%', v_rls, v_force, v_pol;
  raise notice 'INFO: ACL akun = %', v_anon;

  if v_force then
    raise warning 'PERINGATAN: force row level security AKTIF pada akun — matikan (alter table akun no force row level security) atau semua RPC SECURITY DEFINER berhenti bekerja.';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- [82/84] fix_20261028d_sesi_wajib.sql
-- ============================================================
-- ============================================================
-- FIX 20261028d: SESI MURID WAJIB (matikan fallback klaim NIS) — 2026-10-28
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG
--   `upgrade_20261028a` membuat `fn_akses_murid(p_token, p_nis_fallback)`
--   yang MASIH menerima klaim NIS tanpa token (agar klien lama tidak putus
--   saat fase B1/B2). Setelah frontend versi `?v=20261028a` ter-deploy dan
--   setiap sesi murid memakai token dari `cek_login_murid`, klaim itu harus
--   dimatikan supaya bukan hanya RLS yang ketat tetapi juga RPC tidak bisa
--   dipanggil atas nama NIS orang lain.
--
-- ISI
--   `fn_akses_murid` dan `fn_akses_murid_list` dibuat ulang: token sesi
--   `sesi_lokal` menjadi SATU-SATUNYA bukti identitas murid.
--
-- CARA KERJA / ROLLBACK
--   Rollback = jalankan ulang `upgrade_20261028a_sesi_lokal_murid.sql`
--   (blok 3d/3e mengembalikan versi kompatibel). Tidak ada perubahan tabel.
--
-- CATATAN URUTAN (penting!)
--   1) Deploy frontend baru lebih dulu (murid login → dapat `sesi_token`).
--   2) Baru jalankan file ini. Murid yang masih memegang sesi LAMA
--      (`lokal-<uuid>` buatan klien) akan diminta login ulang — itu memang
--      tujuannya: token lama tidak pernah diverifikasi server.
--
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. GATE KETAT (token saja) ==========
create or replace function fn_akses_murid(p_token text, p_nis_fallback text default '')
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis text;
begin
  -- p_nis_fallback SENGAJA diabaikan (dokumentasi: hanya untuk kompatibilitas
  -- tanda tangan fungsi agar RPC fase B tidak perlu diubah).
  v_nis := fn_sesi_valid(p_token);
  return v_nis;   -- NULL = tidak ada sesi valid → RPC menolak
end $$;

-- ========== 2. VERSI MASSAL ==========
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

grant execute on function fn_akses_murid(text, text) to anon, authenticated;
grant execute on function fn_akses_murid_list(text, text[], text) to anon, authenticated;

-- ========== 3. VERIFIKASI & RELOAD CACHE SKEMA POSTGREST ==========
do $$
declare v_hasil text;
begin
  -- Uji klaim tanpa token: HARUS mengembalikan NULL.
  v_hasil := fn_akses_murid('', '__uji_klaim_nis__');
  if v_hasil is not null then
    raise warning 'PERINGATAN: klaim NIS tanpa token MASIH diterima (%). Cek apakah blok 1 benar-benar tereksekusi.', v_hasil;
  else
    raise notice 'INFO: gate sesi ketat aktif — klaim NIS tanpa token ditolak.';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- [83/84] fix_20261029_murid_kanal_absen.sql
-- ============================================================
-- ============================================================
-- FIX 20261029: KANAL ABSEN UNTUK MURID (menu "Absen Mandiri") — 2026-10-29
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG
--   Panel murid **Absen Mandiri** (`renderAbsenMandiriMurid`, web/js/app.js)
--   memuat daftar sesi terbuka lewat `akunDaftarGuru('guru_kanal_absen')` →
--   RPC `ambil_daftar_guru` (entri 70). Fungsi itu memang di-grant ke
--   `anon`/`authenticated`, TETAPI digerbang:
--       if not (fn_is_admin() or fn_is_guru()) then return '[]'::jsonb; end if;
--   Sesi murid tidak lolos gerbang tersebut:
--     * murid password lokal → PostgREST role `anon`, `fn_role()` = '' ;
--     * murid ber-JWT Supabase Auth → `fn_role()` = 'murid'.
--   Akibatnya RPC SELALU membalas `[]` untuk murid, sehingga panel murid
--   menampilkan DUA gejala sekaligus:
--     1) "Tidak Ada Sesi Absen Terbuka" walau guru sudah Kunci Absen → BUKA;
--     2) dropdown **Mapel / Ekstrakurikuler** kosong — pilihannya dibangun dari
--        `sesiGuru` × jadwal kelas (tabel `jadwal_pelajaran`, dibaca murid
--        sebagai anon lewat policy `jadwal_baca_anon`) × ekskul murid.
--
-- ISI
--   Satu RPC baca khusus murid: `ambil_sesi_absen_murid(p_token, p_klaim_nis)`
--   yang mengembalikan HANYA baris guru/admin dengan `kunci_absen = 'BUKA'`
--   dan HANYA kolom yang dipakai panel murid:
--       nis_nip, nama_lengkap, mapel, ekstrakurikuler
--   (kolom `captcha` dan `kunci_absen` SENGAJA tidak dikirim — sejalan dengan
--   komentar "kolom captcha sengaja TIDAK diambil" di app.js.)
--
--   Gerbang identitas (3 jalur sah):
--     * staf (`fn_is_admin()` / `fn_is_guru()`) → boleh (uji/admin);
--     * murid ber-JWT Auth (`fn_role() = 'murid'`) → boleh;
--     * murid password lokal → WAJIB token sesi `sesi_lokal` yang valid
--       (`fn_akses_murid`; token saja sejak `fix_20261028d`).
--   Tanpa salah satunya → `[]` (daftar akun TIDAK bocor ke anon).
--
--   Kenapa fungsi BARU dan bukan melonggarkan `ambil_daftar_guru`? Karena
--   fungsi itu dipakai 9 titik frontend staf (`guru_wali`, `guru_pembina`,
--   `guru_penugasan`, `guru_dashboard`, `penuh`, dst.) — RPC terpisah menjaga
--   jalur staf tidak tersentuh sama sekali.
--
-- ROLLBACK / IDEMPOTENT
--   Rollback: `drop function if exists ambil_sesi_absen_murid(text, text);`
--   Tidak ada perubahan tabel. Aman dijalankan berulang.
-- ============================================================

-- ========== 1. RPC BACA SESI TERBUKA UNTUK MURID ==========
create or replace function ambil_sesi_absen_murid(
  p_token     text default '',
  p_klaim_nis text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_staf boolean := (fn_is_admin() or fn_is_guru());
begin
  -- CATATAN: SENGAJA tanpa penanda `stable` — `fn_akses_murid` memperpanjang
  -- masa sesi (`update sesi_lokal.last_seen`); sama seperti `cek_sesi_absen`
  -- dan `ambil_peta_wajah`.
  if not v_staf then
    -- Salah satu jalur murid harus terpenuhi: JWT Auth berperan 'murid'
    -- (`fn_role()`), ATAU token sesi `sesi_lokal` yang valid. `coalesce`
    -- dipakai sebagai pertahanan bila kelak `fn_role()` berubah mengembalikan
    -- NULL (NULL <> 'murid' = NULL → gerbang bocor).
    if coalesce(fn_role(), '') <> 'murid'
       and fn_akses_murid(p_token, p_klaim_nis) is null then
      return '[]'::jsonb;   -- tidak ada bukti identitas → jangan kembalikan apa pun
    end if;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'nis_nip',         a.nis_nip,
             'nama_lengkap',    a.nama_lengkap,
             'mapel',           coalesce(a.mapel, ''),
             'ekstrakurikuler', coalesce(a.ekstrakurikuler, ''))
           order by a.nama_lengkap)
      from akun a
     where a.tipe in ('guru', 'admin')
       and a.kunci_absen = 'BUKA'
  ), '[]'::jsonb);
end $$;

grant execute on function ambil_sesi_absen_murid(text, text) to anon, authenticated;

-- ========== 2. VERIFIKASI & RELOAD CACHE SKEMA POSTGREST ==========
do $$
declare
  v_jml integer;
  v_ada_grant boolean;
begin
  select count(*) into v_jml
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ambil_sesi_absen_murid';
  if v_jml <> 1 then
    raise warning 'PERINGATAN: % overload ambil_sesi_absen_murid terpasang (harusnya 1) — cek blok 1.', v_jml;
  else
    raise notice 'INFO: ambil_sesi_absen_murid terpasang (1 overload).';
  end if;

  select exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'ambil_sesi_absen_murid'
       and has_function_privilege('anon', p.oid, 'execute')
  ) into v_ada_grant;
  if not v_ada_grant then
    raise warning 'PERINGATAN: anon belum boleh mengeksekusi ambil_sesi_absen_murid — cek blok grant.';
  else
    raise notice 'INFO: grant execute ke anon/authenticated aktif.';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- [84/84] upgrade_20261031_akses_admin_akun_murid.sql
-- ============================================================
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

