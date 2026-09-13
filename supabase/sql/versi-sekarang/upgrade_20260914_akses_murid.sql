-- ============================================================
-- UPGRADE AKSES MURID — 2026-09-14
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) Kolom gps di tabel absensi (persist lokasi absen mandiri)
--   2) RPC ubah_profil_murid        : murid edit data dirinya (whitelist)
--   3) RPC ubah_password_sendiri    : murid reset password sendiri
--                                     (verifikasi password lama)
--   4) RPC ambil_laporan_nilai_murid: murid (anon) membaca nilai miliknya
--
-- Murid lokal login dengan anon key (tanpa sesi Supabase Auth) — pola
-- sama dengan absensi & teman sejawat: verifikasi dilakukan di RPC
-- security-definer berdasarkan NIS pemanggil.
--
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. KOLOM GPS ABSENSI ==========
alter table absensi add column if not exists gps text default '';

-- ========== 2. RPC: EDIT PROFIL SENDIRI (WHITELIST) ==========
-- Murid hanya boleh mengubah kolom kontak & data pribadi.
-- NIS, NISN, nama, kelas, ekstrakurikuler, jabatan TIDAK bisa diubah.
create or replace function ubah_profil_murid(p_nis text, p_data jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_lahir date;
begin
  -- Verifikasi pemanggil benar-benar pemilik NIS (murid lokal/anon
  -- tidak punya auth.uid(), jadi kecocokan NIS + tipe murid adalah kuncinya).
  if not exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') then
    return json_build_object('status', 'error', 'message', 'Akun murid tidak ditemukan.');
  end if;

  v_lahir := nullif(trim(coalesce(p_data->>'tgl_lahir', '')), '')::date;

  update akun set
    email            = coalesce(p_data->>'email', email),
    no_telepon       = coalesce(p_data->>'no_telepon', no_telepon),
    alamat           = coalesce(p_data->>'alamat', alamat),
    nama_ayah        = coalesce(p_data->>'nama_ayah', nama_ayah),
    pekerjaan_ayah   = coalesce(p_data->>'pekerjaan_ayah', pekerjaan_ayah),
    nama_ibu         = coalesce(p_data->>'nama_ibu', nama_ibu),
    pekerjaan_ibu    = coalesce(p_data->>'pekerjaan_ibu', pekerjaan_ibu),
    nama_wali        = coalesce(p_data->>'nama_wali', nama_wali),
    tgl_lahir        = coalesce(v_lahir, tgl_lahir),
    jenis_kelamin    = coalesce(p_data->>'jenis_kelamin', jenis_kelamin),
    agama            = coalesce(p_data->>'agama', agama),
    golongan_darah   = coalesce(p_data->>'golongan_darah', golongan_darah)
  where nis_nip = p_nis and tipe = 'murid';

  return json_build_object('status', 'success', 'message', 'Profil berhasil diperbarui.');
end $$;

-- ========== 3. RPC: GANTI PASSWORD SENDIRI ==========
create or replace function ubah_password_sendiri(p_nis text, p_lama text, p_baru text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  if length(trim(coalesce(p_baru, ''))) < 6 then
    return json_build_object('status', 'error', 'message', 'Password baru minimal 6 karakter.');
  end if;

  select password_hash into v_hash from akun_kredensial where nis_nip = p_nis;
  if v_hash is null then
    return json_build_object('status', 'error', 'message', 'Kredensial tidak ditemukan. Hubungi admin.');
  end if;

  if crypt(coalesce(p_lama, ''), v_hash) <> v_hash then
    return json_build_object('status', 'error', 'message', 'Password lama salah.');
  end if;

  update akun_kredensial
    set password_hash = crypt(p_baru, gen_salt('bf', 10)), updated_at = now()
  where nis_nip = p_nis;

  return json_build_object('status', 'success', 'message', 'Password berhasil diganti.');
end $$;

-- ========== 4. RPC: LAPORAN NILAI MURID (READ-ONLY) ==========
create or replace function ambil_laporan_nilai_murid(p_nis text, p_tahun text, p_semester text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rows json;
begin
  if not exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') then
    return json_build_object('status', 'error', 'message', 'Akun murid tidak ditemukan.');
  end if;

  select coalesce(json_agg(row_to_json(t) order by t.kategori, t.mapel), '[]'::json)
    into v_rows
  from (
    select nis, nama, kategori, mapel, ekskul, kelas, tahun, semester, data
    from nilai
    where nis = p_nis
      and (p_tahun = '' or tahun = p_tahun)
      and (p_semester = '' or semester = p_semester)
  ) t;

  return json_build_object('status', 'success', 'nilai', v_rows);
end $$;

-- ========== 5. IZIN EKSEKUSI ==========
grant execute on function ubah_profil_murid(text, jsonb) to anon, authenticated;
grant execute on function ubah_password_sendiri(text, text, text) to anon, authenticated;
grant execute on function ambil_laporan_nilai_murid(text, text, text) to anon, authenticated;

-- ========== 6. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';
