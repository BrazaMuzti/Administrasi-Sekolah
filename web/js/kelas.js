/* ==========================================================================
 * web/js/kelas.js — NORMALISASI LABEL KELAS (modul MURNI, tanpa DOM)
 * ==========================================================================
 * Cermin JavaScript 1:1 dari helper SQL Tahap 2
 * (supabase/sql/upgrade_20261115_kelas_normalisasi.sql):
 *
 *   KELAS.pecah()         ≙ fn_pecah_kelas(text)   → {tingkat, jurusan_kode, rombel}
 *   KELAS.label()         ≙ fn_label_kelas(text, text, integer)
 *   KELAS.normalTingkat() ≙ fn_normal_tingkat(text)
 *
 * Format kanonik: "<TINGKAT> <JURUSAN_KODE> <ROMBEL>" → "X LP 1".
 * Bentuk lain yang ditoleransi: "10 RPL 1", "x rpl 1", "X-RPL-1",
 * "X LP" (tanpa rombel), "XII IPA 2".
 * Label BUKAN kelas ("", "Semua Kelas", "Hadir", "Islam", "Aktif", …) →
 * tingkat/jurusan_kode/rombel kosong (tidak pernah salah tafsir).
 *
 * Selain pencerminan SQL, modul ini menyediakan aksesor BARIS DB (dipakai
 * frontend Tahap 3) yang mengutamakan kolom TERSTRUKTUR hasil migrasi
 * (tingkat / jurusan_kode / rombel) dan baru menguraikan label teks sebagai
 * cadangan — sehingga label lama seperti "10 RPL 1" tetap dimengerti:
 *
 *   KELAS.komponen(row)        → komponen dari baris (master_data/akun/jadwal)
 *   KELAS.komponenTahun(row,ta)→ komponen kelas murid pada satu tahun pelajaran
 *   KELAS.labelDariBaris(row)  → label kanonik baris (fallback label tersimpan)
 *   KELAS.kunci(v) / sama(a,b) → kunci & pembanding kelas setara
 *                                 ("10 RPL 1" ≡ "X RPL 1", "x rpl 1" ≡ "X RPL 1")
 *   KELAS.naik(t) / turun(t)   → tingkat naik (X→XI→XII→LULUS) / turun
 *   KELAS.angkatan(v)          → 'X' | 'XI' | 'XII' | '' (dukung "10 RPL 1")
 *
 * DAFTAR KELAS WALI (Tahap 4A: satu guru boleh wali >1 kelas) — `penugasan[TA].wali`
 * kini berupa ARRAY label kelas; kolom lama yang menyimpan SATU string tetap dibaca:
 *
 *   KELAS.normKelasList(v)     → daftar kelas dari string LAMA/array/null → array bersih & unik
 *   KELAS.gabungKelas(...)     → gabung beberapa sumber daftar kelas (union, tanpa duplikat)
 *   KELAS.adaKelas(daftar, k)  → daftar memuat kelas k? (pembanding kanonik)
 *   KELAS.teksKelasList(v)     → daftar kelas → teks "X LP 1, X LP 2" (kolom lama/dokumen)
 *
 * Dipakai web/js/app.js sebagai SATU sumber kebenaran format kelas
 * (helper lama di app.js hanya mendelegasikan ke modul ini).
 * Dapat diuji tanpa browser: `npm run test:kelas` (scripts/uji-kelas.mjs).
 * ========================================================================== */
