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
