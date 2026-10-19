-- ============================================================
-- DIAGNOSIS (2026-10-19): Import Anggota → "NIS ... (TA lain)"
-- Jalankan di Supabase Dashboard → SQL Editor
--
-- Import Anggota (web/js/app.js) hanya menerima siswa yang
-- tahun_pelajaran-nya sama dengan TA berjalan (currentTahun =
-- "2026/2027"). Jika NIS muncul sebagai "(TA lain) tidak dikenali",
-- berarti baris akun siswa tsb punya nilai tahun_pelajaran ≠ "2026/2027".
--
-- 1) Lihat data siswa bersangkutan (ganti 2526200107 bila perlu):
-- ============================================================
select nis_nip, nama_lengkap, tipe, tahun_pelajaran, tingkat_kelas, ekstrakurikuler
from akun
where nis_nip = '2526200107';

-- ============================================================
-- 2) Kalau siswa TERSEDIA seharusnya di TA 2026/2027, perbaiki:
--    (KOMENTARI baris UPDATE ini dulu sampai yakin nilainya benar.)
-- ============================================================
-- update akun
-- set tahun_pelajaran = '2026/2027'
-- where nis_nip = '2526200107' and tipe = 'murid';

-- ============================================================
-- 3) (Opsional) Lihat seluruh siswa di luar TA 2026/2027:
-- ============================================================
-- select nis_nip, nama_lengkap, tahun_pelajaran, tingkat_kelas
-- from akun
-- where tipe = 'murid'
--   and tahun_pelajaran is not null
--   and tahun_pelajaran <> '2026/2027'
-- order by tahun_pelajaran;
