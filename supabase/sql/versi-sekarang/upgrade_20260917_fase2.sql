-- ============================================================
-- UPGRADE FASE 2 MODUL ADMINISTRASI SEKOLAH — 2026-09-17
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi (5 tabel baru):
--   1) poin_kategori : master kategori prestasi/pelanggaran + bobot poin
--   2) poin_siswa    : catatan poin per siswa (snapshot nama & bobot)
--   3) spp_tagihan   : tagihan SPP/Daftar Ulang per siswa per periode
--   4) kas_transaksi : buku kas sekolah (masuk/keluar) + no bukti
--   5) arsip_dokumen : arsip dokumen sekolah berkategori + link
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== 1. KATEGORI POIN ==========
create table if not exists poin_kategori (
  id uuid primary key default gen_random_uuid(),
  jenis text not null check (jenis in ('prestasi','pelanggaran')),
  nama text not null,
  poin int not null default 1,
  ket text default '',
  aktif boolean not null default true,
  created_at timestamptz not null default now(),
  unique (jenis, nama)
);

-- ========== 2. CATATAN POIN SISWA ==========
create table if not exists poin_siswa (
  id uuid primary key default gen_random_uuid(),
  nis text not null,
  nama text default '',
  kelas text default '',
  ta text not null,
  semester text default '',
  tanggal date,
  jenis text not null check (jenis in ('prestasi','pelanggaran')),
  kategori_id uuid,
  kategori_nama text default '',
  poin int not null default 0,
  catatan text default '',
  pelapor text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_poin_siswa_nis_ta on poin_siswa (nis, ta);

-- ========== 3. TAGIHAN SPP ==========
create table if not exists spp_tagihan (
  id uuid primary key default gen_random_uuid(),
  nis text not null,
  nama text default '',
  kelas text default '',
  ta text not null,
  semester text default '',
  jenis text not null default 'SPP',      -- SPP | Daftar Ulang | Lainnya
  periode text not null,                  -- YYYY-MM
  nominal numeric not null default 0,
  jatuh_tempo date,
  lunas boolean not null default false,
  tanggal_bayar date,
  metode text default '',
  petugas text default '',
  no_bukti text default '',
  ket text default '',
  created_at timestamptz not null default now(),
  unique (nis, ta, jenis, periode)
);
create index if not exists idx_spp_tagihan_ta on spp_tagihan (ta, jenis, kelas);

-- ========== 4. BUKU KAS SEKOLAH ==========
create table if not exists kas_transaksi (
  id uuid primary key default gen_random_uuid(),
  ta text not null,
  tanggal date,
  jenis text not null check (jenis in ('Masuk','Keluar')),
  kategori text default 'Lainnya',
  nis text default '',
  nominal numeric not null default 0,
  keterangan text default '',
  petugas text default '',
  no_bukti text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_kas_transaksi_ta on kas_transaksi (ta, jenis, tanggal);

-- ========== 5. ARSIP DOKUMEN SEKOLAH ==========
create table if not exists arsip_dokumen (
  id uuid primary key default gen_random_uuid(),
  ta text not null,
  kategori text default 'Lainnya',
  judul text not null,
  deskripsi text default '',
  link_url text default '',
  tanggal date,
  dibuat_oleh text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_arsip_dokumen_ta on arsip_dokumen (ta, kategori);

-- ========== PRIVILEGE ==========
grant select, insert, update, delete on poin_kategori, poin_siswa, spp_tagihan, kas_transaksi, arsip_dokumen to authenticated;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';