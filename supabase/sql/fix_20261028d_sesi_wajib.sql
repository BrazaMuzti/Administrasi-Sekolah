-- ============================================================
-- FIX 20261028d: SESI MURID WAJIB (matikan fallback klaim NIS) — 2026-10-28
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG
--   `upgrade_20261028a` membuat `fn_akses_murid(p_token, p_nis_fallback)`
--   yang MASIH menerima klaim NIS tanpa token (agar klien lama tidak putus
--   saat fase B1/B2). Setelah frontend versi `?v=20261028a` ter-deploy dan
--   setiap sesi murid memakai token dari `cek_login_murid`, klaim itu harus
--   dimatikan supaya bukan hanya RLS yang ketat tetapi juga RPC tidak bisa
--   dipanggil atas nama NIS orang lain.
--
-- ISI
--   `fn_akses_murid` dan `fn_akses_murid_list` dibuat ulang: token sesi
--   `sesi_lokal` menjadi SATU-SATUNYA bukti identitas murid.
--
-- CARA KERJA / ROLLBACK
--   Rollback = jalankan ulang `upgrade_20261028a_sesi_lokal_murid.sql`
--   (blok 3d/3e mengembalikan versi kompatibel). Tidak ada perubahan tabel.
--
-- CATATAN URUTAN (penting!)
--   1) Deploy frontend baru lebih dulu (murid login → dapat `sesi_token`).
--   2) Baru jalankan file ini. Murid yang masih memegang sesi LAMA
--      (`lokal-<uuid>` buatan klien) akan diminta login ulang — itu memang
--      tujuannya: token lama tidak pernah diverifikasi server.
--
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. GATE KETAT (token saja) ==========
create or replace function fn_akses_murid(p_token text, p_nis_fallback text default '')
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis text;
begin
  -- p_nis_fallback SENGAJA diabaikan (dokumentasi: hanya untuk kompatibilitas
  -- tanda tangan fungsi agar RPC fase B tidak perlu diubah).
  v_nis := fn_sesi_valid(p_token);
  return v_nis;   -- NULL = tidak ada sesi valid → RPC menolak
end $$;

-- ========== 2. VERSI MASSAL ==========
create or replace function fn_akses_murid_list(
  p_token text,
  p_nis_list text[] default '{}',
  p_nis_fallback text default ''
)
returns text[]
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis text;
begin
  v_nis := fn_akses_murid(p_token, p_nis_fallback);
  if v_nis is null then return '{}'::text[]; end if;

  if p_nis_list is null or array_length(p_nis_list, 1) is null then
    return array(select nis_nip from akun where tipe = 'murid' and coalesce(nis_nip, '') <> '');
  end if;

  return array(select a.nis_nip from akun a where a.tipe = 'murid' and a.nis_nip = any(p_nis_list));
end $$;

grant execute on function fn_akses_murid(text, text) to anon, authenticated;
grant execute on function fn_akses_murid_list(text, text[], text) to anon, authenticated;

-- ========== 3. VERIFIKASI & RELOAD CACHE SKEMA POSTGREST ==========
do $$
declare v_hasil text;
begin
  -- Uji klaim tanpa token: HARUS mengembalikan NULL.
  v_hasil := fn_akses_murid('', '__uji_klaim_nis__');
  if v_hasil is not null then
    raise warning 'PERINGATAN: klaim NIS tanpa token MASIH diterima (%). Cek apakah blok 1 benar-benar tereksekusi.', v_hasil;
  else
    raise notice 'INFO: gate sesi ketat aktif — klaim NIS tanpa token ditolak.';
  end if;
end $$;

notify pgrst, 'reload schema';
