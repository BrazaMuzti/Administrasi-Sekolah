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
 *   6. Motor `onnx` (YuNet + align 5 titik + matcher kosinus): dekode 12 tensor
 *      keluaran YuNet (skor √(cls·obj), cx=(kolom+dx)·stride, w=e^dw·stride, 5
 *      titik), IoU/NMS, matriks affine 3 titik, mapping 5 titik → template 112×112
 *      (round-trip + tidak bergantung urutan mata/mulut), kemiripan kosinus, matcher
 *      `buatMatcherKosinus` (margin top-2), ambang/dimensi mesin onnx, gerbang pose
 *      dari 5 titik, pemeriksaan struktural jalur onnx, dan penahan bug crop
 *      `drawImage` (argumen sumber/tujuan pernah tertukar → descriptor kosong).
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
  potong(/const JARAK_COCOK_ONNX = [\d.]+;/, 'JARAK_COCOK_ONNX'),
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
  potong(/const JARAK_COCOK_ONNX = [\d.]+;/, 'JARAK_COCOK_ONNX (akurasi)'),
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
cek('mesin dipaksa otomatis sesuai dimensi data',
  /motorPaksa = \(dimV === DIM_WAJAH_MEDIAPIPE\)[\s\S]{0,90}?\? \(motorWajah\(\) === 'onnx' \? 'onnx' : 'mediapipe'\)[\s\S]{0,40}?: 'faceapi';/.test(SUMBER));
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
// 6. Motor onnx: dekode YuNet, align 5 titik, matcher kosinus
// ---------------------------------------------------------------------------
const kodeOnnx = [
  potong(/const JARAK_COCOK_ONNX = [\d.]+;/, 'JARAK_COCOK_ONNX (onnx)'),
  potong(/const JARAK_KENAL_ONNX = [\d.]+;/, 'JARAK_KENAL_ONNX'),
  potong(/const MARGIN_TOP2 = [\d.]+;/, 'MARGIN_TOP2'),
  potong(/const YUNET_UKURAN = \d+;/, 'YUNET_UKURAN'),
  potong(/const YUNET_AMBANG_SKOR = [\d.]+;/, 'YUNET_AMBANG_SKOR'),
  potong(/const YUNET_NMS_IOU = [\d.]+;/, 'YUNET_NMS_IOU'),
  potong(/const TEMPLATE_112 = \[[\s\S]*?\n  \];/, 'TEMPLATE_112'),
  potong(/const DIM_WAJAH_LEGACY = [\d.]+;/, 'DIM_WAJAH_LEGACY (onnx)'),
  potong(/const DIM_WAJAH_MEDIAPIPE = [\d.]+;/, 'DIM_WAJAH_MEDIAPIPE (onnx)'),
  potong(/function iouKotak\(a, b\) \{[\s\S]*?\n  \}/, 'iouKotak'),
  potong(/function nmsKandidat\(kandidat, ambangIou\) \{[\s\S]*?\n  \}/, 'nmsKandidat'),
  potong(/function bacaKeluaranYuNet\([\s\S]*?\n  \}/, 'bacaKeluaranYuNet'),
  potong(/function urutkanXDua\(a, b\) \{[\s\S]*?\n  \}/, 'urutkanXDua'),
  potong(/function matriksAffine3\(asal, tujuan\) \{[\s\S]*?\n  \}/, 'matriksAffine3'),
  potong(/function matriksAlin112\(kps\) \{[\s\S]*?\n  \}/, 'matriksAlin112'),
  potong(/function kemiripanKosinus\(a, b\) \{[\s\S]*?\n  \}/, 'kemiripanKosinus'),
  potong(/function normalisasiDescriptorWajah\(d, dim\) \{[\s\S]*?\n  \}/, 'normalisasiDescriptorWajah (onnx)'),
  potong(/let motorPaksa = null;/, 'motorPaksa (onnx)'),
  potong(/function motorWajah\(\) \{[\s\S]*?\n  \}/, 'motorWajah (onnx)'),
  potong(/function motorAktif\(\) \{[\s\S]*?\n  \}/, 'motorAktif (onnx)'),
  potong(/function dimWajahMotor\(\) \{[\s\S]*?\n  \}/, 'dimWajahMotor (onnx)'),
  potong(/function ambangCocok\(\) \{[\s\S]*?\n  \}/, 'ambangCocok (onnx)'),
  potong(/function buatMatcherKosinus\([\s\S]*?\n  \}/, 'buatMatcherKosinus'),
  'const JARAK_COCOK = 0.5;',
  'const JARAK_COCOK_MP = 0.8;',
  'let mpDimensiWajah = 0;'
].join('\n');

