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
   - `upgrade_20260926_ekskul_akses_guru.sql` (akses pengurus ekskul + jabatan_ekskul_map + multi-pembina)
   - `upgrade_20260927_sub_ekskul_anggota.sql` (kolom anggota sub-ekskul + self-healing kolom ekskul/surat — perbaikan "Simpan" Edit Profil)
   - `upgrade_20260928_rpc_akun_murid.sql` (RPC profil/password/laporan-nilai murid + kolom Master Data "Jabatan Ekstrakurikuler" — perbaikan "Simpan Perubahan" murid)
   - `upgrade_20260929_jadwal_pelajaran.sql` (tabel jadwal_pelajaran lengkap + RLS/grant — perbaikan "Simpan Jadwal")
   - `upgrade_20261027_role_hybrid_opsiC.sql` (helper peran `fn_*` + RLS ketat nilai/absensi — WAJIB untuk Fase B)
   - `upgrade_20261028a_sesi_lokal_murid.sql` (Fase B: tabel `sesi_lokal` + token sesi murid dari server)
   - `upgrade_20261028b_rpc_akun.sql` (Fase B: RPC baca/tulis tabel `akun`)
   - `upgrade_20261028b2_token_rpc_murid.sql` (Fase B: RPC murid wajib `p_token`)
   - `upgrade_20261028c_rls_akun_ketat.sql` (**BARU jalankan setelah frontend baru ter-deploy** — RLS ketat `akun` + `revoke all from anon`)
   - `fix_20261028d_sesi_wajib.sql` (**terakhir** — klaim NIS tanpa token ditolak; murid lama diminta login ulang)
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

### S14b — Admin "Edit data siswa" (Data Akun Murid) akses penuh (Req A)
- [ ] Login **admin** → menu **Data Akun Murid** tampil.
- [ ] Tombol **Edit** (pencil) & **Hapus** tampil pada baris akun murid; klik bisa jalan.
- [ ] Tombol **Tambah** Akun Murid jalan (add & edit via RPC `buat_akun_murid`).
- [ ] (console) `bisaEditAkunMurid()` → `true` utk admin.

### S14c — Absen Mandiri: dua metode — Kode Captcha / Face Scan NIS (Req B1)
- [ ] Login murid `UJI999` → **Absen Mandiri** → guru telah membuka sesi (Kunci Absen → BUKA) voor mapel/ekskul.
- [ ] Selector **Metode Absen** tampil met 2 puns: **Kode Captcha** (actief standaard) en **Face Scan**.
- [ ] **Metode 1 — Kode Captcha**: kies mapel, ketik kode captcha → klik **Saya Hadir Hari Ini** → baris `absensi` status `'H'` (wajah_cocok=false). Kode kosong → toast "Captcha kosong!" zonder API-request.
- [ ] **Metode 2 — Face Scan (NIS)**: klik pun **Face Scan** → alleen blok kamera tampil (input kode captcha niet zichtbaar/aktief).
- [ ] Hadapkan wajah lurus ke kamera → saat cocok (descriptor eigen NIS), **hadir langsung tercatat** in tabel `absensi` (status `'H'` & `wajah_cocok=true`) **zonder kode captcha** en zonder klik "Saya Hadir Hari Ini".
- [ ] UI tampil "Wajah terverifikasi — … — hadir langsung tercatat"; kamera berhenti; tombol reset "Pindai Wajah Saya".
- [ ] Metode 2 zonder wajah geregistreerd/actief → geen hadir (face.js melding amber).
- [ ] Metode 2 terwijl kamera loopt → klik pun **Kode Captcha** → kamera stopt ("Pemindaian wajah dihentikan omdat aksi lain").

### S14d — Kamera berhenti di aksi lain saat face scan (Req B2)
- [ ] Mulai pemindaian wajah → **fokus/ketik kode captcha** → kamera berhenti & status "Pemindaian dihentikan".
- [ ] Mulai pemindaian wajah → **ganti mapel** (dropdown) → kamera berhenti.
- [ ] Mulai pemindaian wajah → **ganti metode** (pun Kode Captcha) → kamera berhenti.
- [ ] Mulai pemindaian wajah → tombol **Berhenti** → kamera berhenti.
- [ ] Kamera berjalan saat klik **Pindai Wajah** (toggle) ulang → berhenti.

