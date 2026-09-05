-- ============================================================
-- UPGRADE INPUT NILAI — 2026-09-04
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) Recreate tabel nilai (JSONB per siswa per kategori per mapel)
--      CATATAN: tabel lama KOSONG, tidak ada data yang hilang.
--      Kolom dinamis (KD A 1, Prak A 1, Projek A, KET, dst.) disimpan
--      di kolom `data` (JSONB) — mengikuti konfigurasi tiap kategori.
--   2) Tabel nilai_konfigurasi (konfigurasi KD/bobot per kategori+mapel)
--   3) RLS + privilege (guru/admin = authenticated)
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. RECREATE TABEL NILAI ==========
drop table if exists nilai;
create table nilai (
  id uuid primary key default gen_random_uuid(),
  nis text not null,
  nama text default '',
  kategori text not null,
  mapel text not null default '',
  ekskul text not null default '',
  kelas text default '',
  tahun text default '',
  semester text default '',
  id_guru text default '',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (nis, kategori, mapel, ekskul, tahun, semester)
);
create index if not exists idx_nilai_filter
  on nilai (kategori, mapel, kelas, tahun, semester);

-- ========== 2. TABEL KONFIGURASI NILAI ==========
create table if not exists nilai_konfigurasi (
  id uuid primary key default gen_random_uuid(),
  kategori text not null,
  mapel text not null default '',
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (kategori, mapel)
);

-- ========== 3. RLS & PRIVILEGE ==========
alter table nilai enable row level security;

drop policy if exists "nilai_baca_auth" on nilai;
create policy "nilai_baca_auth" on nilai
  for select to authenticated using (true);

drop policy if exists "nilai_tulis_auth" on nilai;
create policy "nilai_tulis_auth" on nilai
  for insert to authenticated with check (true);

drop policy if exists "nilai_ubah_auth" on nilai;
create policy "nilai_ubah_auth" on nilai
  for update to authenticated using (true) with check (true);

alter table nilai_konfigurasi enable row level security;

drop policy if exists "nilaikfg_baca_auth" on nilai_konfigurasi;
create policy "nilaikfg_baca_auth" on nilai_konfigurasi
  for select to authenticated using (true);

drop policy if exists "nilaikfg_tulis_auth" on nilai_konfigurasi;
create policy "nilaikfg_tulis_auth" on nilai_konfigurasi
  for insert to authenticated with check (true);

drop policy if exists "nilaikfg_ubah_auth" on nilai_konfigurasi;
create policy "nilaikfg_ubah_auth" on nilai_konfigurasi
  for update to authenticated using (true) with check (true);

revoke all on table nilai from anon, authenticated;
grant select, insert, update, delete on nilai to authenticated;
revoke all on table nilai_konfigurasi from anon, authenticated;
grant select, insert, update, delete on nilai_konfigurasi to authenticated;

-- ========== 4. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';