(function (root) {
  'use strict';

  /** Tingkat kanonik yang dikenal (romawi). */
  const TINGKAT_URUT = ['X', 'XI', 'XII'];
  /** Pola tingkat yang sah (hasil normalisasi): romawi apa pun atau 1–2 digit. */
  const RE_TINGKAT = /^([IVX]+|[0-9]{1,2})$/;
  /** Label yang jelas BUKAN kelas (dibuang sebelum diurai). */
  const RE_BUKAN_KELAS = /semua/i;

  /** trim() aman: null/undefined → ''. */
  function bersih(v) {
    return String(v === null || v === undefined ? '' : v).replace(/^\s+|\s+$/g, '');
  }

  /** true bila nilai kosong/whitespace saja. */
  function kosong(v) {
    return bersih(v) === '';
  }

  /** Tingkat kanonik: '10'→'X', '11'→'XI', '12'→'XII', sisanya UPPER. (≙ fn_normal_tingkat) */
  function normalTingkat(v) {
    const t = bersih(v).toUpperCase();
    if (t === '10') return 'X';
    if (t === '11') return 'XI';
    if (t === '12') return 'XII';
    return t;
  }

  /** Objek komponen kosong (label bukan kelas). */
  function komponenKosong() {
    return { tingkat: '', jurusan_kode: '', rombel: null };
  }

  /** Nomor rombel dari nilai apa pun → number atau null (≙ cast integer SQL). */
  function angkaRombel(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = parseInt(String(v).trim(), 10);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Pecah label kelas gabungan → {tingkat, jurusan_kode, rombel}.
   * (≙ fn_pecah_kelas) Token pertama = tingkat, angka 1–2 digit di akhir = rombel,
   * sisanya = kode jurusan (UPPER). Label non-kelas → semua kosong.
   */
  function pecah(label) {
    let v = bersih(String(label === null || label === undefined ? '' : label).replace(/\s+/g, ' '));
    v = bersih(v.replace(/[-_]+/g, ' '));

    if (v === '' || RE_BUKAN_KELAS.test(v)) return komponenKosong();

    const mTok = v.match(/^(\S+)/);
    const tingkat = normalTingkat(mTok ? mTok[1] : '');
    if (!RE_TINGKAT.test(tingkat)) return komponenKosong();

    const mNo = v.match(/([0-9]{1,2})\s*$/);
    const rombel = mNo ? angkaRombel(mNo[1]) : null;

    let kode = bersih(v.replace(/^\S+\s*/, '').replace(/\s*[0-9]{1,2}\s*$/, ''));
    kode = kode ? kode.toUpperCase() : '';

    return { tingkat, jurusan_kode: kode, rombel };
  }

  /** Rakit label kanonik "<TINGKAT> <JURUSAN_KODE> <ROMBEL>". (≙ fn_label_kelas) */
  function label(tingkat, jurusanKode, rombel) {
    let out = bersih(tingkat);
    const kode = bersih(jurusanKode).toUpperCase();
    if (kode) out += (out ? ' ' : '') + kode;
    const no = angkaRombel(rombel);
    if (no !== null) out += (out ? ' ' : '') + no;
    return bersih(out);
  }

  /** Label tersimpan pada sebuah baris (gaya baru & gaya lama terkumpul).
   *  Label LAMA/gaya-tersimpan didahulukan atas `kelas_label` (generated kanonik) supaya
   *  nilai yang dipakai filter & tampilan tetap sama dengan yang tersimpan di kolom —
   *  `kelas_label` hanya dipakai bila baris memang tak punya label teks (mis. baris
   *  baru yang langsung menulis kolom terstruktur). */
  function labelTersimpan(row) {
    const r = row || {};
    return String(r['Tingkat/Kelas'] ?? r.tingkat_kelas ?? r.kelas ?? r.Kelas ?? r.kelas_label ?? '');
  }

  /**
   * Komponen kelas efektif sebuah baris DB.
   * Prioritas: kolom terstruktur (tingkat/jurusan_kode/rombel) → kelas_label →
   * uraian label tersimpan. `row` boleh berupa string label (langsung diurai).
   */
  function komponen(row) {
    if (row === null || row === undefined) return komponenKosong();
    if (typeof row === 'string' || typeof row === 'number') return pecah(row);
    const r = row;
    const dariLabel = pecah(labelTersimpan(r));
    const tingkat = kosong(r.tingkat) ? dariLabel.tingkat : bersih(r.tingkat).toUpperCase();
    const kode = kosong(r.jurusan_kode) ? dariLabel.jurusan_kode : bersih(r.jurusan_kode).toUpperCase();
    const noStruk = angkaRombel(r.rombel);
    const rombel = noStruk !== null ? noStruk : dariLabel.rombel;
    return { tingkat, jurusan_kode: kode, rombel };
  }

  /** Entri riwayat kelas satu tahun pelajaran (null bila tak ada). */
  function entriRiwayat(row, tahun) {
    const rw = (row && (row.riwayat_kelas || row.RiwayatKelas)) || null;
    if (!rw || !tahun) return null;
    return rw[String(tahun)] || null;
  }

  /**
   * Komponen kelas murid pada tahun pelajaran tertentu.
   * Entri `riwayat_kelas[TA]` (sudah diperkaya tingkat/jurusan_kode/rombel oleh
   * fn_enrich_riwayat_kelas saat migrasi) → fallback label entri → fallback
   * kolom statis tingkat_kelas pada baris.
   */
  function komponenTahun(row, tahun) {
    const entri = entriRiwayat(row, tahun);
    if (!entri) return komponen(row);
    const dariEntri = pecah(entri.kelas || entri['Tingkat/Kelas'] || '');
    const tingkat = kosong(entri.tingkat) ? dariEntri.tingkat : bersih(entri.tingkat).toUpperCase();
    const kode = kosong(entri.jurusan_kode) ? dariEntri.jurusan_kode : bersih(entri.jurusan_kode).toUpperCase();
    const noStruk = angkaRombel(entri.rombel);
    const rombel = noStruk !== null ? noStruk : dariEntri.rombel;
    if (!tingkat && !kode && rombel === null) return komponen(row);
    return { tingkat, jurusan_kode: kode, rombel };
  }

  /** Label kelas efektif baris: kolom tersimpan bila ada, selain itu rakit dari komponen. */
  function labelDariBaris(row) {
    const tersimpan = bersih(labelTersimpan(row));
    if (tersimpan) return tersimpan;
    const k = komponen(row);
    return label(k.tingkat, k.jurusan_kode, k.rombel);
  }

  /**
   * Kunci pembanding kelas: label kanonik bila masih berbentuk kelas,
   * selain itu teks aslinya (UPPER) — supaya "Semua Kelas"/"Hadir" tidak
   * pernah dianggap sama dengan kelas mana pun.
   */
  function kunci(v) {
    if (v && typeof v === 'object') {
      const k = komponen(v);
      const l = label(k.tingkat, k.jurusan_kode, k.rombel);
      return l || bersih(labelTersimpan(v)).toUpperCase();
    }
    const p = pecah(v);
    if (!p.tingkat) return bersih(v).toUpperCase();
    return label(p.tingkat, p.jurusan_kode, p.rombel);
  }

  /** Dua label/baris kelas setara? ("10 RPL 1" ≡ "X RPL 1" ≡ "x rpl 1") */
  function sama(a, b) {
    const ka = kunci(a), kb = kunci(b);
    return ka !== '' && ka === kb;
  }

  /** Tingkat berikutnya: X→XI→XII→'LULUS' (tingkat tak dikenal → ''). */
  function naik(tingkat) {
    const t = normalTingkat(tingkat);
    const i = TINGKAT_URUT.indexOf(t);
    if (i === -1) return '';
    return i === TINGKAT_URUT.length - 1 ? 'LULUS' : TINGKAT_URUT[i + 1];
  }

  /** Tingkat sebelumnya: XII→XI→X (X tidak punya tingkat di bawah → ''). */
  function turun(tingkat) {
    const t = normalTingkat(tingkat);
    const i = TINGKAT_URUT.indexOf(t);
    if (i <= 0) return '';
    return TINGKAT_URUT[i - 1];
  }

  /** Angkatan sederhana: 'X' | 'XI' | 'XII' | '' (menerima "10 RPL 1" & baris DB). */
  function angkatan(v) {
    const k = v && typeof v === 'object' ? komponen(v) : pecah(v);
    return k.tingkat || '';
  }

  /** Gaya tingkat pada label asli ('angka' | 'romawi') — dipakai kenaikan kelas. */
  function gayaTingkat(labelAsli) {
    const tok = (bersih(String(labelAsli || '')).match(/^(\S+)/) || [])[1] || '';
    return /^[0-9]{1,2}$/.test(tok) ? 'angka' : 'romawi';
  }

  /** Tingkat dalam gaya tertentu: tingkatGaya('X','angka') → '10'. */
  function tingkatGaya(tingkatKanonik, gaya) {
    const t = normalTingkat(tingkatKanonik);
    if (gaya !== 'angka') return t;
    if (t === 'X') return '10';
    if (t === 'XI') return '11';
    if (t === 'XII') return '12';
    return t;
  }

  /* ── DAFTAR KELAS WALI (Tahap 4A) ─────────────────────────────────────── */

  /**
   * Nilai "kelas wali" apa pun → DAFTAR label kelas bersih.
   * Menerima string LAMA ("X LP 1" atau "X LP 1, X LP 2"), array BARU
   * (["X LP 1","X LP 2"]), baris DB (→ label kelasnya), atau null/undefined (→ []).
   * Duplikat dibuang dengan pembanding kanonik (sama()), tulisan asli dipertahankan.
   */
  function normKelasList(v) {
    const sumber = Array.isArray(v)
      ? v
      : (v && typeof v === 'object' ? [v] : String(v === null || v === undefined ? '' : v).split(','));
    const hasil = [];
    sumber.forEach((x) => {
      const k = bersih(x && typeof x === 'object' ? labelDariBaris(x) : x);
      if (!k) return;
      if (hasil.some((y) => sama(y, k))) return;
      hasil.push(k);
    });
    return hasil;
  }

  /** Daftar kelas memuat kelas tertentu? (kanonik: "10 LP 1" ≡ "X LP 1"). */
  function adaKelas(daftar, kelas) {
    const target = bersih(kelas && typeof kelas === 'object' ? labelDariBaris(kelas) : kelas);
    if (!target) return false;
    return normKelasList(daftar).some((k) => sama(k, target));
  }

  /** Gabung beberapa sumber daftar kelas → satu daftar (union kanonik, urut kemunculan). */
  function gabungKelas(...daftar) {
    const hasil = [];
    daftar.forEach((d) => normKelasList(d).forEach((k) => {
      if (!adaKelas(hasil, k)) hasil.push(k);
    }));
    return hasil;
  }

  /** Daftar kelas → teks dipisah koma (cerminan kolom LAMA akun.wali_kelas & dokumen cetak). */
  function teksKelasList(v) {
    return normKelasList(v).join(', ');
  }

  const KELAS = {
    versi: '2',
    TINGKAT: TINGKAT_URUT.slice(),
    bersih: bersih,
    kosong: kosong,
    normalTingkat: normalTingkat,
    pecah: pecah,
    label: label,
    labelTersimpan: labelTersimpan,
    komponen: komponen,
    komponenTahun: komponenTahun,
    labelDariBaris: labelDariBaris,
    kunci: kunci,
    sama: sama,
    naik: naik,
    turun: turun,
    angkatan: angkatan,
    gayaTingkat: gayaTingkat,
    tingkatGaya: tingkatGaya,
    normKelasList: normKelasList,
    adaKelas: adaKelas,
    gabungKelas: gabungKelas,
    teksKelasList: teksKelasList
  };

  root.KELAS = KELAS;
})(typeof globalThis !== 'undefined' ? globalThis : window);
