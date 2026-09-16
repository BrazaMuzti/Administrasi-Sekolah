-- ============================================================
-- UPGRADE EKSTRAKURIKULER — SURAT DISPENSASI v2 — 2026-09-06
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) sub_ekstrakurikuler: kolom "anggota" (JSONB array NIS) —
--      keanggotaan sub digabung ke SATU tabel
--   2) Migrasi data dari anggota_sub_ekskul → sub_ekstrakurikuler.anggota
--   3) Drop tabel anggota_sub_ekskul (tidak lagi dipakai)
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. KOLOM ANGOTA PADA SUB-EKSKUL ==========
alter table sub_ekstrakurikuler
  add column if not exists anggota jsonb not null default '[]'::jsonb;

-- ========== 2. MIGRASI DATA KEANGGOTAAN LAMA ==========
-- Masukkan NIS dari anggota_sub_ekskul ke array anggota baris sub yang cocok
-- (hanya bila kolom anggota masih kosong — idempoten).
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

-- ========== 4. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';
