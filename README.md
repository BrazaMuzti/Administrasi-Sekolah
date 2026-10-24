# Administrasi-Sekolah

**SISIP** — Sistem Informasi Sekolah Indonesia pintar

Aplikasi web statis (HTML + JS + Tailwind CSS v4) yang terhubung **langsung ke Supabase**
(PostgreSQL + RLS + RPC). Tidak ada backend terpisah — seluruh API memakai Supabase
PostgREST & fungsi RPC.

| Bagian | Lokasi | Keterangan |
|---|---|---|
| Frontend | `web/` | HTML + JS murni + Tailwind v4, `@supabase/supabase-js` via CDN |
| Database | `supabase/sql/` | Skema SQL + seluruh berkas upgrade; skema lengkap untuk project baru = `supabase/sql/gabungan.sql` (82 blok, dirakit otomatis oleh `npm run build:sql`) |
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
| **Project baru / kosong** | `supabase/sql/gabungan.sql` — gabungan seluruh **82 berkas upgrade** (2026-09-03 s.d. 2026-10-28), sekali jalan |
| **Project sudah berjalan**, tertinggal beberapa upgrade | file satu-persatu di `supabase/sql/`, **urut tanggal**, hanya yang belum ada di database |

3. Salin seluruh isi file ke SQL Editor (atau pakai tombol **upload** file `.sql`)
   → klik **Run** (`Ctrl+Enter`).
4. Verifikasi: buka **Table Editor** — semua tabel & kolom harus sudah muncul
   (`akun`, `master_data`, `absensi`, `nilai`, `ekstrakurikuler`, dst.).

> Semua file SQL **idempotent** (aman dijalankan berulang). Daftar lengkap isi &
> urutan 82 berkas ada di `supabase/sql/README.md`. `gabungan.sql` **dirakit otomatis**
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

Sejak upgrade `20261028a`–`20261028d` (lihat `supabase/sql/README.md` entri 69–73):

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
  `cek_sesi_absen`, `simpan_riwayat_murid`, `simpan_ekskul_murid`) menerima
  `p_token` + `p_klaim_nis` (helper `sesiRpc()`), sedangkan RPC penulis Fase B2
  (`ubah_profil_murid`, `ubah_password_sendiri`, `simpan_wajah_murid`,
  `ubah_anggota_ekskul`, `ganti_kunci_absen_ekskul`) **hanya** `p_token`.
  Mengirim argumen yang tidak dideklarasikan fungsi membuat PostgREST
  membalas **PGRST202** ("Could not find the function … in the schema cache").
  Jalankan `npm run test:rpc-args` setiap kali menyentuh nama argumen RPC —
  skrip ini membandingkan 64 titik panggilan RPC di frontend dengan signature
  di `supabase/sql/*.sql` (plus self-test yang membuktikan detektornya bekerja).
- **Urutan deploy wajib:** (1) jalankan `20261028a` → `20261028b` → `20261028b2`
  di Supabase, (2) deploy frontend (`js/app.js?v=20261028f`), (3) baru jalankan
  `20261028c` (RLS ketat) dan `fix_20261028d` (sesi wajib). Rollback RLS cukup
  satu perintah: `alter table akun disable row level security;`.
  Pastikan `npm run test:rpc-args` hijau sebelum deploy frontend, lalu naikkan
  tag `?v=` di `web/index.html` setiap kali `app.js`/`utils.js`/`face.js`
  berubah (tag `20261028f` = perbaikan argumen RPC + tombol "Simpan Perubahan"
  di Data Akun Murid yang dulu gagal dengan PGRST202, ditambah **tombol
  "Install Aplikasi"** PWA & service worker `sw.js`).

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
npm run build:sql      # rakit ulang supabase/sql/gabungan.sql (82 blok)
npm run check:sql      # periksa gabungan.sql sudah sinkron/terdaftar semua
npm run build:icons    # buat ulang ikon PWA (PNG 192/512/maskable + apple-touch)
npm run test:rpc-args  # penjaga PGRST202: argumen RPC frontend vs signature SQL
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

