-- ============================================================
-- UPGRADE: RIWAYAT KEANGGOTAAN EKSTRAKURIKULER PER TAHUN PELAJARAN — 2026-10-20
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Keanggotaan siswa pada Ekstrakurikuler selama ini hanya tersimpan pada
--   kolom akun.ekstrakurikuler (daftar ekskul "live" siswa) TANPA dimensi
--   Tahun Pelajaran / angkatan. Akibatnya "Anggota Aktif" tidak berubah antar
--   tahun, dan menu Hadir Tatap Muka tidak dapat memisahkan keanggotaan per TA.
--
-- ISI (mengikuti pola akun.riwayat_kelas pada upgrade_20260911_riwayat_siswa.sql):
--   1) Kolom akun.riwayat_ekskul (jsonb) untuk murid: daftar ekskul, peta
--      jabatan & status keanggotaan PER TAHUN PELAJARAN.
--   2) Migrasi data eksisting: isi riwayat_ekskul[TA berjalan] dari
--      akun.ekstrakurikuler + akun.jabatan_ekskul_map (tanpa mengubah data lama).
--   3) RPC ubah_anggota_ekskul di-upgrade: parameter p_ta + dual-write ke
--      akun.ekstrakurikuler (live) DAN akun.riwayat_ekskul[TA] — persis pola
--      dual-write kenaikan kelas (tingkat_kelas ↔ riwayat_kelas).
--
-- Struktur riwayat_ekskul:
--   { "2026/2027": { "ekskul": "Pramuka, PMR", "jabatan_map": { "Pramuka":"Ketua" },
--                    "status": "Aktif" },
--     "2027/2028": { "ekskul": "Pramuka, Paskibra", "jabatan_map": {},
--                    "status": "Aktif" } }
--   status: Aktif | Keluar  (non-Aktif disembunyikan dari roster TA tsb.)
--   Kebijakan pemakaian (konsisten app.js & utils.example.js):
--     riwayat_ekskul MASIH KOSONG (migrasi belum dijalankan) → fallback ke
--     kolom akun.ekstrakurikuler (live), kompatibilitas data lama.
--     riwayat_ekskul SUDAH TERISI → keanggotaan ditentukan PER TA; TA tanpa
--     entri = bukan anggota TA tsb (roster kosong, TA baru).
--
-- Idempotent (create or replace / add column if not exists) — aman dijalankan berulang.
-- ============================================================

-- ========== 1. KOLOM RIWAYAT EKSKUL ==========
alter table akun
  add column if not exists riwayat_ekskul jsonb not null default '{}'::jsonb;

comment on column akun.riwayat_ekskul is
  'Riwayat keanggotaan ekstrakurikuler per tahun pelajaran: { "TA": { "ekskul": "Pramuka, PMR", "jabatan_map": {...}, "status": "Aktif|Keluar" } }. Tahun tanpa entri = fallback kolom ekstrakurikuler (live).';

-- ========== 2. MIGRASI DATA EKSISTING (sekali, idempotent) ==========
-- Isi riwayat_ekskul untuk TA berjalan (diambil dari Master Data) bagi murid
-- yang belum punya entri riwayat, agar roster per-TA konsisten sejak awal.
do $$
declare
  v_ta text := (select coalesce(
                 nullif(trim(min(m."Tahun Pelajaran")::text), ''),
                 to_char(now() at time zone 'Asia/Jakarta', 'YYYY') || '/' ||
                 to_char((now() at time zone 'Asia/Jakarta') + interval '1 year', 'YYYY'))
               from master_data m
               where m."Tahun Pelajaran" is not null
                 and trim(m."Tahun Pelajaran"::text) <> '');
  r record;
begin
  if v_ta is null or trim(v_ta) = '' then
    v_ta := to_char(now() at time zone 'Asia/Jakarta', 'YYYY') || '/' ||
            to_char((now() at time zone 'Asia/Jakarta') + interval '1 year', 'YYYY');
  end if;

  for r in
    select nis_nip, coalesce(trim(ekstrakurikuler), '') as ek,
           coalesce(jabatan_ekskul_map, '{}'::jsonb) as jmap
    from akun
    where tipe = 'murid'
      and coalesce(trim(ekstrakurikuler), '') <> ''
      and (riwayat_ekskul is null or riwayat_ekskul = '{}'::jsonb
           or not (riwayat_ekskul ? v_ta))
  loop
    update akun
       set riwayat_ekskul = jsonb_set(
              coalesce(riwayat_ekskul, '{}'::jsonb),
              array[v_ta],
              jsonb_build_object('ekskul', r.ek, 'jabatan_map', r.jmap, 'status', 'Aktif')
            )
     where nis_nip = r.nis_nip;
  end loop;
end $$;

-- ========== 3. RPC ubah_anggota_ekskul — DUAL-WRITE PER TA ==========
create or replace function ubah_anggota_ekskul(
  p_pemanggil text,
  p_ekskul text,
  p_nis_list text[],
  p_tambah boolean,
  p_ta text default null
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
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
begin
  -- 0) TA berjalan: parameter eksplisit, atau turunkan dari Master Data
  v_ta := coalesce(nullif(trim(coalesce(p_ta, '')), ''), (
    select min(m."Tahun Pelajaran")::text from master_data m
    where m."Tahun Pelajaran" is not null and trim(m."Tahun Pelajaran"::text) <> ''
  ), to_char(now() at time zone 'Asia/Jakarta', 'YYYY') || '/' ||
       to_char((now() at time zone 'Asia/Jakarta') + interval '1 year', 'YYYY'));

  -- 1) Identitas pemanggil
  select tipe, jabatan_ekskul_map, wali_kelas, ekstrakurikuler
  into v_tipe, v_jabatan_map, v_wali_kelas, v_ekstra
  from akun
  where nis_nip = p_pemanggil;

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

    update akun
       set ekstrakurikuler = v_baru,
           riwayat_ekskul = jsonb_set(
              coalesce(v_riwayat, '{}'::jsonb),
              array[v_ta],
              jsonb_build_object('ekskul', v_baru_riwayat, 'jabatan_map', v_jmap, 'status', 'Aktif')
           )
     where nis_nip = v_nis;

    v_total := v_total + 1;
  end loop;

  return json_build_object('status', 'success', 'total', v_total);
end $$;

-- ========== IZIN EKSEKUSI + RELOAD CACHE ==========
drop function if exists ubah_anggota_ekskul(text, text, text[], boolean);
grant execute on function ubah_anggota_ekskul(text, text, text[], boolean, text) to anon, authenticated;

notify pgrst, 'reload schema';

