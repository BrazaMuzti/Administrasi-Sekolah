-- ============================================================
-- UPGRADE: ADMINISTRASI GURU LAINNYA — 2026-09-09
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Isi:
--   1) ALTER jurnal_guru  : + hari, jam_ke, pencapaian (Kegiatan Harian Guru)
--   2) remedial_pelaksanaan : Format Pelaksanaan Perbaikan dan Pengayaan
--   3) remedial_program     : Program Remedial/Pengayaan per KI/KD
--   4) bimbingan_penyuluhan : Lembar Bimbingan Penyuluhan (BK)
--   5) kunjungan_supervisi  : Lembar Kunjungan Kelas Supervisi
--   6) dokumen_guru         : Dokumen/link milik guru (opsi dibagikan)
--
-- Kepemilikan data: kolom nip_guru / pemilik_nip; scoping akses diberlakukan
-- di UI (guru = miliknya + yang dibagikan; admin = semua).
-- RLS: guru/admin (authenticated) boleh baca/tulis.
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1) JURNAL GURU: kolom kegiatan harian ==========
alter table jurnal_guru add column if not exists hari text default '';
alter table jurnal_guru add column if not exists jam_ke text default '';
alter table jurnal_guru add column if not exists pencapaian text default '';

-- ========== 2) REMEDIAL: FORMAT PELAKSANAAN ==========
create table if not exists remedial_pelaksanaan (
  id uuid primary key default gen_random_uuid(),
  tahun text not null,
  semester text default 'Ganjil',
  kelas text default '',
  mapel text default '',
  bentuk_evaluasi text default '',
  tanggal_pelaksanaan date,
  ki_kd text default '',
  program text default 'Perbaikan',
  jumlah_siswa int,
  tindakan text default '',
  hasil text default 'TUNTAS',
  nip_guru text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_rem_pelaksanaan_tahun
  on remedial_pelaksanaan (tahun, semester, kelas);

-- ========== 3) REMEDIAL: PROGRAM ==========
create table if not exists remedial_program (
  id uuid primary key default gen_random_uuid(),
  tahun text default '',
  semester text default 'Ganjil',
  kelas text default '',
  mapel text default '',
  ki_cp text default '',
  kd_tp text default '',
  ketercapaian text default '',
  tindak_lanjut text default 'Remedial Tes',
  nip_guru text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_rem_program_tahun
  on remedial_program (tahun, semester, kelas, mapel);

-- ========== 4) BIMBINGAN PENYULUHAN ==========
create table if not exists bimbingan_penyuluhan (
  id uuid primary key default gen_random_uuid(),
  tahun text default '',
  semester text default 'Ganjil',
  hari text default '',
  tanggal date,
  nama_siswa text default '',
  nis text default '',
  kelas text default '',
  mapel text default '',
  masalah text default '',
  jenis_bimbingan text default 'Pelajaran - Individu',
  tindak_lanjut text default '',
  nip_guru text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_bimbingan_tahun
  on bimbingan_penyuluhan (tahun, tanggal);

-- ========== 5) KUNJUNGAN KELAS SUPERVISI ==========
create table if not exists kunjungan_supervisi (
  id uuid primary key default gen_random_uuid(),
  tahun text default '',
  semester text default 'Ganjil',
  hari text default '',
  tanggal date,
  nama_guru text default '',
  jabatan text default '',
  nip text default '',
  kelas text default '',
  maksud text default '',
  kesan text default '',
  pesan text default '',
  tanda_tangan text default '',
  keterangan text default '',
  nip_pencatat text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_supervisi_tahun
  on kunjungan_supervisi (tahun, tanggal);

-- ========== 6) DOKUMEN LAINNYA (LINK EKSTERNAL) ==========
create table if not exists dokumen_guru (
  id uuid primary key default gen_random_uuid(),
  judul text not null,
  jenis text default 'Dokumen',
  url text not null default '',
  keterangan text default '',
  pemilik_nip text default '',
  pemilik_nama text default '',
  dibagikan boolean not null default false,
  tahun text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_dokumen_pemilik
  on dokumen_guru (pemilik_nip, tahun);

-- ========== RLS SEMUA TABEL ==========
alter table remedial_pelaksanaan enable row level security;
alter table remedial_program enable row level security;
alter table bimbingan_penyuluhan enable row level security;
alter table kunjungan_supervisi enable row level security;
alter table dokumen_guru enable row level security;

drop policy if exists "adm_baca_auth" on remedial_pelaksanaan;
create policy "adm_baca_auth" on remedial_pelaksanaan
  for select to authenticated using (true);
drop policy if exists "adm_tulis_auth" on remedial_pelaksanaan;
create policy "adm_tulis_auth" on remedial_pelaksanaan
  for insert to authenticated with check (true);
drop policy if exists "adm_ubah_auth" on remedial_pelaksanaan;
create policy "adm_ubah_auth" on remedial_pelaksanaan
  for update to authenticated using (true) with check (true);
drop policy if exists "adm_hapus_auth" on remedial_pelaksanaan;
create policy "adm_hapus_auth" on remedial_pelaksanaan
  for delete to authenticated using (true);

drop policy if exists "rmp_baca_auth" on remedial_program;
create policy "rmp_baca_auth" on remedial_program
  for select to authenticated using (true);
drop policy if exists "rmp_tulis_auth" on remedial_program;
create policy "rmp_tulis_auth" on remedial_program
  for insert to authenticated with check (true);
drop policy if exists "rmp_ubah_auth" on remedial_program;
create policy "rmp_ubah_auth" on remedial_program
  for update to authenticated using (true) with check (true);
drop policy if exists "rmp_hapus_auth" on remedial_program;
create policy "rmp_hapus_auth" on remedial_program
  for delete to authenticated using (true);

drop policy if exists "bpb_baca_auth" on bimbingan_penyuluhan;
create policy "bpb_baca_auth" on bimbingan_penyuluhan
  for select to authenticated using (true);
drop policy if exists "bpb_tulis_auth" on bimbingan_penyuluhan;
create policy "bpb_tulis_auth" on bimbingan_penyuluhan
  for insert to authenticated with check (true);
drop policy if exists "bpb_ubah_auth" on bimbingan_penyuluhan;
create policy "bpb_ubah_auth" on bimbingan_penyuluhan
  for update to authenticated using (true) with check (true);
drop policy if exists "bpb_hapus_auth" on bimbingan_penyuluhan;
create policy "bpb_hapus_auth" on bimbingan_penyuluhan
  for delete to authenticated using (true);

drop policy if exists "ksp_baca_auth" on kunjungan_supervisi;
create policy "ksp_baca_auth" on kunjungan_supervisi
  for select to authenticated using (true);
drop policy if exists "ksp_tulis_auth" on kunjungan_supervisi;
create policy "ksp_tulis_auth" on kunjungan_supervisi
  for insert to authenticated with check (true);
drop policy if exists "ksp_ubah_auth" on kunjungan_supervisi;
create policy "ksp_ubah_auth" on kunjungan_supervisi
  for update to authenticated using (true) with check (true);
drop policy if exists "ksp_hapus_auth" on kunjungan_supervisi;
create policy "ksp_hapus_auth" on kunjungan_supervisi
  for delete to authenticated using (true);

drop policy if exists "dkm_baca_auth" on dokumen_guru;
create policy "dkm_baca_auth" on dokumen_guru
  for select to authenticated using (true);
drop policy if exists "dkm_tulis_auth" on dokumen_guru;
create policy "dkm_tulis_auth" on dokumen_guru
  for insert to authenticated with check (true);
drop policy if exists "dkm_ubah_auth" on dokumen_guru;
create policy "dkm_ubah_auth" on dokumen_guru
  for update to authenticated using (true) with check (true);
drop policy if exists "dkm_hapus_auth" on dokumen_guru;
create policy "dkm_hapus_auth" on dokumen_guru
  for delete to authenticated using (true);

revoke all on table remedial_pelaksanaan from anon, authenticated;
grant select, insert, update, delete on remedial_pelaksanaan to authenticated;
revoke all on table remedial_program from anon, authenticated;
grant select, insert, update, delete on remedial_program to authenticated;
revoke all on table bimbingan_penyuluhan from anon, authenticated;
grant select, insert, update, delete on bimbingan_penyuluhan to authenticated;
revoke all on table kunjungan_supervisi from anon, authenticated;
grant select, insert, update, delete on kunjungan_supervisi to authenticated;
revoke all on table dokumen_guru from anon, authenticated;
grant select, insert, update, delete on dokumen_guru to authenticated;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';