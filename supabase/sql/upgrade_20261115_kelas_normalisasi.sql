-- ============================================================
-- UPGRADE: NORMALISASI KELAS — 2026-11-15
-- tingkat / jurusan_kode / jurusan / rombel + tabel master_jurusan
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG
--   Kelas disimpan sebagai SATU string gabungan "TINGKAT JURUSAN ROMBEL"
--   (contoh "X LP 1" = tingkat X + jurusan LP + rombel 1) di:
--     * master_data."Tingkat/Kelas"   (daftar induk kelas)
--     * akun.tingkat_kelas            (kelas statis murid)
--     * akun.riwayat_kelas[TA].kelas  (kelas efektif per tahun pelajaran)
--     * jadwal_pelajaran."Tingkat/Kelas"
--   Akibatnya filter/agregasi harus mengurai string di klien (split_part /
--   regexp), rawan salah untuk singkatan jurusan ber-tanda hubung, dan
--   data jurusan tidak bisa di-JOIN (nama jurusan hanya tersimpan sebagai
--   pasangan baris master_data "Jurusan" + "Jurusan Lengkap").
--
-- ISI (semua idempotent — aman dijalankan berulang):
--   1) Helper  : fn_normal_tingkat, fn_pecah_kelas, fn_label_kelas,
--                fn_enrich_riwayat_kelas
--   2) Tabel   : master_jurusan (kode → nama/jenjang/bidang) + RLS + backfill
--   3) Kolom   : master_data.tingkat/jurusan_kode/jurusan/rombel + kelas_label
--   4) Kolom   : akun.tingkat/jurusan_kode/jurusan/rombel + kelas_label
--                + riwayat_kelas[TA] diperkaya komponen terstruktur
--   5) Kolom   : jadwal_pelajaran.tingkat/jurusan_kode/jurusan/rombel
--   6) Trigger : sinkron DUA ARAH label ↔ kolom terstruktur (3 tabel)
--   7) RPC     : proses_kenaikan_kelas & simpan_riwayat_murid (tulis struktur),
--                fn_akun_export & fn_akun_json (tambah field struktur)
--   8) Verifikasi + reload cache skema PostgREST
--
-- KOMPATIBILITAS (penting)
--   Kolom LAMA ("Tingkat/Kelas", tingkat_kelas, riwayat_kelas[TA].kelas,
--   jadwal_pelajaran."Tingkat/Kelas") TIDAK dihapus dan TETAP ditulis.
--   Trigger bagian 6 menjaga keduanya konsisten, sehingga SELURUH modul lama
--   (absensi, nilai, ekskul, SPP, poin, absen mandiri, import/export) tetap
--   benar tanpa perubahan klien. Frontend boleh mulai membaca kolom
--   terstruktur kapan saja (bertahap) — lihat Tahap 3.
--   Trigger sengaja TIDAK PERNAH mengisi kolom master_data "Jurusan" /
--   "Jurusan Lengkap" pada baris kelas: klien lama memakai baris "kosong"
--   sebagai slot isian jurusan (tambahMasterDaftarJurusan / simpanWizard*),
--   jadi kolom itu tetap milik UI lama.
--
-- ROLLBACK
--   drop trigger trg_sync_kelas_master_data on master_data;
--   drop trigger trg_sync_kelas_akun on akun;
--   drop trigger trg_sync_kelas_jadwal on jadwal_pelajaran;
--   drop function if exists fn_sync_kelas_master_data();
--   drop function if exists fn_sync_kelas_akun();
--   drop function if exists fn_sync_kelas_jadwal();
--   alter table akun drop column if exists tingkat, drop column if exists
--     jurusan_kode, drop column if exists jurusan, drop column if exists
--     rombel, drop column if exists kelas_label;
--   alter table master_data drop column if exists tingkat, ... (idem);
--   alter table jadwal_pelajaran drop column if exists tingkat, ... (idem);
--   drop table if exists master_jurusan;
--   drop function if exists fn_pecah_kelas(text);
--   drop function if exists fn_normal_tingkat(text);
--   drop function if exists fn_label_kelas(text, text, integer);
--   drop function if exists fn_enrich_riwayat_kelas(jsonb);
-- ============================================================

-- ============================================================
-- 1. HELPER PENGURAI & PERAKIT LABEL KELAS
--    Format kanonik: "<TINGKAT> <JURUSAN_KODE> <ROMBEL>" → "X LP 1"
--    Bentuk lain yang ditoleransi: "10 RPL 1", "x rpl 1", "X-RPL-1",
--    "X LP" (tanpa rombel), "XII IPA 2".
--    Label BUKAN kelas ("", "Semua Kelas", "Hadir", "Islam", …) →
--    tingkat/jurusan_kode/rombel = NULL (tidak pernah salah tafsir).
-- ============================================================

-- 1a. Normalisasi tingkat: 10/11/12 → X/XI/XII; sisanya di-UPPER.
create or replace function fn_normal_tingkat(p text)
returns text
language sql
immutable
as $$
  select case upper(btrim(coalesce(p, '')))
           when '10' then 'X'
           when '11' then 'XI'
           when '12' then 'XII'
           else upper(btrim(coalesce(p, '')))
         end
$$;

comment on function fn_normal_tingkat(text) is
  'Normalisasi tingkat kelas: 10→X, 11→XI, 12→XII, sisanya di-UPPER.';

-- 1b. Pecah label kelas gabungan → (tingkat, jurusan_kode, rombel).
--     Token pertama = tingkat (romawi I/V/X atau angka 1-2 digit); angka di
--     akhir = nomor rombel; sisanya = kode jurusan (UPPER, spasi dirapikan).
create or replace function fn_pecah_kelas(p_label text)
returns table (tingkat text, jurusan_kode text, rombel integer)
language plpgsql
immutable
as $$
declare
  v    text;
  v_tk text;
  v_no integer;
  v_kd text;
begin
  v := btrim(regexp_replace(coalesce(p_label, ''), '\s+', ' ', 'g'));
  v := btrim(regexp_replace(v, '[-_]+', ' ', 'g'));

  if v = '' or v ~* 'semua' then
    return query select null::text, null::text, null::integer;
    return;
  end if;

  -- Token pertama harus tingkat — kalau bukan, ini bukan label kelas.
  v_tk := fn_normal_tingkat((regexp_match(v, '^(\S+)'))[1]);
  if v_tk !~ '^([IVX]+|[0-9]{1,2})$' then
    return query select null::text, null::text, null::integer;
    return;
  end if;

  -- Angka di akhir = nomor rombel (bila ada).
  v_no := nullif((regexp_match(v, '([0-9]{1,2})\s*$'))[1], '')::integer;

  -- Sisa antara tingkat dan nomor rombel = kode jurusan.
  v_kd := btrim(regexp_replace(regexp_replace(v, '^\S+\s*', ''), '\s*[0-9]{1,2}\s*$', ''));
  v_kd := nullif(upper(v_kd), '');

  return query select v_tk, v_kd, v_no;
end $$;

