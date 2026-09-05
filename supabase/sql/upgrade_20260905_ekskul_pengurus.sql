-- ============================================================
-- UPGRADE EKSTRAKURIKULER (LANJUTAN) — 2026-09-05
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) agenda_ekskul: kolom "hari" untuk jadwal berulang
--      (Setiap Hari Senin-Minggu); tanggal boleh NULL
--   2) Akses pengurus ekskul (murid): murid password lokal memakai
--      anon key (pola sama dengan tabel absensi), sehingga:
--      - agenda_ekskul  : select/insert/update untuk anon
--      - dispensasi     : select/insert untuk anon
--      - akun           : update kolom "ekstrakurikuler" saja (kolom-level)
--
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== 1. KOLOM HARI AGENDA ==========
alter table agenda_ekskul
  add column if not exists hari text default '';

alter table agenda_ekskul alter column tanggal drop not null;

-- ========== 2. GRANT & POLICY ANON (PENGURUS EKSKUL) ==========
-- agenda_ekskul
revoke all on table agenda_ekskul from anon;
grant select, insert, update on agenda_ekskul to anon;

drop policy if exists "agenda_baca_anon" on agenda_ekskul;
create policy "agenda_baca_anon" on agenda_ekskul
  for select to anon using (true);

drop policy if exists "agenda_tulis_anon" on agenda_ekskul;
create policy "agenda_tulis_anon" on agenda_ekskul
  for insert to anon with check (true);

drop policy if exists "agenda_ubah_anon" on agenda_ekskul;
create policy "agenda_ubah_anon" on agenda_ekskul
  for update to anon using (true) with check (true);

-- dispensasi
revoke all on table dispensasi from anon;
grant select, insert on dispensasi to anon;

drop policy if exists "dispensasi_baca_anon" on dispensasi;
create policy "dispensasi_baca_anon" on dispensasi
  for select to anon using (true);

drop policy if exists "dispensasi_tulis_anon" on dispensasi;
create policy "dispensasi_tulis_anon" on dispensasi
  for insert to anon with check (true);

-- akun: anon hanya boleh mengubah kolom keanggotaan ekskul (kolom-level)
grant update (ekstrakurikuler) on akun to anon;

-- ========== 3. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';
