#!/usr/bin/env node
/**
 * scripts/uji-kelas.mjs
 *
 * UJI REGRESI modul normalisasi kelas frontend (Tahap 3):
 *   web/js/kelas.js  — cermin JS dari helper SQL Tahap 2
 *   web/js/app.js    — delegasi helper lama ke modul tersebut
 *   web/index.html, web/sw.js, web/js/install.js — registrasi & stempel versi
 *
 * Tidak butuh browser/DB: `kelas.js` adalah modul murni tanpa DOM, dimuat
 * lewat `new Function` di sandbox (nilai global `globalThis` di-shadow).
 * Selain itu `app.js` hanya di-PARSE (new Function) untuk menangkap
 * SyntaxError tanpa menjalankannya — app.js butuh DOM saat runtime.
 *
 * Jalankan: `npm run test:kelas` (atau `deno run -A scripts/uji-kelas.mjs`).
 * Skrip keluar dengan kode 1 bila ada pemeriksaan yang gagal.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const P_KELAS = join(ROOT, 'web', 'js', 'kelas.js');
const P_APP = join(ROOT, 'web', 'js', 'app.js');
// `web/js/utils.js` di-gitignore (berisi kredensial) — template yang terlacak git
// adalah `utils.example.js` (dipakai CI untuk menghasilkan utils.js), jadi uji
// sumber daya ini membaca template agar tetap jalan tanpa kredensial.
const P_UTILS = join(ROOT, 'web', 'js', 'utils.example.js');
const P_HTML = join(ROOT, 'web', 'index.html');
const P_SW = join(ROOT, 'web', 'sw.js');
const P_INSTALL = join(ROOT, 'web', 'js', 'install.js');

const baca = (p) => readFileSync(p, 'utf8');

let lulus = 0, gagal = 0;
function cek(nama, dapat, harap) {
  const ok = JSON.stringify(dapat) === JSON.stringify(harap);
  if (ok) { lulus++; }
  else {
    gagal++;
    console.log(`  ✗ ${nama}`);
    console.log(`      dapat : ${JSON.stringify(dapat)}`);
    console.log(`      harap : ${JSON.stringify(harap)}`);
  }
}
function cekBenar(nama, kondisi, info = '') {
  cek(nama, !!kondisi, true);
  if (!kondisi && info) console.log(`      info  : ${info}`);
}
function bagian(judul) {
  console.log(`\n── ${judul}`);
}

/* ── muat modul murni kelas.js di sandbox ─────────────────────────────── */
function muatKelas() {
  const src = baca(P_KELAS);
  const sandbox = {};
  // Parameter bernama `globalThis` men-*shadow* global Deno → IIFE menulis ke sandbox.
  new Function('globalThis', src)(sandbox);
  if (!sandbox.KELAS) throw new Error('web/js/kelas.js tidak mengekspos window.KELAS');
  return sandbox.KELAS;
}

let K;
try {
  K = muatKelas();
} catch (e) {
  console.error(`FATAL: gagal memuat web/js/kelas.js → ${e.message}`);
  process.exit(1);
}

console.log('UJI NORMALISASI KELAS (web/js/kelas.js)');

/* ── 1. normalTingkat (≙ fn_normal_tingkat) ───────────────────────────── */
bagian('1. normalTingkat — 10/11/12 → X/XI/XII, sisanya UPPER');
[
  ['10', 'X'], ['11', 'XI'], ['12', 'XII'],
  ['x', 'X'], [' xi ', 'XI'], ['XII', 'XII'], ['XIII', 'XIII'],
  ['', ''], [null, ''], [undefined, ''], ['X LP 1', 'X LP 1']
].forEach(([masuk, harap]) => cek(`normalTingkat(${JSON.stringify(masuk)})`, K.normalTingkat(masuk), harap));

/* ── 2. pecah (≙ fn_pecah_kelas) ──────────────────────────────────────── */
bagian('2. pecah — label kelas → {tingkat, jurusan_kode, rombel}');
const KOSONG = { tingkat: '', jurusan_kode: '', rombel: null };
[
  // label kanonik & gaya lama
  ['X LP 1', { tingkat: 'X', jurusan_kode: 'LP', rombel: 1 }],
  ['10 RPL 1', { tingkat: 'X', jurusan_kode: 'RPL', rombel: 1 }],
  ['11 TKJ 10', { tingkat: 'XI', jurusan_kode: 'TKJ', rombel: 10 }],
  ['12 IPA 2', { tingkat: 'XII', jurusan_kode: 'IPA', rombel: 2 }],
  // toleransi bentuk
  ['x rpl 1', { tingkat: 'X', jurusan_kode: 'RPL', rombel: 1 }],
  ['X-RPL-1', { tingkat: 'X', jurusan_kode: 'RPL', rombel: 1 }],
  ['X_RPL_1', { tingkat: 'X', jurusan_kode: 'RPL', rombel: 1 }],
  ['  X   RPL   1  ', { tingkat: 'X', jurusan_kode: 'RPL', rombel: 1 }],
  ['XII IPA 2', { tingkat: 'XII', jurusan_kode: 'IPA', rombel: 2 }],
  // tanpa rombel / tanpa jurusan
  ['X LP', { tingkat: 'X', jurusan_kode: 'LP', rombel: null }],
  ['X', { tingkat: 'X', jurusan_kode: '', rombel: null }],
  ['X 3', { tingkat: 'X', jurusan_kode: '', rombel: 3 }],
  // BUKAN kelas → semua kosong
  ['', KOSONG], ['   ', KOSONG], [null, KOSONG], [undefined, KOSONG],
  ['Semua Kelas', KOSONG], ['semua', KOSONG], ['SEMUA KELAS', KOSONG],
  ['Hadir', KOSONG], ['Islam', KOSONG], ['Aktif', KOSONG], ['Lulus', KOSONG],
  ['Kelas X RPL 1', KOSONG], ['TEKNIK 1', KOSONG], ['LP 1', KOSONG]
].forEach(([masuk, harap]) => cek(`pecah(${JSON.stringify(masuk)})`, K.pecah(masuk), harap));

