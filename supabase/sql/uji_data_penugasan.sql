-- ============================================================
-- DATA UJI E2E — PENUGASAN GURU & SISWA LINTAS TAHUN PELAJARAN
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- (Jalankan SETELAH uji_data.sql — memakai murid UJI999 yang sama.)
--
-- Tujuan: menyediakan data uji nyata untuk:
--   - Wali kelas & Mapel Diampu guru BERBEDA per Tahun Pelajaran
--     (kolom akun.penugasan, upgrade_20260910_penugasan_guru.sql)
--   - Pembina Ekstrakurikuler guru BERBEDA per Tahun Pelajaran
--   - Kenaikan kelas siswa per Tahun Pelajaran
--     (kolom akun.riwayat_kelas, upgrade_20260911_riwayat_siswa.sql)
--   - Keanggotaan siswa di Ekstrakurikuler & Sub-Ekstrakurikuler
--   - Jadwal Pelajaran (dipakai perhitungan % kehadiran berbasis jadwal)
--   - Absensi & Nilai (Pengetahuan + Eskul) yang konsisten dengan
--     penugasan guru/siswa di atas
--
-- Semua data ber-prefiks "UJI-" / NIS "UJI999", "UJI998" & "UJI997" agar mudah
-- dibersihkan lewat supabase/sql/uji_bersih_penugasan.sql.
--
-- Tahun Pelajaran yang dipakai: '2026/2027' (berjalan) & '2027/2028' (naik kelas).
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. AKUN GURU UJI (2 guru, penugasan berbeda per TA) ==========

-- UJI-GR01: TA 2026/2027 wali kelas X UJI + Matematika + pembina Pramuka
--           TA 2027/2028 naik jadi wali kelas XI UJI + Matematika & Fisika + pembina Pramuka & PMR
insert into akun (nis_nip, tipe, nama_lengkap, jabatan, wali_kelas, mapel, ekstrakurikuler, penugasan, email)
select 'UJI-GR01', 'guru', 'UJI Guru Matematika E2E', 'Guru', 'X UJI', 'Matematika', 'Pramuka',
  '{
    "2026/2027": { "mapel": ["Matematika"], "wali": "X UJI", "ekskul": ["Pramuka"] },
    "2027/2028": { "mapel": ["Matematika", "Fisika"], "wali": "XI UJI", "ekskul": ["Pramuka", "PMR"] }
  }'::jsonb,
  'ujigr01@example.com'
where not exists (select 1 from akun where nis_nip = 'UJI-GR01' and tipe = 'guru');

update akun set
  jabatan = 'Guru', wali_kelas = 'X UJI', mapel = 'Matematika', ekstrakurikuler = 'Pramuka',
  penugasan = '{
    "2026/2027": { "mapel": ["Matematika"], "wali": "X UJI", "ekskul": ["Pramuka"] },
    "2027/2028": { "mapel": ["Matematika", "Fisika"], "wali": "XI UJI", "ekskul": ["Pramuka", "PMR"] }
  }'::jsonb
where nis_nip = 'UJI-GR01' and tipe = 'guru';

insert into akun_kredensial (nis_nip, password_hash)
values ('UJI-GR01', crypt('uji1234', gen_salt('bf', 10)))
on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();

-- UJI-GR02: TA 2026/2027 bukan wali kelas + Bahasa Indonesia + pembina PMR
--           TA 2027/2028 jadi wali kelas X UJI (gantian) + Bahasa Indonesia, BERHENTI jadi pembina ekskul
insert into akun (nis_nip, tipe, nama_lengkap, jabatan, wali_kelas, mapel, ekstrakurikuler, penugasan, email)
select 'UJI-GR02', 'guru', 'UJI Guru B.Indonesia E2E', 'Guru', '', 'Bahasa Indonesia', 'PMR',
  '{
    "2026/2027": { "mapel": ["Bahasa Indonesia"], "wali": "", "ekskul": ["PMR"] },
    "2027/2028": { "mapel": ["Bahasa Indonesia"], "wali": "X UJI", "ekskul": [] }
  }'::jsonb,
  'ujigr02@example.com'
where not exists (select 1 from akun where nis_nip = 'UJI-GR02' and tipe = 'guru');