comment on function fn_pecah_kelas(text) is
  'Pecah label kelas gabungan ("X LP 1") → tingkat/jurusan_kode/rombel. Label non-kelas → NULL semua.';

-- 1c. Rakit kembali label kanonik dari komponen terstruktur.
--     (fn_label_kelas(fn_pecah_kelas(x)) = x untuk label kanonik.)
create or replace function fn_label_kelas(p_tingkat text, p_jurusan_kode text, p_rombel integer)
returns text
language sql
immutable
as $$
  select btrim(
    coalesce(btrim(coalesce(p_tingkat, '')), '')
    || case when coalesce(btrim(coalesce(p_jurusan_kode, '')), '') = ''
              then '' else ' ' || upper(btrim(p_jurusan_kode)) end
    || case when p_rombel is null then '' else ' ' || p_rombel::text end)
$$;

comment on function fn_label_kelas(text, text, integer) is
  'Rakit label kelas kanonik "<TINGKAT> <JURUSAN_KODE> <ROMBEL>" (kosong bila tingkat kosong).';

-- ============================================================
-- 2. TABEL REFERENSI master_jurusan
--    Sumber kanonik "kode jurusan → nama lengkap + pengelompokan".
--    Menggantikan pola lama pasangan baris master_data ("Jurusan" +
--    "Jurusan Lengkap") yang hanya bisa dibaca sebagai daftar datar.
-- ============================================================
create table if not exists master_jurusan (
  id uuid primary key default gen_random_uuid(),
  kode text not null default '',
  nama text not null default '',
  jenjang text not null default '',
  bidang text not null default '',
  aktif boolean not null default true,
  urutan integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- self-healing kolom (bila tabel sudah ada dari versi/percobaan sebelumnya)
alter table master_jurusan
  add column if not exists kode text not null default '',
  add column if not exists nama text not null default '',
  add column if not exists jenjang text not null default '',
  add column if not exists bidang text not null default '',
  add column if not exists aktif boolean not null default true,
  add column if not exists urutan integer not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists master_jurusan_kode_uniq on master_jurusan (upper(btrim(kode)));
create index if not exists idx_master_jurusan_aktif on master_jurusan (aktif, urutan, kode);

comment on table master_jurusan is
  'Referensi jurusan: kode (singkatan, UPPER) → nama lengkap, jenjang (SMA/SMK) & bidang. Dipakai helper kelas & (Tahap 3) dropdown jurusan.';
comment on column master_jurusan.kode is
  'Singkatan jurusan, disimpan UPPER (mis. RPL, LP, TKJ). Dicocokkan dengan akun.jurusan_kode / master_data.jurusan_kode.';

-- RLS & privilege (pola sama dengan master_data / jadwal_pelajaran)
alter table master_jurusan enable row level security;

drop policy if exists "master_jurusan_baca_semua" on master_jurusan;
create policy "master_jurusan_baca_semua" on master_jurusan
  for select using (true);

drop policy if exists "master_jurusan_tulis_authenticated" on master_jurusan;
create policy "master_jurusan_tulis_authenticated" on master_jurusan
  for insert to authenticated with check (true);

drop policy if exists "master_jurusan_ubah_authenticated" on master_jurusan;
create policy "master_jurusan_ubah_authenticated" on master_jurusan
  for update to authenticated using (true) with check (true);

drop policy if exists "master_jurusan_hapus_authenticated" on master_jurusan;
create policy "master_jurusan_hapus_authenticated" on master_jurusan
  for delete to authenticated using (true);

revoke all on table master_jurusan from anon, authenticated;
grant select on master_jurusan to anon, authenticated;
grant insert, update, delete on master_jurusan to authenticated;

-- 2a. BACKFILL dari pasangan baris master_data ("Jurusan" + "Jurusan Lengkap").
--     Satu kode bisa muncul di >1 baris → ambil nama lengkap yang terisi
--     (DISTINCT ON agar tidak ada baris ganda pada satu perintah upsert).
insert into master_jurusan (kode, nama)
select distinct on (upper(btrim(m."Jurusan")))
       upper(btrim(m."Jurusan")),
       coalesce(nullif(btrim(m."Jurusan Lengkap"), ''), '')
  from master_data m
 where coalesce(btrim(m."Jurusan"), '') <> ''
 order by upper(btrim(m."Jurusan")),
          (coalesce(nullif(btrim(m."Jurusan Lengkap"), ''), '') <> '') desc,
          btrim(m."Jurusan Lengkap")
on conflict (upper(btrim(kode))) do update
   set nama = case when coalesce(btrim(excluded.nama), '') <> ''
                     then excluded.nama else master_jurusan.nama end,
       updated_at = now();

-- 2b. PRESET pengelompokan jurusan (sumber: WIZARD_JURUSAN_GRUP di
--     web/js/app.js) — mengisi jenjang/bidang/urutan. Nama lengkap yang
--     SUDAH ada (dari backfill 2a atau input admin) tidak ditimpa.
insert into master_jurusan (kode, nama, jenjang, bidang, urutan)
select upper(p.kode), p.nama, p.jenjang, p.bidang, p.urutan
  from (values
    ('MIPA','Matematika dan Ilmu Pengetahuan Alam','SMA','SMA',10),
    ('IPS','Ilmu Pengetahuan Sosial','SMA','SMA',11),
    ('BB','Bahasa dan Budaya','SMA','SMA',12),
    ('SO','Seni dan Olahraga','SMA','SMA',13),
    ('TKJ','Teknik Komputer dan Jaringan','SMK','SMK - Teknologi',20),
    ('RPL','Rekayasa Perangkat Lunak','SMK','SMK - Teknologi',21),
    ('TKRO','Teknik Kendaraan Ringan Otomotif','SMK','SMK - Teknologi',22),
    ('TBSM','Teknik dan Bisnis Sepeda Motor','SMK','SMK - Teknologi',23),
    ('TITL','Teknik Instalasi Tenaga Listrik','SMK','SMK - Teknologi',24),
    ('TP','Teknik Pemesinan','SMK','SMK - Teknologi',25),
    ('TEI','Teknik Elektronika Industri','SMK','SMK - Teknologi',26),
    ('BKP','Bisnis Konstruksi dan Properti','SMK','SMK - Teknologi',27),
    ('DPIB','Desain Pemodelan dan Informasi Bangunan','SMK','SMK - Teknologi',28),
    ('TKR','Teknik Kendaraan Ringan','SMK','SMK - Teknologi',29),
    ('AKL','Akuntansi dan Keuangan Lembaga','SMK','SMK - Bisnis & Manajemen',30),
    ('LP','Layanan Perbankan','SMK','SMK - Bisnis & Manajemen',31),
    ('MPLB','Manajemen Perkantoran dan Layanan Bisnis','SMK','SMK - Bisnis & Manajemen',32),
    ('PM','Pemasaran','SMK','SMK - Bisnis & Manajemen',33),
    ('MLOG','Manajemen Logistik','SMK','SMK - Bisnis & Manajemen',34),
    ('PH','Perhotelan','SMK','SMK - Pariwisata',40),
    ('KL','Kuliner','SMK','SMK - Pariwisata',41),
    ('TB','Tata Busana','SMK','SMK - Pariwisata',42),
    ('ULW','Usaha Layanan Wisata','SMK','SMK - Pariwisata',43),
    ('FKK','Farmasi Klinis dan Komunitas','SMK','SMK - Kesehatan',50),
    ('TLM','Teknologi Laboratorium Medik','SMK','SMK - Kesehatan',51),
    ('KPR','Keperawatan','SMK','SMK - Kesehatan',52),
    ('ATPH','Agribisnis Tanaman Pangan dan Hortikultura','SMK','SMK - Agribisnis',60),
    ('ATBK','Agribisnis Ternak','SMK','SMK - Agribisnis',61),
    ('API','Agribisnis Perikanan','SMK','SMK - Agribisnis',62),
    ('AGRI','Agriteknologi Pengolahan Hasil Pertanian','SMK','SMK - Agribisnis',63),
    ('DKV','Desain Komunikasi Visual','SMK','SMK - Seni & Industri Kreatif',70),
    ('MM','Multimedia','SMK','SMK - Seni & Industri Kreatif',71),
    ('BC','Broadcasting dan Perfilman','SMK','SMK - Seni & Industri Kreatif',72)
  ) as p(kode, nama, jenjang, bidang, urutan)
on conflict (upper(btrim(kode))) do update
   set jenjang = excluded.jenjang,
       bidang = excluded.bidang,
       urutan = excluded.urutan,
       updated_at = now(),
       nama = case when coalesce(btrim(master_jurusan.nama), '') <> ''
                     then master_jurusan.nama else excluded.nama end;

-- 2c. Kode jurusan yang muncul di label kelas tetapi belum ada di referensi
--     (mis. kelas uji "X UJI 1") — didaftarkan dengan nama kosong supaya
--     admin bisa melengkapinya di menu Master Data → Jurusan.
insert into master_jurusan (kode, nama, urutan)
select distinct k.kode, '', 900
  from (
    select (fn_pecah_kelas(coalesce(m."Tingkat/Kelas", ''))).jurusan_kode as kode
      from master_data m
     where coalesce(btrim(m."Tingkat/Kelas"), '') <> ''
    union all
    select (fn_pecah_kelas(coalesce(a.tingkat_kelas, ''))).jurusan_kode
      from akun a
     where a.tipe = 'murid' and coalesce(btrim(a.tingkat_kelas), '') <> ''
    union all
    select (fn_pecah_kelas(coalesce(j."Tingkat/Kelas", ''))).jurusan_kode
      from jadwal_pelajaran j
     where coalesce(btrim(j."Tingkat/Kelas"), '') <> ''
  ) k
 where coalesce(k.kode, '') <> ''
on conflict (upper(btrim(kode))) do nothing;

-- 2d. Helper: perkaya tiap entri akun.riwayat_kelas[TA] dengan komponen
--     terstruktur. Diletakkan SETELAH master_jurusan karena fungsi bahasa SQL
--     memvalidasi rujukan tabel saat dibuat. Entri yang sudah punya 'tingkat'
--     (atau label kelasnya kosong) dibiarkan apa adanya — idempotent.
create or replace function fn_enrich_riwayat_kelas(p_riwayat jsonb)
returns jsonb
language sql
stable
as $$
  select case
    when p_riwayat is null or jsonb_typeof(p_riwayat) <> 'object'
      then coalesce(p_riwayat, '{}'::jsonb)
    else coalesce((
      select jsonb_object_agg(
               e.k,
               case
                 when jsonb_typeof(e.v) <> 'object' then e.v
                 when coalesce(btrim(coalesce(e.v ->> 'kelas', '')), '') = '' then e.v
                 when e.v ? 'tingkat' then e.v
                 else e.v || jsonb_strip_nulls(jsonb_build_object(
                        'tingkat',      pp.tingkat,
                        'jurusan_kode', pp.jurusan_kode,
                        'jurusan',      (select nullif(btrim(mj.nama), '')
                                           from master_jurusan mj
                                          where mj.kode = pp.jurusan_kode),
                        'rombel',       pp.rombel))
               end)
        from jsonb_each(p_riwayat) as e(k, v)
        cross join lateral fn_pecah_kelas(coalesce(e.v ->> 'kelas', '')) as pp
      ), '{}'::jsonb)
  end
$$;

comment on function fn_enrich_riwayat_kelas(jsonb) is
  'Tambah tingkat/jurusan_kode/jurusan/rombel ke tiap entri riwayat_kelas[TA] yang punya kelas tetapi belum punya tingkat (idempotent).';

-- ============================================================
-- 3. master_data — kolom terstruktur + label turunan
--    "Tingkat/Kelas" (lama, tetap ditulis klien) ⇄ tingkat/jurusan_kode/rombel
--    "Jurusan"/"Jurusan Lengkap" (lama) → jurusan_kode/jurusan
-- ============================================================
alter table master_data
  add column if not exists tingkat text,
  add column if not exists jurusan_kode text,
  add column if not exists jurusan text,
  add column if not exists rombel integer;

-- Label kanonik turunan (di-generate dari kolom terstruktur).
-- PENTING: memakai fn_label_kelas (IMMUTABLE) — concat_ws tidak boleh
-- dipakai di generated column (STABLE, bukan IMMUTABLE).
alter table master_data
  add column if not exists kelas_label text
  generated always as (fn_label_kelas(tingkat, jurusan_kode, rombel)) stored;

create index if not exists idx_master_data_kelas_struktur on master_data (tingkat, jurusan_kode, rombel);
create index if not exists idx_master_data_kelas_label on master_data (kelas_label);

comment on column master_data.tingkat is 'Tingkat kelas hasil urai "Tingkat/Kelas" (X/XI/XII). NULL = baris bukan kelas.';
comment on column master_data.jurusan_kode is 'Kode jurusan (UPPER, mis. LP) — dari label kelas atau kolom "Jurusan".';
comment on column master_data.jurusan is 'Nama jurusan lengkap (dari "Jurusan Lengkap" atau master_jurusan.nama).';
comment on column master_data.rombel is 'Nomor rombel (angka di akhir label kelas). NULL bila label tanpa nomor.';
comment on column master_data.kelas_label is 'Label kelas kanonik turunan dari tingkat/jurusan_kode/rombel (mis. "X LP 1").';

-- 3a. Backfill baris JURUSAN (baris yang mengisi kolom "Jurusan"):
--     cermin ke kolom terstruktur. Kolom lama tidak disentuh.
update master_data m
   set jurusan_kode = coalesce(m.jurusan_kode, nullif(upper(btrim(m."Jurusan")), '')),
       jurusan      = coalesce(m.jurusan, nullif(btrim(m."Jurusan Lengkap"), ''))
 where coalesce(btrim(m."Jurusan"), '') <> ''
   and (m.jurusan_kode is null or m.jurusan is null);

-- 3b. Backfill baris KELAS (baris yang mengisi "Tingkat/Kelas"):
--     urai label → tingkat/jurusan_kode/rombel, lalu lengkapi nama jurusan.
update master_data m
   set tingkat      = p.tingkat,
       jurusan_kode = coalesce(p.jurusan_kode, nullif(upper(btrim(m."Jurusan")), '')),
       rombel       = p.rombel,
       jurusan      = coalesce(
                        nullif(btrim(m."Jurusan Lengkap"), ''),
                        (select nullif(btrim(mj.nama), '') from master_jurusan mj
                          where mj.kode = coalesce(p.jurusan_kode, nullif(upper(btrim(m."Jurusan")), ''))),
                        m.jurusan)
  from (
    select mm.id,
           (fn_pecah_kelas(coalesce(mm."Tingkat/Kelas", ''))).tingkat      as tingkat,
           (fn_pecah_kelas(coalesce(mm."Tingkat/Kelas", ''))).jurusan_kode as jurusan_kode,
           (fn_pecah_kelas(coalesce(mm."Tingkat/Kelas", ''))).rombel       as rombel
      from master_data mm
     where coalesce(btrim(mm."Tingkat/Kelas"), '') <> ''
  ) p
 where m.id = p.id
   and (m.tingkat is null or m.jurusan_kode is null or m.rombel is null);

-- ============================================================
-- 4. akun — kolom terstruktur + label turunan + riwayat_kelas diperkaya
--    tingkat_kelas (lama, tetap ditulis RPC & klien) ⇄ tingkat/jurusan_kode/rombel
--    riwayat_kelas[TA].kelas (lama) → riwayat_kelas[TA].{tingkat,…}
-- ============================================================
alter table akun
  add column if not exists tingkat text,
  add column if not exists jurusan_kode text,
  add column if not exists jurusan text,
  add column if not exists rombel integer;

alter table akun
  add column if not exists kelas_label text
  generated always as (fn_label_kelas(tingkat, jurusan_kode, rombel)) stored;

create index if not exists idx_akun_kelas_struktur on akun (tingkat, jurusan_kode, rombel);
create index if not exists idx_akun_kelas_label on akun (kelas_label);

comment on column akun.tingkat is 'Tingkat kelas statis murid (X/XI/XII) hasil urai tingkat_kelas.';
comment on column akun.jurusan_kode is 'Kode jurusan (UPPER, mis. LP) hasil urai tingkat_kelas.';
comment on column akun.jurusan is 'Nama jurusan lengkap (master_jurusan.nama) — untuk dokumen/kartu.';
comment on column akun.rombel is 'Nomor rombel murid (angka di akhir tingkat_kelas).';
comment on column akun.kelas_label is 'Label kelas kanonik turunan dari tingkat/jurusan_kode/rombel (mis. "X LP 1").';

-- 4a. Backfill dari tingkat_kelas (kelas statis = kelas TA aktif).
update akun a
   set tingkat      = p.tingkat,
       jurusan_kode = p.jurusan_kode,
       rombel       = p.rombel,
       jurusan      = coalesce(a.jurusan,
                        (select nullif(btrim(mj.nama), '') from master_jurusan mj
                          where mj.kode = p.jurusan_kode))
  from (
    select aa.id,
           (fn_pecah_kelas(coalesce(aa.tingkat_kelas, ''))).tingkat      as tingkat,
           (fn_pecah_kelas(coalesce(aa.tingkat_kelas, ''))).jurusan_kode as jurusan_kode,
           (fn_pecah_kelas(coalesce(aa.tingkat_kelas, ''))).rombel       as rombel
      from akun aa
     where aa.tipe = 'murid'
       and coalesce(btrim(aa.tingkat_kelas), '') <> ''
  ) p
 where a.id = p.id
   and (a.tingkat is null or a.jurusan_kode is null or a.rombel is null);

-- 4b. Perkaya tiap entri riwayat_kelas[TA] (kelas efektif per tahun pelajaran).
update akun a
   set riwayat_kelas = fn_enrich_riwayat_kelas(a.riwayat_kelas)
 where a.tipe = 'murid'
   and jsonb_typeof(a.riwayat_kelas) = 'object'
   and a.riwayat_kelas <> fn_enrich_riwayat_kelas(a.riwayat_kelas);

-- ============================================================
-- 5. jadwal_pelajaran — kolom terstruktur
--    "Tingkat/Kelas" (lama, tetap ditulis klien) ⇄ tingkat/jurusan_kode/rombel
-- ============================================================
alter table jadwal_pelajaran
  add column if not exists tingkat text,
  add column if not exists jurusan_kode text,
  add column if not exists jurusan text,
  add column if not exists rombel integer;

create index if not exists idx_jadwal_kelas_struktur on jadwal_pelajaran (tingkat, jurusan_kode, rombel);

comment on column jadwal_pelajaran.tingkat is 'Tingkat kelas hasil urai "Tingkat/Kelas" (X/XI/XII).';
comment on column jadwal_pelajaran.jurusan_kode is 'Kode jurusan (UPPER, mis. LP) hasil urai "Tingkat/Kelas".';
comment on column jadwal_pelajaran.jurusan is 'Nama jurusan lengkap (master_jurusan.nama).';
comment on column jadwal_pelajaran.rombel is 'Nomor rombel (angka di akhir "Tingkat/Kelas").';

update jadwal_pelajaran j
   set tingkat      = p.tingkat,
       jurusan_kode = p.jurusan_kode,
       rombel       = p.rombel,
       jurusan      = coalesce(j.jurusan,
                        (select nullif(btrim(mj.nama), '') from master_jurusan mj
                          where mj.kode = p.jurusan_kode))
  from (
    select jj.id,
           (fn_pecah_kelas(coalesce(jj."Tingkat/Kelas", ''))).tingkat      as tingkat,
           (fn_pecah_kelas(coalesce(jj."Tingkat/Kelas", ''))).jurusan_kode as jurusan_kode,
           (fn_pecah_kelas(coalesce(jj."Tingkat/Kelas", ''))).rombel       as rombel
      from jadwal_pelajaran jj
     where coalesce(btrim(jj."Tingkat/Kelas"), '') <> ''
  ) p
 where j.id = p.id
   and (j.tingkat is null or j.jurusan_kode is null or j.rombel is null);

-- ============================================================
-- 6. SINKRONISASI DUA ARAH (label lama ⇄ kolom terstruktur)
--    Urutan keputusan (berlaku untuk ketiga tabel) — prinsip utama:
--    LABEL YANG SUDAH TERISI TIDAK PERNAH DIUBAH OLEH TRIGGER, sehingga
--    string lama (mis. "10 RPL 1") tidak diam-diam berubah dan tetap cocok
--    dengan penapis modul lama (absensi/nilai/jadwal).
--      1) Klien menulis LABEL kelas → kolom terstruktur mengikuti label
--         (klien lama tetap benar tanpa perubahan; klien baru pun boleh
--         mengirim label kanonik bersama struktur).
--      2) Label masih KOSONG & klien menulis kolom TERSTRUKTUR
--         → label kanonik diturunkan dari struktur (Tahap 3: menulis
--         struktur saja sudah cukup untuk baris baru).
--      3) Label diubah menjadi KOSONG → struktur ikut dikosongkan.
--      4) Tidak ada perubahan kelas → hanya mengisi yang masih kosong
--         (menyembuhkan baris lama tanpa mengubah nilai yang sudah benar).
--    master_data TIDAK PERNAH menulis "Jurusan"/"Jurusan Lengkap" (kolom itu
--    milik UI lama — lihat catatan KOMPATIBILITAS di header berkas).
-- ============================================================

