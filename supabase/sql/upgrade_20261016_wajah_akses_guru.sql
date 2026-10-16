-- ============================================================
-- UPGRADE: IZINKAN GURU (WALI KELAS/PEMBINA) SIMPAN WAJAH MURID — 2026-12-11
-- Jalankan SELURUH file ini di Supabase Dashboard → SQL Editor → Run
--
-- LATAR BELAKANG:
--   Menu "Data Akun Murid" kini menampilkan tombol "Wajah Masal" & "Sinkron Foto"
--   untuk admin & guru (wali kelas / pembina ekskul) — lihat bisaImportMuridAktif()
--   di web/js/app.js. Namun RPC `simpan_wajah_murid` selama ini hanya mengizinkan
--   admin atau murid pemilik NIS, sehingga guru yang menjalankan scan wajah masal
--   selalu ditolak ("Tidak berhak mengubah data wajah murid ini").
--
-- ISI UPGRADE:
--   1) Helper `akun_guru_ampu_murid` dibuat PASTI ada (create or replace,
--      idempotent) — bisa berdiri sendiri meski dijalankan sebelum upgrade_20261015.
--   2) `simpan_wajah_murid` diubah: selain admin & murid pemilik, guru DIIZINKAN
--      bila ia WALI KELAS murid tsb ATAU PEMBINA ekskul murid.
--
-- Idempotent (create or replace) — aman dijalankan berulang.
-- ============================================================