update akun set
  jabatan = 'Guru', wali_kelas = '', mapel = 'Bahasa Indonesia', ekstrakurikuler = 'PMR',
  penugasan = '{
    "2026/2027": { "mapel": ["Bahasa Indonesia"], "wali": "", "ekskul": ["PMR"] },
    "2027/2028": { "mapel": ["Bahasa Indonesia"], "wali": "X UJI", "ekskul": [] }
  }'::jsonb
where nis_nip = 'UJI-GR02' and tipe = 'guru';

insert into akun_kredensial (nis_nip, password_hash)
values ('UJI-GR02', crypt('uji1234', gen_salt('bf', 10)))
on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();

-- ========== 2. AKUN MURID UJI KEDUA (UJI998) + RIWAYAT KELAS UJI999 & UJI998 ==========

insert into akun (nis_nip, tipe, nama_lengkap, tingkat_kelas, tahun_pelajaran, semester, jenis_kelamin, agama, email, nisn, ekstrakurikuler)
select 'UJI998', 'murid', 'UJI Murid E2E Dua', 'X UJI', '2026/2027', 'Ganjil', 'P', 'Islam', 'uji998@example.com', '9999999998', 'Pramuka, PMR'
where not exists (select 1 from akun where nis_nip = 'UJI998' and tipe = 'murid');

insert into akun_kredensial (nis_nip, password_hash)
values ('UJI998', crypt('uji1234', gen_salt('bf', 10)))
on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();

-- UJI999: naik kelas dari X UJI (2026/2027) ke XI UJI (2027/2028); ikut Pramuka
update akun set
  ekstrakurikuler = 'Pramuka',
  riwayat_kelas = '{
    "2026/2027": { "kelas": "X UJI", "status": "Aktif", "ket": "" },
    "2027/2028": { "kelas": "XI UJI", "status": "Aktif", "ket": "Naik kelas" }
  }'::jsonb
where nis_nip = 'UJI999' and tipe = 'murid';

-- UJI998: naik kelas dari X UJI (2026/2027) ke XI UJI (2027/2028); ikut Pramuka & PMR
update akun set
  ekstrakurikuler = 'Pramuka, PMR',
  riwayat_kelas = '{
    "2026/2027": { "kelas": "X UJI", "status": "Aktif", "ket": "" },
    "2027/2028": { "kelas": "XI UJI", "status": "Aktif", "ket": "Naik kelas" }
  }'::jsonb
where nis_nip = 'UJI998' and tipe = 'murid';

-- ========== 3. EKSTRAKURIKULER UJI (Pramuka & PMR, pembina sesuai penugasan guru) ==========

insert into ekstrakurikuler (nama_ekskul, deskripsi, jadwal, pembina_nip)
select 'Pramuka', 'UJI Ekskul Pramuka E2E', 'Sabtu', 'UJI-GR01'
where not exists (select 1 from ekstrakurikuler where nama_ekskul = 'Pramuka');

update ekstrakurikuler set pembina_nip = 'UJI-GR01' where nama_ekskul = 'Pramuka';

insert into ekstrakurikuler (nama_ekskul, deskripsi, jadwal, pembina_nip)
select 'PMR', 'UJI Ekskul PMR E2E', 'Jumat', 'UJI-GR02'
where not exists (select 1 from ekstrakurikuler where nama_ekskul = 'PMR');

-- PMR: TA 2027/2028 UJI-GR02 berhenti jadi pembina → kosongkan pembina_nip (mencerminkan penugasan terbaru)
update ekstrakurikuler set pembina_nip = '' where nama_ekskul = 'PMR';

-- ========== 4. SUB-EKSTRAKURIKULER + ANGGOTA (UJI999 & UJI998) ==========

insert into sub_ekstrakurikuler (ekskul, nama_sub, urutan, anggota)
select 'Pramuka', 'UJI Pramuka Penggalang', 1, '["UJI999", "UJI998"]'::jsonb
where not exists (select 1 from sub_ekstrakurikuler where ekskul = 'Pramuka' and nama_sub = 'UJI Pramuka Penggalang');

