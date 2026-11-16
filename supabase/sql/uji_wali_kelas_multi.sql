-- ============================================================
-- UJI WALI KELAS MULTI (TAHAP 4A) — 2026-11-16
-- Jalankan SETELAH `upgrade_20261116_wali_kelas_multi.sql`
-- (atau setelah versi terbaru `gabungan.sql`).
--
-- CARA PAKAI
--   Supabase Dashboard → SQL Editor → tempel SELURUH berkas ini → Run.
--   Keluaran: NOTICE "✔ …" per pemeriksaan yang lulus, lalu ringkasan,
--   dan berakhir NOTICE "UJI WALI MULTI LULUS". Bila ada yang tidak sesuai,
--   transaksi gagal dengan pesan "UJI WALI MULTI GAGAL: <nama pemeriksaan>…".
--
-- AMAN — TANPA JEJAK
--   Seluruh uji berjalan di dalam SATU transaksi yang diakhiri ROLLBACK,
--   sehingga data uji (guru/murid UJIWM-*) TIDAK tertinggal di database.
-- ============================================================
begin;

-- 0) Alat bantu: bandingkan teks; beda → gagal (transaksi di-rollback).
create or replace function uji_wm_cek(p_nama text, p_dapat text, p_harap text)
returns void
language plpgsql
as $u$
begin
  if coalesce(p_dapat, '') is distinct from coalesce(p_harap, '') then
    raise exception 'UJI WALI MULTI GAGAL: % — dapat "%", harap "%".', p_nama, p_dapat, p_harap;
  end if;
  raise notice '✔ %', p_nama;
end $u$;

-- ============================================================
-- 1. HELPER MURNI
-- ============================================================
select uji_wm_cek('fn_wali_list string LAMA',
  array_to_string(fn_wali_list('"X LP 1"'::jsonb), '|'), 'X LP 1');
select uji_wm_cek('fn_wali_list array (trim + unik)',
  array_to_string(fn_wali_list('["X LP 1","x lp 1",""," "]'::jsonb), '|'), 'X LP 1|x lp 1');
select uji_wm_cek('fn_wali_list null jsonb',
  array_to_string(fn_wali_list('null'::jsonb), '|'), '');
select uji_wm_cek('fn_wali_list object (bukan array/string)',
  array_to_string(fn_wali_list('{"wali":"X LP 1"}'::jsonb), '|'), '');
select uji_wm_cek('fn_wali_list NULL SQL',
  array_to_string(fn_wali_list(null::jsonb), '|'), '');

select uji_wm_cek('fn_kelas_sama("10 RPL 1","X RPL 1")', fn_kelas_sama('10 RPL 1', 'X RPL 1')::text, 'true');
select uji_wm_cek('fn_kelas_sama("X-LP-1","X LP 1")', fn_kelas_sama('X-LP-1', 'X LP 1')::text, 'true');
select uji_wm_cek('fn_kelas_sama("X LP 1","X LP 2")', fn_kelas_sama('X LP 1', 'X LP 2')::text, 'false');
select uji_wm_cek('fn_kelas_sama("Semua Kelas","Hadir")', fn_kelas_sama('Semua Kelas', 'Hadir')::text, 'false');
select uji_wm_cek('fn_kelas_sama("","")', fn_kelas_sama('', '')::text, 'false');
select uji_wm_cek('fn_ta_berjalan() terisi', (fn_ta_berjalan() <> '')::text, 'true');

-- ============================================================
-- 2. TRIGGER + BACKFILL (data uji UJIWM-* → di-rollback)
-- ============================================================
insert into akun (nis_nip, nama_lengkap, tipe, penugasan, wali_kelas) values
  ('UJIWM-01', 'Uji Wali A', 'guru',
   '{"2026/2027":{"wali":["10 LP 1","X LP 2"],"ekskul":["PMR"]}}'::jsonb, 'X LP 1, X LP 2'),
  ('UJIWM-02', 'Uji Wali B', 'guru',
   '{"2025/2026":{"wali":"XI RPL 3"}}'::jsonb, ''),
  ('UJIWM-03', 'Uji Wali C', 'guru', null, 'XII IPA 1'),
  ('UJIWM-04', 'Uji Wali D', 'guru', '{"2026/2027":{"mapel":["Matematika"]}}'::jsonb, '');

