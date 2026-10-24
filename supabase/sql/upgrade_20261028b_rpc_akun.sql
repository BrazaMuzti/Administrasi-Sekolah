-- ============================================================
-- UPGRADE 20261028b: RPC TABEL `akun` (FASE B1 — RLS `akun` MASIH OFF)
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG
--   Sampai hari ini aplikasi membaca tabel `akun` langsung dari browser
--   (71 titik `supaClient.from('akun')`). Tabel itu RLS-nya OFF dan punya
--   `grant select … to anon`, sehingga siapa pun yang tahu anon key bisa
--   menarik seluruh data murid. Fase B memindahkan SEMUA baca/tulis `akun`
--   ke RPC SECURITY DEFINER di file ini, agar `upgrade_20261028c` bisa
--   MENGAKTIFKAN RLS ketat tanpa mematikan aplikasi.
--
-- ISI FILE
--   1) `fn_akun_export` + `fn_akun_json` — proyeksi kolom `akun` per-mode
--      (satu sumber kebenaran whitelist kolom yang dikirim ke browser).
--   2) Baca: identitas/login, daftar guru, daftar murid (8 mode),
--      profil akun, peta descriptor wajah, sesi absen, hitung akun.
--   3) Tulis: riwayat kelas/ekskul murid, keanggotaan & jabatan ekskul,
--      penugasan guru (massal), kunci/captcha absen.
--
-- OTORISASI
--   - admin/guru  : via Supabase Auth JWT → fn_role()/fn_is_admin()/fn_is_guru().
--   - murid lokal : via token sesi `sesi_lokal` (upgrade_20261028a_sesi_lokal_murid.sql).
--     Selama FASE B1/B2, klaim `p_klaim_nis` masih diterima lewat
--     `fn_akses_murid` demi kompatibilitas klien lama; FASE B2′
--     (`fix_20261028d_sesi_wajib.sql`) mematikannya untuk SEMUA RPC di sini
--     tanpa perlu menyentuh file ini.
--   Catatan: RPC daftar murid sengaja tetap dapat dibaca murid ber-sesi
--   (roster/absensi memang tampil di UI). Perlindungan terhadap query REST
--   liar datang dari RLS ketat `upgrade_20261028c`, bukan dari RPC ini.
--
-- PRASYARAT
--   Seluruh migrasi s/d `upgrade_20261027_role_hybrid_opsiC.sql` dan
--   `upgrade_20261028a_sesi_lokal_murid.sql` sudah dijalankan.
--
-- Idempotent — aman dijalankan berulang. Tanpa perubahan struktur tabel.
-- ============================================================

-- ============================================================
-- 0a. KOLOM EXPORT MURID (sama persis dengan KOLOM_EXPORT_MURID di app.js)
-- ============================================================
create or replace function fn_akun_export(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'user_id', a.user_id, 'nis_nip', a.nis_nip, 'nisn', a.nisn,
    'nama_lengkap', a.nama_lengkap, 'tingkat_kelas', a.tingkat_kelas,
    'riwayat_kelas', a.riwayat_kelas, 'jenis_kelamin', a.jenis_kelamin,
    'tgl_lahir', a.tgl_lahir, 'agama', a.agama, 'golongan_darah', a.golongan_darah,
    'ekstrakurikuler', a.ekstrakurikuler, 'jabatan', a.jabatan,
    'jabatan_ekskul', a.jabatan_ekskul, 'nama_ayah', a.nama_ayah,
    'pekerjaan_ayah', a.pekerjaan_ayah, 'nama_ibu', a.nama_ibu,
    'pekerjaan_ibu', a.pekerjaan_ibu, 'nama_wali', a.nama_wali, 'alamat', a.alamat,
    'no_telepon', a.no_telepon, 'email', a.email, 'catatan_khusus', a.catatan_khusus,
    'tahun_pelajaran', a.tahun_pelajaran, 'semester', a.semester,
    'url_foto', a.url_foto, 'alamat_maps', a.alamat_maps, 'media_sosial', a.media_sosial)
  from akun a
  where a.id = p_id
$$;

