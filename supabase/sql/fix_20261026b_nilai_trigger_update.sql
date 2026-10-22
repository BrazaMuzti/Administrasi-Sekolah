-- ============================================================
-- FIX 2026-10-26b: UPDATE PADA TABEL `nilai` DITELAN DATABASE
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- GEJALA:
--   Menu Input Nilai → ketik nilai → keluar dari sel (blur) → toast hijau
--   "Tersimpan", TAPI nilai hilang setelah halaman di-refresh. Baris di
--   database TIDAK pernah berubah (updated_at == created_at pada SEMUA baris
--   = sejak dibuat tidak pernah ada UPDATE yang berhasil).
--
-- BUKTI (uji langsung ke REST API sebagai guru `authenticated`, pada baris uji):
--   INSERT  → 201 tersimpan ✓
--   UPDATE  → 200 "1 baris" TETAPI RETURNING mengembalikan isi LAMA (tak berubah)
--   UPDATE kolom lain (kelas) → juga tidak berubah
--   UPSERT (ON CONFLICT DO UPDATE) → idem, isi tetap lama
--   UPDATE `nis` ke nilai DUPLIKAT → TIDAK muncul error 23505 (padahal
--     constraint unik seharusnya menolak) ⇒ baris NEW diganti OLD SEBELUM
--     pengecekan constraint ⇒ ciri khas trigger BEFORE UPDATE `RETURN OLD`
--     atau `NEW := OLD`. Baris dihitung "ter-update" (klien melihat sukses)
--     meski isinya tidak berubah.
--   Tabel modul lain (nilai_konfigurasi, nilai_teman_sejawat) UPDATE-nya NORMAL
--     ⇒ masalah HANYA pada tabel `nilai`.
--   RLS & grant sudah benar (policy `nilai_ubah_auth` using(true) with check(true),
--     grant UPDATE untuk authenticated ada) ⇒ penyebabnya objek trigger/rule yang
--     dibuat LANGSUNG di database live (tidak ada di repo ini).
--
-- ISI (idempotent — aman dijalankan berulang):
--   1) LAPORAN: bentuk objek `nilai`, semua trigger + definisi fungsinya, rule,
--      RLS policy, dan grant.
--   2) NONAKTIFKAN (disable, bukan drop — mudah dibalik) trigger/rule pada
--      `nilai` yang menetralkan UPDATE (pola `return old` / `new := old`).
--   3) PASTIKAN RLS + grant untuk `authenticated` (select/insert/update).
--      Tidak ada policy delete → penghapusan baris nilai sengaja hanya lewat
--      SQL Editor.
--   4) VERIFIKASI round-trip 2×: sebagai `postgres` DAN sebagai `authenticated`
--      (insert baris uji → update → baca ulang → hapus). Ini memisahkan
--      penyebab "trigger" dari "RLS/policy".
--   5) BERSIHKAN baris uji sesi diagnosa (ZZPROBE*, ZZVERIF*) + reload cache
--      skema PostgREST.
--
-- CATATAN: bila hasil uji poin 4 masih "GAGAL", kirim isi tabel laporan
-- (kolom `pemeriksaan` + `hasil`) untuk analisa lanjut.
-- ============================================================

drop table if exists _laporan_fix_nilai;
create temp table _laporan_fix_nilai (urutan int, pemeriksaan text, hasil text);

insert into _laporan_fix_nilai values (1, 'waktu', now()::text);

