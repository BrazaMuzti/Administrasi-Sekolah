-- ============================================================
-- FIX KREDENSIAL MURID — 2026-09-03 (v2)
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- (melengkapi upgrade_20260903.sql; bagian kredensial di sana
--  sudah digantikan oleh file ini)
--
-- Perbaikan:
--   1) password_hash pindah ke tabel terpisah `akun_kredensial`
--      (RLS aktif TANPA policy → tak terbaca via API oleh siapa pun;
--       akses hanya lewat RPC security definer & service_role)
--   2) Privilege tabel akun dipulihkan → select * normal (403 hilang)
--   3) RPC murid dibuat ulang membaca hash dari akun_kredensial
--   4) Cache skema PostgREST direload di akhir
-- Semua blok idempotent — aman dijalankan berulang.
-- ============================================================

create extension if not exists pgcrypto;

-- ========== 1. TABEL KREDENSIAL (hash password murid) ==========
create table if not exists akun_kredensial (
  id uuid primary key default gen_random_uuid(),
  nis_nip text not null unique,
  password_hash text not null,
  updated_at timestamptz not null default now()
);
alter table akun_kredensial enable row level security;
-- Sengaja TANPA policy: REST API tidak punya jalur baca/tulis.

-- ========== 2. MIGRASI hash lama (jika kolom password_hash masih ada di akun) ==========
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'akun'
               and column_name = 'password_hash') then
    insert into akun_kredensial (nis_nip, password_hash)
    select nis_nip, password_hash from akun
    where nis_nip is not null and password_hash is not null and password_hash <> ''
    on conflict (nis_nip) do update set password_hash = excluded.password_hash;
    alter table akun drop column password_hash;
  end if;
end $$;

-- ========== 3. PULIHKAN PRIVILEGE TABEL AKUN (fix 403 select *) ==========
revoke all on table akun from anon, authenticated;
grant select on akun to anon;
grant select, insert, update, delete on akun to authenticated;

-- ========== 4. RPC MURID (security definer; hash di akun_kredensial) ==========

