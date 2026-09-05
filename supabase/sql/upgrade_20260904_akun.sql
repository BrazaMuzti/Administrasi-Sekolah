-- ============================================================
-- UPGRADE AKUN (GURU & MURID) — 2026-09-04
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) Gelar guru        : gelar_depan, gelar_belakang
--   2) 14 kolom profil murid : nisn, tahun_pelajaran, semester,
--      jenis_kelamin, tgl_lahir, agama, golongan_darah, nama_ayah,
--      pekerjaan_ayah, nama_ibu, pekerjaan_ibu, nama_wali, alamat,
--      catatan_khusus
--   3) RPC buat_akun_murid & import_akun_murid dibuat ulang untuk
--      mendukung kolom baru (pola & aturan sama: password hash di
--      akun_kredensial, hanya admin)
--
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== 1. GELAR GURU ==========
alter table akun
  add column if not exists gelar_depan text,
  add column if not exists gelar_belakang text;

-- ========== 2. KOLOM PROFIL MURID ==========
alter table akun
  add column if not exists nisn text,
  add column if not exists tahun_pelajaran text,
  add column if not exists semester text,
  add column if not exists jenis_kelamin text,
  add column if not exists tgl_lahir date,
  add column if not exists agama text,
  add column if not exists golongan_darah text,
  add column if not exists nama_ayah text,
  add column if not exists pekerjaan_ayah text,
  add column if not exists nama_ibu text,
  add column if not exists pekerjaan_ibu text,
  add column if not exists nama_wali text,
  add column if not exists alamat text,
  add column if not exists catatan_khusus text;

