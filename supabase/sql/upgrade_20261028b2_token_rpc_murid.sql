-- ============================================================
-- UPGRADE 20261028b2: TOKEN SESI UNTUK RPC MURID YANG MENULIS `akun` — 2026-10-28
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG
--   RPC murid yang sudah ada (`ubah_profil_murid`, `simpan_wajah_murid`,
--   `ubah_anggota_ekskul`, `daftar_anggota_ekskul_baru`,
--   `ganti_kunci_absen_ekskul`) mengandalkan NIS yang DIKIRIM KLIEN
--   (`p_nis` / `p_pengurus_nis` / `p_pemanggil`) sebagai bukti identitas.
--   Karena RPC itu di-grant ke anon, siapa pun yang tahu NIS seorang murid
--   bisa mengubah profil, menimpa descriptor wajah, atau mendaftarkan
--   anggota ekskul atas namanya.
--
-- ISI
--   Setiap RPC di atas dibuat ulang dengan TAMBAHAN parameter `p_token`
--   (token sesi `sesi_lokal` dari `upgrade_20261028a`) dan pengecekan
--   otorisasi lewat `fn_akses_murid` / `fn_akses_ekskul`. Logika bisnis di
--   dalamnya DISALIN APA ADANYA dari versi terakhir masing-masing
--   (20261013, 20261023, 20261021, 20260930, 20261006c) — hanya blok
--   otorisasi yang berubah.
--
--   Catatan `ubah_password_sendiri`: setelah password berganti, SEMUA sesi
--   lama murid itu dicabut dan server menerbitkan sesi baru (`sesi_token`
--   di respons) supaya klien bisa lanjut tanpa login ulang.
--
-- KOMPATIBILITAS
--   Parameter `p_token` punya nilai default '' dan parameter NIS lama
--   (`p_nis` / `p_pengurus_nis` / `p_pemanggil` / `p_pemanggil_nis`)
--   DIPERTAHANKAN hanya supaya signature tetap cocok dengan pemanggil lama —
--   nilainya TIDAK dipakai sebagai bukti identitas. Identitas murid diambil
--   dari sesi: SELURUH RPC di file ini memanggil `fn_akses_murid(p_token, '')`
--   (fallback klaim NIS dikosongkan), sehingga:
--     * pemanggil tanpa token sah → langsung ditolak ('Sesi tidak valid …' /
--       'Tidak berhak …') meski tahu NIS milik murid lain;
--     * staf (admin/guru) tetap lolos lewat JWT (`fn_is_admin()`/`fn_is_guru()`),
--       tidak bergantung pada parameter klien sama sekali.
--   Ini membuat RPC penulis `akun` sudah ketat sejak file ini dijalankan
--   (setara `fix_20261028d_sesi_wajib.sql`, yang menutup jalur sama untuk RPC
--   baca di `upgrade_20261028b_rpc_akun.sql`).
--
-- PRASYARAT: upgrade_20261028a_sesi_lokal_murid.sql sudah dijalankan.
--
-- DI LUAR RUANG LINGKUP FASE INI (disengaja):
--   * `absen_mandiri` — menulis tabel `absensi`, bukan `akun`, dan validasi
--     sesi absen (BUKA + captcha) sudah dipindah ke RPC `cek_sesi_absen`
--     (upgrade_20261028b). Penambahan `p_token` di RPC itu direncanakan
--     sebagai lanjutan agar seluruh alur absen mandiri juga berbasis sesi.
--   * Edge Function `unggah-foto-murid` — memakai service role di server
--     (lolos RLS) dan memverifikasi pemanggil lewat JWT/klaim; penggantian
--     klaim NIS menjadi token sesi direncanakan sebagai fase lanjutan.
--
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. UBAH PROFIL SENDIRI (whitelist + kepemilikan) ==========
-- Versi asli: upgrade_20261013_akun_murid_keterangan_maps.sql
drop function if exists ubah_profil_murid(text, jsonb);

create or replace function ubah_profil_murid(p_nis text, p_data jsonb, p_token text default '')
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_lahir date;
  v_medsos jsonb;
  v_sesi  text;
