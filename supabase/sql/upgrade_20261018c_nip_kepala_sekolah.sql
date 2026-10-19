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