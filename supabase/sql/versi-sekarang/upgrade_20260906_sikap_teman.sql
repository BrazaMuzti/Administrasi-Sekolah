-- ============================================================
-- UPGRADE SIKAP — TEMAN SEJAWAT & JURNAL PENILAIAN SIKAP — 2026-09-06
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
-- Isi:
--   1) Tabel nilai_teman_sejawat (rating 1-4 per PENILAI per TARGET;
--      satu baris = satu penilai menilai satu teman)
--   2) Tabel jurnal_sikap (jurnal guru: hari/tanggal, kejadian,
--      aspek sikap, tindak lanjut — per kelas+mapel+tahun+semester)
--   3) RLS + privilege (guru/admin = authenticated)
--   4) RPC murid (security definer, bisa dipanggil anon — murid password
--      lokal tidak punya sesi Auth Supabase):
--      - sesi_teman_terbuka(): daftar mapel dengan sesi penilaian BUKA
--      - ambil_teman_sekelas(): teman sekelas + rating milik penilai
--      - simpan_penilaian_teman(): upsert rating (validasi sesi buka,
--        target sekelas, skor 1-4; tahun/semester dipaksa dari sesi guru)
-- Idempotent — aman dijalankan berulang.
-- ============================================================

-- ========== 1. TABEL TEMAN SEJAWAT ==========
create table if not exists nilai_teman_sejawat (
  id uuid primary key default gen_random_uuid(),
  penilai_nis text not null,
  target_nis text not null,
  kelas text default '',
  mapel text default '',
  tahun text default '',
  semester text default '',
  skor int not null check (skor between 1 and 4),
  id_guru text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (penilai_nis, target_nis, mapel, tahun, semester)
);
create index if not exists idx_nsts_target
  on nilai_teman_sejawat (target_nis, mapel, kelas, tahun, semester);
create index if not exists idx_nsts_penilai
  on nilai_teman_sejawat (penilai_nis, mapel, tahun, semester);

