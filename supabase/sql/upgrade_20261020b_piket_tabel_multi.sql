-- ============================================================
-- UPGRADE 2026-10-20(b): PIKET TABEL MULTI + MATRIK CEKLIS v2
-- Jalankan SELURUH file ini di Supabase Dashboard -> SQL Editor -> Run
--
-- LATAR BELAKANG:
--   Rework modul Piket Mobile (v2):
--     1) Tabel piket multi: satu ekskul bisa punya MANY tabel piket
--        (mis. "Piket 1", "Tabel Minggu A", "Piket Tugas Kelas").
--     2) Matrik transposé: baris = siswa, kolom = hari, sel = ceklis
--        hadir (✓/○) yang boleh ditulis oleh jabatan yang ditunjuk
--        (ceklis_jabatan) atau admin/guru.
--     3) Flag `lock` per tabel: bila di-lock, jadwal bekukan — hanya
--        ceklis hadir yang masih boleh (RLS tetap pola proyek ini:
--        anon & authenticated = penuh, akses ditegakkan di client).
--
-- Isi file ini (idempotent — aman dijalankan berulang):
--   1) Tabel tabel_piket_ekskul — banyak baris per ekskul:
--        ekskul         : nama ekskul
--        nama           : nama tabel (default 'Piket 1'), unique per ekskul
--        hari           : jsonb array hari aktif, cth ["Senin","Rabu"]
--        piket          : jsonb objek hari -> array [{nis,nama,cek,cek_by,cek_at}]
--        ceklis_jabatan : jsonb array jabatan yang boleh menulis tanda ceklis
--        lock           : boolean, jadwal bekukan bila true
--   2) Migrasi data satu kali dari jadwal_piket_ekskul (tabel lama
--      masih ada untuk rollback; UI baru baca/menulis tabel_piket_ekskul).
--   3) Grant + RLS (anon = sesi murid password lokal, pola proyek ini).
-- ============================================================

-- ========== 1. TABEL PIKET MULTI ==========
create table if not exists tabel_piket_ekskul (
  id uuid primary key default gen_random_uuid(),
  ekskul text not null,
  nama text not null default 'Piket 1',
  hari jsonb not null default '["Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"]'::jsonb,
  piket jsonb not null default '{}'::jsonb,
  ceklis_jabatan jsonb not null default '["Ketua","Wakil Ketua","Sekretaris 1","Sekretaris 2"]'::jsonb,
  lock boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ekskul, nama)
);
-- hari : ["Senin", ...] (urut DAFTAR_HARI_PIKET di app.js)
-- piket: { "Senin": [{ "nis": "...", "nama": "...", "cek": false, "cek_by": null, "cek_at": null }], ... }

-- ========== 2. MIGRASI DATA LAMA (jika tabel baru masih kosong) ==========
insert into tabel_piket_ekskul (ekskul, nama, hari, piket, created_at, updated_at)
select j.ekskul, 'Piket 1', j.hari, j.piket, j.created_at, j.updated_at
from jadwal_piket_ekskul j
where not exists (select 1 from tabel_piket_ekskul t where t.ekskul = j.ekskul);

-- ========== 3. GRANT + RLS (anon = sesi murid password lokal, pola proyek ini) ==========
alter table tabel_piket_ekskul enable row level security;

do $$
begin
  drop policy if exists tabel_piket_ekskul_select_all on tabel_piket_ekskul;
  create policy tabel_piket_ekskul_select_all on tabel_piket_ekskul for select using (true);
  drop policy if exists tabel_piket_ekskul_insert_all on tabel_piket_ekskul;
  create policy tabel_piket_ekskul_insert_all on tabel_piket_ekskul for insert with check (true);
  drop policy if exists tabel_piket_ekskul_update_all on tabel_piket_ekskul;
  create policy tabel_piket_ekskul_update_all on tabel_piket_ekskul for update using (true);
  drop policy if exists tabel_piket_ekskul_delete_all on tabel_piket_ekskul;
  create policy tabel_piket_ekskul_delete_all on tabel_piket_ekskul for delete using (true);
  execute 'grant select, insert, update, delete on tabel_piket_ekskul to anon, authenticated';
end $$;

-- Reload cache skema PostgREST
notify pgrst, 'reload schema';