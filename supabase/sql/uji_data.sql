-- ============================================================
-- DATA UJI E2E — SISIP (Fase 1-4)
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Semua data ber-prefiks "UJI-" / NIS "UJI999" agar mudah dibersihkan
-- lewat supabase/sql/uji_bersih.sql setelah pengujian selesai.
--
-- Catatan TA: data memakai TA '2026/2027' (berjalan) & '2027/2028'
-- (tujuan PPDB/kenaikan). Jika TA sekolah Anda berbeda, sesuaikan
-- nilai ta di bawah sebelum menjalankan.
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. AKUN MURID UJI (NIS UJI999, password uji1234) ==========
insert into akun (nis_nip, tipe, nama_lengkap, tingkat_kelas, tahun_pelajaran, semester, jenis_kelamin, agama, email, nisn)
select 'UJI999', 'murid', 'UJI Murid E2E', 'X UJI', '2026/2027', 'Ganjil', 'L', 'Islam', 'uji999@example.com', '9999999999'
where not exists (select 1 from akun where nis_nip = 'UJI999' and tipe = 'murid');

insert into akun_kredensial (nis_nip, password_hash)
values ('UJI999', crypt('uji1234', gen_salt('bf', 10)))
on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();

-- ========== 2. KATALOG BUKU PERPUSTAKAAN UJI ==========
insert into perpus_buku (kode, judul, pengarang, penerbit, tahun, kategori, eksemplar, lokasi)
select 'UJI-001', 'UJI Buku Matematika Kelas X', 'Pengarang Uji', 'Penerbit Uji', '2024', 'Pelajaran', 2, 'Rak UJI'
where not exists (select 1 from perpus_buku where kode = 'UJI-001');

insert into perpus_buku (kode, judul, pengarang, penerbit, tahun, kategori, eksemplar, lokasi)
select 'UJI-002', 'UJI Novel Petualangan Uji', 'Penulis Uji', 'Pustaka Uji', '2023', 'Fiksi', 1, 'Rak UJI'
where not exists (select 1 from perpus_buku where kode = 'UJI-002');

-- ========== 3. BARANG INVENTARIS UJI ==========
insert into inv_barang (kode, nama, kategori, lokasi, jumlah, kondisi, tahun_perolehan, harga, sumber)
select v.kode, v.nama, 'Elektronik', 'Ruang Uji', v.jumlah, 'Baik', v.thn, v.harga, v.sumber
from (values
  ('UJI-INV-001', 'UJI Laptop Uji', 3, '2024', 5000000, 'BOS'),
  ('UJI-INV-002', 'UJI Proyektor Uji', 2, '2023', 3000000, 'Komite')
) as v(kode, nama, jumlah, thn, harga, sumber)
where not exists (select 1 from inv_barang b where b.kode = v.kode);

-- ========== 4. KATEGORI POIN UJI ==========
insert into poin_kategori (jenis, nama, poin, ket, aktif)
values ('pelanggaran', 'UJI-Test Pelanggaran', 1, 'Data uji E2E', true),
       ('prestasi', 'UJI-Test Prestasi', 3, 'Data uji E2E', true)
on conflict (jenis, nama) do update set aktif = true;

-- ========== 5. TAGIHAN SPP UJI (periode bulan berjalan) ==========
insert into spp_tagihan (nis, nama, kelas, ta, semester, jenis, periode, nominal, jatuh_tempo)
select 'UJI999', 'UJI Murid E2E', 'X UJI', '2026/2027', 'Ganjil', 'SPP',
       to_char(now(), 'YYYY-MM'), 50000, (date_trunc('month', now()) + interval '9 days')::date
where not exists (
  select 1 from spp_tagihan
  where nis = 'UJI999' and ta = '2026/2027' and jenis = 'SPP' and periode = to_char(now(), 'YYYY-MM')
);

-- ========== 6. CALON PPDB UJI (status Baru, siap diuji s.d. konversi) ==========
insert into ppdb_calon (ta, no_daftar, nama, nisn, jenis_kelamin, tempat_lahir, tgl_lahir, agama, asal_sekolah, alamat, telepon, nama_ayah, pekerjaan_ayah, nama_ibu, pekerjaan_ibu, jalur, status, tanggal_daftar, dibuat_oleh)
select '2027/2028', 'UJI-999/2027/2028', 'UJI Calon E2E', '9999999998', 'L', 'Kota Uji', '2011-05-12', 'Islam', 'SMP Uji Negeri 1', 'Jl. Uji No. 1', '0811111111', 'Bapak Uji', 'Karyawan', 'Ibu Uji', 'Ibu Rumah Tangga', 'Reguler', 'Baru', current_date, 'UJI E2E'
where not exists (select 1 from ppdb_calon where no_daftar = 'UJI-999/2027/2028');

-- ========== 7. PENGUMUMAN UJI (target semua) ==========
insert into pengumuman (ta, judul, isi, target, mulai, akhir, penulis)
select '2026/2027', 'UJI Pengumuman E2E (hapus setelah uji)', 'Pengumuman data uji — harus tampil di dashboard admin, guru, dan murid. Aman untuk dihapus.', 'semua', current_date - 1, current_date + 30, 'UJI E2E'
where not exists (select 1 from pengumuman where judul like 'UJI Pengumuman E2E%');

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';