const onnx = new Function(
  'localStorage',
  kodeOnnx + '\nreturn { bacaKeluaranYuNet, nmsKandidat, iouKotak, matriksAffine3, matriksAlin112,'
  + ' kemiripanKosinus, buatMatcherKosinus, motorWajah, dimWajahMotor, ambangCocok,'
  + ' JARAK_COCOK_ONNX, JARAK_KENAL_ONNX, MARGIN_TOP2, YUNET_UKURAN, YUNET_AMBANG_SKOR, TEMPLATE_112 };'
)(localStoragePalsu);

const dekat6 = (a, b) => Math.abs(a - b) < 1e-6;
const fxAf = (m, p) => m.a * p.x + m.c * p.y + m.e;
const fyAf = (m, p) => m.b * p.x + m.d * p.y + m.f;
const vEkor = (i, n) => { const a = new Float32Array(n || 8); a[i] = 1; return a; };

// --- 6a. Dekode keluaran YuNet (rumus SAMA dengan OpenCV FaceDetectorYN) ---
function tensorYu(idx, opt) {
  const o = opt || {};
  const n = 16; // grid 4×4 untuk input 32×32 stride 8
  const cls = new Float32Array(n), obj = new Float32Array(n);
  const bbox = new Float32Array(n * 4), kps = new Float32Array(n * 10);
  cls[idx] = (o.cls === undefined) ? 0.81 : o.cls;
  obj[idx] = (o.obj === undefined) ? 1 : o.obj;
  bbox[idx * 4 + 0] = o.dx === undefined ? 0 : o.dx;
  bbox[idx * 4 + 1] = o.dy === undefined ? 0 : o.dy;
  bbox[idx * 4 + 2] = o.dw === undefined ? 0 : o.dw;
  bbox[idx * 4 + 3] = o.dh === undefined ? 0 : o.dh;
  for (let k = 0; k < 5; k++) {
    kps[idx * 10 + 2 * k] = o.kx === undefined ? 0 : o.kx;
    kps[idx * 10 + 2 * k + 1] = o.ky === undefined ? 0 : o.ky;
  }
  return { cls_8: { data: cls }, obj_8: { data: obj }, bbox_8: { data: bbox }, kps_8: { data: kps } };
}

const kel = onnx.bacaKeluaranYuNet(tensorYu(5, { kx: 0.5 }), 32, 32, 0.6, [8]);
cek('YuNet: satu kandidat di grid 4×4', kel.length === 1, kel.length);
cek('YuNet: skor = √(cls·obj) = 0,9', kel[0] && dekat6(kel[0].detection.score, 0.9), kel[0] && kel[0].detection.score);
cek('YuNet: kotak (r=1,c=1) → x=y=4, 8×8', !!kel[0]
  && dekat6(kel[0].detection.box.x, 4) && dekat6(kel[0].detection.box.y, 4)
  && dekat6(kel[0].detection.box.width, 8) && dekat6(kel[0].detection.box.height, 8),
  kel[0] && JSON.stringify(kel[0].detection.box));
cek('YuNet: 5 titik memakai kolom+offset (kx 0,5 → x=12, y=8)',
  !!kel[0] && dekat6(kel[0].kps[0].x, 12) && dekat6(kel[0].kps[0].y, 8),
  kel[0] && JSON.stringify(kel[0].kps[0]));
cek('YuNet: kotak memakai e^(dw)·stride (dw=ln 2 → 16 px)',
  dekat6(onnx.bacaKeluaranYuNet(tensorYu(5, { dw: Math.log(2) }), 32, 32, 0.6, [8])[0].detection.box.width, 16));
cek('YuNet: ambang memfilter kandidat lemah',
  onnx.bacaKeluaranYuNet(tensorYu(5, { cls: 0.25 }), 32, 32, 0.6, [8]).length === 0);
cek('YuNet: skor di-clamp (cls 2 → 1)',
  dekat6(onnx.bacaKeluaranYuNet(tensorYu(5, { cls: 2 }), 32, 32, 0.6, [8])[0].detection.score, 1));