update sub_ekstrakurikuler set anggota = '["UJI999", "UJI998"]'::jsonb
where ekskul = 'Pramuka' and nama_sub = 'UJI Pramuka Penggalang';

insert into sub_ekstrakurikuler (ekskul, nama_sub, urutan, anggota)
select 'PMR', 'UJI PMR Madya', 1, '["UJI998"]'::jsonb
where not exists (select 1 from sub_ekstrakurikuler where ekskul = 'PMR' and nama_sub = 'UJI PMR Madya');

update sub_ekstrakurikuler set anggota = '["UJI998"]'::jsonb
where ekskul = 'PMR' and nama_sub = 'UJI PMR Madya';

-- ========== 5. JADWAL PELAJARAN (Matematika, X UJI, TA 2026/2027, guru UJI-GR01) ==========
-- Dipakai untuk menguji perhitungan % kehadiran berbasis hari jadwal
-- (bukan generik hitungHariEfektif) di dashboard guru/laporan.

insert into jadwal_pelajaran ("ID Akun Guru", "ID Jadwal Murid", Tahun, Semester, Waktu, Mapel, "Tingkat/Kelas")
select 'UJI-GR01', 'UJI-JDW-001', '2026/2027', 'Ganjil', 'Senin', 'Matematika', 'X UJI'
where not exists (
  select 1 from jadwal_pelajaran
  where "ID Akun Guru" = 'UJI-GR01' and Tahun = '2026/2027' and Waktu = 'Senin' and Mapel = 'Matematika' and "Tingkat/Kelas" = 'X UJI'
);

insert into jadwal_pelajaran ("ID Akun Guru", "ID Jadwal Murid", Tahun, Semester, Waktu, Mapel, "Tingkat/Kelas")
select 'UJI-GR01', 'UJI-JDW-002', '2026/2027', 'Ganjil', 'Rabu', 'Matematika', 'X UJI'
where not exists (
  select 1 from jadwal_pelajaran
  where "ID Akun Guru" = 'UJI-GR01' and Tahun = '2026/2027' and Waktu = 'Rabu' and Mapel = 'Matematika' and "Tingkat/Kelas" = 'X UJI'
);

-- ========== 6. ABSENSI (mengikuti jadwal Senin & Rabu Matematika X UJI, TA 2026/2027) ==========
-- 4 baris per murid: pola realistis (Hadir/Sakit/Izin/Alpa) utk uji % kehadiran berbasis jadwal.

insert into absensi (nis, nama, tanggal, status, keterangan, mapel, kelas, tahun, semester, bulan, id_guru)
select v.nis, v.nama, v.tanggal::date, v.status, v.ket, 'Matematika', 'X UJI', '2026/2027', 'Ganjil',
  to_char(v.tanggal::date, 'TMMonth'), 'UJI-GR01'
from (values
  ('UJI999', 'UJI Murid E2E',      '2026-08-03', 'H', ''),
  ('UJI999', 'UJI Murid E2E',      '2026-08-05', 'H', ''),
  ('UJI999', 'UJI Murid E2E',      '2026-08-10', 'S', 'Sakit — surat dokter'),
  ('UJI999', 'UJI Murid E2E',      '2026-08-12', 'A', ''),
  ('UJI998', 'UJI Murid E2E Dua',  '2026-08-03', 'H', ''),
  ('UJI998', 'UJI Murid E2E Dua',  '2026-08-05', 'H', ''),
  ('UJI998', 'UJI Murid E2E Dua',  '2026-08-10', 'H', ''),
  ('UJI998', 'UJI Murid E2E Dua',  '2026-08-12', 'I', 'Izin keluarga')
) as v(nis, nama, tanggal, status, ket)
where not exists (
  select 1 from absensi a where a.nis = v.nis and a.tanggal = v.tanggal::date and a.mapel = 'Matematika'
);

-- ========== 7. NILAI (Pengetahuan Matematika + Eskul Pramuka, TA 2026/2027) ==========

