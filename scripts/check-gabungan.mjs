#!/usr/bin/env node
// ============================================================
// SISIP CHECK GABUNGAN — penjaga struktur `supabase/sql/gabungan.sql`
//
// SEJAK konsolidasi, `gabungan.sql` adalah SUMBER KEBENARAN TUNGGAL:
// berkas migrasi satu-per-satu (`upgrade_*.sql`) sudah DIHAPUS. Skrip
// ini dulu bernama `build-gabungan.mjs` (perakit dari 87 berkas) dan
// kini murni MEMERIKSA — tidak pernah menulis.
//
// Cara menjalankan:
//   npm run check:sql                 → periksa saja (exit 1 bila ada masalah)
//   node scripts/check-gabungan.mjs --list
//   node scripts/check-gabungan.mjs [--sql-dir supabase/sql] [--file gabungan.sql]
//
// Penjaga (semuanya fatal → exit 1):
//   1) marker blok `-- [n/M] nama.sql` harus berurutan 1..M, penyebut M seragam
//   2) nama berkas tiap blok harus UNIK (marker palsu/duplikat terdeteksi)
//   3) jumlah `$$` (dollar-quote PL/pgSQL) tiap blok harus GENAP
//   4) tak boleh ada baris mirip marker (`-- [n/M] …`) DI DALAM badan blok
//   5) header berkas (`… s.d. … (M berkas)`) harus cocok dengan isi blok
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const ambilOpsi = (nama, bawaan) => {
  const i = process.argv.indexOf(nama);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : bawaan;
};
const SQL_DIR = path.resolve(root, ambilOpsi('--sql-dir', 'supabase/sql'));
const FILE = path.resolve(SQL_DIR, ambilOpsi('--file', 'gabungan.sql'));
const MODE_LIST = process.argv.includes('--list');

const MARKER = /^-- \[(\d+)\/(\d+)\] (.+\.sql)\s*$/gm;
const MARKER_ANY = /^-- \[\d+\/\d+\] /;
const garis60 = '='.repeat(60);
const fatal = [];

// ── 1. baca + pisah blok ────────────────────────────────────────────────────
if (!fs.existsSync(FILE)) {
  console.error('❌ Tidak ditemukan: ' + path.relative(root, FILE));
  process.exit(1);
}
const isi = fs.readFileSync(FILE, 'utf8');

const posisi = [];
let m;
while ((m = MARKER.exec(isi))) {
  posisi.push({ nomor: Number(m[1]), penyebut: Number(m[2]), nama: m[3], start: m.index });
}
if (posisi.length === 0) {
  console.error('❌ Tidak ada marker blok (`-- [n/M] nama.sql`) di ' + path.relative(root, FILE));
  process.exit(1);
}

const M = posisi.length;
const blok = posisi.map((p, i) => ({
  ...p,
  badan: isi.slice(p.start, i + 1 < posisi.length ? posisi[i + 1].start : isi.length)
}));

// ── 2. penjaga struktur ─────────────────────────────────────────────────────
const terlihat = new Set();
for (let i = 0; i < blok.length; i++) {
  const b = blok[i];
  const label = 'blok ' + (i + 1) + ' (' + b.nama + ')';

  if (b.nomor !== i + 1) fatal.push(label + ': nomor marker ' + b.nomor + ' ≠ ' + (i + 1));
  if (b.penyebut !== M) fatal.push(label + ': penyebut ' + b.penyebut + ' ≠ jumlah blok ' + M);
  if (terlihat.has(b.nama)) fatal.push(label + ': nama berkas DUPLIKAT');
  terlihat.add(b.nama);

  const dolar = (b.badan.match(/\$\$/g) || []).length;
  if (dolar % 2 !== 0) fatal.push(label + ': jumlah $$ ganjil (' + dolar + ') → blok fungsi rusak');

  // marker palsu di dalam badan (baris ke-2 dst; baris pertama = marker resmi)
  const baris = b.badan.split('\n');
  for (let j = 1; j < baris.length; j++) {
    if (MARKER_ANY.test(baris[j])) { fatal.push(label + ': marker palsu di dalam badan → ' + baris[j].trim()); break; }
  }
}

// ── 3. header berkas harus cocok dengan isi ─────────────────────────────────
const tanggalBerkas = (nama) => (nama.match(/(20\d{6})/) || [''])[0];
const rapikan = (t) => (t ? t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6, 8) : '(tanpa tanggal)');
const berTanggal = blok.map((b) => tanggalBerkas(b.nama)).filter(Boolean).sort();
const tglAwal = rapikan(berTanggal[0]);
const tglAkhir = rapikan(berTanggal[berTanggal.length - 1]);

const reHeader = /Gabungan seluruh upgrade skema:\s*(\d{4}-\d{2}-\d{2})\s*s\.d\.\s*(\d{4}-\d{2}-\d{2})\s*\((\d+)\s*berkas\)/;
const mh = isi.match(reHeader);
if (!mh) {
  fatal.push('header: baris "Gabungan seluruh upgrade skema: … s.d. … (M berkas)" tidak ditemukan');
} else {
  if (mh[1] !== tglAwal) fatal.push('header: tanggal awal ' + mh[1] + ' ≠ ' + tglAwal + ' (blok pertama)');
  if (mh[2] !== tglAkhir) fatal.push('header: tanggal akhir ' + mh[2] + ' ≠ ' + tglAkhir + ' (blok terakhir)');
  if (Number(mh[3]) !== M) fatal.push('header: jumlah berkas ' + mh[3] + ' ≠ jumlah blok ' + M);
}

// ── 4. laporan ──────────────────────────────────────────────────────────────
if (MODE_LIST) {
  console.log('Blok gabungan (' + M + '):');
  blok.forEach((b) => console.log('  ' + String(b.nomor).padStart(3, ' ') + '. ' + b.nama));
  process.exit(fatal.length ? 1 : 0);
}

console.log('\n[check-gabungan] ' + path.relative(root, FILE));
console.log('  Blok             : ' + M + ' | berkas unik: ' + terlihat.size);
console.log('  Rentang tanggal  : ' + tglAwal + ' s.d. ' + tglAkhir);
console.log('  Penjaga          : $$ genap ' + (fatal.some((f) => f.includes('$$')) ? '❌' : '✅')
  + ' | marker berurutan ' + (fatal.some((f) => f.includes('nomor marker')) ? '❌' : '✅')
  + ' | nama unik ' + (fatal.some((f) => f.includes('DUPLIKAT')) ? '❌' : '✅')
  + ' | header cocok ' + (fatal.some((f) => f.includes('header')) ? '❌' : '✅'));

console.log('\n' + garis60);
if (fatal.length) {
  console.log('❌ ' + path.relative(root, FILE) + ' tidak valid:');
  for (const f of fatal) console.log('   • ' + f);
  process.exit(1);
}
console.log('✅ ' + path.relative(root, FILE) + ' valid — ' + M + ' blok, urutan & header konsisten.');
