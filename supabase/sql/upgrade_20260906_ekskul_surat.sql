-- ============================================================
-- UPGRADE EKSTRAKURIKULER — SURAT DISPENSASI & SUB-EKSKUL — 2026-09-06
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) ekstrakurikuler: kolom logo_url
--   2) dispensasi: kolom sub_ekskul, keterangan, detail (jsonb), surat_id
--   3) Tabel sub_ekstrakurikuler (daftar sub per ekskul)
--   4) Tabel anggota_sub_ekskul (penandaan sub per anggota)
--   5) Tabel preset_dispensasi (preset surat per ekskul / global)
--   6) RLS & privilege (guru/admin/pengurus; anon = murid password lokal)
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. LOGO EKSKUL ==========
alter table ekstrakurikuler
  add column if not exists logo_url text default '';

-- ========== 2. TAMBAHAN KOLOM DISPENSASI ==========
alter table dispensasi
  add column if not exists sub_ekskul text default '',
  add column if not exists keterangan text default '',
  add column if not exists detail jsonb default '{}'::jsonb,
  add column if not exists surat_id text default '';
create index if not exists idx_dispensasi_surat on dispensasi (surat_id);

-- ========== 3. SUB-EKSTRAKURIKULER ==========
create table if not exists sub_ekstrakurikuler (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  nama_sub text not null,
  urutan int default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ekskul, nama_sub)
);
create index if not exists idx_sub_ekskul on sub_ekstrakurikuler (ekskul);

alter table sub_ekstrakurikuler enable row level security;

drop policy if exists "subekskul_baca_auth" on sub_ekstrakurikuler;
create policy "subekskul_baca_auth" on sub_ekstrakurikuler
  for select to authenticated using (true);
drop policy if exists "subekskul_tulis_auth" on sub_ekstrakurikuler;
create policy "subekskul_tulis_auth" on sub_ekstrakurikuler
  for insert to authenticated with check (true);
drop policy if exists "subekskul_ubah_auth" on sub_ekstrakurikuler;
create policy "subekskul_ubah_auth" on sub_ekstrakurikuler
  for update to authenticated using (true) with check (true);
drop policy if exists "subekskul_hapus_auth" on sub_ekstrakurikuler;
create policy "subekskul_hapus_auth" on sub_ekstrakurikuler
  for delete to authenticated using (true);
drop policy if exists "subekskul_baca_anon" on sub_ekstrakurikuler;
create policy "subekskul_baca_anon" on sub_ekstrakurikuler
  for select to anon using (true);

revoke all on table sub_ekstrakurikuler from anon, authenticated;
grant select on sub_ekstrakurikuler to anon, authenticated;
grant insert, update, delete on sub_ekstrakurikuler to authenticated;

-- ========== 4. KEANGGOTAAN SUB-EKSKUL ==========
create table if not exists anggota_sub_ekskul (
  id uuid primary key default gen_random_uuid(),
  nis text not null,
  ekskul text not null,
  sub text default '',
  updated_at timestamptz not null default now(),
  unique (nis, ekskul)
);
create index if not exists idx_anggota_sub on anggota_sub_ekskul (ekskul, sub);

alter table anggota_sub_ekskul enable row level security;

drop policy if exists "angsub_baca_auth" on anggota_sub_ekskul;
create policy "angsub_baca_auth" on anggota_sub_ekskul
  for select to authenticated using (true);
drop policy if exists "angsub_tulis_auth" on anggota_sub_ekskul;
create policy "angsub_tulis_auth" on anggota_sub_ekskul
  for insert to authenticated with check (true);
drop policy if exists "angsub_ubah_auth" on anggota_sub_ekskul;
create policy "angsub_ubah_auth" on anggota_sub_ekskul
  for update to authenticated using (true) with check (true);
drop policy if exists "angsub_hapus_auth" on anggota_sub_ekskul;
create policy "angsub_hapus_auth" on anggota_sub_ekskul
  for delete to authenticated using (true);
-- Pengurus ekskul (murid password lokal) memakai anon key — pola 20260905
drop policy if exists "angsub_baca_anon" on anggota_sub_ekskul;
create policy "angsub_baca_anon" on anggota_sub_ekskul
  for select to anon using (true);
drop policy if exists "angsub_tulis_anon" on anggota_sub_ekskul;
create policy "angsub_tulis_anon" on anggota_sub_ekskul
  for insert to anon with check (true);
drop policy if exists "angsub_ubah_anon" on anggota_sub_ekskul;
create policy "angsub_ubah_anon" on anggota_sub_ekskul
  for update to anon using (true) with check (true);
drop policy if exists "angsub_hapus_anon" on anggota_sub_ekskul;
create policy "angsub_hapus_anon" on anggota_sub_ekskul
  for delete to anon using (true);

revoke all on table anggota_sub_ekskul from anon, authenticated;
grant select, insert, update, delete on anggota_sub_ekskul to authenticated;
grant select, insert, update, delete on anggota_sub_ekskul to anon;

-- ========== 5. PRESET SURAT DISPENSASI ==========
create table if not exists preset_dispensasi (
  id uuid primary key default gen_random_uuid(),
  ekskul text default '',
  nama_preset text not null,
  isi jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ekskul, nama_preset)
);
create index if not exists idx_preset_disp on preset_dispensasi (ekskul);

alter table preset_dispensasi enable row level security;

drop policy if exists "preset_baca_auth" on preset_dispensasi;
create policy "preset_baca_auth" on preset_dispensasi
  for select to authenticated using (true);
drop policy if exists "preset_tulis_auth" on preset_dispensasi;
create policy "preset_tulis_auth" on preset_dispensasi
  for insert to authenticated with check (true);
drop policy if exists "preset_ubah_auth" on preset_dispensasi;
create policy "preset_ubah_auth" on preset_dispensasi
  for update to authenticated using (true) with check (true);
drop policy if exists "preset_hapus_auth" on preset_dispensasi;
create policy "preset_hapus_auth" on preset_dispensasi
  for delete to authenticated using (true);

revoke all on table preset_dispensasi from anon, authenticated;
grant select, insert, update, delete on preset_dispensasi to authenticated;

-- ========== 6. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';
