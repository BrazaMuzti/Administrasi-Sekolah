-- ============================================================
-- FIX INSERT master_data (400 Bad Request) — 2026-09-03
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Penyebab: tabel dibuat manual via Table Editor sehingga bisa saja
-- memiliki (a) kolom id uuid NOT NULL tanpa default, dan/atau
-- (b) kolom legacy NOT NULL tanpa default (mis. keterangan).
-- Insert dari aplikasi hanya mengisi kolom tertentu → pelanggaran
-- NOT NULL → PostgREST membalas 400.
--
-- Isi (semua idempotent, tidak menyentuh data):
--   1) Set default gen_random_uuid() untuk kolom id uuid tanpa default
--      (master_data & akun)
--   2) Drop NOT NULL semua kolom non-PK tanpa default (master_data & akun)
--   3) Reload cache skema PostgREST
-- ============================================================

-- ========== 1. DEFAULT UNTUK KOLOM id UUID ==========
do $$
declare
  r record;
  v_tabel text;
  v_has_def boolean;
  v_is_identity text;
begin
  foreach v_tabel in array array['master_data', 'akun'] loop
    for r in
      select c.column_name
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = v_tabel
        and c.column_name = 'id'
        and c.is_nullable = 'NO'
        and c.data_type = 'uuid'
        and c.column_default is null
    loop
      -- Lewati jika kolom sudah berupa identity
      select a.attidentity::text into v_is_identity
      from pg_attribute a
      where a.attrelid = (v_tabel)::regclass
        and a.attname = 'id';
      if coalesce(v_is_identity, '') = '' then
        execute format('alter table %I alter column id set default gen_random_uuid();', v_tabel);
        raise notice 'id.% diberi default gen_random_uuid()', v_tabel;
      end if;
    end loop;
  end loop;
end $$;

-- ========== 2. DROP NOT NULL KOLOM NON-PK TANPA DEFAULT ==========
do $$
declare
  r record;
  v_sql text;
begin
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in ('master_data', 'akun')
      and c.is_nullable = 'NO'
      and c.column_default is null
      and not exists (
        select 1 from information_schema.key_column_usage k
        join information_schema.table_constraints t
          on t.constraint_name = k.constraint_name
         and t.constraint_schema = k.constraint_schema
         and t.constraint_type = 'PRIMARY KEY'
        where k.table_schema = c.table_schema
          and k.table_name = c.table_name
          and k.column_name = c.column_name
      )
  loop
    v_sql := format('alter table %I alter column %I drop not null;',
                    r.table_name, r.column_name);
    execute v_sql;
    raise notice 'NOT NULL dilepas: %.%', r.table_name, r.column_name;
  end loop;
end $$;

-- ========== 3. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';
