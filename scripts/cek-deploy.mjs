#!/usr/bin/env node
// ============================================================
// SISIP CEK DEPLOY — penjaga DRIFT build antar-host
//
// LATAR BELAKANG
//   Aplikasi ini disajikan dari BEBERAPA host sekaligus (GitHub Pages, mirror
//   Vercel, custom domain mis. `.my.id`). Semuanya membaca folder `web/` yang
//   sama, tetapi tiap host punya waktu deploy sendiri. Bila satu host tertinggal
//   (kasus nyata: Vercel menyajikan build `20261029a` sementara Pages
//   `20261029b`), fitur yang bergantung pada berkas baru mati di host itu —
//   gejalanya "Absen Mandiri murid kosong / tidak ada sesi" padahal server benar.
//   Selain itu service worker (`sw.js`) menyimpan cache per-VERSION, sehingga
//   host yang tertinggal juga menyajikan `js/app.js` lama dari cache-nya.
//
// MEMERIKSA (per host, tanpa menulis apa pun ke server)
//   1. `index.html`  → `<meta name="sisip-build">` harus = build lokal.
//   2. `js/install.js` → `const BUILD` harus = build lokal (stempel device;
//      beda stempel memicu pembersihan cache `sisip-*` + reload sekali).
//   3. `sw.js`       → `const VERSION` harus = versi lokal, dan daftar PRECACHE
//      harus memuat `css/style.css?v=`, `js/utils.js?v=`, `js/app.js?v=` dengan
//      tag versi = build lokal.
//   4. `js/utils.js` → wajib memuat simbol Absen Mandiri murid
//      (`akunSesiAbsenMurid`, `ambil_sesi_absen_murid`) dan TIDAK boleh memuat
//      penanda template (`ISI SUPABASE URL INI`) — penanda ini tanda deploy
//      memakai `utils.example.js` (tanpa kredensial).
//   5. `js/app.js`   → wajib memuat penanda panel murid build terbaru
//      (`sebabSesiKosong`, `diLuarJam`) supaya sesi BUKA tidak lagi terkunci
//      di luar jam pelajaran.
//
// Cara menjalankan:
//   npm run check:deploy
//   node scripts/cek-deploy.mjs [--host nama1,nama2] [--tambah nama=https://host/]
//                               [--timeout 20000] [--json]
//
// Keluaran: tabel per host + ringkasan. Ada satu saja ✖ → exit code 1
//   (cocok dipakai di CI maupun sebagai gerbang sebelum rilis).
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const WEB = path.join(root, 'web');

const ambilOpsi = (nama, bawaan) => {
  const i = process.argv.indexOf(nama);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : bawaan;
};
const TIMEOUT_MS = parseInt(ambilOpsi('--timeout', '20000'), 10) || 20000;
const HANYA = ambilOpsi('--host', '').split(',').map((s) => s.trim()).filter(Boolean);
const KELUAR_JSON = process.argv.includes('--json');

const baca = (jalur) => fs.readFileSync(jalur, 'utf8');
/** Ambil grup pertama regex dari teks; '' bila tak ketemu. */
const ambil = (teks, re) => { const m = String(teks ?? '').match(re); return m ? m[1] : ''; };
const sha12 = (teks) => crypto.createHash('sha256').update(String(teks)).digest('hex').slice(0, 12);

// ============================================================
// 1. PATOKAN LOKAL (folder `web/` repo ini = sumber kebenaran)
// ============================================================
const idxLokal = baca(path.join(WEB, 'index.html'));
const BUILD = ambil(idxLokal, /<meta\s+name="sisip-build"\s+content="([^"]+)"/);
const BUILD_INSTALL = ambil(baca(path.join(WEB, 'js', 'install.js')), /const\s+BUILD\s*=\s*'([^']+)'/);
const SW_LOKAL = baca(path.join(WEB, 'sw.js'));
const SW_VERSION = ambil(SW_LOKAL, /const\s+VERSION\s*=\s*'([^']+)'/);
const APP_LOKAL = baca(path.join(WEB, 'js', 'app.js'));
const SHA_APP = sha12(APP_LOKAL);

