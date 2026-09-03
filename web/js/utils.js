/**
 * utils.js — Adapter Supabase untuk SIAKAD
 */

// 1. Inisialisasi Supabase
const SUPABASE_URL = 'https://lkhuyoihrrnzvrmhquln.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_o_pUNncXPyOmV2yhhOevcw_58aUM3pB';

// PERBAIKAN: Gunakan nama 'supaClient' agar tidak bentrok dengan library bawaan CDN
const supaClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// Manajemen Sesi Lokal (Harus ada di utils.js)
function getToken() { 
  return localStorage.getItem('sisip_token') || ''; 
}

function setSession(token, user) {
  localStorage.setItem('sisip_token', token);
  localStorage.setItem('sisip_user', JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem('sisip_token');
  localStorage.removeItem('sisip_user');
}

// INI FUNGSI YANG ERROR KARENA HILANG:
function getCurrentUser() {
  try { 
    return JSON.parse(localStorage.getItem('sisip_user') || 'null'); 
  } catch (e) { 
    return null; 
  }
}

// 3. Pengganti apiCall (Router Request Backend)

/** Bangun respons sesi dari profil tabel 'akun' + user Auth.
 *  Dipakai bersama oleh login password dan sesi OAuth (GitHub). */
function bangunResponsSesi(prof, emailFallback, token) {
  const tipe = (prof && prof.tipe) || 'murid';
  const nama = (prof && prof.nama_lengkap) || emailFallback || 'Pengguna';
  const mappedUser = {
    "Nama Lengkap": nama,
    "Nama Guru": nama,
    "NIS": tipe === 'murid' ? ((prof && prof.nis_nip) || "") : "",
    "NIP": tipe === 'guru' ? ((prof && prof.nis_nip) || "") : "",
    "ID Akun Guru": tipe === 'guru' ? ((prof && prof.nis_nip) || "") : "",
    "Email": (prof && prof.email) || emailFallback || "",
    "Tingkat/Kelas": (prof && prof.tingkat_kelas) || "",
    "Jabatan": (prof && prof.jabatan) || "",
    "Custom Teks Mata Pelajaran": "",
    "Ekstrakurikuler": "",
    "ID Tahun Pelajaran": ""
  };
  return { status: 'success', role: tipe, user: mappedUser, token };
}

async function apiCall(action, data = {}) {
  try {
    if (action === 'login') {
      const identifier = String(data.username || '').trim();
      const password = String(data.password || '');
      if (!identifier || !password) return { status: 'error', message: 'Isi NIS/NIP/Email dan Password.' };

      // Skema DB saat ini: tabel 'akun' (user_id → auth.users, tipe = role).
      // Password TIDAK tersimpan di tabel 'akun', jadi autentikasi memakai Supabase Auth.
      let emailAuth = identifier;
      if (!identifier.includes('@')) {
        // Login memakai NIS/NIP → cari email akun terkait
        const { data: byNis, error: errNis } = await supaClient
          .from('akun')
          .select('email')
          .eq('nis_nip', identifier)
          .maybeSingle();
        if (errNis) return { status: 'error', message: 'Gagal mencari akun: ' + errNis.message };
        if (!byNis || !byNis.email) return { status: 'error', message: 'NIS/NIP tidak terdaftar.' };
        emailAuth = byNis.email;
      }

      const { data: authRes, error: authErr } = await supaClient.auth.signInWithPassword({ email: emailAuth, password });
      if (authErr || !authRes || !authRes.session) {
        return { status: 'error', message: 'Email/NIS atau Password salah. Jika akun Anda terdaftar via Google, gunakan tombol "Masuk dengan Google".' };
      }

      let { data: prof, error: profErr } = await supaClient
        .from('akun')
        .select('*')
        .eq('user_id', authRes.user.id)
        .maybeSingle();

      // Profil belum tertaut user_id → cocokkan lewat email lalu tautkan (best-effort).
      // Berguna untuk akun yang dibuat manual lewat Supabase Dashboard (mis. admin).
      if (!profErr && !prof && authRes.user.email) {
        const { data: byEmail } = await supaClient
          .from('akun')
          .select('*')
          .eq('email', authRes.user.email)
          .maybeSingle();
        if (byEmail) {
          prof = byEmail;
          supaClient.from('akun').update({ user_id: authRes.user.id }).eq('id', byEmail.id)
            .then(r => { if (r.error) console.warn('Taut user_id gagal:', r.error.message); })
            .catch(() => {});
        }
      }
      if (profErr) return { status: 'error', message: 'Gagal memuat profil: ' + profErr.message };
      if (!prof) {
        await supaClient.auth.signOut();
        return { status: 'error', message: 'Akun Auth belum terhubung ke tabel akun. Hubungi admin.' };
      }

      return bangunResponsSesi(prof, authRes.user.email || "", authRes.session.access_token);
    }

    if (action === 'sesi_auth') {
      // Sesi OAuth (GitHub) — supabase-js otomatis menukar kode redirect saat load;
      // cukup baca sesi aktif lalu bangun sessionUser dari profil tabel 'akun'.
      const { data } = await supaClient.auth.getSession();
      const sesi = data && data.session;
      if (!sesi || !sesi.user) return { status: 'no_session' };

      let { data: prof } = await supaClient
        .from('akun')
        .select('*')
        .eq('user_id', sesi.user.id)
        .maybeSingle();

      if (!prof && sesi.user.email) {
        // Profil belum tertaut user_id → coba cocokkan lewat email, lalu tautkan (best-effort)
        const { data: byEmail } = await supaClient
          .from('akun')
          .select('*')
          .eq('email', sesi.user.email)
          .maybeSingle();
        if (byEmail) {
          prof = byEmail;
          supaClient.from('akun').update({ user_id: sesi.user.id }).eq('id', byEmail.id)
            .then(r => { if (r.error) console.warn('Taut user_id gagal:', r.error.message); })
            .catch(() => {});
        }
      }

      if (!prof) {
        await supaClient.auth.signOut();
        return { status: 'error', message: 'Akun Auth belum terhubung ke tabel akun. Hubungi admin.' };
      }
      return bangunResponsSesi(prof, sesi.user.email || '', sesi.access_token);
    }

    if (action === 'save_absen_masal') {
      // Adaptasi simpan absensi masal
      const insertData = data.absenList.map(absen => ({
        nis: absen.nis,
        tanggal: data.tanggal,
        status: absen.status,
        keterangan: absen.keterangan || data.keterangan_kehadiran_masal || "",
        mapel: data.mapel,
        kelas: data.kelas
      }));

      const { error } = await supaClient.from('absensi').upsert(insertData);
      
      if (error) throw error;
      return { status: 'success' };
    }

    throw new Error(`Action '${action}' tidak dikenali oleh Supabase Adapter`);
    
  } catch (error) {
    console.error(`Error on apiCall [${action}]:`, error);
    return { status: 'error', message: error.message || "Terjadi kesalahan koneksi" };
  }
}

// 2. UI login & listener form ditangani app.js (menghindari submit ganda).

/** Kelola akun (buat/hapus user Auth + profil) via Edge Function 'buat-akun'.
 *  Token pemanggil diverifikasi di server — hanya admin yang diizinkan. */
async function kelolaAkunAuth(payload = {}) {
  try {
    const { data: sesi } = await supaClient.auth.getSession();
    const token = sesi && sesi.session && sesi.session.access_token;
    if (!token) return { status: 'error', message: 'Sesi habis. Silakan login ulang.' };

    const res = await fetch(`${SUPABASE_URL}/functions/v1/buat-akun`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (e) {
    console.error('kelolaAkunAuth:', e);
    return { status: 'error', message: e.message || 'Gagal menghubungi server.' };
  }
}

// 4. Pengganti fetch global khusus untuk mengambil data (GET)
// Karena di app.js Anda banyak menggunakan `fetch(API_URL + '?action=get_master_data')`
async function supabaseFetch(action, payload = {}) {
    try {
        if (action === 'get_master_data') {
            const { data, error } = await supaClient.from(tableName).select('*');
            if (error) throw error;
            
            // Format ulang keys agar sesuai format Google Sheets yang ada spasi/huruf besar
            const formattedData = data.map(item => ({
                "Tahun Pelajaran": item.tahun_pelajaran,
                "Tingkat/Kelas": item.tingkat_kelas,
                "Mata Pelajaran": item.mata_pelajaran,
                "Ekstrakurikuler": item.ekstrakurikuler,
                "Nama Sekolah": item.nama_sekolah,
                "URL LOGO 1": item.url_logo
            }));
            
            return { status: 'success', data: formattedData };
        }

        if (action === 'get_dashboard_data') {
             // Ambil data murid berdasarkan kelas
             const { data: murid, error: errMurid } = await supabase
                .from('users')
                .select('nis, nama_lengkap, tingkat_kelas')
                .eq('role', 'murid')
                .eq('tingkat_kelas', payload.kelas);
             
             // Ambil absensi bulan/tahun ini
             const { data: absen, error: errAbsen } = await supabase
                .from('absensi')
                .select('*')
                .eq('kelas', payload.kelas)
                .eq('mapel', payload.mapel);

             if (errMurid || errAbsen) throw new Error("Gagal mengambil data dashboard");

             return {
                 status: 'success',
                 murid: murid.map(m => ({ "NIS": m.nis, "Nama Lengkap": m.nama_lengkap, "Tingkat/Kelas": m.tingkat_kelas })),
                 absen: absen.map(a => ({ "NIS": a.nis, "Tanggal": a.tanggal, "Status": a.status, "Keterangan": a.keterangan }))
             };
        }

    } catch (error) {
        console.error("Supabase Fetch Error:", error);
        return { status: 'error', data: [] };
    }
}

// Utilities pendukung bawaan Anda
function escapeHtml(str) { /*...*/ }
function showToast(icon = 'success', title = '') {
  if (typeof Swal === 'undefined') { console.log(`[${icon}] ${title}`); return; }
  Swal.fire({
    toast: true, position: 'top-end', icon, title,
    showConfirmButton: false, timer: 2500,
    background: '#1e293b', color: '#fff'
  });
}