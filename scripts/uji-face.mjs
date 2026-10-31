/**
 * Uji regresi logika murni `web/js/face.js` (tanpa browser, tanpa model wajah).
 *
 * Yang diuji (fungsi/konstanta di dalam IIFE diekstrak dari sumbernya):
 *   1. `gambarLandmarkPindai` + `KONTUR_68` — geometri overlay landmark harus SAMA
 *      dengan geometri kotak deteksi (object-contain + zoom + mirror) di loop pindai.
 *   2. `ambangCocok()` — ambang "Hadir" baku per motor (face-api 0.50 / mediapipe 0.80),
 *      kalibrasi per perangkat `localStorage.sbg_wajah_ambang` (0.3–0.85) dan perilaku
 *      saat localStorage diblokir / nilainya rusak.
 *   3. Deteksi vektor berdimensi motor lain (dasar pesan "mesin pengenalan lain").
 *
 * Jalankan: `npm run test:face` (atau `node scripts/uji-face.mjs`).
 * Tidak menyentuh jaringan & tidak mengubah berkas apa pun.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const AKAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUMBER = readFileSync(path.join(AKAR, 'web', 'js', 'face.js'), 'utf8');

let gagal = 0;
let lulus = 0;
const cek = (nama, lulusUji, info) => {
  if (lulusUji) { lulus++; return; }
  gagal++;
  console.log('GAGAL — ' + nama + (info !== undefined ? ' [' + info + ']' : ''));
};

/** Ambil satu potongan kode sumber face.js berdasarkan pola (harus ada). */
function potong(re, nama) {
  const m = SUMBER.match(re);
  if (!m) throw new Error('potongan sumber tidak ditemukan: ' + nama);
  return m[0];
}

// ---------------------------------------------------------------------------
// 1. Overlay landmark
// ---------------------------------------------------------------------------
const kodeLandmark = [
  potong(/const KONTUR_68 = \[[\s\S]*?\n  \];/, 'KONTUR_68'),
  potong(/function gambarLandmarkPindai\(ctx, positions, geo\) \{[\s\S]*?\n  \}/, 'gambarLandmarkPindai')
].join('\n');

const { KONTUR_68, gambarLandmarkPindai } = new Function(
  kodeLandmark + '\nreturn { KONTUR_68, gambarLandmarkPindai };'
)();

/** Canvas palsu: mencatat operasi gambar supaya hasilnya bisa diperiksa. */
function ctxPalsu() {
  const op = { arc: 0, fill: 0, stroke: 0, moveTo: [], lineTo: [], dashReset: 0, lastArc: null };
  return {
    op,
    save() {}, restore() {}, beginPath() {},
    stroke() { op.stroke++; }, fill() { op.fill++; },
    setLineDash() { op.dashReset++; },
    arc(x, y, r) { op.arc++; op.lastArc = [x, y, r]; },
    moveTo(x, y) { op.moveTo.push([x, y]); },
    lineTo(x, y) { op.lineTo.push([x, y]); },
    set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {}
  };
}

const geo = { s: 0.5, offX: 10, offY: 20, cW: 640, mirror: false, warna: 'rgba(0,0,0,1)' };
const pos68 = Array.from({ length: 68 }, (_, i) => ({ x: i * 2, y: i * 3 }));
const pos478 = Array.from({ length: 478 }, (_, i) => ({ x: i, y: i }));

const c68 = ctxPalsu();     gambarLandmarkPindai(c68, pos68, geo);
const cMir = ctxPalsu();    gambarLandmarkPindai(cMir, pos68, { ...geo, mirror: true });
const c478 = ctxPalsu();    gambarLandmarkPindai(c478, pos478, geo);
const cKosong = ctxPalsu(); gambarLandmarkPindai(cKosong, null, geo);

const dekat = (a, b) => Math.abs(a - b) < 1e-9;
const terakhirX = 67 * 2, terakhirY = 67 * 3;

cek('68 landmark digambar sebagai titik', c68.op.arc === 68 && c68.op.fill === 68, c68.op.arc + ' arc');
cek('kontur 68 titik digambar', c68.op.stroke === KONTUR_68.length && KONTUR_68.length > 0, c68.op.stroke + ' stroke');
cek('tanpa mirror: x = offX + x*s', dekat(c68.op.lastArc[0], 10 + terakhirX * 0.5), c68.op.lastArc[0]);
cek('mirror: x = cW - (offX + x*s)', dekat(cMir.op.lastArc[0], 640 - (10 + terakhirX * 0.5)), cMir.op.lastArc[0]);
cek('y = offY + y*s', dekat(c68.op.lastArc[1], 20 + terakhirY * 0.5), c68.op.lastArc[1]);
cek('478 titik: mesh saja (tanpa kontur)', c478.op.arc === 478 && c478.op.stroke === 0);
cek('input kosong/null aman', cKosong.op.arc === 0 && cKosong.op.stroke === 0);
cek('KONTUR_68 berindeks sah 0..67', KONTUR_68.every(([a, b]) => a >= 0 && b < 68 && a <= b));
cek('garis putus-putus kotak deteksi direset', c68.op.dashReset === 1, c68.op.dashReset);