/** Penanda yang WAJIB ada di berkas host (fitur Absen Mandiri murid). */
const WAJIB_UTILS = ['akunSesiAbsenMurid', 'ambil_sesi_absen_murid'];
const WAJIB_APP = ['sebabSesiKosong', 'diLuarJam'];
/** Penanda yang TIDAK boleh ada (template / build lama). */
const TERLARANG_UTILS = ['ISI SUPABASE URL INI'];

// ============================================================
// 2. DAFTAR HOST (scripts/deploy-urls.json + `--tambah`)
// ============================================================
const jalurDaftar = path.join(__dirname, 'deploy-urls.json');
let daftar = [];
if (fs.existsSync(jalurDaftar)) {
  try {
    const isi = JSON.parse(baca(jalurDaftar));
    daftar = Array.isArray(isi.hosts) ? isi.hosts.filter((h) => h && h.url) : [];
  } catch (e) {
    console.error('❌ scripts/deploy-urls.json tidak dapat dibaca:', e.message);
    process.exit(1);
  }
} else {
  console.warn('⚠  scripts/deploy-urls.json tidak ada — daftar host kosong (pakai `--tambah`).');
}
// `--tambah nama=https://host/` (boleh diulang, boleh dipisah `;`) menambah atau
// mengganti host tanpa mengubah berkas — untuk memeriksa domain baru secepatnya.
const tambahan = [ambilOpsi('--tambah', '')].concat(
  process.argv.filter((a) => a.indexOf('--tambah=') === 0).map((a) => a.slice('--tambah='.length))
).join(';');
for (const pasangan of tambahan.split(';')) {
  const pisah = pasangan.indexOf('=');
  if (pisah < 1) continue;
  const nama = pasangan.slice(0, pisah).trim();
  const url = pasangan.slice(pisah + 1).trim();
  if (!nama || !url) continue;
  daftar = daftar.filter((h) => String(h.nama) !== nama);
  daftar.push({ nama, url });
}
if (HANYA.length) daftar = daftar.filter((h) => HANYA.includes(String(h.nama)));

// Normalisasi: tanpa skema → https:// ; URL wajib diakhiri '/'.
daftar = daftar.map((h) => {
  let url = String(h.url).trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (!url.endsWith('/')) url += '/';
  return { nama: String(h.nama || url), url };
});

if (!daftar.length) {
  console.error('❌ Tidak ada host untuk diperiksa.');
  console.error('   Isi `scripts/deploy-urls.json` — contoh:');
  console.error('     { "nama": "domain-sekolah", "url": "https://sekolahku.my.id/" }');
  console.error('   atau jalankan sekali jalan:');
  console.error('     node scripts/cek-deploy.mjs --tambah sekolah=https://sekolahku.my.id/');
  process.exit(1);
}

// ============================================================
// 4. PATOKAN LOKAL WAJIB KONSISTEN (jaring sebelum menyalahkan host)
// ============================================================
const galatLokal = [];
if (!BUILD) galatLokal.push('web/index.html tidak memuat <meta name="sisip-build">');
else {
  if (BUILD_INSTALL !== BUILD) galatLokal.push(`web/js/install.js BUILD='${BUILD_INSTALL}' ≠ index.html '${BUILD}'`);
  if (!idxLokal.includes(`js/app.js?v=${BUILD}`)) galatLokal.push(`web/index.html belum memuat js/app.js?v=${BUILD}`);
  if (!SW_LOKAL.includes(`js/app.js?v=${BUILD}`)) galatLokal.push(`web/sw.js PRECACHE belum memuat js/app.js?v=${BUILD}`);
}
if (!SW_VERSION) galatLokal.push('web/sw.js tidak memuat `const VERSION`');
for (const s of WAJIB_APP) if (!APP_LOKAL.includes(s)) galatLokal.push(`web/js/app.js lokal tidak memuat penanda '${s}'`);