/* ── 3. label (≙ fn_label_kelas) + round-trip ──────────────────────────── */
bagian('3. label — rakit kanonik & round-trip label(pecah(x)) === x');
cek('label(X,LP,1)', K.label('X', 'LP', 1), 'X LP 1');
cek('label(X, rpl, 1) → UPPER', K.label('X', ' rpl ', 1), 'X RPL 1');
cek('label(X,\'\',null)', K.label('X', '', null), 'X');
cek('label(X,\'\',3)', K.label('X', '', 3), 'X 3');
cek('label(\'\',RPL,1)', K.label('', 'RPL', 1), 'RPL 1');
cek('label(\'\',\'\',null)', K.label('', '', null), '');
cek('label(null,undefined,\'\')', K.label(null, undefined, ''), '');
['X LP 1', 'X RPL 1', 'XI TKJ 10', 'XII IPA 2', 'X', 'X 3'].forEach((lbl) => {
  const p = K.pecah(lbl);
  cek(`round-trip ${JSON.stringify(lbl)}`, K.label(p.tingkat, p.jurusan_kode, p.rombel), lbl);
});

/* ── 4. kunci & sama — kesetaraan kelas lintas gaya label ─────────────── */
bagian('4. kunci/sama — "10 RPL 1" ≡ "X RPL 1" ≡ "x rpl 1"');
cek('kunci("10 RPL 1")', K.kunci('10 RPL 1'), 'X RPL 1');
cek('kunci("x rpl 1")', K.kunci('x rpl 1'), 'X RPL 1');
cek('kunci("Semua Kelas")', K.kunci('Semua Kelas'), 'SEMUA KELAS');
cek('kunci("")', K.kunci(''), '');
cekBenar('sama("10 RPL 1","X RPL 1")', K.sama('10 RPL 1', 'X RPL 1'));
cekBenar('sama("x rpl 1","X RPL 1")', K.sama('x rpl 1', 'X RPL 1'));
cekBenar('sama("X-RPL-1","X RPL 1")', K.sama('X-RPL-1', 'X RPL 1'));
cekBenar('TIDAK sama rombel beda', !K.sama('X RPL 1', 'X RPL 2'));
cekBenar('TIDAK sama tingkat beda', !K.sama('10 RPL 1', '11 RPL 1'));
cekBenar('TIDAK sama kelas vs "Semua Kelas"', !K.sama('X RPL 1', 'Semua Kelas'));
cekBenar('TIDAK sama label kosong', !K.sama('', ''));
cekBenar('sama antar baris DB', K.sama({ tingkat: 'X', jurusan_kode: 'RPL', rombel: 1 }, '10 RPL 1'));

/* ── 5. komponen(row) — kolom terstruktur mengalahkan uraian label ────── */
bagian('5. komponen — prioritas kolom terstruktur, fallback label lama');
cek('struktur mengalahkan label',
  K.komponen({ tingkat: 'X', jurusan_kode: 'rpl', rombel: 3, 'Tingkat/Kelas': '10 RPL 1' }),
  { tingkat: 'X', jurusan_kode: 'RPL', rombel: 3 });
cek('hanya kolom struktur',
  K.komponen({ tingkat: 'xi', jurusan_kode: 'lp', rombel: 2 }),
  { tingkat: 'XI', jurusan_kode: 'LP', rombel: 2 });
cek('rombel struktur menang atas label',
  K.komponen({ rombel: 4, 'Tingkat/Kelas': 'X RPL 1' }),
  { tingkat: 'X', jurusan_kode: 'RPL', rombel: 4 });
cek('label gaya lama master_data',
  K.komponen({ 'Tingkat/Kelas': '10 RPL 1' }),
  { tingkat: 'X', jurusan_kode: 'RPL', rombel: 1 });
cek('kelas_label akun', K.komponen({ kelas_label: 'X LP 1' }), { tingkat: 'X', jurusan_kode: 'LP', rombel: 1 });
cek('tingkat_kelas akun', K.komponen({ tingkat_kelas: '11 TKJ 10' }), { tingkat: 'XI', jurusan_kode: 'TKJ', rombel: 10 });
cek('kolom kelas', K.komponen({ kelas: 'XII IPA 2' }), { tingkat: 'XII', jurusan_kode: 'IPA', rombel: 2 });
cek('string langsung', K.komponen('10 RPL 1'), { tingkat: 'X', jurusan_kode: 'RPL', rombel: 1 });
cek('baris kosong', K.komponen({}), KOSONG);
cek('null', K.komponen(null), KOSONG);
cek('label non-kelas', K.komponen({ 'Tingkat/Kelas': 'Semua Kelas' }), KOSONG);

