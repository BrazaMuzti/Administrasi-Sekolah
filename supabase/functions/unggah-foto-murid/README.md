# unggah-foto-murid — Setup Manual (Google Apps Script)

Edge Function ini mengunggah foto siswa ke **Google Drive** (bukan Supabase Storage)
lewat perantara **Google Apps Script (GAS) Web App**, lalu menyimpan URL hasilnya ke
`akun.url_foto`.

> **Kenapa lewat GAS?** Dengan Google Drive API langsung, Edge Function terikat kuota
> standar API dan perlu mengelola kunci service account. Lewat GAS, unggahan dijalankan
> atas nama akun Google pemilik script (*Execute as: Me*) sehingga lebih sederhana,
> dan kredensial Google (folder tujuan) tidak pernah keluar dari script.

> **Prasyarat database:** jalankan `supabase/sql/upgrade_20261011_akun_murid_foto_medsos.sql`
> (membuat kolom `url_foto`, `alamat_maps`, `media_sosial` + RPC `simpan_foto_murid`).

## Siapkan Google Apps Script (GAS) di Google Drive Anda

1. Buka <https://script.google.com/> dan buat proyek baru.
2. Beri nama proyek, lalu masukkan kode script berikut untuk menerima file upload:

```javascript
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // 1. (DISARANKAN) Verifikasi token rahasia — cegah orang asing mengisi Drive.
    //    Set Script Property "UPLOAD_TOKEN" dulu (lihat langkah 3).
    var tokenBenar = PropertiesService.getScriptProperties().getProperty("UPLOAD_TOKEN");
    if (!tokenBenar || data.token !== tokenBenar) {
      return kirimJson({ status: "error", message: "Token tidak valid." });
    }

    // 2. (DISARANKAN) Validasi tipe file & ukuran
    var mime = String(data.mimeType || "");
    if (["image/jpeg", "image/png", "image/webp", "image/gif"].indexOf(mime) === -1) {
      return kirimJson({ status: "error", message: "Tipe file tidak diizinkan." });
    }
    var b64 = String(data.base64 || "");
    if (!b64 || b64.length < 100) return kirimJson({ status: "error", message: "Foto kosong." });
    if (b64.length > 4700000) return kirimJson({ status: "error", message: "Ukuran foto melebihi 3,5 MB." });

    var folderId = "MASUKKAN_FOLDER_ID_GOOGLE_DRIVE_ANDA_DI_SINI"; // ID folder tujuan di Drive
    var folder = DriveApp.getFolderById(folderId);

    // Decode data base64 gambar
    var decodedData = Utilities.base64Decode(b64);
    var blob = Utilities.newBlob(decodedData, mime, String(data.filename || "foto.jpg"));

    // Simpan file ke Google Drive
    var file = folder.createFile(blob);

    // Set agar file bisa diakses publik (opsional, jika ingin link gambarnya bisa langsung dibuka)
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return kirimJson({
      status: "success",
      fileId: file.getId(),
      fileUrl: "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w1000",
      viewUrl: file.getUrl(),
      downloadUrl: file.getDownloadUrl()
    });
  } catch (error) {
    return kirimJson({ status: "error", message: error.toString() });
  }
}

function kirimJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

> **Catatan:** versi lengkap + berkomentar ada di file `Code.gs` di folder fungsi ini
> (ID folder & token dibaca dari Script Properties, bukan hardcode). File `index.ts`
> di repo mengirim `{ filename, mimeType, base64, token }` — bila snippet di atas
> disederhanakan, pastikan nama field tetap sama.

3. **Ganti folder ID**: ganti literal `"MASUKKAN_FOLDER_ID_GOOGLE_DRIVE_ANDA_DI_SINI"`
   dengan **ID folder** tujuan — hanya potongan 33 karakter setelah `/folders/` di URL
   Drive (mis. `1AbC...xyz`), **BUKAN URL lengkap** dari address bar.
4. **(Disarankan) Pasang token**: buka **Project Settings → Script Properties** →
   tambahkan `UPLOAD_TOKEN` dengan token acak ±32 karakter (mis. `openssl rand -hex 24`).
   Token ini HARUS sama dengan secret `GAS_UPLOAD_TOKEN` di Supabase.
5. **Deploy**: **Deploy → New deployment → Web app**:
   - *Description*: `unggah-foto-murid`
   - *Execute as*: **Me**
   - *Who has access*: **Anyone** (wajib agar bisa dipanggil programatik dari Edge Function)
   - Salin **URL `/exec`** (mis. `https://script.google.com/macros/s/XXXXXXXX/exec`).
6. Setiap kali kode script **diedit**, wajib buat **versi baru**
   (Deploy → Manage deployments → Edit → **New version**) — perubahan tidak aktif otomatis.

## Set secret di Supabase

Dua secret wajib diset: `GAS_UPLOAD_URL` (URL `/exec` GAS) dan `GAS_UPLOAD_TOKEN`
(token — sama dengan Script Property `UPLOAD_TOKEN`).

### Cara 1 — lewat CLI

```
supabase secrets set GAS_UPLOAD_URL='https://script.google.com/macros/s/XXXXXXXX/exec'
supabase secrets set GAS_UPLOAD_TOKEN='<token-acak-sama-dengan-UPLOAD_TOKEN>'
```

### Cara 2 — lewat Dashboard (tanpa login CLI)

