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
