-- ============================================================
-- UPGRADE FASE 1 MODUL ADMINISTRASI SEKOLAH — 2026-09-16
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi (4 tabel baru):
--   1) jadwal_ujian  : jadwal ujian per TA/semester/kelas (sumber kartu ujian)
--   2) pengumuman    : pengumuman sekolah ber-target (widget dashboard)
--   3) rapor_catatan : catatan wali kelas per siswa per TA + semester
--   4) arsip_surat   : arsip surat keterangan (generator surat resmi)
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== 1. JADWAL UJIAN ==========
create table if not exists jadwal_ujian (
  id uuid primary key default gen_random_uuid(),
  ta text not null,
  semester text default 'Ganjil',
  jenis text not null,
  tanggal date,
  jam_mulai text default '',
  jam_selesai text default '',
  kelas text default '',
  mapel text default '',
  pengawas text default '',
  ket text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_jadwal_ujian_ta on jadwal_ujian (ta, jenis, kelas);

-- ========== 2. PENGUMUMAN ==========
create table if not exists pengumuman (
  id uuid primary key default gen_random_uuid(),
  ta text not null,
  judul text not null,
  isi text default '',
  target text not null default 'semua',   -- semua | guru | murid | kelas
  kelas text default '',
  mulai date,
  akhir date,
  penulis text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_pengumuman_ta on pengumuman (ta);

-- ========== 3. CATATAN WALI KELAS (RAPOR) ==========
create table if not exists rapor_catatan (
  id uuid primary key default gen_random_uuid(),
  nis text not null,
  ta text not null,
  semester text not null,
  catatan text default '',
  updated_at timestamptz not null default now(),
  unique (nis, ta, semester)
);

-- ========== 4. ARSIP SURAT ==========
create table if not exists arsip_surat (
  id uuid primary key default gen_random_uuid(),
  ta text not null,
  jenis text not null,
  nomor_surat text not null,
  nis text default '',
  nama text default '',
  kelas text default '',
  payload jsonb default '{}'::jsonb,
  dibuat_oleh text default '',
  dibuat_at timestamptz not null default now()
);
create index if not exists idx_arsip_surat_jenis on arsip_surat (jenis, ta);

-- ========== PRIVILEGE ==========
grant select, insert, update, delete on jadwal_ujian, pengumuman, rapor_catatan, arsip_surat to authenticated;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';