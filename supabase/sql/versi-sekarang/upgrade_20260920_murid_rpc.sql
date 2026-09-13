-- ============================================================
-- UPGRADE PERBAIKAN AKSES MURID (ANON) — 2026-09-20
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Latar belakang: sesi login murid memakai anon key (murid lokal
-- tanpa akun Supabase Auth), sedangkan tabel Fase 1-3 hanya di-grant
-- ke authenticated. Akibatnya widget Pengumuman/Poin & Pinjaman Saya
-- & Rapor Saya milik murid gagal membaca data.
--
-- Isi:
--   1) Grant select anon utk konten publik: pengumuman, perpus_buku
--   2) 3 RPC murid-scoped (security definer) utk data sensitif:
--        poin_murid, pinjaman_murid, catatan_wali_murid
--      (pola sama dgn ambil_laporan_nilai_murid / cek_login_murid)
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. GRANT SELECT ANON (PUBLIK) ==========
grant select on pengumuman  to anon;
grant select on perpus_buku to anon;

-- ========== 2. RPC: POIN SESEORANG MURID (by NIS) ==========
create or replace function poin_murid(p_nis text, p_ta text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entri json;
begin
  select coalesce(json_agg(json_build_object(
    'tanggal', e.tanggal,
    'jenis', e.jenis,
    'kategori_nama', e.kategori_nama,
    'poin', e.poin,
    'catatan', e.catatan,
    'pelapor', e.pelapor
  ) order by e.tanggal desc nulls last, e.created_at desc), '[]'::json)
  into v_entri
  from (
    select * from poin_siswa
    where nis = p_nis and ta = p_ta
    order by tanggal desc nulls last, created_at desc
    limit 50
  ) e;

  return json_build_object(
    'status', 'success',
    'total_pelanggaran', (select coalesce(sum(poin), 0) from poin_siswa where nis = p_nis and ta = p_ta and jenis = 'pelanggaran'),
    'total_prestasi',    (select coalesce(sum(poin), 0) from poin_siswa where nis = p_nis and ta = p_ta and jenis = 'prestasi'),
    'entri', v_entri
  );
end $$;

-- ========== 3. RPC: PINJAMAN BUKU MILIK MURID (by NIS) ==========
create or replace function pinjaman_murid(p_nis text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_rows json;
begin
  select coalesce(json_agg(json_build_object(
    'id', p.id,
    'kode_buku', p.kode_buku,
    'judul_buku', p.judul_buku,
    'tanggal_pinjam', p.tanggal_pinjam,
    'tenggat', p.tenggat,
    'tanggal_kembali', p.tanggal_kembali,
    'hari_telat', p.hari_telat,
    'denda', p.denda,
    'status', p.status,
    'ket', p.ket
  ) order by p.tanggal_pinjam desc nulls last), '[]'::json)
  into v_rows
  from (
    select * from perpus_pinjam
    where nis = p_nis
    order by tanggal_pinjam desc nulls last
    limit 100
  ) p;

  return json_build_object('status', 'success', 'pinjaman', v_rows);
end $$;

-- ========== 4. RPC: CATATAN WALI KELAS MILIK MURID ==========
create or replace function catatan_wali_murid(p_nis text, p_ta text, p_smt text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_catatan text;
begin
  select catatan into v_catatan
  from rapor_catatan
  where nis = p_nis and ta = p_ta and semester = p_smt
  limit 1;

  return json_build_object('status', 'success', 'catatan', coalesce(v_catatan, ''));
end $$;

-- ========== 5. GRANT EXECUTE RPC ==========
grant execute on function poin_murid(text, text) to anon, authenticated;
grant execute on function pinjaman_murid(text) to anon, authenticated;
grant execute on function catatan_wali_murid(text, text, text) to anon, authenticated;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';