-- 4a. Verifikasi login murid (NIS + password). Dipanggil anon saat login.
create or replace function cek_login_murid(p_nis text, p_password text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r akun%rowtype;
  v_hash text;
begin
  select * into r from akun where nis_nip = p_nis and tipe = 'murid' limit 1;
  if r.id is null then
    return json_build_object('status', 'error', 'message', 'NIS tidak terdaftar.');
  end if;
  select password_hash into v_hash from akun_kredensial where nis_nip = p_nis;
  if v_hash is null or v_hash = '' then
    return json_build_object('status', 'error', 'message', 'Akun ini belum memiliki password lokal.');
  end if;
  if crypt(p_password, v_hash) = v_hash then
    return json_build_object('status', 'success', 'akun', json_build_object(
      'id', r.id,
      'user_id', r.user_id,
      'nama_lengkap', r.nama_lengkap,
      'nis_nip', r.nis_nip,
      'tipe', r.tipe,
      'email', r.email,
      'tingkat_kelas', r.tingkat_kelas,
      'jabatan', r.jabatan
    ));
  end if;
  return json_build_object('status', 'error', 'message', 'Password salah.');
end $$;

-- 4b. Tambah / edit akun murid oleh admin (upsert berdasarkan nis_nip).
create or replace function buat_akun_murid(p_data jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis text;
  v_pass text;
begin
  if coalesce((select tipe from akun where user_id = auth.uid()), '') <> 'admin' then
    return json_build_object('status', 'error', 'message', 'Hanya admin yang boleh mengelola akun murid.');
  end if;

  v_nis := trim(coalesce(p_data->>'nis', ''));
  if v_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;
  if coalesce(trim(coalesce(p_data->>'nama_lengkap', '')), '') = '' then
    return json_build_object('status', 'error', 'message', 'Nama lengkap wajib diisi.');
  end if;

  v_pass := trim(coalesce(p_data->>'password', ''));
  if v_pass <> '' and length(v_pass) < 6 then
    return json_build_object('status', 'error', 'message', 'Password minimal 6 karakter.');
  end if;

  if exists (select 1 from akun where nis_nip = v_nis and tipe = 'murid') then
    -- EDIT: perbarui profil; password hanya bila diisi
    update akun set
      nama_lengkap    = coalesce(nullif(trim(p_data->>'nama_lengkap'), ''), nama_lengkap),
      tingkat_kelas   = coalesce(nullif(trim(p_data->>'tingkat_kelas'), ''), tingkat_kelas),
      jabatan         = coalesce(nullif(trim(p_data->>'jabatan'), ''), jabatan),
      email           = coalesce(nullif(trim(p_data->>'email'), ''), email),
      no_telepon      = coalesce(nullif(trim(p_data->>'no_telepon'), ''), no_telepon),
      ekstrakurikuler = coalesce(nullif(trim(p_data->>'ekstrakurikuler'), ''), ekstrakurikuler)
    where nis_nip = v_nis and tipe = 'murid';

    if v_pass <> '' then
      insert into akun_kredensial (nis_nip, password_hash)
      values (v_nis, crypt(v_pass, gen_salt('bf', 10)))
      on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();
    end if;
    return json_build_object('status', 'success', 'message', 'Data murid diperbarui.', 'aksi', 'update');
  else
    -- TAMBAH: password wajib (kosong → default 123456)
    if v_pass = '' then v_pass := '123456'; end if;
    insert into akun (nama_lengkap, nis_nip, tipe, email, tingkat_kelas, jabatan, no_telepon, ekstrakurikuler)
    values (
      trim(p_data->>'nama_lengkap'), v_nis, 'murid',
      nullif(trim(coalesce(p_data->>'email', '')), ''),
      nullif(trim(coalesce(p_data->>'tingkat_kelas', '')), ''),
      nullif(trim(coalesce(p_data->>'jabatan', '')), ''),
      nullif(trim(coalesce(p_data->>'no_telepon', '')), ''),
      nullif(trim(coalesce(p_data->>'ekstrakurikuler', '')), '')
    );
    insert into akun_kredensial (nis_nip, password_hash)
    values (v_nis, crypt(v_pass, gen_salt('bf', 10)))
    on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();
    return json_build_object('status', 'success', 'message', 'Murid baru tersimpan (password lokal aktif).', 'aksi', 'insert');
  end if;
end $$;

-- 4c. Import massal murid: array [{nis, nama_lengkap, tingkat_kelas, email,
--     no_telepon, ekstrakurikuler, password?}] + password default.
create or replace function import_akun_murid(p_rows jsonb, p_default_password text default '123456')
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  el jsonb;
  v_nis text;
  v_pass text;
  v_ok int := 0; v_upd int := 0; v_fail int := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  if coalesce((select tipe from akun where user_id = auth.uid()), '') <> 'admin' then
    return json_build_object('status', 'error', 'message', 'Hanya admin yang boleh mengelola akun murid.');
  end if;

  for el in select * from jsonb_array_elements(p_rows) loop
    v_nis := trim(coalesce(el->>'nis', ''));
    if v_nis = '' then
      v_fail := v_fail + 1;
      v_errors := v_errors || jsonb_build_array('Baris tanpa NIS dilewati.');
      continue;
    end if;
    v_pass := trim(coalesce(el->>'password', ''));
    if v_pass = '' then v_pass := coalesce(trim(p_default_password), '123456'); end if;
    if length(v_pass) < 6 then v_pass := '123456'; end if;

    begin
      if exists (select 1 from akun where nis_nip = v_nis and tipe = 'murid') then
        update akun set
          nama_lengkap    = coalesce(nullif(trim(el->>'nama_lengkap'), ''), nama_lengkap),
          tingkat_kelas   = coalesce(nullif(trim(el->>'tingkat_kelas'), ''), tingkat_kelas),
          email           = coalesce(nullif(trim(el->>'email'), ''), email),
          no_telepon      = coalesce(nullif(trim(el->>'no_telepon'), ''), no_telepon),
          ekstrakurikuler = coalesce(nullif(trim(el->>'ekstrakurikuler'), ''), ekstrakurikuler)
        where nis_nip = v_nis and tipe = 'murid';
        v_upd := v_upd + 1;
      else
        insert into akun (nama_lengkap, nis_nip, tipe, email, tingkat_kelas, no_telepon, ekstrakurikuler)
        values (
          coalesce(nullif(trim(el->>'nama_lengkap'), ''), 'Tanpa Nama'),
          v_nis, 'murid',
          nullif(trim(coalesce(el->>'email', '')), ''),
          nullif(trim(coalesce(el->>'tingkat_kelas', '')), ''),
          nullif(trim(coalesce(el->>'no_telepon', '')), ''),
          nullif(trim(coalesce(el->>'ekstrakurikuler', '')), '')
        );
        v_ok := v_ok + 1;
      end if;
      insert into akun_kredensial (nis_nip, password_hash)
      values (v_nis, crypt(v_pass, gen_salt('bf', 10)))
      on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();
    exception when others then
      v_fail := v_fail + 1;
      v_errors := v_errors || jsonb_build_array('NIS ' || v_nis || ': ' || SQLERRM);
    end;
  end loop;

  return json_build_object(
    'status', 'success',
    'ditambahkan', v_ok,
    'diperbarui', v_upd,
    'gagal', v_fail,
    'detail_gagal', v_errors
  );
end $$;

-- 4d. Reset password murid oleh admin (default saran: 123456).
create or replace function set_password_murid(p_nis text, p_password text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if coalesce((select tipe from akun where user_id = auth.uid()), '') <> 'admin' then
    return json_build_object('status', 'error', 'message', 'Hanya admin yang boleh mereset password.');
  end if;
  if length(trim(coalesce(p_password, ''))) < 6 then
    return json_build_object('status', 'error', 'message', 'Password minimal 6 karakter.');
  end if;
  if not exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') then
    return json_build_object('status', 'error', 'message', 'NIS tidak ditemukan.');
  end if;
  insert into akun_kredensial (nis_nip, password_hash)
  values (p_nis, crypt(p_password, gen_salt('bf', 10)))
  on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();
  return json_build_object('status', 'success', 'message', 'Password murid direset.');
end $$;

-- ========== 5. IZIN EKSEKUSI RPC ==========
grant execute on function cek_login_murid(text, text) to anon, authenticated;
grant execute on function buat_akun_murid(jsonb) to authenticated;
grant execute on function import_akun_murid(jsonb, text) to authenticated;
grant execute on function set_password_murid(text, text) to authenticated;

-- ========== 6. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';
