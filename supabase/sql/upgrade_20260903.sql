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
