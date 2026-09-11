# CHECKLIST UJI END-TO-END SISIP (Fase 1–4)

Semua data uji ber-prefiks `UJI-` dan dibuat oleh `supabase/sql/uji_data.sql`, dibersihkan oleh `supabase/sql/uji_bersih.sql`.

---

## PERSIAPAN (WAJIB SEBELUM MULAI)

1. Di Supabase Dashboard → SQL Editor, jalankan **berurutan** (idempotent, aman berulang):
   - `upgrade_20260915_proses_kenaikan_rpc.sql`
   - `upgrade_20260916_fase1.sql`
   - `upgrade_20260917_fase2.sql`
   - `upgrade_20260918_fase3.sql`
   - `upgrade_20260919_fase4.sql`
   - `uji_data.sql`
2. Buka aplikasi SISIP, **hard refresh** (Ctrl+F5).
3. Catatan: data uji memakai TA `2026/2027` (berjalan) & `2027/2028` (tujuan). Jika TA sekolah berbeda, sesuaikan pilihan TA di wizard/filter saat menguji.

Akun uji:
| Peran | Login | Password |
|---|---|---|
| Murid uji | `UJI999` | `uji1234` |
| Admin/Guru | akun admin & guru Anda sendiri | — |

---

## A. SEBAGAI ADMIN

### S1 — Tabel Akun Murid & Tombol Kenaikan
- [ ] Menu **Data Akun Murid** → kolom baru **Tahun Pelajaran** tampil (setelah Kelas), UJI Murid E2E terlihat.
- [ ] Tombol **Kenaikan** (violet) ada di toolbar.

### S2 — Wizard Kenaikan (Naik & Turun)
- [ ] Klik **Kenaikan** → modal terbuka dengan filter TA/Kelas/NIS/NISN/Mode.
- [ ] Default filter mengikuti filter tabel utama (mis. pilih Kelas `X UJI` di tabel → wizard otomatis memfilter kelas tsb).
- [ ] Kolom **NISN** & **Tahun Pelajaran** tampil di tabel wizard.
- [ ] Mode **Naik**: centang UJI999 → Proses → konfirmasi → sukses; kolom Kelas UJI999 berubah `XI UJI`.
- [ ] Mode **Turun/Koreksi**: pilih UJI999 → tujuan otomatis `X UJI` → Terapkan → kelas kembali `X UJI` (riwayat TA sumber ditulis ulang).

### S3 — Pembatasan RPC (tetap login admin, console browser F12)
- [ ] Di console jalankan:
      `supaClient.rpc('proses_kenaikan_kelas', { p_ta_tujuan: 'x', p_siswa: [] })`
- [ ] Hasil: `{ status: 'error', message: 'Hanya admin...' }` (boleh dieksekusi tapi ditolak utk guru — diuji lagi di S10).

### S4 — Rapor & Leger
- [ ] Menu **Rapor & Leger** → tab Rapor Siswa → pilih TA + kelas `X UJI` + murid UJI999.
- [ ] Pratinjau muncul (nilai boleh kosong) → **Cetak Rapor PDF** membuka lembar rapor lengkap.
- [ ] **Simpan Catatan Wali** → toast sukses; catatan muncul kembali saat pratinjau dibuka ulang & ikut di PDF.
- [ ] Tab **Leger Nilai** → Tampilkan → tabel muncul → **Excel** & **PDF** terunduh/tercetak.

### S5 — Jadwal Ujian & Kartu Ujian
- [ ] Menu **Jadwal & Libur** → tab **Jadwal Ujian** → Tambah Jadwal (jenis `UJI-SUM`, kelas milik Anda, 2 mapel).
- [ ] **Cetak Kartu Ujian** (jenis `UJI-SUM`) → PDF: 1 kartu/halaman per siswa dengan QR NIS + daftar ujian.

### S6 — Pengumuman
- [ ] Menu **Surat & Pengumuman** → tab Pengumuman → tambah: target **Kelas tertentu** = kelas Anda.
- [ ] Dashboard admin: widget **Pengumuman Sekolah** menampilkan `UJI Pengumuman E2E`.

### S7 — Generator Surat
- [ ] Tab **Arsip Surat** → Buat Surat → pilih murid UJI999, jenis **Keterangan Aktif** → nomor otomatis `001/KET-AKT/…` → **Cetak & Arsipkan** → PDF dengan kop sekolah.
- [ ] Arsip bertambah → tombol **Cetak Ulang** membuka PDF yang sama → ubah status surat? (hapus arsip uji bila mau).

