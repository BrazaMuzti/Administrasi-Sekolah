-- ============================================================
-- FIX: PULIHKAN GRANT TABEL MODUL NILAI UNTUK `authenticated` — 2026-10-26
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- GEJALA:
--   Menu **Input Nilai** (Pengetahuan/Keterampilan/Sikap/Ekstrakurikuler)
--   tidak menampilkan apa pun dengan pesan:
--     "Gagal memuat data. Periksa koneksi internet Anda."
--   Di DevTools → Network:
--     GET /rest/v1/nilai_konfigurasi?select=config&kategori=eq....&mapel=eq....
--     { "code":"42501", "message":"permission denied for table nilai_konfigurasi" }
--
-- PENYEBAB:
--   PostgREST butuh PRIVILEGE TINGKAT TABEL; RLS policy saja tidak cukup
--   (permintaan ditolak sebelum RLS). Grant `authenticated` pada tabel modul
--   nilai hilang dari database live (mis. akibat `revoke all` pada migrasi
--   lama yang dijalankan ulang tanpa grant ulang).
--
-- ISI (idempotent — aman dijalankan berulang):
--   * TIDAK memakai `revoke all` → privilege lain (mis. grant `anon` pada
--     tabel `nilai` dari upgrade_20260926_ekskul_akses_guru.sql) TIDAK dihapus.
--   * Hanya MENAMBAH grant select/insert/update/delete utk `authenticated`
--     pada: nilai, nilai_konfigurasi, nilai_teman_sejawat, jurnal_sikap.
--   * Tabel yang belum ada dilewati (tanpa error).
--   * Tidak ada grant baru untuk `anon`.
-- ============================================================

do $$
declare
  t text;
begin
  foreach t in array array['nilai', 'nilai_konfigurasi', 'nilai_teman_sejawat', 'jurnal_sikap']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    end if;
  end loop;
end $$;

-- ========== RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';