/* ── 6. komponenTahun — riwayat_kelas[TA] lebih dulu dari kolom statis ─ */
bagian('6. komponenTahun — riwayat_kelas[TA] (hasil fn_enrich_riwayat_kelas)');
const murid = {
  tingkat_kelas: '10 RPL 1',
  riwayat_kelas: {
    '2025/2026': { kelas: 'X RPL 1', tingkat: 'X', jurusan_kode: 'RPL', rombel: 1, status: 'Aktif' },
    '2026/2027': { kelas: '11 RPL 1', status: 'Aktif' }
  }
};
cek('TA berstruktur', K.komponenTahun(murid, '2025/2026'), { tingkat: 'X', jurusan_kode: 'RPL', rombel: 1 });
cek('TA hanya label (urai)', K.komponenTahun(murid, '2026/2027'), { tingkat: 'XI', jurusan_kode: 'RPL', rombel: 1 });
cek('TA tanpa entri → kolom statis', K.komponenTahun(murid, '2024/2025'), { tingkat: 'X', jurusan_kode: 'RPL', rombel: 1 });
cek('tanpa tahun → kolom statis', K.komponenTahun(murid), { tingkat: 'X', jurusan_kode: 'RPL', rombel: 1 });
cek('entri kosong → kolom statis',
  K.komponenTahun({ tingkat_kelas: 'XII IPA 2', riwayat_kelas: { '2026/2027': { kelas: '', status: 'Lulus' } } }, '2026/2027'),
  { tingkat: 'XII', jurusan_kode: 'IPA', rombel: 2 });

/* ── 7. labelDariBaris ────────────────────────────────────────────────── */
bagian('7. labelDariBaris — label tersimpan diutamakan (filter lama tetap valid)');
cek('label tersimpan apa adanya', K.labelDariBaris({ tingkat_kelas: '10 RPL 1', tingkat: 'X', jurusan_kode: 'RPL', rombel: 1 }), '10 RPL 1');
cek('rakit bila label kosong', K.labelDariBaris({ tingkat: 'X', jurusan_kode: 'rpl', rombel: 1 }), 'X RPL 1');
cek('tanpa label & struktur', K.labelDariBaris({}), '');
cek('jadwal_pelajaran', K.labelDariBaris({ 'Tingkat/Kelas': 'X LP 1' }), 'X LP 1');
// Baris DB nyata hasil Tahap 2: label lama + kelas_label generated + kolom terstruktur.
const barisDb = { 'Tingkat/Kelas': '10 RPL 1', tingkat: 'X', jurusan_kode: 'RPL', rombel: 1, kelas_label: 'X RPL 1' };
cek('labelDariBaris baris DB → label lama menang', K.labelDariBaris(barisDb), '10 RPL 1');
cek('komponen baris DB lengkap', K.komponen(barisDb), { tingkat: 'X', jurusan_kode: 'RPL', rombel: 1 });
cek('akun: kolom statis menang atas kelas_label', K.labelDariBaris({ tingkat_kelas: '11 TKJ 10', tingkat: 'XI', jurusan_kode: 'TKJ', rombel: 10, kelas_label: 'XI TKJ 10' }), '11 TKJ 10');
cek('kelas_label dipakai bila tak ada label teks', K.labelDariBaris({ tingkat: 'XII', jurusan_kode: 'IPA', rombel: 2, kelas_label: 'XII IPA 2' }), 'XII IPA 2');

/* ── 8. naik/turun & angkatan ─────────────────────────────────────────── */
bagian('8. naik/turun tingkat & angkatan');
cek('naik(X)', K.naik('X'), 'XI');
cek('naik(XI)', K.naik('XI'), 'XII');
cek('naik(XII)', K.naik('XII'), 'LULUS');
cek('naik(10)', K.naik('10'), 'XI');
cek('naik(tak dikenal)', K.naik('ABC'), '');
cek('turun(XII)', K.turun('XII'), 'XI');
cek('turun(XI)', K.turun('XI'), 'X');
cek('turun(X) → tidak ada', K.turun('X'), '');
cek('turun(12)', K.turun('12'), 'XI');
cek('angkatan("X RPL 1")', K.angkatan('X RPL 1'), 'X');
cek('angkatan("10 RPL 1")', K.angkatan('10 RPL 1'), 'X');
cek('angkatan("XI")', K.angkatan('XI'), 'XI');
cek('angkatan("Semua Kelas")', K.angkatan('Semua Kelas'), '');
cek('angkatan(baris XII)', K.angkatan({ tingkat: 'XII', jurusan_kode: 'IPA', rombel: 4 }), 'XII');
cek('gayaTingkat("10 RPL 1")', K.gayaTingkat('10 RPL 1'), 'angka');
cek('gayaTingkat("X RPL 1")', K.gayaTingkat('X RPL 1'), 'romawi');
cek('tingkatGaya(X,angka)', K.tingkatGaya('X', 'angka'), '10');
cek('tingkatGaya(XII,angka)', K.tingkatGaya('XII', 'angka'), '12');
cek('tingkatGaya(XI,romawi)', K.tingkatGaya('XI', 'romawi'), 'XI');