### S8 — SPP & Buku Kas
- [ ] Menu **SPP & Buku Kas** → tab Tagihan: filter jenis SPP → tagihan UJI999 (Rp50.000) muncul.
- [ ] Klik **Bayar** → metode Tunai → lunas + **kuitansi PDF otomatis** (No. `001/KWT/…`).
- [ ] Tab **Kas Sekolah**: baris masuk Rp50.000 otomatis; saldo = masuk − keluar; **Tambah Transaksi** manual (Keluar Rp10.000) → saldo berkurang.
- [ ] Rekap tunggakan tidak lagi menampilkan UJI999.

### S9 — Poin Siswa
- [ ] Menu **Poin Siswa** → tab Kategori → **Muat Preset Standar** (16 kategori muncul).
- [ ] Tab Catat Poin → **Catat Poin**: kelas `X UJI` → murid UJI999 → kategori `UJI-Test Pelanggaran` (1 poin) → simpan.
- [ ] Tab Rekap → kelas `X UJI` → UJI999: Poin Pelanggaran 1, status **A · Baik**; detail catatan terbuka; Excel/PDF terunduh.

### S9b — Inventaris
- [ ] Menu **Inventaris** → Daftar Barang: kartu ringkasan (2 jenis UJI); edit/hapus tampil.
- [ ] Tab Peminjaman → **Pinjam Barang** → tipe Guru → pilih nama → barang `UJI-INV-001` jumlah **4** → **ditolak** (stok 3); jumlah 2 → berhasil.
- [ ] Tabel aktif muncul → **Kembalikan** (kondisi Baik) → pindah ke riwayat.
- [ ] Daftar Barang → Excel & PDF terunduh.

### S9c — Arsip Dokumen
- [ ] Menu Surat & Pengumuman → tab **Arsip Dokumen** → Tambah (judul `UJI Dokumen`, link Drive apa pun) → baris muncul; tombol buka & salin tautan berfungsi; Excel terunduh; hapus dokumen uji.

### S9d — PPDB
- [ ] Menu **PPDB** → Calon Siswa: rekap menampilkan 1 calon `UJI Calon E2E` (TA 2027/2028).
- [ ] **Ubah Status** → Diterima (catatan "uji konversi").
- [ ] **Jadikan Akun Murid** → NIS `UJI998`, kelas milik Anda, TA 2027/2028, password 123456 → "Akun Murid Dibuat!".
- [ ] **Data Akun Murid** → cari `UJI998` → akun ada; profil ortu/alamat terbawa (klik Edit).
- [ ] Tab **Statistik** → kartu Diterima & Siap Konversi berkurang; jalur & asal sekolah tampil.
- [ ] **Import Excel**: unduh template → isi 1 baris → import → calon baru muncul dengan no. daftar otomatis.

---

## B. SEBAGAI GURU (logout admin → login guru)

### S10 — Pembatasan peran
- [ ] Menu **Data Akun Murid**: tombol **Kenaikan TIDAK tampil**.
- [ ] Console: `supaClient.rpc('proses_kenaikan_kelas', { p_ta_tujuan: 'x', p_siswa: [] })` → **ditolak** "Hanya admin".
- [ ] Sidebar TIDAK memuat: SPP & Buku Kas, Inventaris, PPDB, Surat & Pengumuman.
- [ ] **Poin Siswa**: bisa mencatat poin (tombol Catat Poin), TIDAK ada tab Kategori, TIDAK ada tombol hapus catatan.
- [ ] **Perpustakaan**: bisa pinjam/kembalikan; TIDAK ada tombol Tambah Buku/Edit/Hapus.
- [ ] **Rapor & Leger**: jika guru bukan wali kelas UJI (kelas uji tidak diwali) → pesan khusus wali; guru wali kelas nyata → hanya kelasnya yang terpilih.

### S11 — Perpustakaan (transaksi guru)
- [ ] Tab Katalog → buku `UJI-001` Tersedia `2/2` → klik ikon pinjam → **Scan/ketik NIS `UJI999` + Enter** → murid terisi otomatis → Catat Peminjaman.
- [ ] Pinjam `UJI-002` juga → Pinjaman Aktif bertambah; Tersedia `UJI-001` jadi `1/2`, `UJI-002` `0/1`.