### S14e — Switching kamera depan/belakang tidak flip/mirror lagi (Req B3)
- [ ] Mulai pemindaian wajah → klik **Belakang** (ha perangkat kamera-singleton, kamu tetap depan) → pratinjau **tidak** terflip/mirrored.
- [ ] Klik **Depan** → mirror normal (selfie); switch idem ganti label & ring pada tombol aktif.

### S14f — Header dashboard tampil penuh di Firefox Android / layar sempit (Req A)
- [ ] Login (admin/guru/murid) → **Firefox Android** (atau jendela browser sempit <640px) → header menampilkan: **logo sekolah, nama sekolah, waktu sekarang (jam berjalan), tanggal sekarang (hari, tgl, bulan, tahun)**.
- [ ] **Tentang Aplikasi** (tombol ⓘ) tampil & klik → popup Tentang terbuka.
- [ ] **Profil Akun** (avatar) tampil & klik → popup Profil terbuka.
- [ ] Nama sekolah panjang → menyingkat (truncate) tanpa mendorong tombol Tentang/Profil keluar layar; jam & tanggal tetap terlihat.
- [ ] Date berjalan setiap detik bersama jam (tidak lagi `hidden sm:inline`).

### S14g — Akses \"Tambah Anggota\" Ekstrakurikuler: Admin, Wali kelas, Pembina, Jabatan Anggota (Req B)
- [ ] Login **Admin** → menu Ekstrakurikuler → tombol **Tambah Anggota** tampil & bisa dipakai.
- [ ] Login **guru Wali Kelas** → Tambah Anggota tampil & bisa dipakai (semua ekskul).
- [ ] Login **guru Pembina** ekskul X → Tambah Anggota tampil untuk ekskul X (yang diampu) & bekerja; untuk ekskul yang TIDAK diampu → tombol tidak tampil.
- [ ] Login **guru biasa** (bukan wali kelas / bukan pembina) → Tambah Anggota **tidak** tampil.
- [ ] Login **murid pengurus** (menjabat) ekskul X → Tambah Anggota tampil untuk ekskul X & bekerja.
- [ ] (backend) Panggil langsung RPC `ubah_anggota_ekskul` sebagai guru biasa → ditolak pesan \"Hanya wali kelas atau pembina …\".
### S14h — Motor wajah mediapipe (MediaPipe + MobileFaceNet/ONNX)
Vereiste: migratie `upgrade_20261023_wajah_motor_mediapipe.sql` al gedraaid in SQL Editor; de bestanden
`web/vendor/mediapipe/*`, `web/vendor/onnx/*`, `web/models/face_landmarker.task`,
`web/models/mobilefacenet.onnx` aanwezig.
- [ ] **Activatie**: browser-console `localStorage.setItem('sbg_wajah_motor','mediapipe')` → hard refresh → console geen `FaceLandmarker`/`ort`-fouten; Network tab toont `vision_wasm_internal.wasm` + `ort-wasm-simd-threaded.{mjs,wasm}` + `face_landmarker.task` + `mobilefacenet.onnx` (200 / cache 200).
- [ ] **Fallback/uit**: `localStorage.setItem('sbg_wajah_motor','faceapi')` (of `removeItem`) → refresh → `face-api` motor weer normaal (S14 blijft groen).
- [ ] **Registrasi (re-enrollment)**: modal wajah van een murid → model laadt (landmarker ±3,7MB + wasm) → "Gunakan Foto" of "Gunakan Kamera" werkt; **Simpan Data Wajah** → in SQL: `wajah_descriptor` voor die NIS heeft nu array(s) met **512** getallen (voorheen 128); RPC accepteert het (geen "array 128 angka" error).
- [ ] **Oude data**: rij die nog 128-cijferig is blijft gewoon in DB; status-kolom toont "Aktif" maar matcht niet onder mediapipe (descriptor-ruimte verschilt) — zie README §7a voor re-enrollment.
- [ ] **Face Scan absenti (S14c herhaling)**: tombol "Pindai Wajah Saya" → kamera → bij cocok (eigen NIS) hadir 'H' + wajah_cocok=true **zonder captcha**; bij niet-cocok (ander gezicht / murid zonder geldige 512-d registratie) geen hadir + status melding.
- [ ] **Eerste-scan latentie meten op ZWAKSTE apparaat**: eerste `detectForVideo` na model-load respondeert (warm) en per-frame embed ≤ 300 ms; noteer de gemeten getallen hier: ____________.
- [ ] **iOS Safari / toestellen zonder WASM-SIMD** (indien in parool): `vision_wasm_nosimd_internal.*` niet gevend → duidelijke MediaPipe-foutmelding in de modal (geen hang/modal-stil); fallback: `sbg_wajah_motor='faceapi'` of vendor de `_nosimd`-paren (README §7a).
- [ ] **Ambang**: twee selfies van dezelfde leerling (licht toch anders) → cocok; leerling met zonnebril/masker → "tidak dikenal" (geen valse hadir). Bij twijfel pas `JARAK_COCOK_MP`/`JARAK_KENAL_MP` aan in `face.js` (regio 0a).

