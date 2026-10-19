-- ============================================================
-- FIX LENGKAP: GRANT PRIVILEGE TABEL MODUL NILAI
-- (42501 / HTTP 401 — PERMISSION DENIED PADA MENU INPUT NILAI) — 2026-10-18
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- ------------------------------------------------------------------
-- LATAR BELAKANG:
--   Menu "Input Nilai" (Pengetahuan/Keterampilan/Sikap/Ekstrakurikuler)
--   gagal dimuat dengan pesan:
--     "Gagal memuat data. Periksa koneksi internet Anda."
--   Di DevTools → Network, permintaan yang gagal adalah:
--     GET /rest/v1/nilai_konfigurasi?select=config&kategori=eq....&mapel=eq....
--     HTTP 401 { "code":"42501", "message":"permission denied for table nilai_konfigurasi" }
--
--   Penyebab: tabel-tabel modul nilai di database project ini TIDAK
--   memiliki GRANT privilege tingkat tabel untuk role API `authenticated`.
--   RLS policy saja TIDAK cukup — PostgREST menolak permintaan SEBELUM
--   mengevaluasi RLS bila privilege tabel tidak ada.
--
--   File `upgrade_20261014b_fix_nilai_grant.sql` sudah menambahkan grant
--   untuk nilai_konfigurasi / nilai_teman_sejawat / jurnal_sikap. File ini
--   MELENGKAPI-nya dengan grant tabel `nilai` (utama, dipakai query
--   loadDataNilai & nilai pasangan) serta menegaskan ulang semuanya secara
--   idempotent aman dijalankan berulang.
--
-- ISI:
--   1) nilai_konfigurasi → select/insert/update/delete utk authenticated
--   2) nilai               → select/insert/update/delete utk authenticated
--   3) nilai_teman_sejawat → select/insert/update/delete utk authenticated
--   4) jurnal_sikap        → select/insert/update/delete utk authenticated
--   5) Reload cache skema PostgREST
-- ============================================================

revoke all on table nilai_konfigurasi from anon, authenticated;
grant select, insert, update, delete on nilai_konfigurasi to authenticated;

revoke all on table nilai from anon, authenticated;
grant select, insert, update, delete on nilai to authenticated;

revoke all on table nilai_teman_sejawat from anon, authenticated;
grant select, insert, update, delete on nilai_teman_sejawat to authenticated;

revoke all on table jurnal_sikap from anon, authenticated;
grant select, insert, update, delete on jurnal_sikap to authenticated;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';
