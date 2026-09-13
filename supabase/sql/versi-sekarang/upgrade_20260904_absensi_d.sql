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