### S14i — Jadwal Piket v3: kartu per hari + popup pemilih + filter (Req B)
Prasyarat: migrasi `upgrade_20261020b_piket_tabel_multi.sql` sudah dijalankan di SQL Editor.
- [ ] Login **admin/guru pembina** → Ekstrakurikuler → Jurnal & Program Kerja → **Jadwal Piket** → tombol **Buka Jadwal** (tirai kunci) → tampil **kartu per hari** mulai dari HARI INI (badge "Hari ini"/"Berikutnya"), bukan lagi tabel matrik.
- [ ] Klik kepala kartu → daftar petugas muncul/sembunyi (panah ↑/↓ ikut berubah); kartu "Hari Ini" otomatis di-scroll **sekali** saat halaman dibuka dan **tidak** melompat lagi saat menggulir.
- [ ] Tombol **Lihat semua hari (n hari lain)** → semua hari aktif tampil; **Ringkas (Hari Ini & Berikutnya)** → kembali 2 kartu; status bertahan setelah refresh (per ekskul+tabel).
- [ ] Chip nama di **Antrian Siswa** → popup **Pilih Hari Piket**: centang 2 hari → Simpan → siswa muncul di kedua kartu hari tersebut; buka lagi, hapus semua centang → siswa kembali ke Antrian. **Tidak ada drag & drop** (menggeser layar tidak memindahkan chip).
- [ ] Tombol **Tambah** pada kartu hari → popup daftar siswa + filter **ID Tahun / Kelas / Sub-Ekskul / Cari Nama-NIS** (hasil urut A–Z); siswa yang sudah terjadwal hari itu bertanda "sudah" & tidak terceklis ulang; Simpan → semua yang dicentang masuk hari itu dalam **satu kali** tulis.
- [ ] (opsional, DB) `select nama, hari, piket from tabel_piket_ekskul where ekskul='…'` → berubah tepat sekali saat menekan Simpan (tidak ada penulisan berulang saat membuka popup).
- [ ] Ceklis hadir: klik ○/✓ pada chip petugas → `cek=true` + `cek_by`/`cek_at` terisi (progres kartu ikut naik); tombol ✕ mengeluarkan petugas dari hari itu (kembali ke Antrian); saat tabel **di-lock**, tombol Tambah/✕/popup penyusun tidak tersedia tetapi ceklis tetap boleh.
- [ ] **Info Ekskul** (murid) → kartu Jadwal Piket: tombol Lihat/Ringkas/Lihat Lengkap tetap bekerja, kartu hari tampil **read-only** (tanpa tombol kelola) & klik kartu tetap membuka daftar petugas.
- [ ] **Ekspor cetak/PDF** jadwal piket → tabel Hari × Petugas tampil rapi (memakai renderer cetak terpisah, bukan kartu).
- [ ] **Persuratan → Surat Dispensasi → Pilih Siswa**: popup kini berfilter ID Tahun/Kelas/Sub-Ekskul/Cari; centang beberapa siswa → ubah lalu kosongkan filter → **ceklis tidak hilang** (penghitung "n siswa tercentang" tetap sama); "Ceklis Semua (tampak)" hanya mencentang baris yang tampil (baris tersembunyi tetap utuh); Simpan → label jumlah siswa terpilih benar dan pada isi surat, `sub` terisi nama sub (bukan daftar berkoma).
- [ ] **Profil → daftar anggota** (ikon kartu) & daftar jabatan → modal **Profil Anggota**: nama, NIS/NISN, kelas, ID Tahun, TTL, agama, gol. darah, jabatan & sub. Sebagai admin/guru/pengurus → blok kontak & keluarga tampil; sebagai **murid anggota** → tertutup pesan kunci.
- [ ] Sebagai admin/guru wali-pembina: **Edit Data** → ubah No HP/WA + Alamat (lainnya dikosongkan) → Simpan → toast sukses & modal menampilkan nilai baru, kolom lain **tidak** ikut kosong. Sebagai guru, tidak ada permintaan/penulisan password.
- [ ] (backend) Sebagai guru, panggil RPC `buat_akun_murid` dengan `password` terisi → ditolak "Guru tidak berhak mengubah password murid. Minta admin untuk reset password."