-- 6a. master_data
create or replace function fn_sync_kelas_master_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label    text;
  v_lama     text := '';
  v_lbl_ubah boolean;
  v_str_ubah boolean;
  v_p        record;
  v_kode     text;
  v_nama     text;
begin
  v_label := coalesce(btrim(new."Tingkat/Kelas"), '');

  if tg_op = 'INSERT' then
    v_lbl_ubah := (v_label <> '');
    v_str_ubah := (new.tingkat is not null or new.jurusan_kode is not null or new.rombel is not null);
  else
    v_lama     := coalesce(btrim(old."Tingkat/Kelas"), '');
    v_lbl_ubah := (v_label is distinct from v_lama);
    v_str_ubah := (new.tingkat is distinct from old.tingkat)
               or (new.jurusan_kode is distinct from old.jurusan_kode)
               or (new.rombel is distinct from old.rombel);
  end if;

  if v_lbl_ubah and v_label <> '' then
    -- (1) klien menulis LABEL kelas → kolom terstruktur mengikuti label
    select * into v_p from fn_pecah_kelas(v_label);
    new.tingkat      := v_p.tingkat;
    new.jurusan_kode := v_p.jurusan_kode;
    new.rombel       := v_p.rombel;
  elsif v_str_ubah and v_label = '' and coalesce(new.tingkat, '') <> '' then
    -- (2) klien menulis kolom TERSTRUKTUR pada baris tanpa label → label diturunkan
    new."Tingkat/Kelas" := fn_label_kelas(new.tingkat, new.jurusan_kode, new.rombel);
  elsif v_lbl_ubah then
    -- (3) label diubah menjadi kosong → struktur dikosongkan
    new.tingkat      := null;
    new.jurusan_kode := null;
    new.rombel       := null;
  else
    -- (4) tidak ada perubahan kelas → hanya mengisi yang masih kosong
    if v_label <> '' then
      select * into v_p from fn_pecah_kelas(v_label);
      new.tingkat      := coalesce(new.tingkat, v_p.tingkat);
      new.jurusan_kode := coalesce(new.jurusan_kode, v_p.jurusan_kode);
      new.rombel       := coalesce(new.rombel, v_p.rombel);
    elsif coalesce(new.tingkat, '') <> '' then
      new."Tingkat/Kelas" := fn_label_kelas(new.tingkat, new.jurusan_kode, new.rombel);
    end if;
  end if;

  -- baris JURUSAN: kolom lama "Jurusan"/"Jurusan Lengkap" → kolom terstruktur.
  -- Arah sebaliknya SENGAJA tidak dilakukan (kolom itu milik UI lama).
  v_kode := nullif(upper(btrim(coalesce(new."Jurusan", ''))), '');
  v_nama := nullif(btrim(coalesce(new."Jurusan Lengkap", '')), '');

  if tg_op = 'INSERT' then
    if coalesce(new.jurusan_kode, '') = '' then
      new.jurusan_kode := v_kode;
    end if;
    if coalesce(new.jurusan, '') = '' then
      new.jurusan := v_nama;
    end if;
  else
    if v_kode is not null
       and v_kode is distinct from nullif(upper(btrim(coalesce(old."Jurusan", ''))), '') then
      new.jurusan_kode := v_kode;     -- kolom lama diubah eksplisit → ikut
    elsif coalesce(new.jurusan_kode, '') = '' then
      new.jurusan_kode := v_kode;
    end if;

    if v_nama is not null
       and v_nama is distinct from nullif(btrim(coalesce(old."Jurusan Lengkap", '')), '') then
      new.jurusan := v_nama;          -- kolom lama diubah eksplisit → ikut
    elsif coalesce(new.jurusan, '') = '' then
      new.jurusan := v_nama;
    end if;
  end if;

  -- nama jurusan dari referensi (bila masih kosong)
  if coalesce(new.jurusan, '') = '' and coalesce(new.jurusan_kode, '') <> '' then
    select nullif(btrim(mj.nama), '') into v_nama
      from master_jurusan mj where mj.kode = new.jurusan_kode;
    if v_nama is not null then
      new.jurusan := v_nama;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_sync_kelas_master_data on master_data;
