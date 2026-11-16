# Administrasi-Sekolah

**SISIP** — Sistem Informasi Sekolah Indonesia pintar

Aplikasi web statis (HTML + JS + Tailwind CSS v4) yang terhubung **langsung ke Supabase**
(PostgreSQL + RLS + RPC). Tidak ada backend terpisah — seluruh API memakai Supabase
PostgREST & fungsi RPC.

| Bagian | Lokasi | Keterangan |
|---|---|---|
| Frontend | `web/` | HTML + JS murni + Tailwind v4, `@supabase/supabase-js` via CDN |
| Database | `supabase/sql/` | Skema SQL + seluruh berkas upgrade; skema lengkap untuk project baru = `supabase/sql/gabungan.sql` (84 blok, dirakit otomatis oleh `npm run build:sql`) |
| Deploy | GitHub Pages (default) / Vercel (alternatif) | GitHub Pages: otomatis saat push ke `main` (workflow `.github/workflows/static.yml`, folder `web/`). Vercel: lihat [bagian 5](#5-deploy--vercel-alternatif) |

## Menjalankan Lokal

```bash
npm install            # pasang Tailwind CLI
npm run build:css      # kompilasi Tailwind -> web/css/style.css
npm run dev:css        # (opsional) mode watch saat develop

npx serve web          # buka aplikasi (atau server statis apa pun)
```

> Koneksi database bisa diarahkan ke project Supabase mana pun lewat panel
> **Konfigurasi Server** (ikon gear di kartu login) — lihat bagian
> [Menghubungkan Aplikasi ke Supabase](#3-menghubungkan-aplikasi-ke-supabase).

---

## 1. Tutorial Upload ke GitHub

Repo: <https://github.com/BrazaMuzti/Administrasi-Sekolah>

### a. Sekali saja — inisialisasi & koneksi remote

```bash
git init                       # bila belum jadi repo
git branch -M main             # pastikan nama cabang utama = main
git remote add origin https://github.com/BrazaMuzti/Administrasi-Sekolah.git
```

### b. Setiap kali selesai mengubah kode

```bash
git add .                      # atau pilih file tertentu: git add web/ supabase/
git commit -m "deskripsi perubahan"
git push origin main           # dorong ke GitHub
```

### c. Push pertama kali dari komputer baru

```bash
git clone https://github.com/BrazaMuzti/Administrasi-Sekolah.git
cd Administrasi-Sekolah
npm install
```

> **Autentikasi push:** GitHub tidak lagi menerima password. Gunakan
> **Personal Access Token** (Settings → Developer settings → PAT) sebagai pengganti
> password, atau login via `gh auth login` (GitHub CLI), atau SSH key.

Setelah push ke `main`, **GitHub Pages otomatis ter-deploy** (lihat bagian
[Deploy](#4-deploy--github-pages-otomatis)) — cek tab **Actions** di repo untuk progres.

---

## 2. Tutorial Upload SQL ke Supabase

### a. Buat project Supabase (sekali saja)

1. Login ke <https://supabase.com> → **New project**.
2. Isi nama (mis. `siakad`), password database (SIMPAN — tidak bisa dilihat lagi),
   region terdekat (mis. Singapore) → **Create new project**.
3. Tunggu ± 2 menit sampai project aktif.

### b. Jalankan skema database

1. Menu kiri: **SQL Editor** → **New query**.
2. Pilih file SQL sesuai kondisi database:

| Kondisi | File yang dijalankan |
|---|---|
| **Project baru / kosong** | `supabase/sql/gabungan.sql` — gabungan seluruh **84 berkas upgrade** (2026-09-03 s.d. 2026-10-31), sekali jalan |
| **Project sudah berjalan**, tertinggal beberapa upgrade | file satu-persatu di `supabase/sql/`, **urut tanggal**, hanya yang belum ada di database |

3. Salin seluruh isi file ke SQL Editor (atau pakai tombol **upload** file `.sql`)
   → klik **Run** (`Ctrl+Enter`).
4. Verifikasi: buka **Table Editor** — semua tabel & kolom harus sudah muncul
   (`akun`, `master_data`, `absensi`, `nilai`, `ekstrakurikuler`, dst.).

> Semua file SQL **idempotent** (aman dijalankan berulang). Daftar lengkap isi &
> urutan 84 berkas ada di `supabase/sql/README.md`. `gabungan.sql` **dirakit otomatis**
> (`npm run build:sql`) — jangan diedit manual; `npm run check:sql` akan gagal bila basi.
> File `uji_data.sql` / `uji_bersih.sql` khusus pengujian E2E — jangan dijalankan di produksi.

---

## 3. Menghubungkan Aplikasi ke Supabase

Aplikasi butuh dua kredensial dari project Supabase:

1. Buka dashboard Supabase → **Project Settings** (ikon gear) → **API** (atau **Data API**).
2. Salin:
   - **Project URL** — bentuk `https://xxxxxxxx.supabase.co`
   - **Publishable / anon key** — kunci publik (`sb_publishable_...` atau `eyJ...`)

### a. Cara bawaan (default tertanam)

Nilai default sudah tertanam di `web/js/utils.js`:

```js
const SUPABASE_URL_DEFAULT = 'https://xxxxxxxx.supabase.co';
const SUPABASE_ANON_KEY_DEFAULT = 'sb_publishable_...';
```

Ganti dua baris ini **sebelum deploy** bila memakai project Supabase lain.

### b. Override tanpa ubah kode (per browser)

Di kartu login, klik **ikon gear** (kanan atas) → modal **Konfigurasi Server**:

- **URL**: `https://xxxxxxxx.supabase.co`
- **Anon key**: `sb_publishable_...` / `eyJ...`
- (Opsional) **Client ID Google** untuk fitur sinkron Google Calendar.

Simpan → tersimpan di `localStorage` browser tersebut, langsung terpakai tanpa reload.

### c. Aktifkan penyedia login (OAuth)

Bila memakai login Google/GitHub:

1. Supabase → **Authentication → Sign In / Providers**.
2. Aktifkan provider (Google / GitHub), isi Client ID & Secret dari
   Google Cloud Console / GitHub OAuth App.
3. Tambahkan domain Pages ke **Authentication → URL Configuration → Redirect URLs**,
   mis. `https://brazamuzti.github.io/Administrasi-Sekolah/**`.

### Catatan keamanan

Anon/publishable key memang **publik** — keamanan data dijaga oleh **Row Level
Security (RLS)** dan RPC yang sudah dikonfigurasi di file SQL. Jangan pernah
menaruh `service_role key` di kode frontend.

#### Fase B — sesi murid di server + RLS ketat pada tabel `akun`

Sejak upgrade `20261028a`–`fix_20261029` (lihat `supabase/sql/README.md` entri 69–74):

- **Tabel `akun` ber-RLS ketat** dan `anon` tidak punya hak apa pun atas tabel
  itu; seluruh baca/tulis dari browser lewat RPC `SECURITY DEFINER`
  (`ambil_daftar_murid`, `ambil_akun_satu`, `simpan_riwayat_murid`, dst.).
- **Sesi murid memakai token dari server** (`sesi_lokal`, SHA-256, masa 12 jam
  dengan perpanjangan otomatis). Token diterbitkan `cek_login_murid` dan wajib
  dikirim sebagai `p_token` pada RPC murid; logout mencabutnya
  (`logout_sesi`). NIS yang dikirim klien **tidak lagi** dianggap bukti
  identitas setelah `fix_20261028d_sesi_wajib.sql`.
- **Kontrak argumen RPC berbeda per fase** — jangan tertukar: RPC baca
  (`ambil_daftar_murid`, `ambil_akun_satu`, `ambil_peta_wajah`,
  `cek_sesi_absen`, `ambil_sesi_absen_murid`, `simpan_riwayat_murid`,
  `simpan_ekskul_murid`) menerima
  `p_token` + `p_klaim_nis` (helper `sesiRpc()`), sedangkan RPC penulis Fase B2
  (`ubah_profil_murid`, `ubah_password_sendiri`, `simpan_wajah_murid`,
  `ubah_anggota_ekskul`, `ganti_kunci_absen_ekskul`) **hanya** `p_token`.
  Mengirim argumen yang tidak dideklarasikan fungsi membuat PostgREST
  membalas **PGRST202** ("Could not find the function … in the schema cache").
  Jalankan `npm run test:rpc-args` setiap kali menyentuh nama argumen RPC —
  skrip ini membandingkan 66 titik panggilan RPC di frontend dengan signature
  di `supabase/sql/*.sql` (plus self-test yang membuktikan detektornya bekerja).
- **Urutan deploy wajib:** (1) jalankan `20261028a` → `20261028b` → `20261028b2`
  di Supabase, (2) deploy frontend (`js/app.js?v=20261031b` — tag terbaru saat
  dokumen ini diperbarui), (3) baru jalankan
  `20261028c` (RLS ketat) dan `fix_20261028d` (sesi wajib). Untuk perbaikan
  menu murid **Absen Mandiri**, jalankan `fix_20261029_murid_kanal_absen.sql`
  **sebelum** frontend `?v=20261030a` ter-deploy — RPC `ambil_sesi_absen_murid`
  wajib sudah ada di database, kalau tidak panel murid tetap kosong. Rollback
  RLS cukup
  satu perintah: `alter table akun disable row level security;`.
  Pastikan `npm run test:rpc-args` hijau sebelum deploy frontend, lalu naikkan
  tag `?v=` di `web/index.html` setiap kali `app.js`/`utils.js`/`face.js`
  berubah (tag `20261028f` = perbaikan argumen RPC + tombol "Simpan Perubahan"
  di Data Akun Murid yang dulu gagal dengan PGRST202, ditambah **tombol
  "Install Aplikasi"** PWA & service worker `sw.js`). Tag `20261030a`
  = **Absen Mandiri murid tahan beda host**: panel murid membaca sesi lewat RPC
  `ambil_sesi_absen_murid` (entri 74), pesan kosong kini mendiagnosis sebabnya
  (sesi memang belum dibuka / token murid basi — lengkap dengan tombol keluar /
  RPC belum terpasang / gagal jaringan), sesi ber-`kunci_absen='BUKA'` tetap
  dapat diabsen **di luar jam pelajaran** (server memang hanya memeriksa
  `kunci_absen`, captcha/wajah, dan mapel — tidak memeriksa jam), dan opsi
  Mapel/Ekstrakurikuler punya cadangan bila sesi terbuka tidak ada di jadwal
  kelas; `VERSION` di `web/sw.js` naik ke `v5` dan stempel
  `BUILD` di `web/js/install.js` ikut bernilai `20261030a`. Setelah deploy,
  **jalankan `npm run check:deploy`** — skrip ini membandingkan stempel build +
  hash berkas tiap host dan gagal bila ada host yang tertinggal (§7 butir 8).
- **Akses admin di menu Data Akun Murid (sejak `20261031a`, ikut di build `20261031b`):** dua aksi admin
  — tombol **"Wajah Masal"** (RPC `simpan_wajah_murid`) dan tombol **"Simpan Data"**
  pada form Edit/Tambah (RPC `buat_akun_murid`) — kini dijaga di **kedua sisi**.
  Klien memakai helper bernama `aksesRegistrasiWajahMasal()` &
  `aksesSimpanDataAkunMurid(data, isNew)` (sembunyi-tombol + penjaga lapis kedua),
  sedangkan server dirapikan oleh
  `supabase/sql/upgrade_20261031_akses_admin_akun_murid.sql`: `fn_role()`/`fn_nis()`
  jadi deterministik **admin-first**, `fn_is_admin()` berbasis `exists`, plus
  backfill `akun.user_id` untuk baris admin/guru yang belum tertaut ke akun login.
  ⚠ **Jalankan SQL itu sebelum frontend build `20261031b` ter-deploy** — tanpa itu
  admin tetap bisa ditolak server. Riwayat: perubahan ini mula-mula naik di
  `20261031a` (`VERSION` SW `v6`); build `20261031b` menaikkan `VERSION` ke `v7`
  dan `BUILD` di `web/js/install.js` ke `20261031b` (lihat §7b). Build
  `20261031c` (`VERSION` SW `v8`) menambah akurasi Absen Mandiri (§7c) dan
  mewajibkan `supabase/sql/fix_20261031b_peta_wajah_murid.sql` agar murid
  ber-JWT Auth bisa membaca descriptor wajahnya sendiri. Build `20261031d`
  (`VERSION` SW `v9`) menambahkan **lapisan kamera universal** (§7d): pemilih
  kamera (depan/belakang/semua perangkat), ingatan kamera terakhir, dan fallback
  **Ambil Selfie / Verifikasi dari Foto** ketika kamera tidak bisa dipakai.

---

## 4. Deploy — GitHub Pages (Otomatis)

Deploy frontend tidak butuh perintah apa pun:

1. `git push origin main` → workflow **Deploy static content to Pages** berjalan otomatis
   (cek tab **Actions** di repo).
2. Aplikasi terbit di:
   `https://brazamuzti.github.io/Administrasi-Sekolah/`
3. Workflow mem-publish folder **`web/`** apa adanya — jadi pastikan `web/css/style.css`
   hasil `npm run build:css` sudah ter-commit setiap kali kelas utilitas Tailwind berubah.
4. Deploy ulang manual: repo → **Actions** → pilih workflow → **Run workflow**.

## 5. Deploy — Vercel (Alternatif)

Selain GitHub Pages, aplikasi ini juga bisa di-deploy ke **Vercel**. Repo sudah
menyertakan `vercel.json` dan `scripts/generate-utils.mjs` yang meng-generate
`web/js/utils.js` (di-gitignore) dari template `web/js/utils.example.js` +
Environment Variables saat build — jadi kredensial Supabase tidak perlu
di-commit ke repo.

### a. Import project

1. Login ke <https://vercel.com> → **Add New… → Project**.
2. Pilih **Import Git Repository** → hubungkan akun GitHub bila belum →
   pilih repo `BrazaMuzti/Administrasi-Sekolah`.
3. Pada layar konfigurasi:
   - **Framework Preset**: `Other` (situs statis biasa).
   - **Build Command**: `npm run build:css && node scripts/generate-utils.mjs`
     (sudah otomatis terbaca dari `vercel.json`, tidak perlu diisi manual).
   - **Output Directory**: `web` (juga sudah otomatis dari `vercel.json`).

### b. Set Environment Variables

Di layar yang sama (atau di **Project Settings → Environment Variables**
setelah project dibuat), tambahkan:

| Key | Value | Environment |
|---|---|---|
| `SUPABASE_URL` | `https://xxxxxxxx.supabase.co` (Project URL Supabase) | Production, Preview, Development |
| `SUPABASE_ANON_KEY` | `sb_publishable_...` / `eyJ...` (Publishable/anon key) | Production, Preview, Development |

> Tanpa kedua variabel ini, build **akan gagal** — `scripts/generate-utils.mjs`
> sengaja keluar dengan error jelas bila salah satu kosong, supaya deploy tidak
> pernah menghasilkan `utils.js` yang rusak/kosong.

### c. Deploy

1. Klik **Deploy** → tunggu build selesai.
2. Aplikasi terbit di URL bawaan Vercel, mis. `https://administrasi-sekolah.vercel.app`
   (bisa diganti custom domain di **Project Settings → Domains**).
3. Deploy ulang otomatis setiap `git push` ke branch yang di-tracking Vercel
   (default `main`); Preview Deployment otomatis dibuat untuk branch/PR lain.
4. Deploy manual via CLI (opsional):
   ```bash
   npm i -g vercel        # sekali saja
   vercel login
   vercel --prod          # deploy ke production
   ```

## 6. Fitur Foto Siswa, Media Sosial & Alamat Maps (Data Akun Murid)

Data Akun Murid kini mendukung **foto siswa di Google Drive** (integrasi via Service Account +
Google Drive API v3 langsung dari Edge Function — *bukan* GAS Web App, yang terbukti menolak
DriveApp untuk pemanggil anonim), **media sosial** (jsonb), **alamat Google Maps** (tautan,
dibuka tab baru — iframe tidak dipasang karena kebijakan CSP `frame-ancestors`), **dropdown
agama** pada profil murid, **tampilan jabatan ekstrakurikuler**, dan **cetak lembar foto siswa**.

### Hak akses dua aksi admin (build `20261031a`)

| Aksi di menu Data Akun Murid | RPC server | Siapa yang boleh |
|---|---|---|
| Tombol **Wajah Masal** (`scanWajahMasal()`) | `simpan_wajah_murid` | admin, guru wali kelas/pembina ekskul (murid: hanya wajahnya sendiri, bukan alur masal) |
| Tombol **Simpan Data** pada form Edit/Tambah (`simpanAkunMurid()`) | `buat_akun_murid` | admin (tambah & edit, termasuk password), guru (edit murid yang diampu, tanpa ubah password) |

Klien memakai helper bernama `aksesRegistrasiWajahMasal()` & `aksesSimpanDataAkunMurid(data, isNew)`
di `web/js/app.js` untuk menyembunyikan tombol **dan** menolak aksi di lapis kedua. Server
menjaminnya lewat `supabase/sql/upgrade_20261031_akses_admin_akun_murid.sql`
(`fn_role`/`fn_nis` deterministik admin-first, `fn_is_admin` berbasis `exists`, backfill
`akun.user_id`). Bila admin masih ditolak: cek `select nis_nip, tipe, user_id, email from akun
where tipe = 'admin';` — baris admin harus `user_id` terisi (login sekali di aplikasi, atau
jalankan file SQL di atas dan baca pesan `raise notice`/`raise warning`-nya).

### Persyaratan (sekali saja)

1. **Database** — jalankan `supabase/sql/upgrade_20261011_akun_murid_foto_medsos.sql`
   di Supabase SQL Editor (kolom `url_foto`, `alamat_maps`, `media_sosial` + RPC
   `simpan_foto_murid`).
2. **Service Account Google** — ikuti panduan `supabase/functions/unggah-foto-murid/README.md`:
   buat service account di project GCP `sisip-510803` (kunci JSON), **pindahkan folder**
   **"Foto Siswa"** ke **Google Shared Drive** (gunakan ID folder Anda sendiri — potongan
   33 karakter di URL Drive setelah `/folders/`, **jangan commit nilai asli** ke repo) dan
   bagikan shared drive ke email SA sebagai **Content manager**, pastikan **Google Drive API**
   enabled. ⚠️ SA **tidak punya kuota My Drive** — folder tujuan wajib di Shared Drive,
   kalau tidak Google menolak upload dengan `403 Service Accounts do not have storage quota`.
3. **Secret & deploy Edge Function**:
   ```bash
   supabase secrets set GOOGLE_SA_JSON='<isi lengkap file JSON kunci service account>'
   supabase secrets set DRIVE_FOLDER_ID='<ID_FOLDER_DRIVE>'
   npx supabase functions deploy unggah-foto-murid --project-ref <PROJECT_REF>
   ```
   > Ganti `<ID_FOLDER_DRIVE>` dengan ID folder asli (potongan 33 karakter di URL Drive).
   > **Jangan commit nilai ID folder asli ke repo.**
   >
   > **Cara membuat `GOOGLE_SA_JSON` (service account):** buka Google Cloud Console →
   > [IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts) →
   > **Create service account** → beri nama (mis. `supabase-drive-upload`) → pada baris SA
   > pilih **⋯ → Manage keys → ADD KEY → Create new key → JSON → Create** → file `.json`
   > terunduh. **Isi file itulah `GOOGLE_SA_JSON`.** Ikuti langkah lengkap (termasuk berbagi
   > folder/shared drive ke email SA sebagai *Content manager*) di
   > `supabase/functions/unggah-foto-murid/README.md`. File JSON **jangan di-commit** ke repo.
   > Untuk `GOOGLE_SA_JSON` lebih aman tempel utuh lewat Dashboard → *Edge Functions → Secrets*
   > (menghindari masalah quoting JSON bertingkat di shell).

### Keamanan

- Edge Function `unggah-foto-murid` memakai `verify_jwt = false` karena murid "lokal"
  (login NIS+password) tidak punya JWT Supabase; otorisasi dijaga bertingkat:
  verifikasi JWT RS256 bila ada **dan** RPC `simpan_foto_murid` (security definer)
  yang hanya mengizinkan **admin** atau **murid pemilik NIS** untuk menulis `url_foto`.
- Kunci privat service account **tidak pernah** keluar dari server (hanya di Supabase secret
  `GOOGLE_SA_JSON`; file JSON asli jangan di-commit ke repo).
- File foto diberi izin "Siapa saja yang memiliki link – Pembaca" agar bisa tampil di
  `<img>`/cetak; nama file `{NIS}_{TA}_{Kelas}.jpg`.

### Perintah Cepat

```bash
npm run build:css      # build CSS produksi (minify)
npm run dev:css        # watch mode CSS
npm run build:sql      # rakit ulang supabase/sql/gabungan.sql (84 blok)
npm run check:sql      # periksa gabungan.sql sudah sinkron/terdaftar semua
npm run build:icons    # buat ulang ikon PWA (PNG 192/512/maskable + apple-touch)
npm run test:rpc-args  # penjaga PGRST202: argumen RPC frontend vs signature SQL
npm run test:face      # regresi face.js tanpa browser (overlay landmark + ambang, §7b)
npm run test:e2e       # uji E2E API (butuh kredensial & data uji terpasang)
npm run deploy         # sama dengan build:css
```
---

## 7. Sumber Referensi — Face Scanner (Absensi Wajah)

Fitur face scan (registrasi wajah & pencocokan descriptor) diadaptasi dari proyek open
source berikut. **Tekniknya** yang diadopsi, sedangkan **penyimpanan data tetap memakai
Supabase** (bukan Google Sheets / Apps Script seperti repo aslinya).

- **Repo referensi**: <https://github.com/ManageWithNoobItGuy/GAS-attendance-facescanner-with-gps-V2>
- **Yang diadopsi**:
  - Registrasi wajah **beberapa pose** per murid (deskriptor 128D per pose), bukan satu foto.
  - Pencocokan **jarak Euclidean minimum** terhadap seluruh sampel milik seorang murid.
  - **Ambang kesamaan (threshold)** untuk memutuskan cocok / tidak dikenali.
- **Yang tidak diadopsi**:
  - Google Apps Script & Google Sheets — semua data tetap tersimpan di **Supabase**.
  - Fitur GPS geofencing — bukan kebutuhan aplikasi sekolah saat ini (bisa ditambah belakangan).
- **Implementasi di proyek ini**: `web/js/face.js` (face-api.js + model lokal `web/models/`,
  offline-friendly); penyimpanan descriptor di kolom `akun.wajah_descriptor` lewat RPC
  `simpan_wajah_murid` (lihat `supabase/sql/upgrade_20261014_wajah.sql`).
- **Migrasi multi-sampel & tuning startup**: `supabase/sql/upgrade_20261014e_wajah_multi.sql`
  — `wajah_descriptor` flat `[128 angka]` → array-of-arrays (maks 6 sampel/murid), RPC
  `simpan_wajah_murid` + `p_mode 'ganti'/'tambah'`; frontend: registrasi multi-pose + min-distance
  matching + kamera fallback & pre-warm model.

### 7a. Motor wajah: `face-api` (baku) ATAU `mediapipe` (MobileFaceNet + ONNX)

`face.js` mendukung **dua mesin** di balik antarmuka yang sama (`window.FaceWajah`).
Pilihannya per-browser (per perangkat), bukan per database — diatur lewat:

```js
localStorage.setItem('sbg_wajah_motor', 'mediapipe'); // ATAU 'faceapi' (baku)
```

| Motor                                      | Deteksi + landmark              | Deskriptor           | Ruang fitur  |
| -------------------------------------------| ------------------------------- | ---------------------| ------------ |
| `faceapi` (BAKU, bawaan)                   | face-api / TFJS (lokal)         | FaceRecognitionNet    | 128          |
| `mediapipe`                                | MediaPipe Face Landmarker (wasm)| MobileFaceNet (ONNX)  | 512          |
| `onnx` (baru, `20261102a`)                 | YuNet ONNX 2023mar + 5 titik    | MobileFaceNet — crop 112×112 **di-align 5 titik** | 512 |

- **Motor `onnx` (YuNet)**: detektor jauh lebih kuat daripada `TinyFaceDetector` pada
  **wajah kecil berdesakan** (baris belakang kelas) dan menyediakan **5 titik kunci**
  (mata, hidung, sudut mulut) yang dipakai menyejajarkan crop 112×112 ala ArcFace
  sebelum MobileFaceNet. Pencocokan memakai **kemiripan kosinus** dengan gerbang
  **margin top-2** (menolak menebak bila dua murid nyaris sama mirip).
  Model: `web/models/face_detection_yunet_2023mar.onnx` (0,23 MB, MIT) — input
  **tetap 640×640**, di-precache service worker; embedder memakai
  `mobilefacenet.onnx` yang sama dengan motor `mediapipe`.
  Ambang: `JARAK_COCOK_ONNX=0.55` (kemiripan 45%), `JARAK_KENAL_ONNX=0.70`
  (kemiripan 30%), `MARGIN_TOP2=0.06`.

- **Cara ganti**: di konsol browser perangkat sekolah jalankan `localStorage.setItem('sbg_wajah_motor','mediapipe')` → muat ulang halaman. Kembali: nilai `'faceapi'` atau `localStorage.removeItem('sbg_wajah_motor')`.
- **Berkas lokal** (tanpa CDN, offline setelah cache pertama):
  - `web/vendor/mediapipe/vision_bundle.js` + `wasm/vision_wasm_internal.{js,wasm}` (MediaPipe Tasks Vision)
  - `web/vendor/onnx/ort.min.js` + `ort-wasm-simd-threaded.{mjs,wasm}` (ONNX Runtime Web)
  - `web/models/face_landmarker.task` (MediaPipe) dan `web/models/mobilefacenet.onnx` (MobileFaceNet, **512-d**)
  - `web/models/face_detection_yunet_2023mar.onnx` (YuNet, detektor motor `onnx` — MIT,
    lihat `web/models/LICENSE-yunet.txt`)
- **Penting — registrasi ulang**: 128-d (face-api) vs 512-d (MobileFaceNet) berada di
  **ruang fitur berbeda**, dan `mediapipe` vs `onnx` juga **berbeda kebijakan crop**
  (kotak deteksi vs align 5 titik) walaupun sama-sama 512 angka. Setelah berganti mesin,
  murid harus didaftarkan ulang (modal wajah → "Simpan Data Wajah" mode `ganti`; pipeline
  multi-pose dan batas 6 sampel tetap sama). Baris lama tetap tersimpan di DB dan
  berfungsi bila motor dikembalikan. Face Scan/Absen Mandiri mendeteksi kondisi ini dan
  menampilkan pesan "mesin pengenalan lain" (bukan "belum terdaftar") — lihat §7b.
  ⚠ Karena `mediapipe` dan `onnx` sama-sama 512 angka, DB **tidak** dapat membedakan
  keduanya dari dimensi saja: setelah pindah antar keduanya, daftarkan ulang (atau
  samakan motor di semua perangkat) — kolom penanda mesin per baris direncanakan di
  tahap berikutnya.
- **Syarat deploy**: jalankan sekali `supabase/sql/upgrade_20261023_wajah_motor_mediapipe.sql` di Supabase SQL Editor (tanpa migrasi data; RPC menerima 128 & 512). Lihat juga `CHECKLIST_E2E.md` → **S14h**.
- **Kualitas (validasi offline model ini)**: wajah sama cos≈0.85 (d≈0.54), antar-orang cos 0.11–0.19 (d 1.27–1.33) → ambang `JARAK_COCOK_MP=0.80` / `JARAK_KENAL_MP=0.95`; pemisahannya lebar, tetapi E2E di perangkat sekolah terlemah tetap wajib (ukur latensi pemindaian pertama).
- **Perbaikan bug crop `mediapipe` (build `20261102a`)** — dampak besar: jalur deskriptor
  mediapipe dulu memanggil `drawImage` dengan argumen sumber/tujuan **tertukar**
  (`(el, 0, 0, 112, 112, b.x, b.y, cw, ch)`), sehingga yang dibaca adalah potongan
  112×112 di **pojok kiri-atas frame** lalu digambar di **luar** kanvas ⇒ descriptor
  dihitung dari citra (hampir) kosong. Sekarang potongan kotak wajah dipetakan ke kanvas
  112×112 penuh (`(el, b.x, b.y, cw, ch, 0, 0, 112, 112)`), demikian pula snapshot 128×128
  pada loop registrasi. **Data 512-angka hasil registrasi sebelum perbaikan ini tidak
  sahih → daftarkan ulang.** Uji regresi menahan perbaikan ini (`npm run test:face` §6i).
- **Mencoba motor `onnx`**: `localStorage.setItem('sbg_wajah_motor','onnx')` → muat ulang
  halaman → modal wajah murid → **Simpan Data Wajah** (mode `ganti`, ulangi untuk beberapa
  murid) → uji Face Scan kelas & Absen Mandiri, ukur latensi pindai pertama di perangkat
  terlemah. Bawa nilai "jarak/kemiripan" yang tampil ke masthead untuk penyetelan
  (`localStorage.sbg_wajah_ambang`).

### 7b. Akurasi pemindaian absen (Face Scan kelas)

Tombol **Face Scan** pada Input Hadir Tatap Muka dan **Face Scan** di Absen Mandiri memakai
loop yang sama (`loopDeteksiPindai` di `web/js/face.js`). Perbaikan akurasi terbaru
(build `20261031b`, `VERSION` service worker `v7`):

- **Resolusi deteksi = registrasi.** `TinyFaceDetectorOptions.inputSize` kini **320** (dulu 224).
  Kotak & 68 landmark jadi sepresisi data registrasi (`deteksiSatuWajah` juga 320) — dengan 224
  crop deskriptor bergeser sehingga jarak Euclidean ke data registrasi membengkak dan wajah yang
  benar dinyatakan "tidak dikenal" (terutama wajah siswa di baris belakang).
- **Satu jalur deskriptor.** Pemindaian memakai `descriptorDariHasilLive` — fungsi yang sama
  dengan registrasi kamera/normalisasi foto (`landmarks.align({useDlibAlignment:true})` →
  `extractFaces` → `FaceRecognitionNet`). Catatan verifikasi: `.withFaceDescriptor()` bawaan
  face-api **juga** memakai `useDlibAlignment` (`alignDlib` di `vendor/face-api.min.js`), jadi
  kedua jalur menghasilkan vektor setara; menyatukannya mencegah dua jalur menyimpang nanti.
- **Gerbang kualitas frame.** Frame dengan skor deteksi `< 0.45` (`SKOR_MIN_PINDAI`) atau gagal
  menghitung deskriptor **tidak dicocokkan** — status menampilkan "Wajah terbaca — mendekat &
  tahan (…%)" sebagai panduan, bukan mencatat kehadiran dari frame blur.
- **Konfirmasi 2 frame.** Label yang sama harus muncul **2 frame berurutan** (jarak ≤ ambang)
  sebelum kehadiran dicatat; satu frame blur/ambigu tidak lagi menandai siswa. `COOLDOWN_MS`
  (2,5 dtk) per NIS tetap berlaku.
- **Overlay landmark.** Selain kotak, overlay menggambar **kerangka landmark** (68 titik
  face-api / 478 mediapipe) dengan geometri `object-contain` + zoom + mirror yang sama
  (`gambarLandmarkPindai`) — terlihat langsung apakah wajah terbaca penuh. Garis kerangka
  digambar **solid** (`ctx.setLineDash([])` di awal fungsi), jadi tidak mewarisi gaya
  putus-putus milik kotak deteksi dari frame sebelumnya.
- **Auto-hentian "semua terdaftar ✓"** kini menghitung label yang **benar-benar ikut matcher**
  (vektor beda dimensi dibuang), bukan jumlah baris peta.
- **Salah motor terdeteksi lebih awal.** Bila ada data wajah tetapi semuanya berdimensi motor
  lain (128 vs 512), panel menampilkan penjelasan + cara memperbaikinya (dulu: "belum terdaftar").
  Berlaku di **Face Scan kelas** (matcher kosong) dan **Absen Mandiri** (wajah satu siswa).
- **Kalibrasi ambang per perangkat (tanpa ubah kode).** Status pemindaian menampilkan
  "jarak terdekat"/"Ambang" sebagai dasar penilaian. Untuk kamera kelas yang jaraknya konsisten
  lebih longgar/ketat:
  ```js
  localStorage.setItem('sbg_wajah_ambang', '0.55'); // 0.3–0.85; hapus = baku per motor
  ```
  Nilai ini menggantikan `JARAK_COCOK` (face-api) / `JARAK_COCOK_MP` (mediapipe) dan
  menaikkan ambang matcher face-api (`Math.max(JARAK_KENAL, ambang)`) agar jarak di atas
  `JARAK_KENAL` tidak langsung menjadi "unknown". Matcher mediapipe memakai batas
  `JARAK_KENAL_MP` tetap (`0.95` > batas kalibrasi `0.85`), jadi kalibrasi di sana hanya
  menggeser gerbang "Hadir" — jarak di atasnya tetap ditampilkan lengkap dengan labelnya.
- **Uji regresi tanpa browser.** `npm run test:face` (`scripts/uji-face.mjs`) mengekstrak
  fungsi murni dari `face.js` lalu memeriksa geometri overlay landmark (mirror/zoom),
  ambang baku + kalibrasi + perilaku saat `localStorage` diblokir, deteksi vektor mesin
  lain, fusi multi-frame, gerbang kualitas citra & pose, ambang 1:1 Absen Mandiri, serta
  pemeriksaan struktural jalur `mandiri` (fusi/pose/`motorPaksa` benar-benar terpasang).
  Bagian **7** menjaga fitur **Cek Wajah**: `modeCari` benar-benar `continue` sebelum
  penandaan hadir, `setWajahNonaktif` hanya mematikan status, tombol di `app.js` memanggil
  `cekWajahKameraMurid()` (bukan laporan kualitas lama), dan overlay landmark registrasi
  tidak dibalik dua kali di kamera depan (`mirror: false` + `setTransformReg`).
  Jalankan setelah menyentuh `gambarLandmarkPindai`/`ambangCocok`/`ambangMandiri`/konstanta
  jarak; skrip keluar dengan kode `1` bila ada yang gagal (dan menggagalkan job
  **Validasi repo** di GitHub Actions, jadi regresi terdeteksi sebelum deploy).
- **Penandaan H dari scan tidak lagi gagal senyap (build `20261104a`, `VERSION` SW `v11`).**
  Gejala lapangan: kamera menampilkan "Cocok! …" (label wajah benar) tetapi baris siswa
  **tidak** tercentang H — tanpa banner, TTS, maupun gulir. Sebabnya: setiap jalur
  (QR modal, Face Scan modal, Face Scan nilai) menyalin logika "cari radio H" dan mencari
  radio dengan `querySelector('input[name="absen_<nis>"]')` **persis**, padahal `nis`
  datang dari **dua sumber berbeda** — label wajah = `akun.nis_nip` (teks dari DB),
  sedangkan nama radio = `absensi.NIS` (bisa angka/format lain). Beda tipe/format
  (mis. `1234` vs `"1234"`, `"0012"` vs `12`, atau ada spasi) membuat radio tak ketemu ⇒
  `onMatch` mengembalikan `false` dan penandaan berhenti tanpa jejak. Kini semua jalur
  memakai satu helper `tandaiHadirScan(nis)` (app.js): pencarian radio **3 strategi**
  (nama persis → baris `#row-murid-*` → telusuri semua radio H dengan normalisasi NIS
  `nisSama()`, termasuk padanan numerik), lalu efek dipusatkan (centang H + `dataset.on`,
  banner, TTS `ucapkanNamaScan` yang `cancel()` dulu agar tidak mengantre, dan gulir +
  animasi `sorotBarisMurid` ber-debounce 1,2 dtk per NIS). Bila baris benar-benar tidak
  ada, muncul banner **amber** + `console.warn('[scan-hadir] …')` sebagai jejak (dulu:
  diam). Helper yang sama dipakai Face Scan pada input nilai — nama siswa kini dibaca
  dari `NIS`/`Nama Lengkap` **maupun** `nis`/`nama`.
- **Tombol "Cek Wajah" di Data Akun Murid (build `20261105a`) — identifikasi kamera
  READ-ONLY, seperti "Cari NIS/Nama".** Arahkan wajah ke kamera, panel menampilkan
  **siapa yang dikenali**: daftar kandidat murid paling mirip (maks 6) + % kemiripan,
  diperbarui tiap frame; kandidat teratas yang sudah di bawah `ambangCocok()` diberi
  kotak hijau di pratinjau. Mesin = pemindai kelas yang sudah terbukti
  (`pindaiCariWajah` → `mulaiPindaiWajahAbsen` dengan `modeCari`): kamera universal
  (dropdown Depan/Belakang, ingatan kamera terakhir), model ringan, multi-sampel, dan
  murid berstatus `nonaktif` otomatis tidak ikut diperingkat. `modeCari` **tidak
  mencatat kehadiran** dan melewati gerbang pose/kualitas serta cooldown/konfirmasi
  2-frame (tujuan: identifikasi cepat, bukan absensi). Cakupan pencarian mengikuti
  **filter tabel aktif** (`muridTersaring`). Aksi di panel: **Simpan** (hanya menutup
  panel — tidak ada data yang ditulis), **Next** (kandidat berikutnya tanpa menutup
  panel), **Registrasi Wajah** (buka modal registrasi murid terpilih), dan **Bukan
  wajah saya** (konfirmasi → `setWajahNonaktif` — descriptor TIDAK dihapus, hanya
  `wajah_status='nonaktif'` lewat RPC `simpan_wajah_murid` — lalu tawarkan rekam
  ulang). Hak akses mengikuti `aksesRegistrasiWajahMasal()` (admin & guru wali
  kelas/pembina). **Tidak butuh migrasi SQL.**

### 7c. Akurasi Absen Mandiri (verifikasi selfie 1:1)

Absen Mandiri memakai loop yang sama, tetapi dengan **profil berbeda** (`{ mandiri: true }`)
karena kondisinya berbeda: kamera depan, jarak dekat, cahaya tak menentu, dan hanya satu
identitas yang boleh cocok. Build `20261031c` menambahkan:

- **Fusi 3 frame.** Tiga frame yang lolos gerbang dirata-ratakan (`rataRataDescriptor`)
  sebelum dicocokkan; minimal **2 dari 3** frame harus sudah mirip secara individual
  (konsensus). Noise blur/ekspresi antar-frame saling meniadakan → jarak ke data registrasi
  mengecil, sehingga siswa yang benar lebih jarang ditolak. Vektor 512 (MobileFaceNet)
  dinormalisasi L2 ulang setelah dirata-ratakan.
- **Gerbang pose.** `deteksiPoseDepan` menolak wajah yang menoleh (asimetri hidung terhadap
  sudut mata > `YAW_MAKS` 0,42), wajah terlalu kecil (< 22% tinggi frame), atau terpotong
  tepi frame — dengan pesan perbaikan yang spesifik di layar ("Hadapkan wajah LURUS…",
  "Mendekatlah ke kamera…", "Posisikan SELURUH wajah…").
- **Gerbang kualitas.** `statistikKualitasCitra` (64×64 grayscale) menolak frame gelap
  (luminans < 45), silau (> 225), atau blur (rata-rata |Laplacian| < 12). Bila statistik tak
  bisa dihitung (video belum siap) gerbang dilewati — tidak memblokir.
- **Ambang 1:1.** `ambangMandiri()` = ambang perangkat/kalibrasi − 0,03 (dijepit 0,30–0,85;
  face-api 0,50 → 0,47 · mediapipe 0,80 → 0,77). Matcher face-api memakai ambang yang sama
  agar jarak yang lolos verifikasi tidak lebih dulu dipotong matcher.
- **Mesin otomatis sesuai data.** Bila descriptor murid berdimensi 128/512 dan berbeda dari
  setelan perangkat, mesin untuk **satu pemindaian itu** dipaksa (`motorPaksa`, dibaca lewat
  `motorAktif()`) dan dipulihkan di `finally`. Setelan `localStorage` tidak diubah. Tanpa ini
  siswa yang registrasinya dibuat di perangkat lain selalu ditolak ("mesin pengenalan lain").
  Kedua pustaka (`face-api` + MediaPipe/ONNX) memang selalu dimuat oleh `index.html`; model
  besar tetap dimuat lazy per mesin (`modelsFaceApiSiap` / `mpModelsSiap` terpisah).
- **Diagnosis "belum terdaftar" yang jujur.** `akunPetaWajah` kini mengembalikan `.sebab`
  (`ok`/`kosong`/`sesi`/`rpc-tidak-ada`/`gagal`) sehingga panel membedakan "wajah belum
  didaftarkan" dari "sesi kedaluwarsa"/"server belum dimigrasi" (lihat §11 & S14m).
- **Kamera berhenti bersih.** Penolakan server/geofence menghapus pratinjau
  (`#wajah-mandiri-wrap`); mengubah mapel atau mengetik captcha mereset verifikasi wajah
  (`resetVerifikasiWajahMandiri`) supaya hasil scan lama tidak terbawa ke absensi captcha.


### 7d. Kamera universal (semua merek ponsel & peramban)

Dulu tiap jalur kamera membuka `getUserMedia` sendiri dengan permintaan yang kaku
(`facingMode: 'user'` + `width/height: { ideal }`), sehingga di sebagian ponsel
(Xiaomi/Realme/Oppo/Infinix, iPad, WebView) muncul `OverconstrainedError`,
`NotReadableError`, atau kamera tidak pernah menyala. Build `20261031d` memusatkan
semua pembukaan kamera pada **satu lapisan di `web/js/face.js`**:

- **Tangga kandidat `susunKandidatKamera()`** — dicoba berurutan sampai berhasil:
  `deviceId: exact` → `deviceId: ideal` → `facingMode: exact` (muka yang diminta
  lebih dulu, lalu cadangannya) → `facingMode: ideal` → tanpa constraint → **tanpa
  permintaan resolusi**. `width/height` **selalu `ideal`, tidak pernah `exact`** —
  inilah penyebab utama kegagalan di driver kamera tertentu.
- **Berhenti mencoba hanya saat izin ditolak** (`NotAllowedError`/`SecurityError`);
  error lain lanjut ke kandidat berikutnya, dan `NotReadableError` (kamera baru
  dilepas aplikasi lain) dicoba ulang sekali setelah jeda 900 ms.
- **`gantiKameraAktif()`** — berpindah kamera memakai `applyConstraints` pada track
  yang sedang jalan (tanpa stream kedua, aman di ponsel kamera-tunggal) → bila
  gagal, stop-lalu-buka → bila tetap gagal, **rollback** ke kamera lama sehingga
  dropdown tidak pernah menunjuk kamera mati.
- **Pemilih kamera di semua jalur** — Registrasi wajah (`#camera-select`), Absen
  Mandiri (`#wajah-mandiri-kamera`, opsi `Depan`/`Belakang` + tiap perangkat),
  Face Scan kelas (`#wajah-live-kamera`), dan pemindai QR (`#qr-kamera-modal`,
  `#qr-kamera-nilai-masal`; kamera kartu ekskul memakai tangga otomatis
  `qrMulaiDenganTangga()`). Label perangkat dirapikan ("Depan"/"Belakang"/nama
  kamera + nomor bila ganda) dan daftar **disegarkan otomatis** saat
  `devicechange` (kamera USB dicabut/dipasang).
- **Ingat kamera terakhir** — `localStorage.sbg_wajah_kamera` (registrasi + Absen
  Mandiri), `sbg_wajah_kamera_pindai` (Face Scan kelas), `sbg_qr_kamera` (pemindai
  QR). Pengguna kamera belakang/eksternal tidak lagi dipaksa kembali ke kamera
  bawaan tiap membuka modal.
- **Fallback tanpa kamera** — tombol **Ambil Selfie** di modal registrasi
  (menambah sampel descriptor seperti sampel kamera) dan **Verifikasi dari Foto /
  Selfie** di Absen Mandiri (verifikasi 1:1 dengan `ambangMandiri()`); bila kamera
  gagal dibuka, Absen Mandiri menampilkan tombol **Coba Kamera Lagi** dan
  **Verifikasi dari Foto** (tidak lagi buntu).
- **Pesan error per kasus** (`pesanKameraError()`) — langkah izin Android/iPhone
  konkret, "kamera dipakai aplikasi lain", "tidak ada kamera", "butuh HTTPS/
  localhost", plus arahan ke jalur foto/selfie.
- **`play()` yang ditolak bukan kegagalan kamera** — `pasangStreamKeVideo()`
  memasang stream lebih dulu, mencoba `play()` ulang sekali, lalu lanjut (dulu
  `AbortError` saat mengganti kamera cepat menggagalkan seluruh alur).
- **Kamera dilepas saat tab disembunyikan** (`visibilitychange` →
  `hentikanKamera()`): ponsel tidak lagi menahan stream di modal yang tak terlihat
  (penyebab `NotReadableError` di modal berikutnya).

Regresi dijaga `npm run test:face`: `scripts/uji-face.mjs` bagian **5** menguji
tangga kandidat (termasuk larangan `width/height: exact`), normalisasi kandidat
gaya lama, `deteksiLingkunganKamera`, `pesanKameraError`, dan pemeriksaan
struktural bahwa Registrasi/Absen Mandiri/Face Scan kelas memakai lapisan ini
serta tombol selfie benar-benar terpasang.

---

## 8. PWA — "Pasang ke Layar Utama" (Install & Offline)

Aplikasi bisa dipasang seperti aplikasi native (ikon di layar utama, tampil
penuh tanpa alamat browser) di Chrome/Edge/Opera (Android & desktop), Safari
iOS/iPadOS, dan Samsung Internet. Ini murni **peningkatan**: tanpa memasang
apa pun, aplikasi tetap berjalan normal di browser.

### a. Berkas PWA (semua di `web/`)

| Berkas | Fungsi |
|---|---|
| `manifest.json` | nama, `start_url`/`scope` **relatif** (`./`), `display: standalone`, ikon PNG 192/512 + varian `maskable` |
| `sw.js` | service worker: precache aset inti, network-first untuk navigasi, cache-first untuk aset, fallback `offline.html` |
| `offline.html` | halaman fallback saat benar-benar offline |
| `js/install.js` | registrasi service worker (dengan `updateViaCache: 'none'` + aktivasi versi baru otomatis), tombol "Pasang" di header, kartu ajakan di dashboard, panduan iOS, prompt notifikasi (1× per perangkat), **stempel build + pembersih cache `sisip-*` sekali per build baru** |
| `assets/icon-*.png`, `assets/apple-touch-icon.png` | ikon PWA — dibuat dari `assets/logo.svg`, **jangan diedit manual** |

**Penting — semua path harus relatif.** GitHub Pages menyajikan folder `web/`
sebagai **project page** (`https://<user>.github.io/Administrasi-Sekolah/`).
Path absolut seperti `/index.html` atau `/sw.js` akan menunjuk root domain
GitHub Pages dan **404**. Karena itu `manifest.json`, `sw.js`, dan `install.js`
selalu memakai `./`, dan `sw.js` menurunkan semua URL dari scope-nya sendiri
(`new URL('./', self.location.href)`).

### b. Cara memasang

- **Android (Chrome/Edge/Opera/Samsung):** buka SISIP → tombol **Pasang** di
  header (atau kartu "Pasang Aplikasi SISIP" di dashboard) → konfirmasi.
- **Desktop (Chrome/Edge):** ikon **install** di address bar, atau menu ⋮ →
  *Pasang aplikasi*.
- **iPhone/iPad (Safari):** tombol **Bagikan** → **Tambahkan ke Layar Utama**.
  iOS tidak mendukung `beforeinstallprompt`, jadi `install.js` menampilkan
  panduan langkah demi langkah saat tombol Pasang ditekan.

### c. Cara merawat (wajib dibaca sebelum mengubah aset)

1. Setiap kali `web/index.html` berubah (tag `?v=` naik), **naikkan `VERSION`
   di `web/sw.js`** dan **samakan daftar `PRECACHE`** dengan tag di
   `index.html`. Bila terlewat, pengguna bisa tetap menerima berkas lama
   dari cache meski sudah ter-deploy versi baru.
2. Ikon dibuat dari `web/assets/logo.svg`: `npm run build:icons` (tulis ulang)
   / `npm run check:icons` (verifikasi ukuran & kelengkapan).
3. Semua UI PWA disuntik dari `js/install.js` — skrip ini **tidak** menyentuh
   `js/app.js`, sehingga perubahan PWA tetap terisolasi dari file besar itu.
4. Folder `models/` sengaja **tidak** di-precache (ukurannya besar); model
   wajah diambil dari jaringan. Saat offline, beranda & menu tetap terbuka,
   sedangkan data Supabase (melewati service worker) tetap butuh koneksi.
5. Uji manual lengkap ada di `CHECKLIST_E2E.md` → **S14l** (PWA/offline) dan **S14m**
   (akurasi Face Scan + overlay landmark, README §7b).
6. `js/install.js` menyimpan **stempel build** (`BUILD = '20261116a'`; muncul di
   console sebagai `[SISIP] build …` dan sebagai `<html data-sisip-build="…">`).
   Bila stempel di perangkat berbeda, seluruh cache `sisip-*` dihapus lalu halaman
   memuat ulang **sekali** — jadi perangkat yang masih menjalankan berkas lama
   (termasuk service worker rusak / cache `sisip-v1`) sembuh sendiri tanpa siswa
   perlu menghapus data situs. Naikkan `BUILD` bersama tag `?v=` dan `VERSION` di
   `sw.js`. **Semua** tag `?v=` untuk berkas yang di-precache (`css/style.css`,
   `js/kelas.js`, `js/utils.js`, `js/app.js`, `js/face.js`, `js/install.js`) wajib
   ikut naik: `npm run check:deploy` mencocokkan `BUILD` dengan tag
   `js/app.js?v=`/`js/kelas.js?v=`/`css/style.css?v=`/`js/utils.js?v=` di
   `index.html` **dan** di `PRECACHE`, jadi satu tag tertinggal langsung
   dilaporkan merah.
7. **Dua situs, satu folder `web/`.** Selain GitHub Pages, aplikasi juga disajikan
   Vercel dari repo mirror `BrazaMuzti/SMKN2Banjar` (**Root Directory = `web/`**,
   tanpa `vercel.json`). Folder `web/` di mirror itu **harus selalu identik dengan
   repo ini**; bila hanya salah satu yang diperbarui, siswa menerima berkas campur
   (mis. `js/app.js` baru tetapi `sw.js`/`manifest.json` lama). Histori mirror
   **berbeda** dari repo ini (dibuat lewat unggahan web), jadi `git push mirror main`
   ditolak *non-fast-forward*. Cara yang sudah teruji (2026-10-24):

   > ⚠ **Status (4 Nov 2026): mirror Vercel = host UJI COBA PRIBADI — sementara
   > TIDAK wajib disinkronkan setiap rilis.** Host itu sudah ditandai
   > `"opsional": true` di `scripts/deploy-urls.json`, sehingga `npm run check:deploy`
   > menampilkannya dengan tanda **ℹ (bukan ❌)** dan **tidak** menggagalkan gate;
   > syarat "harus identik" di atas berlaku bila host itu dipakai murid sungguhan.
   > Langkah di bawah tetap dipakai saat ingin menyinkronkannya kembali (atau saat
   > menambah host baru yang wajib, mis. domain sekolah).

   ```bash
   git fetch https://github.com/BrazaMuzti/SMKN2Banjar.git main:refs/remotes/mirror/main
   git worktree add --detach /tmp/mirror-sync mirror/main
   git archive HEAD web | tar -x -C /tmp/mirror-sync   # hanya berkas web/ yang terlacak
   git -C /tmp/mirror-sync add -A web
   git -C /tmp/mirror-sync status --porcelain          # tinjau dulu daftar perubahan
   git -C /tmp/mirror-sync commit -m "sync web/ dari repo utama (build <tanggal>)"
   git -C /tmp/mirror-sync push https://github.com/BrazaMuzti/SMKN2Banjar.git HEAD:main
   git worktree remove --force /tmp/mirror-sync
   ```

   **Penting:** `git archive HEAD web` hanya membawa berkas **terlacak**, jadi
   `web/js/utils.js` milik mirror (ber-kredensial) tetap utuh — memang itu yang
   diinginkan. Namun berkas itu **juga harus ikut naik** setiap kali
   `web/js/utils.example.js` berubah (template baru + `utils.js` lama = fitur
   baru mati di host itu, persis kasus `akunSesiAbsenMurid`). Kredensial kedua
   situs identik (`https://lkhuyoihrrnzvrmhquln.supabase.co`), jadi cukup salin
   berkas lokal ke worktree sebelum commit:
   `cp web/js/utils.js /tmp/mirror-sync/web/js/utils.js`.

   Verifikasi setelah push — cara tercepat sekaligus memeriksa **semua** host:
   `npm run check:deploy` (harus hijau). Setara manual:
   `curl -s https://smkn2banjar.vercel.app/index.html | grep -o 'v=[0-9a-z]*'`
   harus menampilkan tag terbaru, dan `manifest.json` harus JSON sah
   (`curl -s …/manifest.json | node -e "JSON.parse(require('fs').readFileSync(0))"`).

   **Jangan** unggah berkas satu per satu lewat web GitHub: unggahan manual pernah
   melewatkan `sw.js`/`manifest.json` sehingga PWA di situs Vercel rusak
   (precache `/web/…` → 404, dan `manifest.json` jadi JSON tidak sah karena koma
   menggantung). **Jangan** pula `git push --force`: repo ini **tidak** melacak
   `web/js/utils.js` (berisi kredensial → ada di `.gitignore`), sedangkan di mirror
   berkas itu ada dan itulah satu-satunya sumber konfigurasi Supabase situs Vercel —
   force-push akan menghapusnya dan situs Vercel kehilangan koneksi database.
   Mirror juga membawa `.github/workflows/static.yml` warisan yang **selalu gagal**
   (repo mirror tidak punya secret) — abaikan atau hapus berkasnya. Alternatif
   jangka panjang yang lebih rapi: arahkan proyek Vercel ke repo ini
   (`BrazaMuzti/Administrasi-Sekolah`) dengan Root Directory = repo,
   **Output Directory = `web`**, Build Command
   `npm run build:css && node scripts/generate-utils.mjs`, plus Environment Variables
   `SUPABASE_URL` & `SUPABASE_ANON_KEY` — mirror tidak diperlukan lagi dan risiko
   drift hilang.
8. **Penjaga drift build antar-host** (`scripts/deploy-urls.json` +
   `scripts/cek-deploy.mjs`). Berkas JSON itu mendaftar **semua** host yang
   menyajikan aplikasi (Pages, mirror Vercel, custom domain `.my.id` nanti).
   `npm run check:deploy` mengunduh `index.html`, `sw.js`, `js/install.js`,
   `js/app.js`, `js/utils.js`, dan `js/kelas.js` dari **setiap** host lalu
   membandingkannya dengan folder `web/` repo ini: meta `sisip-build`, `BUILD`
   di `install.js`, `VERSION` di `sw.js`, tag `?v=` di daftar `PRECACHE`, hash
   `js/app.js`, keberadaan simbol `akunSesiAbsenMurid`/`ambil_sesi_absen_murid`
   di `utils.js`, penanda modul kelas (`root.KELAS`/`pecah`) di `js/kelas.js`,
   dan tidak adanya penanda template. Satu host berbeda → exit code
   `1` + daftar alasannya (ditambah blok "stempel" agar mudah dibandingkan).
   Jalankan **setiap habis deploy**; workflow Pages juga memanggilnya otomatis
   sebagai *peringatan* (CDN bisa tayang beberapa menit setelah job selesai).
   Menambah host sementara:
   `npm run check:deploy -- --tambah sekolah=https://sekolahku.my.id/`; permanen
   dengan menambah `{ "nama": "sekolah", "url": "https://sekolahku.my.id/" }` ke
   `scripts/deploy-urls.json` (URL **wajib** diakhiri `/`). Untuk olah-mesin:
   `npm run check:deploy -- --json`; batasi host tertentu dengan
   `--host github-pages`. Skrip ini **tidak** menyentuh server mana pun
   (HTTP GET saja), jadi aman dijalankan kapan saja.

## 9. Normalisasi Kelas — Tingkat · Jurusan · Rombel

Kelas disimpan sebagai **satu label gabungan** (`"X LP 1"`). Aplikasi lama
menebak isinya dengan `split()`/regex di puluhan tempat, sehingga label gaya
angka — `"10 RPL 1"`, bentuk umum pada impor Excel — tidak terbaca konsisten
(mis. angkatan `"10 RPL 1"` dulu menghasilkan `""`, dan `"10 RPL 1"` tidak
dianggap sama dengan `"X RPL 1"`). Sejak **build `20261116a`** (SW `v13`)
label kelas diuraikan **sekali** di satu sumber, lalu dipakai semua fitur.

### a. Dua tahap perubahan

| Tahap | Berkas | Isi |
|---|---|---|
| **2 (SQL)** | `supabase/sql/upgrade_20261115_kelas_normalisasi.sql` | kolom terstruktur `tingkat`/`jurusan_kode`/`jurusan`/`rombel` + generated `kelas_label` pada `master_data`, `akun`, `jadwal_pelajaran`; tabel referensi `master_jurusan` (+RLS); helper `fn_normal_tingkat`/`fn_pecah_kelas`/`fn_label_kelas`/`fn_enrich_riwayat_kelas`; **trigger sinkron dua arah** label ⇄ kolom terstruktur; RPC `proses_kenaikan_kelas`, `simpan_riwayat_murid`, `fn_akun_export`, `fn_akun_json` dibuat ulang (aditif) |
| **3 (frontend)** | `web/js/kelas.js` + `web/js/app.js` | modul kelas murni (cermin helper SQL) + seluruh helper kelas lama di `app.js` menjadi **delegasi** ke modul itu, plus integrasi tabel referensi `master_jurusan` |

Tahap 2 **wajib dijalankan lebih dulu** (`gabungan.sql` untuk project baru,
atau file upgrade-nya untuk project yang sudah berjalan).

### b. `web/js/kelas.js` — satu sumber kebenaran format kelas

| API | Cermin SQL | Kegunaan |
|---|---|---|
| `KELAS.pecah(label)` | `fn_pecah_kelas` | `"10 RPL 1"` → `{tingkat:'X', jurusan_kode:'RPL', rombel:1}` |
| `KELAS.label(t, k, r)` | `fn_label_kelas` | rakit label kanonik `"X RPL 1"` |
| `KELAS.normalTingkat(v)` | `fn_normal_tingkat` | `10→X`, `11→XI`, `12→XII`, sisanya UPPER |
| `KELAS.komponen(row)` | — | komponen baris DB: **kolom terstruktur dulu**, lalu uraian label |
| `KELAS.komponenTahun(row, ta)` | `fn_enrich_riwayat_kelas` | komponen kelas murid pada satu TA (entri `riwayat_kelas`) |
| `KELAS.labelDariBaris(row)` | — | label tersimpan bila ada, selain itu dirakit |
| `KELAS.kunci(v)` / `KELAS.sama(a,b)` | — | pembanding kesetaraan: `"10 RPL 1"` ≡ `"X RPL 1"` ≡ `"x rpl 1"` |
| `KELAS.naik(t)` / `KELAS.turun(t)` | — | `X→XI→XII→LULUS` / kebalikannya |
| `KELAS.angkatan(v)` / `gayaTingkat` / `tingkatGaya` | — | angkatan (`"10 RPL 1"` → `X`) & menjaga gaya angka/romawi saat kenaikan kelas |

**Label yang jelas BUKAN kelas** (`""`, `"Semua Kelas"`, `"Hadir"`, `"Islam"`,
`"Aktif"`, …) tidak pernah diurai — komponennya kosong. Ini penting karena
`master_data` menyimpan banyak kategori pada baris yang sama.

Modul ini **murni** (tanpa DOM), dimuat `<script src="js/kelas.js?v=…">`
**sebelum** `app.js`, dan di-precache service worker.

### c. Aturan kompatibilitas yang tidak boleh dilanggar

1. **Label tersimpan tidak pernah ditulis ulang otomatis.** Trigger Tahap 2
   mem-parse label yang sudah ada untuk mengisi kolom terstruktur, tetapi
   **tidak** mengganti labelnya — jadi filter lama (`"10 RPL 1"`) tetap cocok
   dengan data yang sudah ada.
2. **Daftar kelas & dropdown filter tetap memakai label tersimpan** (`listKelas`
   dari `master_data."Tingkat/Kelas"`). Mengganti sumbernya ke label kanonik
   akan memutus semua pembanding label di penjadwalan/absensi. Untuk
   membandingkan dua kelas yang berbeda gayanya, gunakan `KELAS.sama(a, b)`.
3. **Kolom terstruktur menang atas uraian teks.** `KELAS.komponen()` membaca
   `tingkat`/`jurusan_kode`/`rombel` lebih dulu (hasil parser SQL yang lebih
   andal), baru menguraikan label. Karena itu helper lama di `app.js` menerima
   parameter kedua opsional berupa **baris DB** (`rombelKelas(kls, row)`,
   `jurusanDariKelas(kelas, row)`, …) — kirim barisnya bila tersedia.
4. **`KELAS_FALLBACK` di `app.js` wajib dipertahankan.** Bila `js/kelas.js`
   gagal dimuat (kasus nyata: satu host belum ikut deploy → 404), `app.js`
   otomatis memakai implementasi cadangan di dalam `app.js` (penanda
   `// ── [KELAS-FALLBACK-MULAI]` … `SELESAI`) dengan perilaku identik, lalu
   menulis satu `console.warn`. Ini menjaga aplikasi tetap jalan, bukan
   halaman putih.

### d. `master_jurusan` (tabel referensi jurusan)

- Dimuat sekali per sesi oleh `ambilMasterJurusan()` (dipanggil tanpa memblokir
  dari `ambilMasterData()`); `petaJurusanMaster()` menggabungkannya dengan
  pasangan baris `master_data` (**master_data menang** karena itu yang diedit
  admin), dan `daftarJurusanWizard()` memakainya untuk dropdown Wizard.
- Saat admin menambah/mengubah jurusan di **Master Data → Wizard Jurusan /
  Edit**, `simpanJurusanMaster(kode, nama)` menyinkronkan tabel referensi
  (cari baris → update, selain itu insert; tanpa `upsert` karena tabel memakai
  indeks unik ekspresi `upper(btrim(kode))`). Gagal sinkron hanya
  `console.warn` — alur Master Data tidak pernah diblokir.
- Bila migrasi Tahap 2 **belum** dijalankan, semua panggilan di atas gagal
  senyap (cache kosong) dan aplikasi kembali memakai perilaku lama
  (pasangan baris `master_data` + preset Wizard).

### e. Uji & verifikasi

- **Otomatis:** `npm run test:kelas` (`scripts/uji-kelas.mjs`) — 222 pemeriksaan
  tanpa browser/DB: tabel kasus uraian/perakitan (`"10 RPL 1"`, `"x rpl 1"`,
  `"X-RPL-1"`, `"X LP"`, label non-kelas, round-trip), kesetaraan kelas,
  prioritas kolom terstruktur, `riwayat_kelas` per TA, naik/turun tingkat,
  **daftar kelas wali Tahap 4A** (`normKelasList`/`adaKelas`/`gabungKelas`/
  `teksKelasList`), **eksekusi blok `KELAS_FALLBACK` app.js**, parse `app.js`,
  dan konsistensi registrasi aset (`index.html` ↔ `sw.js` ↔ `install.js`).
  Skrip ini juga dijalankan di CI (job **Validasi repo**).
- **Manual (setelah Tahap 2 dijalankan):** Master Data → tambah kelas lewat
  Wizard Tingkat/Kelas → periksa tabel:
  `select "Tingkat/Kelas", tingkat, jurusan_kode, rombel, kelas_label from master_data where "Tingkat/Kelas" <> '';`
  → kolom terstruktur terisi dan label lama **tidak berubah**. Data Akun Murid →
  Edit murid → lihat kolom Kelas & kartu/dokumen (jurusan tampil dari kode yang
  benar, termasuk murid berlabel `"10 RPL 1"`). Kenaikan/Turunkan Kelas → murid
  berlabel angka (`"10 RPL 1"`) ikut naik (`"11 RPL 1"`).
- **Drift host:** `npm run check:deploy` kini juga memeriksa `js/kelas.js`
  (keberadaan + penanda `root.KELAS`/`pecah`/`fn_pecah_kelas` + tag `?v=`).

### f. Wali kelas multi-kelas — Tahap 4A (build `20261116b`, SW `v14`)

Satu guru bisa menjadi **wali lebih dari satu kelas** (dan untuk beberapa tahun
pelajaran sekaligus). Model lama hanya punya satu slot — `akun.wali_kelas`
(satu teks) dan `akun.penugasan[TA].wali` (satu string) — sehingga daftar wali
kelas, otorisasi wali/pembina, dan laporan menebak dari string gabungan.

| Bagian | Berkas | Isi |
|---|---|---|
| **4A (SQL)** | `supabase/sql/upgrade_20261116_wali_kelas_multi.sql` | tabel relasi **`wali_kelas_penugasan`** (guru × TA × kelas, generated `kelas_label`) + trigger sinkron dari kolom akun + helper `fn_kelas_sama`/`fn_wali_list`/`fn_ta_berjalan`/`fn_wali_kelas_list`/`fn_wali_kelas_map`/`fn_kelas_murid`/`fn_guru_wali_ada`; `fn_is_wali_kelas`, `akun_guru_ampu_murid`, `ubah_anggota_ekskul`, `fn_akun_json` dibuat ulang (aditif) |
| **4A (frontend)** | `web/js/kelas.js`, `web/js/app.js`, `web/js/utils.js` (+`.example`) | `penugasan[TA].wali` menjadi **array kelas**; form penugasan memakai **checkbox wali** (bukan satu dropdown); kolom lama `wali_kelas` tetap ditulis sebagai cerminan **gabungan koma** |
| **4A (uji)** | `supabase/sql/uji_wali_kelas_multi.sql`, `scripts/uji-kelas.mjs`, `scripts/uji-wali-pglite.mjs` | uji SQL 40+ pemeriksaan (bertransaksi + `rollback`) & 222 pemeriksaan `npm run test:kelas`; uji PGlite opsional menjalankan migrasi di Postgres asli (WASM) |

Aturan yang berlaku:

1. **Sumber kebenaran:** tabel `wali_kelas_penugasan`; `penugasan[TA].wali`
   (array) yang ditulis admin/Edge Function, dan kolom lama `wali_kelas`
   (satu teks, boleh gabungan koma) tetap dibaca sebagai cadangan. Trigger
   `trg_sync_wali_penugasan` menyusun ulang relasi setiap kali `akun` disimpan,
   jadi data lama & jalur tulis lama tetap benar tanpa perubahan klien.
2. **Pembanding kelas selalu kanonik:** `KELAS.sama()` di klien dan
   `fn_kelas_sama()` di SQL, sehingga `"10 RPL 1"` ≡ `"X RPL 1"`.
3. **Kolom lama belum dihapus** (`akun.wali_kelas` & `tingkat_kelas` tetap ada
   dan tetap ditulis). Penghapusannya = **Tahap 4B/4C** (belum dijalankan).
4. **Akses guru wali/pembina** kini memakai irisan {kelas wali guru} ∩ {kelas
   efektif murid (`riwayat_kelas[TA].kelas` ∪ `tingkat_kelas`)} — jadi guru wali
   tetap dapat mengakses muridnya untuk TA mana pun yang terdaftar.

Cara memakai & verifikasi:

- Jalankan migrasinya (project berjalan: berkas di atas; project baru:
  `gabungan.sql` terbaru — blok terakhir).
- **Uji manual tanpa efek samping:** tempel `supabase/sql/uji_wali_kelas_multi.sql`
  ke SQL Editor → semua baris `✔ …` dan diakhiri `UJI WALI MULTI LULUS`
  (seluruh uji di dalam satu transaksi yang di-`rollback`, data uji `UJIWM-*`
  tidak tertinggal).
- **Uji migrasi tanpa Supabase (opsional):**
  `deno run -A --node-modules-dir=auto scripts/uji-wali-pglite.mjs` — menjalankan
  **seluruh** migrasi Tahap 4A pada Postgres asli (PGlite/WASM) di memori, lalu
  menguji helper, trigger/backfill, otorisasi wali multi, mode `fn_akun_json`,
  dan berkas uji SQL di atas (61 pemeriksaan; butuh jaringan sekali).
- Pemeriksaan cepat: `select * from wali_kelas_penugasan order by nis_nip, tahun_pelajaran, kelas_label;`
  lalu `select fn_wali_kelas_list('<NIP>'), fn_wali_kelas_map('<NIP>');`
- Di aplikasi: **Data Akun Guru → Edit** satu guru → bagian *Penugasan per
  Tahun Pelajaran* → centang **dua kelas** pada Wali Kelas → Simpan → tab
  **Daftar Wali Kelas** menampilkan guru itu pada kedua kelas, dan kolom
  `akun.wali_kelas` terisi `"X LP 1, X LP 2"`.

### g. Perbaikan UI Absen/Ekskul/Nilai (build `20261116c`, SW `v15`)

Lima temuan lapangan — **tanpa perubahan SQL** (seluruh perbaikan di frontend):

| # | Temuan | Akar masalah | Perbaikan (berkas) |
|---|---|---|---|
| 1 | Ekskul → **Pilih sub-ekskul** melempar keluar dari modal "Tambah Anggota" | popup Swal sub-ekskul MENGGANTIKAN modal Tambah Anggota; setelah Simpan/Batal modal tidak kembali | `formTambahAnggotaEkskul({ lanjutkan })` + `bacaFilterTambahAnggota()`/`pulihkanFilterTambahAnggota()`; `formPilihSubTambahAnggota()` membuka kembali modal dengan pilihan & filter utuh (`web/js/app.js`) |
| 2 | Modal **Edit Absen Masal** sulit dipakai pada kelas besar | tidak ada pencarian siswa | kotak **Cari Nama / NIS** + sorot hasil + tombol ↑/↓/bersihkan + gulir otomatis (`cariNamaMasal`, `cariNamaMasalLompat`, `bersihkanCariNamaMasal`; kelas CSS `.nm-cari-hit`/`.nm-cari-redup`/`.nm-cari-aktif`) |
| 3 | **Kamera Absen Mandiri** tidak tampil / tidak bisa digulir di HP | shell memakai `100vh` (bilah alamat HP memotong bagian bawah `#main-content`); blok Metode 2 bisa masih `hidden` | `@supports (height:100dvh){#view-dashboard{height:100dvh}}` + `min-height` video + `gantiMetodaAbsen('wajah')` sebelum pindai + `gulirKeWadahKameraMandiri()` (`web/css/input.css`, `web/js/app.js`, `web/js/face.js`) |
| 4 | Dashboard murid: **Absensi Hari Ini** selalu "Belum Absen" | query difilter `tahun`+`semester` (baris hari ini terbuang bila TA/semester berbeda) dan status `D` tidak dihitung | query `absensi` per `nis` saja lewat `supaAmbilSemua` (tidak terpotong batas 1000 baris PostgREST); statistik disaring TA/semester di klien; chip membandingkan tanggal **WIB + lokal**; status **D (Dispen)** ikut dihitung |
| 5 | **Laporan Nilai** berisi baris metadata ("ID Akun Guru", "Wali Kelas", …) | `Object.keys(nilai.data)` memuat kolom metadata yang ditulis modul Input Nilai | metadata dikecualikan (`KOLOM_META_NILAI`), identitas menjadi kartu **NIS/NISN/Kelas/Wali Kelas**, ditambah baris **Pembimbing** pada nilai ekskul |

Catatan teknis:

- **NISN/Wali Kelas** murid dibaca dari RPC `ambil_akun_satu` mode `profil_akun`
  (murid hanya boleh membaca barisnya sendiri) bila tidak ada di sesi.
- **Pembimbing ekskul** di halaman murid: `akunDaftarGuru('guru_pembina')` digerbang
  staf → pada sesi murid nama pembina tidak terbaca, sehingga yang tampil adalah
  **NIP pembina** dari tabel `ekstrakurikuler` (tetap informatif).
- Tidak ada migrasi SQL baru: policy baca `absensi` (`absensi_baca_semua`) sudah
  terbuka untuk sesi murid (anon) — `gabungan.sql` tidak berubah.
- Regresi dijaga otomatis: `npm run test:kelas` (§11 — pola `app.js`) dan
  `npm run test:face` (§8 — kamera Absen Mandiri).