### S14j — Profil Ekskul mobile: daftar anggota 2 kolom + WA klik-chat
- [ ] Login **admin/guru pembina/pengurus** → Ekstrakurikuler → **Profil**: daftar **Anggota Aktif** kini **2 kartu per baris** di HP (tiap kartu: nomor + nama (terpotong `…`), kelas, badge jabatan kecil, rekap ringkas `H… S… I… A… · n%`; bila belum ada absensi → "tanpa absensi").
- [ ] Kartu anggota **tidak lagi** memuat chip/tombol **Sub-Ekskul** maupun ikon **WA**; klik di bagian mana pun dari kartu → modal **Profil Anggota** terbuka (nama panjang tetap terbaca utuh lewat tooltip/`title`).
- [ ] Modal Profil Anggota: baris **No HP/WA** & **HP Orang Tua** tampil sebagai tombol hijau WhatsApp → diklik membuka aplikasi/web WA + chat ke nomor tersebut (nomor `0…` otomatis jadi `62…`) dengan pesan awal sudah terisi "… terkait kegiatan <Ekskul>."; baris **Email** bisa diklik (mailto); nomor kosong tetap tampil "-" tanpa tombol.
- [ ] Footer modal: tombol **Atur Sub** muncul hanya bila ekskul punya Sub-Ekstrakurikuler **dan** pengguna berhak kelola anggota (`admin`/`guru`/`pengurus`); ubah centang → Simpan → baris **Sub-Ekskul** di modal langsung berubah dan daftar anggota di belakang ikut ter-render ulang.
- [ ] **Filter & reset**: chip `Filter: … (Sub: …)` beserta tombol "Reset Filter" tetap bekerja setelah daftar jadi 2 kolom; ekskul **tanpa** Sub-Ekskurikuler tidak menampilkan tombol Atur Sub.
- [ ] Sebagai **murid anggota biasa**: blok kontak tetap terkunci (pesan kunci) dan tidak ada tombol Atur Sub.

