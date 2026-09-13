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