-- ========== 1. HELPER (PASTI ADA): GURU MENGAMPU MURID? ==========
create or replace function akun_guru_ampu_murid(p_guru_nis text, p_murid_nis text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if trim(coalesce(p_guru_nis, '')) = '' or trim(coalesce(p_murid_nis, '')) = '' then
    return false;
  end if;
  return exists (
    select 1
    from akun g
    join akun m on m.nis_nip = p_murid_nis and m.tipe = 'murid'
    where g.nis_nip = p_guru_nis and g.tipe = 'guru'
      and (
        (lower(trim(coalesce(g.wali_kelas, ''))) <> ''
         and lower(trim(g.wali_kelas)) = lower(trim(coalesce(m.tingkat_kelas, ''))))
        or exists (
          select 1
          from unnest(string_to_array(g.ekstrakurikuler, ',')) ge
          cross join unnest(string_to_array(m.ekstrakurikuler, ',')) me
          where trim(ge) <> '' and lower(trim(ge)) = lower(trim(me))
        )
      )
  );
end $$;

-- ========== 2. RPC: SIMPAN / HAPUS DATA WAJAH (MULTI-SAMPEL) — +IZIN GURU ==========
-- Otorisasi:
--   - admin                       : boleh penuh (termasuk masal).
--   - murid pemilik NIS           : kelola mandiri.
--   - guru (wali kelas/pembina)   : boleh pada murid yang diampu.
create or replace function simpan_wajah_murid(
  p_nis text,
  p_descriptor jsonb default null,
  p_status text default 'aktif',
  p_pemanggil_nis text default null,
  p_pemanggil_tipe text default null,
  p_mode text default 'ganti'
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ada boolean;
  v_list jsonb;
  v_lama jsonb;
  v_baru jsonb;
  v_jumlah int;
  v_jumlah_lama int;
  v_i int;
  v_j int;
  v_sampel jsonb;
  v_elemen jsonb;
begin
  p_nis := trim(coalesce(p_nis, ''));
  p_status := lower(trim(coalesce(p_status, '')));
  p_mode := lower(trim(coalesce(p_mode, 'ganti')));

  if p_nis = '' then
    return json_build_object('status', 'error', 'message', 'NIS wajib diisi.');
  end if;

  select exists (select 1 from akun where nis_nip = p_nis and tipe = 'murid') into v_ada;
  if not v_ada then
    return json_build_object('status', 'error', 'message', 'Data murid tidak ditemukan.');
  end if;

  -- Otorisasi: admin, murid pemilik, atau guru wali kelas/pembina ekskul murid tsb.
  if p_pemanggil_tipe <> 'admin'
     and not (p_pemanggil_tipe = 'murid' and p_pemanggil_nis = p_nis)
     and not (p_pemanggil_tipe = 'guru' and akun_guru_ampu_murid(p_pemanggil_nis, p_nis)) then
    return json_build_object('status', 'error', 'message', 'Tidak berhak mengubah data wajah murid ini.');
  end if;


  -- ===== Normalisasi + validasi p_descriptor =====
  if p_descriptor is not null then
    if jsonb_typeof(p_descriptor) <> 'array' then
      return json_build_object('status', 'error', 'message', 'Deskriptor wajah harus berupa array 128 angka (atau array dari array semacam itu).');
    end if;
    -- Klien lama/kirimanku masih BISA mengirim flat [128 angka] → bungkus sekali.
    if jsonb_array_length(p_descriptor) = 128 and jsonb_typeof(p_descriptor -> 0) = 'number' then
      v_list := jsonb_build_array(p_descriptor);
    else
      v_list := p_descriptor;
    end if;

    v_jumlah := jsonb_array_length(v_list);
    if v_jumlah < 1 then
      return json_build_object('status', 'error', 'message', 'Minimal satu sampel wajah diperlukan.');
    end if;
    if p_mode = 'tambah' and v_jumlah <> 1 then
      return json_build_object('status', 'error', 'message', 'Mode tambah menerima tepat satu sampel (array 128 angka).');
    end if;
    if p_mode = 'ganti' and v_jumlah > 6 then
      return json_build_object('status', 'error', 'message', 'Maksimal 6 sampel wajah per murid (' || v_jumlah || ' diberikan).');
    end if;

    for v_i in 0 .. v_jumlah - 1 loop
      v_sampel := v_list -> v_i;
      if jsonb_typeof(v_sampel) <> 'array' or jsonb_array_length(v_sampel) <> 128 then
        return json_build_object('status', 'error', 'message', 'Setiap sampel wajah harus berupa array 128 angka.');
      end if;
      for v_j in 0 .. 127 loop
        v_elemen := v_sampel -> v_j;
        if jsonb_typeof(v_elemen) not in ('number') or not (v_elemen #>> '{}')::double precision between -10 and 10 then
          return json_build_object('status', 'error', 'message', 'Deskriptor wajah berisi nilai tidak valid.');
        end if;
      end loop;
    end loop;
  end if;

-- ===== Terapkan =====
  if p_status = 'aktif' and p_descriptor is not null then
    if p_mode = 'tambah' then
      select coalesce(wajah_descriptor, '[]'::jsonb) into v_lama
        from akun where nis_nip = p_nis and tipe = 'murid';
      -- Baris lama yang belum sempat dimigrasi (flat) → bungkus dulu sebelum append.
      if jsonb_typeof(v_lama) = 'array' and jsonb_array_length(v_lama) = 128 and jsonb_typeof(v_lama -> 0) = 'number' then
        v_lama := jsonb_build_array(v_lama);
      end if;
      if jsonb_typeof(v_lama) <> 'array' then
        v_lama := '[]'::jsonb;
      end if;
      v_jumlah_lama := jsonb_array_length(v_lama);
      if v_jumlah_lama + 1 > 6 then
        return json_build_object('status', 'error', 'message', 'Maksimal 6 sampel wajah per murid — gunakan mode ganti untuk mengganti seluruh data.');
      end if;
      v_baru := v_lama || v_list;
      update akun
         set wajah_descriptor = v_baru,
             wajah_status     = 'aktif'
       where nis_nip = p_nis and tipe = 'murid';
      return json_build_object('status', 'success', 'message', 'Data wajah murid tersimpan (' || jsonb_array_length(v_baru) || ' sampel).');
    else
      update akun
         set wajah_descriptor = v_list,
             wajah_status     = 'aktif'
       where nis_nip = p_nis and tipe = 'murid';
      return json_build_object('status', 'success', 'message', 'Data wajah murid tersimpan (' || jsonb_array_length(v_list) || ' sampel).');
    end if;
  elsif p_status = 'nonaktif' then
    update akun
       set wajah_status = 'nonaktif'
     where nis_nip = p_nis and tipe = 'murid';
    return json_build_object('status', 'success', 'message', 'Data wajah murid dinonaktifkan.');
  else
    -- hapus total (p_status NULL/'' atau p_descriptor NULL)
    update akun
       set wajah_descriptor = null,
           wajah_status     = null
     where nis_nip = p_nis and tipe = 'murid';
    return json_build_object('status', 'success', 'message', 'Data wajah murid dihapus.');
  end if;
end $$;


-- ========== 3. DROP OVERLOAD LAMA + IZIN + RELOAD CACHE ==========
drop function if exists simpan_wajah_murid(text, jsonb, text, text, text);

grant execute on function akun_guru_ampu_murid(text, text) to anon, authenticated;
grant execute on function simpan_wajah_murid(text, jsonb, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

