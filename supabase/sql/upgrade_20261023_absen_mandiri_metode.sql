-- ============================================================
-- UPGRADE: ABSEN MANDIRI — DUA METODE: KODE CAPTCHA / FACE SCAN NIS
-- 2026-10-23
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Sejak upgrade_20261014c/14d, absen mandiri murid SIEMPRE memerlukan kode
--   captcha (zelf bij wajah): `absen_mandiri` mengembali 'Kode captcha wajib
--   diisi' bila p_captcha = '' en web/js/app.js blokkeerde jalankanAbsenMandiri
--   saat wajah cocok maar input captcha kosong. Gevolg: face scan is alleen
--   een "opsional extra" naast captcha — geen zelfstandige metode. Aanvraag:
--   siswa kiest EEN van DUA metode, allebei menulis 'H' (hadir) di absensi.
--
-- SOLUSI:
--   Metode 1 — Kode Captcha dari Guru   : kode invullen → hadir (flow lama).
--   Metode 2 — Face Scan sesuai akun NIS: scan wajah → cocok met eigen
--     descriptor (face.js single-label matcher, NIS eigen) → hadir DIRECT
--     tercatat ZONDER kode captcha.
--   `absen_mandiri` dibuat ulang met ZELFDE signature (11 param) maar validasi
--   captcha wordt VOORWAARDELIJK:
--     * p_captcha = ''  mag ALLEEN wanneer p_wajah_cocok = true;
--     * p_captcha <> '' → kode moet exact matchen (hoofdletters) zoals voorheen;
--     * in BEIDE methoden blijft de SESSIE-GATE verplicht: er moet een
--       guru/admin zijn met kunci_absen='BUKA' voor dit mapel/ekstrakurikuler.
--     * p_tanggal van browser blijft DIIGNOR (tanggal altijd WIB server).
--
-- Trust-model (zelfde als bestaande p_wajah_cocok): wajah-match gebeurt
-- client-side (face.js) tussen ingelogde NIS en zijn eigen geregistreerde
-- descriptor; foto's worden nooit verzonden. Geofence GPS (wanneer
-- geconfigureerd) en de sessie BUKA blijven gehandhaafd in beide methoden.
--
-- Semua idempotent — aman dijalankan berulang. Data lama niet aangeraakt.
-- ============================================================

-- ========== 1. SELF-HEALING KOLOM ==========
alter table absensi add column if not exists gps text default '';
alter table absensi add column if not exists metode text default 'Manual / QR';
alter table absensi add column if not exists wajah_cocok boolean not null default false;

-- ========== 2. RLS + GRANT TABEL ABSENSI (kembalikan ke baseline) ==========
-- Murid lokal memakai anon key — absen mandiri kini lewat RPC, maar SELECT
-- blijft open voor anon (dashboard/laporan murid lezen) en schrijven blijft
-- open voor authenticated (guru/admin via save_absen_masal).
alter table absensi enable row level security;

drop policy if exists "absensi_baca_semua" on absensi;
create policy "absensi_baca_semua" on absensi
  for select using (true);

drop policy if exists "absensi_tulis_semua" on absensi;
create policy "absensi_tulis_semua" on absensi
  for insert with check (true);

drop policy if exists "absensi_ubah_semua" on absensi;
create policy "absensi_ubah_semua" on absensi
  for update using (true) with check (true);

drop policy if exists "absensi_hapus_semua" on absensi;
create policy "absensi_hapus_semua" on absensi
  for delete using (true);

revoke all on table absensi from anon, authenticated;
grant select, insert, update, delete on absensi to anon, authenticated;

-- ========== 3. RPC ABSEN MANDIRI v3 — CAPTCHA VOORWAARDELIJK ==========
drop function if exists absen_mandiri(text, text, text, text, text, text, text, text, boolean, date, text);

