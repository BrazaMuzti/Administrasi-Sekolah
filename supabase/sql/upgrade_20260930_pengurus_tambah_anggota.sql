-- ============================================================
-- UPGRADE: PENGURUS EKSKUL DAFTARKAN ANGGOTA BARU — 2026-09-30
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Murid yang menjabat (pengurus) pada suatu ekstrakurikuler hanya bisa
--   menambahkan murid yang SUDAH punya akun sebagai anggota ekskul
--   (lewat UPDATE kolom ekstrakurikuler/jabatan_ekskul_map — akun anon
--   sudah punya izin update kolom tsb). Tidak bisa mendaftarkan siswa
--   yang BENAR-BENAR BARU (belum punya baris di tabel akun sama sekali)
--   karena akun anon tidak punya izin INSERT ke tabel akun, dan RPC
--   buat_akun_murid() mensyaratkan pemanggil bertipe admin.
--
-- ISI:
--   RPC daftar_anggota_ekskul_baru(p_pengurus_nis, p_ekskul, p_data):
--     - Verifikasi p_pengurus_nis adalah murid yang menjabat (punya entri
--       tidak kosong di jabatan_ekskul_map untuk p_ekskul).
--     - Validasi NIS baru belum terdaftar & nama lengkap wajib diisi.
--     - INSERT baris akun baru (tipe murid) + akun_kredensial (password
--       default '123456' bila tidak diisi), langsung diikutkan sebagai
--       anggota p_ekskul.
--   Dijalankan via security definer agar akun anon (murid lokal, tanpa
--   sesi Supabase Auth) tetap bisa memicu INSERT tanpa perlu grant insert
--   langsung ke tabel akun (mencegah insert sembarangan, mis. akun guru/admin palsu).
--
-- Idempotent — aman dijalankan berulang.
-- ============================================================

create or replace function daftar_anggota_ekskul_baru(p_pengurus_nis text, p_ekskul text, p_data jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis text;
  v_pass text;
  v_lahir date;
  v_jabatan_map jsonb;
begin
  -- Verifikasi pemanggil adalah murid yang menjabat (pengurus) pada p_ekskul.
  select jabatan_ekskul_map into v_jabatan_map
  from akun
  where nis_nip = p_pengurus_nis and tipe = 'murid';

  if v_jabatan_map is null or coalesce(trim(coalesce(v_jabatan_map->>p_ekskul, '')), '') = '' then
    return json_build_object('status', 'error', 'message', 'Hanya pengurus (menjabat) ekskul ini yang dapat mendaftarkan anggota baru.');
  end if;

  v_nis := trim(coalesce(p_data->>'nis', ''));
  if v_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;
  if coalesce(trim(coalesce(p_data->>'nama_lengkap', '')), '') = '' then
    return json_build_object('status', 'error', 'message', 'Nama lengkap wajib diisi.');
  end if;

  if exists (select 1 from akun where nis_nip = v_nis) then
    return json_build_object('status', 'error', 'message', 'NIS sudah terdaftar. Gunakan NIS lain atau tambahkan sebagai anggota lewat menu Tambah Anggota.');
  end if;

  v_pass := trim(coalesce(p_data->>'password', ''));
  if v_pass <> '' and length(v_pass) < 6 then
    return json_build_object('status', 'error', 'message', 'Password minimal 6 karakter.');
  end if;
  if v_pass = '' then v_pass := '123456'; end if;

  v_lahir := nullif(trim(coalesce(p_data->>'tgl_lahir', '')), '')::date;

  insert into akun (
    nama_lengkap, nis_nip, tipe, tahun_pelajaran, tingkat_kelas,
    ekstrakurikuler, tgl_lahir, jabatan_ekskul_map
  ) values (
    trim(p_data->>'nama_lengkap'), v_nis, 'murid',
    nullif(trim(coalesce(p_data->>'tahun_pelajaran', '')), ''),
    nullif(trim(coalesce(p_data->>'tingkat_kelas', '')), ''),
    p_ekskul,
    v_lahir,
    '{}'::jsonb
  );

  insert into akun_kredensial (nis_nip, password_hash)
  values (v_nis, crypt(v_pass, gen_salt('bf', 10)))
  on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();

  return json_build_object('status', 'success', 'message', 'Siswa baru berhasil didaftarkan sebagai anggota ' || p_ekskul || '.');
end $$;

-- ========== IZIN EKSEKUSI + RELOAD CACHE ==========
grant execute on function daftar_anggota_ekskul_baru(text, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
