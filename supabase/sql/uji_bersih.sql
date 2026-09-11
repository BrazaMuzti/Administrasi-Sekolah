-- ============================================================
-- PEMBERSIH DATA UJI E2E — SISIP
-- Jalankan SETELAH uji selesai (semua skenario ✅/❌ dicatat).
-- Menghapus seluruh jejak data uji ber-prefiks UJI- termasuk:
--   - akun murid uji UJI999 & hasil konversi PPDB UJI998 (+kredensialnya)
--   - peminjaman/kembalian perpus & inventaris, catatan poin
--   - tagihan SPP & baris kas yang mengandung "UJI"
--   - calon PPDB, pengumuman, catatan wali, kategori poin
-- Idempotent — aman dijalankan berulang.
-- ============================================================

delete from perpus_pinjam  where nis = 'UJI999' or kode_buku like 'UJI-%';
delete from perpus_buku    where kode like 'UJI-%';

delete from inv_pinjam     where kode_barang like 'UJI-%' or peminjam_nama like 'UJI%';
delete from inv_barang     where kode like 'UJI-%';

delete from poin_siswa     where nis = 'UJI999' or kategori_nama like 'UJI-%' or pelapor like 'UJI%';
delete from poin_kategori  where nama like 'UJI-%';

delete from kas_transaksi  where keterangan like '%UJI%' or no_bukti like 'UJI%';
delete from spp_tagihan    where nis = 'UJI999';

delete from ppdb_calon     where no_daftar like 'UJI-%' or nama like 'UJI%';
delete from pengumuman     where judul like 'UJI Pengumuman E2E%';
delete from rapor_catatan  where nis = 'UJI999';

delete from akun_kredensial where nis_nip in ('UJI999', 'UJI998');
delete from akun            where nis_nip in ('UJI999', 'UJI998') and tipe = 'murid';

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- Verifikasi manual (opsional, jalankan terpisah):
--   select count(*) from akun where nis_nip like 'UJI%';        -- harus 0
--   select count(*) from perpus_buku where kode like 'UJI-%';   -- harus 0
--   select count(*) from ppdb_calon where nama like 'UJI%';     -- harus 0