create or replace function absen_mandiri(
  p_nis text,
  p_nama text,
  p_kelas text,
  p_tahun text,
  p_bulan text,
  p_mapel text,
  p_captcha text,
  p_gps text,
  p_wajah_cocok boolean default false,
  p_tanggal date default null,   -- DITERIMA voor compatibilitas klien lama, TAPI DIIGNOR
  p_jenis text default 'Mapel'   -- 'Mapel' | 'Ekskul' → bepaalt bucket kelas
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tanggal date;
  v_tahun_tgl int;
  v_bulan text;
  v_semester text;
  v_tahun text;
  v_ketemu boolean;
  v_sesi_buka boolean;
  v_metode text;
  v_kelas text := '';
  v_nama text := '';
  v_jenis text;
  v_riwayat jsonb;
  arr_bulan text[] := '{"Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"}';
begin
  -- Normalisasi masukan (pola 14c): captcha & mapel di-trim, captcha di-upper-case
  p_nis     := trim(coalesce(p_nis, ''));
  p_mapel   := trim(coalesce(p_mapel, ''));
  p_captcha := upper(trim(coalesce(p_captcha, '')));

  v_jenis := upper(coalesce(nullif(trim(p_jenis), ''), 'MAPEL'));
  if v_jenis not in ('MAPEL', 'EKSKUL') then
    return json_build_object('status', 'error', 'message', 'Jenis absen tidak valid (Mapel atau Ekskul).');
  end if;

  if p_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;
  if p_mapel = '' then
    return json_build_object('status', 'error', 'message', 'Pilih mata pelajaran / ekstrakurikuler terlebih dahulu.');
  end if;

  -- Identitas murid + data akun (nama & riwayat kelas DARI SERVER)
  select m.nama_lengkap, coalesce(m.riwayat_kelas, '{}'::jsonb)
    into v_nama, v_riwayat
    from akun m
   where m.nis_nip = p_nis and m.tipe = 'murid';
  if not found then
    return json_build_object('status', 'error', 'message', 'Akun murid tidak ditemukan.');
  end if;
  v_nama := coalesce(nullif(trim(v_nama), ''), p_nama);

  -- Tanggal: SELALU hari ini WIB (Asia/Jakarta) — p_tanggal dari browser DIIGNOR
  v_tanggal   := (now() at time zone 'Asia/Jakarta')::date;
  v_tahun_tgl := extract(year from v_tanggal);

  -- Bulan label (nama bulan Indonesia) — dipakai konsistensi pelaporan
  v_bulan := nullif(trim(coalesce(p_bulan, '')), '');
  if v_bulan is null or array_position(arr_bulan, v_bulan) is null then
    v_bulan := arr_bulan[extract(month from v_tanggal)::int];
  end if;

  -- Tahun Pelajaran: pakai label klien bila format YYYY/YYYY en bevat huidig
  -- of volgend jaar; anders afleiden van de datum.
  v_tahun := nullif(trim(coalesce(p_tahun, '')), '');
  begin
    if v_tahun is null
       or v_tahun !~ '^[0-9]{4}/[0-9]{4}$'
       or ((split_part(v_tahun, '/', 1))::int not in (v_tahun_tgl, v_tahun_tgl + 1)
           and (split_part(v_tahun, '/', 2))::int not in (v_tahun_tgl, v_tahun_tgl + 1)) then
      v_tahun := v_tahun_tgl || '/' || (v_tahun_tgl + 1);
    end if;
  exception when others then
    v_tahun := v_tahun_tgl || '/' || (v_tahun_tgl + 1);
  end;

  -- KELAS: ditentukan SERVER met logica die exact identiek is aan
  -- get_dashboard_data (web/js/utils.example.js):
  --   * Ekskul → 'Semua Kelas' (rekap guru memakai .eq('kelas','Semua Kelas'))
  --   * Mapel  → riwayat_kelas[p_tahun].kelas; bila belum ada riwayat utk TA
  --              tsb, pakai tingkat_kelas (p_kelas van sessie). Siswa non-Aktif
  --              op TA wordt geweigerd (zelfde filter statusSiswa !== 'Aktif').
  if v_jenis = 'EKSKUL' then
    v_kelas := 'Semua Kelas';
    -- Keanggotaan: murid moet in akun.ekstrakurikuler staan
    if not exists (
      select 1
        from unnest(string_to_array(coalesce(
          (select m.ekstrakurikuler from akun m where m.nis_nip = p_nis and m.tipe = 'murid')
        , ''), ',')) u
       where upper(trim(u)) = upper(trim(p_mapel))
    ) then
      return json_build_object('status', 'error', 'message', 'Siswa bukan anggota ekstrakurikuler ' || p_mapel || '.');
    end if;
  else
    if v_riwayat ? v_tahun then
      if coalesce(v_riwayat->v_tahun->>'status', 'Aktif') <> 'Aktif' then
        return json_build_object('status', 'error', 'message', 'Siswa berstatus tidak aktif pada tahun pelajaran ' || v_tahun || '.');
      end if;
      v_kelas := coalesce(nullif(v_riwayat->v_tahun->>'kelas', ''), '');
    else
      v_kelas := coalesce(p_kelas, '');
    end if;
    if v_kelas = '' then
      return json_build_object('status', 'error', 'message', 'Kelas efektif siswa untuk ' || v_tahun || ' tidak ditemukan (riwayat_kelas/tingkat_kelas). Hubungi admin.');
    end if;
  end if;

  -- SESSIE-GATE (BEIDE METHODEN): guru/admin met kunci_absen 'BUKA' die dit
  -- mapel/ekstrakurikuler diampu. Zonder open sessie wordt hadir in GEEN van
  -- beide methoden geschreven — captcha alleen is dus nooit voldoende.
  select exists (
    select 1 from akun g
     where g.tipe in ('guru', 'admin')
       and g.kunci_absen = 'BUKA'
       and (g.mapel ilike '%' || p_mapel || '%' or g.ekstrakurikuler ilike '%' || p_mapel || '%')
  ) into v_sesi_buka;

  if not coalesce(v_sesi_buka, false) then
    return json_build_object('status', 'error', 'message', 'Sesi absen belum dibuka guru untuk ' || p_mapel || '.');
  end if;

  -- CAPTCHA VOORWAARDELIJK DI SERVER (kolom akun.captcha wordt nooit client
  -- gelezen):
  --   * Metode 1 (p_captcha <> ''): kode MOET exact matchen (hoofdletters) met
  --     een BUKA-guru/admin die dit mapel/ekstrakurikuler diampu;
  --   * Metode 2 (p_captcha = ''): ALLEEN toegestaan wanneer p_wajah_cocok =
  --     true (face scan van de leerling op zijn EIGEN NIS-descriptor).
  if p_captcha = '' then
    if not coalesce(p_wajah_cocok, false) then
      return json_build_object('status', 'error', 'message', 'Kode captcha wajib diisi.');
    end if;
  else
    select exists (
      select 1 from akun g
       where g.tipe in ('guru', 'admin')
         and g.kunci_absen = 'BUKA'
         and upper(coalesce(g.captcha, '')) = p_captcha
         and (g.mapel ilike '%' || p_mapel || '%' or g.ekstrakurikuler ilike '%' || p_mapel || '%')
    ) into v_ketemu;

    if not coalesce(v_ketemu, false) then
      return json_build_object('status', 'error', 'message', 'Captcha salah atau sesi absen belum dibuka guru.');
    end if;
  end if;

  v_metode := case when coalesce(p_wajah_cocok, false)
    then 'Absen Mandiri (Wajah+GPS)' else 'Absen Mandiri (GPS)' end;

  insert into absensi
    (nis, nama, tanggal, status, keterangan, mapel, ekskul, kelas, tahun, semester, bulan, metode, gps, wajah_cocok)
  values
    (p_nis, v_nama, v_tanggal, 'H', '', p_mapel, p_mapel, v_kelas, v_tahun, v_semester, v_bulan, v_metode, p_gps, coalesce(p_wajah_cocok, false))
  on conflict (nis, tanggal, mapel) do update set
    nama        = excluded.nama,
    status      = 'H',
    keterangan  = '',
    kelas       = excluded.kelas,
    tahun       = excluded.tahun,
    semester    = excluded.semester,
    bulan       = excluded.bulan,
    metode      = excluded.metode,
    gps         = excluded.gps,
    wajah_cocok = excluded.wajah_cocok;

  return json_build_object(
    'status',   'success',
    'tanggal',  to_char(v_tanggal, 'YYYY-MM-DD'),
    'bulan',    v_bulan,
    'semester', v_semester,
    'tahun',    v_tahun,
    'kelas',    v_kelas,
    'jenis',    v_jenis,
    'metode',   v_metode
  );
end $$;

-- ========== 4. IZIN EKSEKUSI + RELOAD CACHE ==========
grant execute on function absen_mandiri(text, text, text, text, text, text, text, text, boolean, date, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ========== 5. VERIFIKASI CEPAT (opsional) ==========
-- Na frontend-deploy & een murid die opnieuw absenteeert, moet de nieuwe rij
-- het juiste bucket gebruiken (Ekskul → 'Semua Kelas'; Mapel → effectieve klas
-- van het schooljaar):
--   select nis, nama, tanggal, mapel, kelas, tahun, semester, bulan, metode
--     from absensi
--    where metode like 'Absen Mandiri%'
--      and tanggal >= date_trunc('month', (now() at time zone 'Asia/Jakarta')::date)
--    order by tanggal desc, nis;
--
-- TEST direct (vervang NIS/Naam/Kelas/TA/Mapel/CAPTCHA):
--   Metode 1 (captcha): select absen_mandiri('NIS','Naam','Kelas','TA','Oktober','Mapel','CAPTCHA','lat,lng',false,null,'Mapel');
--   Metode 2 (wajah):   select absen_mandiri('NIS','Naam','Kelas','TA','Oktober','Mapel','','lat,lng',true,null,'Mapel');
--   Captcha leeg + wajah_cocok false (moet 'Kode captcha wajib diisi.' geven):
--                       select absen_mandiri('NIS','Naam','Kelas','TA','Oktober','Mapel','','lat,lng',false,null,'Mapel');