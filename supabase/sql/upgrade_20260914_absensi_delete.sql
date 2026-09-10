-- ============================================================
-- UPGRADE ABSENSI (DELETE) — 2026-09-14
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   Policy RLS DELETE untuk tabel absensi.
--   Wajib untuk tombol "Kosongkan Data" pada Input Hadir Masal
--   (Hadir Tatap Muka) yang kini menghapus permanen baris absensi
--   dari database. Tanpa policy ini, perintah delete diabaikan RLS
--   (0 baris terhapus) meski grant delete sudah ada.
--
-- Idempotent — aman dijalankan berulang.
-- ============================================================

drop policy if exists "absensi_hapus_semua" on absensi;
create policy "absensi_hapus_semua" on absensi
  for delete using (true);

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';
