-- ============================================================
-- UPGRADE: JURNAL HARIAN GURU — 2026-09-04
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi: tabel jurnal_guru (agenda mengajar per pertemuan).
--
-- unique (nis_guru, kelas, mapel, tahun, pertemuan):
--   - Pertemuan otomatis melanjutkan, tetap bisa diedit tanpa duplikat.
-- RLS: guru/admin (authenticated) boleh baca/tulis.
-- Idempotent — aman dijalankan berulang.
-- ============================================================

create table if not exists jurnal_guru (
  id uuid primary key default gen_random_uuid(),
  nis_guru text not null,
  tanggal date not null,
  kelas text not null,
  mapel text not null,
  pertemuan int not null default 1,
  tahun text,
  semester text,
  bulan text,
  kompetensi_dasar text default '',
  materi text default '',
  kegiatan_kbm text default '',
  permasalahan text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (nis_guru, kelas, mapel, tahun, pertemuan)
);
create index if not exists idx_jurnal_guru_pertemuan
  on jurnal_guru (nis_guru, kelas, mapel, tahun);

alter table jurnal_guru enable row level security;

drop policy if exists "jurnal_baca_auth" on jurnal_guru;
create policy "jurnal_baca_auth" on jurnal_guru
  for select to authenticated using (true);

drop policy if exists "jurnal_tulis_auth" on jurnal_guru;
create policy "jurnal_tulis_auth" on jurnal_guru
  for insert to authenticated with check (true);

drop policy if exists "jurnal_ubah_auth" on jurnal_guru;
create policy "jurnal_ubah_auth" on jurnal_guru
  for update to authenticated using (true) with check (true);

revoke all on table jurnal_guru from anon, authenticated;
grant select, insert, update, delete on jurnal_guru to authenticated;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';