create trigger trg_sync_kelas_master_data
  before insert or update on master_data
  for each row execute function fn_sync_kelas_master_data();

-- 6b. akun (label lama = tingkat_kelas)
create or replace function fn_sync_kelas_akun()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label    text;
  v_lama     text := '';
  v_lbl_ubah boolean;
  v_str_ubah boolean;
  v_p        record;
  v_nama     text;
begin
  v_label := coalesce(btrim(new.tingkat_kelas), '');

  if tg_op = 'INSERT' then
    v_lbl_ubah := (v_label <> '');
    v_str_ubah := (new.tingkat is not null or new.jurusan_kode is not null or new.rombel is not null);
  else
    v_lama     := coalesce(btrim(old.tingkat_kelas), '');
    v_lbl_ubah := (v_label is distinct from v_lama);
    v_str_ubah := (new.tingkat is distinct from old.tingkat)
               or (new.jurusan_kode is distinct from old.jurusan_kode)
               or (new.rombel is distinct from old.rombel);
  end if;

  if v_lbl_ubah and v_label <> '' then
    -- (1) klien menulis LABEL kelas → kolom terstruktur mengikuti label
    select * into v_p from fn_pecah_kelas(v_label);
    new.tingkat      := v_p.tingkat;
    new.jurusan_kode := v_p.jurusan_kode;
    new.rombel       := v_p.rombel;
  elsif v_str_ubah and v_label = '' and coalesce(new.tingkat, '') <> '' then
    -- (2) klien menulis kolom TERSTRUKTUR pada baris tanpa label → label diturunkan
    new.tingkat_kelas := fn_label_kelas(new.tingkat, new.jurusan_kode, new.rombel);
  elsif v_lbl_ubah then
    -- (3) label diubah menjadi kosong → struktur dikosongkan
    new.tingkat      := null;
    new.jurusan_kode := null;
    new.rombel       := null;
  else
    -- (4) tidak ada perubahan kelas → hanya mengisi yang masih kosong
    if v_label <> '' then
      select * into v_p from fn_pecah_kelas(v_label);
      new.tingkat      := coalesce(new.tingkat, v_p.tingkat);
      new.jurusan_kode := coalesce(new.jurusan_kode, v_p.jurusan_kode);
      new.rombel       := coalesce(new.rombel, v_p.rombel);
    elsif coalesce(new.tingkat, '') <> '' then
      new.tingkat_kelas := fn_label_kelas(new.tingkat, new.jurusan_kode, new.rombel);
    end if;
  end if;

  -- nama jurusan lengkap (untuk dokumen/kartu) — diambil dari referensi
  if coalesce(new.jurusan_kode, '') <> '' then
    if tg_op = 'INSERT' then
      if coalesce(new.jurusan, '') = '' then
        select nullif(btrim(mj.nama), '') into v_nama
          from master_jurusan mj where mj.kode = new.jurusan_kode;
        if v_nama is not null then
          new.jurusan := v_nama;
        end if;
      end if;
    elsif new.jurusan_kode is distinct from old.jurusan_kode
          or coalesce(new.jurusan, '') = '' then
      select nullif(btrim(mj.nama), '') into v_nama
        from master_jurusan mj where mj.kode = new.jurusan_kode;
      if v_nama is not null then
        new.jurusan := v_nama;
      end if;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_sync_kelas_akun on akun;
