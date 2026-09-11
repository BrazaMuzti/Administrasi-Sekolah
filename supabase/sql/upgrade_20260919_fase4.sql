-- ============================================================
-- UPGRADE FASE 4 MODUL ADMINISTRASI SEKOLAH — 2026-09-19
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi (1 tabel baru):
--   ppdb_calon : calon peserta didik baru (PPDB) — pendaftaran, seleksi
--                bertahap (Baru→Verifikasi→Diterima/Ditolak), konversi
--                ke akun murid via RPC buat_akun_murid
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== CALON SISWA PPDB ==========
create table if not exists ppdb_calon (
  id uuid primary key default gen_random_uuid(),
  ta text not null,                        -- tahun pelajaran tujuan
  no_daftar text not null unique,          -- PDB-001/2027/2028
  nama text not null,
  nisn text default '',
  jenis_kelamin text default '',           -- L | P
  tempat_lahir text default '',
  tgl_lahir date,
  agama text default '',
  asal_sekolah text default '',
  alamat text default '',
  telepon text default '',
  nama_ayah text default '',
  pekerjaan_ayah text default '',
  nama_ibu text default '',
  pekerjaan_ibu text default '',
  nama_wali text default '',
  jalur text default 'Reguler',            -- Reguler | Prestasi | Afirmasi | Mutasi
  status text not null default 'Baru' check (status in ('Baru','Verifikasi','Diterima','Ditolak')),
  catatan text default '',
  berkas_link text default '',
  nis text default '',                     -- diisi saat konversi akun
  akun_dibuat boolean not null default false,
  tanggal_daftar date,
  dibuat_oleh text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_ppdb_calon_ta on ppdb_calon (ta, status);

-- ========== PRIVILEGE ==========
grant select, insert, update, delete on ppdb_calon to authenticated;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';