cek('YuNet: keluaran kosong aman', onnx.bacaKeluaranYuNet(null, 32, 32).length === 0);

// --- 6b. IoU + NMS ---
cek('iou kotak identik = 1', dekat6(onnx.iouKotak({ x: 0, y: 0, width: 2, height: 2 }, { x: 0, y: 0, width: 2, height: 2 }), 1));
cek('iou kotak terpisah = 0', onnx.iouKotak({ x: 0, y: 0, width: 2, height: 2 }, { x: 5, y: 5, width: 2, height: 2 }) === 0);
cek('iou bertumpuk separuh = 1/7',
  dekat6(onnx.iouKotak({ x: 0, y: 0, width: 2, height: 2 }, { x: 1, y: 1, width: 2, height: 2 }), 1 / 7));
const nmsUji = onnx.nmsKandidat([
  { detection: { box: { x: 0, y: 0, width: 10, height: 10 }, score: 0.8 }, kps: [] },
  { detection: { box: { x: 1, y: 1, width: 10, height: 10 }, score: 0.9 }, kps: [] },
  { detection: { box: { x: 50, y: 50, width: 10, height: 10 }, score: 0.7 }, kps: [] }
], 0.35);
cek('NMS membuang duplikat, menyimpan yang berjauhan', nmsUji.length === 2, nmsUji.length);
cek('NMS mempertahankan skor tertinggi lebih dulu', nmsUji[0].detection.score === 0.9);

// --- 6c. Matriks affine 3 titik ---
const aff = onnx.matriksAffine3(
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
  [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 3 }]
);
cek('affine: skala x = 2', !!aff && dekat6(aff.a, 2));
cek('affine: skala y = 3', !!aff && dekat6(aff.d, 3));
cek('affine: tanpa rotasi/geser', !!aff && dekat6(aff.b, 0) && dekat6(aff.c, 0) && dekat6(aff.e, 0) && dekat6(aff.f, 0));
cek('affine: titik (1,1) → (2,3)', !!aff && dekat6(fxAf(aff, { x: 1, y: 1 }), 2) && dekat6(fyAf(aff, { x: 1, y: 1 }), 3));
cek('affine: titik segaris → null',
  onnx.matriksAffine3([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }], [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]) === null);