create trigger trg_sync_kelas_akun
  before insert or update on akun
  for each row execute function fn_sync_kelas_akun();

-- 6c. jadwal_pelajaran (label lama = "Tingkat/Kelas")
create or replace function fn_sync_kelas_jadwal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label    text;
  v_lama     text := '';
  v_lbl_ubah boolean;
  v_str_ubah boolean;
  v_p        record;
  v_nama     text;
begin
  v_label := coalesce(btrim(new."Tingkat/Kelas"), '');

  if tg_op = 'INSERT' then
    v_lbl_ubah := (v_label <> '');
    v_str_ubah := (new.tingkat is not null or new.jurusan_kode is not null or new.rombel is not null);
  else
    v_lama     := coalesce(btrim(old."Tingkat/Kelas"), '');
    v_lbl_ubah := (v_label is distinct from v_lama);
    v_str_ubah := (new.tingkat is distinct from old.tingkat)
               or (new.jurusan_kode is distinct from old.jurusan_kode)
               or (new.rombel is distinct from old.rombel);
  end if;

  if v_lbl_ubah and v_label <> '' then
    -- (1) klien menulis LABEL kelas → kolom terstruktur mengikuti label
    select * into v_p from fn_pecah_kelas(v_label);
    new.tingkat      := v_p.tingkat;
    new.jurusan_kode := v_p.jurusan_kode;
    new.rombel       := v_p.rombel;
  elsif v_str_ubah and v_label = '' and coalesce(new.tingkat, '') <> '' then
    -- (2) klien menulis kolom TERSTRUKTUR pada baris tanpa label → label diturunkan
    new."Tingkat/Kelas" := fn_label_kelas(new.tingkat, new.jurusan_kode, new.rombel);
  elsif v_lbl_ubah then
    -- (3) label diubah menjadi kosong → struktur dikosongkan
    new.tingkat      := null;
    new.jurusan_kode := null;
    new.rombel       := null;
  else
    -- (4) tidak ada perubahan kelas → hanya mengisi yang masih kosong
    if v_label <> '' then
      select * into v_p from fn_pecah_kelas(v_label);
      new.tingkat      := coalesce(new.tingkat, v_p.tingkat);
      new.jurusan_kode := coalesce(new.jurusan_kode, v_p.jurusan_kode);
      new.rombel       := coalesce(new.rombel, v_p.rombel);
    elsif coalesce(new.tingkat, '') <> '' then
      new."Tingkat/Kelas" := fn_label_kelas(new.tingkat, new.jurusan_kode, new.rombel);
    end if;
  end if;

  if coalesce(new.jurusan_kode, '') <> '' then
    if tg_op = 'INSERT' then
      if coalesce(new.jurusan, '') = '' then
        select nullif(btrim(mj.nama), '') into v_nama
          from master_jurusan mj where mj.kode = new.jurusan_kode;
        if v_nama is not null then
          new.jurusan := v_nama;
        end if;
      end if;
    elsif new.jurusan_kode is distinct from old.jurusan_kode
          or coalesce(new.jurusan, '') = '' then
      select nullif(btrim(mj.nama), '') into v_nama
        from master_jurusan mj where mj.kode = new.jurusan_kode;
      if v_nama is not null then
        new.jurusan := v_nama;
      end if;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_sync_kelas_jadwal on jadwal_pelajaran;