### S14k — Fase B: sesi murid di server + RLS ketat tabel `akun` (upgrade 20261028a–d)
- [ ] **Login murid** (`UJI999` / `uji1234`) → berhasil. Di console: `getToken().length` bernilai **64** (token hex dari tabel `sesi_lokal`, bukan `lokal-<uuid>` lagi).
- [ ] **Data Akun Murid** (admin) → tabel tetap terisi; **Edit** 1 murid → form terbuka lengkap (JK, agama, ortu, alamat); **Simpan** → sukses. Export Excel & PDF tetap berisi kolom lengkap.
- [ ] **Guru**: Dashboard (statistik murid/guru), Manajemen Akun Guru, dropdown guru (Jadwal/Inventaris), **Kunci Absen** (captcha + BUKA/TUTUP) → semua tetap bekerja (`supaClient.from('akun')` sudah tidak dipakai lagi).
- [ ] **Murid**: Data Akun Murid (profil sendiri), ubah profil, ganti password (setelah sukses, lanjut tanpa login ulang), Absen Mandiri (captcha diverifikasi server), scan wajah, laporan nilai → tetap bekerja.
- [ ] **S14k-b1 — Data Akun Murid (murid) → Simpan Perubahan** (regresi PGRST202): login `UJI999` → menu **Data Akun Murid** → ubah satu isian (mis. **No HP/WA**) → klik **Simpan Perubahan** → muncul notifikasi sukses ("Profil diperbarui.") dan nilai tersimpan setelah halaman dimuat ulang. **Tidak boleh** ada toast merah / console error `PGRST202` / "Could not find the function public.ubah_profil_murid". Payload benar = `{ p_nis, p_data, p_token }` (tanpa `p_klaim_nis`).
- [ ] **S14k-b2 — Ganti Password sendiri (murid)**: isi **Password lama** yang benar + **Password baru** (≥6 karakter) → Simpan → sukses, lalu **tetap bisa** membuka menu murid lain tanpa login ulang (token baru dari server otomatis tersimpan). Cek console: hanya satu panggilan `ubah_password_sendiri` dengan argumen `{ p_nis, p_lama, p_baru, p_token }` — **tanpa** `p_klaim_nis`.
- [ ] **S14k-b3 — Token kadaluarsa**: di console jalankan `localStorage.setItem('sisip_token','mati')` → klik **Simpan Perubahan** di Data Akun Murid → muncul pesan "Sesi Anda sudah berakhir. Silakan login ulang." lalu aplikasi logout sendiri (bukan diam-diam gagal).
- [ ] **Verifikasi statis**: `npm run test:rpc-args` → `✅ Semua argumen RPC cocok dengan signature SQL di repo` dan `self-test: ✅ OK` (skrip membandingkan seluruh titik `.rpc()`/`supaRpc()` di `web/js` dengan signature di `supabase/sql`).
- [ ] **Pengurus ekskul** (murid berjabatan): Kelola/Tambah Anggota, Atur Jabatan, **Profil Anggota** (kontak & keluarga tampil), Ganti Kunci Absen ekskul → tetap bekerja **via RPC + token**.
- [ ] Verifikasi RLS ketat (console, mode anon tanpa login): `await supaClient.from('akun').select('nis_nip').limit(1)` → **error/denied** (bukan data). Ini bukti anon tidak punya jalur baca `akun` lagi.
- [ ] Verifikasi klaim NIS ditolak (setelah `fix_20261028d`): `await supaClient.rpc('ambil_daftar_murid', { p_mode: 'list', p_klaim_nis: 'UJI999' })` → `[]`.
- [ ] **Logout murid** → `sisip_token` kosong dan token dicabut di server (menjalankan halaman dengan token lama → diminta login ulang).

### S14l — PWA: "Pasang ke Layar Utama" + fallback offline

Prasyarat: frontend sudah ter-deploy dengan `web/sw.js`, `web/manifest.json`,
`web/offline.html`, `web/js/install.js`, dan ikon `web/assets/icon-*.png`
(cek kelengkapan: `npm run check:icons`).