`face.js` ondersteunt **twee engines** teruggabelen aan dezelfde interface (`window.FaceWajah`).
De keuze is per-browser (per apparaat), niet per database — gezet via:

```js
localStorage.setItem('sbg_wajah_motor', 'mediapipe'); // ATAU 'faceapi' (baku)
```

| Motor                                      | Deteksi + landmarks             | Descriptor           | Feature space |
| -------------------------------------------| ------------------------------- | ---------------------| --------------|
| `faceapi` (BAKU, ongewijzid)               | face-api / TFJS (lokal)         | FaceRecognitionNet    | 128           |
| `mediapipe` (nieuw)                        | MediaPipe Face Landmarker (wasm)| MobileFaceNet (ONNX)  | 512           |

- **Zet om**: in de browser-console van het schoolapparaat `localStorage.setItem('sbg_wajah_motor','mediapipe')` → ververs de pagina. Terug: waarde `'faceapi'` of `localStorage.removeItem('sbg_wajah_motor')`.
- **Lokale bestanden** (geen CDN, offline na eerste cache):
  - `web/vendor/mediapipe/vision_bundle.js` + `wasm/vision_wasm_internal.{js,wasm}` (MediaPipe Tasks Vision)
  - `web/vendor/onnx/ort.min.js` + `ort-wasm-simd-threaded.{mjs,wasm}` (ONNX Runtime Web)
  - `web/models/face_landmarker.task` (MediaPipe) en `web/models/mobilefacenet.onnx` (MobileFaceNet, **512-d**)
- **Belangrijk — re-enrollment**: 128-d (face-api) en 512-d (MobileFaceNet) zijn **verschillende feature-ruimten**. Na de switch moeten murids opnieuw geregistreerd worden (modal wajah → "Simpan Data Wajah" met mode `ganti`; de multi-pose pipeline en de 6-sampel cap blijven hetzelfde). Oude 128-rijen blijven in de DB en werken onder motor `faceapi`.
- **Deploy-eis**: draai één keer `supabase/sql/upgrade_20261023_wajah_motor_mediapipe.sql` in de Supabase SQL Editor (geen data-migratie; RPC accepteert 128 & 512). Zie ook `CHECKLIST_E2E.md` → **S14h**.
- **Kwaliteit (offline validatie van dit model)**: identical-face cos≈0.85 (d≈0.54), cross-person cos 0.11–0.19 (d 1.27–1.33) → ambang `JARAK_COCOK_MP=0.80` / `JARAK_KENAL_MP=0.95`; waterscheiding ruim, maar E2E op de zwakste schoolapparaat blijft verplicht (eerste-scan latentie meten).

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
5. Uji manual lengkap ada di `CHECKLIST_E2E.md` → **S14l**.
6. `js/install.js` menyimpan **stempel build** (`BUILD = '20261029a'`; muncul di
   console sebagai `[SISIP] build …` dan sebagai `<html data-sisip-build="…">`).
   Bila stempel di perangkat berbeda, seluruh cache `sisip-*` dihapus lalu halaman
   memuat ulang **sekali** — jadi perangkat yang masih menjalankan berkas lama
   (termasuk service worker rusak / cache `sisip-v1`) sembuh sendiri tanpa siswa
   perlu menghapus data situs. Naikkan `BUILD` bersama tag `?v=` dan `VERSION` di
   `sw.js`.
7. **Dua situs, satu folder `web/`.** Selain GitHub Pages, aplikasi juga disajikan
   Vercel dari repo mirror `BrazaMuzti/SMKN2Banjar` (**Root Directory = `web/`**,
   tanpa `vercel.json`). Folder `web/` di mirror itu **harus selalu identik dengan
   repo ini**; bila hanya salah satu yang diperbarui, siswa menerima berkas campur
   (mis. `js/app.js` baru tetapi `sw.js`/`manifest.json` lama). Histori mirror
   **berbeda** dari repo ini (dibuat lewat unggahan web), jadi `git push mirror main`
   ditolak *non-fast-forward*. Cara yang sudah teruji (2026-10-24):

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

   Verifikasi setelah push: `curl -s https://smkn2banjar.vercel.app/index.html | grep -o 'v=[0-9a-z]*'`
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


