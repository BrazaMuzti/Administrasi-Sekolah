-- ============================================================
-- UPGRADE SKEMA SIAKAD — 2026-09-03
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) Tabel akun    : kolom profil guru/murid + password_hash (bcrypt)
--   2) Tabel master_data : 13 kolom gaya Sheets (nama persis)
--   3) RPC murid     : cek_login_murid / buat_akun_murid / import_akun_murid /
--                      set_password_murid  (security definer, hash bcrypt)
--   4) Keamanan      : sembunyikan password_hash dari anon/authenticated
--   5) RLS master_data : select untuk semua, tulis hanya authenticated
-- Semua blok idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. TABEL AKUN ==========
alter table akun
  add column if not exists jabatan text,
  add column if not exists tingkat_kelas text,
  add column if not exists wali_kelas text,
  add column if not exists mapel text,
  add column if not exists ekstrakurikuler text,
  add column if not exists password_hash text;

-- ========== 2. TABEL MASTER_DATA (nama kolom persis gaya Sheets) ==========
alter table master_data
  add column if not exists "Nama Dinas" text,
  add column if not exists "Nama Sekolah" text,
  add column if not exists "URL LOGO 1" text,
  add column if not exists "URL LOGO 2" text,
  add column if not exists "Ket. Nama Dinas" text,
  add column if not exists "Alamat Sekolah" text,
  add column if not exists "Semester" text,
  add column if not exists "Tahun Pelajaran" text,
  add column if not exists "Tingkat/Kelas" text,
  add column if not exists "Mata Pelajaran" text,
  add column if not exists "Ekstrakurikuler" text,
  add column if not exists "Jabatan Kelas" text,
  add column if not exists "Jabatan Guru" text;

-- ========== 3. RPC AKUN MURID (password lokal, hash bcrypt) ==========
create extension if not exists pgcrypto;