-- ============================================================
-- 0b. PROYEKSI KOLOM AKUN PER MODE (whitelist terpusat)
--     Mode dikelompokkan: profil/staf, murid daftar, murid potongan,
--     dan 'penuh' (= seluruh kolom, hanya untuk admin/guru terverifikasi).
-- ============================================================
create or replace function fn_akun_json(p_id uuid, p_mode text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case coalesce(nullif(trim(p_mode), ''), 'ringkas_murid')

    when 'penuh' then to_jsonb(a)

    -- ---------- profil staf/murid (whitelist 17 kolom; app.js bukaProfilAkun) ----------
    when 'profil_akun' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap,
      'gelar_depan', a.gelar_depan, 'gelar_belakang', a.gelar_belakang,
      'email', a.email, 'tingkat_kelas', a.tingkat_kelas, 'jabatan', a.jabatan,
      'wali_kelas', a.wali_kelas, 'mapel', a.mapel, 'ekstrakurikuler', a.ekstrakurikuler,
      'penugasan', a.penugasan, 'no_telepon', a.no_telepon,
      'jenis_kelamin', a.jenis_kelamin, 'agama', a.agama, 'nisn', a.nisn,
      'tipe', a.tipe, 'url_foto', a.url_foto)

    -- ---------- potongan kecil ----------
    when 'foto' then jsonb_build_object('url_foto', a.url_foto)
    when 'nis'  then jsonb_build_object('nis_nip', a.nis_nip)
    when 'jabatan_map' then jsonb_build_object(
      'jabatan_ekskul_map', coalesce(a.jabatan_ekskul_map, '{}'::jsonb))

    when 'identitas' then jsonb_build_object(
      'id', a.id, 'tipe', a.tipe, 'nis_nip', a.nis_nip, 'user_id', a.user_id,
      'email', a.email, 'nama_lengkap', a.nama_lengkap,
      'tingkat_kelas', a.tingkat_kelas, 'url_foto', a.url_foto)

    when 'wajah' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap,
      'tingkat_kelas', a.tingkat_kelas, 'url_foto', a.url_foto,
      'wajah_descriptor', a.wajah_descriptor, 'wajah_status', a.wajah_status)

    when 'peta_wajah' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'wajah_descriptor', a.wajah_descriptor,
      'wajah_status', a.wajah_status)

    -- ---------- guru/admin ----------
    when 'guru_ringkas' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap,
      'gelar_depan', a.gelar_depan, 'gelar_belakang', a.gelar_belakang)

    when 'guru_wali' then jsonb_build_object(
      'nama_lengkap', a.nama_lengkap, 'gelar_depan', a.gelar_depan,
      'gelar_belakang', a.gelar_belakang, 'wali_kelas', a.wali_kelas)

    when 'guru_kanal_absen' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap, 'mapel', a.mapel,
      'ekstrakurikuler', a.ekstrakurikuler, 'kunci_absen', a.kunci_absen)

    when 'guru_pembina' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap,
      'gelar_depan', a.gelar_depan, 'gelar_belakang', a.gelar_belakang,
      'no_telepon', a.no_telepon, 'ekstrakurikuler', a.ekstrakurikuler)

    when 'guru_penugasan' then jsonb_build_object(
      'id', a.id, 'nis_nip', a.nis_nip, 'penugasan', a.penugasan)

    when 'guru_penugasan_ringkas' then jsonb_build_object(
      'id', a.id, 'penugasan', a.penugasan)

    when 'guru_dashboard' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap, 'mapel', a.mapel,
      'ekstrakurikuler', a.ekstrakurikuler, 'wali_kelas', a.wali_kelas,
      'penugasan', a.penugasan, 'tingkat_kelas', a.tingkat_kelas,
      'captcha', a.captcha, 'kunci_absen', a.kunci_absen,
      'no_telepon', a.no_telepon, 'gelar_depan', a.gelar_depan,
      'gelar_belakang', a.gelar_belakang)

    -- ---------- murid: daftar ----------
    when 'list' then jsonb_build_object(
      'id', a.id, 'user_id', a.user_id, 'nis_nip', a.nis_nip, 'nisn', a.nisn,
      'nama_lengkap', a.nama_lengkap, 'tingkat_kelas', a.tingkat_kelas,
      'jabatan', a.jabatan, 'jabatan_ekskul', a.jabatan_ekskul, 'email', a.email,
      'ekstrakurikuler', a.ekstrakurikuler, 'tahun_pelajaran', a.tahun_pelajaran,
      'semester', a.semester, 'riwayat_kelas', a.riwayat_kelas, 'url_foto', a.url_foto)

    when 'export' then fn_akun_export(a.id)
    when 'cetak'  then fn_akun_export(a.id)
                        || jsonb_build_object('jabatan_ekskul_map', coalesce(a.jabatan_ekskul_map, '{}'::jsonb))

    when 'ringkas_murid' then jsonb_build_object(
      'id', a.id, 'nis_nip', a.nis_nip, 'nisn', a.nisn, 'nama_lengkap', a.nama_lengkap,
      'tingkat_kelas', a.tingkat_kelas, 'ekstrakurikuler', a.ekstrakurikuler,
      'riwayat_kelas', a.riwayat_kelas, 'tahun_pelajaran', a.tahun_pelajaran,
      'semester', a.semester)

    when 'ekskul_map' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'ekstrakurikuler', a.ekstrakurikuler,
      'riwayat_ekskul', a.riwayat_ekskul,
      'jabatan_ekskul_map', coalesce(a.jabatan_ekskul_map, '{}'::jsonb))

    when 'dashboard_murid' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nisn', a.nisn, 'nama_lengkap', a.nama_lengkap,
      'tingkat_kelas', a.tingkat_kelas, 'riwayat_kelas', a.riwayat_kelas,
      'jenis_kelamin', a.jenis_kelamin, 'agama', a.agama,
      'catatan_khusus', a.catatan_khusus, 'ekstrakurikuler', a.ekstrakurikuler,
      'jabatan', a.jabatan, 'jabatan_ekskul_map', coalesce(a.jabatan_ekskul_map, '{}'::jsonb),
      'riwayat_ekskul', a.riwayat_ekskul, 'tahun_pelajaran', a.tahun_pelajaran,
      'semester', a.semester, 'no_telepon', a.no_telepon)

    when 'anggota_ekskul' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap,
      'tingkat_kelas', a.tingkat_kelas, 'jabatan', a.jabatan,
      'no_telepon', a.no_telepon, 'tgl_lahir', a.tgl_lahir,
      'jabatan_ekskul_map', coalesce(a.jabatan_ekskul_map, '{}'::jsonb),
      'riwayat_ekskul', a.riwayat_ekskul, 'tahun_pelajaran', a.tahun_pelajaran)

    when 'pemilih' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap,
      'tingkat_kelas', a.tingkat_kelas, 'tahun_pelajaran', a.tahun_pelajaran,
      'ekstrakurikuler', a.ekstrakurikuler, 'jabatan', a.jabatan,
      'no_telepon', a.no_telepon)

    when 'pemilih_ringkas' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap,
      'tahun_pelajaran', a.tahun_pelajaran, 'tingkat_kelas', a.tingkat_kelas,
      'ekstrakurikuler', a.ekstrakurikuler)

    else to_jsonb(a)
  end
  from akun a
  where a.id = p_id