begin
  if not exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') then
    return json_build_object('status', 'error', 'message', 'Akun murid tidak ditemukan.');
  end if;

  -- Kebijakan kepemilikan: admin, ATAU murid pemilik sesi (token).
  -- Fallback klaim NIS dikosongkan → identitas HANYA dari sesi.
  v_sesi := fn_akses_murid(p_token, '');
  if not fn_is_admin() and (v_sesi is null or v_sesi <> p_nis) then
    return json_build_object('status', 'error', 'message', 'Tidak berhak mengubah profil murid ini.');
  end if;

  v_lahir := nullif(trim(coalesce(p_data->>'tgl_lahir', '')), '')::date;
  if jsonb_typeof(p_data->'media_sosial') = 'array' then
    v_medsos := p_data->'media_sosial';
  else
    v_medsos := '[]'::jsonb;
  end if;

  update akun set
    email            = coalesce(p_data->>'email', email),
    no_telepon       = coalesce(p_data->>'no_telepon', no_telepon),
    no_telepon_ortu  = coalesce(p_data->>'no_telepon_ortu', no_telepon_ortu),
    alamat           = coalesce(p_data->>'alamat', alamat),
    alamat_maps      = coalesce(p_data->>'alamat_maps', alamat_maps),
    media_sosial     = case when p_data ? 'media_sosial' then v_medsos else media_sosial end,
    nama_ayah        = coalesce(p_data->>'nama_ayah', nama_ayah),
    pekerjaan_ayah   = coalesce(p_data->>'pekerjaan_ayah', pekerjaan_ayah),
    nama_ibu         = coalesce(p_data->>'nama_ibu', nama_ibu),
    pekerjaan_ibu    = coalesce(p_data->>'pekerjaan_ibu', pekerjaan_ibu),
    nama_wali        = coalesce(p_data->>'nama_wali', nama_wali),
    tgl_lahir        = coalesce(v_lahir, tgl_lahir),
    jenis_kelamin    = coalesce(p_data->>'jenis_kelamin', jenis_kelamin),
    agama            = coalesce(p_data->>'agama', agama),
    golongan_darah   = coalesce(p_data->>'golongan_darah', golongan_darah),
    catatan_khusus   = coalesce(p_data->>'catatan_khusus', catatan_khusus)
  where nis_nip = p_nis and tipe = 'murid';

  return json_build_object('status', 'success', 'message', 'Profil berhasil diperbarui.');
end $$;

grant execute on function ubah_profil_murid(text, jsonb, text) to anon, authenticated;

-- ========== 2. GANTI PASSWORD SENDIRI (+ cabut sesi lama) ==========
-- Versi asli: upgrade_20260928_rpc_akun_murid.sql
drop function if exists ubah_password_sendiri(text, text, text);

create or replace function ubah_password_sendiri(p_nis text, p_lama text, p_baru text, p_token text default '')
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_sesi text;
  v_baru json;
begin
  if length(trim(coalesce(p_baru, ''))) < 6 then
    return json_build_object('status', 'error', 'message', 'Password baru minimal 6 karakter.');
  end if;

  -- Kepemilikan: admin, ATAU murid pemilik sesi (token).
  -- Fallback klaim NIS dikosongkan → identitas HANYA dari sesi.
  v_sesi := fn_akses_murid(p_token, '');
  if not fn_is_admin() and (v_sesi is null or v_sesi <> p_nis) then
    return json_build_object('status', 'error', 'message', 'Tidak berhak mengganti password akun ini.');
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

  -- Semua sesi lama (termasuk token yang dikirim pemanggil) dicabut, lalu
  -- server menerbitkan sesi baru agar klien tidak terjebak logout.
  perform fn_sesi_cabut_nis(p_nis);
  v_baru := fn_sesi_buat(p_nis, 'murid', 12);

  return json_build_object(
    'status', 'success',
    'message', 'Password berhasil diganti.',
    'sesi_token', v_baru ->> 'token',
    'sesi_expires_at', v_baru ->> 'expires_at'
  );
end $$;

grant execute on function ubah_password_sendiri(text, text, text, text) to anon, authenticated;

-- ========== 3. PENGURUS EKSKUL GANTI KUNCI ABSEN (CAPTCHA) ==========
-- Versi asli: upgrade_20261006c_kunci_absen_ekskul_pengurus.sql
-- Identitas pemanggil TIDAK lagi dipercaya dari parameter: diambil dari sisi
-- server (JWT staf atau token sesi murid).
drop function if exists ganti_kunci_absen_ekskul(text, text, text, text);

