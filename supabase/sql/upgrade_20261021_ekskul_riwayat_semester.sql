-- ============================================================
-- UPGRADE: DIMENSI SEMESTER PADA KEANGGOTAAN EKSTRAKURIKULER — 2026-10-21
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   upgrade_20261020 menambah riwayat_ekskul[TA] = { ekskul, jabatan_map, status }
--   TANPA dimensi semester. Padahal dalam satu TA ada dua semester, dan keanggotaan
--   dapat berbeda tiap semester (siswa A ikut SM1 saja, B lanjut SM1→SM2, C ikut SM2 saja).
--   File ini menambah dimensi SEMESTER pada entri TA:
--     riwayat_ekskul[TA].smt = { "<Ekskul>": ["Ganjil","Genap"], ... }
--
-- KEBJAKAN (konsisten app.js & utils.example.js):
--   - SUATU Ekskul tanpa kunci `smt[ekskul]` → dianggap aktif di KEDUA semester
--     (perilaku lama), biar data yang sudah ada tidak berubah.
--   - `smt[ekskul]` berisi daftar semester ("Ganjil"/"Genap") tempat siswa mengikuti
--     ekskul itu pada TA tsb. Roster Info/Profil difilter per semester pilihan.
--   - RPC ubah_anggota_ekskul menerima p_smt (text[]) dan menggabungkannya (union)
--     ke smt[ekskul] sehingga keanggotaan lintas semester (skenario B) terjaga.
--
-- Idempotent (create or replace) — aman dijalankan berulang.
-- ============================================================