$$;

-- ============================================================
-- 1. IDENTITAS & LOGIN
-- ============================================================

-- 1a. Cari akun dari NIS/NIP ATAU email (dipakai login & fitur "lupa password").
--     Menggantikan 4 titik baca `akun` di klien: app.js:1216, app.js:11452,
--     utils.js:189 (tipe+email), utils.js:211 (nis_nip dari email).
--     Kolom yang keluar hanya mode 'identitas' (tanpa alamat/ortu/nilai).
create or replace function identitas_login(p_identifier text)
returns json
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_id   text := trim(coalesce(p_identifier, ''));
  v_rows jsonb;
begin
  if length(v_id) < 3 then
    return json_build_object('status', 'error', 'message', 'Identitas (NIS/NIP/email) terlalu pendek.');
  end if;

  select coalesce(jsonb_agg(x.value), '[]'::jsonb)
    into v_rows
    from (
      select fn_akun_json(a.id, 'identitas') as value
      from akun a
      where (position('@' in v_id) > 0 and lower(coalesce(a.email, '')) = lower(v_id))
         or (position('@' in v_id) = 0 and a.nis_nip = v_id)
      order by a.tipe, a.nama_lengkap
      limit 5
    ) x;

  return json_build_object(
    'status', 'success',
    'jumlah', jsonb_array_length(v_rows),
    'akun', v_rows
  );
end $$;

-- 1b. Profil baris `akun` milik SESI Supabase Auth (guru/admin/OAuth).
--     Menggantikan `select *` by user_id / by email di utils.js (4 titik).
--     Bila baris belum tertaut user_id tetapi email cocok → 'perlu_taut': true
--     (klien lalu memanggil taut_user_id_sesi).
create or replace function profil_sesi_auth(p_email text default '')
returns json
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_baris  akun%rowtype;
begin
  if v_uid is null then
    return json_build_object('status', 'error', 'message', 'Tidak ada sesi Supabase Auth.');
  end if;

  select * into v_baris from akun where user_id = v_uid limit 1;

  if v_baris.id is null then
    v_email := lower(coalesce(nullif(trim(p_email), ''), coalesce(auth.jwt() ->> 'email', '')));
    if v_email <> '' then
      select * into v_baris from akun
       where lower(coalesce(email, '')) = v_email
       order by (user_id is null) desc
       limit 1;
    end if;
  end if;

  if v_baris.id is null then
    return json_build_object(
      'status', 'error',
      'message', 'Akun Auth belum terhubung ke tabel akun. Hubungi admin.');
  end if;

  return json_build_object(
    'status', 'success',
    'perlu_taut', (v_baris.user_id is null),
    'akun', fn_akun_json(v_baris.id, 'penuh')
  );
end $$;

