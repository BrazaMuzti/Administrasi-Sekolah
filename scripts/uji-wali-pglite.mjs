/**
 * scripts/uji-wali-pglite.mjs — UJI NYATA migrasi wali kelas multi (Tahap 4A)
 * di Postgres asli via PGlite (WASM).
 *
 *   deno run -A --node-modules-dir=auto scripts/uji-wali-pglite.mjs
 *
 * (Deno di dalam repo memakai `package.json` — tanpa `--node-modules-dir=auto`
 *  dependensi npm tidak ditemukan.) OPSIONAL & TIDAK dipanggil CI (butuh
 * jaringan sekali untuk mengunduh `@electric-sql/pglite` dari npm; CI repo
 * sengaja bebas dependensi).
 * Membangun lingkungan minimal ala Supabase (schema auth, peran anon/
 * authenticated, tabel akun/master_data/master_jurusan, helper kelas Tahap 2)
 * lalu **menjalankan SELURUH** `upgrade_20261116_wali_kelas_multi.sql` dan
 * menguji perilakunya: helper murni, trigger sinkron, backfill (penugasan
 * array/string LAMA/kolom `wali_kelas`), otorisasi wali multi
 * (`akun_guru_ampu_murid`, `fn_is_wali_kelas`, gerbang `ubah_anggota_ekskul`),
 * field baru `fn_akun_json`, serta menjalankan `uji_wali_kelas_multi.sql`
 * (berkas uji SQL untuk Supabase SQL Editor) + memastikan ROLLBACK-nya bersih.
 *
 * Keluar dengan kode 1 bila ada pemeriksaan yang gagal.
 */
import { PGlite } from 'npm:@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const baca = (p) => readFileSync(p, 'utf8');
// Sejak konsolidasi, berkas migrasi satu-per-satu DIHAPUS — ambil bloknya dari
// `gabungan.sql` (sumber kebenaran tunggal) lewat marker `-- [n/M] nama.sql`.
const GABUNGAN = baca(join(ROOT, 'supabase', 'sql', 'gabungan.sql'));
const blok = (nama) => {
  const esc = nama.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = GABUNGAN.match(new RegExp('^-- \\[\\d+\\/\\d+\\] ' + esc + '\\s*$', 'm'));
  if (!m) throw new Error('blok tidak ditemukan di gabungan.sql: ' + nama);
  const sisa = GABUNGAN.slice(m.index + m[0].length);
  const akhir = sisa.search(/^-- \[\d+\/\d+\] .+\.sql\s*$/m);
  return akhir < 0 ? sisa : sisa.slice(0, akhir);
};
const baru = blok('upgrade_20261116_wali_kelas_multi.sql');
const lama15 = blok('upgrade_20261115_kelas_normalisasi.sql');

function ekstrak(src, header, end = '$$;') {
  const i = src.indexOf(header);
  if (i < 0) throw new Error('tidak ditemukan: ' + header);
  const j = src.indexOf(end, i);
  return src.slice(i, j + end.length);
}

const db = new PGlite();

let lulus = 0, gagal = 0;
const cek = (nama, dapat, harap) => {
  const a = JSON.stringify(dapat), b = JSON.stringify(harap);
  if (a === b) { lulus++; console.log('  ✓ ' + nama); }
  else { gagal++; console.log('  ✗ ' + nama + '\n      dapat : ' + a + '\n      harap : ' + b); }
};
const bagian = (t) => console.log('\n── ' + t);
const satu = async (sql) => (await db.query(sql)).rows[0].v;

