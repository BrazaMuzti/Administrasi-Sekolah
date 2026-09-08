-- ============================================================
-- UPGRADE: KALENDER PENDIDIKAN — 2026-09-08
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi: tabel kalender_pendidikan (event libur/kegiatan per tahun pelajaran).
--
-- tipe: libur | libur_siswa | awal_masuk | sumatif | rapor | budi_pekerti | custom
--   - libur & libur_siswa ikut mengunci absensi (Hadir Tatap Muka);
--   - kategori lain hanya penanda warna/tooltip.
-- tanggal_sampai: null/sama = acara satu hari; rentang dipecah per hari di aplikasi.
-- semester: 'Ganjil' | 'Genap' (tabel data dibagi per semester).
-- RLS: guru/admin (authenticated) boleh baca/tulis.
-- Idempotent — aman dijalankan berulang.
-- ============================================================

create table if not exists kalender_pendidikan (
  id uuid primary key default gen_random_uuid(),
  tahun text not null,
  semester text not null default 'Ganjil',
  tipe text not null default 'custom',
  tanggal_mulai date not null,
  tanggal_sampai date,
  nama text not null,
  keterangan text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_kalender_tahun_tgl
  on kalender_pendidikan (tahun, tanggal_mulai);

alter table kalender_pendidikan enable row level security;

drop policy if exists "kalender_baca_auth" on kalender_pendidikan;
create policy "kalender_baca_auth" on kalender_pendidikan
  for select to authenticated using (true);

drop policy if exists "kalender_tulis_auth" on kalender_pendidikan;
create policy "kalender_tulis_auth" on kalender_pendidikan
  for insert to authenticated with check (true);

drop policy if exists "kalender_update_auth" on kalender_pendidikan;
create policy "kalender_update_auth" on kalender_pendidikan
  for update to authenticated using (true) with check (true);

drop policy if exists "kalender_hapus_auth" on kalender_pendidikan;
create policy "kalender_hapus_auth" on kalender_pendidikan
  for delete to authenticated using (true);