-- 1c. Tautkan baris `akun` (yang cocok email) ke user Auth yang sedang login.
--     Menggantikan `update akun set user_id = auth.uid()` langsung dari klien
--     (utils.js:248 & utils.js:284) — kini lewat SECURITY DEFINER yang
--     memverifikasi pemilik email dari JWT, bukan dari param bebas.
create or replace function taut_user_id_sesi(p_email text default '')
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_id     uuid;
  v_pemilik uuid;
begin
  if v_uid is null then
    return json_build_object('status', 'error', 'message', 'Tidak ada sesi Supabase Auth.');
  end if;

  select a.id into v_id from akun a where a.user_id = v_uid limit 1;
  if v_id is not null then
    return json_build_object('status', 'success', 'aksi', 'sudah_tertaut', 'id', v_id);
  end if;

  v_email := lower(coalesce(nullif(trim(p_email), ''), coalesce(auth.jwt() ->> 'email', '')));
  if v_email = '' then
    return json_build_object('status', 'error', 'message', 'Email sesi tidak tersedia.');
  end if;

  select a.id, a.user_id into v_id, v_pemilik
  from akun a
  where lower(coalesce(a.email, '')) = v_email
  order by (a.user_id is null) desc
  limit 1;

  if v_id is null then
    return json_build_object('status', 'error', 'message', 'Email tidak terdaftar pada tabel akun.');
  end if;
  if v_pemilik is not null and v_pemilik <> v_uid then
    return json_build_object('status', 'error', 'message', 'Email sudah tertaut ke akun Auth lain.');
  end if;

  update akun set user_id = v_uid where id = v_id;
  return json_build_object('status', 'success', 'aksi', 'ditautkan', 'id', v_id);
end $$;

-- ============================================================
-- 2. BACA DAFTAR & PROFIL
-- ============================================================

