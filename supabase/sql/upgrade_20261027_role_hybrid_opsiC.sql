-- ============================================================
-- UPGRADE: ROLE HYBRID "OPSI C" + PERAN TAMBAHAN — 2026-10-27
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Login murid memakai RPC bcrypt (akun_kredensial) + token lokal, sedangkan
--   guru/admin memakai Supabase Auth (signInWithPassword). Guru sering TIDAK
--   punya email → dibutuhkan pola "email dummy" `[nis_nip]@sekolah.local`.
--
--   Selain tipe dasar (admin/guru/murid), aplikasi mengenal PERAN FUNGSIONAL
--   yang saat ini hanya disimpan sebagai kolom/isi teks dan diperiksa ad-hoc
--   di RPC & frontend. File ini MENYATUKAN deteksinya lewat helper function
--   agar konsisten dan mudah dipakai di RLS policy:
--     - wali kelas      → akun.wali_kelas terisi (per TA: penugasan[TA].wali)
--     - pembina         → akun.ekstrakurikuler terisi (pembina ekskul)
--     - siswa jabatan ekstrakurikuler → akun.jabatan_ekskul / jabatan_ekskul_map
--
-- Isi (idempotent — aman dijalankan berulang):
--   1) Helper functions role detection (fn_*).
--   2) Backfill email dummy untuk guru/admin tanpa email.
--   3) RLS ketat pada tabel sensitif murid (nilai, absensi):
--        - murid  → hanya baris miliknya (NIS = akun.nis_nip)
--        - guru/admin → semua baris
--      Tabel lain tetap memakai policy fase_authenticated_all yang sudah ada.
--   4) Reload cache skema PostgREST.
-- ============================================================

-- ============================================================
-- 1. HELPER FUNCTIONS — DETEKSI ROLE
--    Semua SECURITY DEFINER agar konsisten dipakai lintas konteks
--    (RLS policy, RPC, view) tanpa terhalang RLS tabel 'akun'.
-- ============================================================

-- 1a. Tipe akun pemanggil ('admin' | 'guru' | 'murid' | '').
create or replace function fn_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select tipe from akun where user_id = auth.uid() limit 1), '');
$$;

-- 1b. NIS/NIP pemanggil (identitas pada tabel akun).
create or replace function fn_nis()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select nis_nip from akun where user_id = auth.uid() limit 1), '');
$$;

create or replace function fn_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select fn_role() = 'admin';
$$;

create or replace function fn_is_guru()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select fn_role() = 'guru';
$$;

-- 1c. Guru (atau admin) yang berperan wali kelas minimal satu kelas.
--     Sumber: kolom live akun.wali_kelas ATAU penugasan[tahun].wali terisi.
create or replace function fn_is_wali_kelas()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from akun
    where user_id = auth.uid()
      and (
        coalesce(wali_kelas, '') <> ''
        or exists (
          select 1
          from jsonb_each(coalesce(penugasan, '{}'::jsonb)) as p(ta, v)
          where coalesce(p.v->>'wali', '') <> ''
        )
      )
  );
$$;

-- 1d. Guru (atau admin) yang berperan pembina ekstrakurikuler.
--     Sumber: kolom live akun.ekstrakurikuler ATAU penugasan[tahun].ekskul non-kosong.
create or replace function fn_is_pembina()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from akun
    where user_id = auth.uid()
      and (
        coalesce(ekstrakurikuler, '') <> ''
        or exists (
          select 1
          from jsonb_each(coalesce(penugasan, '{}'::jsonb)) as p(ta, v)
          where jsonb_typeof(p.v->'ekskul') = 'array'
            and jsonb_array_length(p.v->'ekskul') > 0
        )
      )
  );
$$;

-- 1e. Murid pemilik jabatan ekstrakurikuler (mis. Ketua/Wakil/Sekretaris ekskul).
--     p_ekskul NULL/'' → cukup punya jabatan di ekskul apa pun.
create or replace function fn_punya_jabatan_ekskul(p_ekskul text default '')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from akun
    where user_id = auth.uid()
      and (
        case
          when coalesce(p_ekskul, '') = '' then
            coalesce(jabatan_ekskul, '') <> ''
            or (jabatan_ekskul_map is not null and jabatan_ekskul_map <> '{}'::jsonb)
          else
            coalesce(jabatan_ekskul_map->>p_ekskul, '') <> ''
            or position(lower(p_ekskul) in lower(coalesce(jabatan_ekskul, ''))) > 0
        end
      )
  );