select uji_wm_cek('GURU array 2 kelas → 2 baris',
  (select count(*)::text from wali_kelas_penugasan where btrim(nis_nip) = 'UJIWM-01'), '2');
select uji_wm_cek('GURU array 2 kelas → label kanonik',
  (select string_agg(kelas_label, '|' order by kelas_label) from wali_kelas_penugasan where btrim(nis_nip) = 'UJIWM-01'),
  'X LP 1|X LP 2');
select uji_wm_cek('GURU penugasan string LAMA → 1 baris',
  (select btrim(tahun_pelajaran) || ':' || kelas_label from wali_kelas_penugasan where btrim(nis_nip) = 'UJIWM-02'),
  '2025/2026:XI RPL 3');
select uji_wm_cek('GURU hanya kolom wali_kelas → TA berjalan',
  (select btrim(tahun_pelajaran) || ':' || kelas_label from wali_kelas_penugasan where btrim(nis_nip) = 'UJIWM-03'),
  fn_ta_berjalan() || ':XII IPA 1');
select uji_wm_cek('GURU tanpa wali → 0 baris',
  (select count(*)::text from wali_kelas_penugasan where btrim(nis_nip) = 'UJIWM-04'), '0');

select uji_wm_cek('fn_wali_kelas_list (semua TA)',
  array_to_string(fn_wali_kelas_list('UJIWM-01'), '|'), 'X LP 1|X LP 2');
select uji_wm_cek('fn_wali_kelas_list (TA tertentu)',
  array_to_string(fn_wali_kelas_list('UJIWM-01', '2026/2027'), '|'), 'X LP 1|X LP 2');
select uji_wm_cek('fn_wali_kelas_list (TA lain → kosong)',
  array_to_string(fn_wali_kelas_list('UJIWM-01', '2025/2026'), '|'), '');
select uji_wm_cek('fn_wali_kelas_map',
  (select array_to_string(array(select jsonb_array_elements_text(
            fn_wali_kelas_map('UJIWM-01') -> '2026/2027')), '|')),
  'X LP 1|X LP 2');
select uji_wm_cek('fn_wali_kelas_map guru tanpa wali',
  fn_wali_kelas_map('UJIWM-04')::text, '{}');
select uji_wm_cek('fn_guru_wali_ada(ada)', fn_guru_wali_ada('UJIWM-01')::text, 'true');
select uji_wm_cek('fn_guru_wali_ada(TA tepat)', fn_guru_wali_ada('UJIWM-01', '2026/2027')::text, 'true');
select uji_wm_cek('fn_guru_wali_ada(TA lain)', fn_guru_wali_ada('UJIWM-01', '2025/2026')::text, 'false');
select uji_wm_cek('fn_guru_wali_ada(cadangan kolom lama)', fn_guru_wali_ada('UJIWM-03')::text, 'true');
select uji_wm_cek('fn_guru_wali_ada(bukan wali)', fn_guru_wali_ada('UJIWM-04')::text, 'false');

-- ============================================================
-- 3. OTORISASI WALI MULTI (akun_guru_ampu_murid)
-- ============================================================
insert into akun (nis_nip, nama_lengkap, tipe, tingkat_kelas, riwayat_kelas, ekstrakurikuler) values
  ('UJIWM-M1', 'Uji Murid 1', 'murid', 'X LP 1',  null, ''),
  ('UJIWM-M2', 'Uji Murid 2', 'murid', 'XI LP 1', null, ''),
  ('UJIWM-M3', 'Uji Murid 3', 'murid', 'XI LP 1', '{"2025/2026":{"kelas":"X LP 1"}}'::jsonb, '');

