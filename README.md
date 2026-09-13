# Administrasi-Sekolah

**SIAKAD / SISIP** — Sistem Informasi Hadir Tatap Muka dan Nilai Murid — SMKN 2 Banjar.

Aplikasi web statis (HTML + JS + Tailwind CSS v4) yang terhubung **langsung ke Supabase**
(PostgreSQL + RLS + RPC). Tidak ada backend terpisah — seluruh API memakai Supabase
PostgREST & fungsi RPC.

| Bagian | Lokasi | Keterangan |
|---|---|---|
| Frontend | `web/` | HTML + JS murni + Tailwind v4, `@supabase/supabase-js` via CDN |
| Database | `supabase/sql/` | Skema SQL + upgrade berkala; versi lengkap di `supabase/sql/versi-sekarang/` |
| Deploy | GitHub Pages | Otomatis saat push ke `main` (workflow `.github/workflows/static.yml`, folder `web/`) |

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
| **Project baru / kosong** | `supabase/sql/versi-sekarang/gabungan.sql` — gabungan seluruh 30 upgrade (2026-09-03 s.d. 2026-09-22), sekali jalan |
| **Project sudah berjalan**, tertinggal beberapa upgrade | file satu-persatu di `supabase/sql/`, **urut tanggal**, hanya yang belum ada di database |

3. Salin seluruh isi file ke SQL Editor (atau pakai tombol **upload** file `.sql`)
   → klik **Run** (`Ctrl+Enter`).
4. Verifikasi: buka **Table Editor** — semua tabel & kolom harus sudah muncul
   (`akun`, `master_data`, `absensi`, `nilai`, `ekstrakurikuler`, dst.).

> Semua file SQL **idempotent** (aman dijalankan berulang). Daftar lengkap isi &
> urutan 30 file ada di `supabase/sql/versi-sekarang/README.md`.
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
const SUPABASE_URL_DEFAULT = 'https://lkhuyoihrrnzvrmhquln.supabase.co';
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

## Perintah Cepat

```bash
npm run build:css      # build CSS produksi (minify)
npm run dev:css        # watch mode CSS
npm run test:e2e       # uji E2E API (butuh kredensial & data uji terpasang)
npm run deploy         # sama dengan build:css
```