// ============================================================
// 5. PERIKSA SETIAP HOST
// ============================================================
const DIPERIKSA = ['index.html', 'sw.js', 'js/install.js', 'js/app.js', 'js/utils.js'];
/** Berkas PRECACHE yang tag versinya HARUS ikut naik bersama build. */
const PRECACHE_WAJIB = ['css/style.css', 'js/utils.js', 'js/app.js'];

async function periksaHost(h) {
  const masalah = [];
  const berkas = {};
  for (const nama of DIPERIKSA) {
    const r = await ambilBerkas(h.url + nama + penangkal, nama);
    berkas[nama] = r.ok ? r.teks : '';
    if (!r.ok) masalah.push(`${nama} tidak dapat diambil (${r.pesan})`);
  }

  // a) stempel build di index.html
  const buildHost = ambil(berkas['index.html'], /<meta\s+name="sisip-build"\s+content="([^"]+)"/);
  if (berkas['index.html'] && buildHost !== BUILD) {
    masalah.push(`index.html ${buildHost ? `build '${buildHost}'` : 'tanpa meta sisip-build'} ≠ lokal '${BUILD}'`);
  }

  // b) stempel build di js/install.js (memicu bersih-cache per perangkat)
  const buildInstall = ambil(berkas['js/install.js'], /const\s+BUILD\s*=\s*'([^']+)'/);
  if (berkas['js/install.js'] && buildInstall !== BUILD) {
    masalah.push(`js/install.js BUILD='${buildInstall || '(tak ada)'}' ≠ lokal '${BUILD}'`);
  }

  // c) service worker: versi cache + tag versi di PRECACHE
  const swHost = ambil(berkas['sw.js'], /const\s+VERSION\s*=\s*'([^']+)'/);
  if (berkas['sw.js']) {
    if (swHost !== SW_VERSION) masalah.push(`sw.js VERSION='${swHost || '(tak ada)'}' ≠ lokal '${SW_VERSION}'`);
    for (const p of PRECACHE_WAJIB) {
      if (!berkas['sw.js'].includes(`${p}?v=${BUILD}`)) masalah.push(`sw.js PRECACHE belum memuat ${p}?v=${BUILD}`);
    }
  }

  // d) js/utils.js: simbol Absen Mandiri murid + bukan template
  const kurangUtils = WAJIB_UTILS.filter((s) => berkas['js/utils.js'] && !berkas['js/utils.js'].includes(s));
  const templateTerpasang = TERLARANG_UTILS.filter((s) => berkas['js/utils.js'] && berkas['js/utils.js'].includes(s));
  for (const s of kurangUtils) masalah.push(`js/utils.js tidak memuat simbol '${s}' (RPC sesi absen murid belum ada → Absen Mandiri kosong)`);
  for (const s of templateTerpasang) masalah.push(`js/utils.js masih template ('${s}') — kredensial Supabase belum diisi`);

  // e) js/app.js: penanda panel murid terbaru
  const kurangApp = WAJIB_APP.filter((s) => berkas['js/app.js'] && !berkas['js/app.js'].includes(s));
  for (const s of kurangApp) masalah.push(`js/app.js tidak memuat penanda '${s}' (panel Absen Mandiri build lama)`);

  const appIdentik = !!berkas['js/app.js'] && sha12(berkas['js/app.js']) === SHA_APP;
  if (berkas['js/app.js'] && !appIdentik && !kurangApp.length) {
    masalah.push('js/app.js berbeda dari repo ini (hash ' + sha12(berkas['js/app.js']) + ' ≠ ' + SHA_APP + ') — build tidak identik');
  }

  return {
    nama: h.nama, url: h.url,
    build: buildHost || '(tak ada)',
    installBuild: buildInstall || '(tak ada)',
    sw: swHost || '(tak ada)',
    utilsOk: kurangUtils.length === 0 && templateTerpasang.length === 0,
    appOk: kurangApp.length === 0 && appIdentik,
    hash: berkas['js/app.js'] ? sha12(berkas['js/app.js']) : '(tak ada)',
    masalah
  };
}

