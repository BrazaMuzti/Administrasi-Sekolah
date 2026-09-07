-- ============================================================
-- UPGRADE EKSTRAKURIKULER — SURAT DISPENSASI v2 — 2026-09-06
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) sub_ekstrakurikuler: kolom "anggota" (JSONB array NIS) —
--      keanggotaan sub digabung ke SATU tabel
--   2) Migrasi data dari anggota_sub_ekskul → sub_ekstrakurikuler.anggota
--   3) Drop tabel anggota_sub_ekskul (tidak lagi dipakai)
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. KOLOM ANGOTA PADA SUB-EKSKUL ==========
alter table sub_ekstrakurikuler
  add column if not exists anggota jsonb not null default '[]'::jsonb;

-- ========== 2. MIGRASI DATA KEANGGOTAAN LAMA ==========
-- Masukkan NIS dari anggota_sub_ekskul ke array anggota baris sub yang cocok
-- (hanya bila kolom anggota masih kosong — idempoten).
update sub_ekstrakurikuler s
set anggota = sub.anggota
from (
  select ekskul, nama_sub, jsonb_agg(distinct nis order by nis) as anggota
  from anggota_sub_ekskul
  where coalesce(sub, '') <> ''
  group by ekskul, nama_sub
) sub
where s.ekskul = sub.ekskul
  and s.nama_sub = sub.nama_sub
  and coalesce(s.anggota, '[]'::jsonb) = '[]'::jsonb;

-- ========== 3. DROP TABEL LAMA ==========
drop table if exists anggota_sub_ekskul;

-- ========== 4. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';
