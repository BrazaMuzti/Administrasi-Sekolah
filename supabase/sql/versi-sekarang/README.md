# SQL Supabase — Versi Sekarang

Folder ini berisi skema database **versi terkini** untuk SIAKAD/SISIP.

## Isi folder

| File | Keterangan |
|---|---|
| `gabungan.sql` | **Gabungan seluruh 30 file upgrade** (2026-09-03 s.d. 2026-09-22) dalam satu file, urut tanggal pengembangan, **tanpa data uji**. |
| `upgrade_*.sql` / `fix_*.sql` | Salinan file satu-persatu (nama & isi sama dengan `../`), urut tanggal. |
| `uji_data.sql` / `uji_bersih.sql` | Tidak ikut di folder ini — masih ada di `supabase/sql/` (khusus pengujian E2E). |

## Kapan pakai yang mana?

- **Project Supabase BARU** (kosong) → jalankan **`gabungan.sql`** sekali jalan di SQL Editor. Selesai.
- **Project yang SUDAH berjalan** dan hanya tertinggal beberapa upgrade → jalankan **file satu-persatu** yang belum ada di database, **urut tanggal** (jangan acak, jangan ulang gabungan).

Semua file idempotent (aman dijalankan berulang), tapi untuk project hidup tetap jalankan hanya yang dibutuhkan.

## Urutan file satu-persatu (30 file)

1. `upgrade_20260903.sql` — kolom profil akun + tabel master_data (13 kolom gaya Sheets) + RLS
2. `fix_20260903_kredensial.sql` — kredensial murid & RPC (pengganti bagian 20260903)
3. `fix_master_data_insert.sql` — perbaikan insert master_data (400 Bad Request)
4. `upgrade_20260904_akun.sql` — gelar guru, NISN, status, foto, dsb.
5. `upgrade_20260904_master_data_tambahan.sql` — 12 kolom daftar baru
6. `upgrade_20260904_absensi.sql` — recreate tabel absensi (kolom lengkap + unique)
7. `upgrade_20260904_absensi_d.sql` — status 'D' (Dispen)
8. `upgrade_20260904_jurnal.sql` — tabel jurnal_guru
9. `upgrade_20260904_nilai.sql` — recreate tabel nilai (JSONB)
10. `upgrade_20260904_ekskul.sql` — pembina_nip & jadwal ekstrakurikuler
11. `upgrade_20260905_ekskul_pengurus.sql` — agenda_ekskul + pengurus
12. `upgrade_20260906_sikap_teman.sql` — nilai_teman_sejawat + jurnal sikap
13. `upgrade_20260906_ekskul_surat.sql` — logo_url + surat dispensasi + sub_ekskul
14. `upgrade_20260906_ekskul_surat_v2.sql` — kolom anggota (JSONB) sub_ekskul
15. `upgrade_20260908_kalender.sql` — kalender_pendidikan
16. `upgrade_20260909_administrasi_guru.sql` — administrasi guru lainnya
17. `upgrade_20260910_penugasan_guru.sql` — penugasan guru per TA
18. `upgrade_20260911_riwayat_siswa.sql` — riwayat kelas & status siswa per TA
19. `upgrade_20260912_nisn_sync.sql` — sinkronisasi NISN
20. `upgrade_20260913_jabatan_ekskul.sql` — jabatan ekstrakurikuler
21. `upgrade_20260914_akses_murid.sql` — akses murid + kolom GPS absensi
22. `upgrade_20260914_absensi_delete.sql` — policy RLS DELETE absensi
23. `upgrade_20260915_proses_kenaikan_rpc.sql` — RPC proses_kenaikan_kelas
24. `upgrade_20260916_fase1.sql` — fase 1: jadwal_ujian, leger, arsip, kartu
25. `upgrade_20260917_fase2.sql` — fase 2: poin, surat, pengumuman, SPP, kas
26. `upgrade_20260918_fase3.sql` — fase 3: perpus_buku, perpus_pinjam, inventaris
27. `upgrade_20260919_fase4.sql` — fase 4: ppdb_calon
28. `upgrade_20260920_murid_rpc.sql` — RPC akses murid (anon)
29. `upgrade_20260921_rls_policies.sql` — RLS policies tabel fase 1-4
30. `upgrade_20260922_nilai_murid_rpc.sql` — RPC ambil_rapor_nilai_murid

## Cara menjalankan di Supabase

1. Login ke [supabase.com](https://supabase.com) → pilih project.
2. Menu kiri: **SQL Editor** → **New query**.
3. **Salin seluruh isi** file SQL (atau klik ikon upload untuk memasang file `.sql`).
4. Klik **Run** (atau `Ctrl+Enter`).
5. Verifikasi lewat **Table Editor**: semua tabel & kolom sudah muncul.
