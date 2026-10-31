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
 *   4. Akurasi Absen Mandiri (`{ mandiri: true }`): fusi 3 frame
 *      (`rataRataDescriptor`), statistik kualitas citra (`statistikKualitasCitra` /
 *      `kualitasCitraCukup`), gerbang pose (`deteksiPoseDepan`), ambang 1:1
 *      (`ambangMandiri`), pemilihan mesin dari dimensi descriptor, dan pemeriksaan
 *      struktural agar jalur fusi/pose/`motorPaksa` benar-benar terpasang di loop.
 *   5. Lapisan kamera universal: tangga kandidat `susunKandidatKamera` (deviceId →
 *      facingMode → bawaan, TIDAK pernah `width/height: exact`, penutup tanpa
 *      permintaan resolusi), `normalkanKandidatKamera` untuk kandidat gaya lama,
 *      `deteksiLingkunganKamera`, `pesanKameraError` (izin ditolak/NotFound/
 *      NotReadable/Overconstrained/TypeError) + pemeriksaan struktural bahwa
 *      registrasi, Absen Mandiri, dan Face Scan kelas memakai lapisan ini, serta
 *      fallback selfie & pemilih kamera benar-benar terpasang.
 *
 * Jalankan: `npm run test:face` (atau `node scripts/uji-face.mjs`; di sandbox
 * tanpa Node: `deno run -A scripts/uji-face.mjs`).
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
  potong(/let motorPaksa = null;/, 'motorPaksa'),
  potong(/function motorAktif\(\) \{[\s\S]*?\n  \}/, 'motorAktif'),
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
// 4. Akurasi Absen Mandiri: fusi multi-frame, kualitas citra, gerbang pose,
//    ambang 1:1, dan mesin otomatis sesuai dimensi data.
// ---------------------------------------------------------------------------
const kodeAkurasi = [
  potong(/const JARAK_COCOK = [\d.]+;/, 'JARAK_COCOK (akurasi)'),
  potong(/const DIM_WAJAH_LEGACY = [\d.]+;/, 'DIM_WAJAH_LEGACY (akurasi)'),
  potong(/const DIM_WAJAH_MEDIAPIPE = [\d.]+;/, 'DIM_WAJAH_MEDIAPIPE (akurasi)'),
  potong(/const JARAK_COCOK_MP = [\d.]+;/, 'JARAK_COCOK_MP (akurasi)'),
  potong(/function motorWajah\(\) \{[\s\S]*?\n  \}/, 'motorWajah (akurasi)'),
  potong(/let motorPaksa = null;/, 'motorPaksa'),
  potong(/function motorAktif\(\) \{[\s\S]*?\n  \}/, 'motorAktif'),
  'let mpDimensiWajah = 0;',
  potong(/function dimWajahMotor\(\) \{[\s\S]*?\n  \}/, 'dimWajahMotor (akurasi)'),
  potong(/function ambangCocok\(\) \{[\s\S]*?\n  \}/, 'ambangCocok (akurasi)'),
  potong(/function ambangMandiri\(\) \{[\s\S]*?\n  \}/, 'ambangMandiri'),
  potong(/const FUSI_JUMLAH = \d+;/, 'FUSI_JUMLAH'),
  potong(/const FUSI_LAYAK_MIN = \d+;/, 'FUSI_LAYAK_MIN'),
  potong(/const KETAJAMAN_MIN = \d+;/, 'KETAJAMAN_MIN'),
  potong(/const CAHAYA_MIN = \d+;/, 'CAHAYA_MIN'),
  potong(/const CAHAYA_MAKS = \d+;/, 'CAHAYA_MAKS'),
  potong(/const YAW_MAKS = [\d.]+;/, 'YAW_MAKS'),
  potong(/function dimensiVektorDescriptor\(d\) \{[\s\S]*?\n  \}/, 'dimensiVektorDescriptor'),
  potong(/function rataRataDescriptor\(daftar, dim\) \{[\s\S]*?\n  \}/, 'rataRataDescriptor'),
  potong(/function statistikKualitasCitra\(data, w, h\) \{[\s\S]*?\n  \}/, 'statistikKualitasCitra'),
  potong(/function kualitasCitraCukup\(stat\) \{[\s\S]*?\n  \}/, 'kualitasCitraCukup'),
  potong(/function deteksiPoseDepan\(positions, box, frameW, frameH\) \{[\s\S]*?\n  \}/, 'deteksiPoseDepan')
].join('\n');