/* ── 9. DAFTAR KELAS WALI (Tahap 4A) ─────────────────────────────────── */
bagian('9. daftar kelas wali — normKelasList / adaKelas / gabungKelas / teksKelasList');
cek('normKelasList(array)', K.normKelasList(['X LP 1', 'X LP 2']), ['X LP 1', 'X LP 2']);
cek('normKelasList(satu string LAMA)', K.normKelasList('X LP 1'), ['X LP 1']);
cek('normKelasList(string LAMA 2 kelas)', K.normKelasList('X LP 1, X LP 2'), ['X LP 1', 'X LP 2']);
cek('normKelasList(trim & buang kosong)', K.normKelasList('  , X LP 1 ,, '), ['X LP 1']);
cek('normKelasList(buang duplikat kanonik)', K.normKelasList(['X LP 1', '10 LP 1', 'x lp 1']), ['X LP 1']);
cek('normKelasList(null)', K.normKelasList(null), []);
cek('normKelasList(undefined)', K.normKelasList(undefined), []);
cek('normKelasList("")', K.normKelasList(''), []);
cek('normKelasList(baris DB)', K.normKelasList({ tingkat: 'X', jurusan_kode: 'LP', rombel: 1 }), ['X LP 1']);
cek('normKelasList(gaya lama → tetap kanonik)', K.normKelasList(['XI rpl 3']), ['XI rpl 3']);
cek('adaKelas(kanonik)', K.adaKelas(['X LP 1'], '10 LP 1'), true);
cek('adaKelas(kelas ke-2)', K.adaKelas(['X LP 1', 'X LP 2'], 'x lp 2'), true);
cek('adaKelas(tidak ada)', K.adaKelas(['X LP 1'], 'X LP 3'), false);
cek('adaKelas(daftar kosong)', K.adaKelas([], 'X LP 1'), false);
cek('adaKelas(target kosong)', K.adaKelas(['X LP 1'], ''), false);
cek('adaKelas(label non-kelas)', K.adaKelas(['Semua Kelas'], 'semua kelas'), true);
cek('gabungKelas(array + string)', K.gabungKelas(['X LP 1'], 'X LP 2'), ['X LP 1', 'X LP 2']);
cek('gabungKelas(buang duplikat kanonik)', K.gabungKelas(['X LP 1'], '10 LP 1'), ['X LP 1']);
cek('gabungKelas(3 sumber + dedup)', K.gabungKelas(['X LP 1'], null, 'X LP 2, X LP 1'), ['X LP 1', 'X LP 2']);
cek('teksKelasList(array)', K.teksKelasList(['X LP 1', 'X LP 2']), 'X LP 1, X LP 2');
cek('teksKelasList(string LAMA)', K.teksKelasList('X LP 1'), 'X LP 1');
cek('teksKelasList(null)', K.teksKelasList(null), '');
cekBenar('KELAS.versi sudah dinaikkan (>= 2)', Number(String(K.versi)) >= 2, `versi=${K.versi}`);

/* ── 10. integrasi: delegasi app.js, fallback darurat, registrasi aset ── */
bagian('10. integrasi app.js + registrasi aset (index.html/sw.js/install.js)');

let appSrc = '';
try {
  appSrc = baca(P_APP);
} catch (e) {
  console.error(`FATAL: web/js/app.js tidak dapat dibaca → ${e.message}`);
  process.exit(1);
}

// app.js harus tetap sintaksis valid (dicek tanpa menjalankan).
try {
  new Function(appSrc);
  cekBenar('app.js dapat di-parse (tanpa SyntaxError)', true);
} catch (e) {
  cekBenar('app.js dapat di-parse (tanpa SyntaxError)', false, e.message);
}

/* ── 11. perbaikan UI 2026-11-16 (app.js): lima temuan lapangan ── */
bagian('11. perbaikan UI 2026-11-16 (ekskul / cari nama / dashboard murid / laporan nilai)');

