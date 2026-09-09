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