// ── 1. lingkungan minimal ───────────────────────────────────────────────────
await db.exec(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  end $$;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $u$
    select '00000000-0000-0000-0000-00000000a001'::uuid $u$;
`);

// helper kelas (verbatim dari 20261115)
for (const fn of [
  'create or replace function fn_normal_tingkat(p text)',
  'create or replace function fn_pecah_kelas(p_label text)',
  'create or replace function fn_label_kelas(p_tingkat text, p_jurusan_kode text, p_rombel integer)'
]) await db.exec(ekstrak(lama15, fn));

// tabel minimal + fungsi pendukung lain yang dipakai berkas migrasi
await db.exec(`
  create table master_data (
    "Tahun Pelajaran" text,
    "Tingkat/Kelas" text,
    "Jurusan" text,
    "Jurusan Lengkap" text
  );

  create table master_jurusan (
    id uuid primary key default gen_random_uuid(),
    kode text not null default '',
    nama text not null default ''
  );

  create table akun (
    id uuid primary key default gen_random_uuid(),
    user_id uuid,
    nis_nip text default '',
    nama_lengkap text default '',
    tipe text default 'murid',
    tingkat_kelas text default '',
    tingkat text, jurusan_kode text, jurusan text, rombel integer,
    kelas_label text generated always as (fn_label_kelas(tingkat, jurusan_kode, rombel)) stored,
    riwayat_kelas jsonb,
    penugasan jsonb,
    wali_kelas text default '',
    ekstrakurikuler text default '',
    jabatan_ekskul_map jsonb,
    riwayat_ekskul jsonb,
    jabatan text, jabatan_ekskul text, mapel text, kunci_absen text,
    captcha text, no_telepon text, gelar_depan text, gelar_belakang text,
    tahun_pelajaran text, semester text, email text, url_foto text,
    jenis_kelamin text, agama text, nisn text, catatan_khusus text,
    tgl_lahir text,
    wajah_descriptor jsonb, wajah_status text
  );

  create or replace function fn_role() returns text language sql stable
    as $f$ select 'guru'::text $f$;
  create or replace function fn_nis() returns text language sql stable
    as $f$ select 'GURU-A'::text $f$;
  create or replace function fn_akses_murid(p_token text, p_klaim text) returns text
    language sql stable as $f$ select ''::text $f$;
  create or replace function fn_akun_export(p_id uuid) returns jsonb
    language sql stable as $f$ select '{}'::jsonb $f$;

  insert into master_data ("Tahun Pelajaran", "Tingkat/Kelas", "Jurusan", "Jurusan Lengkap")
  values ('2026/2027', 'X LP 1', 'LP', 'Layanan Perbankan'),
         ('2026/2027', 'X LP 2', 'LP', 'Layanan Perbankan');
`);

// ── 2. jalankan migrasi Tahap 4A ────────────────────────────────────────────
bagian('2. Menjalankan upgrade_20261116_wali_kelas_multi.sql');
try {
  await db.exec(baru);
  console.log('  ✓ berkas migrasi selesai tanpa error (termasuk blok verifikasi)');
  lulus++;
} catch (e) {
  gagal++;
  console.log('  ✗ migrasi gagal: ' + e.message);
  console.log(String(e).slice(0, 4000));
  process.exit(1);
}

// ── 3. helper murni ─────────────────────────────────────────────────────────
bagian('3. Helper: fn_wali_list / fn_kelas_sama / fn_ta_berjalan');
cek("fn_wali_list string LAMA → ['X LP 1']",
  await satu(`select fn_wali_list('"X LP 1"'::jsonb) as v`), ['X LP 1']);
cek('fn_wali_list array (trim + buang kosong + unik)',
  await satu(`select fn_wali_list('["X LP 1","x lp 1",""," "]'::jsonb) as v`), ['X LP 1', 'x lp 1']);
cek('fn_wali_list null jsonb → {}',
  await satu(`select fn_wali_list('null'::jsonb) as v`), []);
cek('fn_wali_list object (bukan array/string) → {}',
  await satu(`select fn_wali_list('{"wali":"X LP 1"}'::jsonb) as v`), []);
cek('fn_wali_list NULL SQL → {}',
  await satu(`select fn_wali_list(null::jsonb) as v`), []);

cek("fn_kelas_sama('10 RPL 1','X RPL 1')",
  await satu(`select fn_kelas_sama('10 RPL 1','X RPL 1') as v`), true);
cek("fn_kelas_sama('x rpl 1','X RPL 1')",
  await satu(`select fn_kelas_sama('x rpl 1','X RPL 1') as v`), true);
cek("fn_kelas_sama('X LP 1','X LP 2')",
  await satu(`select fn_kelas_sama('X LP 1','X LP 2') as v`), false);
cek("fn_kelas_sama('X-LP-1','X LP 1') (tanda hubung)",
  await satu(`select fn_kelas_sama('X-LP-1','X LP 1') as v`), true);
cek("fn_kelas_sama('Semua Kelas','semua kelas') (non-kelas)",
  await satu(`select fn_kelas_sama('Semua Kelas','semua kelas') as v`), true);
cek("fn_kelas_sama('Semua Kelas','Hadir')",
  await satu(`select fn_kelas_sama('Semua Kelas','Hadir') as v`), false);
cek("fn_kelas_sama('','') → false",
  await satu(`select fn_kelas_sama('','') as v`), false);
cek('fn_ta_berjalan() = min Master Data',
  await satu(`select fn_ta_berjalan() as v`), '2026/2027');

// ── 4. trigger + backfill ───────────────────────────────────────────────────
bagian('4. Trigger & backfill: penugasan array / string LAMA / kolom wali_kelas');
await db.exec(`
  insert into akun (nis_nip, nama_lengkap, tipe, penugasan, wali_kelas)
  values
    ('GURU-A', 'Budi',  'guru', '{"2026/2027":{"wali":["10 LP 1","X LP 2"],"ekskul":["PMR"]}}'::jsonb, 'X LP 1, X LP 2'),
    ('GURU-B', 'Ani',   'guru', '{"2025/2026":{"wali":"XI RPL 3"}}'::jsonb, ''),
    ('GURU-C', 'Cici',  'guru', null, 'XII IPA 1'),
    ('GURU-D', 'Dedi',  'guru', '{"2026/2027":{"mapel":["Matematika"]}}'::jsonb, '');
`);
const barisWali = async (nis) => await db.query(
  `select tahun_pelajaran, kelas_label from wali_kelas_penugasan
    where nis_nip = $1 order by tahun_pelajaran, kelas_label`, [nis]);

cek('GURU-A (array 2 kelas) → 2 baris, label kanonik',
  (await barisWali('GURU-A')).rows,
  [{ tahun_pelajaran: '2026/2027', kelas_label: 'X LP 1' },
   { tahun_pelajaran: '2026/2027', kelas_label: 'X LP 2' }]);
cek('GURU-B (penugasan string LAMA) → 1 baris',
  (await barisWali('GURU-B')).rows,
  [{ tahun_pelajaran: '2025/2026', kelas_label: 'XI RPL 3' }]);
cek('GURU-C (hanya kolom wali_kelas) → 1 baris TA berjalan',
  (await barisWali('GURU-C')).rows,
  [{ tahun_pelajaran: '2026/2027', kelas_label: 'XII IPA 1' }]);
cek('GURU-D (tanpa wali) → 0 baris',
  (await barisWali('GURU-D')).rows, []);

cek("fn_wali_kelas_list('GURU-A') (semua TA)",
  await satu(`select fn_wali_kelas_list('GURU-A') as v`), ['X LP 1', 'X LP 2']);
cek("fn_wali_kelas_list('GURU-A','2026/2027')",
  await satu(`select fn_wali_kelas_list('GURU-A','2026/2027') as v`), ['X LP 1', 'X LP 2']);
cek("fn_wali_kelas_list('GURU-A','2025/2026') (TA lain → kosong)",
  await satu(`select fn_wali_kelas_list('GURU-A','2025/2026') as v`), []);
cek("fn_wali_kelas_map('GURU-A')",
  await satu(`select fn_wali_kelas_map('GURU-A') as v`),
  { '2026/2027': ['X LP 1', 'X LP 2'] });
cek("fn_wali_kelas_map('GURU-D') → {}",
  await satu(`select fn_wali_kelas_map('GURU-D') as v`), {});

cek("fn_guru_wali_ada('GURU-A')",
  await satu(`select fn_guru_wali_ada('GURU-A') as v`), true);
cek("fn_guru_wali_ada('GURU-A','2026/2027')",
  await satu(`select fn_guru_wali_ada('GURU-A','2026/2027') as v`), true);
cek("fn_guru_wali_ada('GURU-A','2025/2026') → false",
  await satu(`select fn_guru_wali_ada('GURU-A','2025/2026') as v`), false);
cek("fn_guru_wali_ada('GURU-C') (cadangan kolom lama)",
  await satu(`select fn_guru_wali_ada('GURU-C') as v`), true);
cek("fn_guru_wali_ada('GURU-D') → false",
  await satu(`select fn_guru_wali_ada('GURU-D') as v`), false);
cek("fn_guru_wali_ada('') → false",
  await satu(`select fn_guru_wali_ada('') as v`), false);

// ── 5. akun_guru_ampu_murid (wali multi + kelas efektif) ────────────────────
bagian('5. akun_guru_ampu_murid: wali multi-kelas, kelas efektif, pembina');
await db.exec(`
  insert into akun (nis_nip, nama_lengkap, tipe, tingkat_kelas, riwayat_kelas, ekstrakurikuler)
  values
    ('MRD-1', 'Murid 1', 'murid', 'X LP 1', null, ''),
    ('MRD-2', 'Murid 2', 'murid', 'X LP 2', null, ''),
    ('MRD-3', 'Murid 3', 'murid', 'XI LP 1', '{"2025/2026":{"kelas":"X LP 1"}}'::jsonb, ''),
    ('MRD-4', 'Murid 4', 'murid', 'XII LP 1', null, 'PMR, OSIS'),
    ('MRD-5', 'Murid 5', 'murid', 'XI RPL 3', null, ''),
    ('GURU-E', 'Eka',   'guru',  null,     null, 'PMR');
`);
cek('GURU-A ampu MRD-1 (kelas "X LP 1" ≡ penugasan "10 LP 1")',
  await satu(`select akun_guru_ampu_murid('GURU-A','MRD-1') as v`), true);
cek('GURU-A ampu MRD-2 (kelas wali ke-2 "X LP 2")',
  await satu(`select akun_guru_ampu_murid('GURU-A','MRD-2') as v`), true);
cek('GURU-A ampu MRD-3 (kelas efektif TA lalu via riwayat_kelas)',
  await satu(`select akun_guru_ampu_murid('GURU-A','MRD-3') as v`), true);
cek('GURU-A TIDAK ampu MRD-4 (bukan wali kelasnya)',
  await satu(`select akun_guru_ampu_murid('GURU-A','MRD-4') as v`), false);
cek('GURU-B ampu MRD-5 (wali "XI RPL 3")',
  await satu(`select akun_guru_ampu_murid('GURU-B','MRD-5') as v`), true);
cek('GURU-B TIDAK ampu MRD-1',
  await satu(`select akun_guru_ampu_murid('GURU-B','MRD-1') as v`), false);
cek('GURU-E ampu MRD-4 lewat pembina ekskul PMR (aturan lama)',
  await satu(`select akun_guru_ampu_murid('GURU-E','MRD-4') as v`), true);
cek('GURU-D (tanpa wali) TIDAK ampu siapa pun',
  await satu(`select akun_guru_ampu_murid('GURU-D','MRD-1') as v`), false);
cek('NIS kosong → false',
  await satu(`select akun_guru_ampu_murid('','MRD-1') as v`), false);

// ── 6. jalur tulis ulang (update/delete) & tipe akun ───────────────────────
bagian('6. Sinkron ulang saat data diubah');
await db.exec(`
  update akun
     set penugasan = '{"2026/2027":{"wali":["X LP 2"]}}'::jsonb,
         wali_kelas = ''
   where nis_nip = 'GURU-A';
`);
cek('GURU-A dikurangi jadi 1 kelas',
  (await barisWali('GURU-A')).rows,
  [{ tahun_pelajaran: '2026/2027', kelas_label: 'X LP 2' }]);
cek("fn_guru_wali_ada('GURU-A') tetap true",
  await satu(`select fn_guru_wali_ada('GURU-A') as v`), true);
cek("fn_guru_wali_ada('GURU-A','2025/2026') tetap false",
  await satu(`select fn_guru_wali_ada('GURU-A','2025/2026') as v`), false);

await db.exec(`
  update akun set nama_lengkap = 'Budi Santoso' where nis_nip = 'GURU-A';
`);
cek('update kolom lain tidak mengubah relasi',
  (await barisWali('GURU-A')).rows,
  [{ tahun_pelajaran: '2026/2027', kelas_label: 'X LP 2' }]);

await db.exec(`
  update akun set penugasan = '{"2026/2027":{},"2027/2028":{"wali":["XI LP 1","XI LP 2"]}}'::jsonb
   where nis_nip = 'GURU-A';
`);
cek('GURU-A pindah TA & 2 kelas baru',
  (await barisWali('GURU-A')).rows,
  [{ tahun_pelajaran: '2027/2028', kelas_label: 'XI LP 1' },
   { tahun_pelajaran: '2027/2028', kelas_label: 'XI LP 2' }]);
cek("fn_wali_kelas_map('GURU-A') pindah TA",
  await satu(`select fn_wali_kelas_map('GURU-A') as v`),
  { '2027/2028': ['XI LP 1', 'XI LP 2'] });

await db.exec(`
  update akun set tipe = 'murid' where nis_nip = 'GURU-C';
`);
cek('akun berubah jadi murid → relasi dibersihkan',
  (await barisWali('GURU-C')).rows, []);

// duplicate: label sama untuk TA sama tidak digandakan
await db.exec(`
  update akun
     set penugasan = '{"2026/2027":{"wali":["X LP 1","X LP 1","10 LP 1"]}}'::jsonb
   where nis_nip = 'GURU-D';
`);
cek('kelas duplikat (3 bentuk sama) → 1 baris',
  (await barisWali('GURU-D')).rows,
  [{ tahun_pelajaran: '2026/2027', kelas_label: 'X LP 1' }]);

// ── 7. fn_is_wali_kelas (by user_id / NIS sesi) ─────────────────────────────
bagian('7. fn_is_wali_kelas (akun pemanggil)');
await db.exec(`update akun set user_id = '00000000-0000-0000-0000-00000000a001' where nis_nip = 'GURU-A';`);
cek('fn_is_wali_kelas() → true (GURU-A wali, user_id = auth.uid())',
  await satu(`select fn_is_wali_kelas() as v`), true);
await db.exec(`
  update akun set user_id = null where nis_nip = 'GURU-A';
  update akun set user_id = '00000000-0000-0000-0000-00000000a001' where nis_nip = 'MRD-1';
`);
cek('fn_is_wali_kelas() → true lewat NIS sesi (fn_nis = GURU-A)',
  await satu(`select fn_is_wali_kelas() as v`), true);
await db.exec(`
  update akun set user_id = null where nis_nip = 'MRD-1';
  create or replace function fn_nis() returns text language sql stable as $f$ select 'ZZZ'::text $f$;
`);
cek('fn_is_wali_kelas() → false (bukan wali)',
  await satu(`select fn_is_wali_kelas() as v`), false);
await db.exec(`create or replace function fn_nis() returns text language sql stable as $f$ select 'GURU-A'::text $f$;`);

// ── 8. fn_akun_json: field baru wali_kelas_list/wali_kelas_map ──────────────
bagian('8. fn_akun_json (mode guru_wali & guru_dashboard)');
const idA = await satu(`select id::text as v from akun where nis_nip = 'GURU-A'`);
cek("mode guru_wali → 'wali_kelas_list'",
  await satu(`select fn_akun_json('${idA}'::uuid, 'guru_wali') -> 'wali_kelas_list' as v`),
  ['XI LP 1', 'XI LP 2']);
cek("mode guru_wali → 'wali_kelas_map'",
  await satu(`select fn_akun_json('${idA}'::uuid, 'guru_wali') -> 'wali_kelas_map' as v`),
  { '2027/2028': ['XI LP 1', 'XI LP 2'] });
cek("mode guru_wali → 'wali_kelas' (mirror lama tetap ada)",
  await satu(`select fn_akun_json('${idA}'::uuid, 'guru_wali') -> 'wali_kelas' as v`), '');
cek("mode guru_dashboard → 'wali_kelas_list' & 'wali_kelas_map'",
  await satu(`select (fn_akun_json('${idA}'::uuid, 'guru_dashboard') -> 'wali_kelas_list')
                   || (fn_akun_json('${idA}'::uuid, 'guru_dashboard') -> 'wali_kelas_map') as v`),
  ['XI LP 1', 'XI LP 2', { '2027/2028': ['XI LP 1', 'XI LP 2'] }]);
cek("mode lain (guru_ringkas) tidak berubah",
  await satu(`select fn_akun_json('${idA}'::uuid, 'guru_ringkas') ? 'wali_kelas_list' as v`), false);

// ── 9. gerbang akses ubah_anggota_ekskul ────────────────────────────────────
bagian('9. ubah_anggota_ekskul: gerbang wali kelas multi');
const ubah = async (ekskul, nis) => await satu(
  `select ubah_anggota_ekskul('x', '${ekskul}', array['${nis}'], true, '2026/2027', null, '') as v`);
cek('GURU-A (wali kelas) boleh ubah anggota OSIS',
  (await ubah('OSIS', 'MRD-1')).status, 'success');
await db.exec(`
  insert into akun (nis_nip, nama_lengkap, tipe, ekstrakurikuler) values ('GURU-F', 'Fajar', 'guru', '');
  create or replace function fn_nis() returns text language sql stable as $f$ select 'GURU-F'::text $f$;
`);
cek('GURU-F (bukan wali/pembina) DITOLAK',
  (await ubah('OSIS', 'MRD-2')).message,
  'Hanya wali kelas atau pembina OSIS yang dapat mengubah anggota.');
await db.exec(`
  update akun set ekstrakurikuler = 'OSIS' where nis_nip = 'GURU-F';
`);
cek('GURU-F setelah jadi pembina OSIS → boleh',
  (await ubah('OSIS', 'MRD-2')).status, 'success');

// ── 10. berkas uji SQL untuk pengguna (uji_wali_kelas_multi.sql) ────────────
bagian('10. supabase/sql/uji_wali_kelas_multi.sql (jalan + rollback tanpa jejak)');
const ujiSql = baca(join(ROOT, 'supabase', 'sql', 'uji_wali_kelas_multi.sql'));
try {
  await db.exec(ujiSql);
  console.log('  ✓ berkas uji SQL selesai tanpa error (semua pemeriksaan lulus)');
  lulus++;
} catch (e) {
  gagal++;
  console.log('  ✗ berkas uji SQL gagal: ' + e.message);
}
cek('uji SQL: relasi UJIWM-* tidak tertinggal (ROLLBACK)',
  await satu(`select count(*)::text as v from wali_kelas_penugasan where btrim(nis_nip) like 'UJIWM-%'`), '0');
cek('uji SQL: akun UJIWM-* tidak tertinggal (ROLLBACK)',
  await satu(`select count(*)::text as v from akun where nis_nip like 'UJIWM-%'`), '0');
cek('uji SQL: fungsi alat uji ikut ter-rollback',
  await satu(`select count(*)::text as v from pg_proc where proname = 'uji_wm_cek'`), '0');

// ── ringkasan ───────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(58));
console.log(gagal === 0 ? `✅ SEMUA LULUS — ${lulus} pemeriksaan`
                        : `❌ GAGAL — ${gagal} gagal dari ${lulus + gagal} pemeriksaan`);
process.exit(gagal === 0 ? 0 : 1);