insert into nilai (nis, nama, kategori, mapel, ekskul, kelas, tahun, semester, id_guru, data)
select v.nis, v.nama, 'Data Nilai Pengetahuan', 'Matematika', '', 'X UJI', '2026/2027', 'Ganjil', 'UJI-GR01', v.data::jsonb
from (values
  ('UJI999', 'UJI Murid E2E',     '{"Tugas 1": 85, "Tugas 2": 88, "Ulangan Harian": 90, "Nilai Akhir Raport": 88}'),
  ('UJI998', 'UJI Murid E2E Dua', '{"Tugas 1": 80, "Tugas 2": 82, "Ulangan Harian": 85, "Nilai Akhir Raport": 82}')
) as v(nis, nama, data)
on conflict (nis, kategori, mapel, ekskul, tahun, semester)
do update set data = excluded.data, nama = excluded.nama, kelas = excluded.kelas, id_guru = excluded.id_guru, updated_at = now();

insert into nilai (nis, nama, kategori, mapel, ekskul, kelas, tahun, semester, id_guru, data)
select v.nis, v.nama, 'Data Nilai Eskul', '', 'Pramuka', 'X UJI', '2026/2027', 'Ganjil', 'UJI-GR01', v.data::jsonb
from (values
  ('UJI999', 'UJI Murid E2E',     '{"Deskripsi": "Aktif dan disiplin mengikuti kegiatan Pramuka."}'),
  ('UJI998', 'UJI Murid E2E Dua', '{"Deskripsi": "Cukup aktif mengikuti kegiatan Pramuka."}')
) as v(nis, nama, data)
on conflict (nis, kategori, mapel, ekskul, tahun, semester)
do update set data = excluded.data, nama = excluded.nama, kelas = excluded.kelas, id_guru = excluded.id_guru, updated_at = now();

-- ========== 8. AKUN SISWA DENGAN JABATAN EKSTRAKURIKULER ==========
-- Kolom akun.jabatan_ekskul  = jabatan utama (ditampilkan di profil/kartu murid).
-- Kolom akun.jabatan_ekskul_map (jsonb) = peta jabatan PER EKSKUL (dipakai hak akses
-- pengurus ekskul murid: kelola nilai/absensi/agenda ekskul-nya sendiri).

-- UJI999: Ketua Pramuka (pembina UJI-GR01)
update akun set
  jabatan_ekskul = 'Ketua Pramuka',
  jabatan_ekskul_map = '{"Pramuka": "Ketua"}'::jsonb
where nis_nip = 'UJI999' and tipe = 'murid';

-- UJI998: Sekretaris PMR, sekaligus anggota biasa Pramuka
update akun set
  jabatan_ekskul = 'Sekretaris PMR',
  jabatan_ekskul_map = '{"Pramuka": "Anggota", "PMR": "Sekretaris"}'::jsonb
where nis_nip = 'UJI998' and tipe = 'murid';

-- UJI997 (murid uji baru): Bendahara Pramuka — melengkapi variasi jabatan (Ketua/Sekretaris/Bendahara)
insert into akun (nis_nip, tipe, nama_lengkap, tingkat_kelas, tahun_pelajaran, semester, jenis_kelamin, agama, email, nisn, ekstrakurikuler, jabatan_ekskul, jabatan_ekskul_map, riwayat_kelas)
select 'UJI997', 'murid', 'UJI Murid E2E Tiga', 'X UJI', '2026/2027', 'Ganjil', 'L', 'Islam', 'uji997@example.com', '9999999997',
  'Pramuka', 'Bendahara Pramuka', '{"Pramuka": "Bendahara"}'::jsonb,
  '{
    "2026/2027": { "kelas": "X UJI", "status": "Aktif", "ket": "" },
    "2027/2028": { "kelas": "XI UJI", "status": "Aktif", "ket": "Naik kelas" }
  }'::jsonb
where not exists (select 1 from akun where nis_nip = 'UJI997' and tipe = 'murid');

insert into akun_kredensial (nis_nip, password_hash)
values ('UJI997', crypt('uji1234', gen_salt('bf', 10)))
on conflict (nis_nip) do update set password_hash = excluded.password_hash, updated_at = now();

-- Sertakan UJI997 sebagai anggota sub Pramuka (konsisten dengan UJI999/UJI998)
update sub_ekstrakurikuler set anggota = '["UJI999", "UJI998", "UJI997"]'::jsonb
where ekskul = 'Pramuka' and nama_sub = 'UJI Pramuka Penggalang';

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';