const akurasi = new Function(
  'localStorage',
  kodeAkurasi + '\nreturn { motorAktif, ambangCocok, ambangMandiri, dimensiVektorDescriptor,'
  + ' rataRataDescriptor, statistikKualitasCitra, kualitasCitraCukup, deteksiPoseDepan,'
  + ' FUSI_JUMLAH, FUSI_LAYAK_MIN, KETAJAMAN_MIN, CAHAYA_MIN, CAHAYA_MAKS, YAW_MAKS };'
)(localStoragePalsu);

// --- 4a. Fusi descriptor ---
const fusi = akurasi.rataRataDescriptor([[1, 2], [3, 4]], 2);
cek('fusi 2 vektor = rata-rata per-elemen', fusi.length === 2 && dekat(fusi[0], 2) && dekat(fusi[1], 3), fusi);
cek('fusi mengabaikan vektor dimensi salah', akurasi.rataRataDescriptor([[1, 2], [1, 2, 3]], 2).length === 2);
cek('fusi null bila tidak ada vektor sah', akurasi.rataRataDescriptor([[1]], 2) === null);
cek('fusi daftar kosong → null', akurasi.rataRataDescriptor([], 2) === null);
cek('fusi bukan array → null', akurasi.rataRataDescriptor(null, 2) === null);

const v512 = new Array(512).fill(0); v512[0] = 3; v512[1] = 4; // L2 = 5
const fusi512 = akurasi.rataRataDescriptor([v512, v512, v512], 512);
cek('fusi 512 dinormalisasi L2 (3,4 → 0.6,0.8)',
  Math.abs(fusi512[0] - 0.6) < 1e-6 && Math.abs(fusi512[1] - 0.8) < 1e-6,
  fusi512.slice(0, 2).join(','));
cek('FUSI_JUMLAH = 3 frame & konsensus minimal 2', akurasi.FUSI_JUMLAH === 3 && akurasi.FUSI_LAYAK_MIN === 2);

// --- 4b. Statistik kualitas citra (RGBA) ---
function rgba(w, h, isi) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = isi(x, y);
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
  }
  return d;
}
const rata = akurasi.statistikKualitasCitra(rgba(16, 16, () => 128), 16, 16);
cek('citra rata: cahaya = 128', dekat(rata.cahaya, 128), rata.cahaya);
cek('citra rata: ketajaman = 0 (blur)', dekat(rata.ketajaman, 0), rata.ketajaman);
cek('citra rata ditolak gerbang kualitas', akurasi.kualitasCitraCukup(rata) === false);

const tajam = akurasi.statistikKualitasCitra(rgba(16, 16, (x, y) => ((x + y) % 2 ? 235 : 20)), 16, 16);
cek('citra bergaris: ketajaman tinggi', tajam.ketajaman > akurasi.KETAJAMAN_MIN, tajam.ketajaman);
cek('citra bergaris diterima gerbang', akurasi.kualitasCitraCukup(tajam) === true);

const gelap = akurasi.statistikKualitasCitra(rgba(16, 16, (x, y) => ((x + y) % 2 ? 20 : 0)), 16, 16);
cek('citra gelap ditolak (cahaya < min)', akurasi.kualitasCitraCukup(gelap) === false, gelap.cahaya);
const silau = akurasi.statistikKualitasCitra(rgba(16, 16, (x, y) => ((x + y) % 2 ? 255 : 240)), 16, 16);
cek('citra silau ditolak (cahaya > maks)', akurasi.kualitasCitraCukup(silau) === false, silau.cahaya);
cek('statistik data pendek ditolak', akurasi.statistikKualitasCitra(new Uint8Array(10), 16, 16) === null);
cek('statistik null aman', akurasi.statistikKualitasCitra(null, 16, 16) === null);