cek('affine: titik kurang → null',
  onnx.matriksAffine3([{ x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]) === null);

// --- 6d. Align 5 titik → template 112×112 ---
const tpl = onnx.TEMPLATE_112;
const kpsSumber = tpl.map((p) => ({ x: p[0] * 2 + 100, y: p[1] * 2 + 50 }));
const mAlin = onnx.matriksAlin112(kpsSumber);
let galatAlin = 0;
for (let i = 0; i < 5; i++) {
  galatAlin = Math.max(galatAlin, Math.abs(fxAf(mAlin, kpsSumber[i]) - tpl[i][0]), Math.abs(fyAf(mAlin, kpsSumber[i]) - tpl[i][1]));
}
cek('align: 5 titik sumber → template 112 tepat (round-trip)', !!mAlin && galatAlin < 1e-6, galatAlin);
const mTukar = onnx.matriksAlin112([kpsSumber[1], kpsSumber[0], kpsSumber[2], kpsSumber[4], kpsSumber[3]]);
cek('align: urutan mata/mulut tidak berpengaruh',
  !!mTukar && dekat6(mTukar.a, mAlin.a) && dekat6(mTukar.e, mAlin.e) && dekat6(mTukar.f, mAlin.f));
cek('align: mata berimpit (span 0) → null',
  onnx.matriksAlin112([{ x: 10, y: 10 }, { x: 10, y: 10 }, { x: 12, y: 14 }, { x: 8, y: 20 }, { x: 16, y: 20 }]) === null);
cek('align: hanya 4 titik → null', onnx.matriksAlin112(tpl.map((p) => ({ x: p[0], y: p[1] })).slice(0, 4)) === null);

// --- 6e. Kemiripan kosinus ---
cek('kosinus vektor sama = 1', dekat6(onnx.kemiripanKosinus(vEkor(0), vEkor(0)), 1));
cek('kosinus vektor tegak lurus = 0', dekat6(onnx.kemiripanKosinus(vEkor(0), vEkor(1)), 0));
const vNeg = vEkor(0); vNeg[0] = -1;
cek('kosinus vektor berlawanan = −1', dekat6(onnx.kemiripanKosinus(vEkor(0), vNeg), -1));
const vBesar = vEkor(0); vBesar[0] = 2;
cek('kosinus tak bergantung skala (2×) = 1', dekat6(onnx.kemiripanKosinus(vEkor(0), vBesar), 1));
cek('kosinus panjang beda = 0', onnx.kemiripanKosinus(new Float32Array(4), new Float32Array(8)) === 0);
cek('kosinus vektor nol = 0', onnx.kemiripanKosinus(new Float32Array(8), new Float32Array(8)) === 0);

// --- 6f. Matcher kosinus + margin top-2 ---
// Mesin diset ke onnx dulu: dimensi efektif 512 (sama dengan data MobileFaceNet).
simpan.clear();
simpan.set('sbg_wajah_motor', 'onnx');
const petaUji = {
  '101': { descriptor: [Array.from(vEkor(0, 512))] },
  '102': { descriptor: [Array.from(vEkor(1, 512))] }
};
const matKos = onnx.buatMatcherKosinus(petaUji);
cek('matcher kosinus dibuat (penanda kosinus)', !!matKos && matKos.kosinus === true);
const b1 = matKos.findBestMatch(vEkor(0, 512));
cek('cocok kosinus: label benar', b1.label === '101', b1.label);
cek('cocok kosinus: kemiripan 1 → jarak 0', dekat6(b1.distance, 0) && dekat6(b1.similarity, 1));
cek('cocok kosinus: margin besar (tidak ambigu)', b1.margin > onnx.MARGIN_TOP2, b1.margin);
const vAmbigu = new Float32Array(512); vAmbigu[0] = 1; vAmbigu[1] = 1;
const b2 = matKos.findBestMatch(vAmbigu);
cek('ambigu (dua murid sama-sama mirip) → unknown', b2.label === 'unknown', b2.label + ' m=' + b2.margin);
cek('ambigu: margin di bawah ambang', b2.margin < onnx.MARGIN_TOP2, b2.margin);
const b3 = matKos.findBestMatch(vEkor(7, 512));
cek('kemiripan 0 → unknown', b3.label === 'unknown' && dekat6(b3.distance, 1));
const m1 = onnx.buatMatcherKosinus({ '201': { descriptor: [Array.from(vEkor(0, 512))] } });
const vLirih = new Float32Array(512); vLirih[0] = 0.5; vLirih[5] = 1; // cos ≈ 0,447
const h1 = m1.findBestMatch(vLirih);
cek('satu label: kemiripan 0,447 masih dikenal (≥ 0,30)', h1.label === '201', h1.similarity);
cek('matcher kosinus tanpa data → null', onnx.buatMatcherKosinus({}) === null);
cek('matcher kosinus mengabaikan vektor dimensi lain (128)',
  onnx.buatMatcherKosinus({ '301': { descriptor: [Array.from(vEkor(0, 128))] } }) === null);

// --- 6g. Konfigurasi mesin onnx (dimensi + ambang) ---
simpan.clear();
simpan.set('sbg_wajah_motor', 'onnx');
cek('motorWajah onnx = onnx', onnx.motorWajah() === 'onnx');
cek('dimWajahMotor onnx = 512', onnx.dimWajahMotor() === 512);
cek('ambang "Hadir" onnx = JARAK_COCOK_ONNX', dekat6(onnx.ambangCocok(), onnx.JARAK_COCOK_ONNX), onnx.ambangCocok());
cek('JARAK_COCOK_ONNX = 1 − 0,45 (kemiripan Hadir 45%)', dekat6(onnx.JARAK_COCOK_ONNX, 0.55), onnx.JARAK_COCOK_ONNX);
cek('ambang kenal onnx lebih longgar dari ambang cocok', onnx.JARAK_KENAL_ONNX > onnx.JARAK_COCOK_ONNX);
simpan.set('sbg_wajah_ambang', '0.60');
cek('kalibrasi perangkat tetap berlaku di motor onnx', dekat6(onnx.ambangCocok(), 0.6), onnx.ambangCocok());
simpan.clear();
cek('input YuNet tetap 640×640 (model 2023mar)', onnx.YUNET_UKURAN === 640);

// --- 6h. Gerbang pose dari 5 titik YuNet ---
function titik5(noseX, opt) {
  const o = opt || {};
  return [
    { x: o.kx1 === undefined ? 200 : o.kx1, y: 100 },
    { x: o.kx2 === undefined ? 400 : o.kx2, y: 100 },
    { x: noseX, y: 160 },
    { x: 230, y: 210 }, { x: 370, y: 210 }
  ];
}
const pose5 = akurasi.deteksiPoseDepan(titik5(300), boxWajah, 640, 480);
cek('pose 5 titik: frontal diterima', !!pose5 && pose5.depan === true, pose5 && pose5.yaw);
const pose5Noleh = akurasi.deteksiPoseDepan(titik5(380), boxWajah, 640, 480);
cek('pose 5 titik: menoleh ditolak', pose5Noleh.depan === false && pose5Noleh.yaw > akurasi.YAW_MAKS, pose5Noleh.yaw);
cek('pose 5 titik: mata berimpit → null',
  akurasi.deteksiPoseDepan(titik5(300, { kx1: 300, kx2: 300 }), boxWajah, 640, 480) === null);
cek('pose 5 titik: wajah kecil ditolak',
  akurasi.deteksiPoseDepan(titik5(300), { x: 150, y: 60, width: 100, height: 80 }, 640, 480).depan === false);
cek('pose 4 titik → null (landmark kurang)',
  akurasi.deteksiPoseDepan(titik5(300).slice(0, 4), boxWajah, 640, 480) === null);

// --- 6i. Pemeriksaan struktural jalur onnx + perbaikan bug crop ---
cek('deteksiSatuWajah memakai jalur onnx', /motorAktif\(\) === 'onnx'[\s\S]{0,120}?pastikanModelsOnnx\(\)/.test(SUMBER));
cek('loop pindai memakai detektiWajahYuNet', /deteksi = \(mesinLoop === 'onnx'\)[\s\S]{0,140}?detektiWajahYuNet/.test(SUMBER));
cek('matcher onnx memakai kosinus+margin', /motorAktif\(\) === 'onnx'\) return buatMatcherKosinus\(peta\)/.test(SUMBER));
cek('descriptor onnx memakai transform affine align', /ctx\.setTransform\(m\.a, m\.b, m\.c, m\.d, m\.e, m\.f\)/.test(SUMBER));
cek('input YuNet dibangun sebagai BGR nilai 0..255',
  /inp\[p\] = px\[q \+ 2\];[\s\S]{0,120}?inp\[N \+ p\] = px\[q \+ 1\];[\s\S]{0,80}?inp\[2 \* N \+ p\] = px\[q\];/.test(SUMBER));