create trigger trg_sync_kelas_jadwal
  before insert or update on jadwal_pelajaran
  for each row execute function fn_sync_kelas_jadwal();

-- ============================================================
-- 7. RPC — PENULIS KELAS IKUT MENGISI KOLOM TERSTRUKTUR
--    Signature, pesan, dan aturan otorisasi TIDAK berubah
--    (hanya daftar kolom yang ditulis bertambah).
-- ============================================================

-- 7a. proses_kenaikan_kelas(p_ta_tujuan, p_siswa) — versi 20260915 +
--     tingkat/jurusan_kode/jurusan/rombel & riwayat_kelas[TA] terstruktur.
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
        tingkat      = p.tingkat,
        jurusan_kode = p.jurusan_kode,
        rombel       = p.rombel,
        jurusan      = coalesce(
                         (select nullif(btrim(mj.nama), '') from master_jurusan mj
                           where mj.kode = p.jurusan_kode),
                         a.jurusan),
        riwayat_kelas = coalesce(a.riwayat_kelas, '{}'::jsonb) || jsonb_build_object(
          p_ta_tujuan,
          jsonb_build_object('kelas', s.kelas, 'status', s.status, 'ket', s.ket)
            || jsonb_strip_nulls(jsonb_build_object(
                 'tingkat',      p.tingkat,
                 'jurusan_kode', p.jurusan_kode,
                 'rombel',       p.rombel))
        )
    from jsonb_to_recordset(p_siswa) as s(id uuid, kelas text, status text, ket text)
    cross join lateral fn_pecah_kelas(coalesce(s.kelas, '')) as p
    where a.id = s.id
      and a.tipe = 'murid'
      and coalesce(trim(s.kelas), '') <> '';

    get diagnostics v_diperbarui = row_count;
  exception when others then
    return json_build_object('status', 'error', 'message', 'Gagal memperbarui data: ' || SQLERRM);
  end;

  return json_build_object('status', 'success', 'diperbarui', v_diperbarui);
end $$;