// --- 4c. Gerbang pose (yaw + ukuran + tepi) ---
function landmark478(noseX, opt) {
  const o = opt || {};
  const p = Array.from({ length: 478 }, () => ({ x: 0, y: 0 }));
  p[33] = { x: 200, y: 100 };  // sudut mata kiri
  p[263] = { x: 400, y: 100 }; // sudut mata kanan (span 200)
  p[1] = { x: noseX, y: 160 }; // ujung hidung
  p[36] = { x: 200, y: 100 }; p[45] = { x: 400, y: 100 }; p[30] = { x: noseX, y: 160 };
  if (o.sempit) { p[33].x = 300; p[263].x = 300; }
  return p;
}
const boxWajah = { x: 150, y: 60, width: 300, height: 240 };
const depan = akurasi.deteksiPoseDepan(landmark478(300), boxWajah, 640, 480);
cek('pose frontal diterima', depan && depan.depan === true, depan && depan.yaw);
cek('pose yaw 0,4 masih diterima (≤ YAW_MAKS)', akurasi.deteksiPoseDepan(landmark478(340), boxWajah, 640, 480).depan === true);
const menoleh = akurasi.deteksiPoseDepan(landmark478(380), boxWajah, 640, 480);
cek('pose menoleh ditolak (yaw > YAW_MAKS)', menoleh.depan === false && menoleh.yaw > akurasi.YAW_MAKS, menoleh.yaw);
cek('wajah kecil ditolak', akurasi.deteksiPoseDepan(landmark478(300), { x: 150, y: 60, width: 100, height: 80 }, 640, 480).depan === false);
cek('wajah terpotong tepi ditolak', akurasi.deteksiPoseDepan(landmark478(300), { x: 0, y: 0, width: 300, height: 240 }, 640, 480).terpotong === true);
cek('landmark kurang dari 68 → null', akurasi.deteksiPoseDepan([{ x: 0, y: 0 }], boxWajah, 640, 480) === null);
cek('span mata nol → null', akurasi.deteksiPoseDepan(landmark478(300, { sempit: true }), boxWajah, 640, 480) === null);
cek('pose tetap memakai 68 titik face-api',
  akurasi.deteksiPoseDepan(landmark478(300).slice(0, 68), boxWajah, 640, 480).depan === true);

// --- 4d. Ambang 1:1 (lebih ketat dari ambang kelas) ---
simpan.clear();
cek('ambang mandiri face-api 0.50 → 0.47', dekat(akurasi.ambangMandiri(), 0.47), akurasi.ambangMandiri());
simpan.set('sbg_wajah_motor', 'mediapipe');
cek('ambang mandiri mediapipe 0.80 → 0.77', dekat(akurasi.ambangMandiri(), 0.77), akurasi.ambangMandiri());
simpan.set('sbg_wajah_ambang', '0.85');
cek('kalibrasi 0.85 → mandiri 0.82', dekat(akurasi.ambangMandiri(), 0.82), akurasi.ambangMandiri());
simpan.set('sbg_wajah_ambang', '0.30');
cek('kalibrasi minimum 0.30 tetap 0.30 (tidak negatif)', dekat(akurasi.ambangMandiri(), 0.30), akurasi.ambangMandiri());
simpan.clear();

// --- 4e. Mesin otomatis sesuai dimensi descriptor ---
cek('dimensi flat 128 → 128', akurasi.dimensiVektorDescriptor(new Array(128).fill(0)) === 128);
cek('dimensi multi-sampel 512 → 512', akurasi.dimensiVektorDescriptor([new Array(512).fill(0), new Array(512).fill(0)]) === 512);
cek('dimensi string/JSON → 0', akurasi.dimensiVektorDescriptor('{"0":1}') === 0);
cek('dimensi null → 0', akurasi.dimensiVektorDescriptor(null) === 0);
cek('motor efektif = setelan perangkat tanpa paksaan', akurasi.motorAktif() === 'faceapi');