// ---------------------------------------------------------------------------
// 2. Ambang cocok & kalibrasi per perangkat
// ---------------------------------------------------------------------------
const kodeAmbang = [
  potong(/const JARAK_COCOK = [\d.]+;/, 'JARAK_COCOK'),
  potong(/const JARAK_KENAL = [\d.]+;/, 'JARAK_KENAL'),
  potong(/const DIM_WAJAH_LEGACY = [\d.]+;/, 'DIM_WAJAH_LEGACY'),
  potong(/const DIM_WAJAH_MEDIAPIPE = [\d.]+;/, 'DIM_WAJAH_MEDIAPIPE'),
  potong(/const JARAK_COCOK_MP = [\d.]+;/, 'JARAK_COCOK_MP'),
  potong(/const JARAK_KENAL_MP = [\d.]+;/, 'JARAK_KENAL_MP'),
  potong(/function motorWajah\(\) \{[\s\S]*?\n  \}/, 'motorWajah'),
  potong(/function dimWajahMotor\(\) \{[\s\S]*?\n  \}/, 'dimWajahMotor'),
  potong(/function ambangCocok\(\) \{[\s\S]*?\n  \}/, 'ambangCocok'),
  'let mpDimensiWajah = 0;'
].join('\n');

const simpan = new Map();
const localStoragePalsu = {
  getItem: (k) => (simpan.has(k) ? simpan.get(k) : null),
  setItem: (k, v) => simpan.set(k, String(v)),
  removeItem: (k) => simpan.delete(k)
};
const api = new Function(
  'localStorage',
  kodeAmbang + '\nreturn { ambangCocok, motorWajah, dimWajahMotor, JARAK_COCOK, JARAK_KENAL, JARAK_COCOK_MP, JARAK_KENAL_MP };'
)(localStoragePalsu);

cek('baku face-api = 0.50', api.ambangCocok() === 0.5, api.ambangCocok());
simpan.set('sbg_wajah_motor', 'mediapipe');
cek('baku mediapipe = 0.80', api.ambangCocok() === 0.8, api.ambangCocok());
cek('mediapipe memakai 512 angka', api.dimWajahMotor() === 512);
simpan.delete('sbg_wajah_motor');
cek('face-api memakai 128 angka', api.dimWajahMotor() === 128);

simpan.set('sbg_wajah_ambang', '0.55');
cek('kalibrasi 0.55 berlaku (face-api)', api.ambangCocok() === 0.55, api.ambangCocok());
simpan.set('sbg_wajah_motor', 'mediapipe');
cek('kalibrasi 0.55 berlaku (mediapipe)', api.ambangCocok() === 0.55, api.ambangCocok());

for (const nilaiRusak of ['0.2', '0.9', 'abc', '', '-1']) {
  simpan.set('sbg_wajah_ambang', nilaiRusak);
  cek('kalibrasi "' + nilaiRusak + '" diabaikan (kembali 0.80)', api.ambangCocok() === 0.8, api.ambangCocok());
}

const apiDiblokir = new Function(
  'localStorage',
  kodeAmbang + '\nreturn { ambangCocok, motorWajah };'
)({ getItem() { throw new Error('blocked'); }, setItem() {}, removeItem() {} });
cek('localStorage diblokir → baku 0.50', apiDiblokir.ambangCocok() === 0.5, apiDiblokir.ambangCocok());
cek('localStorage diblokir → motor face-api', apiDiblokir.motorWajah() === 'faceapi');

simpan.clear();
simpan.set('sbg_wajah_ambang', '0.70');
cek('ambang matcher face-api ikut naik (max 0.6 vs 0.70)', Math.max(api.JARAK_KENAL, api.ambangCocok()) === 0.7);
simpan.set('sbg_wajah_ambang', '0.55');
cek('ambang matcher face-api tetap 0.60', Math.max(api.JARAK_KENAL, api.ambangCocok()) === 0.6);
cek('batas kalibrasi (0.85) < batas unknown mediapipe', 0.85 < api.JARAK_KENAL_MP, api.JARAK_KENAL_MP);

// ---------------------------------------------------------------------------
// 3. Deteksi vektor berdimensi motor lain (dasar pesan "mesin pengenalan lain")
// ---------------------------------------------------------------------------
// Diambil langsung dari face.js (bukan disalin) supaya perubahan logika di sana
// langsung menggagalkan uji ini.
const potonganDim = potong(
  /const dimV = \(Array\.isArray\(d0\)[\s\S]*?: 0\);/,
  'dimVektor (deteksi dimensi)'
);
const dimVektor = new Function('d0', potonganDim + '\nreturn dimV;');

cek('vektor flat 128 → 128', dimVektor(new Array(128).fill(0)) === 128);
cek('multi-sampel 512 → 512', dimVektor([new Array(512).fill(0), new Array(512).fill(0)]) === 512);
cek('JSON mentah/string → 0 (bukan vektor)', dimVektor('{"0":1}') === 0);
cek('null → 0', dimVektor(null) === 0);
cek('array kosong → 0', dimVektor([]) === 0);

// ---------------------------------------------------------------------------
console.log(lulus + ' lulus, ' + gagal + ' gagal.');
if (gagal) process.exitCode = 1;