cek('model YuNet dimuat dari folder lokal models/', /face_detection_yunet_2023mar\.onnx/.test(SUMBER));
cek('prewarm idle menyertakan motor onnx', /motorWajah\(\) === 'onnx'\) \{\s*\n\s*pastikanModelsOnnx\(\)/.test(SUMBER));
cek('YuNet memakai 2 skala kandidat (selfie dekat)', /YUNET_SKALA_KANDIDAT = \[1, 0\.5\]/.test(SUMBER));
cek('overlay menggambar rangka 5 titik', /positions\.length === 5\) \{[\s\S]{0,400}?ctx\.lineTo/.test(SUMBER));
cek('loop ringan registrasi memakai YuNet',
  /motorLoop === 'onnx'\) d = await detektiWajahYuNet\(videoEl, \{\}\)/.test(SUMBER));
// Bug crop lama (argumen drawImage tertukar) — descriptor dihitung dari citra kosong.
cek('crop mediapipe memakai urutan argumen drawImage yang benar',
  /drawImage\(el, b\.x, b\.y, cw, ch, 0, 0, 112, 112\)/.test(SUMBER));
cek('snapshot mediapipe juga diperbaiki', /drawImage\(el, box\.x, box\.y, cw, ch, 0, 0, S, S\)/.test(SUMBER));
cek('tidak ada lagi crop pojok-kiri 112×112 / S×S',
  !/drawImage\(el, 0, 0, 112, 112/.test(SUMBER) && !/drawImage\(el, 0, 0, S, S/.test(SUMBER));
cek('skala snapshot → 112 memakai dimensi gambar sumber',
  /drawImage\(tmp, 0, 0, tmp\.width, tmp\.height, 0, 0, 112, 112\)/.test(SUMBER));

// ---------------------------------------------------------------------------
console.log(lulus + ' lulus, ' + gagal + ' gagal.');
if (gagal) process.exitCode = 1;


