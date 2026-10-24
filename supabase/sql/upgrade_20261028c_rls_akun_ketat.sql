-- ============================================================
-- UPGRADE 20261028c: RLS KETAT PADA `public.akun` — 2026-10-28
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- ⚠ JALANKAN HANYA SETELAH ketiga hal ini selesai:
--   1. `upgrade_20261028a_sesi_lokal_murid.sql`  (token sesi)
--   2. `upgrade_20261028b_rpc_akun.sql`          (RPC baca/tulis akun)
--   3. `upgrade_20261028b2_token_rpc_murid.sql`  (RPC murid ber-token)
--   dan frontend versi baru (`js/app.js?v=20261028a`) sudah ter-deploy.
--   Urutan aman: deploy frontend dulu → baru file ini.
--
-- LATAR BELAKANG
--   Tabel `akun` selama ini TIDAK punya RLS: izinnya murni GRANT
--   (`grant select … to anon` di fix_20260903_kredensial.sql, plus dua grant
--   kolom untuk pengurus ekskul di upgrade_20260926_ekskul_akses_guru.sql).
--   Artinya siapa pun yang punya anon key (yang selalu ter-bundle di browser)
--   bisa menarik SELURUH data murid (alamat, nama/pekerjaan orang tua, dst).
--   Setelah semua akses pindah ke RPC SECURITY DEFINER, RLS ketat di sini
--   menutup jalur REST langsung tanpa mematikan aplikasi.
--
-- ISI
--   1) `alter table akun enable row level security` — **TANPA** `force`
--      (force akan mematikan SEMUA RPC SECURITY DEFINER, termasuk RPC fase B).
--   2) Policy baca `authenticated`: baris sendiri ATAU staf (admin/guru).
--      (Murid lokal = anon + token → akses lewat RPC, bukan REST.)
--   3) Policy tulis `authenticated`: admin (all) + guru barisnya sendiri.
--   4) `revoke all on akun from anon` — termasuk 2 grant per-kolom lama
--      (`ekstrakurikuler`, `jabatan_ekskul_map`) yang kini tidak terpakai.
--
-- ROLLBACK (1 perintah): `alter table akun disable row level security;`
-- Idempotent — aman dijalankan berulang.
-- ============================================================

alter table akun enable row level security;

-- ========== 1. POLICY ==========
do $$
begin
  -- 1a. BACA: baris sendiri (JWT), atau staf admin/guru (semua baris).
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'akun' and policyname = 'akun_auth_baca') then
    create policy "akun_auth_baca" on akun
      for select to authenticated
      using (
        user_id = auth.uid()
        or nis_nip = fn_nis()
        or fn_role() in ('admin', 'guru')
      );
  end if;

  -- 1b. TULIS penuh: hanya admin (Manajemen Akun Admin/Guru, import, dsb).
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'akun' and policyname = 'akun_admin_tulis') then
    create policy "akun_admin_tulis" on akun
      for all to authenticated
      using (fn_is_admin())
      with check (fn_is_admin());
  end if;

  -- 1c. TULIS baris sendiri: guru (kunci/captcha absen, profil) — dibatasi
  --     ke barisnya sendiri agar tidak bisa menyentuh baris guru lain.
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'akun' and policyname = 'akun_guru_tulis_sendiri') then
    create policy "akun_guru_tulis_sendiri" on akun
      for update to authenticated
      using (nis_nip = fn_nis())
      with check (nis_nip = fn_nis());
  end if;

  -- 1d. Buang policy longgar warisan bila ada (mis. fase_authenticated_all).
  if exists (select 1 from pg_policies where schemaname = 'public'
             and tablename = 'akun' and policyname = 'fase_authenticated_all') then
    drop policy "fase_authenticated_all" on akun;
  end if;
end $$;

-- ========== 2. CABUT AKSES ANON (termasuk grant per-kolom lama) ==========
revoke all on table akun from anon;

-- Akses `authenticated` tetap (dibatasi policy di atas + RPC SECURITY DEFINER).
grant select, insert, update, delete on akun to authenticated;

-- ========== 3. VERIFIKASI & RELOAD CACHE SKEMA POSTGREST ==========
do $$
declare
  v_rls  boolean;
  v_force boolean;
  v_pol  integer;
  v_anon text;
begin
  select relrowsecurity, relforcerowsecurity into v_rls, v_force
  from pg_class where oid = 'public.akun'::regclass;

  select count(*) into v_pol
  from pg_policies where schemaname = 'public' and tablename = 'akun';

  select coalesce(array_to_string(relacl, ' | '), '(null)') into v_anon
  from pg_class where oid = 'public.akun'::regclass;

  raise notice 'INFO: akun → RLS=% (force=%, harus false), policy=%', v_rls, v_force, v_pol;
  raise notice 'INFO: ACL akun = %', v_anon;

  if v_force then
    raise warning 'PERINGATAN: force row level security AKTIF pada akun — matikan (alter table akun no force row level security) atau semua RPC SECURITY DEFINER berhenti bekerja.';
  end if;
end $$;

notify pgrst, 'reload schema';
