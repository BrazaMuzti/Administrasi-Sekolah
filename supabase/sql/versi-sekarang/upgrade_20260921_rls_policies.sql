-- ============================================================
-- UPGRADE RLS POLICIES TABEL FASE 1-4 — 2026-09-21
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- Latar belakang (hasil uji E2E 2026-09-21): RLS telah ENABLE di
-- tabel-tabel baru tetapi TANPA policy → semua insert/update/delete
-- ditolak (bahkan utk admin/guru authenticated), dan sebagian tabel
-- sensitif masih terbaca anon.
--
-- Isi:
--   1) RLS enable + policy "authenticated semua" pada 14 tabel Fase 1-4
--      (pola sama dgn tabel absensi: authenticated = penuh)
--   2) Policy anon: SELECT saja utk konten publik (pengumuman,
--      perpus_buku); sisanya revoke total dari anon
--   3) Penegasan grant authenticated (idempotent)
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. FUNGSI PEMBANTU (dinamis, dihapus di akhir) ==========
create temp table if not exists _tabel_fase (nama text);
delete from _tabel_fase;
insert into _tabel_fase (nama) values
  ('jadwal_ujian'), ('pengumuman'), ('rapor_catatan'), ('arsip_surat'),
  ('poin_kategori'), ('poin_siswa'), ('spp_tagihan'), ('kas_transaksi'), ('arsip_dokumen'),
  ('perpus_buku'), ('perpus_pinjam'), ('inv_barang'), ('inv_pinjam'),
  ('ppdb_calon');

-- ========== 2. RLS ENABLE + POLICY AUTHENTICATED (penuh) ==========
do $$
declare t text;
begin
  for t in select nama from _tabel_fase loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "fase_authenticated_all" on %I', t);
    execute format('create policy "fase_authenticated_all" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ========== 3. POLICY ANON: SELECT PUBLIK SAJA ==========
drop policy if exists "fase_anon_select" on pengumuman;
create policy "fase_anon_select" on pengumuman for select to anon using (true);

drop policy if exists "fase_anon_select" on perpus_buku;
create policy "fase_anon_select" on perpus_buku for select to anon using (true);

-- ========== 4. REVOKE ANON DARI TABEL SENSITIF ==========
-- Murid anon membaca data miliknya lewat RPC security definer
-- (poin_murid, pinjaman_murid, catatan_wali_murid, ambil_laporan_nilai_murid),
-- bukan langsung ke tabel — jadi tabel berikut ditutup total dari anon.
revoke all on poin_kategori, poin_siswa, spp_tagihan, kas_transaksi, arsip_dokumen,
             inv_barang, inv_pinjam, perpus_pinjam, jadwal_ujian, rapor_catatan,
             arsip_surat, ppdb_calon
  from anon;

-- ========== 5. PENEGASAN GRANT AUTHENTICATED ==========
grant select, insert, update, delete on
  jadwal_ujian, pengumuman, rapor_catatan, arsip_surat,
  poin_kategori, poin_siswa, spp_tagihan, kas_transaksi, arsip_dokumen,
  perpus_buku, perpus_pinjam, inv_barang, inv_pinjam, ppdb_calon
  to authenticated;

-- ========== 6. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';