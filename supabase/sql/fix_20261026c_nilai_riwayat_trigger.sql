-- =====================================================================
-- fix_20261026c_nilai_riwayat_trigger.sql
-- Lanjutan fix_20261026b. Trigger audit `trigger_awasi_nilai` (BEFORE DELETE OR UPDATE)
-- memanggil catat_riwayat_nilai() yang berakhir `return old` untuk SEMUA operasi.
-- Pada BEFORE UPDATE, `return old` membuang perubahan -> UPDATE tabel `nilai` "sukses"
-- (HTTP 200) tetapi data tidak berubah. fix_20261026b menonaktifkan trigger itu.
--
-- File ini: membetulkan fungsinya (UPDATE -> return new, DELETE -> return old), lalu
-- MENGAKTIFKAN KEMBALI trigger audit supaya riwayat nilai tetap tercatat.
-- Fungsi bisa dipakai trigger di tabel lain -> laporan menampilkan semua pemakainya.
-- Idempotent; aman dijalankan berulang di Supabase SQL Editor.
-- =====================================================================

drop table if exists _laporan_fix_riwayat;
create temp table _laporan_fix_riwayat (urutan int, pemeriksaan text, hasil text);

-- 1. Semua trigger yang memakai catat_riwayat_nilai() (bisa lebih dari tabel `nilai`)
insert into _laporan_fix_riwayat
select 1, 'PEMAKAI FUNGSI: ' || c.relname || '.' || t.tgname || ' (tgenabled=' || t.tgenabled::text || ')',
       pg_get_triggerdef(t.oid, true)
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where p.proname = 'catat_riwayat_nilai' and not t.tgisinternal;

-- 2. Betulkan fungsi: DELETE -> old, UPDATE/INSERT -> new
create or replace function public.catat_riwayat_nilai()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  insert into tabel_riwayat_nilai (nama_tabel, aksi, nilai_lama)
  values (TG_TABLE_NAME, TG_OP, to_jsonb(OLD));
  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

insert into _laporan_fix_riwayat values (2, 'fungsi catat_riwayat_nilai()', 'diperbaiki: DELETE return old, UPDATE return new');

-- 3. Aktifkan lagi semua trigger pemakai fungsi (tadi dinonaktifkan oleh fix 20261026b)
do $$
declare r record;
begin
  for r in
    select n.nspname, c.relname, t.tgname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where p.proname = 'catat_riwayat_nilai' and not t.tgisinternal
  loop
    execute format('alter table %I.%I enable trigger %I', r.nspname, r.relname, r.tgname);
    insert into _laporan_fix_riwayat values (3, 'DIAKTIFKAN ' || r.relname || '.' || r.tgname, 'ok');
  end loop;
end $$;

-- 4. Verifikasi: UPDATE harus tersimpan DAN riwayat harus tercatat
do $$
declare v_id uuid; v_data jsonb; v_awal bigint; v_akhir bigint; v_hasil text;
begin
  delete from public.nilai where nis = 'ZZVERIF-RIWAYAT';
  insert into public.nilai (nis, kategori, mapel, ekskul, kelas, tahun, semester, data)
  values ('ZZVERIF-RIWAYAT', 'Data Nilai Pengetahuan', 'ZZVERIF', '', 'X VERIF', '2026/2027', 'Ganjil', '{"uji":1}'::jsonb)
  returning id into v_id;

  select count(*) into v_awal from public.tabel_riwayat_nilai;

  -- sebagai role aplikasi, RLS + trigger berlaku penuh
  begin
    execute 'set local role authenticated';
    update public.nilai set data = jsonb_set(data, '{uji}', '2'::jsonb) where id = v_id;
    select data into v_data from public.nilai where id = v_id;
    v_hasil := case when v_data->>'uji' = '2' then 'BERHASIL ✓ (UPDATE tersimpan, trigger aktif)'
                    else 'GAGAL ✗ (isi tetap ' || coalesce(v_data::text, '-') || ')' end;
  exception when others then
    v_hasil := 'ERROR ' || sqlstate || ': ' || sqlerrm;
  end;
  execute 'reset role';
  insert into _laporan_fix_riwayat values (4, 'UJI (authenticated): UPDATE dengan trigger aktif', v_hasil);

  select count(*) into v_akhir from public.tabel_riwayat_nilai;
  insert into _laporan_fix_riwayat values (5, 'UJI: riwayat tercatat',
    case when v_akhir > v_awal then 'BERHASIL ✓ (+' || (v_akhir - v_awal)::text || ' baris di tabel_riwayat_nilai)'
         else 'GAGAL ✗ (tabel_riwayat_nilai tidak bertambah)' end);

  delete from public.nilai where id = v_id;
  insert into _laporan_fix_riwayat values (6, 'BERSIH: baris uji ZZVERIF-RIWAYAT dihapus', 'ok');
end $$;

notify pgrst, 'reload schema';

select urutan, pemeriksaan, hasil from _laporan_fix_riwayat order by urutan;
