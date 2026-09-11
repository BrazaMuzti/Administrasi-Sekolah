-- ============================================================
-- UPGRADE FASE 3 MODUL ADMINISTRASI SEKOLAH — 2026-09-18
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi (4 tabel baru):
--   1) perpus_buku  : katalog buku perpustakaan (kode unik, eksemplar)
--   2) perpus_pinjam: peminjaman buku (snapshot buku & siswa, telat+denda)
--   3) inv_barang   : inventaris sarana prasarana (kode unik, kondisi)
--   4) inv_pinjam   : peminjaman barang (guru/murid/ekskul, kondisi kembali)
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== 1. KATALOG BUKU ==========
create table if not exists perpus_buku (
  id uuid primary key default gen_random_uuid(),
  kode text not null unique,
  judul text not null,
  pengarang text default '',
  penerbit text default '',
  tahun text default '',
  kategori text default 'Lainnya',
  eksemplar int not null default 1,
  lokasi text default '',
  ket text default '',
  aktif boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_perpus_buku_judul on perpus_buku (judul);

-- ========== 2. PEMINJAMAN BUKU ==========
create table if not exists perpus_pinjam (
  id uuid primary key default gen_random_uuid(),
  buku_id uuid,
  kode_buku text default '',
  judul_buku text default '',
  nis text not null,
  nama text default '',
  kelas text default '',
  ta text not null,
  semester text default '',
  tanggal_pinjam date,
  tenggat date,
  tanggal_kembali date,
  hari_telat int default 0,
  denda numeric default 0,
  status text not null default 'Dipinjam',   -- Dipinjam | Kembali
  ket text default '',
  petugas text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_perpus_pinjam_nis on perpus_pinjam (nis, ta);
create index if not exists idx_perpus_pinjam_status on perpus_pinjam (status);

-- ========== 3. INVENTARIS BARANG ==========
create table if not exists inv_barang (
  id uuid primary key default gen_random_uuid(),
  kode text not null unique,
  nama text not null,
  kategori text default 'Lainnya',           -- Elektronik | Perabot | Alat Olahraga | Laboratorium | Buku/ATK | Lainnya
  lokasi text default '',
  jumlah int not null default 1,
  kondisi text default 'Baik' check (kondisi in ('Baik','Rusak Ringan','Rusak Berat')),
  tahun_perolehan text default '',
  harga numeric default 0,
  sumber text default '',                    -- BOS | Komite | Hibah | Pembelian | Lainnya
  ket text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_inv_barang_kat on inv_barang (kategori);

-- ========== 4. PEMINJAMAN BARANG ==========
create table if not exists inv_pinjam (
  id uuid primary key default gen_random_uuid(),
  barang_id uuid,
  kode_barang text default '',
  nama_barang text default '',
  peminjam_tipe text default 'guru',         -- guru | murid | ekskul | lainnya
  peminjam_nama text default '',
  nis text default '',
  jumlah int not null default 1,
  tanggal_pinjam date,
  tanggal_rencana date,
  tanggal_kembali date,
  kondisi_kembali text default '',
  status text not null default 'Dipinjam',   -- Dipinjam | Dikembalikan
  ket text default '',
  petugas text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_inv_pinjam_status on inv_pinjam (status);

-- ========== PRIVILEGE ==========
grant select, insert, update, delete on perpus_buku, perpus_pinjam, inv_barang, inv_pinjam to authenticated;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';