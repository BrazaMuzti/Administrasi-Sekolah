-- ============================================================
-- FIX 20261031b: PETA WAJAH UNTUK MURID BER-JWT — 2026-10-31
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG
--   Absen Mandiri (metode 2) memanggil `akunPetaWajah({ nisList: [nis] })`
--   → RPC `ambil_peta_wajah` (upgrade_20261028b) untuk membaca descriptor
--   milik murid itu sendiri. Fungsi tersebut memakai:
--       v_staf = fn_is_admin() or fn_is_guru()
--       v_boleh = fn_akses_murid_list(p_token, p_nis_list, p_klaim_nis)
--   Sejak fix_20261028d, `fn_akses_murid` HANYA menerima token `sesi_lokal`.
--   Murid yang login lewat Supabase Auth (JWT, `fn_role() = 'murid'`) tidak
--   punya token itu → `v_boleh` kosong → RPC membalas `[]` → panel Absen
--   Mandiri menampilkan "Wajah belum terdaftar/aktif" padahal descriptor ADA.
--   (RPC saudaranya `ambil_sesi_absen_murid` sudah punya jalur JWT yang sama;
--   `ambil_peta_wajah` tertinggal.)
--
-- ISI
--   1. `ambil_peta_wajah` dibuat ulang dengan 2 jalur identitas murid:
--        a) JWT Auth ber-peran 'murid' → `fn_nis()` (NIS pemilik sesi);
--        b) token `sesi_lokal`            → `fn_akses_murid(p_token, …)`.
--   2. RUANG LINGKUP DIPERSEMPIT: murid hanya boleh menerima baris NIS-nya
--      sendiri, dan `p_nis_list` kosong TIDAK lagi berarti "semua murid".
--      Versi lama mengembalikan SEMUA descriptor sekolah saat `p_nis_list`
--      kosong (descriptor wajah = data biometrik → tidak boleh bocor).
--      Pemindaian massal (kelas) tetap penuh karena selalu dari sesi STAF.
--   3. Staf (`fn_is_admin()` / `fn_is_guru()`) TIDAK berubah perilakunya.
--
-- CARA KERJA / ROLLBACK
--   Rollback = jalankan ulang blok "2d. Peta descriptor wajah" pada
--   `upgrade_20261028b_rpc_akun.sql`. Tidak ada perubahan tabel/kolom.
--   Idempotent — aman dijalankan berulang.
-- ============================================================

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
  v_staf      boolean := (fn_is_admin() or fn_is_guru());
  v_nis_jwt   text;
  v_nis_token text;
  v_boleh     text[];
  v_rows      jsonb;
begin
  if v_staf then
    v_boleh := array(select a.nis_nip from akun a where a.tipe = 'murid');
  else
    -- (a) JWT Supabase Auth ber-peran murid. `coalesce` melindungi bila kelak
    --     fn_role()/fn_nis() mengembalikan NULL.
    v_nis_jwt := case
      when coalesce(fn_role(), '') = 'murid' then nullif(trim(coalesce(fn_nis(), '')), '')
      else null
    end;
    -- (b) Sesi lokal (murid password lokal). Sejak fix_20261028d token WAJIB.
    v_nis_token := fn_akses_murid(p_token, p_klaim_nis);

    -- Hanya NIS milik pemanggil — BUKAN semua NIS yang diminta.
    v_boleh := array_remove(array[v_nis_jwt, v_nis_token], null);

    -- Bila pemanggil menyebut NIS tertentu, persempit ke irisan keduanya.
    if p_nis_list is not null and array_length(p_nis_list, 1) is not null then
      v_boleh := array(
        select unnest(v_boleh)
        intersect
        select unnest(p_nis_list)
      );
    end if;

    -- Tanpa bukti identitas → jangan kembalikan apa pun (termasuk saat
    -- p_nis_list kosong; dulu kondisi ini membocorkan SELURUH peta wajah).
    if v_boleh is null or array_length(v_boleh, 1) is null then
      return '[]'::jsonb;
    end if;
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

-- Grant tetap sama dengan versi sebelumnya (dipanggil dari sesi anon/authenticated;
-- gerbang identitas ada DI DALAM fungsi, bukan lewat grant).
grant execute on function ambil_peta_wajah(text[], boolean, text, text) to anon, authenticated;

-- ========== VERIFIKASI & RELOAD CACHE SKEMA POSTGREST ==========
do $$
declare
  v_ada boolean;
begin
  select exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'ambil_peta_wajah'
       and pg_get_function_identity_arguments(p.oid) = 'text[], boolean, text, text'
  ) into v_ada;

  if not v_ada then
    raise exception 'GAGAL: fungsi ambil_peta_wajah(text[], boolean, text, text) tidak ditemukan setelah CREATE OR REPLACE.';
  end if;

  -- Bukti cepat: pemanggil tanpa JWT & tanpa token tidak boleh menerima baris.
  if ambil_peta_wajah('{}'::text[], true, '', '') <> '[]'::jsonb then
    raise warning 'PERINGATAN: ambil_peta_wajah mengembalikan baris untuk pemanggil tanpa identitas. Periksa blok di atas.';
  else
    raise notice 'INFO: ambil_peta_wajah menolak pemanggil tanpa identitas (aman).';
  end if;
end $$;

notify pgrst, 'reload schema';