// ============================================================
// 3. AMBIL BERKAS DARI HOST (baca-saja, dengan penangkal cache)
// ============================================================
const penangkal = '?cek=' + Date.now();
async function ambilBerkas(url, label) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store', redirect: 'follow' });
    if (!res.ok) return { ok: false, teks: '', pesan: 'HTTP ' + res.status };
    return { ok: true, teks: await res.text(), pesan: '' };
  } catch (e) {
    const sebab = (e && e.name === 'AbortError') ? ('timeout ' + TIMEOUT_MS + ' ms') : ((e && e.message) || String(e));
    return { ok: false, teks: '', pesan: label + ': ' + sebab };
  } finally {
    clearTimeout(t);
  }
}

// ============================================================
// 6. LAPORAN & EXIT CODE
// ============================================================
(async () => {
  console.log('SISIP CEK DEPLOY — drift build antar-host');
  console.log('Patokan lokal: build ' + (BUILD || '(tak ada)')
    + ' | sw ' + (SW_VERSION || '(tak ada)')
    + ' | js/app.js ' + SHA_APP + ' | host diperiksa: ' + daftar.length);
  if (galatLokal.length) {
    console.log('\n⚠  REPO INI SENDIRI BELUM KONSISTEN (selesaikan dulu sebelum menyalahkan host):');
    for (const g of galatLokal) console.log('   • ' + g);
  }

  const hasil = [];
  if (!KELUAR_JSON) console.log('\n  HOST               BUILD         SW     utils  app.js');
  for (const h of daftar) {
    const baris = await periksaHost(h);
    hasil.push(baris);
    if (!KELUAR_JSON) {
      const tanda = baris.masalah.length === 0 ? '✅' : '❌';
      console.log('  ' + tanda + ' ' + String(baris.nama).padEnd(17)
        + String(baris.build).padEnd(14) + String(baris.sw).padEnd(7)
        + (baris.utilsOk ? 'ok    ' : 'beda  ') + (baris.appOk ? 'ok' : 'beda'));
    }
  }

  const gagal = hasil.filter((b) => b.masalah.length);
  for (const b of gagal) {
    console.log('\n❌ ' + b.nama + ' — ' + b.url);
    console.log('   stempel: index.html=' + b.build + ' · install.js=' + b.installBuild
      + ' · sw.js=' + b.sw + ' · js/app.js=' + b.hash);
    for (const m of b.masalah) console.log('   • ' + m);
  }

  if (KELUAR_JSON) {
    console.log(JSON.stringify({
      patokan: { build: BUILD, buildInstall: BUILD_INSTALL, swVersion: SW_VERSION, appHash: SHA_APP, galatLokal },
      host: hasil
    }, null, 2));
  }

  console.log('\n' + '='.repeat(60));
  console.log('Host diperiksa: ' + hasil.length + ' | ✅ selaras: ' + (hasil.length - gagal.length)
    + ' | ❌ drift/gagal: ' + gagal.length + ' | ⚠ repo lokal: ' + galatLokal.length);
  if (gagal.length || galatLokal.length) {
    console.log('❌ Ada host yang menyajikan build BERBEDA dari repo ini (atau repo belum konsisten).');
    console.log('   Sinkronkan folder `web/` ke host yang tertinggal (README §7 — mirror Vercel),');
    console.log('   lalu jalankan ulang: npm run check:deploy');
    process.exit(1);
  }
  console.log('✅ Semua host menyajikan build yang SAMA dengan repo ini — Absen Mandiri murid konsisten.');
})();
