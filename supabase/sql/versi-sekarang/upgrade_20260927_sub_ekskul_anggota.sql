-- ============================================================
-- UPGRADE: SUB-EKSTRAKURIKULER KOLOM ANGGOTA (PERBAIKAN SIMPAN) — 2026-09-27
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Simpan Sub-Ekstrakurikuler gagal dengan error
--   "Could not find the 'anggota' column of 'sub_ekstrakurikuler'
--    in the schema cache" (PGRST204).
--   Penyebab: kolom "anggota" dibuat oleh upgrade_20260906_ekskul_surat_v2.sql
--   yang (a) belum terjalankan, atau (b) gagal di tengah run karena jebakan
--   re-run: langkah migrasi datanya membaca tabel anggota_sub_ekskul yang
--   sudah di-drop pada run sebelumnya → SQL Editor membatalkan seluruh run.
--
-- Isi (semua idempotent — aman dijalankan berulang):
--   1) sub_ekstrakurikuler: kolom "anggota" (jsonb, default '[]')
--   2) Migrasi data dari anggota_sub_ekskul → sub_ekstrakurikuler.anggota
--      DIJAGA to_regclass (aman walau tabel lama sudah terhapus)
--   3) Drop tabel anggota_sub_ekskul (tidak lagi dipakai)
--   4) Self-healing kolom fitur ekskul & surat (cegah PGRST204 serupa):
--      ekstrakurikuler (pembina_nip, jadwal, logo_url),
--      dispensasi (sub_ekskul, keterangan, detail, surat_id),
--      agenda_ekskul (hari + tanggal boleh NULL)
--   5) Reload cache skema PostgREST
--
-- Catatan: akses anon untuk pengurus ekskul murid ada di
--   upgrade_20260926_ekskul_akses_guru.sql — bila fitur pengurus murid
--   menyimpan sub/nilai/error "permission denied", jalankan file itu juga.
-- ============================================================

-- ========== 1. KOLOM ANGGOTA PADA SUB-EKSKUL ==========
alter table sub_ekstrakurikuler
  add column if not exists anggota jsonb not null default '[]'::jsonb;

-- ========== 2. MIGRASI DATA KEANGGOTAAN LAMA (ANTI-JEBAKAN RE-RUN) ==========
-- Hanya berjalan bila tabel anggota_sub_ekskul masih ada (to_regclass),
-- dan hanya mengisi baris sub yang kolom anggotanya masih kosong (idempoten).
do $$
declare
  v_kol text;
begin
  if to_regclass('public.anggota_sub_ekskul') is not null then
    -- [PERBAIKAN 42703] kolom penyimpan nama sub dideteksi otomatis:
    -- skema v1 memakai kolom "sub" (bukan "nama_sub") — deteksi via information_schema, dipakai via %I.
    select case
      when exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'anggota_sub_ekskul'
                     and column_name = 'nama_sub') then 'nama_sub'
      when exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'anggota_sub_ekskul'
                     and column_name = 'sub') then 'sub'
      else null
    end into v_kol;
    if v_kol is not null then
      execute format($f$
        update sub_ekstrakurikuler s
        set anggota = q.anggota
        from (
          select ekskul, %I as nama_sub, jsonb_agg(distinct nis order by nis) as anggota
          from anggota_sub_ekskul
          where coalesce(%I, '') <> ''
          group by ekskul, %I
        ) q
        where s.ekskul = q.ekskul
          and s.nama_sub = q.nama_sub
          and coalesce(s.anggota, '[]'::jsonb) = '[]'::jsonb
      $f$, v_kol, v_kol, v_kol);
    end if;
  end if;
end $$;

-- ========== 3. DROP TABEL LAMA ==========
drop table if exists anggota_sub_ekskul;

-- ========== 4. SELF-HEALING KOLOM FITUR EKSKUL & SURAT ==========
-- Semua "add column if not exists" — tidak mengubah kolom yang sudah ada.
alter table ekstrakurikuler
  add column if not exists pembina_nip text default '',
  add column if not exists jadwal text default '',
  add column if not exists logo_url text default '';

alter table dispensasi
  add column if not exists sub_ekskul text default '',
  add column if not exists keterangan text default '',
  add column if not exists detail jsonb default '{}'::jsonb,
  add column if not exists surat_id text default '';

alter table agenda_ekskul
  add column if not exists hari text default '';
alter table agenda_ekskul alter column tanggal drop not null;

-- ========== 5. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';
