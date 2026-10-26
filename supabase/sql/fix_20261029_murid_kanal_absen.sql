-- ============================================================
-- FIX 20261029: KANAL ABSEN UNTUK MURID (menu "Absen Mandiri") — 2026-10-29
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG
--   Panel murid **Absen Mandiri** (`renderAbsenMandiriMurid`, web/js/app.js)
--   memuat daftar sesi terbuka lewat `akunDaftarGuru('guru_kanal_absen')` →
--   RPC `ambil_daftar_guru` (entri 70). Fungsi itu memang di-grant ke
--   `anon`/`authenticated`, TETAPI digerbang:
--       if not (fn_is_admin() or fn_is_guru()) then return '[]'::jsonb; end if;
--   Sesi murid tidak lolos gerbang tersebut:
--     * murid password lokal → PostgREST role `anon`, `fn_role()` = '' ;
--     * murid ber-JWT Supabase Auth → `fn_role()` = 'murid'.
--   Akibatnya RPC SELALU membalas `[]` untuk murid, sehingga panel murid
--   menampilkan DUA gejala sekaligus:
--     1) "Tidak Ada Sesi Absen Terbuka" walau guru sudah Kunci Absen → BUKA;
--     2) dropdown **Mapel / Ekstrakurikuler** kosong — pilihannya dibangun dari
--        `sesiGuru` × jadwal kelas (tabel `jadwal_pelajaran`, dibaca murid
--        sebagai anon lewat policy `jadwal_baca_anon`) × ekskul murid.
--
-- ISI
--   Satu RPC baca khusus murid: `ambil_sesi_absen_murid(p_token, p_klaim_nis)`
--   yang mengembalikan HANYA baris guru/admin dengan `kunci_absen = 'BUKA'`
--   dan HANYA kolom yang dipakai panel murid:
--       nis_nip, nama_lengkap, mapel, ekstrakurikuler
--   (kolom `captcha` dan `kunci_absen` SENGAJA tidak dikirim — sejalan dengan
--   komentar "kolom captcha sengaja TIDAK diambil" di app.js.)
--
--   Gerbang identitas (3 jalur sah):
--     * staf (`fn_is_admin()` / `fn_is_guru()`) → boleh (uji/admin);
--     * murid ber-JWT Auth (`fn_role() = 'murid'`) → boleh;
--     * murid password lokal → WAJIB token sesi `sesi_lokal` yang valid
--       (`fn_akses_murid`; token saja sejak `fix_20261028d`).
--   Tanpa salah satunya → `[]` (daftar akun TIDAK bocor ke anon).
--
--   Kenapa fungsi BARU dan bukan melonggarkan `ambil_daftar_guru`? Karena
--   fungsi itu dipakai 9 titik frontend staf (`guru_wali`, `guru_pembina`,
--   `guru_penugasan`, `guru_dashboard`, `penuh`, dst.) — RPC terpisah menjaga
--   jalur staf tidak tersentuh sama sekali.
--
-- ROLLBACK / IDEMPOTENT
--   Rollback: `drop function if exists ambil_sesi_absen_murid(text, text);`
--   Tidak ada perubahan tabel. Aman dijalankan berulang.
-- ============================================================

-- ========== 1. RPC BACA SESI TERBUKA UNTUK MURID ==========
create or replace function ambil_sesi_absen_murid(
  p_token     text default '',
  p_klaim_nis text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_staf boolean := (fn_is_admin() or fn_is_guru());
begin
  -- CATATAN: SENGAJA tanpa penanda `stable` — `fn_akses_murid` memperpanjang
  -- masa sesi (`update sesi_lokal.last_seen`); sama seperti `cek_sesi_absen`
  -- dan `ambil_peta_wajah`.
  if not v_staf then
    -- Salah satu jalur murid harus terpenuhi: JWT Auth berperan 'murid'
    -- (`fn_role()`), ATAU token sesi `sesi_lokal` yang valid. `coalesce`
    -- dipakai sebagai pertahanan bila kelak `fn_role()` berubah mengembalikan
    -- NULL (NULL <> 'murid' = NULL → gerbang bocor).
    if coalesce(fn_role(), '') <> 'murid'
       and fn_akses_murid(p_token, p_klaim_nis) is null then
      return '[]'::jsonb;   -- tidak ada bukti identitas → jangan kembalikan apa pun
    end if;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'nis_nip',         a.nis_nip,
             'nama_lengkap',    a.nama_lengkap,
             'mapel',           coalesce(a.mapel, ''),
             'ekstrakurikuler', coalesce(a.ekstrakurikuler, ''))
           order by a.nama_lengkap)
      from akun a
     where a.tipe in ('guru', 'admin')
       and a.kunci_absen = 'BUKA'
  ), '[]'::jsonb);
end $$;

grant execute on function ambil_sesi_absen_murid(text, text) to anon, authenticated;

-- ========== 2. VERIFIKASI & RELOAD CACHE SKEMA POSTGREST ==========
do $$
declare
  v_jml integer;
  v_ada_grant boolean;
begin
  select count(*) into v_jml
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ambil_sesi_absen_murid';
  if v_jml <> 1 then
    raise warning 'PERINGATAN: % overload ambil_sesi_absen_murid terpasang (harusnya 1) — cek blok 1.', v_jml;
  else
    raise notice 'INFO: ambil_sesi_absen_murid terpasang (1 overload).';
  end if;

  select exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'ambil_sesi_absen_murid'
       and has_function_privilege('anon', p.oid, 'execute')
  ) into v_ada_grant;
  if not v_ada_grant then
    raise warning 'PERINGATAN: anon belum boleh mengeksekusi ambil_sesi_absen_murid — cek blok grant.';
  else
    raise notice 'INFO: grant execute ke anon/authenticated aktif.';
  end if;
end $$;

notify pgrst, 'reload schema';