$$;

-- 1f. Guru wali kelas ATAU pembina (dipakai untuk akses import & kelola murid).
create or replace function fn_guru_wali_atau_pembina()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select fn_is_admin() or (fn_is_guru() and (fn_is_wali_kelas() or fn_is_pembina()));
$$;

-- Izin eksekusi helper (dipakai di policy → cukup authenticated).
grant execute on function fn_role() to authenticated, anon;
grant execute on function fn_nis() to authenticated, anon;
grant execute on function fn_is_admin() to authenticated, anon;
grant execute on function fn_is_guru() to authenticated, anon;
grant execute on function fn_is_wali_kelas() to authenticated, anon;
grant execute on function fn_is_pembina() to authenticated, anon;
grant execute on function fn_punya_jabatan_ekskul(text) to authenticated, anon;
grant execute on function fn_guru_wali_atau_pembina() to authenticated, anon;

-- ============================================================
-- 2. EMAIL DUMMY UNTUK GURU/ADMIN TANPA EMAIL
--    Pola: `[nis_nip]@sekolah.local` (agar Supabase Auth tetap bisa
--    membuat user pada pembuatan akun guru tanpa email nyata).
--    Hanya mengisi baris yang email-nya kosong & NIS/NIP ada.
-- ============================================================
update akun
set email = lower(nis_nip) || '@sekolah.local'
where coalesce(email, '') = ''
  and coalesce(nis_nip, '') <> ''
  and tipe in ('guru', 'admin');

-- ============================================================
-- 3. RLS KETAT — TABEL SENSITIF MURID (nilai & absensi)
--    Pola: murid hanya melihat barisnya sendiri (by NIS),
--          guru/admin/wali-kelas/pembina melihat semua.
--    Semua operasi tulis tetap dibatasi authenticated (guru/admin).
--    Drop policy lama yang terlalu longgar (fase_authenticated_all)
--    bila ada, lalu pasang policy terpisah per operasi.
-- ============================================================

-- ---------- 3a. TABEL absensi ----------
alter table if exists absensi enable row level security;

do $$
begin
  -- buang policy longgar bila ada
  if exists (select 1 from pg_policies where schemaname = 'public'
             and tablename = 'absensi' and policyname = 'fase_authenticated_all') then
    drop policy "fase_authenticated_all" on absensi;
  end if;

  -- SELECT: murid (NIS = nis_nip-nya) ATAU guru/admin/wali/pembina
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'absensi' and policyname = 'absensi_select_ketat') then
    create policy "absensi_select_ketat" on absensi
      for select to authenticated
      using (
        fn_role() in ('admin', 'guru')
        or nis = fn_nis()
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'absensi' and policyname = 'absensi_tulis_guru') then
    create policy "absensi_tulis_guru" on absensi
      for all to authenticated
      using (fn_role() in ('admin', 'guru'))
      with check (fn_role() in ('admin', 'guru'));
  end if;
end $$;

-- ---------- 3b. TABEL nilai ----------
alter table if exists nilai enable row level security;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public'
             and tablename = 'nilai' and policyname = 'fase_authenticated_all') then
    drop policy "fase_authenticated_all" on nilai;
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'nilai' and policyname = 'nilai_select_ketat') then
    create policy "nilai_select_ketat" on nilai
      for select to authenticated
      using (
        fn_role() in ('admin', 'guru')
        or nis = fn_nis()
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'nilai' and policyname = 'nilai_tulis_guru') then
    create policy "nilai_tulis_guru" on nilai
      for all to authenticated
      using (fn_role() in ('admin', 'guru'))
      with check (fn_role() in ('admin', 'guru'));
  end if;
end $$;

-- ============================================================
-- 4. RELOAD CACHE SKEMA POSTGREST
-- ============================================================
notify pgrst, 'reload schema';
