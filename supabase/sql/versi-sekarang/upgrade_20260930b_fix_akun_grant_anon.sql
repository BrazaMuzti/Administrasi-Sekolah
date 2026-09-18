-- ============================================================
-- FIX: GRANT TABEL AKUN UNTUK ANON (PENGURUS EKSKUL MURID) — 2026-09-30 (b)
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Murid yang menjabat (mis. jabatan "Sekretaris") pada suatu
--   ekstrakurikuler gagal menambahkan SISWA YANG SUDAH PUNYA AKUN
--   sebagai anggota ekskul lewat menu Ekstrakurikuler → Tambah Anggota,
--   dengan pesan:
--     "0 anggota ditambahkan, N gagal: permission denied for table akun"
--
--   Penyebab: fungsi terapkanKeanggotaanEkskul() (web/js/app.js) memakai
--   sesi murid lokal (anon key, tanpa Supabase Auth) untuk membaca &
--   mengubah kolom akun.ekstrakurikuler:
--     select ekstrakurikuler from akun where nis_nip=... (perlu GRANT SELECT)
--     update akun set ekstrakurikuler=... (perlu GRANT UPDATE kolom)
--   Grant ini sudah pernah ditulis di fix_20260903_kredensial.sql,
--   upgrade_20260905_ekskul_pengurus.sql, dan upgrade_20260926_ekskul_akses_guru.sql
--   — tapi tampaknya belum (lengkap) ter-apply di database project ini.
--
-- ISI (idempotent — aman dijalankan berulang, TIDAK memakai revoke all
-- agar tidak menghapus privilege lain yang sudah berjalan):
--   1) grant select on akun to anon
--   2) grant update (ekstrakurikuler) on akun to anon
--   3) grant update (jabatan_ekskul_map) on akun to anon
--   4) Reload cache skema PostgREST
-- ============================================================

grant select on akun to anon;
grant update (ekstrakurikuler) on akun to anon;
grant update (jabatan_ekskul_map) on akun to anon;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';