-- 7b. simpan_riwayat_murid(nis, riwayat_kelas, tingkat_kelas, riwayat_ekskul,
--     token, klaim_nis) — versi 20261028b + riwayat_kelas diperkaya komponen
--     terstruktur. Kolom tingkat/jurusan_kode/rombel diisi otomatis oleh
--     trigger akun ketika tingkat_kelas berubah (label = sumber kebenaran).
create or replace function simpan_riwayat_murid(
  p_nis            text,
  p_riwayat_kelas  jsonb default null,
  p_tingkat_kelas  text default '',
  p_riwayat_ekskul jsonb default null,
  p_token          text default '',
  p_klaim_nis      text default ''
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nis  text := trim(coalesce(p_nis, ''));
  v_staf boolean := (fn_is_admin() or fn_is_guru());
  v_sesi text;
  v_n    integer;
begin
  if v_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;

  v_sesi := fn_akses_murid(p_token, p_klaim_nis);
  if not v_staf and (v_sesi is null or v_sesi <> v_nis) then
    return json_build_object('status', 'error', 'message', 'Akses ditolak.');
  end if;

  if not exists (select 1 from akun where nis_nip = v_nis and tipe = 'murid') then
    return json_build_object('status', 'error', 'message', 'NIS murid tidak ditemukan.');
  end if;

  update akun a
     set riwayat_kelas  = fn_enrich_riwayat_kelas(fn_jsonb_atau(p_riwayat_kelas, a.riwayat_kelas)),
         tingkat_kelas  = coalesce(nullif(trim(coalesce(p_tingkat_kelas, '')), ''), a.tingkat_kelas),
         riwayat_ekskul = fn_jsonb_atau(p_riwayat_ekskul, a.riwayat_ekskul)
   where a.nis_nip = v_nis and a.tipe = 'murid';

  get diagnostics v_n = row_count;
  return json_build_object('status', 'success', 'baris', v_n);
end $$;

-- 7c. fn_akun_export(p_id) — versi 20261028b + 4 kolom kelas terstruktur
--     (Tahap 3: export/cetak memakai komponen, bukan mengurai label lagi).
create or replace function fn_akun_export(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'user_id', a.user_id, 'nis_nip', a.nis_nip, 'nisn', a.nisn,
    'nama_lengkap', a.nama_lengkap, 'tingkat_kelas', a.tingkat_kelas,
    'riwayat_kelas', a.riwayat_kelas, 'jenis_kelamin', a.jenis_kelamin,
    'tgl_lahir', a.tgl_lahir, 'agama', a.agama, 'golongan_darah', a.golongan_darah,
    'ekstrakurikuler', a.ekstrakurikuler, 'jabatan', a.jabatan,
    'jabatan_ekskul', a.jabatan_ekskul, 'nama_ayah', a.nama_ayah,
    'pekerjaan_ayah', a.pekerjaan_ayah, 'nama_ibu', a.nama_ibu,
    'pekerjaan_ibu', a.pekerjaan_ibu, 'nama_wali', a.nama_wali, 'alamat', a.alamat,
    'no_telepon', a.no_telepon, 'email', a.email, 'catatan_khusus', a.catatan_khusus,
    'tahun_pelajaran', a.tahun_pelajaran, 'semester', a.semester,
    'url_foto', a.url_foto, 'alamat_maps', a.alamat_maps, 'media_sosial', a.media_sosial,
    'tingkat', a.tingkat, 'jurusan_kode', a.jurusan_kode, 'jurusan', a.jurusan,
    'rombel', a.rombel, 'kelas_label', a.kelas_label)
  from akun a
  where a.id = p_id
$$;

-- 7d. fn_akun_json(p_id, p_mode) — versi 20261028b + 4 kolom kelas terstruktur
--     pada mode 'list' dan 'ringkas_murid' (dua mode yang dipakai daftar murid,
--     absensi, nilai, poin, SPP, perpustakaan, dan Data Akun Murid).
--     Mode lain tidak berubah; 'penuh' otomatis ikut (to_jsonb seluruh kolom).
create or replace function fn_akun_json(p_id uuid, p_mode text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case coalesce(nullif(trim(p_mode), ''), 'ringkas_murid')

    when 'penuh' then to_jsonb(a)

    -- ---------- profil staf/murid (whitelist 17 kolom; app.js bukaProfilAkun) ----------
    when 'profil_akun' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap,
      'gelar_depan', a.gelar_depan, 'gelar_belakang', a.gelar_belakang,
      'email', a.email, 'tingkat_kelas', a.tingkat_kelas, 'jabatan', a.jabatan,
      'wali_kelas', a.wali_kelas, 'mapel', a.mapel, 'ekstrakurikuler', a.ekstrakurikuler,
      'penugasan', a.penugasan, 'no_telepon', a.no_telepon,
      'jenis_kelamin', a.jenis_kelamin, 'agama', a.agama, 'nisn', a.nisn,
      'tipe', a.tipe, 'url_foto', a.url_foto)

    -- ---------- potongan kecil ----------
    when 'foto' then jsonb_build_object('url_foto', a.url_foto)
    when 'nis'  then jsonb_build_object('nis_nip', a.nis_nip)
    when 'jabatan_map' then jsonb_build_object(
      'jabatan_ekskul_map', coalesce(a.jabatan_ekskul_map, '{}'::jsonb))

    when 'identitas' then jsonb_build_object(
      'id', a.id, 'tipe', a.tipe, 'nis_nip', a.nis_nip, 'user_id', a.user_id,
      'email', a.email, 'nama_lengkap', a.nama_lengkap,
      'tingkat_kelas', a.tingkat_kelas, 'url_foto', a.url_foto)

    when 'wajah' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap,
      'tingkat_kelas', a.tingkat_kelas, 'url_foto', a.url_foto,
      'wajah_descriptor', a.wajah_descriptor, 'wajah_status', a.wajah_status)

    when 'peta_wajah' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'wajah_descriptor', a.wajah_descriptor,
      'wajah_status', a.wajah_status)

    -- ---------- guru/admin ----------
    when 'guru_ringkas' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap,
      'gelar_depan', a.gelar_depan, 'gelar_belakang', a.gelar_belakang)

    when 'guru_wali' then jsonb_build_object(
      'nama_lengkap', a.nama_lengkap, 'gelar_depan', a.gelar_depan,
      'gelar_belakang', a.gelar_belakang, 'wali_kelas', a.wali_kelas)

    when 'guru_kanal_absen' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap, 'mapel', a.mapel,
      'ekstrakurikuler', a.ekstrakurikuler, 'kunci_absen', a.kunci_absen)

    when 'guru_pembina' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap,
      'gelar_depan', a.gelar_depan, 'gelar_belakang', a.gelar_belakang,
      'no_telepon', a.no_telepon, 'ekstrakurikuler', a.ekstrakurikuler)

    when 'guru_penugasan' then jsonb_build_object(
      'id', a.id, 'nis_nip', a.nis_nip, 'penugasan', a.penugasan)

    when 'guru_penugasan_ringkas' then jsonb_build_object(
      'id', a.id, 'penugasan', a.penugasan)

    when 'guru_dashboard' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap, 'mapel', a.mapel,
      'ekstrakurikuler', a.ekstrakurikuler, 'wali_kelas', a.wali_kelas,
      'penugasan', a.penugasan, 'tingkat_kelas', a.tingkat_kelas,
      'captcha', a.captcha, 'kunci_absen', a.kunci_absen,
      'no_telepon', a.no_telepon, 'gelar_depan', a.gelar_depan,
      'gelar_belakang', a.gelar_belakang)

    -- ---------- murid: daftar (+ kelas terstruktur) ----------
    when 'list' then jsonb_build_object(
      'id', a.id, 'user_id', a.user_id, 'nis_nip', a.nis_nip, 'nisn', a.nisn,
      'nama_lengkap', a.nama_lengkap, 'tingkat_kelas', a.tingkat_kelas,
      'jabatan', a.jabatan, 'jabatan_ekskul', a.jabatan_ekskul, 'email', a.email,
      'ekstrakurikuler', a.ekstrakurikuler, 'tahun_pelajaran', a.tahun_pelajaran,
      'semester', a.semester, 'riwayat_kelas', a.riwayat_kelas, 'url_foto', a.url_foto,
      'tingkat', a.tingkat, 'jurusan_kode', a.jurusan_kode, 'jurusan', a.jurusan,
      'rombel', a.rombel, 'kelas_label', a.kelas_label)

    when 'export' then fn_akun_export(a.id)
    when 'cetak'  then fn_akun_export(a.id)
                        || jsonb_build_object('jabatan_ekskul_map', coalesce(a.jabatan_ekskul_map, '{}'::jsonb))

    when 'ringkas_murid' then jsonb_build_object(
      'id', a.id, 'nis_nip', a.nis_nip, 'nisn', a.nisn, 'nama_lengkap', a.nama_lengkap,
      'tingkat_kelas', a.tingkat_kelas, 'ekstrakurikuler', a.ekstrakurikuler,
      'riwayat_kelas', a.riwayat_kelas, 'tahun_pelajaran', a.tahun_pelajaran,
      'semester', a.semester,
      'tingkat', a.tingkat, 'jurusan_kode', a.jurusan_kode, 'jurusan', a.jurusan,
      'rombel', a.rombel, 'kelas_label', a.kelas_label)

    when 'ekskul_map' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'ekstrakurikuler', a.ekstrakurikuler,
      'riwayat_ekskul', a.riwayat_ekskul,
      'jabatan_ekskul_map', coalesce(a.jabatan_ekskul_map, '{}'::jsonb))

    when 'dashboard_murid' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nisn', a.nisn, 'nama_lengkap', a.nama_lengkap,
      'tingkat_kelas', a.tingkat_kelas, 'riwayat_kelas', a.riwayat_kelas,
      'jenis_kelamin', a.jenis_kelamin, 'agama', a.agama,
      'catatan_khusus', a.catatan_khusus, 'ekstrakurikuler', a.ekstrakurikuler,
      'jabatan', a.jabatan, 'jabatan_ekskul_map', coalesce(a.jabatan_ekskul_map, '{}'::jsonb),
      'riwayat_ekskul', a.riwayat_ekskul, 'tahun_pelajaran', a.tahun_pelajaran,
      'semester', a.semester, 'no_telepon', a.no_telepon)

    when 'anggota_ekskul' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap,
      'tingkat_kelas', a.tingkat_kelas, 'jabatan', a.jabatan,
      'no_telepon', a.no_telepon, 'tgl_lahir', a.tgl_lahir,
      'jabatan_ekskul_map', coalesce(a.jabatan_ekskul_map, '{}'::jsonb),
      'riwayat_ekskul', a.riwayat_ekskul, 'tahun_pelajaran', a.tahun_pelajaran,
      'tingkat', a.tingkat, 'jurusan_kode', a.jurusan_kode, 'jurusan', a.jurusan,
      'rombel', a.rombel, 'kelas_label', a.kelas_label)

    when 'pemilih' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap,
      'tingkat_kelas', a.tingkat_kelas, 'tahun_pelajaran', a.tahun_pelajaran,
      'ekstrakurikuler', a.ekstrakurikuler, 'jabatan', a.jabatan,
      'no_telepon', a.no_telepon)

    when 'pemilih_ringkas' then jsonb_build_object(
      'nis_nip', a.nis_nip, 'nama_lengkap', a.nama_lengkap,
      'tahun_pelajaran', a.tahun_pelajaran, 'tingkat_kelas', a.tingkat_kelas,
      'ekstrakurikuler', a.ekstrakurikuler)

    else to_jsonb(a)
  end
  from akun a
  where a.id = p_id
