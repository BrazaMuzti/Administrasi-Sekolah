-- ============================================================
-- PEMBERSIH DATA UJI E2E — PENUGASAN GURU & SISWA
-- Jalankan SETELAH uji_data_penugasan.sql selesai diuji.
-- Menghapus seluruh jejak data uji: akun guru UJI-GR01/UJI-GR02,
-- akun murid UJI998 & UJI997 (+kredensial), ekstrakurikuler & sub-ekskul uji,
-- jadwal pelajaran, absensi, dan nilai uji.
-- Idempotent — aman dijalankan berulang.
--
-- CATATAN: TIDAK menghapus UJI999 (dibersihkan oleh uji_bersih.sql).
-- Jalankan uji_bersih_penugasan.sql SEBELUM uji_bersih.sql bila kedua
-- data uji ingin sama-sama dihapus (agar FK/kesesuaian tidak tabrakan).
-- ============================================================

delete from nilai where nis in ('UJI999', 'UJI998', 'UJI997') and id_guru like 'UJI-%';
delete from absensi where nis in ('UJI999', 'UJI998', 'UJI997') and id_guru like 'UJI-%';
delete from jadwal_pelajaran where "ID Akun Guru" like 'UJI-%';

delete from sub_ekstrakurikuler where nama_sub like 'UJI %';
-- Hanya hapus ekstrakurikuler Pramuka/PMR bila memang dibuat oleh data uji ini
-- (deskripsi ber-prefiks "UJI "), agar tidak menghapus data Pramuka/PMR asli sekolah.
delete from ekstrakurikuler where nama_ekskul in ('Pramuka', 'PMR') and deskripsi like 'UJI %';

delete from akun_kredensial where nis_nip in ('UJI-GR01', 'UJI-GR02', 'UJI998', 'UJI997');
delete from akun where nis_nip in ('UJI-GR01', 'UJI-GR02') and tipe = 'guru';
delete from akun where nis_nip in ('UJI998', 'UJI997') and tipe = 'murid';


-- Riwayat kelas, ekstrakurikuler & jabatan ekskul UJI999 dikembalikan (bukan
-- dihapus, akun utamanya masih dipakai uji_bersih.sql / skenario lain).
update akun set
  riwayat_kelas = '{}'::jsonb,
  ekstrakurikuler = '',
  jabatan_ekskul = null,
  jabatan_ekskul_map = '{}'::jsonb
where nis_nip = 'UJI999' and tipe = 'murid';


-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- Verifikasi manual (opsional, jalankan terpisah):
--   select count(*) from akun where nis_nip in ('UJI-GR01','UJI-GR02','UJI998','UJI997'); -- harus 0
--   select count(*) from jadwal_pelajaran where "ID Akun Guru" like 'UJI-%';     -- harus 0
--   select count(*) from nilai where id_guru like 'UJI-%';                       -- harus 0
