-- ============================================================
-- UPGRADE RPC RAPOR MURID — 2026-09-22
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Latar belakang: RPC ambil_laporan_nilai_murid dibuat di luar repo
-- dan tidak ditemukan di DB produksi. Rapor murid kini memakai RPC
-- milik repo: ambil_rapor_nilai_murid (security definer, by-NIS,
-- pola sama dengan poin_murid/pinjaman_murid di upgrade_20260920).
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== RPC: NILAI RAPOR MILIK MURID (by NIS) ==========
create or replace function ambil_rapor_nilai_murid(p_nis text, p_ta text, p_smt text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_rows json;
begin
  select coalesce(json_agg(json_build_object(
    'kategori', r.kategori,
    'mapel', r.mapel,
    'ekskul', r.ekskul,
    'kelas', r.kelas,
    'tahun', r.tahun,
    'semester', r.semester,
    'data', r.data
  ) order by r.kategori, r.mapel), '[]'::json)
  into v_rows
  from (
    select kategori, mapel, ekskul, kelas, tahun, semester, data
    from nilai
    where nis = p_nis and tahun = p_ta and semester = p_smt
  ) r;

  return json_build_object('status', 'success', 'nilai', v_rows);
end $$;

-- ========== GRANT EXECUTE ==========
grant execute on function ambil_rapor_nilai_murid(text, text, text) to anon, authenticated;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';