1. Dashboard → pilih project → menu **Edge Functions** → tab **Secrets**.
2. Klik **New secret** → *Name* `GAS_UPLOAD_URL`, *Value* = URL `/exec` lengkap.
3. Klik **New secret** → *Name* `GAS_UPLOAD_TOKEN`, *Value* = token acak yang sama
   dengan Script Property `UPLOAD_TOKEN` di project GAS.
4. Setelah secret diset, **deploy ulang fungsi** (lihat bagian "Deploy") — secret baru
   terbaca oleh fungsi yang sudah berjalan hanya setelah deploy ulang.

> Secret lama `DRIVE_SERVICE_ACCOUNT_JSON` / `DRIVE_MURID_FOLDER_ID` dari metode
> service account tidak dipakai lagi — boleh dihapus dari Dashboard bila ingin.

## Deploy

> **Fungsi yang belum di-deploy = HTTP 404.** Set secret saja TIDAK membuat fungsi
> muncul di `https://<ref>.supabase.co/functions/v1/unggah-foto-murid`. Wajib deploy
> dulu, baru upload dari browser bisa jalan.

### Cara 1 — lewat CLI

```
npx supabase functions deploy unggah-foto-murid --project-ref <PROJECT_REF>
```

### Cara 2 — lewat Dashboard (tanpa login CLI)

1. Dashboard → pilih project → menu **Edge Functions** → tombol **Deploy a function**.
2. Bila diminta, hubungkan repositori GitHub (pilih repo & folder yang memuat
   `supabase/functions`).
3. Pilih fungsi `unggah-foto-murid` → **Deploy**, lalu tunggu status **Deploying → Ready**.

> `config.toml` sudah memuat `[functions.unggah-foto-murid] verify_jwt = false`
> — wajib karena murid lokal (login NIS+password) tidak punya JWT Supabase.
> Otorisasi tetap dijaga: RPC `simpan_foto_murid` hanya mengizinkan **admin** atau
> **murid pemilik NIS**, dan token GAS tidak pernah keluar server.

## Pemecahan Masalah

| Gejala | Penyebab | Solusi |
|---|---|---|
| 404 `NOT_FOUND` di URL fungsi | Fungsi belum di-deploy | `npx supabase functions deploy unggah-foto-murid --project-ref <PROJECT_REF>` atau Dashboard → Edge Functions → Deploy. |
| CORS preflight gagal (browser: "Status code: 404") | Akibat 404 di atas — browser tak bisa preflight ke fungsi yang belum ada | Deploy dulu. Fungsi menangani `OPTIONS` (balas 200 + `Access-Control-Allow-Origin: *`). |
| 401 `Unauthorized` | Header `apikey`/`Authorization` tidak terkirim | Pastikan `web/js/utils.js` berisi `SUPABASE_URL` & anon key project yang sama dengan ref deploy. |
| 500 `Upload Drive belum dikonfigurasi admin` | Salah satu secret belum diset | Set `GAS_UPLOAD_URL` & `GAS_UPLOAD_TOKEN`, lalu **deploy ulang**. |
| GAS balas `Token tidak valid` | Token beda antara Supabase & GAS | Samakan `GAS_UPLOAD_TOKEN` (Supabase) dengan Script Property `UPLOAD_TOKEN` (GAS). |
| GAS balas `Respons ... tidak terbaca` / HTML | GAS error di luar try/catch, atau versi web app belum di-update | Cek tab **Executions** di editor GAS; buat **New version** setelah edit. |
| `Gagal mengunggah: ...` dari GAS | Folder ID salah / folder tidak ditemukan / token salah | Periksa folder ID (hanya 33 karakter) & Script Properties; pastikan script jalan sebagai **Me** (pemilik folder). |
| Foto tidak tampil di aplikasi/cetak | Akses file belum "anyone reader" | Pastikan `file.setSharing(ANYONE_WITH_LINK, VIEW)` berjalan; domain Workspace tertentu memblokirnya — pakai `Drive.Permissions.insert`. |
| GAS balas `Service accounts do not have storage quota...` | Script GAS yang aktif masih kode LAMA metode service account (menandatangani JWT dengan `private_key` lalu memanggil Drive API langsung). `DriveApp` (versi repo) TIDAK pernah menghasilkan pesan ini — pesannya persis ciri upload via kredensial service account | Ganti SELURUH isi script GAS dengan `Code.gs` versi repo (DriveApp saja); hapus Script Property `DRIVE_SERVICE_ACCOUNT_JSON`/`DRIVE_MURID_FOLDER_ID` bila masih ada; deploy **New version**; pastikan `GAS_UPLOAD_URL` di Supabase menunjuk URL `/exec` deployment baru (lalu deploy ulang fungsi). |
| Error jaringan tidak jelas di browser | Halaman dibuka lewat `file://` | Buka lewat server `python3 -m http.server 3007 -d web` atau GitHub Pages. |

## Perilaku

- Nama file: `{NIS}_{TA}_{Kelas}.jpg` (disanitasi) — contoh `12045_2026-2027_XII-TKJ-1.jpg`.
- File di-upload dengan izin **"Siapa saja yang memiliki link → Pembaca"** (anyone reader),
  sehingga `<img>` di aplikasi & lembar cetak bisa menampilkannya tanpa login Google.
- URL yang disimpan: `https://drive.google.com/thumbnail?id=<FILE_ID>&sz=w1000`.
- File Drive lama tidak dihapus otomatis saat foto diganti (agar aman); hapus manual
  di folder bila perlu.