-- ========== 3a. RPC: TAMBAH / EDIT AKUN MURID (dengan kolom baru) ==========
create or replace function buat_akun_murid(p_data jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis text;
  v_pass text;
  v_lahir date;
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

  v_lahir := nullif(trim(coalesce(p_data->>'tgl_lahir', '')), '')::date;

  if exists (select 1 from akun where nis_nip = v_nis and tipe = 'murid') then
    -- EDIT: perbarui profil; password hanya bila diisi
    update akun set
      nama_lengkap     = coalesce(nullif(trim(p_data->>'nama_lengkap'), ''), nama_lengkap),
      nisn             = coalesce(nullif(trim(p_data->>'nisn'), ''), nisn),
      tahun_pelajaran  = coalesce(nullif(trim(p_data->>'tahun_pelajaran'), ''), tahun_pelajaran),
      semester         = coalesce(nullif(trim(p_data->>'semester'), ''), semester),
      tingkat_kelas    = coalesce(nullif(trim(p_data->>'tingkat_kelas'), ''), tingkat_kelas),
      jenis_kelamin    = coalesce(nullif(trim(p_data->>'jenis_kelamin'), ''), jenis_kelamin),
      tgl_lahir        = coalesce(v_lahir, tgl_lahir),
      agama            = coalesce(nullif(trim(p_data->>'agama'), ''), agama),
      golongan_darah   = coalesce(nullif(trim(p_data->>'golongan_darah'), ''), golongan_darah),
      jabatan          = coalesce(nullif(trim(p_data->>'jabatan'), ''), jabatan),
      email            = coalesce(nullif(trim(p_data->>'email'), ''), email),
      no_telepon       = coalesce(nullif(trim(p_data->>'no_telepon'), ''), no_telepon),
      ekstrakurikuler  = coalesce(nullif(trim(p_data->>'ekstrakurikuler'), ''), ekstrakurikuler),
      nama_ayah        = coalesce(nullif(trim(p_data->>'nama_ayah'), ''), nama_ayah),
      pekerjaan_ayah   = coalesce(nullif(trim(p_data->>'pekerjaan_ayah'), ''), pekerjaan_ayah),
      nama_ibu         = coalesce(nullif(trim(p_data->>'nama_ibu'), ''), nama_ibu),
      pekerjaan_ibu    = coalesce(nullif(trim(p_data->>'pekerjaan_ibu'), ''), pekerjaan_ibu),
      nama_wali        = coalesce(nullif(trim(p_data->>'nama_wali'), ''), nama_wali),
      alamat           = coalesce(nullif(trim(p_data->>'alamat'), ''), alamat),
      catatan_khusus   = coalesce(nullif(trim(p_data->>'catatan_khusus'), ''), catatan_khusus)
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
    insert into akun (
      nama_lengkap, nis_nip, tipe, nisn, tahun_pelajaran, semester,
      jenis_kelamin, tgl_lahir, agama, golongan_darah,
      email, no_telepon, ekstrakurikuler, tingkat_kelas, jabatan,
      nama_ayah, pekerjaan_ayah, nama_ibu, pekerjaan_ibu, nama_wali,
      alamat, catatan_khusus
    ) values (
      trim(p_data->>'nama_lengkap'), v_nis, 'murid',
      nullif(trim(coalesce(p_data->>'nisn', '')), ''),
      nullif(trim(coalesce(p_data->>'tahun_pelajaran', '')), ''),
      nullif(trim(coalesce(p_data->>'semester', '')), ''),
      nullif(trim(coalesce(p_data->>'jenis_kelamin', '')), ''),
      v_lahir,
      nullif(trim(coalesce(p_data->>'agama', '')), ''),
      nullif(trim(coalesce(p_data->>'golongan_darah', '')), ''),
      nullif(trim(coalesce(p_data->>'email', '')), ''),
      nullif(trim(coalesce(p_data->>'no_telepon', '')), ''),
      nullif(trim(coalesce(p_data->>'ekstrakurikuler', '')), ''),
      nullif(trim(coalesce(p_data->>'tingkat_kelas', '')), ''),
      nullif(trim(coalesce(p_data->>'jabatan', '')), ''),
      nullif(trim(coalesce(p_data->>'nama_ayah', '')), ''),
      nullif(trim(coalesce(p_data->>'pekerjaan_ayah', '')), ''),
      nullif(trim(coalesce(p_data->>'nama_ibu', '')), ''),
      nullif(trim(coalesce(p_data->>'pekerjaan_ibu', '')), ''),
      nullif(trim(coalesce(p_data->>'nama_wali', '')), ''),
      nullif(trim(coalesce(p_data->>'alamat', '')), ''),
      nullif(trim(coalesce(p_data->>'catatan_khusus', '')), '')
    );
    insert into akun_kredensial (nis_nip, password_hash)
    values (v_nis, crypt(v_pass, gen_salt('bf', 10)))
    on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();
    return json_build_object('status', 'success', 'message', 'Murid baru tersimpan (password lokal aktif).', 'aksi', 'insert');
  end if;
end $$;

-- ========== 3b. RPC: IMPORT MASSAL MURID (dengan kolom baru) ==========
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
  v_lahir date;
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
      v_lahir := nullif(trim(coalesce(el->>'tgl_lahir', '')), '')::date;
      if exists (select 1 from akun where nis_nip = v_nis and tipe = 'murid') then
        update akun set
          nama_lengkap     = coalesce(nullif(trim(el->>'nama_lengkap'), ''), nama_lengkap),
          nisn             = coalesce(nullif(trim(el->>'nisn'), ''), nisn),
          tahun_pelajaran  = coalesce(nullif(trim(el->>'tahun_pelajaran'), ''), tahun_pelajaran),
          semester         = coalesce(nullif(trim(el->>'semester'), ''), semester),
          jenis_kelamin    = coalesce(nullif(trim(el->>'jenis_kelamin'), ''), jenis_kelamin),
          tgl_lahir        = coalesce(v_lahir, tgl_lahir),
          agama            = coalesce(nullif(trim(el->>'agama'), ''), agama),
          golongan_darah   = coalesce(nullif(trim(el->>'golongan_darah'), ''), golongan_darah),
          tingkat_kelas    = coalesce(nullif(trim(el->>'tingkat_kelas'), ''), tingkat_kelas),
          jabatan          = coalesce(nullif(trim(el->>'jabatan'), ''), jabatan),
          email            = coalesce(nullif(trim(el->>'email'), ''), email),
          no_telepon       = coalesce(nullif(trim(el->>'no_telepon'), ''), no_telepon),
          ekstrakurikuler  = coalesce(nullif(trim(el->>'ekstrakurikuler'), ''), ekstrakurikuler),
          nama_ayah        = coalesce(nullif(trim(el->>'nama_ayah'), ''), nama_ayah),
          pekerjaan_ayah   = coalesce(nullif(trim(el->>'pekerjaan_ayah'), ''), pekerjaan_ayah),
          nama_ibu         = coalesce(nullif(trim(el->>'nama_ibu'), ''), nama_ibu),
          pekerjaan_ibu    = coalesce(nullif(trim(el->>'pekerjaan_ibu'), ''), pekerjaan_ibu),
          nama_wali        = coalesce(nullif(trim(el->>'nama_wali'), ''), nama_wali),
          alamat           = coalesce(nullif(trim(el->>'alamat'), ''), alamat),
          catatan_khusus   = coalesce(nullif(trim(el->>'catatan_khusus'), ''), catatan_khusus)
        where nis_nip = v_nis and tipe = 'murid';
        v_upd := v_upd + 1;
      else
        insert into akun (
          nama_lengkap, nis_nip, tipe, nisn, tahun_pelajaran, semester,
          jenis_kelamin, tgl_lahir, agama, golongan_darah,
          email, tingkat_kelas, jabatan, no_telepon, ekstrakurikuler,
          nama_ayah, pekerjaan_ayah, nama_ibu, pekerjaan_ibu, nama_wali,
          alamat, catatan_khusus
        ) values (
          coalesce(nullif(trim(el->>'nama_lengkap'), ''), 'Tanpa Nama'),
          v_nis, 'murid',
          nullif(trim(coalesce(el->>'nisn', '')), ''),
          nullif(trim(coalesce(el->>'tahun_pelajaran', '')), ''),
          nullif(trim(coalesce(el->>'semester', '')), ''),
          nullif(trim(coalesce(el->>'jenis_kelamin', '')), ''),
          v_lahir,
          nullif(trim(coalesce(el->>'agama', '')), ''),
          nullif(trim(coalesce(el->>'golongan_darah', '')), ''),
          nullif(trim(coalesce(el->>'email', '')), ''),
          nullif(trim(coalesce(el->>'tingkat_kelas', '')), ''),
          nullif(trim(coalesce(el->>'jabatan', '')), ''),
          nullif(trim(coalesce(el->>'no_telepon', '')), ''),
          nullif(trim(coalesce(el->>'ekstrakurikuler', '')), ''),
          nullif(trim(coalesce(el->>'nama_ayah', '')), ''),
          nullif(trim(coalesce(el->>'pekerjaan_ayah', '')), ''),
          nullif(trim(coalesce(el->>'nama_ibu', '')), ''),
          nullif(trim(coalesce(el->>'pekerjaan_ibu', '')), ''),
          nullif(trim(coalesce(el->>'nama_wali', '')), ''),
          nullif(trim(coalesce(el->>'alamat', '')), ''),
          nullif(trim(coalesce(el->>'catatan_khusus', '')), '')
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

-- ========== 4. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';