-- ========== 1. RPC ubah_anggota_ekskul — TAMBAH DIMENSI SEMESTER ==========
create or replace function ubah_anggota_ekskul(
  p_pemanggil text,
  p_ekskul text,
  p_nis_list text[],
  p_tambah boolean,
  p_ta text default null,
  p_smt text[] default null
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tipe text;
  v_jabatan_map jsonb;
  v_wali_kelas text;
  v_ekstra text;
  v_nis text;
  v_ekstra_siswa text;
  v_baru text;
  v_ta text;
  v_total int := 0;
  v_riwayat jsonb;
  v_entri jsonb;
  v_eks_riwayat text;
  v_baru_riwayat text;
  v_jmap jsonb;
  v_smt jsonb;
  v_teks_smt text;
  v_smt_bersih text[] := array[]::text[];
  v_smt_entri text[];
begin

  -- 0) TA berjalan: parameter eksplisit, atau turunkan dari Master Data
  v_ta := coalesce(nullif(trim(coalesce(p_ta, '')), ''), (
    select min(m."Tahun Pelajaran")::text from master_data m
    where m."Tahun Pelajaran" is not null and trim(m."Tahun Pelajaran"::text) <> ''
  ), to_char(now() at time zone 'Asia/Jakarta', 'YYYY') || '/' ||
       to_char((now() at time zone 'Asia/Jakarta') + interval '1 year', 'YYYY'));

  -- 0a) Semester yang akan ditandai (hanya Ganjil/Genap; abaikan lainnya)
  if p_smt is not null then
    select array_agg(x) into v_smt_bersih
    from unnest(p_smt) as x
    where trim(coalesce(x, '')) in ('Ganjil', 'Genap');
  end if;
  v_smt_bersih := coalesce(v_smt_bersih, array[]::text[]);

  -- 1) Identitas pemanggil
  select tipe, jabatan_ekskul_map, wali_kelas, ekstrakurikuler
  into v_tipe, v_jabatan_map, v_wali_kelas, v_ekstra
  from akun
  where nis_nip = p_pemanggil;

  if not found then
    return json_build_object('status', 'error', 'message', 'Akun pemanggil tidak ditemukan.');
  end if;

  -- 2) Verifikasi hak akses per tipe
  if v_tipe = 'admin' then
    null;
  elsif v_tipe = 'guru' then
    if coalesce(trim(coalesce(v_wali_kelas, '')), '') = ''
       and not (lower(trim(p_ekskul)) = any (
            select lower(trim(x))
            from unnest(string_to_array(coalesce(v_ekstra, ''), ',')) as t(x)
            where trim(x) <> ''
          ))
    then
      return json_build_object('status', 'error', 'message',
        'Hanya wali kelas atau pembina ' || p_ekskul || ' yang dapat mengubah anggota.');
    end if;
  elsif v_tipe = 'murid' then
    if v_jabatan_map is null or coalesce(trim(coalesce(v_jabatan_map->>p_ekskul, '')), '') = '' then
      return json_build_object('status', 'error', 'message', 'Hanya pengurus (menjabat) ' || p_ekskul || ' yang dapat mengubah anggota.');
    end if;
  else
    return json_build_object('status', 'error', 'message', 'Tipe akun pemanggil tidak dikenal.');
  end if;

  -- 3) Terapkan per NIS (gabung/buang nama ekskul, anti-duplikat) → kolom live + riwayat_ekskul[TA]
  if p_nis_list is null then
    p_nis_list := array[]::text[];
  end if;

  foreach v_nis in array p_nis_list loop
    if trim(coalesce(v_nis, '')) = '' then continue; end if;

    select ekstrakurikuler, coalesce(riwayat_ekskul, '{}'::jsonb)
    into v_ekstra_siswa, v_riwayat
    from akun
    where nis_nip = v_nis and tipe = 'murid'
    for update;

    if not found then continue; end if;

    -- a) Kolom live akun.ekstrakurikuler
    if p_tambah then
      if lower(trim(p_ekskul)) = any (
        select lower(trim(x)) from unnest(string_to_array(coalesce(v_ekstra_siswa, ''), ',')) as x where trim(x) <> ''
      ) then
        v_baru := v_ekstra_siswa;
      else
        v_baru := case
          when coalesce(trim(v_ekstra_siswa), '') = '' then trim(p_ekskul)
          else trim(v_ekstra_siswa) || ',' || trim(p_ekskul)
        end;
      end if;
    else
      select string_agg(x, ',') into v_baru
      from (
        select trim(x) as x
        from unnest(string_to_array(coalesce(v_ekstra_siswa, ''), ',')) as t(x)
        where trim(x) <> '' and lower(trim(x)) <> lower(trim(p_ekskul))
      ) s;
      v_baru := coalesce(v_baru, '');
    end if;

    -- b) Entri riwayat_ekskul[TA]
    v_entri := coalesce(v_riwayat->v_ta, '{}'::jsonb);
    v_eks_riwayat := coalesce(nullif(trim(coalesce(v_entri->>'ekskul', '')), ''), v_ekstra_siswa);
    if p_tambah then
      if lower(trim(p_ekskul)) = any (
        select lower(trim(x)) from unnest(string_to_array(v_eks_riwayat, ',')) as x where trim(x) <> ''
      ) then
        v_baru_riwayat := v_eks_riwayat;
      else
        v_baru_riwayat := case
          when coalesce(trim(v_eks_riwayat), '') = '' then trim(p_ekskul)
          else trim(v_eks_riwayat) || ',' || trim(p_ekskul)
        end;
      end if;
    else
      select string_agg(x, ',') into v_baru_riwayat
      from (
        select trim(x) as x
        from unnest(string_to_array(v_eks_riwayat, ',')) as t(x)
        where trim(x) <> '' and lower(trim(x)) <> lower(trim(p_ekskul))
      ) s;
      v_baru_riwayat := coalesce(v_baru_riwayat, '');
    end if;

    v_jmap := coalesce((v_entri->>'jabatan_map')::jsonb, coalesce(v_jabatan_map, '{}'::jsonb));
    v_jmap := coalesce(v_jmap, '{}'::jsonb);

    -- SEMESTER: gabungkan (union) semester yang sudah ada + yang baru untuk p_ekskul.
    --   smt[ekskul] = [Ganjil, Genap] → siswa ikut di kedua semester (skenario B).
    --   Menambah anggota tanpa p_smt → smt[ekskul] dibiarkan polos (kedua semester).
    v_smt := coalesce((v_entri->>'smt')::jsonb, '{}'::jsonb);
    if v_smt = 'null'::jsonb then v_smt := '{}'::jsonb; end if;
    v_teks_smt := coalesce(v_smt->>p_ekskul, '');
    v_smt_entri := array(
      select trim(x) from unnest(string_to_array(v_teks_smt, ',')) as t(x)
      where trim(x) in ('Ganjil', 'Genap')
    );
    if array_length(v_smt_bersih, 1) > 0 then
      select array_agg(distinct y) into v_smt_entri
      from (
        select unnest(v_smt_entri) as y
        union
        select unnest(v_smt_bersih)
      ) s;
    end if;

    update akun
       set ekstrakurikuler = v_baru,
           riwayat_ekskul = jsonb_set(
              coalesce(v_riwayat, '{}'::jsonb),
              array[v_ta],
              jsonb_build_object(
                'ekskul', v_baru_riwayat,
                'jabatan_map', v_jmap,
                'status', 'Aktif',
                'smt', case
                  when array_length(v_smt_entri, 1) > 0
                    then jsonb_set(coalesce(v_smt, '{}'::jsonb), array[p_ekskul], to_jsonb(v_smt_entri))
                  else v_smt
                end
              )
           )
     where nis_nip = v_nis;

    v_total := v_total + 1;
  end loop;

  return json_build_object('status', 'success', 'total', v_total);
end $$;

-- ========== IZIN EKSEKUSI + RELOAD CACHE ==========
-- Hapus overload lama (5 argumen) lalu izinkan baris baru (6 argumen).
drop function if exists ubah_anggota_ekskul(text, text, text[], boolean, text);
grant execute on function ubah_anggota_ekskul(text, text, text[], boolean, text, text[]) to anon, authenticated;

notify pgrst, 'reload schema';

