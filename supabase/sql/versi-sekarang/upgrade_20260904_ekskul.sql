-- ============================================================
-- UPGRADE EKSTRAKURIKULER — 2026-09-04
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) Tabel ekstrakurikuler: tambah pembina_nip & jadwal
--   2) Tabel agenda_ekskul (agenda kegiatan per ekskul)
--   3) Tabel dispensasi (riwayat surat dispensasi)
--   4) RLS & privilege (guru/admin = authenticated)
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. TABEL EKSTRAKURIKULER ==========
alter table ekstrakurikuler
  add column if not exists pembina_nip text default '',
  add column if not exists jadwal text default '';

alter table ekstrakurikuler enable row level security;

drop policy if exists "ekskul_baca_auth" on ekstrakurikuler;
create policy "ekskul_baca_auth" on ekstrakurikuler
  for select to authenticated using (true);

drop policy if exists "ekskul_baca_anon" on ekstrakurikuler;
create policy "ekskul_baca_anon" on ekstrakurikuler
  for select to anon using (true);

drop policy if exists "ekskul_tulis_auth" on ekstrakurikuler;
create policy "ekskul_tulis_auth" on ekstrakurikuler
  for insert to authenticated with check (true);

drop policy if exists "ekskul_ubah_auth" on ekstrakurikuler;
create policy "ekskul_ubah_auth" on ekstrakurikuler
  for update to authenticated using (true) with check (true);

drop policy if exists "ekskul_hapus_auth" on ekstrakurikuler;
create policy "ekskul_hapus_auth" on ekstrakurikuler
  for delete to authenticated using (true);

revoke all on table ekstrakurikuler from anon, authenticated;
grant select on ekstrakurikuler to anon, authenticated;
grant insert, update, delete on ekstrakurikuler to authenticated;

-- ========== 2. AGENDA KEGIATAN EKSKUL ==========
create table if not exists agenda_ekskul (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  tanggal date not null,
  kegiatan text not null,
  keterangan text default '',
  dibuat_oleh text default '',
  created_at timestamptz not null default now(),
  unique (ekskul, tanggal, kegiatan)
);
create index if not exists idx_agenda_ekskul on agenda_ekskul (ekskul, tanggal);

alter table agenda_ekskul enable row level security;

drop policy if exists "agenda_baca_auth" on agenda_ekskul;
create policy "agenda_baca_auth" on agenda_ekskul
  for select to authenticated using (true);

drop policy if exists "agenda_tulis_auth" on agenda_ekskul;
create policy "agenda_tulis_auth" on agenda_ekskul
  for insert to authenticated with check (true);

drop policy if exists "agenda_ubah_auth" on agenda_ekskul;
create policy "agenda_ubah_auth" on agenda_ekskul
  for update to authenticated using (true) with check (true);

drop policy if exists "agenda_hapus_auth" on agenda_ekskul;
create policy "agenda_hapus_auth" on agenda_ekskul
  for delete to authenticated using (true);

revoke all on table agenda_ekskul from anon, authenticated;
grant select, insert, update, delete on agenda_ekskul to authenticated;

-- ========== 3. RIWAYAT SURAT DISPENSASI ==========
create table if not exists dispensasi (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  nis text not null,
  nama text default '',
  kelas text default '',
  tanggal_izin date not null,
  alasan text default '',
  dibuat_oleh text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_dispensasi_ekskul on dispensasi (ekskul, tanggal_izin);

alter table dispensasi enable row level security;

drop policy if exists "dispensasi_baca_auth" on dispensasi;
create policy "dispensasi_baca_auth" on dispensasi
  for select to authenticated using (true);

drop policy if exists "dispensasi_tulis_auth" on dispensasi;
create policy "dispensasi_tulis_auth" on dispensasi
  for insert to authenticated with check (true);

drop policy if exists "dispensasi_hapus_auth" on dispensasi;
create policy "dispensasi_hapus_auth" on dispensasi
  for delete to authenticated using (true);

revoke all on table dispensasi from anon, authenticated;
grant select, insert, delete on dispensasi to authenticated;

-- ========== 4. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';