// --- 4f. Pemeriksaan struktural: jalur mandiri benar-benar terpasang ---
cek('loop pindai mandiri mengaktifkan gerbang+fusi', /await loopDeteksiPindai\(\{[\s\S]{0,600}?mandiri: true/.test(SUMBER));
cek('gerbang pose dipakai saat o.mandiri', /if \(o\.mandiri\) \{[\s\S]{0,500}?deteksiPoseDepan\(/.test(SUMBER));
cek('gerbang kualitas dipakai saat o.mandiri', /if \(o\.mandiri\) \{[\s\S]{0,900}?kualitasCitraCukup\(stat\)/.test(SUMBER));
cek('fusi descriptor dipakai saat o.mandiri', /if \(o\.mandiri\) \{[\s\S]{0,300}?bufferFusi\.push/.test(SUMBER));
cek('ambang loop mandiri = ambangMandiri()', /const cocokDi = o\.mandiri \? ambangMandiri\(\) : ambangCocok\(\);/.test(SUMBER));
cek('matcher mandiri memakai ambang 1:1', /buatMatcherDariPeta\(\{ \[nisS\]: \{ descriptor: daftarSampel \} \}, ambangMandiri\(\)\)/.test(SUMBER));
cek('mesin dipaksa otomatis sesuai dimensi data', /motorPaksa = \(dimV === DIM_WAJAH_MEDIAPIPE\) \? 'mediapipe' : 'faceapi';/.test(SUMBER));
cek('mesin dipulihkan di finally', /finally \{[\s\S]{0,200}?motorPaksa = null;/.test(SUMBER));
cek('pesan "mesin pengenalan lain" Absen Mandiri diganti diagnosis',
  !/terdaftar dengan <b>mesin pengenalan lain<\/b> \(\$\{dimV\}/.test(SUMBER));

// ---------------------------------------------------------------------------
// 5. Lapisan kamera universal (tangga constraint, normalisasi, pesan izin)
// ---------------------------------------------------------------------------
const kodeKamera = [
  potong(/const KAMERA_UKURAN_BAKU = \{[\s\S]*?\n/, 'KAMERA_UKURAN_BAKU'),
  potong(/function deteksiLingkunganKamera\(\) \{[\s\S]*?\n  \}/, 'deteksiLingkunganKamera'),
  potong(/function kandidatKeCfg\(k, ukuran\) \{[\s\S]*?\n  \}/, 'kandidatKeCfg'),
  potong(/function susunKandidatKamera\(opsi\) \{[\s\S]*?\n  \}/, 'susunKandidatKamera'),
  potong(/function normalkanKandidatKamera\(kandidat, ukuran\) \{[\s\S]*?\n  \}/, 'normalkanKandidatKamera'),
  potong(/function pesanKameraError\(e\) \{[\s\S]*?\n  \}/, 'pesanKameraError')
].join('\n');

const kam = new Function(
  kodeKamera + '\nreturn { KAMERA_UKURAN_BAKU, deteksiLingkunganKamera, kandidatKeCfg, susunKandidatKamera, normalkanKandidatKamera, pesanKameraError };'
)();

// --- 5a. Tangga baku: `ideal` saja, penutup tanpa permintaan resolusi ---
const tanggaBaku = kam.susunKandidatKamera({});
cek('tangga baku punya kandidat penutup tanpa permintaan resolusi',
  tanggaBaku.length >= 2 && Object.keys(tanggaBaku[tanggaBaku.length - 1].cfg).length === 0,
  'jumlah kandidat ' + tanggaBaku.length);
cek('tidak ada width/height `exact` di tangga baku', !tanggaBaku.some(k => {
  const w = k.cfg && k.cfg.width, h = k.cfg && k.cfg.height;
  return (w && w.exact != null) || (h && h.exact != null);
}));
cek('kandidat beresolusi selalu memakai `ideal`',
  tanggaBaku.filter(k => Object.keys(k.cfg).length).every(k =>
    k.cfg.width && k.cfg.width.ideal && k.cfg.height && k.cfg.height.ideal));

// --- 5b. deviceId didahulukan, diulang sebagai `ideal` ---
const tanggaDev = kam.susunKandidatKamera({ deviceId: 'ID-KAMERA' });
cek('kandidat pertama = deviceId exact',
  tanggaDev[0].cfg.deviceId && tanggaDev[0].cfg.deviceId.exact === 'ID-KAMERA', tanggaDev[0].nama);
cek('kandidat kedua = deviceId ideal (cadangan saat `exact` ditolak)',
  tanggaDev[1].cfg.deviceId && tanggaDev[1].cfg.deviceId.ideal === 'ID-KAMERA'
    && tanggaDev[1].cfg.deviceId.exact === undefined, tanggaDev[1].nama);

// --- 5c. Urutan facingMode: muka yang diminta lebih dulu, cadangan tetap ada ---
const namaEnv = kam.susunKandidatKamera({ muka: 'environment' }).map(k => k.nama);
cek('environment dicoba sebelum user',
  namaEnv.indexOf('facingMode-exact-environment') < namaEnv.indexOf('facingMode-exact-user'), namaEnv.join('|'));
const namaUser = kam.susunKandidatKamera({ muka: 'user' }).map(k => k.nama);
cek('user dicoba sebelum environment',
  namaUser.indexOf('facingMode-exact-user') < namaUser.indexOf('facingMode-exact-environment'));
cek('cadangan muka bisa dimatikan (tanpaCadanganMuka)',
  kam.susunKandidatKamera({ muka: 'user', tanpaCadanganMuka: true }).every(k => !/environment/.test(k.nama)));

// --- 5d. Ukuran khusus (potret registrasi 720×1280) dipakai konsisten ---
const tanggaPotret = kam.susunKandidatKamera({ muka: 'user', ukuran: { width: { ideal: 720 }, height: { ideal: 1280 } } });
cek('ukuran potret dipakai kandidat pertama',
  tanggaPotret[0].cfg.width.ideal === 720 && tanggaPotret[0].cfg.height.ideal === 1280);

// --- 5e. Normalisasi kandidat gaya lama (string/objek kosong/null) ---
const normal = kam.normalkanKandidatKamera(['user', {}]);
cek('kandidat string → facingMode', normal[0].cfg.facingMode === 'user', JSON.stringify(normal[0].cfg));
cek('kandidat objek kosong → tetap mendapat ukuran `ideal`',
  normal[1].cfg.width && normal[1].cfg.width.ideal === 1280);
const normalKosong = kam.normalkanKandidatKamera(null);
cek('kandidat kosong → tangga baku (ada facingMode)',
  Array.isArray(normalKosong) && normalKosong.length >= 2 && !!normalKosong[0].cfg.facingMode);

// --- 5f. Pesan error kamera: Indonesia, spesifik, bisa ditindaklanjuti ---
cek('izin ditolak → langkah izin Android + iPhone',
  /Izin kamera ditolak/.test(kam.pesanKameraError({ name: 'NotAllowedError' }))
    && /Safari/.test(kam.pesanKameraError({ name: 'PermissionDeniedError' })));
cek('kamera tidak terdeteksi → arahkan ke foto/selfie',
  /Selfie|Foto/.test(kam.pesanKameraError({ name: 'NotFoundError' })));
cek('kamera dipakai aplikasi lain → NotReadableError',
  /dipakai aplikasi/.test(kam.pesanKameraError({ name: 'NotReadableError' })));
cek('halaman non-HTTPS (TypeError) → pesan HTTPS/localhost',
  /HTTPS atau localhost/.test(kam.pesanKameraError({ name: 'TypeError' })));
cek('OverconstrainedError menyebut pilih kamera lain',
  /kamera lain/.test(kam.pesanKameraError({ name: 'OverconstrainedError', constraint: 'deviceId' })));
cek('error tanpa nama → pesan aslinya dipakai', kam.pesanKameraError(new Error('boom')) === 'boom');

// --- 5g. deteksiLingkunganKamera: bentuk kontrak selalu sama ---
const envKam = kam.deteksiLingkunganKamera();
cek('deteksiLingkunganKamera → { adaAPI, adaEnumerasi, aman, bisa, pesan }',
  typeof envKam.bisa === 'boolean' && typeof envKam.adaAPI === 'boolean'
    && typeof envKam.aman === 'boolean' && typeof envKam.pesan === 'string');
cek('bisa = adaAPI && aman', envKam.bisa === (envKam.adaAPI && envKam.aman));
cek('tanpa API kamera → pesan menuntun ke foto/selfie',
  envKam.adaAPI ? true : /Foto|selfie/i.test(envKam.pesan), envKam.pesan);

// --- 5h. Pemeriksaan struktural: semua jalur kamera memakai lapisan universal ---
// Baris komentar dibuang dulu — dokumentasi justru MENJELASKAN larangan
// `width/height: { exact }`, jadi hanya kode yang diperiksa.
const kodeTanpaKomentar = SUMBER.split('\n')
  .filter(l => { const t = l.trim(); return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')); })
  .join('\n');
cek('tidak ada `width/height: { exact }` di kode face.js',
  !/width:\s*\{\s*exact/.test(kodeTanpaKomentar) && !/height:\s*\{\s*exact/.test(kodeTanpaKomentar));
cek('registrasi wajah lewat bukaKameraKeVideo + ingat kamera terakhir',
  /await bukaKameraKeVideo\(\{[\s\S]{0,240}?video: videoEl[\s\S]{0,300}?KUNCI_KAMERA_SIMPAN/.test(SUMBER));
cek('Absen Mandiri memakai bukaKameraUniversal + slot KUNCI_KAMERA_SIMPAN',
  /await bukaKameraUniversal\(\{[\s\S]{0,340}?KUNCI_KAMERA_SIMPAN/.test(SUMBER));
cek('Face Scan kelas memakai bukaKameraUniversal + slot KUNCI_KAMERA_PINDAI',
  /bukaKameraUniversal\(\{[\s\S]{0,340}?KUNCI_KAMERA_PINDAI/.test(SUMBER));
cek('ganti kamera memakai gantiKameraAktif (applyConstraints → stop-buka → rollback)',
  /function gantiKameraAktif/.test(SUMBER) && /applyConstraints/.test(SUMBER)
    && /gantiKameraAktif\(\{[\s\S]{0,200}?streamLama/.test(SUMBER));
cek('fallback selfie Absen Mandiri terpasang (tombol + verifikasi foto)',
  /btn-mandiri-selfie/.test(SUMBER) && /const verifikasiMandiriDariFoto = async/.test(SUMBER));
cek('registrasi menyediakan tombol Ambil Selfie',
  /const btnSelfie = cari\('btn-wajah-selfie'\)/.test(SUMBER));
cek('kamera dilepas saat tab disembunyikan (visibilitychange)',
  /visibilitychange[\s\S]{0,240}?hentikanKamera\(\)/.test(SUMBER));
cek('daftar kamera disegarkan saat perangkat berubah (devicechange)',
  /addEventListener\('devicechange'/.test(SUMBER));
cek('API publik kamera diekspor (dipakai pemindai QR di app.js)',
  /daftarKamera,\s*\n\s*kameraTerakhirTersimpan,/.test(SUMBER));

// ---------------------------------------------------------------------------
console.log(lulus + ' lulus, ' + gagal + ' gagal.');
if (gagal) process.exitCode = 1;


