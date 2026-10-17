-- ============================================================
-- UPGRADE: EDIT PROFIL GURU MANDIRI (Daftar Guru / Data Akun Guru) — 2026-10-17
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Menu "Data Akun Guru" kini memiliki tab "Daftar Guru" yang dapat dibuka
--   guru (bukan hanya admin). Pada tab itu guru melihat tabel guru TANPA kolom
--   Aksi; hanya baris miliknya sendiri yang punya tombol "Edit Profil".
--   Namun RLS tabel `akun` tidak mengizinkan anon/authenticated meng-update
--   baris akun sembarang, sehingga perlu RPC security-definer `ubah_profil_guru`
--   (pola sama dengan `ubah_profil_murid`) yang:
--     - membuat kepemilikan: admin ATAU guru pemilik NIP (via auth.uid()).
--     - hanya memperbarui kolom profil pribadi (bukan email / password / penugasan).
--
-- Idempotent (create or replace) — aman dijalankan berulang.
-- ============================================================

create or replace function ubah_profil_guru(p_nip text, p_data jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if trim(coalesce(p_nip, '')) = '' then
    return json_build_object('status', 'error', 'message', 'NIP wajib diisi.');
  end if;
  if not exists (select 1 from akun where nis_nip = p_nip and tipe = 'guru') then
    return json_build_object('status', 'error', 'message', 'Akun guru tidak ditemukan.');
  end if;

  -- Kebijakan kepemilikan: hanya admin, atau guru pemilik NIP ini.
  if coalesce((select tipe from akun where user_id = auth.uid()), '') <> 'admin'
     and not exists (
       select 1 from akun
       where user_id = auth.uid() and nis_nip = p_nip and tipe = 'guru'
     ) then
    return json_build_object('status', 'error', 'message', 'Anda hanya dapat mengedit profil guru milik Anda (atau oleh admin).');
  end if;

  update akun set
    nama_lengkap    = coalesce(p_data->>'nama_lengkap', nama_lengkap),
    gelar_depan     = coalesce(p_data->>'gelar_depan', gelar_depan),
    gelar_belakang  = coalesce(p_data->>'gelar_belakang', gelar_belakang),
    jabatan         = coalesce(p_data->>'jabatan', jabatan),
    no_telepon      = coalesce(p_data->>'no_telepon', no_telepon)
  where nis_nip = p_nip and tipe = 'guru';

  return json_build_object('status', 'success', 'message', 'Profil guru berhasil diperbarui.');
end $$;

-- ========== IZIN EKSEKUSI + RELOAD CACHE ==========
grant execute on function ubah_profil_guru(text, jsonb) to anon, authenticated;
notify pgrst, 'reload schema';