-- 3a. Verifikasi login murid (NIS + password). Dipanggil anon saat login.
create or replace function cek_login_murid(p_nis text, p_password text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r akun%rowtype;
begin
  select * into r from akun where nis_nip = p_nis and tipe = 'murid' limit 1;
  if r.id is null then
    return json_build_object('status', 'error', 'message', 'NIS tidak terdaftar.');
  end if;
  if r.password_hash is null or r.password_hash = '' then
    return json_build_object('status', 'error', 'message', 'Akun ini belum memiliki password lokal.');
  end if;
  if crypt(p_password, r.password_hash) = r.password_hash then
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

-- 3b. Tambah / edit akun murid oleh admin (upsert berdasarkan nis_nip).
create or replace function buat_akun_murid(p_data jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis text;
  v_pass text;
  v_id uuid;
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
      nama_lengkap  = coalesce(nullif(trim(p_data->>'nama_lengkap'), ''), nama_lengkap),
      tingkat_kelas = coalesce(nullif(trim(p_data->>'tingkat_kelas'), ''), tingkat_kelas),
      email         = coalesce(nullif(trim(p_data->>'email'), ''), email),
      ekstrakurikuler = coalesce(nullif(trim(p_data->>'ekstrakurikuler'), ''), ekstrakurikuler),
      password_hash = case when v_pass <> '' then crypt(v_pass, gen_salt('bf', 10)) else password_hash end
    where nis_nip = v_nis and tipe = 'murid';
    return json_build_object('status', 'success', 'message', 'Data murid diperbarui.', 'aksi', 'update');
  else
    -- TAMBAH: password wajib (kosong → default 123456)
    if v_pass = '' then v_pass := '123456'; end if;
    insert into akun (nama_lengkap, nis_nip, tipe, email, tingkat_kelas, ekstrakurikuler, password_hash)
    values (
      trim(p_data->>'nama_lengkap'), v_nis, 'murid',
      nullif(trim(coalesce(p_data->>'email', '')), ''),
      nullif(trim(coalesce(p_data->>'tingkat_kelas', '')), ''),
      nullif(trim(coalesce(p_data->>'ekstrakurikuler', '')), ''),
      crypt(v_pass, gen_salt('bf', 10))
    );
    return json_build_object('status', 'success', 'message', 'Murid baru tersimpan (password lokal aktif).', 'aksi', 'insert');
  end if;
end $$;

-- 3c. Import massal murid: array [{nis, nama_lengkap, tingkat_kelas, email,
--     ekstrakurikuler, no_telepon, password?}] + password default.
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

    if exists (select 1 from akun where nis_nip = v_nis and tipe = 'murid') then
      update akun set
        nama_lengkap    = coalesce(nullif(trim(el->>'nama_lengkap'), ''), nama_lengkap),
        tingkat_kelas   = coalesce(nullif(trim(el->>'tingkat_kelas'), ''), tingkat_kelas),
        email           = coalesce(nullif(trim(el->>'email'), ''), email),
        ekstrakurikuler = coalesce(nullif(trim(el->>'ekstrakurikuler'), ''), ekstrakurikuler),
        no_telepon      = coalesce(nullif(trim(el->>'no_telepon'), ''), no_telepon),
        password_hash   = crypt(v_pass, gen_salt('bf', 10))
      where nis_nip = v_nis and tipe = 'murid';
      v_upd := v_upd + 1;
    else
      begin
        insert into akun (nama_lengkap, nis_nip, tipe, email, tingkat_kelas, ekstrakurikuler, no_telepon, password_hash)
        values (
          coalesce(nullif(trim(el->>'nama_lengkap'), ''), 'Tanpa Nama'),
          v_nis, 'murid',
          nullif(trim(coalesce(el->>'email', '')), ''),
          nullif(trim(coalesce(el->>'tingkat_kelas', '')), ''),
          nullif(trim(coalesce(el->>'ekstrakurikuler', '')), ''),
          nullif(trim(coalesce(el->>'no_telepon', '')), ''),
          crypt(v_pass, gen_salt('bf', 10))
        );
        v_ok := v_ok + 1;
      exception when others then
        v_fail := v_fail + 1;
        v_errors := v_errors || jsonb_build_array('NIS ' || v_nis || ': ' || SQLERRM);
      end;
    end if;
  end loop;

  return json_build_object(
    'status', 'success',
    'ditambahkan', v_ok,
    'diperbarui', v_upd,
    'gagal', v_fail,
    'detail_gagal', v_errors
  );
end $$;

-- 3d. Reset password murid oleh admin (default saran: 123456).
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
  update akun set password_hash = crypt(p_password, gen_salt('bf', 10))
  where nis_nip = p_nis and tipe = 'murid';
  if not found then
    return json_build_object('status', 'error', 'message', 'NIS tidak ditemukan.');
  end if;
  return json_build_object('status', 'success', 'message', 'Password murid direset.');
end $$;

-- ========== 4. SEMBUNYIKAN password_hash DARI ANON/AUTHENTICATED ==========
-- service_role (Edge Function) & SECURITY DEFINER RPC tetap akses penuh.
revoke all on table akun from anon, authenticated;

grant select (id, user_id, nama_lengkap, nis_nip, tipe, email, no_telepon, foto_profil,
              created_at, jabatan, tingkat_kelas, wali_kelas, mapel, ekstrakurikuler)
  on akun to anon, authenticated;
grant insert (id, user_id, nama_lengkap, nis_nip, tipe, email, no_telepon, foto_profil,
              jabatan, tingkat_kelas, wali_kelas, mapel, ekstrakurikuler)
  on akun to authenticated;
grant update (user_id, email, nama_lengkap, nis_nip, tipe, jabatan, tingkat_kelas,
              wali_kelas, mapel, ekstrakurikuler, no_telepon)
  on akun to anon, authenticated;

-- ========== 5. RLS MASTER_DATA ==========
-- Baca untuk semua (header/login perlu), tulis hanya user login (admin).
alter table master_data enable row level security;

drop policy if exists "master_data_baca_semua" on master_data;
create policy "master_data_baca_semua" on master_data
  for select using (true);

drop policy if exists "master_data_tulis_authenticated" on master_data;
create policy "master_data_tulis_authenticated" on master_data
  for insert to authenticated with check (true);

drop policy if exists "master_data_ubah_authenticated" on master_data;
create policy "master_data_ubah_authenticated" on master_data
  for update to authenticated using (true) with check (true);

drop policy if exists "master_data_hapus_authenticated" on master_data;
create policy "master_data_hapus_authenticated" on master_data
  for delete to authenticated using (true);
