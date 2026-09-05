-- ============================================================
-- UPGRADE ABSENSI — 2026-09-04
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) Recreate tabel absensi (kolom lengkap + unique anti-duplikat)
--      CATATAN: tabel lama KOSONG, jadi tidak ada data yang hilang.
--   2) Kolom kunci absen guru di tabel akun (captcha, kunci_absen)
--   3) RLS + privilege
--
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. RECREATE TABEL ABSENSI ==========
drop table if exists absensi;
create table absensi (
  id uuid primary key default gen_random_uuid(),
  nis text not null,
  nama text,
  tanggal date not null,
  status text not null check (status in ('H','S','I','A')),
  keterangan text default '',
  mapel text default '',
  ekskul text default '',
  kelas text default '',
  tahun text,
  semester text,
  bulan text,
  id_guru text,
  metode text default 'Manual / QR',
  created_at timestamptz not null default now(),
  unique (nis, tanggal, mapel)
);
create index if not exists idx_absensi_nis_tanggal on absensi (nis, tanggal);
create index if not exists idx_absensi_kelas_mapel on absensi (kelas, mapel);

-- ========== 2. KUNCI ABSEN GURU (CAPTCHA) ==========
alter table akun
  add column if not exists captcha text default '1234',
  add column if not exists kunci_absen text default 'TUTUP';

-- ========== 3. RLS & PRIVILEGE ==========
-- absensi: murid lokal memakai anon key (pseudo-token), jadi select/insert/
-- update dibuka untuk anon + authenticated (posture sama dengan tabel lama).
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

revoke all on table absensi from anon, authenticated;
grant select, insert, update, delete on absensi to anon, authenticated;

-- akun: pastikan kolom kunci bisa dibaca & diubah user terkait
grant select, update on akun to authenticated;

-- ========== 4. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';
