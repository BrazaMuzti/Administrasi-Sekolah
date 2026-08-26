# Administrasi-Sekolah

Sistem Informasi Hadir Tatap Muka dan Nilai Murid (SIAKAD) — SMKN 2 Banjar.
Frontend statis di `web/`, backend Google Apps Script di `apps-script/`.

## Struktur
```
web/            Frontend (HTML + JS + Tailwind CSS v4)
apps-script/    Backend Google Apps Script (API.gs, Auth.gs, Kode.gs)
```

## Setup & Menjalankan Frontend

```bash
npm install                     # pasang Tailwind + clasp (devDependencies)
npm run build:css               # kompilasi Tailwind -> web/css/style.css
npm run dev:css                 # (opsional) mode watch saat develop
```

Buka `web/index.html` (bisa via server statis sederhana, mis. `npx serve web`).

## Deploy Backend ke Google Apps Script

Backend memakai `@google/clasp`. `apps-script/.clasp.json` sudah berisi `scriptId`.

```bash
npm run login:gas               # sekali saja: login ke akun Google
npm run push:gas                # dorong apps-script/ ke Apps Script
npm run deploy                  # build CSS + push backend (satu perintah)
```

Wajib login + push ulang SETIAP kali `apps-script/*.gs` (mis. `Auth.gs`) diubah,
karena login & API hanya berfungsi setelah kode terbaru di-deploy.

> Catatan: hasil kompilasi `web/css/style.css` dibuat dari `web/css/input.css`
> (Tailwind utilitas + CSS kustom glassmorphism).