[
  // (1) Popup "Pilih sub-ekskul" tidak boleh lagi meninggalkan alur: konteks modal
  //     Tambah Anggota di-snapshot lalu modal itu dibuka kembali (lanjutkan: ctx).
  ['ekskul: modal Tambah Anggota menerima konteks lanjutkan', /async function formTambahAnggotaEkskul\(o = \{\}\) \{[\s\S]{0,900}?const lanjut = \(o && o\.lanjutkan\) \|\| null;/],
  ['ekskul: snapshot filter modal Tambah Anggota', /function bacaFilterTambahAnggota\(\) \{[\s\S]{0,400}?cari: nilai\('ta_cari'\)/],
  ['ekskul: filter dipulihkan saat modal dibuka ulang', /didOpen: \(\) => \{[\s\S]{0,300}?pulihkanFilterTambahAnggota\(lanjut && lanjut\.filter\)/],
  ['ekskul: popup Sub kembali ke modal Tambah Anggota', /async function formPilihSubTambahAnggota\(nis, namaLengkap\) \{[\s\S]{0,1700}?return formTambahAnggotaEkskul\(\{ lanjutkan: ctx \}\)/],
  ['ekskul: peta Sub di memori tidak ditimpa saat dibuka ulang', /JANGAN menimpa peta Sub di memori[\s\S]{0,700}?window\.__taSub = window\.__taSub \|\| \{\}/],
  ['ekskul: formPilihSubAnggota (kartu profil) tetap utuh: simpan + render tab', /async function formPilihSubAnggota\(nis, namaLengkap\) \{[\s\S]{0,1500}?renderTabProfilEkskul\(\)/],
  ['ekskul: anggota aktif di-snapshot utk cek anti-duplikat', /window\.__taAnggotaSaatIni = anggotaSaatIni;/],

  // (2) "Cari Nama" pada modal Edit Absen Masal: sorot + prev/next + gulir.
  ['cari nama: input pencarian ada di modal absen masal', /id="cari-nama-masal"[\s\S]{0,200}?oninput="cariNamaMasal\(\)"/],
  ['cari nama: tombol sebelumnya/berikutnya + bersihkan', /onclick="cariNamaMasalLompat\(-1\)"[\s\S]{0,900}?id="cari-nama-bersih" onclick="bersihkanCariNamaMasal\(\)"/],
  ['cari nama: teks asli disimpan agar sorotan tidak menumpuk', /span\.dataset\.namaAsli === undefined\) span\.dataset\.namaAsli = span\.textContent/],
  ['cari nama: hasil digulirkan (scrollIntoView)', /function cariNamaMasalLompat\(arah, mulai\) \{[\s\S]{0,1000}?scrollIntoView\(\{ block: 'center', behavior: 'smooth' \}\)/],
  ['cari nama: pencarian dicocokkan ke NIS baris juga', /nisBarisMasal\(row\)\.toLowerCase\(\)\.includes\(kunci\)/],
  ['cari nama: urutkan ulang me-render ulang hasil pencarian', /const inpCari = document\.getElementById\('cari-nama-masal'\);\s*\n\s*if \(inpCari && inpCari\.value\.trim\(\)\) cariNamaMasal\(\);/],

  // (4) Dashboard murid: "Absensi Hari Ini" tidak boleh kosong karena filter TA/semester.
  ['dashboard murid: query absensi tanpa filter TA/semester', /supaAmbilSemua\(\s*\n?\s*supaClient\.from\('absensi'\)[\s\S]{0,300}?\.eq\('nis', nis\)/],
  ['dashboard murid: statistik disaring TA/semester di klien', /const rowsSmtIni = rowsSaya\.filter\(r =>/],
  ['dashboard murid: status Dispen (D) ikut dihitung', /const tot = \{ H: 0, S: 0, I: 0, A: 0, D: 0 \};/],
  ['dashboard murid: baris statistik D dirender', /barStat\('D', tot\.D, 'text-purple-400', 'bg-purple-500'\)/],
  ['dashboard murid: chip hari ini memakai tanggal WIB + lokal', /const tanggalCekHariIni = new Set\(\[isoHariIni, hariIniWibIso\(now\)\]\);/],
  ['dashboard murid: helper hariIniWibIso memakai zona Asia/Jakarta', /function hariIniWibIso\(d = new Date\(\)\) \{[\s\S]{0,200}?timeZone: 'Asia\/Jakarta'/],

  // (5) Laporan Nilai murid: metadata tidak lagi tampil sebagai komponen nilai.
  ['laporan nilai: kolom metadata dikecualikan', /KOLOM_META_NILAI\.includes\(k\)/],
  ['laporan nilai: daftar metadata lengkap (ID Akun Guru…Ekstrakurikuler)', /'ID Akun Guru', 'No', 'NISN', 'L\/P', 'Wali Kelas', 'Mata Pelajaran', 'Ekstrakurikuler'/],
  ['laporan nilai: komponen memakai kolomKomponen()', /const kolom = kolomKomponen\(d\);/],
  ['laporan nilai: kartu identitas NISN/Kelas/Wali Kelas', /kartuIdentitas\('NISN', nisnSaya, 'fa-id-card'\)[\s\S]{0,220}?kartuIdentitas\('Wali Kelas', waliKelasSaya, 'fa-user-tie'\)/],
  ['laporan nilai: NISN/Wali Kelas diambil dari RPC bila kosong', /akunSatu\(\{ nis, mode: 'profil_akun' \}\)[\s\S]{0,300}?nisnSaya = nisnSaya \|\| String\(baris\.nisn \|\| ''\)/],
  ['laporan nilai: pembimbing ekskul dari pembinaEkskulList', /const pembimbingEkskulTeks = \(namaEkskul\) => \{[\s\S]{0,600}?pembinaEkskulList\(rowE, guruPembina\)/]
].forEach(([nama, pola]) => cekBenar(`app.js: ${nama}`, pola.test(appSrc)));

// Penjaga duplikat deklarasi: fungsi kedua dengan nama sama MENIMPA yang pertama
// (hoisting) sehingga perbaikan bisa hilang diam-diam — pernah terjadi saat
// menyentuh area popup Sub-Ekskul.
['formPilihSubAnggota', 'formPilihSubTambahAnggota', 'formTambahAnggotaEkskul',
 'bacaFilterTambahAnggota', 'pulihkanFilterTambahAnggota',
 'cariNamaMasal', 'cariNamaMasalLompat', 'bersihkanCariNamaMasal',
 'gulirKeWadahKameraMandiri', 'hariIniWibIso']
  .forEach((fn) => cekBenar(`app.js: ${fn} terdefinisi tepat satu kali`,
    (appSrc.match(new RegExp('function ' + fn + '\\s*\\(', 'g')) || []).length === 1));

// Helper lama di app.js mendelegasikan ke modul (satu sumber kebenaran).
[
  ['kelasModul', /function kelasModul\s*\(/],
  ['rombelKelas → KELAS', /function rombelKelas\s*\([^)]*\)\s*\{[\s\S]{0,400}?kelasModul\(\)/],
  ['singkatanJurusanDariKelas → struktur', /function singkatanJurusanDariKelas\s*\([^)]*\)\s*\{[\s\S]{0,900}?kelasModul\(\)/],
  ['namaRombel → KELAS', /function namaRombel\s*\([^)]*\)\s*\{[\s\S]{0,900}?kelasModul\(\)/],
  ['jurusanDariKelas → struktur', /function jurusanDariKelas\s*\([^)]*\)\s*\{[\s\S]{0,900}?kelasModul\(\)/],
  ['angkatanDariTingkatKelas → KELAS', /function angkatanDariTingkatKelas\s*\([^)]*\)\s*\{[\s\S]{0,400}?kelasModul\(\)/],
  ['angkatanDariDaftarMurid → KELAS', /function angkatanDariDaftarMurid\s*\([^)]*\)\s*\{[\s\S]{0,400}?kelasModul\(\)/],
  ['naikkanKelas → KELAS', /function naikkanKelas\s*\([^)]*\)\s*\{[\s\S]{0,900}?kelasModul\(\)/],
  ['turunkanKelas → KELAS', /function turunkanKelas\s*\([^)]*\)\s*\{[\s\S]{0,900}?kelasModul\(\)/],
  ['petaJurusanMaster → master_jurusan', /function petaJurusanMaster\s*\([^)]*\)\s*\{[\s\S]{0,1500}?masterJurusanCache/],
  ['loader ambilMasterJurusan', /async function ambilMasterJurusan\s*\(/],
  ['sync master_jurusan saat tambah jurusan', /async function simpanJurusanMaster\s*\(/]
].forEach(([nama, pola]) => cekBenar(`app.js: ${nama}`, pola.test(appSrc)));

// [TAHAP 4A] Wali kelas multi-kelas: sumber data, form, tampilan, dan simpan.
let utilsSrc = '';
try { utilsSrc = baca(P_UTILS); } catch (e) { cekBenar('utils.example.js dapat dibaca', false, e.message); }
[
  ['penugasanGuruAktif: wali = daftar (normKelasList)', /function penugasanGuruAktif[\s\S]{0,900}?wali: entri \? kelasModul\(\)\.normKelasList\(entri\.wali\)/],
  ['penugasanTahunAda: hitung daftar wali', /function penugasanTahunAda[\s\S]{0,400}?normKelasList\(e\.wali\)\.length > 0/],
  ['bersihkanPenugasan: wali = daftar', /function bersihkanPenugasan[\s\S]{0,900}?wali: kelasModul\(\)\.normKelasList\(e\.wali\)/],
  ['seedPenugasanDariKolomLama: gabungKelas', /function seedPenugasanDariKolomLama[\s\S]{0,900}?kelasModul\(\)\.gabungKelas\(data\.wali_kelas/],
  ['waliKelasTahun → daftar kelas', /function waliKelasTahun[\s\S]{0,400}?return penugasanGuruAktif\(guruRow, tahun\)\.wali/],
  ['waliKelasTahunTeks → teksKelasList', /function waliKelasTahunTeks[\s\S]{0,400}?teksKelasList\(waliKelasTahun\(/],
  ['waliKelasTahunAda → adaKelas', /function waliKelasTahunAda[\s\S]{0,400}?adaKelas\(waliKelasTahun\(/],
  ['waliKelasBarisAda: kolom baru + kolom lama', /function waliKelasBarisAda[\s\S]{0,900}?wali_kelas_list[\s\S]{0,400}?wali_kelas/],
  ['waliKelasBarisList: gabung semua sumber', /function waliKelasBarisList[\s\S]{0,700}?gabungKelas\(/],
  ['waliKelasAktif → daftar kelas', /function waliKelasAktif\(\)[\s\S]{0,400}?gabungKelas\(u\.wali_kelas_list/],
  ['bisaImportMuridAktif: panjang daftar wali', /function bisaImportMuridAktif\(\)[\s\S]{0,500}?waliKelasAktif\(\)\.length > 0/],
  ['petaWaliKelas: setiap kelas guru dipetakan', /cacheGuruWali[\s\S]{0,900}?gabungKelas\(g\.wali_kelas_list, g\.wali_kelas\)\.forEach/],
  ['getNamaWaliKelas: cari via waliKelasBarisAda', /function getNamaWaliKelas[\s\S]{0,700}?waliKelasBarisAda\(g, kelas\)/],
  ['Daftar Wali Kelas: satu baris per kelas', /waliKelasBarisList\(d, tahun\)\.forEach\(kelas => daftarWali\.push/],
  ['form penugasan: wali pakai checkbox multi', /chk-pt-wali/],
  ['form penugasan: select lama id="pt_wali" sudah dibuang', !/id=["']pt_wali["']/.test(appSrc)],
  ['kumpulkanFormPenugasan: wali dari checkbox', /const wali = \[\.\.\.document\.querySelectorAll\('\.chk-pt-wali:checked'\)\]\.map/],
  ['simpan guru: kolom lama wali_kelas digabung koma', /wali_kelas: kelasModul\(\)\.teksKelasList\(ptAktif\.wali\)/],
  ['auto-seed simpan: wali_kelas digabung koma', /res\.value\.wali_kelas = kelasModul\(\)\.teksKelasList\(seed\.wali\)/],
  ['konflik wali: periksa TIAP kelas', /konflikWali[\s\S]{0,900}?normKelasList\(e && e\.wali\)/],
  ['tampilan profil: wali = teks daftar', /teksKelasList\(prof\.wali_kelas_list \|\| prof\.wali_kelas\)/],
  ['ringkasanPenugasan: wali = teks daftar', /function ringkasanPenugasan[\s\S]{0,700}?teksKelasList\(e\.wali\)/],
  ['utils.example.js: baris profil memuat Wali Kelas List', /"Wali Kelas List": \(prof && Array\.isArray\(prof\.wali_kelas_list\)\)/, 'utils'],
  ['utils.example.js: status_guru memuat Wali Kelas List & Map', /"Wali Kelas List": Array\.isArray\(g\.wali_kelas_list\)[\s\S]{0,200}?"Wali Kelas Map"/, 'utils']
].forEach(([nama, pola, src]) => cekBenar(`wali multi: ${nama}`, typeof pola === 'boolean' ? pola : pola.test(src === 'utils' ? utilsSrc : appSrc)));

// [TAHAP 4A] Uji RUNTIME helper wali app.js (fungsi murni, diekstrak dari sumber).
{
  const iWali = appSrc.indexOf('function penugasanGuruAktif(');
  const iAkhir = appSrc.indexOf('/** Normalkan NIS/NIP dari satu baris akun murid');
  cekBenar('app.js: blok helper wali multi dapat diekstrak', iWali > 0 && iAkhir > iWali, `i=${iWali} akhir=${iAkhir}`);
  if (iWali > 0 && iAkhir > iWali) {
    // Modul kelas cadangan (KELAS_FALLBACK) dipakai sebagai `kelasModul()` sandbox.
    const mFb2 = appSrc.match(/\/\/ ── \[KELAS-FALLBACK-MULAI\][\s\S]*?\/\/ ── \[KELAS-FALLBACK-SELESAI\]/);
    let FB2 = null;
    if (!mFb2) cekBenar('runtime: blok KELAS_FALLBACK ditemukan', false);
    else try {
      const sb = {};
      new Function('globalThis', `${mFb2[0]}\n;globalThis.__FB2__ = KELAS_FALLBACK;`)(sb);
      FB2 = sb.__FB2__;
    } catch (e) { cekBenar('runtime: KELAS_FALLBACK siap', false, e.message); }

    if (FB2) {
      const blok = appSrc.slice(iWali, iAkhir);
      const sb = {};
      try {
        new Function(
          'globalThis', 'kelasModul',
          `${blok}\n;globalThis.__W__ = { penugasanGuruAktif, penugasanTahunAda, bersihkanPenugasan, seedPenugasanDariKolomLama, waliKelasTahun, waliKelasTahunTeks, waliKelasTahunAda, waliKelasBarisAda, waliKelasBarisList, waliKelasAktifTeks };`
        )(sb, () => FB2);
      } catch (e) { cekBenar('runtime: blok helper wali dapat dieksekusi', false, e.message); }

      const W = sb.__W__;
      if (W) {
        const TA = '2026/2027';
        cek('runtime penugasanGuruAktif: wali string LAMA → array',
          W.penugasanGuruAktif({ penugasan: { [TA]: { wali: 'X LP 1' } } }, TA).wali, ['X LP 1']);
        cek('runtime penugasanGuruAktif: wali array BARU (2 kelas, tulisan asli dipertahankan)',
          W.penugasanGuruAktif({ penugasan: { [TA]: { wali: ['10 LP 1', 'X LP 2'] } } }, TA).wali, ['10 LP 1', 'X LP 2']);
        cek('runtime penugasanGuruAktif: TA tanpa entri → []',
          W.penugasanGuruAktif({ penugasan: {} }, TA).wali, []);
        cek('runtime penugasanTahunAda: wali array 1 kelas', W.penugasanTahunAda({ mapel: [], wali: ['X LP 1'], ekskul: [] }), true);
        cek('runtime penugasanTahunAda: semua kosong', W.penugasanTahunAda({ mapel: [], wali: [], ekskul: [] }), false);
        cek('runtime bersihkanPenugasan: wali jadi array & TA kosong dibuang',
          W.bersihkanPenugasan({ [TA]: { mapel: ['MTK'], wali: 'X LP 1, X LP 2', ekskul: [] }, '2027/2028': { mapel: [], wali: '', ekskul: [] } }),
          { [TA]: { mapel: ['MTK'], wali: ['X LP 1', 'X LP 2'], ekskul: [] } });
        cek('runtime seedPenugasanDariKolomLama: kolom lama 2 kelas',
          W.seedPenugasanDariKolomLama({ wali_kelas: 'X LP 1, X LP 2', mapel: 'Matematika', ekstrakurikuler: '' }, TA),
          { mapel: ['Matematika'], wali: ['X LP 1', 'X LP 2'], ekskul: [] });
        cek('runtime seedPenugasanDariKolomLama: kosong → null',
          W.seedPenugasanDariKolomLama({ wali_kelas: '', mapel: '', ekstrakurikuler: '' }, TA), null);
        cek('runtime waliKelasTahun: array', W.waliKelasTahun({ penugasan: { [TA]: { wali: ['X LP 1', 'X LP 2'] } } }, TA), ['X LP 1', 'X LP 2']);
        cek('runtime waliKelasTahunTeks: gabung koma', W.waliKelasTahunTeks({ penugasan: { [TA]: { wali: 'X LP 1, X LP 2' } } }, TA), 'X LP 1, X LP 2');
        cek('runtime waliKelasTahunAda: kanonik', W.waliKelasTahunAda({ penugasan: { [TA]: { wali: '10 LP 1' } } }, 'X LP 1', TA), true);
        cek('runtime waliKelasTahunAda: bukan kelasnya', W.waliKelasTahunAda({ penugasan: { [TA]: { wali: 'X LP 1' } } }, 'X LP 2', TA), false);
        cek('runtime waliKelasBarisAda: kolom baru wali_kelas_list',
          W.waliKelasBarisAda({ wali_kelas: '', wali_kelas_list: ['X LP 1', 'X LP 2'] }, 'X LP 2', TA), true);
        cek('runtime waliKelasBarisAda: kolom lama wali_kelas',
          W.waliKelasBarisAda({ wali_kelas: 'X LP 1, X LP 2' }, '10 LP 2', TA), true);
        cek('runtime waliKelasBarisList: gabung penugasan + kolom lama (dedup)',
          W.waliKelasBarisList({ penugasan: { [TA]: { wali: ['X LP 1'] } }, wali_kelas: '10 LP 1, X LP 3' }, TA),
          ['X LP 1', 'X LP 3']);
      }
    }
  }
}

// implementasi lama (peta tingkat angka) sudah tidak dipakai lagi
cekBenar('app.js: peta naik kelas manual sudah dibuang', !/'10':\s*'11'/.test(appSrc));

// Fallback darurat: bila kelas.js gagal dimuat, helper app.js tetap benar.
const mFb = appSrc.match(/\/\/ ── \[KELAS-FALLBACK-MULAI\][\s\S]*?\/\/ ── \[KELAS-FALLBACK-SELESAI\]/);
cekBenar('app.js: blok KELAS_FALLBACK ada (penanda MULAI/SELESAI)', !!mFb);
if (mFb) {
  try {
    const sandbox = {};
    new Function('globalThis', `${mFb[0]}\n;globalThis.__FB__ = KELAS_FALLBACK;`)(sandbox);
    const FB = sandbox.__FB__;
    cekBenar('fallback: normalTingkat 10→X', FB.normalTingkat('10') === 'X');
    cekBenar('fallback: pecah("10 RPL 1")', JSON.stringify(FB.pecah('10 RPL 1')) === JSON.stringify({ tingkat: 'X', jurusan_kode: 'RPL', rombel: 1 }));
    cekBenar('fallback: pecah("Semua Kelas") kosong', JSON.stringify(FB.pecah('Semua Kelas')) === JSON.stringify(KOSONG));
    cekBenar('fallback: label(X,LP,1)', FB.label('X', 'LP', 1) === 'X LP 1');
    cekBenar('fallback: sama("10 RPL 1","X RPL 1")', FB.sama('10 RPL 1', 'X RPL 1') === true);
    cekBenar('fallback: naik("XII")', FB.naik('XII') === 'LULUS');
    cekBenar('fallback: angkatan("10 RPL 1")', FB.angkatan('10 RPL 1') === 'X');
    cekBenar('fallback: komponen baris terstruktur',
      JSON.stringify(FB.komponen({ tingkat: 'XI', jurusan_kode: 'lp', rombel: 2 })) === JSON.stringify({ tingkat: 'XI', jurusan_kode: 'LP', rombel: 2 }));
    // [TAHAP 4A] daftar kelas wali di fallback
    cekBenar('fallback: normKelasList("X LP 1, X LP 2")',
      JSON.stringify(FB.normKelasList('X LP 1, X LP 2')) === JSON.stringify(['X LP 1', 'X LP 2']));
    cekBenar('fallback: normKelasList buang duplikat kanonik',
      JSON.stringify(FB.normKelasList(['X LP 1', '10 LP 1'])) === JSON.stringify(['X LP 1']));
    cekBenar('fallback: adaKelas kanonik', FB.adaKelas(['X LP 1'], '10 LP 1') === true);
    cekBenar('fallback: gabungKelas (dedup)', JSON.stringify(FB.gabungKelas(['X LP 1'], '10 LP 1, X LP 2')) === JSON.stringify(['X LP 1', 'X LP 2']));
    cekBenar('fallback: teksKelasList', FB.teksKelasList(['X LP 1', 'X LP 2']) === 'X LP 1, X LP 2');
  } catch (e) {
    cekBenar('fallback: blok dapat dieksekusi', false, e.message);
  }
}

// Kelengkapan API modul (dipakai app.js) — jaga dari penghapusan tak sengaja
['bersih', 'normalTingkat', 'pecah', 'label', 'komponen', 'komponenTahun', 'labelDariBaris', 'kunci', 'sama', 'naik', 'turun', 'angkatan', 'gayaTingkat', 'tingkatGaya',
 'normKelasList', 'adaKelas', 'gabungKelas', 'teksKelasList']
  .forEach((nama) => cekBenar(`KELAS.${nama} tersedia`, typeof K[nama] === 'function'));

// Registrasi & stempel versi (index.html ↔ sw.js ↔ install.js)
let html = '', sw = '', installJs = '';
try { html = baca(P_HTML); sw = baca(P_SW); installJs = baca(P_INSTALL); }
catch (e) { cekBenar('aset frontend dapat dibaca', false, e.message); }

const stempel = (teks, nama) => {
  const m = teks.match(new RegExp(`${nama.replace('.', '\\.')}\\?v=([0-9a-z]+)`));
  return m ? m[1] : '';
};
const stApp = stempel(html, 'js/app.js');
const stKelas = stempel(html, 'js/kelas.js');
const stBuild = (html.match(/name="sisip-build" content="([^"]+)"/) || [])[1] || '';
const stInstall = (installJs.match(/const BUILD = '([^']+)'/) || [])[1] || '';
const swVersi = (sw.match(/const VERSION = '([^']+)'/) || [])[1] || '';

cekBenar('index.html memuat js/kelas.js', !!stKelas);
cekBenar('index.html: kelas.js dimuat SEBELUM app.js', html.indexOf('js/kelas.js') !== -1 && html.indexOf('js/kelas.js') < html.indexOf('js/app.js'));
cekBenar('index.html: stempel kelas.js = app.js', !!stKelas && stKelas === stApp, `kelas=${stKelas} app=${stApp}`);
cekBenar('index.html: meta sisip-build = stempel app.js', !!stBuild && stBuild === stApp, `build=${stBuild} app=${stApp}`);
cekBenar('install.js: BUILD = stempel app.js', !!stInstall && stInstall === stApp, `install=${stInstall} app=${stApp}`);
cekBenar('sw.js: PRECACHE memuat js/kelas.js', sw.includes(`js/kelas.js?v=${stKelas}`), `cari js/kelas.js?v=${stKelas}`);
cekBenar('sw.js: PRECACHE app.js sinkron stempel', sw.includes(`js/app.js?v=${stApp}`));
cekBenar('sw.js: VERSION diisi', !!swVersi, swVersi);

/* ── ringkasan ────────────────────────────────────────────────────────── */
console.log(`\n${'─'.repeat(58)}`);
console.log(gagal === 0 ? `✅ SEMUA LULUS — ${lulus} pemeriksaan` : `❌ GAGAL — ${gagal} gagal dari ${lulus + gagal} pemeriksaan`);
process.exit(gagal === 0 ? 0 : 1);