select uji_wm_cek('ampu murid kelas wali ke-1', akun_guru_ampu_murid('UJIWM-01', 'UJIWM-M1')::text, 'true');
select uji_wm_cek('guru bukan wali → tidak ampu', akun_guru_ampu_murid('UJIWM-04', 'UJIWM-M1')::text, 'false');
select uji_wm_cek('ampu murid via riwayat_kelas (TA lalu)',
  akun_guru_ampu_murid('UJIWM-01', 'UJIWM-M3')::text, 'true');
select uji_wm_cek('NIS kosong → false', akun_guru_ampu_murid('', 'UJIWM-M1')::text, 'false');
select uji_wm_cek('kelas lain → tidak ampu', akun_guru_ampu_murid('UJIWM-01', 'UJIWM-M2')::text, 'false');

-- ============================================================
-- 4. SINKRON ULANG SAAT DATA DIUBAH
-- ============================================================
update akun
   set penugasan = '{"2026/2027":{"wali":["X LP 2"]}}'::jsonb,
       wali_kelas = ''
 where nis_nip = 'UJIWM-01';

select uji_wm_cek('dikurangi jadi 1 kelas',
  (select kelas_label from wali_kelas_penugasan where btrim(nis_nip) = 'UJIWM-01'), 'X LP 2');
select uji_wm_cek('fn_wali_kelas_list ikut menyusut',
  array_to_string(fn_wali_kelas_list('UJIWM-01'), '|'), 'X LP 2');

update akun set penugasan = '{"2026/2027":{"wali":["X LP 1","X LP 1","10 LP 1"]}}'::jsonb
 where nis_nip = 'UJIWM-04';
select uji_wm_cek('3 bentuk kelas sama → 1 baris',
  (select count(*)::text from wali_kelas_penugasan where btrim(nis_nip) = 'UJIWM-04'), '1');

update akun set tipe = 'murid' where nis_nip = 'UJIWM-02';
select uji_wm_cek('akun jadi murid → relasi dibersihkan',
  (select count(*)::text from wali_kelas_penugasan where btrim(nis_nip) = 'UJIWM-02'), '0');

-- ============================================================
-- 5. BACAAN fn_akun_json (field baru) & smoke fn_is_wali_kelas
-- ============================================================
select uji_wm_cek('fn_akun_json guru_wali → wali_kelas_list',
  (select array_to_string(array(select jsonb_array_elements_text(
            fn_akun_json((select id from akun where nis_nip = 'UJIWM-01'), 'guru_wali') -> 'wali_kelas_list')), '|')),
  'X LP 2');
select uji_wm_cek('fn_akun_json guru_wali → wali_kelas_map',
  (select array_to_string(array(select jsonb_array_elements_text(
            fn_akun_json((select id from akun where nis_nip = 'UJIWM-01'), 'guru_wali')
              -> 'wali_kelas_map' -> '2026/2027')), '|')),
  'X LP 2');
select uji_wm_cek('fn_akun_json guru_dashboard punya field baru',
  (fn_akun_json((select id from akun where nis_nip = 'UJIWM-01'), 'guru_dashboard') ? 'wali_kelas_map')::text,
  'true');
select uji_wm_cek('fn_akun_json guru_ringkas tidak berubah',
  (fn_akun_json((select id from akun where nis_nip = 'UJIWM-01'), 'guru_ringkas') ? 'wali_kelas_list')::text,
  'false');
select uji_wm_cek('fn_is_wali_kelas() dapat dipanggil', (fn_is_wali_kelas() is not null)::text, 'true');

-- ============================================================
-- 6. RINGKASAN + ROLLBACK (tanpa jejak data uji)
-- ============================================================
do $$
declare
  v_baris int;
begin
  select count(*) into v_baris from wali_kelas_penugasan
   where btrim(nis_nip) like 'UJIWM-%';
  raise notice 'ringkasan: % baris relasi wali uji terbentuk dari data uji.', v_baris;
  raise notice 'UJI WALI MULTI LULUS — semua pemeriksaan sesuai. Transaksi di-ROLLBACK (tanpa data uji tersisa).';
end $$;

rollback;
