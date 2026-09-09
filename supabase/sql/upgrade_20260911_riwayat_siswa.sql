-- ============================================================
-- UPGRADE: RIWAYAT KELAS & STATUS SISWA PER TAHUN PELAJARAN — 2026-09-11
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Isi:
--   Kolom akun.riwayat_kelas (jsonb) untuk murid: kelas efektif & status
--   siswa PER TAHUN PELAJARAN (kenaikan kelas, pindah jurusan, dropout, lulus).
--
-- Struktur:
--   { "2026/2027": { "kelas": "X RPL 1", "status": "Aktif", "ket": "" },
--     "2027/2028": { "kelas": "XI RPL 1", "status": "Aktif",  "ket": "Naik" },
--     "2028/2029": { "kelas": "XI RPL 1", "status": "Pindah", "ket": "pindah ke SMKN 3" } }
--
-- status: Aktif | Lulus | Pindah | Dropout | Keluar
-- Perilaku aplikasi:
--   - Tahun tanpa entri → fallback kolom statis tingkat_kelas (status 'Aktif'),
--     sehingga data eksisting tetap berjalan tanpa migrasi manual.
--   - Dual-write: proses kenaikan/pindah juga memperbarui tingkat_kelas statis
--     = kelas TA aktif agar seluruh query existing tetap benar.
--   - Siswa non-Aktif disembunyikan dari daftar absensi/nilai/ekskul TA tersebut.
--
-- Idempotent — aman dijalankan berulang. Data lama tidak tersentuh.
-- ============================================================

alter table akun
  add column if not exists riwayat_kelas jsonb not null default '{}'::jsonb;

comment on column akun.riwayat_kelas is
  'Riwayat kelas & status siswa per tahun pelajaran: { "TA": { "kelas": "", "status": "Aktif|Lulus|Pindah|Dropout|Keluar", "ket": "" } }. Tahun tanpa entri = fallback tingkat_kelas statis (Aktif).';

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';