-- ========== 2. TABEL JURNAL SIKAP ==========
create table if not exists jurnal_sikap (
  id uuid primary key default gen_random_uuid(),
  kelas text default '',
  mapel text default '',
  tahun text default '',
  semester text default '',
  hari_tanggal text default '',
  kejadian text default '',
  aspek_sikap text default '',
  tindak_lanjut text default '',
  id_guru text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_jurnal_sikap_scope
  on jurnal_sikap (kelas, mapel, tahun, semester);

-- ========== 3. RLS & PRIVILEGE ==========
alter table nilai_teman_sejawat enable row level security;

drop policy if exists "nsts_baca_auth" on nilai_teman_sejawat;
create policy "nsts_baca_auth" on nilai_teman_sejawat
  for select to authenticated using (true);

drop policy if exists "nsts_tulis_auth" on nilai_teman_sejawat;
create policy "nsts_tulis_auth" on nilai_teman_sejawat
  for insert to authenticated with check (true);

drop policy if exists "nsts_ubah_auth" on nilai_teman_sejawat;
create policy "nsts_ubah_auth" on nilai_teman_sejawat
  for update to authenticated using (true) with check (true);

drop policy if exists "nsts_hapus_auth" on nilai_teman_sejawat;
create policy "nsts_hapus_auth" on nilai_teman_sejawat
  for delete to authenticated using (true);

alter table jurnal_sikap enable row level security;

drop policy if exists "jurnalsikap_baca_auth" on jurnal_sikap;
create policy "jurnalsikap_baca_auth" on jurnal_sikap
  for select to authenticated using (true);

drop policy if exists "jurnalsikap_tulis_auth" on jurnal_sikap;
create policy "jurnalsikap_tulis_auth" on jurnal_sikap
  for insert to authenticated with check (true);

drop policy if exists "jurnalsikap_ubah_auth" on jurnal_sikap;
create policy "jurnalsikap_ubah_auth" on jurnal_sikap
  for update to authenticated using (true) with check (true);

drop policy if exists "jurnalsikap_hapus_auth" on jurnal_sikap;
create policy "jurnalsikap_hapus_auth" on jurnal_sikap
  for delete to authenticated using (true);

revoke all on table nilai_teman_sejawat from anon, authenticated;
grant select, insert, update, delete on nilai_teman_sejawat to authenticated;
revoke all on table jurnal_sikap from anon, authenticated;
grant select, insert, update, delete on jurnal_sikap to authenticated;

-- ========== 4. RPC MURID (security definer) ==========
-- 4a. Daftar sesi penilaian teman yang sedang BUKA (per mapel Sikap).
create or replace function sesi_teman_terbuka()
returns json
language sql
security definer
set search_path = public, extensions
as $$
  select coalesce(json_agg(json_build_object(
    'mapel', k.mapel,
    'judul', k.config->'sikap_teman'->>'judul',
    'keterangan', k.config->'sikap_teman'->>'keterangan',
    'jumlah_teman', coalesce((k.config->'sikap_teman'->>'jumlah_teman')::int, 5),
    'tahun', coalesce(k.config->'sikap_teman'->>'sesi_tahun', ''),
    'semester', coalesce(k.config->'sikap_teman'->>'sesi_semester', '')
  ) order by k.mapel), '[]'::json)
  from nilai_konfigurasi k
  where k.kategori = 'Data Nilai Sikap'
    and coalesce((k.config->'sikap_teman'->>'sesi_buka')::boolean, false);
$$;

-- 4b. Teman sekelas + rating milik penilai (untuk mapel dengan sesi terbuka).
create or replace function ambil_teman_sekelas(p_nis text, p_mapel text default '')
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_penilai akun%rowtype;
  v_cfg jsonb;
begin
  select * into v_penilai from akun where nis_nip = p_nis and tipe = 'murid' limit 1;
  if v_penilai.id is null then
    return json_build_object('status', 'error', 'message', 'NIS penilai tidak terdaftar.');
  end if;

  select config into v_cfg from nilai_konfigurasi
    where kategori = 'Data Nilai Sikap'
      and mapel = coalesce(nullif(trim(p_mapel), ''), '')
    limit 1;

  return json_build_object(
    'status', 'success',
    'kelas', v_penilai.tingkat_kelas,
    'sesi_buka', coalesce((v_cfg->'sikap_teman'->>'sesi_buka')::boolean, false),
    'judul', coalesce(v_cfg->'sikap_teman'->>'judul', 'Berilah nilai untuk 5 teman'),
    'keterangan', coalesce(v_cfg->'sikap_teman'->>'keterangan', ''),
    'jumlah_teman', coalesce((v_cfg->'sikap_teman'->>'jumlah_teman')::int, 5),
    'kriteria', coalesce(v_cfg->'sikap_teman'->'kriteria', '{}'::jsonb),
    'tahun', coalesce(v_cfg->'sikap_teman'->>'sesi_tahun', ''),
    'semester', coalesce(v_cfg->'sikap_teman'->>'sesi_semester', ''),
    'teman', (
      select coalesce(json_agg(json_build_object(
        'nis', a.nis_nip, 'nama', a.nama_lengkap
      ) order by a.nama_lengkap), '[]'::json)
      from akun a
      where a.tipe = 'murid'
        and a.tingkat_kelas = v_penilai.tingkat_kelas
        and a.nis_nip <> p_nis
    ),
    'rating_saya', (
      select coalesce(json_object_agg(t.target_nis, t.skor), '{}'::json)
      from nilai_teman_sejawat t
      where t.penilai_nis = p_nis
        and t.mapel = coalesce(nullif(trim(p_mapel), ''), '')
        and t.tahun = coalesce(v_cfg->'sikap_teman'->>'sesi_tahun', '')
        and t.semester = coalesce(v_cfg->'sikap_teman'->>'sesi_semester', '')
    )
  );
end $$;

-- 4c. Simpan rating murid (upsert idempoten — dapat mengoreksi selama sesi buka).
--     Tahun/semester DIPAKSA dari sesi guru di config (murid tidak menentukan).
create or replace function simpan_penilaian_teman(
  p_penilai_nis text,
  p_mapel text default '',
  p_rows jsonb default '[]'::jsonb
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_penilai akun%rowtype;
  v_cfg jsonb;
  v_buka boolean;
  v_tahun text;
  v_semester text;
  el jsonb;
  v_target text;
  v_skor int;
  v_ok int := 0;
  v_fail int := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  select * into v_penilai from akun where nis_nip = p_penilai_nis and tipe = 'murid' limit 1;
  if v_penilai.id is null then
    return json_build_object('status', 'error', 'message', 'NIS penilai tidak terdaftar.');
  end if;

  -- Sesi harus dibuka guru pada konfigurasi kategori Sikap mapel terkait
  select config into v_cfg from nilai_konfigurasi
    where kategori = 'Data Nilai Sikap'
      and mapel = coalesce(nullif(trim(p_mapel), ''), '')
    limit 1;
  v_buka := coalesce((v_cfg->'sikap_teman'->>'sesi_buka')::boolean, false);
  if not v_buka then
    return json_build_object('status', 'error', 'message', 'Sesi penilaian teman sejawat belum dibuka guru.');
  end if;
  v_tahun := coalesce(v_cfg->'sikap_teman'->>'sesi_tahun', '');
  v_semester := coalesce(v_cfg->'sikap_teman'->>'sesi_semester', '');

  if jsonb_typeof(p_rows) <> 'array' then
    return json_build_object('status', 'error', 'message', 'Format data tidak valid.');
  end if;

  for el in select * from jsonb_array_elements(p_rows) loop
    v_target := trim(coalesce(el->>'nis', ''));
    v_skor := nullif(el->>'skor', '')::int;
    begin
      if v_target = '' or v_target = p_penilai_nis then
        v_fail := v_fail + 1;
        v_errors := v_errors || jsonb_build_array('Target tidak valid / menilai diri sendiri.');
        continue;
      end if;
      if v_skor is null or v_skor < 1 or v_skor > 4 then
        v_fail := v_fail + 1;
        v_errors := v_errors || jsonb_build_array('Skor harus angka 1-4.');
        continue;
      end if;
      -- Target wajib murid sekelas dengan penilai
      if not exists (
        select 1 from akun a
        where a.nis_nip = v_target
          and a.tipe = 'murid'
          and a.tingkat_kelas = v_penilai.tingkat_kelas
      ) then
        v_fail := v_fail + 1;
        v_errors := v_errors || jsonb_build_array('Target bukan teman sekelas: ' || v_target);
        continue;
      end if;

      insert into nilai_teman_sejawat
        (penilai_nis, target_nis, kelas, mapel, tahun, semester, skor)
      values
        (p_penilai_nis, v_target, v_penilai.tingkat_kelas,
         coalesce(nullif(trim(p_mapel), ''), ''), v_tahun, v_semester, v_skor)
      on conflict (penilai_nis, target_nis, mapel, tahun, semester)
      do update set skor = excluded.skor, updated_at = now();
      v_ok := v_ok + 1;
    exception when others then
      v_fail := v_fail + 1;
      v_errors := v_errors || jsonb_build_array('Gagal simpan untuk ' || v_target || ': ' || SQLERRM);
    end;
  end loop;

  return json_build_object(
    'status', 'success',
    'tersimpan', v_ok,
    'gagal', v_fail,
    'detail_gagal', v_errors
  );
end $$;

grant execute on function sesi_teman_terbuka() to anon, authenticated;
grant execute on function ambil_teman_sekelas(text, text) to anon, authenticated;
grant execute on function simpan_penilaian_teman(text, text, jsonb) to anon, authenticated;

-- ========== 5. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';