create or replace function ganti_kunci_absen_ekskul(
  p_pemanggil text,
  p_ekskul text,
  p_captcha text,
  p_kunci text,
  p_token text default ''
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pemanggil text;
  v_jabatan_map jsonb;
  v_total int;
begin
  if fn_role() in ('admin', 'guru') then
    v_pemanggil := fn_nis();          -- staf: identitas dari JWT
  else
    -- Fallback klaim NIS dikosongkan (parameter `p_pemanggil` hanya untuk
    -- kompatibilitas signature) → identitas HANYA dari sesi.
    v_pemanggil := fn_akses_murid(p_token, '');
    if coalesce(trim(coalesce(v_pemanggil, '')), '') = '' then
      return json_build_object('status', 'error', 'message', 'Sesi tidak valid. Silakan login ulang.');
    end if;
  end if;

  -- 1) Pemanggil murid harus menjabat (pengurus) pada p_ekskul.
  if coalesce(trim(coalesce(v_pemanggil, '')), '') <> '' then
    select jabatan_ekskul_map into v_jabatan_map
    from akun
    where nis_nip = v_pemanggil and tipe = 'murid';
  end if;

  if coalesce(trim(coalesce(v_pemanggil, '')), '') <> '' and not fn_is_admin() and not fn_is_guru() then
    if v_jabatan_map is null or coalesce(trim(coalesce(v_jabatan_map->>p_ekskul, '')), '') = '' then
      return json_build_object('status', 'error', 'message', 'Anda bukan pengurus (menjabat) pada ' || p_ekskul || '.');
    end if;
  end if;

  -- 2) Perbarui kunci/captcha pada baris PEMBINA (guru/admin) ekskul ini.
  --    Kecocokan identik dengan validasi absen_mandiri: ekstrakurikuler
  --    berisi p_ekskul, atau mapel mengandung p_ekskul.
  update akun
  set captcha = upper(trim(coalesce(p_captcha, ''))),
      kunci_absen = case when p_kunci = 'BUKA' then 'BUKA' else 'TUTUP' end,
      updated_at = now()
  where tipe in ('guru', 'admin')
    and (
      lower(trim(p_ekskul)) = any (
        select lower(trim(x)) from unnest(string_to_array(ekstrakurikuler, ',')) as x where trim(x) <> ''
      )
      or mapel ilike '%' || p_ekskul || '%'
    );

  get diagnostics v_total = row_count;

  if v_total = 0 then
    return json_build_object('status', 'error', 'message', 'Pembina ' || p_ekskul || ' tidak ditemukan — kunci absen tidak diubah.');
  end if;

  return json_build_object('status', 'success', 'total', v_total, 'message', 'Kunci absen ' || p_ekskul || ' diperbarui.');
end $$;

grant execute on function ganti_kunci_absen_ekskul(text, text, text, text, text) to anon, authenticated;

-- ========== 4. PENGURUS EKSKUL DAFTARKAN ANGGOTA BARU ==========
-- Versi asli: upgrade_20260930_pengurus_tambah_anggota.sql
-- Identitas pengurus diambil dari sesi (JWT staf / token murid).
drop function if exists daftar_anggota_ekskul_baru(text, text, jsonb);

