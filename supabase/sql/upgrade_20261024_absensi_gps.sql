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
