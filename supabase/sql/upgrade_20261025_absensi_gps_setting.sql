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