- [ ] **Gate statis**: `npm run check:icons` → `✅ Ikon PWA lengkap`; `node --check web/js/install.js` dan `node --check web/sw.js` → tanpa error.
- [ ] **Service worker aktif**: buka SISIP → hard refresh (Ctrl+F5) → DevTools → Application → *Service Workers*: status **activated and is running**, scope = `/Administrasi-Sekolah/` (**bukan** `/`). Console: `[PWA] Service worker terdaftar. Scope: …/Administrasi-Sekolah/`.
- [ ] **Cache statis terisi**: Application → *Cache Storage* → `sisip-static-v3` memuat `index.html`, `offline.html`, `css/style.css?v=20261029a`, `js/app.js?v=20261029a`, `js/install.js?v=20261029a`, seluruh ikon (18 entri). Tidak boleh ada entri yang gagal (404) — kegagalan dilaporkan sebagai `[SW] Gagal precache: …` di console.
- [ ] **Manifest bersih**: Application → *Manifest* → Name "SISIP…", Short name `SISIP`, Start URL `./index.html`, Display **standalone**, ikon 192 & 512 terdeteksi, **tanpa** peringatan "Must include a 192px/512px icon".
- [ ] **Android (Chrome/Opera/Samsung)**: tombol **Pasang** muncul di header **dan** kartu "Pasang Aplikasi SISIP" muncul di dashboard → klik → prompt pemasangan muncul → setelah dipasang: toast "Berhasil Dipasang!", tombol & kartu hilang, ikon SISIP ada di launcher **tanpa terpotong** (bukti ikon `maskable` benar).
- [ ] **Buka dari ikon (standalone)**: tidak ada address bar, header tampil penuh, login → dashboard normal, dan **tidak** ada ajakan pasang lagi.
- [ ] **"Nanti saja" dihormati**: klik "Nanti saja" → kartu hilang dan tidak muncul lagi setelah muat ulang (kunci localStorage `sisip_pwa_kartu_ditolak`).
- [ ] **iOS/iPadOS Safari**: tekan tombol Pasang → muncul panduan 4 langkah (Bagikan → Tambahkan ke Layar Utama); setelah ditambahkan, ikon di layar utama memakai `apple-touch-icon.png`.
- [ ] **Prompt notifikasi 1× per perangkat**: muncul sekali (kunci `sisip_pwa_notif_ditanya`); memilih "Tidak" tidak membuatnya bertanya lagi di perangkat yang sama.
- [ ] **Fallback offline**: DevTools → Network → centang *Offline* → reload → tampil `offline.html` (bukan halaman error browser); tombol **Muat Ulang Halaman** berhasil setelah koneksi kembali.
- [ ] **Data tidak dilayani dari cache**: saat offline, pembacaan data Supabase gagal wajar (request lintas-origin dilewatkan service worker) — pastikan **tidak ada** data lama/kadaluarsa yang muncul.
- [ ] **Stempel build**: console menampilkan `[SISIP] build 20261029a`; `<html data-sisip-build="20261029a">` (Elements). Bila angkanya beda dari `?v=` di `index.html`, perangkat masih memakai berkas lama.
- [ ] **Update versi otomatis**: setelah deploy baru, buka aplikasi lama → console `[PWA] Versi baru tersedia — mengaktifkan sekarang…` → `[SISIP] Service worker baru aktif — memuat ulang sekali.` → halaman memuat ulang sendiri → aset yang dipakai ber-tag `?v=` terbaru (Sources → `js/app.js?v=…`). Tidak perlu hard refresh manual.
- [ ] **Self-heal cache lama**: perangkat yang sebelumnya membawa SW rusak/`sisip-v1` → buka SISIP sekali → console `[SISIP] Hapus cache lama: sisip-v1` (juga `sisip-api-v1`) → Application → *Cache Storage* hanya menyisakan `sisip-static-v3` (+ `sisip-runtime-v3` bila ada). Muat ulang tidak berulang (penjaga `sessionStorage`).
- [ ] **Ritual naik versi**: `web/index.html` (`?v=`) dan `PRECACHE`/`VERSION` di `web/sw.js` sudah sejalan, dan kedua situs (GitHub Pages **dan** mirror Vercel) sama-sama menerima `web/` terbaru — lihat README §8c.

---


---

## D. SELESAI UJI

### S15 — Bersih-bersih
- [ ] Di SQL Editor jalankan `uji_bersih.sql`.
- [ ] Verifikasi: Data Akun Murid (cari `UJI`) kosong; Perpustakaan/Inventaris tanpa `UJI-`; pengumuman uji hilang dari dashboard; **hard refresh** aplikasi.
- [ ] Catat NIS yang dipakai saat konversi — jika bukan `UJI998`, hapus manual di Data Akun Murid.
- [ ] Fase B: bersihkan sesi uji bila perlu → `delete from sesi_lokal where nis_nip like 'UJI%';` (RLS ON tanpa policy, tidak terjangkau REST).

---

**Cara melaporkan hasil:** tuliskan nomor skenario + ✅/❌ + pesan error (screenshot/console) — mis. `S8 ❌ kuitansi tidak terunduh, console: …`. Bug akan saya perbaiki di `app.js`.

---

# OTOMASI TINGKAT 1 — API (tanpa browser)

Skrip `scripts/e2e-api.mjs` menjalankan alur bisnis inti secara otomatis (±50 assertion): login admin/guru, buat murid uji via RPC, kenaikan naik/turun/tolak-guru, perpus + denda telat, SPP → kas, poin + ambang, PPDB → konversi akun, pembacaan murid-anon + proteksi tabel, **akses pengurus ekskul (anon): sub-ekskul, nilai ekskul, agenda/dispensasi, jabatan_ekskul_map & multi-pembina (migrasi 20260926)**, dan **Fase B (upgrade 20261028): `cek_login_murid` menerbitkan `sesi_token` 64 hex, RPC `simpan_ekskul_murid` ber-token berhasil, update `akun` langsung dari anon DITOLAK (RLS ketat), RPC baca `akun` tanpa token ditolak** — lalu membersihkan data ujinya sendiri.

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