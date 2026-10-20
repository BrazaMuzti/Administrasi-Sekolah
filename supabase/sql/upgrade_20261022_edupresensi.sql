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