-- 2a. Daftar guru/admin per mode (menggantikan 10 titik baca di app.js/utils.js):
--     'guru_ringkas'   → app.js:24492, 29004, 15711 (dropdown guru)
--     'guru_wali'      → app.js:271 (peta wali kelas)
--     'guru_kanal_absen' → app.js:2096 (sesi absen yang BUKA)
--     'guru_pembina'   → app.js:17976 (pembina ekskul)
--     'guru_penugasan' → app.js:15310 (salin penugasan massal)
--     'guru_penugasan_ringkas' → app.js:16635 (duplikat tahun: penugasan)
--     'guru_dashboard' → utils.js:579 (get_dashboard_data)
--     'penuh'          → app.js:13449 / 14961 (Manajemen Akun Admin/Guru)
create or replace function ambil_daftar_guru(
  p_mode       text default 'guru_ringkas',
  p_tipe       text default 'guru',
  p_hanya_buka boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_mode text := coalesce(nullif(trim(p_mode), ''), 'guru_ringkas');
  v_tipe text;
  v_rows jsonb;
begin
  if not (fn_is_admin() or fn_is_guru()) then
    return '[]'::jsonb;
  end if;

  -- Default tipe per mode ('guru_wali', 'guru_kanal_absen' & 'guru_pembina'
  -- memang dipakai untuk guru + admin; mode lain memakai p_tipe).
  if p_tipe is null or trim(p_tipe) = '' then
    v_tipe := case when v_mode in ('guru_wali', 'guru_kanal_absen', 'guru_pembina') then '' else 'guru' end;
  else
    v_tipe := trim(p_tipe);
  end if;

  select coalesce(jsonb_agg(x.value order by x.nama asc nulls last), '[]'::jsonb)
    into v_rows
    from (
      select fn_akun_json(a.id, v_mode) as value, a.nama_lengkap as nama
      from akun a
      where (
              (v_tipe = '' and a.tipe in ('guru', 'admin'))
              or (v_tipe <> '' and a.tipe = v_tipe)
            )
        and (not p_hanya_buka or a.kunci_absen = 'BUKA')
    ) x;

  return v_rows;
end $$;

-- 2b. Daftar murid per mode (menggantikan 22 titik baca di app.js/utils.js):
--     'list'            → app.js:10097, 25391 (Data Akun Murid / cache rapor)
--     'export'          → app.js:10220, 10274, 11812, 11953, 12149, 12279
--     'cetak'           → app.js:10543 (form edit murid, + jabatan_ekskul_map)
--     'dashboard_murid' → utils.js:517 (get_dashboard_data)
--     'anggota_ekskul'  → app.js:173 (roster anggota ekskul, p_ekskul)
--     'pemilih'         → app.js:20640 (modal tambah anggota ekskul)
--     'pemilih_ringkas' → app.js:20799 (import daftar NIS massal)
--     'ekskul_map'      → app.js:21215 (migrasi keanggotaan antar TA)
--     'nis'             → app.js:13324 (cek NIS terdaftar saat import; p_nis_list)
create or replace function ambil_daftar_murid(
  p_mode      text default 'list',
  p_ekskul    text default '',
  p_nis_list  text[] default '{}',
  p_token     text default '',
  p_klaim_nis text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_mode   text := coalesce(nullif(trim(p_mode), ''), 'list');
  v_ekskul text := trim(coalesce(p_ekskul, ''));
  v_staf   boolean := (fn_is_admin() or fn_is_guru());
  v_rows   jsonb;
begin
  -- Staf (JWT admin/guru) ATAU murid dengan sesi lokal yang sah.
  if not v_staf and fn_akses_murid(p_token, p_klaim_nis) is null then
    return '[]'::jsonb;
  end if;

  -- Mode berisi data pribadi/ortu (nama orang tua, alamat, catatan khusus,
  -- nomor HP) hanya untuk staf terverifikasi lewat JWT.
  if not v_staf and v_mode in ('export', 'cetak', 'dashboard_murid', 'nis', 'penuh') then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(x.value order by x.nama asc nulls last), '[]'::jsonb)
    into v_rows
    from (
      select fn_akun_json(a.id, v_mode) as value, a.nama_lengkap as nama
      from akun a
      where a.tipe = 'murid'
        and (v_ekskul = '' or coalesce(a.ekstrakurikuler, '') ilike '%' || v_ekskul || '%')
        and (
              array_length(p_nis_list, 1) is null
              or a.nis_nip = any(p_nis_list)
            )
    ) x;

  return v_rows;
end $$;

-- 2c. Satu baris `akun` per mode (menggantikan baca 1-baris by nis/email/id):
--     'profil_akun'  → app.js:683, 687 (profil header)
--     'foto'         → app.js:774, 780, 1696, 1986 (foto avatar/id card)
--     'penuh'        → app.js:2374, 2571, 20124 (profil murid / kartu anggota)
--     'ringkas_murid'→ app.js:25404 (cari murid rapor)
--     'cetak'        → app.js:10543 (form edit murid lengkap)
--     'ekskul_map'   → app.js:21127 (hapus anggota: ekstrakurikuler+riwayat+jabatan)
--     'jabatan_map'  → app.js:20341 (kelola jabatan anggota ekskul)
--     'wajah'        → face.js:1298 (pendaftaran/verifikasi wajah 1 murid)
create or replace function ambil_akun_satu(
  p_nis_nip   text default '',
  p_email     text default '',
  p_id        text default '',
  p_mode      text default 'profil_akun',
  p_token     text default '',
  p_klaim_nis text default ''
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_mode   text := coalesce(nullif(trim(p_mode), ''), 'profil_akun');
  v_staf   boolean := (fn_is_admin() or fn_is_guru());
  v_sesi   text := fn_akses_murid(p_token, p_klaim_nis);  -- NIS pemilik sesi / NULL
  v_milik  boolean;
  v_publik boolean;
  v_pengurus boolean := false;
  v_baris  akun%rowtype;
begin
  select * into v_baris
  from akun a
  where (trim(coalesce(p_id, '')) <> '' and a.id::text = trim(p_id))
     or (trim(coalesce(p_nis_nip, '')) <> '' and a.nis_nip = trim(p_nis_nip))
     or (trim(coalesce(p_email, '')) <> '' and lower(coalesce(a.email, '')) = lower(trim(p_email)))
  order by (a.user_id is not null) desc, a.tipe
  limit 1;

  if v_baris.id is null then
    return json_build_object('status', 'error', 'message', 'Data akun tidak ditemukan.');
  end if;

  -- Sifat pemanggil (bila murid ber-sesi):
  --   v_publik   → mode yang isinya boleh dibaca untuk DIRINYA sendiri;
  --   v_pengurus → murid pemegang jabatan ekskul (kartu profil anggota ekskul,
  --                sejalan dengan bolehLihatKontakAnggotaEkskul() di app.js).
  v_publik := v_mode in ('profil_akun', 'foto', 'wajah', 'penuh', 'ringkas_murid', 'nis');
  v_milik  := (v_sesi is not null and v_baris.nis_nip = v_sesi);
  if v_sesi is not null then
    select coalesce(jabatan_ekskul, '') <> ''
           or (jabatan_ekskul_map is not null and jabatan_ekskul_map <> '{}'::jsonb)
      into v_pengurus
      from akun where nis_nip = v_sesi and tipe = 'murid';
    v_pengurus := coalesce(v_pengurus, false);
  end if;

  if not v_staf then
    if v_sesi is null then
      return json_build_object('status', 'error', 'message', 'Sesi tidak valid. Silakan login ulang.');
    end if;

    -- Mode khusus staf (form edit murid / ekspor) tidak boleh dari sesi murid.
    if v_mode in ('cetak', 'export', 'nis', 'list') then
      return json_build_object('status', 'error', 'message', 'Akses ditolak.');
    end if;

    -- Mode ekskul (roster/jabatan anggota): pemilik baris atau pengurus ekskul.
    if v_mode in ('ekskul_map', 'jabatan_map') and not (v_milik or v_pengurus) then
      return json_build_object('status', 'error', 'message', 'Akses ditolak.');
    end if;

    -- Mode publik: hanya barisnya sendiri ATAU (untuk anggota ekskul) pengurus.
    if v_publik and not (v_milik or v_pengurus) then
      return json_build_object('status', 'error', 'message', 'Akses ditolak.');
    end if;
  end if;

  return json_build_object('status', 'success', 'akun', fn_akun_json(v_baris.id, v_mode));
end $$;

-- 2d. Peta descriptor wajah (menggantikan face.js:786, 2023, 2301).
--     p_nis_list kosong = semua murid (scan massal). Murid ber-sesi boleh
--     membaca roster wajah sekolah (dipakai verifikasi absen & pengurus ekskul).
create or replace function ambil_peta_wajah(
  p_nis_list  text[] default '{}',
  p_aktif_saja boolean default false,
  p_token     text default '',
  p_klaim_nis text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_staf  boolean := (fn_is_admin() or fn_is_guru());
  v_boleh text[];
  v_rows  jsonb;
begin
  if v_staf then
    v_boleh := array(select a.nis_nip from akun a where a.tipe = 'murid');
  else
    v_boleh := fn_akses_murid_list(p_token, p_nis_list, p_klaim_nis);
  end if;

  if not v_staf and array_length(v_boleh, 1) is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(fn_akun_json(a.id, 'peta_wajah') order by a.nis_nip), '[]'::jsonb)
    into v_rows
    from akun a
   where a.tipe = 'murid'
     and a.wajah_descriptor is not null
     and (not p_aktif_saja or a.wajah_status = 'aktif')
     and (v_staf or a.nis_nip = any(v_boleh));

  return v_rows;
end $$;

-- 2e. Hitungan akun untuk Guru Dashboard (app.js:17492-17493 pakai count head:true).
create or replace function hitung_akun()
returns json
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_hasil json;
begin
  if not (fn_is_admin() or fn_is_guru()) then
    return json_build_object('murid', 0, 'guru', 0, 'admin', 0);
  end if;

  select json_build_object(
           'murid', count(*) filter (where a.tipe = 'murid'),
           'guru',  count(*) filter (where a.tipe = 'guru'),
           'admin', count(*) filter (where a.tipe = 'admin'))
    into v_hasil
    from akun a;

  return v_hasil;
end $$;

-- 2f. Validasi sesi absen mandiri (menggantikan fallback baca `akun` di
--     utils.js:399-413: kolom captcha/kunci_absen guru pembuka sesi).
--     Captcha DIBANDINGKAN DI SERVER — klien tidak lagi perlu kolom itu.
create or replace function cek_sesi_absen(
  p_mapel     text,
  p_captcha   text default '',
  p_token     text default '',
  p_klaim_nis text default ''
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_mapel   text := trim(coalesce(p_mapel, ''));
  v_captcha text := trim(coalesce(p_captcha, ''));
  v_sesi    text;
  v_buka    boolean;
  v_cocok   boolean;
  v_jumlah  integer;
begin
  if not (fn_is_admin() or fn_is_guru()) then
    v_sesi := fn_akses_murid(p_token, p_klaim_nis);
    if v_sesi is null then
      return json_build_object('status', 'error', 'message', 'Sesi tidak valid. Silakan login ulang.');
    end if;
  end if;

  select coalesce(bool_or(a.kunci_absen = 'BUKA'), false),
         coalesce(bool_or(a.kunci_absen = 'BUKA'
                          and upper(coalesce(a.captcha, '')) = upper(v_captcha)), false),
         count(*)::integer
    into v_buka, v_cocok, v_jumlah
    from akun a
   where a.tipe in ('guru', 'admin')
     and (coalesce(a.mapel, '') ilike '%' || v_mapel || '%'
          or coalesce(a.ekstrakurikuler, '') ilike '%' || v_mapel || '%');

  return json_build_object(
    'status', 'success',
    'sesi_buka', v_buka,
    'captcha_ok', (v_captcha <> '' and v_cocok),
    'jumlah', v_jumlah
  );
end $$;

-- ============================================================
-- 3. TULIS (riwayat, ekskul, penugasan, kunci absen)
-- ============================================================

-- 3a. Helper: pakai nilai baru bila benar-benar dikirim (JSON `null` dari klien
--     tetap dianggap "tidak diubah" — mencegah kolom terhapus tak sengaja).
create or replace function fn_jsonb_atau(p_baru jsonb, p_lama jsonb)
returns jsonb
language sql
immutable
as $$
  select case
           when p_baru is null or jsonb_typeof(p_baru) = 'null' then p_lama
           else p_baru
         end
$$;

-- 3b. Riwayat kelas & ekskul murid (menggantikan update akun di
--     app.js:12494 (dual-write TA aktif), 13407 (import murid),
--     12521 (dual-write riwayat ekskul), 21245 (migrasi keanggotaan antar TA)).
--     Hanya field yang dikirim yang berubah (null = abaikan).
create or replace function simpan_riwayat_murid(
  p_nis            text,
  p_riwayat_kelas  jsonb default null,
  p_tingkat_kelas  text default '',
  p_riwayat_ekskul jsonb default null,
  p_token          text default '',
  p_klaim_nis      text default ''
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis  text := trim(coalesce(p_nis, ''));
  v_staf boolean := (fn_is_admin() or fn_is_guru());
  v_sesi text;
  v_n    integer;
begin
  if v_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;

  v_sesi := fn_akses_murid(p_token, p_klaim_nis);
  if not v_staf and (v_sesi is null or v_sesi <> v_nis) then
    return json_build_object('status', 'error', 'message', 'Akses ditolak.');
  end if;

  if not exists (select 1 from akun where nis_nip = v_nis and tipe = 'murid') then
    return json_build_object('status', 'error', 'message', 'NIS murid tidak ditemukan.');
  end if;

  update akun
     set riwayat_kelas  = fn_jsonb_atau(p_riwayat_kelas, riwayat_kelas),
         tingkat_kelas  = coalesce(nullif(trim(coalesce(p_tingkat_kelas, '')), ''), tingkat_kelas),
         riwayat_ekskul = fn_jsonb_atau(p_riwayat_ekskul, riwayat_ekskul)
   where nis_nip = v_nis and tipe = 'murid';

  get diagnostics v_n = row_count;
  return json_build_object('status', 'success', 'baris', v_n);
end $$;

-- 3c. Keanggotaan & jabatan ekstrakurikuler (menggantikan update akun di
--     app.js:20539 (ubah anggota ekskul — fallback lama), 21158 (hapus
--     permanen anggota), 20348 (simpan jabatan anggota)).
--     Otorisasi: admin/guru ATAU murid pemegang jabatan ekskul tsb
--     (fn_akses_ekskul → 'tulis'). Murid biasa ditolak agar tidak bisa
--     menaikkan jabatan/keanggotaannya sendiri.
create or replace function simpan_ekskul_murid(
  p_nis                text,
  p_ekstrakurikuler    text default '',
  p_riwayat_ekskul     jsonb default null,
  p_jabatan_ekskul_map jsonb default null,
  p_ekskul             text default '',
  p_token              text default '',
  p_klaim_nis          text default ''
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis    text := trim(coalesce(p_nis, ''));
  v_ekskul text := trim(coalesce(p_ekskul, ''));
  v_akses  text;
  v_ada    boolean;
  v_n      integer;
begin
  if v_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;

  v_akses := fn_akses_ekskul(p_token, p_klaim_nis, v_ekskul);
  if coalesce(v_akses, '') <> 'tulis' then
    return json_build_object('status', 'error', 'message', 'Akses ditolak. Hanya admin/guru/pengurus ekskul yang boleh mengubah keanggotaan.');
  end if;

  select true into v_ada from akun where nis_nip = v_nis and tipe = 'murid';
  if v_ada is not true then
    return json_build_object('status', 'error', 'message', 'NIS murid tidak ditemukan.');
  end if;

  update akun
     set ekstrakurikuler    = coalesce(nullif(trim(coalesce(p_ekstrakurikuler, '')), ''), ekstrakurikuler),
         riwayat_ekskul     = fn_jsonb_atau(p_riwayat_ekskul, riwayat_ekskul),
         jabatan_ekskul_map = fn_jsonb_atau(p_jabatan_ekskul_map, jabatan_ekskul_map)
   where nis_nip = v_nis and tipe = 'murid';

  get diagnostics v_n = row_count;
  return json_build_object('status', 'success', 'baris', v_n);
end $$;

-- 3d. Penugasan guru (bulk) — menggantikan update akun di app.js:15318
--     (salin penugasan massal) & app.js:16641 (duplikat Tahun Pelajaran).
--     p_rows: [{ "id": <uuid>, "nis_nip": "<nip>", "penugasan": {...} }, …]
--     Hanya admin yang boleh mengubah penugasan guru.
create or replace function simpan_penugasan_guru(p_rows jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_r   jsonb;
  v_n   integer := 0;
  v_pn  jsonb;
  v_id  text;
  v_nis text;
begin
  if not fn_is_admin() then
    return json_build_object('status', 'error', 'message', 'Hanya admin yang boleh mengubah penugasan guru.');
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return json_build_object('status', 'error', 'message', 'Payload harus berupa array baris.');
  end if;

  for v_r in select value from jsonb_array_elements(p_rows) as t(value) loop
    v_pn  := v_r -> 'penugasan';
    v_id  := trim(coalesce(v_r ->> 'id', ''));
    v_nis := trim(coalesce(v_r ->> 'nis_nip', ''));

    if v_pn is null then continue; end if;

    if v_id <> '' then
      update akun set penugasan = v_pn where id::text = v_id and tipe = 'guru';
    elsif v_nis <> '' then
      update akun set penugasan = v_pn where nis_nip = v_nis and tipe = 'guru';
    else
      continue;
    end if;

    v_n := v_n + 1;
  end loop;

  return json_build_object('status', 'success', 'baris', v_n);
end $$;

-- 3e. Kunci/captcha absen guru (menggantikan update akun di app.js:4035 —
--     panel Kunci Absen guru sendiri — dan app.js:17902 — admin/ekskul).
--     Admin boleh menarget baris siapa pun; guru hanya barisnya sendiri
--     (dicocokkan lewat fn_nis() dari JWT, bukan dari param bebas).
--     Pengurus murid memakai RPC `ganti_kunci_absen_ekskul` yang sudah ada.
create or replace function simpan_kunci_absen(
  p_nis_nip text default '',
  p_captcha text default '',
  p_kunci   text default ''
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_target text := trim(coalesce(p_nis_nip, ''));
  v_kunci  text := upper(trim(coalesce(p_kunci, '')));
  v_cap    text := upper(trim(coalesce(p_captcha, '')));
  v_n      integer;
begin
  if v_target = '' then v_target := fn_nis(); end if;
  if v_target = '' then
    return json_build_object('status', 'error', 'message', 'NIS/NIP target tidak diketahui.');
  end if;

  if not fn_is_admin() and not (fn_is_guru() and v_target = fn_nis()) then
    return json_build_object('status', 'error', 'message', 'Akses ditolak.');
  end if;

  update akun
     set captcha     = coalesce(nullif(v_cap, ''), captcha),
         kunci_absen = case
                         when v_kunci = 'BUKA' then 'BUKA'
                         when v_kunci = 'TUTUP' then 'TUTUP'
                         else kunci_absen
                       end
   where nis_nip = v_target;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    return json_build_object('status', 'error', 'message', 'Baris akun dengan NIS/NIP tersebut tidak ditemukan.');
  end if;

  return json_build_object('status', 'success', 'baris', v_n);
end $$;

-- ============================================================
-- 4. IZIN EKSEKUSI
--    RPC di atas dipanggil dari browser: guru/admin memakai JWT Supabase,
--    murid memakai anon key + token sesi (param p_token).
-- ============================================================
grant execute on function identitas_login(text) to anon, authenticated;
grant execute on function profil_sesi_auth(text) to authenticated;
grant execute on function taut_user_id_sesi(text) to authenticated;

grant execute on function ambil_daftar_guru(text, text, boolean) to anon, authenticated;
grant execute on function ambil_daftar_murid(text, text, text[], text, text) to anon, authenticated;
grant execute on function ambil_akun_satu(text, text, text, text, text, text) to anon, authenticated;
grant execute on function ambil_peta_wajah(text[], boolean, text, text) to anon, authenticated;
grant execute on function hitung_akun() to authenticated;
grant execute on function cek_sesi_absen(text, text, text, text) to anon, authenticated;

grant execute on function simpan_riwayat_murid(text, jsonb, text, jsonb, text, text) to anon, authenticated;
grant execute on function simpan_ekskul_murid(text, text, jsonb, jsonb, text, text, text) to anon, authenticated;
grant execute on function simpan_penugasan_guru(jsonb) to authenticated;
grant execute on function simpan_kunci_absen(text, text, text) to authenticated;

-- ============================================================
-- 5. VERIFIKASI & RELOAD CACHE SKEMA POSTGREST
-- ============================================================
do $$
declare v_n integer;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fn_akun_export','fn_akun_json','fn_jsonb_atau',
                       'identitas_login','profil_sesi_auth','taut_user_id_sesi',
                       'ambil_daftar_guru','ambil_daftar_murid','ambil_akun_satu',
                       'ambil_peta_wajah','hitung_akun','cek_sesi_absen',
                       'simpan_riwayat_murid','simpan_ekskul_murid',
                       'simpan_penugasan_guru','simpan_kunci_absen');
  raise notice 'INFO: %/16 fungsi RPC akun terpasang (harus 16).', v_n;
end $$;

notify pgrst, 'reload schema';