-- ========== 1. LAPORAN OBJEK, TRIGGER, RULE, POLICY, GRANT ==========
do $$
declare r record;
begin
  if to_regclass('public.nilai') is null then
    insert into _laporan_fix_nilai values (2, 'tabel nilai', 'TIDAK ADA — periksa nama skema/tabel');
    return;
  end if;

  select case c.relkind when 'r' then 'TABLE' when 'v' then 'VIEW'
                        when 'p' then 'TABLE (partitioned)' when 'm' then 'MATVIEW'
                        when 'f' then 'FOREIGN TABLE' else c.relkind::text end as bentuk
    into r
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'nilai';
  insert into _laporan_fix_nilai values (2, 'bentuk objek public.nilai', r.bentuk);

  select count(*) as jml into r from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'nilai' and not t.tgisinternal;
  insert into _laporan_fix_nilai values (3, 'jumlah trigger (non-internal)', r.jml::text);

  for r in
    select t.tgname, t.tgenabled, pg_get_triggerdef(t.oid, true) as tdef,
           p.proname, pg_get_functiondef(p.oid) as fdef
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public' and c.relname = 'nilai' and not t.tgisinternal
    order by t.tgname
  loop
    insert into _laporan_fix_nilai values (4, 'TRIGGER ' || r.tgname || ' (tgenabled=' || r.tgenabled || ')',
      left(r.tdef, 250) || E'\n  fungsi ' || r.proname || ':' || E'\n' || left(r.fdef, 1500));
  end loop;

  for r in
    select rw.rulename, pg_get_ruledef(rw.oid, true) as rdef
    from pg_rewrite rw
    join pg_class c on c.oid = rw.ev_class
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'nilai' and rw.rulename <> '_RETURN'
  loop
    insert into _laporan_fix_nilai values (5, 'RULE ' || r.rulename, left(r.rdef, 400));
  end loop;

  for r in
    select policyname, cmd, permissive, roles::text as roles, qual::text as qual, with_check::text as wc
    from pg_policies where schemaname = 'public' and tablename = 'nilai' order by cmd, policyname
  loop
    insert into _laporan_fix_nilai values (6,
      'POLICY ' || r.policyname || ' [' || r.cmd || ' ' || r.permissive || ' → ' || r.roles || ']',
      'using=' || coalesce(r.qual, '-') || ' | with_check=' || coalesce(r.wc, '-'));
  end loop;

  for r in
    select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privs
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'nilai'
      and grantee in ('anon', 'authenticated', 'service_role')
    group by grantee
  loop
    insert into _laporan_fix_nilai values (7, 'GRANT untuk ' || r.grantee, r.privs);
  end loop;
end $$;

-- ========== 2. NONAKTIFKAN TRIGGER/RULE YANG MENETRALKAN UPDATE ==========
do $$
declare r record; n_trg int := 0; n_rule int := 0;
begin
  if to_regclass('public.nilai') is null then return; end if;

  for r in
    select t.tgname, p.proname, pg_get_functiondef(p.oid) as fdef
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public' and c.relname = 'nilai' and not t.tgisinternal
      and (t.tgtype & 16) = 16   -- 16 = TRIGGER_TYPE_UPDATE
  loop
    if r.fdef ~* 'return\s+old' or r.fdef ~* 'new\s*:=\s*old' or r.fdef ~* 'new\s*=\s*old' then
      execute format('alter table public.nilai disable trigger %I', r.tgname);
      insert into _laporan_fix_nilai values (20 + n_trg, 'DINONAKTIFKAN trigger ' || r.tgname,
        'fungsi ' || r.proname || ' menetralkan UPDATE (pola NEW = OLD / return OLD). '
        || 'Hapus permanen (opsional): drop trigger ' || quote_ident(r.tgname) || ' on public.nilai;');
      n_trg := n_trg + 1;
    elsif r.fdef ~* 'return\s+null' then
      insert into _laporan_fix_nilai values (25 + n_trg, 'PERIKSA MANUAL trigger ' || r.tgname,
        'fungsi ' || r.proname || ' memuat `return null` pada trigger UPDATE — bila UPDATE masih ditelan, '
        || 'jalankan: alter table public.nilai disable trigger ' || quote_ident(r.tgname) || ';');
      n_trg := n_trg + 1;
    end if;
  end loop;
  if n_trg = 0 then
    insert into _laporan_fix_nilai values (20, 'trigger dinonaktifkan',
      'tidak ada trigger UPDATE pada `nilai` yang cocok pola imutabilitas');
  end if;

  for r in
    select rw.rulename, pg_get_ruledef(rw.oid, true) as rdef
    from pg_rewrite rw
    join pg_class c on c.oid = rw.ev_class
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'nilai' and rw.rulename <> '_RETURN'
  loop
    if r.rdef ~* 'do instead' then
      execute format('drop rule %I on public.nilai', r.rulename);
      insert into _laporan_fix_nilai values (30 + n_rule, 'RULE DIHAPUS: ' || r.rulename, left(r.rdef, 300));
      n_rule := n_rule + 1;
    end if;
  end loop;
end $$;

-- ========== 3. PASTIKAN RLS + GRANT UNTUK `authenticated` ==========
drop policy if exists "nilai_baca_auth" on public.nilai;
create policy "nilai_baca_auth" on public.nilai for select to authenticated using (true);