### S12 — Pengumuman target guru (opsional)
- [ ] (admin buat pengumuman target Guru via admin) → dashboard guru menampilkannya.

---

## C. SEBAGAI MURID UJI (login `UJI999` / `uji1234`)

### S13 — Widget & menu murid
- [ ] Dashboard murid: widget **Pengumuman Sekolah** (`UJI Pengumuman E2E`) & **Poin Saya** (1 poin, status A) tampil.
- [ ] Menu **Perpustakaan** (versi murid) → **Pinjaman Saya**: buku `UJI-001/002` terlihat + status; katalog baca-saja (tanpa tombol pinjam/edit).
- [ ] **Laporan Nilai** → tombol **Rapor Saya (PDF)** → pilih TA/semester → PDF terbuka.

### S14 — Regression ringan menu lama
- [ ] **Absen Mandiri** & **Laporan Saya** tetap berfungsi; dashboard tidak error di console.

---

## D. SELESAI UJI

### S15 — Bersih-bersih
- [ ] Di SQL Editor jalankan `uji_bersih.sql`.
- [ ] Verifikasi: Data Akun Murid (cari `UJI`) kosong; Perpustakaan/Inventaris tanpa `UJI-`; pengumuman uji hilang dari dashboard; **hard refresh** aplikasi.
- [ ] Catat NIS yang dipakai saat konversi — jika bukan `UJI998`, hapus manual di Data Akun Murid.

---

**Cara melaporkan hasil:** tuliskan nomor skenario + ✅/❌ + pesan error (screenshot/console) — mis. `S8 ❌ kuitansi tidak terunduh, console: …`. Bug akan saya perbaiki di `app.js`.

---

# OTOMASI TINGKAT 1 — API (tanpa browser)

Skrip `scripts/e2e-api.mjs` menjalankan alur bisnis inti secara otomatis (±35 assertion): login admin/guru, buat murid uji via RPC, kenaikan naik/turun/tolak-guru, perpus + denda telat, SPP → kas, poin + ambang, PPDB → konversi akun, pembacaan murid-anon + proteksi tabel — lalu membersihkan data ujinya sendiri.

## Persiapan sekali saja
1. **Akun uji email** — script otomasi memakai **EMAIL + password Supabase Auth** (bukan NIS/NIP/password lokal):
   - Supabase Dashboard → **Authentication → Users → Add user**: buat `uji-admin@example.com` & `uji-guru@example.com` (email dikonfirmasi otomatis/centang auto-confirm).
   - **Penting**: akun auth tsb harus terhubung ke tabel `akun` (kolom `user_id` = id user auth) dengan `tipe` yang benar (`admin`/`guru`). Jika akun admin/guru Anda biasa dipakai login aplikasi, email & passwordnya adalah yang dipakai saat login aplikasi — **cari di Authentication → Users** untuk memastikan emailnya.
2. Pastikan upgrade SQL sudah jalan (termasuk **`upgrade_20260920_murid_rpc.sql`**, **`upgrade_20260921_rls_policies.sql`** — WAJIB: mengaktifkan policy RLS semua tabel Fase 1–4 sehingga admin/guru bisa menulis dan menutup akses anon ke tabel sensitif — dan **`upgrade_20260922_nilai_murid_rpc.sql`** — RPC rapor murid).

## Menjalankan
```bash
E2E_ADMIN_EMAIL=uji-admin@example.com E2E_ADMIN_PASS=… \
E2E_GURU_EMAIL=uji-guru@example.com  E2E_GURU_PASS=… npm run test:e2e
```

- URL & anon key otomatis dibaca dari `web/js/utils.js`.
- **Login gagal "Invalid login credentials"?** → kredensial yang dimasukkan bukan pasangan email+password Supabase Auth yang valid (jangan NIS/NIP seperti `admin1` atau NIP; dan password guru = password Supabase Auth, bukan `123456` lokal). Skrip berhenti di awal dengan pesan penjelas.
- **Idempotent** — aman dijalankan ulang meski `uji_data.sql` sudah pernah dijalankan (insert memakai upsert).
- Hasil: ringkasan `PASS/FAIL` per assertion; `FAIL` → laporkan barisnya.

## Catatan
- Sisa `akun_kredensial` (UJI999/UJI998) tak terjangkau API (RLS) — bersihkan via `uji_bersih.sql`.
- Otomasi menguji **alur data & permission**; alur klik UI tetap lewat checklist manual di atas (wiring sudah diaudit statis).