create or replace function daftar_anggota_ekskul_baru(
  p_pengurus_nis text,
  p_ekskul text,
  p_data jsonb,
  p_token text default ''
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pengurus text;
  v_nis text;
  v_pass text;
  v_lahir date;
  v_jabatan_map jsonb;
begin
  if fn_role() in ('admin', 'guru') then
    v_pengurus := trim(coalesce(fn_nis(), ''));   -- staf: identitas dari JWT
  else
    -- Fallback klaim NIS dikosongkan (parameter `p_pengurus_nis` hanya untuk
    -- kompatibilitas signature) → identitas HANYA dari sesi.
    v_pengurus := fn_akses_murid(p_token, '');
    if coalesce(trim(coalesce(v_pengurus, '')), '') = '' then
      return json_build_object('status', 'error', 'message', 'Sesi tidak valid. Silakan login ulang.');
    end if;

    -- Verifikasi pemanggil adalah murid yang menjabat (pengurus) pada p_ekskul.
    select jabatan_ekskul_map into v_jabatan_map
    from akun
    where nis_nip = v_pengurus and tipe = 'murid';

    if v_jabatan_map is null or coalesce(trim(coalesce(v_jabatan_map->>p_ekskul, '')), '') = '' then
      return json_build_object('status', 'error', 'message', 'Hanya pengurus (menjabat) ekskul ini yang dapat mendaftarkan anggota baru.');
    end if;
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

grant execute on function daftar_anggota_ekskul_baru(text, text, jsonb, text) to anon, authenticated;

-- ========== 5. SIMPAN / HAPUS DATA WAJAH MURID ==========
-- Versi asli: upgrade_20261023_wajah_motor_mediapipe.sql
-- Otorisasi memakai SESI: admin; murid pemilik token; guru wali/pembina
-- (lewat fn_is_guru() + akun_guru_ampu_murid) — parameter pemanggil dari klien
-- tidak lagi menjadi bukti identitas.
drop function if exists simpan_wajah_murid(text, jsonb, text, text, text, text);

create or replace function simpan_wajah_murid(
  p_nis text,
  p_descriptor jsonb default null,
  p_status text default 'aktif',
  p_pemanggil_nis text default null,
  p_pemanggil_tipe text default null,
  p_mode text default 'ganti',
  p_token text default ''
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ada boolean;
  v_list jsonb;
  v_lama jsonb;
  v_baru jsonb;
  v_jumlah int;
  v_jumlah_lama int;
  v_i int;
  v_j int;
  v_sampel jsonb;
  v_elemen jsonb;
  v_sesi text;
begin
  p_nis := trim(coalesce(p_nis, ''));
  p_status := lower(trim(coalesce(p_status, '')));
  p_mode := lower(trim(coalesce(p_mode, 'ganti')));

  if p_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;

  select exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') into v_ada;
  if not v_ada then
    return json_build_object('status', 'error', 'message', 'Data murid tidak ditemukan.');
  end if;

  -- Otorisasi berbasis sesi (lihat header file).
  -- Fallback klaim NIS dikosongkan (parameter `p_pemanggil_nis` hanya untuk
  -- kompatibilitas signature) → identitas HANYA dari sesi.
  v_sesi := fn_akses_murid(p_token, '');
  if not fn_is_admin()
     and not (v_sesi is not null and v_sesi = p_nis)
     and not (fn_is_guru() and akun_guru_ampu_murid(fn_nis(), p_nis)) then
    return json_build_object('status', 'error', 'message', 'Tidak berhak mengubah data wajah murid ini.');
  end if;

  -- ===== Normalisasi + validasi p_descriptor (dimensi 128 ATAU 512) =====
  if p_descriptor is not null then
    if jsonb_typeof(p_descriptor) <> 'array' then
      return json_build_object('status', 'error', 'message', 'Deskriptor wajah harus berupa array 128 ATAU 512 angka (atau array dari array semacam itu).');
    end if;
    -- Klien kan nog steeds plat vektor 128/512 sturen → wrap eenmaal.
    if jsonb_array_length(p_descriptor) in (128, 512) and jsonb_typeof(p_descriptor -> 0) = 'number' then
      v_list := jsonb_build_array(p_descriptor);
    else
      v_list := p_descriptor;
    end if;

    v_jumlah := jsonb_array_length(v_list);
    if v_jumlah < 1 then
      return json_build_object('status', 'error', 'message', 'Minimal satu sampel wajah diperlukan.');
    end if;
    if p_mode = 'tambah' and v_jumlah <> 1 then
      return json_build_object('status', 'error', 'message', 'Mode tambah menerima tepat satu sampel (array 128 ATAU 512 angka).');
    end if;
    if p_mode = 'ganti' and v_jumlah > 6 then
      return json_build_object('status', 'error', 'message', 'Maksimal 6 sampel wajah per murid (' || v_jumlah || ' diberikan).');
    end if;

    for v_i in 0 .. v_jumlah - 1 loop
      v_sampel := v_list -> v_i;
      if jsonb_typeof(v_sampel) <> 'array' or jsonb_array_length(v_sampel) not in (128, 512) then
        return json_build_object('status', 'error', 'message', 'Setiap sampel wajah harus berupa array 128 ATAU 512 angka.');
      end if;
      for v_j in 0 .. jsonb_array_length(v_sampel) - 1 loop
        v_elemen := v_sampel -> v_j;
        if jsonb_typeof(v_elemen) not in ('number') or not (v_elemen #>> '{}')::double precision between -10 and 10 then
          return json_build_object('status', 'error', 'message', 'Deskriptor wajah berisi nilai tidak valid.');
        end if;
      end loop;
    end loop;
  end if;

-- ===== Terapkan =====
  if p_status = 'aktif' and p_descriptor is not null then
    if p_mode = 'tambah' then
      select coalesce(wajah_descriptor, '[]'::jsonb) into v_lama
        from akun where nis_nip = p_nis and tipe = 'murid';
      -- Baris lama die nog plat is (128/512) → wrap eerst voor append.
      if jsonb_typeof(v_lama) = 'array' and jsonb_array_length(v_lama) in (128, 512) and jsonb_typeof(v_lama -> 0) = 'number' then
        v_lama := jsonb_build_array(v_lama);
      end if;
      if jsonb_typeof(v_lama) <> 'array' then
        v_lama := '[]'::jsonb;
      end if;
      v_jumlah_lama := jsonb_array_length(v_lama);
      if v_jumlah_lama + 1 > 6 then
        return json_build_object('status', 'error', 'message', 'Maksimal 6 sampel wajah per murid — gunakan mode ganti untuk mengganti seluruh data.');
      end if;
      v_baru := v_lama || v_list;
      update akun
         set wajah_descriptor = v_baru,
             wajah_status     = 'aktif'
       where nis_nip = p_nis and tipe = 'murid';
      return json_build_object('status', 'success', 'message', 'Data wajah murid tersimpan (' || jsonb_array_length(v_baru) || ' sampel).');
    else
      update akun
         set wajah_descriptor = v_list,
             wajah_status     = 'aktif'
       where nis_nip = p_nis and tipe = 'murid';
      return json_build_object('status', 'success', 'message', 'Data wajah murid tersimpan (' || jsonb_array_length(v_list) || ' sampel).');
    end if;
  elsif p_status = 'nonaktif' then
    update akun
       set wajah_status = 'nonaktif'
     where nis_nip = p_nis and tipe = 'murid';
    return json_build_object('status', 'success', 'message', 'Data wajah murid dinonaktifkan.');
  else
    -- hapus total (p_status NULL/'' of p_descriptor NULL)
    update akun
       set wajah_descriptor = null,
           wajah_status     = null
     where nis_nip = p_nis and tipe = 'murid';
    return json_build_object('status', 'success', 'message', 'Data wajah murid dihapus.');
  end if;
end $$;

grant execute on function simpan_wajah_murid(text, jsonb, text, text, text, text, text) to anon, authenticated;

-- ========== 6. UBAH ANGGOTA EKSKUL (tambah/buang, per TA + semester) ==========
-- Versi asli: upgrade_20261021_ekskul_riwayat_semester.sql
-- Identitas pemanggil diambil dari sesi (JWT staf / token murid), bukan
-- dari parameter — lalu aturan per-tipe di bawah dinilai atas identitas itu.
drop function if exists ubah_anggota_ekskul(text, text, text[], boolean, text, text[]);

create or replace function ubah_anggota_ekskul(
  p_pemanggil text,
  p_ekskul text,
  p_nis_list text[],
  p_tambah boolean,
  p_ta text default null,
  p_smt text[] default null,
  p_token text default ''
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pemanggil text;
  v_tipe text;
  v_jabatan_map jsonb;
  v_wali_kelas text;
  v_ekstra text;
  v_nis text;
  v_ekstra_siswa text;
  v_baru text;
  v_ta text;
  v_total int := 0;
  v_riwayat jsonb;
  v_entri jsonb;
  v_eks_riwayat text;
  v_baru_riwayat text;
  v_jmap jsonb;
  v_smt jsonb;
  v_teks_smt text;
  v_smt_bersih text[] := array[]::text[];
  v_smt_entri text[];
begin

  -- 0) TA berjalan: parameter eksplisit, atau turunkan dari Master Data
  v_ta := coalesce(nullif(trim(coalesce(p_ta, '')), ''), (
    select min(m."Tahun Pelajaran")::text from master_data m
    where m."Tahun Pelajaran" is not null and trim(m."Tahun Pelajaran"::text) <> ''
  ), to_char(now() at time zone 'Asia/Jakarta', 'YYYY') || '/' ||
       to_char((now() at time zone 'Asia/Jakarta') + interval '1 year', 'YYYY'));

  -- 0a) Semester yang akan ditandai (hanya Ganjil/Genap; abaikan lainnya)
  if p_smt is not null then
    select array_agg(x) into v_smt_bersih
    from unnest(p_smt) as x
    where trim(coalesce(x, '')) in ('Ganjil', 'Genap');
  end if;
  v_smt_bersih := coalesce(v_smt_bersih, array[]::text[]);

  -- 1) Identitas pemanggil — DARI SESI, bukan dari parameter.
  if fn_role() in ('admin', 'guru') then
    v_pemanggil := fn_nis();
  else
    -- Fallback klaim NIS dikosongkan (parameter `p_pemanggil` hanya untuk
    -- kompatibilitas signature) → identitas HANYA dari sesi.
    v_pemanggil := fn_akses_murid(p_token, '');
    if coalesce(trim(coalesce(v_pemanggil, '')), '') = '' then
      return json_build_object('status', 'error', 'message', 'Sesi tidak valid. Silakan login ulang.');
    end if;
  end if;

  select tipe, jabatan_ekskul_map, wali_kelas, ekstrakurikuler
  into v_tipe, v_jabatan_map, v_wali_kelas, v_ekstra
  from akun
  where nis_nip = v_pemanggil;

  if not found then
    return json_build_object('status', 'error', 'message', 'Akun pemanggil tidak ditemukan.');
  end if;

  -- 2) Verifikasi hak akses per tipe
  if v_tipe = 'admin' then
    null;
  elsif v_tipe = 'guru' then
    if coalesce(trim(coalesce(v_wali_kelas, '')), '') = ''
       and not (lower(trim(p_ekskul)) = any (
            select lower(trim(x))
            from unnest(string_to_array(coalesce(v_ekstra, ''), ',')) as t(x)
            where trim(x) <> ''
          ))
    then
      return json_build_object('status', 'error', 'message',
        'Hanya wali kelas atau pembina ' || p_ekskul || ' yang dapat mengubah anggota.');
    end if;
  elsif v_tipe = 'murid' then
    if v_jabatan_map is null or coalesce(trim(coalesce(v_jabatan_map->>p_ekskul, '')), '') = '' then
      return json_build_object('status', 'error', 'message', 'Hanya pengurus (menjabat) ' || p_ekskul || ' yang dapat mengubah anggota.');
    end if;
  else
    return json_build_object('status', 'error', 'message', 'Tipe akun pemanggil tidak dikenal.');
  end if;

  -- 3) Terapkan per NIS (gabung/buang nama ekskul, anti-duplikat) → kolom live + riwayat_ekskul[TA]
  if p_nis_list is null then
    p_nis_list := array[]::text[];
  end if;

  foreach v_nis in array p_nis_list loop
    if trim(coalesce(v_nis, '')) = '' then continue; end if;

    select ekstrakurikuler, coalesce(riwayat_ekskul, '{}'::jsonb)
    into v_ekstra_siswa, v_riwayat
    from akun
    where nis_nip = v_nis and tipe = 'murid'
    for update;

    if not found then continue; end if;

    -- a) Kolom live akun.ekstrakurikuler
    if p_tambah then
      if lower(trim(p_ekskul)) = any (
        select lower(trim(x)) from unnest(string_to_array(coalesce(v_ekstra_siswa, ''), ',')) as x where trim(x) <> ''
      ) then
        v_baru := v_ekstra_siswa;
      else
        v_baru := case
          when coalesce(trim(v_ekstra_siswa), '') = '' then trim(p_ekskul)
          else trim(v_ekstra_siswa) || ',' || trim(p_ekskul)
        end;
      end if;
    else
      select string_agg(x, ',') into v_baru
      from (
        select trim(x) as x
        from unnest(string_to_array(coalesce(v_ekstra_siswa, ''), ',')) as t(x)
        where trim(x) <> '' and lower(trim(x)) <> lower(trim(p_ekskul))
      ) s;
      v_baru := coalesce(v_baru, '');
    end if;

    -- b) Entri riwayat_ekskul[TA]
    v_entri := coalesce(v_riwayat->v_ta, '{}'::jsonb);
    v_eks_riwayat := coalesce(nullif(trim(coalesce(v_entri->>'ekskul', '')), ''), v_ekstra_siswa);
    if p_tambah then
      if lower(trim(p_ekskul)) = any (
        select lower(trim(x)) from unnest(string_to_array(v_eks_riwayat, ',')) as x where trim(x) <> ''
      ) then
        v_baru_riwayat := v_eks_riwayat;
      else
        v_baru_riwayat := case
          when coalesce(trim(v_eks_riwayat), '') = '' then trim(p_ekskul)
          else trim(v_eks_riwayat) || ',' || trim(p_ekskul)
        end;
      end if;
    else
      select string_agg(x, ',') into v_baru_riwayat
      from (
        select trim(x) as x
        from unnest(string_to_array(v_eks_riwayat, ',')) as t(x)
        where trim(x) <> '' and lower(trim(x)) <> lower(trim(p_ekskul))
      ) s;
      v_baru_riwayat := coalesce(v_baru_riwayat, '');
    end if;

    v_jmap := coalesce((v_entri->>'jabatan_map')::jsonb, coalesce(v_jabatan_map, '{}'::jsonb));
    v_jmap := coalesce(v_jmap, '{}'::jsonb);

    -- SEMESTER: gabungkan (union) semester yang sudah ada + yang baru untuk p_ekskul.
    --   smt[ekskul] = [Ganjil, Genap] → siswa ikut di kedua semester (skenario B).
    --   Menambah anggota tanpa p_smt → smt[ekskul] dibiarkan polos (kedua semester).
    v_smt := coalesce((v_entri->>'smt')::jsonb, '{}'::jsonb);
    if v_smt = 'null'::jsonb then v_smt := '{}'::jsonb; end if;
    v_teks_smt := coalesce(v_smt->>p_ekskul, '');
    v_smt_entri := array(
      select trim(x) from unnest(string_to_array(v_teks_smt, ',')) as t(x)
      where trim(x) in ('Ganjil', 'Genap')
    );
    if array_length(v_smt_bersih, 1) > 0 then
      select array_agg(distinct y) into v_smt_entri
      from (
        select unnest(v_smt_entri) as y
        union
        select unnest(v_smt_bersih)
      ) s;
    end if;

    update akun
       set ekstrakurikuler = v_baru,
           riwayat_ekskul = jsonb_set(
              coalesce(v_riwayat, '{}'::jsonb),
              array[v_ta],
              jsonb_build_object(
                'ekskul', v_baru_riwayat,
                'jabatan_map', v_jmap,
                'status', 'Aktif',
                'smt', case
                  when array_length(v_smt_entri, 1) > 0
                    then jsonb_set(coalesce(v_smt, '{}'::jsonb), array[p_ekskul], to_jsonb(v_smt_entri))
                  else v_smt
                end
              )
           )
     where nis_nip = v_nis;

    v_total := v_total + 1;
  end loop;

  return json_build_object('status', 'success', 'total', v_total);
end $$;

grant execute on function ubah_anggota_ekskul(text, text, text[], boolean, text, text[], text) to anon, authenticated;

-- ============================================================
-- IZIN TAMBAHAN + VERIFIKASI + RELOAD CACHE SKEMA POSTGREST
-- ============================================================
do $$
declare v_n integer;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('ubah_profil_murid','ubah_password_sendiri','simpan_wajah_murid',
                       'ubah_anggota_ekskul','daftar_anggota_ekskul_baru','ganti_kunci_absen_ekskul')
     and p.pronargs = case p.proname
           when 'ubah_profil_murid'         then 3
           when 'ubah_password_sendiri'     then 4
           when 'simpan_wajah_murid'        then 7
           when 'ubah_anggota_ekskul'       then 7
           when 'daftar_anggota_ekskul_baru' then 4
           when 'ganti_kunci_absen_ekskul'  then 5
         end;
  raise notice 'INFO: %/6 RPC murid berbasis token terpasang (harus 6 — bila <6, cek error DROP/cast di atas).', v_n;
end $$;

notify pgrst, 'reload schema';