drop policy if exists "nilai_tulis_auth" on public.nilai;
create policy "nilai_tulis_auth" on public.nilai for insert to authenticated with check (true);

drop policy if exists "nilai_ubah_auth" on public.nilai;
create policy "nilai_ubah_auth" on public.nilai for update to authenticated using (true) with check (true);

grant select, insert, update, delete on table public.nilai to authenticated;

insert into _laporan_fix_nilai values (40, 'RLS policy `nilai`',
  'nilai_baca_auth (select) + nilai_tulis_auth (insert) + nilai_ubah_auth (update) dipastikan ada; '
  || 'tanpa policy delete → penghapusan baris nilai hanya dari SQL Editor (sengaja).');

-- ========== 4. VERIFIKASI ROUND-TRIP (postgres & authenticated) ==========
do $$
declare v_id uuid; v_data jsonb; v_kelas text; v_hasil text;
begin
  if to_regclass('public.nilai') is null then return; end if;

  delete from public.nilai where nis = 'ZZVERIF-NILAI';
  insert into public.nilai (nis, kategori, mapel, ekskul, kelas, tahun, semester, data)
  values ('ZZVERIF-NILAI', 'Data Nilai Pengetahuan', 'ZZVERIF', '', 'X VERIF', '2026/2027', 'Ganjil', '{"uji":1}'::jsonb)
  returning id into v_id;
  insert into _laporan_fix_nilai values (50, 'UJI (postgres): INSERT baris uji', 'ok — id ' || v_id::text);

  -- 4a. sebagai pemilik/superuser: RLS dilewati, tapi trigger tetap berlaku
  update public.nilai set data = jsonb_set(data, '{uji}', '2'::jsonb) where id = v_id;
  select data into v_data from public.nilai where id = v_id;
  insert into _laporan_fix_nilai values (51, 'UJI (postgres): UPDATE data 1 → 2',
    case when v_data->>'uji' = '2' then 'BERHASIL ✓'
         else 'GAGAL ✗ (isi tetap ' || coalesce(v_data::text, '-') || ') → masih ada trigger/rule penelan UPDATE' end);

  update public.nilai set kelas = 'X VERIF 2' where id = v_id;
  select kelas into v_kelas from public.nilai where id = v_id;
  insert into _laporan_fix_nilai values (52, 'UJI (postgres): UPDATE kolom lain (kelas)',
    coalesce(v_kelas, '-') || case when v_kelas = 'X VERIF 2' then ' → BERHASIL ✓' else ' → GAGAL ✗' end);

  -- 4b. sebagai role aplikasi `authenticated` (RLS + policy + trigger berlaku penuh)
  begin
    execute 'set local role authenticated';
    update public.nilai set data = jsonb_set(data, '{uji}', '3'::jsonb) where id = v_id;
    select data into v_data from public.nilai where id = v_id;
    v_hasil := case when v_data->>'uji' = '3' then 'BERHASIL ✓ (nilai dari aplikasi akan tersimpan)'
                    else 'GAGAL ✗ (isi tetap ' || coalesce(v_data::text, '-') || ') → periksa RLS/policy/trigger' end;
  exception when others then
    v_hasil := 'ERROR ' || sqlstate || ': ' || sqlerrm;
  end;
  execute 'reset role';
  insert into _laporan_fix_nilai values (53, 'UJI (authenticated): UPDATE data 2 → 3', v_hasil);

  -- bersihkan baris uji (termasuk sisa sesi diagnosa)
  delete from public.nilai where id = v_id;
  delete from public.nilai where nis like 'ZZPROBE%';
  delete from public.nilai_konfigurasi where mapel like 'ZPROBE%';
  delete from public.nilai_teman_sejawat where penilai_nis like 'ZPROBE%' or target_nis like 'ZPROBE%';
  insert into _laporan_fix_nilai values (54, 'BERSIH: baris uji ZZVERIF/ZZPROBE dihapus', 'ok');
end $$;

-- ========== 5. RELOAD CACHE SKEMA POSTGREST ==========
notify pgrst, 'reload schema';

-- ========== LAPORAN AKHIR (kirim isi tabel ini bila masih ada GAGAL) ==========
select urutan, pemeriksaan, hasil from _laporan_fix_nilai order by urutan;

