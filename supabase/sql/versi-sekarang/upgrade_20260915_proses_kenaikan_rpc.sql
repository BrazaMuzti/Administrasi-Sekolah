-- ============================================================
-- UPGRADE PROSES KENAIKAN KELAS (ADMIN-ONLY) — 2026-09-15
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   RPC proses_kenaikan_kelas(p_ta_tujuan, p_siswa):
--     - Hanya admin (akun.tipe = 'admin' utk auth.uid()) boleh eksekusi
--     - Update massal: tingkat_kelas + riwayat_kelas (merge jsonb
--       pada kunci TA tujuan) hanya untuk baris tipe = 'murid'
--     - Dipakai wizard "Proses Kenaikan Kelas" (mode Naik & Turun/Koreksi)
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

-- ========== RPC: PROSES KENAIKAN / KOREKSI KELAS (ADMIN) ==========
create or replace function proses_kenaikan_kelas(p_ta_tujuan text, p_siswa jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tipe text;
  v_diperbarui int := 0;
begin
  if coalesce((select tipe from akun where user_id = auth.uid()), '') <> 'admin' then
    return json_build_object('status', 'error', 'message', 'Hanya admin yang boleh memproses kenaikan kelas.');
  end if;

  if coalesce(trim(p_ta_tujuan), '') = '' then
    return json_build_object('status', 'error', 'message', 'Tahun pelajaran tujuan tidak valid.');
  end if;
  if p_siswa is null or jsonb_typeof(p_siswa) <> 'array' or jsonb_array_length(p_siswa) = 0 then
    return json_build_object('status', 'error', 'message', 'Data siswa tidak valid.');
  end if;

  begin
    update akun a
    set tingkat_kelas = s.kelas,
        riwayat_kelas = coalesce(a.riwayat_kelas, '{}'::jsonb) || jsonb_build_object(
          p_ta_tujuan,
          jsonb_build_object('kelas', s.kelas, 'status', s.status, 'ket', s.ket)
        )
    from jsonb_to_recordset(p_siswa) as s(id uuid, kelas text, status text, ket text)
    where a.id = s.id
      and a.tipe = 'murid'
      and coalesce(trim(s.kelas), '') <> '';

    get diagnostics v_diperbarui = row_count;
  exception when others then
    return json_build_object('status', 'error', 'message', 'Gagal memperbarui data: ' || SQLERRM);
  end;

  return json_build_object('status', 'success', 'diperbarui', v_diperbarui);
end $$;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';