$$;

-- ============================================================
-- 8. VERIFIKASI & RELOAD CACHE SKEMA POSTGREST
-- ============================================================
do $$
declare
  v_ada int;
  v_trg int;
  v_kls int;
  v_jur int;
  v_rk  int;
  v_mj  int;
begin
  -- (a) 14 kolom terstruktur/generated wajib ada
  select count(*) into v_ada
    from information_schema.columns
   where table_schema = 'public'
     and (table_name, column_name) in (
       ('master_data','tingkat'), ('master_data','jurusan_kode'), ('master_data','jurusan'),
       ('master_data','rombel'), ('master_data','kelas_label'),
       ('akun','tingkat'), ('akun','jurusan_kode'), ('akun','jurusan'),
       ('akun','rombel'), ('akun','kelas_label'),
       ('jadwal_pelajaran','tingkat'), ('jadwal_pelajaran','jurusan_kode'),
       ('jadwal_pelajaran','jurusan'), ('jadwal_pelajaran','rombel'));

  if v_ada <> 14 then
    raise exception 'NORMALISASI KELAS GAGAL: kolom terstruktur hanya % dari 14.', v_ada;
  end if;

  -- (b) tiga trigger sinkronisasi terpasang
  select count(*) into v_trg
    from pg_trigger
   where not tgisinternal
     and tgname in ('trg_sync_kelas_master_data', 'trg_sync_kelas_akun', 'trg_sync_kelas_jadwal');

  if v_trg <> 3 then
    raise exception 'NORMALISASI KELAS GAGAL: trigger sinkronisasi hanya % dari 3.', v_trg;
  end if;

  -- (c) empat helper fungsi tersedia
  select count(*) into v_ada
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fn_normal_tingkat', 'fn_pecah_kelas', 'fn_label_kelas',
                       'fn_enrich_riwayat_kelas');

  if v_ada <> 4 then
    raise exception 'NORMALISASI KELAS GAGAL: helper fungsi hanya % dari 4.', v_ada;
  end if;

  -- (d) laporan backfill
  select count(*) filter (where coalesce(tingkat, '') <> ''),
         count(*) filter (where coalesce(jurusan_kode, '') <> '')
    into v_kls, v_jur
    from master_data;

  select count(*) into v_rk
    from akun where tipe = 'murid' and coalesce(tingkat, '') <> '';

  select count(*) into v_mj from master_jurusan;

  raise notice 'Normalisasi kelas OK — master_data: % baris kelas / % baris jurusan; akun murid berkelas terstruktur: %; master_jurusan: % kode.',
    v_kls, v_jur, v_rk, v_mj;

  if v_mj = 0 then
    raise warning 'master_jurusan KOSONG — lengkapi menu Master Data → Jurusan agar nama jurusan tampil di dokumen/kartu.';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- CARA PAKAI
--   1) Jalankan SELURUH berkas ini sekali di Supabase SQL Editor.
--   2) Aman dijalankan kapan saja: kolom lama tetap ditulis klien lama
--      (trigger menjaga keduanya konsisten) — jadi TIDAK ada frontend
--      yang perlu di-deploy bersamaan.
--   3) Setelah ini, kolom terstruktur boleh dibaca/ditulis klien baru
--      (tingkat, jurusan_kode, jurusan, rombel, kelas_label) tanpa
--      mengubah kolom lama.
-- ============================================================















