let html5QrcodeScanner = null;
let clockInterval = null;

let showNamaSiswa = true; let rekapModeState = 0; 
let listMuridKelas = []; let masterDataCache = []; let rawAbsenData = []; let dataStatusKunciGuru = [];
let currentMenuId = 'dashboard'; let currentMenuText = 'Dashboard';

// Preferensi Tahun Pelajaran & Semester (dipilih saat login / header dashboard)
const PREF_SESI_KEY = 'sisip_sesi_pref';
function getPreferensiSesi() {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_SESI_KEY) || 'null');
    if (p && typeof p === 'object') return { tahun: p.tahun || '', semester: p.semester || '' };
  } catch (e) { /* abaikan */ }
  return { tahun: '', semester: '' };
}
function simpanPreferensiSesi(tahun, semester) {
  localStorage.setItem(PREF_SESI_KEY, JSON.stringify({ tahun: tahun || '', semester: semester || '' }));
}

/** Urutkan opsi dropdown A-Z (locale Indonesia). */
function urutAz(list) {
  return [...(list || [])].sort((a, b) => String(a).localeCompare(String(b), 'id', { sensitivity: 'base' }));
}

/** Buat link WhatsApp klik-besar dari nomor HP (0/62 dinormalisasi). */
function linkWA(noHp, pesan) {
  const angka = String(noHp || '').replace(/\D/g, '');
  if (!angka) return `<span class="text-slate-500">-</span>`;
  const n = angka.startsWith('0') ? '62' + angka.slice(1) : angka;
  const p = pesan ? `?text=${encodeURIComponent(pesan)}` : '';
  return `<a href="https://wa.me/${n}${p}" target="_blank" class="text-green-300 hover:text-green-200 underline decoration-dotted"><i class="fa-brands fa-whatsapp"></i> ${escapeHtml(noHp)}</a>`;
}

/** Radio absen: klik ulang status yang sama → kosongkan pilihan. */
function radioToggleOff(el) {
  if (el.dataset.on === '1') { el.checked = false; el.dataset.on = '0'; }
  else {
    el.dataset.on = '1';
    document.querySelectorAll(`input[name="${el.name}"]`).forEach(r => { if (r !== el) r.dataset.on = '0'; });
  }
}

/** Lebar kolom nama di modal absen (dapat digeser; tersimpan di localStorage). */
let wNamaModal = parseInt(localStorage.getItem('sisip_nama_modal_width'), 10) || 240;
function mulaiGeserNamaModal(e) {
  e.preventDefault(); e.stopPropagation();
  const startX = e.clientX, startW = wNamaModal;
  const selSpans = (w) => document.querySelectorAll('.modal-nama-absen').forEach(sp => { sp.style.width = w + 'px'; });
  const gerak = (ev) => {
    const w = Math.min(360, Math.max(90, startW + ev.clientX - startX));
    if (w === wNamaModal) return;
    wNamaModal = w;
    selSpans(w);
  };
  const naik = () => {
    document.removeEventListener('mousemove', gerak);
    document.removeEventListener('mouseup', naik);
    localStorage.setItem('sisip_nama_modal_width', String(wNamaModal));
  };
  document.addEventListener('mousemove', gerak);
  document.addEventListener('mouseup', naik);
}

/** Lebar kolom Nama Siswa tabel absensi (dapat digeser via col-resizer; tersimpan di localStorage). */
let wNamaAbsen = parseInt(localStorage.getItem('sisip_nama_width'), 10) || 110;

/** Parse input hari bebas: "1, 3-5, 8 dan 10" / "1 sampai 3" → [1,3,4,5,8,10]. */
function parseDaftarHari(input) {
  const hari = new Set();
  const norm = String(input || '').toLowerCase()
    .replace(/\bsampai\b|\bs\/d\b|\bantara\b|\b-\b/g, '-')
    .replace(/\bdan\b|&/g, ',')
    .replace(/[^0-9,\-]/g, ',');
  norm.split(',').forEach(part => {
    const p = part.trim();
    if (!p) return;
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) { for (let i = Math.min(+m[1], +m[2]); i <= Math.max(+m[1], +m[2]); i++) hari.add(i); }
    else if (/^\d+$/.test(p)) hari.add(parseInt(p, 10));
  });
  return [...hari].filter(h => h >= 1 && h <= 31).sort((a, b) => a - b);
}

/** Cache guru → peta wali kelas (nama bergelar). */
let cacheGuruWali = [];

// ---------- DATA EKSTRAKURIKULER (SHARED) ----------
let cacheEkstrakurikuler = [];

/** Daftar ekskul gabungan (tabel ekstrakurikuler + Master Data), A-Z; baris tabel dicache di cacheEkstrakurikuler. */
async function ambilDaftarEkskul() {
  let dariTabel = [];
  try {
    const { data, error } = await supaClient.from('ekstrakurikuler').select('*');
    if (!error && data) {
      cacheEkstrakurikuler = data;
      dariTabel = data.map(e => e.nama_ekskul).filter(Boolean);
    }
  } catch (e) { console.warn('ambilDaftarEkskul:', e); }
  const dariMaster = [...new Set((masterDataCache || []).map(m => m["Ekstrakurikuler"]).filter(Boolean))];
  return urutAz([...new Set([...dariTabel, ...dariMaster])]);
}

/** Anggota ekskul: murid (tabel akun) yang kolom Ekstrakurikuler-nya memuat ekskul terpilih. */
async function ambilAnggotaEkskul(ekskul) {
  if (!ekskul) return [];
  const { data, error } = await supaClient.from('akun')
    .select('nis_nip, nama_lengkap, tingkat_kelas, jabatan, no_telepon')
    .eq('tipe', 'murid')
    .ilike('ekstrakurikuler', `%${ekskul}%`);
  if (error) { console.warn('ambilAnggotaEkskul:', error); return []; }
  return data || [];
}
async function petaWaliKelas() {
  if (cacheGuruWali.length === 0) {
    try {
      const { data, error } = await supaClient.from('akun')
        .select('nama_lengkap, gelar_depan, gelar_belakang, wali_kelas')
        .in('tipe', ['guru', 'admin']);
      if (!error && data) cacheGuruWali = data;
    } catch (e) { console.warn('petaWaliKelas:', e); }
  }
  const map = {};
  (cacheGuruWali || []).forEach(g => {
    if (g.wali_kelas) map[g.wali_kelas] = [g.gelar_depan, g.nama_lengkap, g.gelar_belakang].filter(Boolean).join(' ').replace(' ,', ', ');
  });
  return map;
}
let tempKeteranganHarian = {}; 

const arrBulan = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
let currentBulan = arrBulan[new Date().getMonth()]; 
let fabMenusList = []; 
let isFabOpen = false; 
let cacheListMapel = [];
let cacheListEkskul = [];

// Konfigurasi Default Libur Akhir Pekan
let liburConfigCache = { sabtu: true, minggu: true, customList: [] };

// Objek sesi aktif (global). Diisi dari hasil getCurrentUser() / hasil login.
let currentUser = null;


/**
 * Entry point utama setelah login:
 * 1) simpan user ke global `currentUser`,
 * 2) buat FAB menu navigasi,
 * 3) tampilkan dashboard & muat data sesuai peran (checkAuth → setupDashboard).
 */
function initApp(user) {
  currentUser = user !== undefined ? user : (currentUser || null);
  try { setupSmartFAB(); }
  catch (e) { console.error('initApp › setupSmartFAB:', e); }
  try { checkAuth(); }
  catch (e) { console.error('initApp › checkAuth:', e); }
  // Muat konfigurasi libur dari server (non-blocking) → liburConfigCache terisi nyata.
  // Sebelumnya isHoliday() selalu memakai default {sabtu:true, minggu:true, customList:[]}.
  try { muatDataJadwalLibur().catch(e => console.warn('initApp › jadwal/libur:', e)); }
  catch (e) { console.warn('initApp › jadwal/libur:', e); }
}

document.addEventListener('DOMContentLoaded', () => {
  const user = getCurrentUser();
  const loginView = document.getElementById('view-login');
  const dashboardView = document.getElementById('view-dashboard');
  
  if (!user) {
    // Belum login → hanya tampilkan halaman login
    if (dashboardView) dashboardView.classList.add('hidden');
    if (loginView) loginView.classList.remove('hidden');
    cekRecoveryPassword(); // link reset password dari email (type=recovery)
    cekSesiOAuth(); // kembalian OAuth (Google) → boot dashboard bila sesi valid
    isiDropdownSesi('login-tahun', 'login-semester'); // pilihan Tahun & Semester di halaman login
    muatLogoLogin(); // logo kartu login dari Master Data ("URL LOGO 1")
    return; // jangan render dashboard
  }

  initApp(user); // sesi tersimpan → langsung boot dashboard
}); // PERBAIKAN: Menambahkan kurung penutup ");" di sini

/** Isi logo kartu login dari kolom "URL LOGO 1" master_data (akses anon). */
async function muatLogoLogin() {
  try {
    const { data, error } = await supaClient.from('master_data').select('*');
    if (error || !data) return;
    const idn = data.find(r => (r["URL LOGO 1"] || r["URL LOGO 2"] || '').trim() !== '') || {};
    const url = idn["URL LOGO 1"] || idn["URL LOGO 2"] || '';
    const img = document.getElementById('login-logo');
    if (img && url) { img.src = url; img.style.display = ''; const fb = document.getElementById('login-logo-fallback'); if (fb) fb.style.display = 'none'; }
  } catch (e) { console.warn('muatLogoLogin:', e); }
}

/** Gabung nama dengan gelar depan/belakang: "Dr. Budi, S.Pd." */
function namaDenganGelar(nama, gelarDepan, gelarBelakang) {
  const d = (gelarDepan || '').trim();
  const b = (gelarBelakang || '').trim();
  return `${d ? d + ' ' : ''}${nama || ''}${b ? ', ' + b : ''}`;
}

/** Cari baris identitas sekolah (punya "Nama Sekolah" / URL logo) di cache master. */
function barisIdentitasMaster() {
  return (masterDataCache || []).find(r => (r["Nama Sekolah"] || r["URL LOGO 1"] || r["URL LOGO 2"] || '').trim() !== '') || masterDataCache[0] || {};
}

/** Deteksi kembalian login OAuth (Google): supabase-js sudah menyimpan sesi Auth,
 *  profil diambil dari tabel 'akun' lalu dashboard di-boot tanpa password. */
async function cekSesiOAuth() {
  try {
    const res = await apiCall('sesi_auth');
    if (res.status === 'success') {
      const sessionUser = { role: res.role, user: res.user };
      setSession(res.token, sessionUser);
      showToast('success', `Selamat datang, ${res.user["Nama Lengkap"]}!`);
      initApp(sessionUser);
    } else if (res.status === 'error') {
      showToast('error', res.message || 'Sesi OAuth tidak valid');
    }
  } catch (e) { console.warn('cekSesiOAuth:', e); }
}

// =====================================
// 1. SETUP DASHBOARD & HEADER DINAMIS (MASTER DATA)
// =====================================
async function setupDashboard() {
  const role = currentUser.role || 'user';
  const user = currentUser.user || {};
  const isPengurus = role === 'murid' && (user["Jabatan Kelas"] || "").match(/Ketua|Sekretaris/i);



  // FETCH MASTER DATA (Untuk Logo 1 & Nama Sekolah)
  if (masterDataCache.length === 0) {
    try {
        const { data, error } = await supaClient.from('master_data').select('*');
        if (!error && data) masterDataCache = data;
    } catch (e) {
        console.error("Gagal memuat master data", e);
    }
}

  // Tentukan Variabel Header (baris identitas = yang punya Nama Sekolah / URL logo)
  let logoUrl = "https://cdn-icons-png.flaticon.com/512/3135/3135807.png"; // Fallback Icon
  let namaSekolah = "SIAKAD";
  if (masterDataCache.length > 0) {
     const idn = barisIdentitasMaster();
     logoUrl = idn["URL LOGO 1"] || idn["URL LOGO 2"] || logoUrl;
     namaSekolah = idn["Nama Sekolah"] || namaSekolah;
  }

let userName = namaDenganGelar(
    user["Nama Guru"] || user["Nama Lengkap"] || "Pengguna",
    user["Gelar Depan"],
    user["Gelar Belakang"]
  ) || "Pengguna";
  let userRole = user["Jabatan Kelas"] || user["Jabatan"] || role.toUpperCase();
  let userInit = userName.charAt(0).toUpperCase();

  // MENCARI HEADER BAWAAN HTML (h-14 glass-header)
  let headerEl = document.querySelector('header.glass-header') || document.querySelector('header');
  
  // SUNTIKKAN KONTEN KE DALAM HEADER HTML YANG SUDAH ADA
  if(headerEl) {
      headerEl.innerHTML = `
        <div class="flex items-center justify-between w-full h-full px-2 sm:px-4">
           <!-- KIRI: Logo & Info Sekolah -->
           <div class="flex items-center gap-2 sm:gap-3">
               <img src="${logoUrl}" alt="Logo" class="w-9 h-9 sm:w-10 sm:h-10 object-contain bg-white/10 rounded-full p-1 shadow-sm border border-white/20">
               <div class="text-left flex flex-col justify-center">
                  <h1 class="text-[10px] sm:text-xs font-extrabold text-white tracking-wide uppercase drop-shadow-md leading-tight">${namaSekolah}</h1>
                  <div class="text-[8px] sm:text-[10px] text-blue-300 font-medium flex items-center gap-1.5 mt-0.5">
                     <i class="fa-regular fa-clock"></i> <span id="header-realtime-clock">--:--:--</span>
                     <span class="hidden sm:inline opacity-50">|</span>
                     <i class="fa-regular fa-calendar hidden sm:inline"></i> <span id="header-realtime-date" class="hidden sm:inline">---</span>
                  </div>
               </div>
           </div>
           
           <!-- KANAN: Profil User -->
           <div class="flex items-center gap-2 sm:gap-3 bg-slate-900/60 py-1 px-2 rounded-full border border-white/10 shadow-inner">
               <div class="text-right hidden sm:block">
                  <div class="text-[10px] font-bold text-white leading-tight truncate max-w-[120px] sm:max-w-[150px]">${userName}</div>
                  <div class="text-[8px] text-pink-400 font-semibold uppercase tracking-wider">${userRole}</div>
               </div>
               <div class="w-7 h-7 sm:w-8 sm:h-8 bg-gradient-to-tr from-blue-500 to-indigo-500 rounded-full flex items-center justify-center text-white font-bold text-xs sm:text-sm shadow-md border border-white/20 shrink-0">
                  ${userInit}
               </div>
           </div>
        </div>
      `;
  }

  startRealtimeClock(); // Mulai jalankan jam real-time

  // DAFTAR MENU
  let menus = (role === 'admin' || role === 'guru') 
  ? [ 
      { id: 'dashboard', icon: 'fa-chart-pie', text: 'Dashboard' }, 
      { id: 'absensi', icon: 'fa-clipboard-user', text: 'Hadir Tatap Muka' }, 
      { id: 'nilai', icon: 'fa-star', text: 'Input Nilai' }
    ]
  : [ 
      { id: 'dashboard-murid', icon: 'fa-user-check', text: 'Absen Mandiri Siswa' }, 
      { id: 'teman-sejawat', icon: 'fa-user-group', text: 'Penilaian Teman Sejawat' },
      { id: 'laporan-absen', icon: 'fa-clipboard-list', text: 'Laporan Saya' } 
    ];
  if (role === 'admin') {
      menus.push({ id: 'akun-admin', icon: 'fa-user-shield', text: 'Data Akun Admin' });
      menus.push({ id: 'akun-guru', icon: 'fa-chalkboard-user', text: 'Data Akun Guru' });
      menus.push({ id: 'jadwal-libur', icon: 'fa-calendar-days', text: 'Jadwal & Libur' });
      menus.push({ id: 'master-data', icon: 'fa-database', text: 'Master Data' });
  }
  // Guru dan Admin bisa akses Manajemen Murid
  if (role === 'admin' || role === 'guru') {
      menus.push({ id: 'ekstrakurikuler', icon: 'fa-medal', text: 'Ekstrakurikuler' });
      menus.push({ id: 'akun-murid', icon: 'fa-user-graduate', text: 'Data Akun Murid' });
  }

  if (isPengurus) menus.push({ id: 'absensi', icon: 'fa-clipboard-user', text: 'Input Hadir (Pengurus)' });

  // Murid anggota/pengurus ekstrakurikuler → menu Ekstrakurikuler (lihat Info, Agenda, Profil)
  const ekskulSaya = (user["Ekstrakurikuler"] || "").split(',').map(e => e.trim()).filter(Boolean);
  if (role === 'murid' && ekskulSaya.length > 0) menus.push({ id: 'ekstrakurikuler', icon: 'fa-medal', text: 'Ekstrakurikuler' });

  menus.push({ id: 'logout', icon: 'fa-right-from-bracket', text: 'Keluar (Logout)' });
  
  fabMenusList = menus;
  isiHeaderSesi();
  changeMenu(menus[0].id, menus[0].text);
}

/** Isi dropdown Tahun & Semester di header dashboard dari preferensi + master_data. */
function isiHeaderSesi() {
  const selT = document.getElementById('header-tahun');
  const selS = document.getElementById('header-semester');
  if (!selT || !selS) return;
  const pref = getPreferensiSesi();
  const now = new Date(); const cm = now.getMonth(), cy = now.getFullYear();
  const strOto = (cm >= 6) ? `${cy}/${cy+1}` : `${cy-1}/${cy}`;
  let list = [...new Set(masterDataCache.map(m => m["Tahun Pelajaran"]).filter(Boolean))];
  if (list.length === 0) list.push(strOto);
  if (pref.tahun && !list.includes(pref.tahun)) list.push(pref.tahun);
  const defaultTahun = (pref.tahun && list.includes(pref.tahun)) ? pref.tahun : list[0];
  const defaultSmt = (pref.semester === 'Ganjil' || pref.semester === 'Genap') ? pref.semester : ((cm >= 6) ? 'Ganjil' : 'Genap');
  selT.innerHTML = list.map(t => `<option value="${escJs(t)}" ${t === defaultTahun ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('');
  selS.innerHTML = ['Ganjil', 'Genap'].map(s => `<option value="${s}" ${s === defaultSmt ? 'selected' : ''}>${s}</option>`).join('');
}

/** Simpan pilihan header lalu muat ulang modul aktif agar default baru berlaku. */
function gantiPreferensiHeader() {
  const t = document.getElementById('header-tahun')?.value || '';
  const s = document.getElementById('header-semester')?.value || '';
  simpanPreferensiSesi(t, s);
  showToast('success', 'Default Tahun & Semester diperbarui');
  changeMenu(currentMenuId, currentMenuText);
}

/** Isi dropdown Tahun & Semester di halaman login (dibaca anon dari master_data). */
async function isiDropdownSesi(idTahun, idSemester) {
  const selT = document.getElementById(idTahun);
  const selS = document.getElementById(idSemester);
  if (!selT || !selS) return;
  const pref = getPreferensiSesi();
  const now = new Date(); const cm = now.getMonth(), cy = now.getFullYear();
  const strOto = (cm >= 6) ? `${cy}/${cy+1}` : `${cy-1}/${cy}`;
  let list = [];
  try {
    const { data, error } = await supaClient.from('master_data').select('*');
    if (!error && data) list = [...new Set(data.map(d => d["Tahun Pelajaran"]).filter(Boolean))];
  } catch (e) { console.warn('isiDropdownSesi:', e); }
  if (list.length === 0) list.push(strOto);
  if (pref.tahun && !list.includes(pref.tahun)) list.unshift(pref.tahun);
  const defaultTahun = (pref.tahun && list.includes(pref.tahun)) ? pref.tahun : strOto;
  const defaultSmt = (pref.semester === 'Ganjil' || pref.semester === 'Genap') ? pref.semester : ((cm >= 6) ? 'Ganjil' : 'Genap');
  selT.innerHTML = list.map(t => `<option value="${escJs(t)}" ${t === defaultTahun ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('');
  selS.innerHTML = ['Ganjil', 'Genap'].map(s => `<option value="${s}" ${s === defaultSmt ? 'selected' : ''}>${s}</option>`).join('');
}

function changeMenu(menuId, menuText) {
  if(menuId === 'logout') { logout(); return; }
  currentMenuId = menuId; currentMenuText = menuText;
  
  const mainContent = document.getElementById('main-content');
  
  if (menuId === 'absensi' || menuId === 'laporan-absen') renderAbsensiModule(mainContent);
  else if (menuId === 'dashboard-murid') renderAbsensiModule(mainContent); // [FIX] renderDashboardMurid tidak ada → modul absensi menangani role murid
  else if (menuId === 'teman-sejawat') renderTemanSejawatMurid(mainContent);
  else if (menuId === 'nilai') renderNilaiModule(mainContent);
  // TAMBAHKAN DUA BARIS INI:
  else if (menuId === 'akun-admin') renderManajemenAdmin(mainContent);
  else if (menuId === 'akun-murid') renderManajemenMurid(mainContent);
  else if (menuId === 'akun-guru') renderManajemenGuru(mainContent);
  else if (menuId === 'jadwal-libur') renderJadwalLiburModule(mainContent);
  else if (menuId === 'ekstrakurikuler') renderEkstrakurikulerModule(mainContent);
  else if (menuId === 'master-data') renderMasterDataModule(mainContent);
  else {
    mainContent.innerHTML = `<div class="glass-card p-6 rounded-xl flex flex-col items-center justify-center h-[70vh] text-slate-400">...</div>`;
  }
}

// =====================================
// 2. SISTEM SMART MASTER FAB (ANTI GHOST-CLICK MOBILE)
// =====================================
function setupSmartFAB() {
  const oldFab = document.getElementById('fab-container');
  if (oldFab) oldFab.remove();

  const style = document.createElement('style');
  style.innerHTML = `
    .text-stroke-hitam { color: white; text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0px 3px 5px rgba(0,0,0,0.9); }
    .fab-child-menu { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); opacity: 0; transform: scale(0.3) translateY(20px); pointer-events: none; }
    .fab-child-menu.show { opacity: 1; transform: scale(1) translateY(0px); pointer-events: auto; }
  `;
  document.head.appendChild(style);

  const fabContainer = document.createElement('div');
  fabContainer.id = 'fab-container';
  fabContainer.className = 'fixed z-[99999] flex flex-col items-center';
  fabContainer.style.top = '25px'; fabContainer.style.left = '25px'; fabContainer.style.touchAction = 'none';

  const menuList = document.createElement('div');
  menuList.id = 'fab-menu-list';
  menuList.className = 'absolute flex flex-col gap-3 z-[99998]';
  menuList.style.display = 'none'; 

  const fabMaster = document.createElement('div');
  fabMaster.id = 'fab-master';
  fabMaster.innerHTML = '<i class="fa-solid fa-layer-group text-2xl drop-shadow-md transition-transform duration-300" id="fab-master-icon"></i>';
  fabMaster.className = 'w-14 h-14 bg-gradient-to-tr from-blue-600 to-indigo-500 backdrop-blur-md rounded-full shadow-[0_4px_20px_rgba(37,99,235,0.8)] border border-white/40 flex items-center justify-center text-white cursor-pointer relative z-[99999]';

  fabContainer.appendChild(menuList);
  fabContainer.appendChild(fabMaster);
  document.body.appendChild(fabContainer);

  let isDragging = false, startX, startY;

  const onDragStart = (e) => {
    if (e.target.closest('#fab-menu-list')) return; 
    isDragging = false;
    startX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    startY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
  };

  const onDragMove = (e) => {
    if (startX === undefined || startY === undefined) return;
    const currentX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const currentY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;

    if (Math.abs(currentX - startX) > 10 || Math.abs(currentY - startY) > 10) {
      isDragging = true;
      if (e.cancelable) e.preventDefault(); 
      let newX = currentX - 28, newY = currentY - 28;
      newX = Math.max(10, Math.min(newX, window.innerWidth - 66));
      newY = Math.max(10, Math.min(newY, window.innerHeight - 66));
      fabContainer.style.left = newX + 'px';
      fabContainer.style.top = newY + 'px';
      if(isFabOpen) toggleFabMenu(); 
    }
  };

  const onDragEnd = (e) => {
    // FIX GHOST CLICK MOBILE: Tangkap sentuhan layar dan batalkan event duplikat bawaan browser
    if (!isDragging && startX !== undefined && e.target.closest('#fab-master')) {
       if (e.cancelable) e.preventDefault(); 
       toggleFabMenu(); 
    }
    isDragging = false; startX = undefined; startY = undefined;
  };

  fabMaster.addEventListener('mousedown', onDragStart);
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
  
  // Penambahan {passive: false} untuk menjamin preventDefault bekerja di Mobile Chrome
  fabMaster.addEventListener('touchstart', onDragStart, {passive: false});
  window.addEventListener('touchmove', onDragMove, {passive: false});
  window.addEventListener('touchend', onDragEnd, {passive: false});
}

function toggleFabMenu() {
  if (fabMenusList.length === 0 && currentUser) setupDashboard(); // Safety check

  isFabOpen = !isFabOpen;
  const menuList = document.getElementById('fab-menu-list');
  const fabIcon = document.getElementById('fab-master-icon');
  const container = document.getElementById('fab-container');
  const rect = container.getBoundingClientRect();

  if(isFabOpen) {
      fabIcon.style.transform = 'rotate(90deg)';
      menuList.style.display = 'flex';

      const isTopHalf = rect.top < (window.innerHeight / 2);
      if(isTopHalf) {
          menuList.style.top = '70px'; menuList.style.bottom = 'auto'; menuList.style.flexDirection = 'column'; 
      } else {
          menuList.style.top = 'auto'; menuList.style.bottom = '70px'; menuList.style.flexDirection = 'column-reverse'; 
      }

      const isLeftHalf = rect.left < (window.innerWidth / 2);
      if(isLeftHalf) {
          menuList.style.left = '0px'; menuList.style.right = 'auto'; menuList.style.alignItems = 'flex-start';
          renderFabMenuItems('left'); 
      } else {
          menuList.style.left = 'auto'; menuList.style.right = '0px'; menuList.style.alignItems = 'flex-end';
          renderFabMenuItems('right'); 
      }

      setTimeout(() => {
          document.querySelectorAll('.fab-child-menu').forEach((el, idx) => {
              setTimeout(() => el.classList.add('show'), idx * 40); // Muncul cepat dan mulus
          });
      }, 10);
  } else {
      fabIcon.style.transform = 'rotate(0deg)';
      document.querySelectorAll('.fab-child-menu').forEach(el => el.classList.remove('show'));
      setTimeout(() => { menuList.style.display = 'none'; }, 300); 
  }
}

function renderFabMenuItems(align = 'left') {
  const menuList = document.getElementById('fab-menu-list');
  menuList.innerHTML = '';
  
  fabMenusList.forEach((m) => {
      const btn = document.createElement('div');
      btn.className = `fab-child-menu flex items-center gap-3 cursor-pointer hover:scale-110 transition-transform ${align === 'right' ? 'flex-row-reverse' : 'flex-row'}`;
      
      // FIX KLIK MENU: Cegah klik ganda merambat ke bawah
      btn.onclick = (e) => { 
        e.stopPropagation(); 
        changeMenu(m.id, m.text); 
        toggleFabMenu(); 
      };

      let colorClass = m.id === 'logout' ? 'bg-red-600' : 'bg-slate-800';
      const iconDiv = `<div class="w-11 h-11 rounded-full ${colorClass} border border-white/30 flex items-center justify-center shadow-lg text-white shrink-0"><i class="fa-solid ${m.icon}"></i></div>`;
      const textDiv = `<span class="text-stroke-hitam font-extrabold whitespace-nowrap text-[15px] sm:text-[16px] uppercase tracking-wider drop-shadow-xl">${m.text}</span>`;

      btn.innerHTML = align === 'right' ? textDiv + iconDiv : iconDiv + textDiv;
      menuList.appendChild(btn);
  });
}

// =====================================
// 3. AUTH & LOGIN SYSTEM
// =====================================
async function checkAuth() {
  const loginView = document.getElementById('view-login'), dashboardView = document.getElementById('view-dashboard');
  if (currentUser) { 
      loginView.classList.add('hidden'); 
      dashboardView.classList.remove('hidden'); 
      await setupDashboard(); 
  } else { 
      dashboardView.classList.add('hidden'); 
      loginView.classList.remove('hidden'); 
  }
}

async function handleLoginSubmit() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const btn = document.getElementById('btn-login');
  const pTahun = document.getElementById('login-tahun');
  const pSmt = document.getElementById('login-semester');
  if (pTahun || pSmt) simpanPreferensiSesi(pTahun?.value || '', pSmt?.value || '');
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Memproses...`;

  try {
    const res = await apiCall('login', { username, password });
    if (res.status === 'success') {
      // Backend mengembalikan { token, role, user:<objek penuh> }.
      // App.js memakai currentUser.role & currentUser.user, jadi dibungkus bertingkat.
      const sessionUser = { role: res.role, user: res.user };
      setSession(res.token, sessionUser);
      const nama = (res.user && (res.user['Nama Guru'] || res.user['Nama Lengkap'])) || 'Anda';
      showToast('success', `Selamat datang, ${nama}!`);
      // LANGSUNG boot aplikasi (tanpa reload). Lebih andal: tidak bergantung pada
      // cache/reload browser, sesi tetap tersimpan di localStorage.
      setTimeout(() => { initApp(sessionUser); }, 500);
    } else {
      showToast('error', res.message || 'Login gagal');
    }
  } catch (err) {
    console.error(err);
    showToast('error', 'Gagal terhubung ke server');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>Masuk</span> <i class="fa-solid fa-arrow-right"></i>`;
  }
}


// Listener di FORM (karena tombol type="submit"):
const form = document.getElementById('form-login');
if (form) {
  form.addEventListener('submit', function(e) {
    e.preventDefault();      // ← WAJIB: cegah reload halaman
    handleLoginSubmit();
  });
}

// Listener tombol login Google (tanpa inline onclick agar tidak tergantung
// ketersediaan global saat klik — fungsi tetap diekspor global sebagai fallback).
const btnGoogle = document.getElementById('btn-login-google');
if (btnGoogle) {
  btnGoogle.addEventListener('click', function() { loginDenganOAuth('google'); });
}

/** Login OAuth via Google — pengguna diarahkan ke provider lalu kembali ke halaman ini.
 *  Diekspor global juga sebagai fallback bila tombol dipicu secara inline. */
async function loginDenganOAuth(provider) {
  try {
    const { error } = await supaClient.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.href }
    });
    if (error) showToast('error', error.message);
  } catch (e) {
    console.error('loginDenganOAuth:', e);
    showToast('error', 'Gagal memulai login ' + provider);
  }
}
window.loginDenganOAuth = loginDenganOAuth;

/** Lupa password: akun Supabase Auth kirim email reset; murid lokal diarahkan ke admin. */
async function lupaPassword() {
  const res = await Swal.fire({
    title: 'Lupa Password?',
    input: 'email',
    inputLabel: 'Masukkan email akun Anda',
    inputPlaceholder: 'nama@email.com',
    showCancelButton: true,
    confirmButtonText: 'Kirim Link Reset',
    cancelButtonText: 'Batal',
    background: '#1e293b', color: '#fff'
  });
  if (!res.isConfirmed || !res.value) return;
  const email = String(res.value).trim();
  try {
    const { data: ak, error: akErr } = await supaClient
      .from('akun')
      .select('tipe, user_id')
      .eq('email', email)
      .limit(1);
    if (akErr) throw akErr;
    if (ak && ak[0] && ak[0].tipe === 'murid' && !ak[0].user_id) {
      Swal.fire({ icon: 'info', title: 'Akun Murid Lokal', text: 'Password akun murid direset oleh admin melalui menu Manajemen Murid. Silakan hubungi admin sekolah.', background: '#1e293b', color: '#fff' });
      return;
    }
    const { error } = await supaClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname
    });
    if (error) throw error;
    Swal.fire({ icon: 'success', title: 'Email Terkirim', text: 'Jika email terdaftar, tautan reset password telah dikirim. Periksa folder Inbox/Spam.', background: '#1e293b', color: '#fff' });
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Gagal', text: e.message || 'Gagal mengirim email reset.', background: '#1e293b', color: '#fff' });
  }
}
window.lupaPassword = lupaPassword;

/** Deteksi kembalian link reset password (type=recovery) → minta password baru. */
async function cekRecoveryPassword() {
  const h = (window.location.hash || '') + (window.location.search || '');
  if (!h.includes('type=recovery')) return;
  try {
    const { data: sesi } = await supaClient.auth.getSession();
    if (!sesi || !sesi.session) return;
    const res = await Swal.fire({
      title: 'Atur Password Baru',
      input: 'password',
      inputLabel: 'Password baru (min. 6 karakter)',
      showCancelButton: true,
      confirmButtonText: 'Simpan Password',
      cancelButtonText: 'Nanti',
      background: '#1e293b', color: '#fff'
    });
    if (res.isConfirmed && res.value && res.value.length >= 6) {
      const { error } = await supaClient.auth.updateUser({ password: res.value });
      if (error) throw error;
      showToast('success', 'Password berhasil diperbarui');
    } else if (res.isConfirmed) {
      showToast('error', 'Password minimal 6 karakter.');
    }
  } catch (e) {
    showToast('error', e.message || 'Gagal memperbarui password');
  } finally {
    history.replaceState(null, '', window.location.pathname);
  }
}

/** Modal konfigurasi server (SUPABASE_URL & ANON_KEY) dari kartu login. */
async function bukaPengaturanServer() {
  const cfg = (typeof ambilKonfigurasiServer === 'function') ? ambilKonfigurasiServer() : { url: '', key: '' };
  const res = await Swal.fire({
    title: 'Konfigurasi Server',
    html: `
      <div class="text-left text-[11px] text-slate-300 mt-2">
        <label class="font-bold text-blue-300">SUPABASE_URL</label>
        <input id="sv_url" value="${escJs(cfg.url)}" placeholder="https://xxxxx.supabase.co" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 mb-3 text-white outline-none focus:border-blue-500">
        <label class="font-bold text-blue-300">SUPABASE_ANON_KEY</label>
        <input id="sv_key" value="${escJs(cfg.key)}" placeholder="sb_publishable_... / anon key" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500">
        <p class="text-[9px] text-slate-400 mt-2">Tersimpan hanya di browser ini. Anon key bersifat publik (publishable).</p>
      </div>`,
    showCancelButton: true,
    showDenyButton: true,
    confirmButtonText: 'Uji & Simpan',
    denyButtonText: 'Kembalikan Default',
    cancelButtonText: 'Batal',
    background: '#1e293b', color: '#fff',
    preConfirm: () => ({
      url: (document.getElementById('sv_url')?.value || '').trim().replace(/\/+$/, ''),
      key: (document.getElementById('sv_key')?.value || '').trim()
    })
  });
  if (res.isDenied) {
    hapusKonfigurasiServer();
    clearSession();
    location.reload();
    return;
  }
  if (!res.isConfirmed) return;
  const { url, key } = res.value || {};
  if (!url || !key) { showToast('error', 'URL dan Anon Key wajib diisi.'); return; }
  try { new URL(url); } catch (e) { showToast('error', 'Format URL tidak valid.'); return; }
  let ok = false;
  try {
    const r = await fetch(url + '/auth/v1/health', { headers: { apikey: key } });
    ok = r.ok;
  } catch (e) { ok = false; }
  if (!ok) {
    const lanjut = await Swal.fire({
      icon: 'warning',
      title: 'Uji koneksi gagal',
      text: 'Server tidak merespons health check. Tetap simpan konfigurasi ini?',
      showCancelButton: true,
      confirmButtonText: 'Tetap Simpan',
      cancelButtonText: 'Batal',
      background: '#1e293b', color: '#fff'
    });
    if (!lanjut.isConfirmed) return;
  }
  simpanKonfigurasiServer(url, key);
  clearSession();
  location.reload();
}
window.bukaPengaturanServer = bukaPengaturanServer;

function logout() {
  try { supaClient.auth.signOut(); } catch (e) { console.warn('signOut:', e); }
  clearSession();
  location.reload();
}


function startRealtimeClock() {
  if (clockInterval) clearInterval(clockInterval);
  clockInterval = setInterval(() => { 
      const now = new Date(); 
      const timeStr = now.toLocaleTimeString('id-ID', { hour12: false }); 
      const dateStr = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
      
      const clockEl = document.getElementById('realtime-clock');
      const dateEl = document.getElementById('realtime-date');
      const hClockEl = document.getElementById('header-realtime-clock');
      const hDateEl = document.getElementById('header-realtime-date');
      
      if(clockEl) clockEl.innerText = timeStr; 
      if(dateEl) dateEl.innerText = dateStr;
      if(hClockEl) hClockEl.innerText = timeStr; 
      if(hDateEl) hDateEl.innerText = dateStr;
  }, 1000); 
}

// ==========================================
// 4. MODUL ABSENSI (HADIR TATAP MUKA)
// ==========================================


async function submitAbsenMandiri() {
  const mapelRaw = document.getElementById('murid-mapel').value.split('|');
  const captcha = document.getElementById('murid-captcha').value.trim();
  const btn = document.getElementById('btn-absen-mandiri');
  if(!captcha) return Swal.fire({toast: true, position: 'top-end', icon: 'warning', title: 'Captcha kosong!', showConfirmButton: false, timer: 2000});
  
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Mendapatkan Lokasi GPS...`; btn.disabled = true;
  
  // Meminta Izin dan Kordinat Lokasi HP/Laptop
  const gpsLokasi = await getDeviceGPS(); 

  try {
    const smtMandiri = ['Juli','Agustus','September','Oktober','November','Desember'].includes(currentBulan) ? 'Ganjil' : 'Genap';
    const res = await apiCall('absen_mandiri', { tahun: currentTahun, semester: smtMandiri, bulan: currentBulan, tanggal: new Date().getDate(), kelas: currentUser.user["Tingkat/Kelas"], jenis: mapelRaw[0], mapel: mapelRaw[1], nis: currentUser.user["NIS"], nama: currentUser.user["Nama Lengkap"], captcha: captcha, gps: gpsLokasi });
    
    if(res.status === 'success') {
      Swal.fire({ icon: 'success', title: 'Berhasil Absen!', html: `Kehadiran tercatat.<br><span class="text-xs text-slate-400">Lokasi: ${gpsLokasi}</span>`, background: '#1e293b', color: '#fff' });
      document.getElementById('murid-captcha').value = '';
    } else Swal.fire({ icon: 'error', title: 'Ditolak', text: res.message || 'Absen ditolak.', background: '#1e293b', color: '#fff' });
  } catch (e) { Swal.fire({ icon: 'error', title: 'Error Jaringan', text: e.message, background: '#1e293b', color: '#fff' }); }
  finally { btn.innerHTML = `<i class="fa-solid fa-check-circle"></i> Saya Hadir Hari Ini`; btn.disabled = false; }
}

// ==========================================
// 5. MODUL ABSENSI UTAMA (TABEL & PARALLAX)
// ==========================================
let currentTahun = "2026/2027"; 
let namaKepsekGlobal = "_____________________";

async function renderAbsensiModule(container) {
  const role = currentUser.role, user = currentUser.user || {};
  const isPengurusKelas = role === 'murid' && user["Jabatan Kelas"]?.match(/Ketua Murid|Sekretaris Kelas/i);
  const isPengurusEkskul = role === 'murid' && user["Jabatan Kelas"]?.match(/Ketua Ekstra|Sekretaris Ekstra/i);
  const isLaporanSaya = role === 'murid' && !isPengurusKelas && !isPengurusEkskul;
  
  container.innerHTML = `<div class="p-6 text-center text-slate-300"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>Menyiapkan Data...</div>`;

  if (masterDataCache.length === 0) {
    try {
        const { data, error } = await supaClient.from('master_data').select('*');
        if (!error && data) masterDataCache = data;
    } catch (e) {
        console.error("Gagal memuat master data", e);
    }
}

  let listTahun = [...new Set(masterDataCache.map(m => m["Tahun Pelajaran"]).filter(Boolean))];
  if (listTahun.length > 0 && !listTahun.includes(currentTahun)) currentTahun = listTahun[0];
  let listKelas = urutAz([...new Set(masterDataCache.map(m => m["Tingkat/Kelas"]).filter(Boolean))]);
  let listMapel = urutAz([...new Set(masterDataCache.map(m => m["Mata Pelajaran"]).filter(Boolean))]);
  let listEkskul = urutAz([...new Set(masterDataCache.map(m => m["Ekstrakurikuler"]).filter(Boolean))]);

  if(role === 'murid') { 
    listKelas = [user["Tingkat/Kelas"]]; 
    if(!isPengurusEkskul) listEkskul = []; 
    if(isPengurusEkskul && !isPengurusKelas) { listEkskul = urutAz((user["Ekstrakurikuler"] || "").split(',').map(e=>e.trim()).filter(Boolean)); listMapel = []; }
  }

  // Pemetaan akses mapel: guru → diampu paling atas (bisa menulis), lainnya baca saja; admin → semua
  const listMapelDiampu = role === 'guru'
    ? urutAz((user["Custom Teks Mata Pelajaran"] || "").split(',').map(m => m.trim()).filter(Boolean))
    : [];
  const listMapelLain = listMapel.filter(m => !listMapelDiampu.includes(m));

  const headerTitle = isLaporanSaya ? `<i class="fa-solid fa-user-graduate"></i> LAPORAN SAYA` : `<i class="fa-solid fa-book-open-reader"></i> REKAPITULASI`;

  // [PERBAIKAN REQ 3]: Penambahan class bg-slate-800 text-white di semua <option>
  container.innerHTML = `
    <!-- FILTER BAR ABSENSI -->
    <div class="sticky top-0 z-40 p-2 rounded-b-2xl shadow-lg border-b border-white/10 bg-slate-800/90 w-full backdrop-blur-md flex flex-col gap-2">
      <div class="flex items-center justify-between gap-1 w-full">
        <div class="flex gap-1 sm:gap-2 flex-wrap items-center">

          <div class="relative w-7 h-7 sm:w-8 sm:h-8 group" title="Pilih Tahun">
             <div class="w-full h-full rounded-full bg-slate-700/50 border border-white/10 flex items-center justify-center text-blue-400 group-hover:bg-blue-500 group-hover:text-white transition shadow-sm"><i class="fa-regular fa-calendar text-[10px] sm:text-xs"></i></div>
             <select id="select-tahun" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange="loadDataMuridDanAbsen()">
               ${listTahun.map(t => `<option value="${t}" class="bg-slate-800 text-white" ${t === currentTahun ? 'selected' : ''}>${t}</option>`).join('')}
             </select>
          </div>
          <div class="relative w-7 h-7 sm:w-8 sm:h-8 group" title="Pilih Bulan">
             <div class="w-full h-full rounded-full bg-slate-700/50 border border-white/10 flex items-center justify-center text-green-400 group-hover:bg-green-500 group-hover:text-white transition shadow-sm"><i class="fa-regular fa-calendar-check text-[10px] sm:text-xs"></i></div>
             <select id="select-bulan" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange="loadDataMuridDanAbsen()">
               ${arrBulan.map(b => `<option value="${b}" class="bg-slate-800 text-white" ${b === currentBulan ? 'selected' : ''}>${b}</option>`).join('')}
             </select>
          </div>
          <div class="relative w-7 h-7 sm:w-8 sm:h-8 group" title="Mode Tampilan">
             <div class="w-full h-full rounded-full bg-slate-700/50 border border-white/10 flex items-center justify-center text-purple-400 group-hover:bg-purple-500 group-hover:text-white transition shadow-sm"><i class="fa-solid fa-eye text-[10px] sm:text-xs"></i></div>
             <select id="filter-view-mode" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange="refreshTableAbsenUI()">
               <option value="today" class="bg-slate-800 text-white" selected>Hari Ini</option>
               <option value="all" class="bg-slate-800 text-white">Semua Tgl</option>
             </select>
          </div>
          <div class="relative w-7 h-7 sm:w-8 sm:h-8 group" title="Pilih Mapel / Ekskul">
             <div class="w-full h-full rounded-full bg-slate-700/50 border border-white/10 flex items-center justify-center text-yellow-400 group-hover:bg-yellow-500 group-hover:text-white transition shadow-sm"><i class="fa-solid fa-book text-[10px] sm:text-xs"></i></div>
             <span id="ikon-akses-mapel" class="hidden absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] bg-slate-900 border border-white/30 z-30" title="Akses mapel">✏️</span>
             <select id="select-mapel" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange="handleMapelChange()" onfocus="tampilIkonAkses()" onblur="sembunyikanIkonAkses()">
               ${opsiMapelAbsenHTML(listMapelLain, listMapelDiampu, role)}
               ${listEkskul.length > 0 ? `<optgroup label="Ekstrakurikuler" class="bg-slate-700 text-yellow-300 font-bold">${listEkskul.map(e => `<option value="Ekskul|${e}" class="bg-slate-800 text-white">${e}</option>`).join('')}</optgroup>` : ''}
             </select>
          </div>
          <div class="relative w-7 h-7 sm:w-8 sm:h-8 group" title="Pilih Kelas">
             <div class="w-full h-full rounded-full bg-slate-700/50 border border-white/10 flex items-center justify-center text-pink-400 group-hover:bg-pink-500 group-hover:text-white transition shadow-sm"><i class="fa-solid fa-users text-[10px] sm:text-xs"></i></div>
             <select id="select-kelas" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange="loadDataMuridDanAbsen()">
               <option value="Semua Kelas" id="opt-semua-kelas" class="bg-slate-800 text-white">-- Semua --</option>
               ${listKelas.map(k => `<option value="${k}" class="bg-slate-800 text-white">${k}</option>`).join('')}
             </select>
          </div>
        </div>
        
    <div class="flex gap-1 items-center flex-wrap justify-end">
          <button id="btn-undo-absen" onclick="undoAbsen()" class="w-6 h-6 sm:w-7 sm:h-7 bg-slate-700 hover:bg-slate-600 text-slate-400 rounded transition disabled:opacity-30" disabled title="Undo"><i class="fa-solid fa-rotate-left text-[9px]"></i></button>
          <button id="btn-redo-absen" onclick="redoAbsen()" class="w-6 h-6 sm:w-7 sm:h-7 bg-slate-700 hover:bg-slate-600 text-slate-400 rounded transition disabled:opacity-30" disabled title="Redo"><i class="fa-solid fa-rotate-right text-[9px]"></i></button>
          <span class="text-slate-600 px-0.5">|</span>
          <button onclick="showInfoKelasAbsen()" class="bg-blue-600 hover:bg-blue-700 text-white text-[9px] sm:text-[10px] px-1.5 py-1.5 rounded transition" title="Info Kelas & Pengurus"><i class="fa-solid fa-info-circle"></i></button>
          <button onclick="shareKehadiranWA()" class="bg-green-600 hover:bg-green-700 text-white text-[9px] sm:text-[10px] px-1.5 py-1.5 rounded transition shadow-sm" title="Broadcast WhatsApp Kehadiran"><i class="fa-brands fa-whatsapp"></i></button>
          <span class="text-slate-600 px-0.5">|</span>
          <button onclick="loadDataAbsensi()" class="bg-slate-600 hover:bg-slate-500 text-white text-[9px] sm:text-[10px] px-1.5 py-1.5 rounded transition" title="Refresh Data"><i class="fa-solid fa-rotate-right"></i></button>
          <button onclick="openImportExcelAbsen()" class="bg-teal-700 hover:bg-teal-600 text-white text-[9px] sm:text-[10px] px-1.5 py-1.5 rounded transition shadow-sm" title="Import Data Excel"><i class="fa-solid fa-file-import"></i></button>
          <button onclick="exportAbsensiExcel()" class="bg-green-700 hover:bg-green-600 text-white text-[9px] sm:text-[10px] px-1.5 py-1.5 rounded transition" title="Export ke Excel"><i class="fa-solid fa-file-excel"></i></button>
          <button onclick="exportAbsensiPDF()" class="bg-red-700 hover:bg-red-600 text-white text-[9px] sm:text-[10px] px-1.5 py-1.5 rounded transition" title="Cetak Laporan PDF"><i class="fa-solid fa-file-pdf"></i></button>
          <button onclick="forceSyncSemuaAbsensi()" class="bg-yellow-600 hover:bg-yellow-500 text-white text-[9px] sm:text-[10px] px-2 py-1.5 rounded flex items-center gap-1 font-bold transition shadow-md" title="Simpan Semua"><i class="fa-solid fa-cloud-arrow-up"></i> <span class="hidden sm:inline">Simpan</span></button>
        </div>
    </div>
    </div>
    <div>
    <!-- LAYER 2: Judul -->
    <div class="text-center mb-4 mt-4 px-2 relative z-0">
      <h3 class="text-sm sm:text-base font-extrabold text-white tracking-wider drop-shadow-md" id="lbl-judul-utama">${headerTitle}</h3>
      <p class="text-[9px] sm:text-[10px] mt-1.5 flex flex-wrap justify-center gap-1.5 bg-slate-900/60 py-1 px-3 rounded-full inline-flex border border-white/20 shadow-inner" id="lbl-info-mapel"></p>
    </div>

    <!-- LAYER 3: Tabel Parallax -->
    <div class="relative z-50 bg-[#0f172a] rounded-t-2xl border-t border-blue-500/30 shadow-[0_-15px_30px_rgba(0,0,0,0.9)] overflow-hidden w-full transition-all mt-2" style="min-height: 90vh;">
      <div class="w-full overflow-x-auto overflow-y-auto custom-scrollbar" style="max-height: 85vh; -webkit-overflow-scrolling: touch; padding-bottom: 50px;">
        <table id="tabel-absensi" class="text-left" style="table-layout: fixed; border-spacing: 0; border-collapse: separate;"></table>
      </div>
    </div>
  `;
  pasangPerekamUndoAbsen();
  handleMapelChange();
}

function handleMapelChange() {
  const mapelRaw = document.getElementById('select-mapel').value, isEkskul = mapelRaw.startsWith('Ekskul');
  const selKelas = document.getElementById('select-kelas'), optSemua = document.getElementById('opt-semua-kelas');
  if (isEkskul) { optSemua.classList.remove('hidden'); selKelas.value = "Semua Kelas"; document.getElementById('lbl-judul-utama').innerText = `Daftar Hadir Ekstrakurikuler`; } 
  else { optSemua.classList.add('hidden'); if (selKelas.value === "Semua Kelas") selKelas.selectedIndex = 1; document.getElementById('lbl-judul-utama').innerText = `Laporan Hadir Tatap Muka`; }
  perbaruiIkonAkses();
  loadDataMuridDanAbsen();
}

/** Opsi dropdown mapel: diampu guru di atas, lainnya di bawah. */
function opsiMapelAbsenHTML(lain, diampu) {
  const opt = (arr) => arr.map(m => `<option value="Mapel|${escJs(m)}" class="bg-slate-800 text-white">${escapeHtml(m)}</option>`).join('');
  if (!diampu || diampu.length === 0) return lain.length > 0 ? `<optgroup label="Mata Pelajaran" class="bg-slate-700 text-blue-300 font-bold">${opt(lain)}</optgroup>` : '';
  let html = `<optgroup label="Mapel Diampu (Bisa Edit)" class="bg-slate-700 text-green-300 font-bold">${opt(diampu)}</optgroup>`;
  if (lain.length > 0) html += `<optgroup label="Mapel Lainnya (Baca Saja)" class="bg-slate-700 text-slate-400 font-bold">${opt(lain)}</optgroup>`;
  return html;
}

/** Mode akses mapel terpilih: 'keduanya' (admin) | 'menulis' | 'baca'. */
function modeAksesMapel() {
  const role = currentUser ? currentUser.role : '';
  if (role === 'admin') return 'keduanya';
  const mapelRaw = (document.getElementById('select-mapel') || {}).value || '';
  const mapel = mapelRaw.includes('|') ? mapelRaw.split('|')[1] : mapelRaw;
  if (!mapel) return 'menulis';
  const own = (((currentUser || {}).user || {})["Custom Teks Mata Pelajaran"] || "").split(',').map(m => m.trim()).filter(Boolean);
  return own.includes(mapel) ? 'menulis' : 'baca';
}

/** Perbarui ikon badge akses + keterangan di bar info (hanya bila badge sedang tampil). */
function perbaruiIkonAkses() {
  const el = document.getElementById('ikon-akses-mapel');
  if (!el || el.classList.contains('hidden')) return;
  const mode = modeAksesMapel();
  const meta = mode === 'keduanya'
    ? { t: '🛠', j: 'Keduanya: semua mapel dapat diedit (admin)', l: '<span class="text-amber-300 font-bold"><i class="fa-solid fa-pen-ruler"></i> Keduanya (Admin)</span>' }
    : mode === 'menulis'
      ? { t: '✏️', j: 'Dapat Menulis: mapel diampu Anda', l: '<span class="text-green-300 font-bold"><i class="fa-solid fa-pen"></i> Dapat Menulis</span>' }
      : { t: '👁', j: 'Hanya Baca: mapel bukan diampu Anda', l: '<span class="text-slate-400 font-bold"><i class="fa-solid fa-eye"></i> Hanya Baca</span>' };
  el.textContent = meta.t;
  el.title = meta.j;
  const info = document.getElementById('lbl-info-mapel');
  if (info && !info.querySelector('.lbl-akses-wrap')) {
    info.insertAdjacentHTML('beforeend', `<span class="lbl-akses-wrap"><span class="text-slate-600 hidden sm:inline">|</span><span class="lbl-akses-mapel">${meta.l}</span></span>`);
  }
}

/** Tampilkan badge akses saat select-mapel diklik/fokus. */
function tampilIkonAkses() {
  const el = document.getElementById('ikon-akses-mapel');
  if (el) el.classList.remove('hidden');
  perbaruiIkonAkses();
}

/** Sembunyikan badge + label akses saat fokus select-mapel hilang. */
function sembunyikanIkonAkses() {
  const el = document.getElementById('ikon-akses-mapel');
  if (el) el.classList.add('hidden');
  const wrap = document.querySelector('#lbl-info-mapel .lbl-akses-wrap');
  if (wrap) wrap.remove();
}

/** Gerbang simpan: tolak pada mode Hanya Baca. */
function bolehSimpanAbsen() {
  const mode = modeAksesMapel();
  if (mode !== 'baca') return true;
  showToast('error', 'Mode Hanya Baca: mapel ini bukan diampu Anda — penyimpanan ditolak.');
  return false;
}

function checkHakAkses(selectedMapelEkskul) {
  if (currentUser.role === 'admin') return true;
  const user = currentUser.user, arr = selectedMapelEkskul.split('|'), jenis = arr[0], nama = arr[1];
  if (jenis === 'Ekskul') return (user["Ekstrakurikuler"] || "").includes(nama);
  else return (user["Custom Teks Mata Pelajaran"] || "").includes(nama);
}

function isHoliday(tanggalNum, bulanStr, tahunStr) {
  if (!bulanStr || !tahunStr) return false;
  const idxBulan = arrBulan.indexOf(bulanStr);
  const partsTahun = tahunStr.split('/');
  let yearCalc = new Date().getFullYear();
  if (partsTahun.length === 2) { yearCalc = idxBulan >= 6 ? parseInt(partsTahun[0]) : parseInt(partsTahun[1]); }
  const dayOfWeek = new Date(yearCalc, idxBulan, tanggalNum).getDay();
  if (liburConfigCache.minggu && dayOfWeek === 0) return true;
  if (liburConfigCache.sabtu && dayOfWeek === 6) return true;
  const tglFormatted = `${yearCalc}-${String(idxBulan + 1).padStart(2, '0')}-${String(tanggalNum).padStart(2, '0')}`;
  if (liburConfigCache.customList.find(l => l.tanggal === tglFormatted)) return true;
  return false;
}

/**
 * HITUNG HARI EFEKTIF DINAMIS (pengganti pembagi hard-coded /21)
 * Jumlah hari sekolah bulan tertentu: bukan Minggu/Sabtu (sesuai konfigurasi)
 * dan tidak masuk daftar libur custom server ("Jadwal Hari Libur").
 * Bulan berjalan dihitung sampai tanggal hari ini (persentase berjalan);
 * bulan lainnya dihitung penuh. Memakai isHoliday() agar satu sumber kebenaran.
 */
function hitungHariEfektif(bulanStr = currentBulan, tahunStr = currentTahun) {
  if (!bulanStr || !tahunStr || arrBulan.indexOf(bulanStr) < 0) return 0;
  const idxBulan = arrBulan.indexOf(bulanStr);
  const partsTahun = String(tahunStr).split('/');
  let yearCalc = new Date().getFullYear();
  if (partsTahun.length === 2) { yearCalc = idxBulan >= 6 ? parseInt(partsTahun[0]) : parseInt(partsTahun[1]); }

  const now = new Date();
  const hariDalamBulan = new Date(yearCalc, idxBulan + 1, 0).getDate();
  const batasTgl = (idxBulan === now.getMonth() && yearCalc === now.getFullYear())
    ? Math.min(now.getDate(), hariDalamBulan)
    : hariDalamBulan;

  let efektif = 0;
  for (let d = 1; d <= batasTgl; d++) {
    if (!isHoliday(d, bulanStr, tahunStr)) efektif++;
  }
  return efektif;
}

function refreshTableAbsenUI() {
  const isEkskul = document.getElementById('select-mapel').value.startsWith('Ekskul');
  const viewMode = document.getElementById('filter-view-mode').value;
  let datesToRender = viewMode === 'today' ? [new Date().getDate()] : Array.from({length: 31}, (_, i) => i + 1);

  const idxBulan = arrBulan.indexOf(currentBulan);
  const partsTahun = currentTahun.split('/');
  let yearCalc = new Date().getFullYear();
  if(partsTahun.length === 2) yearCalc = idxBulan >= 6 ? parseInt(partsTahun[0]) : parseInt(partsTahun[1]);

  // FIX HARD-CODED /21: pembagi % kini hari efektif dinamis (Sabtu/Minggu/libur server)
  const hariEfektifBulan = hitungHariEfektif(currentBulan, currentTahun);
  const pembagiPersen = hariEfektifBulan > 0 ? hariEfektifBulan : 1;

  const hariArr = ["Mg", "Sn", "Sl", "Rb", "Km", "Jm", "Sb"];
  const getHari = (d) => hariArr[new Date(yearCalc, idxBulan, d).getDay()];
  const isRealToday = (d) => (d === new Date().getDate() && idxBulan === new Date().getMonth() && yearCalc === new Date().getFullYear());

  const w_no = 36, w_nama = wNamaAbsen, w_kelas = 55, w_tgl = 38, w_icon = 32, w_hsia = 28, w_pct = 36, w_ket = 45; 
  let widthNamaCol = showNamaSiswa ? w_nama : 0;
  let widthKelasCol = (showNamaSiswa && isEkskul) ? w_kelas : 0;
  
  let totalLebarTabel = w_no + widthNamaCol + widthKelasCol + (datesToRender.length * w_tgl) + w_icon;
  if (rekapModeState >= 1) totalLebarTabel += (w_hsia * 5);
  if (rekapModeState >= 2) totalLebarTabel += w_pct;
  if (rekapModeState >= 3) totalLebarTabel += w_ket;

  const leftNo = 0, leftNama = w_no, leftKelas = w_no + w_nama;
  const sKiri = (w, left) => `position: sticky; left: ${left}px; z-index: 20; width: ${w}px; min-width: ${w}px; max-width: ${w}px; background-color: #0f172a;`;
  
  let rightOffsets = { icon: 0, h: 0, s: 0, i: 0, a: 0, d: 0, pct: 0, ket: 0 };
  if (rekapModeState >= 1) { rightOffsets.d = w_icon; rightOffsets.a = w_icon + w_hsia; rightOffsets.i = w_icon + w_hsia * 2; rightOffsets.s = w_icon + w_hsia * 3; rightOffsets.h = w_icon + w_hsia * 4; }
  else if (rekapModeState >= 2) { rightOffsets.pct = w_icon; rightOffsets.d = w_icon + w_pct; rightOffsets.a = w_icon + w_pct + w_hsia; rightOffsets.i = w_icon + w_pct + w_hsia * 2; rightOffsets.s = w_icon + w_pct + w_hsia * 3; rightOffsets.h = w_icon + w_pct + w_hsia * 4; }
  else if (rekapModeState >= 3) { rightOffsets.ket = w_icon; rightOffsets.pct = w_icon + w_ket; rightOffsets.d = w_icon + w_ket + w_pct; rightOffsets.a = w_icon + w_ket + w_pct + w_hsia; rightOffsets.i = w_icon + w_ket + w_pct + w_hsia * 2; rightOffsets.s = w_icon + w_ket + w_pct + w_hsia * 3; rightOffsets.h = w_icon + w_ket + w_pct + w_hsia * 4; }
  
  const sKanan = (w, right) => `position: sticky; right: ${right}px; z-index: 20; width: ${w}px; min-width: ${w}px; max-width: ${w}px; background-color: #0f172a; border-bottom: 1px solid rgba(255,255,255,0.1);`;

  let tbodyHTML = listMuridKelas.map(m => {
    const ketAda = rawAbsenData.find(a => a.NIS == m.nis && (a["Keterangan ketidakhadiran"] || a.Keterangan || "").trim() !== "");
    const colorBtnKet = ketAda ? 'text-blue-400 bg-blue-500/20' : 'text-slate-500 bg-white/5';

    return `
      <tr class="hover:bg-white/5 transition group text-[11px] border-b border-white/5">
        <td style="${sKiri(w_no, leftNo)}" class="px-1 py-1.5 text-center border-r border-white/10 text-blue-400 font-bold cursor-pointer" onclick="toggleNamaSiswa()">${m.no}</td>
        ${showNamaSiswa ? `<td style="${sKiri(w_nama, leftNama)}" class="td-nama-absen px-2 py-1.5 border-r border-white/10 truncate">${m.nama}</td>` : ''}
        ${showNamaSiswa && isEkskul ? `<td style="${sKiri(w_kelas, leftKelas)}" class="px-1 py-1.5 border-r border-white/10 text-center text-[9px] text-yellow-400 truncate">${m.kelasAsli}</td>` : ''}
        
        ${datesToRender.map(d => {
          const dataDb = rawAbsenData.find(a => hariDariTanggal(a.Tanggal) === parseInt(d) && a.NIS == m.nis);
          const st = dataDb ? dataDb.Status : "-";
          let color = "bg-white/5 text-slate-400";
          if(st==='H') color="bg-green-500 text-white"; else if(st==='S') color="bg-blue-500 text-white"; else if(st==='I') color="bg-yellow-500 text-white"; else if(st==='A') color="bg-red-500 text-white"; else if(st==='D') color="bg-purple-500 text-white";
          
          let isLibur = isHoliday(d, currentBulan, currentTahun);
          let tdClass = `px-0.5 py-1.5 border-r border-white/10 text-center cursor-pointer ${isLibur ? 'bg-red-500/10' : ''}`;
          if(isRealToday(d)) tdClass += ` bg-blue-900/40`;
          
          return `<td class="${tdClass}" onclick="openEditAbsenMasal(${d}, ${isLibur})" style="min-width:${w_tgl}px"><div class="w-5 h-5 rounded mx-auto flex items-center justify-center font-bold ${color}">${st}</div></td>`;
        }).join('')}
        
        ${rekapModeState >= 1 ? `<td style="${sKanan(w_hsia, rightOffsets.h)}" class="px-1 py-1.5 text-center font-bold text-green-400 border-l border-white/20">${m.totalH}</td><td style="${sKanan(w_hsia, rightOffsets.s)}" class="px-1 py-1.5 text-center font-bold text-blue-400">${m.totalS}</td><td style="${sKanan(w_hsia, rightOffsets.i)}" class="px-1 py-1.5 text-center font-bold text-yellow-400">${m.totalI}</td><td style="${sKanan(w_hsia, rightOffsets.a)}" class="px-1 py-1.5 text-center font-bold text-red-400">${m.totalA}</td><td style="${sKanan(w_hsia, rightOffsets.d)}" class="px-1 py-1.5 text-center font-bold text-purple-400 border-r border-white/20">${m.totalD}</td>` : ''}
        ${rekapModeState >= 2 ? `<td style="${sKanan(w_pct, rightOffsets.pct)}" class="px-1 py-1.5 text-center font-bold text-purple-400 border-r border-white/10">${Math.min(100, (((m.totalH + m.totalD)/pembagiPersen)*100)).toFixed(1)}%</td>` : ''}
        ${rekapModeState >= 3 ? `<td style="${sKanan(w_ket, rightOffsets.ket)}" class="px-1 py-1.5 text-center border-l border-white/20"><button onclick="openModalKeteranganSiswa('${m.nis}', '${m.nama.replace(/'/g, "\\'")}')" class="w-6 h-6 rounded hover:bg-blue-500 hover:text-white mx-auto flex items-center justify-center transition ${colorBtnKet}"><i class="fa-solid fa-list-check"></i></button></td>` : ''}
        <td style="${sKanan(w_icon, 0)}" class="text-center border-l border-white/10 cursor-pointer" onclick="cycleRekapMode()"></td>
      </tr>
    `;
  }).join('');

  const headTgl = datesToRender.map(d => {
    let isLibur = isHoliday(d, currentBulan, currentTahun);
    let thClass = isLibur ? 'text-red-400' : 'text-slate-300';
    if(isRealToday(d)) thClass = 'text-blue-300 bg-blue-800/50 rounded-t border-b-2 border-blue-400';
    return `<th style="min-width:${w_tgl}px; line-height: 1.1;" class="py-1 text-center ${thClass}"><div class="text-[11px] font-bold">${d}</div><div class="text-[8px] opacity-70">${getHari(d)}</div></th>`;
  }).join('');

  const tableEl = document.getElementById('tabel-absensi');
  tableEl.style.width = `${totalLebarTabel}px`; tableEl.style.minWidth = `${totalLebarTabel}px`; tableEl.style.maxWidth = `${totalLebarTabel}px`;
  
  tableEl.innerHTML = `
    <thead class="text-slate-300 sticky top-0 z-40 shadow-md">
      <tr>
        <th style="${sKiri(w_no, leftNo)}" class="text-[11px] cursor-pointer hover:bg-slate-700" onclick="toggleNamaSiswa()">No</th>
        ${showNamaSiswa ? `<th id="th-nama-absen" class="th-nama-siswa text-[11px] relative" style="${sKiri(w_nama, leftNama)}"><div class="truncate font-semibold" style="pointer-events: none;">Nama Siswa</div><div class="col-resizer absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-500/50 transition-colors"></div></th>` : ''}
        ${showNamaSiswa && isEkskul ? `<th style="${sKiri(w_kelas, leftKelas)}" class="text-[11px] text-center">Kls</th>` : ''}
        ${headTgl}
        ${rekapModeState >= 1 ? `<th style="${sKanan(w_hsia, rightOffsets.h)}" class="border-l border-white/20 text-[11px]">H</th><th style="${sKanan(w_hsia, rightOffsets.s)}" class="text-[11px]">S</th><th style="${sKanan(w_hsia, rightOffsets.i)}" class="text-[11px]">I</th><th style="${sKanan(w_hsia, rightOffsets.a)}" class="text-[11px]">A</th><th style="${sKanan(w_hsia, rightOffsets.d)}" class="border-r border-white/20 text-[11px]">D</th>` : ''}
        ${rekapModeState >= 2 ? `<th style="${sKanan(w_pct, rightOffsets.pct)}" class="border-r border-white/10 text-[11px]">％</th>` : ''}
        ${rekapModeState >= 3 ? `<th style="${sKanan(w_ket, rightOffsets.ket)}" class="text-[11px]">Ket</th>` : ''}
        <th style="${sKanan(w_icon, 0)}" class="text-[11px]" onclick="cycleRekapMode()">⚙️</th>
      </tr>
    </thead>
    <tbody class="text-slate-300">${tbodyHTML}</tbody>
  `;
  setTimeout(() => { terapkanKunciLiburAbsensi(); }, 500);
  updateUndoRedoAbsenUI();
  enableNamaSiswaResize();
}

async function loadDataMuridDanAbsen() {
  const elKelas = document.getElementById('select-kelas'), elMapel = document.getElementById('select-mapel'), elBulan = document.getElementById('select-bulan'), elTahun = document.getElementById('select-tahun');
  if(!elKelas || !elMapel || !elBulan || !elTahun) return;

  const kelas = elKelas.value, mapelRaw = elMapel.value;
  currentBulan = elBulan.value; currentTahun = elTahun.value;
  const isEkskul = mapelRaw.startsWith('Ekskul'), namaMapel = mapelRaw.split('|')[1];
  const smt = ['Juli','Agustus','September','Oktober','November','Desember'].includes(currentBulan) ? 'Ganjil' : 'Genap';
  
  const elInfoMapel = document.getElementById('lbl-info-mapel');
  if(elInfoMapel) elInfoMapel.innerHTML = `<span class="text-slate-300 font-bold"><i class="fa-regular fa-calendar"></i> Tahun: ${currentTahun}</span><span class="text-slate-600 hidden sm:inline">|</span><span class="text-blue-400 font-bold"><i class="fa-regular fa-calendar-check"></i> Bln: ${currentBulan}</span><span class="text-slate-600 hidden sm:inline">|</span><span class="text-green-400 font-bold"><i class="fa-solid fa-leaf"></i> Smt: ${smt}</span><span class="text-slate-600 hidden sm:inline">|</span><span class="text-purple-400 font-bold"><i class="fa-solid fa-book"></i> Mapel: ${namaMapel}</span><span class="text-slate-600 hidden sm:inline">|</span><span class="text-pink-400 font-bold"><i class="fa-solid fa-users"></i> ${isEkskul ? 'Ekskul' : 'Kelas'}: ${kelas}</span>`;

  const tableEl = document.getElementById('tabel-absensi');
  if(tableEl) tableEl.innerHTML = `<tr><td class="p-6 text-center text-slate-400 text-xs"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>Sinkronisasi Database...</td></tr>`;

  try {
    const payload = { kelas: kelas, mapel: namaMapel, bulan: currentBulan, tahun: currentTahun };
    const json = await supabaseFetch('get_dashboard_data', payload);
      if (json.status === 'success') {
      rawAbsenData = json.absen; 
      dataStatusKunciGuru = json.status_guru; 
      namaKepsekGlobal = json.kepsek || "_____________________";
      
      let filteredMurid = json.murid;
      
      // PERBAIKAN: Selalu saring siswa berdasarkan kolom "Ekstrakurikuler" 
      // dari sheet "Data Akun Murid", lalu pisahkan dengan koma jika ekskul lebih dari satu.
      if (isEkskul) { 
        filteredMurid = filteredMurid.filter(m => {
            const dataEkskul = m["Ekstrakurikuler"] || "";
            const arrEkskul = dataEkskul.split(',').map(e => e.trim());
            return arrEkskul.includes(namaMapel);
        });
      }

      const isPengurus = currentUser.role === 'murid' && currentUser.user["Jabatan Kelas"]?.match(/Ketua|Sekretaris/i);
      if (currentUser.role === 'murid' && !isPengurus) filteredMurid = filteredMurid.filter(m => m.NIS == currentUser.user["NIS"]);

      listMuridKelas = filteredMurid.map((m, idx) => {
        const absenSiswa = rawAbsenData.filter(a => a.NIS == m.NIS);
        let tH = 0, tS = 0, tI = 0, tA = 0, tD = 0;
        absenSiswa.forEach(a => { if (a.Status === 'H') tH++; if (a.Status === 'S') tS++; if (a.Status === 'I') tI++; if (a.Status === 'A') tA++; if (a.Status === 'D') tD++; });
        let jkStr = "-"; if(m["Jenis Kelamin"]) { const jkL = m["Jenis Kelamin"].toLowerCase(); if(jkL.startsWith('l')) jkStr = "L"; else if(jkL.startsWith('p')) jkStr = "P"; }
        return { no: idx + 1, nis: m.NIS || "-", nisn: m.NISN || "-", nama: m["Nama Lengkap"] || "-", kelasAsli: m["Tingkat/Kelas"], jk: jkStr, jabatan: m["Jabatan Kelas"] || "", hp: m["No HP/WA"] || "", totalH: tH, totalS: tS, totalI: tI, totalA: tA, totalD: tD, ket: m["Catatan Khusus"] || "" };
      });
      refreshTableAbsenUI();
      perbaruiIkonAkses();
    }
  } catch (e) { if(tableEl) tableEl.innerHTML = `<tr><td class="p-6 text-center text-red-400"><i class="fa-solid fa-triangle-exclamation text-2xl mb-2"></i><br>Gagal memuat data.</td></tr>`; }
}

/** Alias refresh (tombol Refresh memanggil loadDataAbsensi). */
function loadDataAbsensi() { return loadDataMuridDanAbsen(); }

/** Ekstrak hari (1-31) dari kolom tanggal absensi ("YYYY-MM-DD" / ISO). */
function hariDariTanggal(t) {
  const m = String(t || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? parseInt(m[3], 10) : parseInt(String(t || ''), 10);
}

/** Susun tanggal lengkap YYYY-MM-DD dari currentTahun + currentBulan + hari. */
function tanggalLengkapAbsen(hari) {
  const arrB = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  const idx = arrB.indexOf(currentBulan);
  const parts = String(currentTahun || '').split('/');
  const tahunAktual = (idx >= 6) ? parts[0] : (parts[1] || parts[0]);
  return `${tahunAktual}-${String(idx + 1).padStart(2, '0')}-${String(hari).padStart(2, '0')}`;
}

function toggleNamaSiswa() { showNamaSiswa = !showNamaSiswa; refreshTableAbsenUI(); }
function cycleRekapMode() { rekapModeState = (rekapModeState + 1) % 4; refreshTableAbsenUI(); }

// ---------- UNDO / REDO ABSENSI ----------
let undoStackAbsen = [], redoStackAbsen = [];

function updateUndoRedoAbsenUI() {
  const u = document.getElementById('btn-undo-absen'), r = document.getElementById('btn-redo-absen');
  if (u) u.disabled = undoStackAbsen.length === 0;
  if (r) r.disabled = redoStackAbsen.length === 0;
}

function setNilaiAbsen(id, val) {
  const el = document.getElementById(id);
  if (!el) return false;
  el.value = val;
  el.dataset.oldAbsen = val;
  return true;
}

function undoAbsen() {
  const langkah = undoStackAbsen.pop();
  if (!langkah) return;
  if (setNilaiAbsen(langkah.id, langkah.from)) redoStackAbsen.push(langkah);
  updateUndoRedoAbsenUI();
}

function redoAbsen() {
  const langkah = redoStackAbsen.pop();
  if (!langkah) return;
  if (setNilaiAbsen(langkah.id, langkah.to)) undoStackAbsen.push(langkah);
  updateUndoRedoAbsenUI();
}

/** Pasang perekam perubahan sel absensi (sekali, via delegation). */
function pasangPerekamUndoAbsen() {
  if (window.__absenUndoTerpasang) return;
  window.__absenUndoTerpasang = true;
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el.id && el.id.startsWith('A_')) el.dataset.oldAbsen = el.value;
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.id || !el.id.startsWith('A_')) return;
    const lama = el.dataset.oldAbsen ?? '';
    const baru = el.value;
    if (lama === baru) return;
    undoStackAbsen.push({ id: el.id, from: lama, to: baru });
    if (undoStackAbsen.length > 100) undoStackAbsen.shift();
    redoStackAbsen = [];
    updateUndoRedoAbsenUI();
  });
}

window.openEditAbsenMasal = function(tanggal, isHariLibur = false) {
  const isPengurus = currentUser.role === 'murid' && currentUser.user["Jabatan Kelas"]?.match(/Ketua|Sekretaris/i);
  if (currentUser.role === 'murid' && !isPengurus) return Swal.fire({ icon: 'info', title: 'Mode Laporan Saya', text: 'Anda hanya dapat melihat riwayat absensi Anda (Tidak bisa diedit).', background: '#1e293b', color: '#fff' }); 
  
  // FIX LOW-BUG: aman jika nilai dropdown tak mengandung '|' (hindari "undefined")
  const mapelRaw = document.getElementById('select-mapel').value || "", namaMapel = mapelRaw.includes('|') ? mapelRaw.split('|')[1] : mapelRaw;
  if (currentUser.role === 'admin' || currentUser.role === 'guru') {
    if (!checkHakAkses(mapelRaw)) return Swal.fire({ icon: 'error', title: 'Akses Ditolak', text: 'Hanya Guru Pengampu yang bisa mengubah ini.', background: '#1e293b', color: '#fff' }); 
  } else {
    const targetGuru = dataStatusKunciGuru.find(g => (g.Mapel || "").includes(namaMapel) || (g.Ekskul || "").includes(namaMapel));
    if(!targetGuru || targetGuru.Kunci !== 'BUKA') return Swal.fire({ icon: 'error', title: 'Dikunci', text: 'Sesi Absensi Ditutup oleh Guru.', background: '#1e293b', color: '#fff' }); 
  }

  if (isHariLibur) {
    Swal.fire({ title: 'HARI LIBUR?', text: 'Tanggal ini merah (Libur). Yakin ingin membuka sesi absen/ijin?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Ya', cancelButtonText: 'Batal', background: '#1e293b', color: '#fff' }).then(r => { if(r.isConfirmed) showModalEditAbsen(tanggal); });
  } else { showModalEditAbsen(tanggal); }
};



window.openModalKeteranganSiswa = function(nis, nama) {
  const absenSiswa = rawAbsenData.filter(a => a.NIS == nis);
  let htmlContent = `<div class="text-left text-sm text-slate-300 space-y-3 max-h-[45vh] overflow-y-auto custom-scrollbar pr-2 mt-2">`;
  let hasData = false;
  
  absenSiswa.forEach(a => {
    const ket = a["Keterangan ketidakhadiran"] || a.Keterangan || "";
    if (ket.trim() !== "" || ['S','I','A'].includes(a.Status)) {
      hasData = true;
      let color = 'bg-slate-500';
      if(a.Status==='H') color='bg-green-500'; else if(a.Status==='S') color='bg-blue-500'; else if(a.Status==='I') color='bg-yellow-500'; else if(a.Status==='A') color='bg-red-500';
      
      htmlContent += `<div class="bg-black/30 p-3 rounded border border-white/10 shadow-inner"><div class="flex justify-between items-center mb-2"><span class="font-bold text-blue-400"><i class="fa-regular fa-calendar"></i> Tanggal ${a.Tanggal}</span><span class="px-2 py-0.5 rounded text-[10px] font-bold ${color} text-white">${a.Status}</span></div><textarea id="ket_edit_${nis}_${a.Tanggal}" class="w-full bg-white/5 border border-white/20 rounded px-2 py-2 text-xs text-white outline-none focus:border-blue-500" placeholder="Ketik keterangan (kosongkan untuk hapus)..." rows="2">${ket}</textarea></div>`;
    }
  });
  
  if (!hasData) htmlContent += `<div class="text-center p-6 text-slate-500"><i class="fa-solid fa-folder-open text-2xl mb-2"></i><br>Tidak ada riwayat Izin/Sakit/Alpa atau Keterangan.</div>`;
  htmlContent += `</div>`;

  Swal.fire({
    title: `<div class="text-lg font-bold"><i class="fa-solid fa-list-check"></i> Riwayat Keterangan</div>`,
    html: `<p class="text-xs text-slate-400 text-center font-bold uppercase tracking-wider mb-2">${nama}</p>${htmlContent}`,
    background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonText: '<i class="fa-solid fa-save"></i> Simpan Data', cancelButtonText: 'Tutup', showLoaderOnConfirm: true,
    preConfirm: () => {
      if(!hasData) return true;
      let updates = [];
      absenSiswa.forEach(a => { const el = document.getElementById(`ket_edit_${nis}_${a.Tanggal}`); if(el) updates.push({ tanggal: a.Tanggal, keterangan: el.value }); });
      return updates;
    }
  }).then(res => { if(res.isConfirmed && res.value && res.value !== true) saveKeteranganSiswaAPI(nis, res.value); });
};

async function saveKeteranganSiswaAPI(nis, updates) {
  // FIX LOW-BUG: sama seperti openEditAbsenMasal — aman tanpa '|'
  const mapelRaw = document.getElementById('select-mapel').value || "", namaMapel = mapelRaw.includes('|') ? mapelRaw.split('|')[1] : mapelRaw;
  
  Swal.fire({ title: 'Menyimpan...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
  
  try {
    const res = await apiCall('save_keterangan_siswa', { nis: nis, mapel: namaMapel, updates: updates });
    if (res.status === 'success') { Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Tersimpan!', showConfirmButton: false, timer: 1500, background: '#1e293b', color: '#fff' }); loadDataMuridDanAbsen(); } 
    else { Swal.fire({ icon: 'error', title: 'Gagal', text: res.message || 'Gagal menyimpan keterangan.', background: '#1e293b', color: '#fff' }); }
  } catch (e) { Swal.fire({ icon: 'error', title: 'Error Jaringan', text: e.message || '', background: '#1e293b', color: '#fff' }); }
}

function showModalEditAbsen(tanggal) {
  tempKeteranganHarian = {}; 
  let ketMasalDB = "";
  let siswaListHTML = listMuridKelas.map(m => {
    const dataDb = rawAbsenData.find(a => hariDariTanggal(a.Tanggal) === parseInt(tanggal) && a.NIS == m.nis);
    const s = dataDb ? dataDb.Status : "";
    const ketDB = dataDb ? (dataDb["Keterangan ketidakhadiran"] || dataDb.Keterangan || "") : "";
    
    if (dataDb && dataDb["Keterangan kehadiran"]) ketMasalDB = dataDb["Keterangan kehadiran"]; 
    if (ketDB) tempKeteranganHarian[m.nis] = ketDB;
    
    const cH = s === 'H' ? 'checked' : '', cS = s === 'S' ? 'checked' : '', cI = s === 'I' ? 'checked' : '', cA = s === 'A' ? 'checked' : '', cD = s === 'D' ? 'checked' : '';
    const colorKet = ketDB ? 'text-blue-400' : 'text-slate-500';
    const ro = 'onclick="radioToggleOff(this)"';
    
    return `<div class="flex items-center justify-between border-b border-white/10 py-2.5" id="row-murid-${m.nis}"><span class="modal-nama-absen text-xs font-medium text-slate-200 text-left leading-snug whitespace-normal break-words" style="width:${wNamaModal}px">${m.no}. ${m.nama}</span><div class="flex gap-1.5 flex-1 min-w-0 justify-end items-center"><label class="cursor-pointer"><input type="radio" name="absen_${m.nis}" value="H" ${cH} ${ro} class="hidden peer radio-h"><div class="w-6 h-6 rounded bg-white/10 flex items-center justify-center text-[10px] font-bold text-slate-400 peer-checked:bg-green-500 peer-checked:text-white">H</div></label><label class="cursor-pointer"><input type="radio" name="absen_${m.nis}" value="S" ${cS} ${ro} class="hidden peer"><div class="w-6 h-6 rounded bg-white/10 flex items-center justify-center text-[10px] font-bold text-slate-400 peer-checked:bg-blue-500 peer-checked:text-white">S</div></label><label class="cursor-pointer"><input type="radio" name="absen_${m.nis}" value="I" ${cI} ${ro} class="hidden peer"><div class="w-6 h-6 rounded bg-white/10 flex items-center justify-center text-[10px] font-bold text-slate-400 peer-checked:bg-yellow-500 peer-checked:text-white">I</div></label><label class="cursor-pointer"><input type="radio" name="absen_${m.nis}" value="A" ${cA} ${ro} class="hidden peer"><div class="w-6 h-6 rounded bg-white/10 flex items-center justify-center text-[10px] font-bold text-slate-400 peer-checked:bg-red-500 peer-checked:text-white">A</div></label><label class="cursor-pointer" title="Dispen"><input type="radio" name="absen_${m.nis}" value="D" ${cD} ${ro} class="hidden peer"><div class="w-6 h-6 rounded bg-white/10 flex items-center justify-center text-[10px] font-bold text-slate-400 peer-checked:bg-purple-500 peer-checked:text-white">D</div></label><div class="flex items-center gap-1 ml-1" style="width: 50px;"><span class="text-[8px] text-yellow-400 truncate w-8 text-right" title="${ketDB}">${ketDB || '-'}</span><button id="btn-ket-${m.nis}" onclick="popupEditKeterangan('${m.nis}', '${m.nama.replace(/'/g, "\\'")}')" class="w-5 h-5 rounded bg-black/30 hover:bg-black/50 transition ${colorKet}"><i class="fa-solid fa-pen-to-square text-[10px]"></i></button></div></div></div>`;
  }).join('');

  let uiAdminGuru = '', btnToggleAdmin = '';
  if (currentUser.role !== 'murid') {
    const currentCaptcha = currentUser.user["Captcha"] || "1234", isBuka = currentUser.user["Kunci Absen"] === "BUKA";
    btnToggleAdmin = `<button id="btn-toggle-kunci-panel" class="absolute top-4 left-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition flex items-center justify-center z-10" title="Buka/Tutup Pengaturan Kunci Siswa"><i class="fa-solid fa-lock text-sm"></i></button>`;
    uiAdminGuru = `<div id="panel-kunci-admin" class="hidden bg-blue-900/40 border border-blue-500/50 p-3 rounded-lg mb-4 text-left shadow-lg"><div class="flex justify-between items-center mb-2"><label class="text-[11px] font-bold text-blue-300"><i class="fa-solid fa-key"></i> Kunci Absen Siswa (Captcha)</label><label class="relative inline-flex items-center cursor-pointer"><input type="checkbox" id="toggle-kunci" class="sr-only peer" ${isBuka ? 'checked' : ''}><div class="w-9 h-5 bg-slate-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"></div></label></div><div class="flex gap-2"><input type="text" id="input-captcha" value="${currentCaptcha}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 text-xs text-white font-mono uppercase tracking-widest outline-none focus:border-blue-400"><button onclick="updateKunciServer()" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-[10px] font-bold whitespace-nowrap shadow-md">Simpan Kunci</button></div></div>`;
  }
  
  Swal.fire({
    title: `<div class="text-lg font-bold mt-2">Tgl ${tanggal} ${currentBulan}</div>`, width: '600px',
    html: `${btnToggleAdmin}${uiAdminGuru}<div class="flex items-stretch justify-between gap-2 mb-3 bg-slate-700/50 p-2 rounded-lg border border-slate-500 shadow-inner w-full h-10"><button id="btn-qr-modal" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[10px] font-bold flex justify-center items-center gap-1 transition"><i class="fa-solid fa-camera text-xs"></i> <span class="hidden sm:inline">QR Scan</span><span class="sm:hidden">QR</span></button><input type="text" id="input-ket-kehadiran-masal" value="${ketMasalDB}" class="flex-1 w-0 bg-black/50 border border-white/30 rounded px-2 text-[10px] sm:text-[11px] text-center text-white placeholder-slate-400 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition" placeholder="Ket. Masal..."><button id="btn-hadir-semua" class="flex-1 bg-green-600 hover:bg-green-700 text-white rounded text-[10px] font-bold flex justify-center items-center gap-1 transition"><i class="fa-solid fa-check-double text-xs"></i> <span class="hidden sm:inline">Masal Hadir</span><span class="sm:hidden">Hadir</span><button onclick="hapusPilihanAbsen()" title="Hapus Pilihan" class="p-2 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded-lg transition border border-red-500/30 shadow-sm flex items-center justify-center">
    <i class="fa-solid fa-eraser text-base"></i>
</button></button></div><details class="bg-black/30 border border-white/10 rounded-lg mb-3 px-3 py-2 text-left"><summary class="text-[11px] font-bold text-amber-300 cursor-pointer select-none"><i class="fa-solid fa-book-open-reader"></i> Agenda Guru / Jurnal Harian</summary><div class="grid grid-cols-2 gap-2 mt-2 text-[10px]"><div><label class="text-slate-400 font-bold">Hari/Tanggal</label><input id="j_tanggal" readonly value="${tanggal} ${currentBulan} ${currentTahun}" class="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-slate-300 outline-none"></div><div><label class="text-slate-400 font-bold">Pertemuan Ke-</label><input id="j_pertemuan" type="number" min="1" placeholder="otomatis" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1 text-white outline-none focus:border-amber-400"></div><div class="col-span-2"><label class="text-slate-400 font-bold">Kompetensi Dasar</label><input id="j_kd" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1 text-white outline-none focus:border-amber-400"></div><div class="col-span-2"><label class="text-slate-400 font-bold">Materi</label><input id="j_materi" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1 text-white outline-none focus:border-amber-400"></div><div class="col-span-2"><label class="text-slate-400 font-bold">Kegiatan Belajar Mengajar</label><textarea id="j_kbm" rows="2" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1 text-white outline-none focus:border-amber-400"></textarea></div><div class="col-span-2"><label class="text-slate-400 font-bold">Permasalahan dalam Proses KBM</label><textarea id="j_masalah" rows="2" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1 text-white outline-none focus:border-amber-400"></textarea></div></div></details><div class="flex justify-end px-2 pb-1"><span onmousedown="mulaiGeserNamaModal(event)" title="Tarik untuk atur lebar kolom nama" class="inline-flex items-center gap-1 text-[9px] text-slate-400 cursor-col-resize bg-white/10 border border-white/20 rounded px-2 py-0.5 hover:bg-blue-500 hover:text-white select-none"><i class="fa-solid fa-arrows-left-right"></i> Lebar Nama</span></div><div id="qr-reader-in-modal" class="w-full hidden border-2 border-blue-500 rounded-lg mb-3"></div><div class="max-h-[35vh] overflow-y-auto px-2 text-left custom-scrollbar border-t border-white/10 pt-2">${siswaListHTML}</div>`,
    background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonText: '<i class="fa-solid fa-save"></i> Simpan', cancelButtonText: 'Batal',
        didOpen: () => {
      document.getElementById('btn-hadir-semua').addEventListener('click', () => document.querySelectorAll('.radio-h').forEach(r => r.checked = true));
      const btnToggle = document.getElementById('btn-toggle-kunci-panel');
      if(btnToggle) { btnToggle.addEventListener('click', () => { const panel = document.getElementById('panel-kunci-admin'); if(panel.classList.contains('hidden')) { panel.classList.remove('hidden'); btnToggle.classList.add('bg-blue-600', 'text-white'); btnToggle.classList.remove('bg-white/10', 'text-slate-300'); } else { panel.classList.add('hidden'); btnToggle.classList.add('bg-white/10', 'text-slate-300'); btnToggle.classList.remove('bg-blue-600', 'text-white'); } }); }
      document.getElementById('btn-qr-modal').addEventListener('click', () => { if (html5QrcodeScanner) { try { const prevClear = html5QrcodeScanner.clear && html5QrcodeScanner.clear(); if (prevClear && prevClear.catch) prevClear.catch(() => {}); } catch (e) {} html5QrcodeScanner = null; } document.getElementById('qr-reader-in-modal').classList.remove('hidden'); html5QrcodeScanner = new Html5QrcodeScanner("qr-reader-in-modal", { fps: 10, qrbox: {width: 200, height: 200} }); html5QrcodeScanner.render((nis) => { const radioH = document.querySelector(`input[name="absen_${nis}"][value="H"]`); if (radioH && !radioH.checked) { radioH.checked = true; const nama = listMuridKelas.find(m => m.nis == nis)?.nama || "Siswa"; const utt = new SpeechSynthesisUtterance(`Hadir, ${nama}`); utt.lang = 'id-ID';utt.rate = 1.4; window.speechSynthesis.speak(utt); const r = document.getElementById(`row-murid-${nis}`); r.classList.add('bg-green-900/50'); setTimeout(() => r.classList.remove('bg-green-900/50'), 1500); } }, () => {}); });
      // Pertemuan ke- otomatis: lanjut dari jurnal terakhir guru+kelas+mapel+tahun ini
      (async () => {
        try {
          const nipGuru = (currentUser.role !== 'murid') ? (currentUser.user["ID Akun Guru"] || '') : '';
          if (!nipGuru) return;
          const kelasJ = document.getElementById('select-kelas')?.value || '';
          const mapelRawJ = document.getElementById('select-mapel')?.value || '';
          const mapelJ = mapelRawJ.includes('|') ? mapelRawJ.split('|')[1] : mapelRawJ;
          const { data, error } = await supaClient.from('jurnal_guru')
            .select('pertemuan')
            .eq('nis_guru', nipGuru).eq('kelas', kelasJ).eq('mapel', mapelJ).eq('tahun', currentTahun)
            .order('pertemuan', { ascending: false }).limit(1);
          const next = (!error && data && data[0]) ? (data[0].pertemuan + 1) : 1;
          const elP = document.getElementById('j_pertemuan');
          if (elP && !elP.value) elP.value = next;
        } catch (e) { console.warn('Auto pertemuan:', e); }
      })();
    },
    preConfirm: () => {
      let absenPayload = [];
      listMuridKelas.forEach(m => { const rad = document.querySelector(`input[name="absen_${m.nis}"]:checked`); if (rad) absenPayload.push({ nis: m.nis, nama: m.nama, status: rad.value, keterangan: tempKeteranganHarian[m.nis] || "" }); });
      const inputEl = document.getElementById('input-ket-kehadiran-masal');
      const jd = (id) => (document.getElementById(id)?.value || '').trim();
      const jurnalRaw = { pertemuan: jd('j_pertemuan'), kd: jd('j_kd'), materi: jd('j_materi'), kbm: jd('j_kbm'), masalah: jd('j_masalah') };
      const isiJurnal = jurnalRaw.kd || jurnalRaw.materi || jurnalRaw.kbm || jurnalRaw.masalah;
      if (isiJurnal && (!/^\d+$/.test(jurnalRaw.pertemuan) || parseInt(jurnalRaw.pertemuan, 10) < 1)) {
        Swal.showValidationMessage('Pertemuan ke- harus berupa angka minimal 1.'); return false;
      }
      return { absenList: absenPayload, ketMasal: inputEl ? inputEl.value : "", jurnal: isiJurnal ? jurnalRaw : null };
    }
  }).then((res) => {
    if (!res.isConfirmed || !res.value) return;
    if (res.value.absenList.length > 0) simpanKeDatabase(tanggal, res.value.absenList, res.value.ketMasal);
    if (res.value.jurnal) simpanJurnalGuru(tanggal, res.value.jurnal);
  });
}

async function simpanKeDatabase(tanggal, absenList, keteranganMasal = "") {
  if (!bolehSimpanAbsen()) return;
  const mapelRaw = document.getElementById('select-mapel').value || "", arrMapel = mapelRaw.split('|'), jenisData = arrMapel[0] || "Mapel", namaMapelEkskul = arrMapel[1] || mapelRaw, kelasDipilih = document.getElementById('select-kelas').value || "";
  const idGuruTarget = (currentUser.role === 'admin' || currentUser.role === 'guru') ? currentUser.user["ID Akun Guru"] : "MURID-" + currentUser.user["NIS"];
  const smt = ['Juli','Agustus','September','Oktober','November','Desember'].includes(currentBulan) ? 'Ganjil' : 'Genap';

  Swal.fire({ title: 'Menyimpan...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
  try {
    const res = await apiCall('save_absen_masal', {
      absenList,
      keterangan_kehadiran_masal: keteranganMasal,
      tanggal: tanggalLengkapAbsen(tanggal),
      kelas: kelasDipilih,
      jenis: jenisData,
      mapel: namaMapelEkskul,
      ekskul: namaMapelEkskul,
      tahun: currentTahun,
      semester: smt,
      bulan: currentBulan,
      id_guru: idGuruTarget,
      metode: 'Manual / QR'
    });
    if (res.status === 'success') {
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Data Berhasil Disimpan!', showConfirmButton: false, timer: 1500, background: '#1e293b', color: '#fff' });
      loadDataMuridDanAbsen();
    } else {
      Swal.fire({ icon: 'error', title: 'Ditolak', text: res.message || 'Gagal menyimpan absensi.', background: '#1e293b', color: '#fff' });
    }
  } catch (e) { Swal.fire({ icon: 'error', title: 'Gagal Menyimpan', text: e.message || '', background: '#1e293b', color: '#fff' }); }
}

/** Simpan Agenda/Jurnal Harian Guru (upsert per guru+kelas+mapel+tahun+pertemuan). */
async function simpanJurnalGuru(tanggal, jurnal) {
  if (!bolehSimpanAbsen()) return;
  const nipGuru = currentUser.user["ID Akun Guru"] || currentUser.user["NIP"] || "";
  if (!nipGuru) { showToast('error', 'Jurnal: akun tidak memiliki NIP.'); return; }
  const pertemuan = parseInt(jurnal.pertemuan, 10);
  if (!pertemuan || pertemuan < 1) { showToast('error', 'Jurnal: nomor pertemuan tidak valid.'); return; }
  const mapelRaw = document.getElementById('select-mapel').value || "";
  const mapel = mapelRaw.includes('|') ? mapelRaw.split('|')[1] : mapelRaw;
  const kelas = document.getElementById('select-kelas')?.value || "";
  const smt = ['Juli','Agustus','September','Oktober','November','Desember'].includes(currentBulan) ? 'Ganjil' : 'Genap';
  try {
    const { error } = await supaClient.from('jurnal_guru').upsert({
      nis_guru: nipGuru,
      tanggal: tanggalLengkapAbsen(tanggal),
      kelas: kelas,
      mapel: mapel,
      pertemuan: pertemuan,
      tahun: currentTahun,
      semester: smt,
      bulan: currentBulan,
      kompetensi_dasar: jurnal.kd,
      materi: jurnal.materi,
      kegiatan_kbm: jurnal.kbm,
      permasalahan: jurnal.masalah,
      updated_at: new Date().toISOString()
    }, { onConflict: 'nis_guru,kelas,mapel,tahun,pertemuan' });
    if (error) throw error;
    showToast('success', `Jurnal pertemuan ke-${pertemuan} tersimpan`);
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Jurnal Gagal', text: e.message || '', background: '#1e293b', color: '#fff' });
  }
}

async function updateKunciServer() {
  const newCaptcha = document.getElementById('input-captcha').value.trim(), newKunci = document.getElementById('toggle-kunci').checked ? 'BUKA' : 'TUTUP';
  if(!newCaptcha) return Swal.fire({toast:true, position:'top-end', icon:'error', title:'Captcha kosong!', showConfirmButton:false, timer:2000});
  const nipGuru = currentUser.user["ID Akun Guru"] || currentUser.user["NIP"] || "";
  if(!nipGuru) return Swal.fire({toast:true, position:'top-end', icon:'error', title:'Akun tidak memiliki NIP.', showConfirmButton:false, timer:2000});
  try {
    // FIX BUG LOCALSTORAGE: verifikasi respons server SEBELUM menyentuh state/sesi lokal.
    const { error } = await supaClient.from('akun')
      .update({ captcha: newCaptcha, kunci_absen: newKunci })
      .eq('nis_nip', nipGuru);
    if (error) throw error;
    currentUser.user["Captcha"] = newCaptcha; currentUser.user["Kunci Absen"] = newKunci;
    // Simpan hanya bila token valid — jangan timpa token sesi dengan string kosong.
    const tokenAktif = getToken();
    if (tokenAktif) setSession(tokenAktif, currentUser);
    else console.warn('updateKunciServer: token sesi kosong, sesi localStorage dilewati.');
    Swal.fire({toast:true, position:'top-end', icon:'success', title:'Kunci Diperbarui!', showConfirmButton:false, timer:2000, background: '#1e293b', color: '#fff'});
    loadDataMuridDanAbsen();
  } catch (e) {
    Swal.fire({toast:true, position:'top-end', icon:'error', title:(e && e.message) || 'Gagal memperbarui kunci', showConfirmButton:false, timer:2500, background: '#1e293b', color: '#fff'});
  }
}

window.popupEditKeterangan = function(nis, namaSiswa) {
  const ketSekarang = tempKeteranganHarian[nis] || "";
  const ketBaru = prompt(`Keterangan ketidakhadiran untuk ${namaSiswa}:\n(Contoh: Sakit tipes / Izin urusan keluarga)`, ketSekarang);
  if (ketBaru !== null) {
    tempKeteranganHarian[nis] = ketBaru;
    const btn = document.getElementById(`btn-ket-${nis}`);
    if(btn) {
      if(ketBaru.trim() !== "") { btn.classList.remove('text-slate-500'); btn.classList.add('text-blue-400'); } 
      else { btn.classList.add('text-slate-500'); btn.classList.remove('text-blue-400'); }
    }
  }
};

function generateHTMLReport() {
  const mapelRaw = document.getElementById('select-mapel').value || "", namaMapel = mapelRaw.includes('|') ? mapelRaw.split('|')[1] : (mapelRaw || "-"), kelas = document.getElementById('select-kelas').value || "Semua Kelas", smt = ['Juli','Agustus','September','Oktober','November','Desember'].includes(currentBulan) ? 'Ganjil' : 'Genap';
  // FIX HARD-CODED /21: pembagi % laporan cetak kini hari efektif dinamis
  const hariEfektifReport = hitungHariEfektif();
  const pembagiPersen = hariEfektifReport > 0 ? hariEfektifReport : 1;
  let theadStr = `<tr><th rowspan="2" style="border:1px solid #000; padding:4px;">No</th><th rowspan="2" style="border:1px solid #000; padding:4px;">NISN</th><th rowspan="2" style="border:1px solid #000; padding:4px;">Nama Siswa</th><th rowspan="2" style="border:1px solid #000; padding:4px;">L/P</th><th colspan="31" style="border:1px solid #000; padding:4px;">Tanggal</th><th colspan="4" style="border:1px solid #000; padding:4px;">Jumlah</th><th rowspan="2" style="border:1px solid #000; padding:4px;">Total</th><th rowspan="2" style="border:1px solid #000; padding:4px;">%</th></tr><tr>`;
  for(let i=1; i<=31; i++) { theadStr += `<th style="border:1px solid #000; padding:2px; font-size:9px; width:15px; text-align:center;">${i}</th>`; }
  theadStr += `<th style="border:1px solid #000; padding:3px; font-size:10px; width:20px;">H</th><th style="border:1px solid #000; padding:3px; font-size:10px; width:20px;">S</th><th style="border:1px solid #000; padding:3px; font-size:10px; width:20px;">I</th><th style="border:1px solid #000; padding:3px; font-size:10px; width:20px;">A</th></tr>`;

  let tbodyStr = listMuridKelas.map(s => {
    let tdTgl = "";
    for(let i=1; i<=31; i++) { const dataDb = rawAbsenData.find(a => parseInt(a.Tanggal) === i && a.NIS == s.nis); const val = dataDb ? dataDb.Status : ''; tdTgl += `<td style="border:1px solid #000; text-align:center; font-size:10px; font-weight:bold;">${val}</td>`; }
    const persen = ((s.totalH / pembagiPersen) * 100).toFixed(1), totalSemua = s.totalH + s.totalS + s.totalI + s.totalA;
    return `<tr><td style="border:1px solid #000; text-align:center; padding:3px;">${s.no}</td><td style="border:1px solid #000; text-align:center; padding:3px;">${s.nisn}</td><td style="border:1px solid #000; padding:3px 6px; white-space:nowrap;">${s.nama}</td><td style="border:1px solid #000; text-align:center; padding:3px;">${s.jk}</td>${tdTgl}<td style="border:1px solid #000; text-align:center; padding:3px; font-weight:bold;">${s.totalH}</td><td style="border:1px solid #000; text-align:center; padding:3px; font-weight:bold;">${s.totalS}</td><td style="border:1px solid #000; text-align:center; padding:3px; font-weight:bold;">${s.totalI}</td><td style="border:1px solid #000; text-align:center; padding:3px; font-weight:bold;">${s.totalA}</td><td style="border:1px solid #000; text-align:center; padding:3px; font-weight:bold; background-color:#f0f0f0;">${totalSemua}</td><td style="border:1px solid #000; text-align:center; padding:3px;">${persen}%</td></tr>`;
  }).join('');

  const namaGuru = currentUser.role !== 'murid' ? currentUser.user["Nama Lengkap"] : "_____________________";
  return `<div style="font-family: 'Times New Roman', Times, serif; font-size:12px; color:#000; background:#fff; padding:20px;"><h3 style="text-align:center; margin-bottom:5px; font-size:16px; font-weight:bold;">DAFTAR HADIR TATAP MUKA</h3><h4 style="text-align:center; margin-top:0; margin-bottom:20px; font-size:13px;">Tahun Pelajaran: ${currentTahun}</h4><table style="width:100%; margin-bottom:10px; border:none; font-size:12px;"><tr><td style="width:50%; text-align:left; vertical-align:top;"><table style="border:none;"><tr><td style="padding-right:15px; font-weight:bold;">Kelas</td><td>: ${kelas}</td></tr><tr><td style="padding-right:15px; font-weight:bold;">Wali Kelas</td><td>: ___________________</td></tr></table></td><td style="width:50%; text-align:right; vertical-align:top;"><table style="border:none; margin-left:auto;"><tr><td style="padding-right:15px; text-align:left; font-weight:bold;">Semester</td><td style="text-align:left;">: ${smt}</td></tr><tr><td style="padding-right:15px; text-align:left; font-weight:bold;">Mata Pelajaran</td><td style="text-align:left;">: ${namaMapel}</td></tr></table></td></tr></table><table style="width:100%; border-collapse: collapse; font-size:11px;" border="1"><thead>${theadStr}</thead><tbody>${tbodyStr}</tbody></table><table style="width:100%; margin-top:40px; border:none; text-align:center; font-size:12px;"><tr><td style="width:50%;">Mengetahui,<br>Kepala Sekolah<br><br><br><br><br><b><u>${namaKepsekGlobal}</u></b></td><td style="width:50%;"><br>Guru Mata Pelajaran<br><br><br><br><br><b><u>${namaGuru}</u></b></td></tr></table></div>`;
}

window.exportExcel = function() {
  // FIX LOW-BUG: mapel tanpa '|' tidak lagi menghasilkan "undefined" di nama file
  const mapelRaw = document.getElementById('select-mapel').value || "", mapelName = mapelRaw.includes('|') ? mapelRaw.split('|')[1] : (mapelRaw || "Absensi"), className = document.getElementById('select-kelas').value || "Semua_Kelas";
  const fileName = `Daftar_Hadir_${mapelName}_${className}_${currentBulan}.xls`;
  const htmlTable = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body>${generateHTMLReport()}</body></html>`;
  const blob = new Blob([htmlTable], { type: 'application/vnd.ms-excel' });
  // FIX LOW-BUG: revoke object URL agar tidak bocor memori
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
};

window.exportPDF = function() {
  const mapelRaw = document.getElementById('select-mapel').value || "", mapelName = mapelRaw.includes('|') ? mapelRaw.split('|')[1] : (mapelRaw || "Absensi"), className = document.getElementById('select-kelas').value || "Semua_Kelas";
  const docTitle = `Daftar_Hadir_${mapelName}_${className}_${currentBulan}`, htmlContent = generateHTMLReport();
  const printWindow = window.open('', '_blank');
  // FIX LOW-BUG: popup blocker menyebabkan TypeError null — beri umpan balik
  if (!printWindow) return Swal.fire({ icon: 'error', title: 'Popup Diblokir', text: 'Izinkan popup untuk mencetak PDF.', background: '#1e293b', color: '#fff' });
  printWindow.document.write(`<html><head><title>${docTitle}</title><style>@media print { @page { size: landscape; margin: 15mm; } body { -webkit-print-color-adjust: exact; margin: 0; } } body { font-family: 'Times New Roman', serif; }</style></head><body>${htmlContent}</body></html>`);
  printWindow.document.close(); printWindow.focus(); setTimeout(() => { printWindow.print(); }, 500);
};

// ==========================================
// FIX SIMPAN SEMUA & EXPORT ABSENSI
// ==========================================
async function forceSyncSemuaAbsensi() {
    if (!bolehSimpanAbsen()) return;
    Swal.fire({ title: 'Menyimpan Semua Data...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
    
    let groupedByDate = {};
    rawAbsenData.forEach(d => {
        if(!groupedByDate[d.Tanggal]) groupedByDate[d.Tanggal] = [];
        const m = listMuridKelas.find(x => x.NIS == d.NIS || x.nis == d.NIS);
        if(m) {
            groupedByDate[d.Tanggal].push({
                nis: d.NIS, nama: m["Nama Lengkap"] || m.Nama || m.nama, status: d.Status, keterangan: d["Keterangan ketidakhadiran"] || d.Keterangan || ""
            });
        }
    });

    try {
        const mapelRaw = document.getElementById('select-mapel').value || "";
        const arrMapel = mapelRaw.split('|');
        const jenisData = arrMapel[0] || "Mapel";
        const namaMapelEkskul = arrMapel[1] || mapelRaw;
        const kelasDipilih = document.getElementById('select-kelas').value || "";
        const idGuruTarget = (currentUser.role === 'admin' || currentUser.role === 'guru') ? currentUser.user["ID Akun Guru"] : "MURID-" + currentUser.user["NIS"];
        const smt = ['Juli','Agustus','September','Oktober','November','Desember'].includes(currentBulan) ? 'Ganjil' : 'Genap';

        const dates = Object.keys(groupedByDate);
        for(let i=0; i < dates.length; i++) {
            const tgl = dates[i];
            const res = await apiCall('save_absen_masal', {
                absenList: groupedByDate[tgl],
                keterangan_kehadiran_masal: "",
                tanggal: tgl,
                kelas: kelasDipilih,
                jenis: jenisData,
                mapel: namaMapelEkskul,
                ekskul: namaMapelEkskul,
                tahun: currentTahun,
                semester: smt,
                bulan: currentBulan,
                id_guru: idGuruTarget,
                metode: 'Form Masal'
            });
            if (!res || res.status !== 'success') throw new Error((res && res.message) || 'Gagal menyimpan tanggal ' + tgl);
        }
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Seluruh Kehadiran Tersimpan!', showConfirmButton: false, timer: 2000, background: '#1e293b', color: '#fff' });
        loadDataMuridDanAbsen();
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Gagal Menyimpan', text: e.message || 'Periksa koneksi jaringan Anda.', background: '#1e293b', color: '#fff' });
    }
}

// FUNGSI HELPER HTML REPORT
function getAbsensiHTMLReport() {
    const mapelRaw = document.getElementById('select-mapel').value || "";
    const isEkskul = mapelRaw.startsWith("Ekskul|");
    const mapelName = mapelRaw.includes('|') ? mapelRaw.split('|')[1] : mapelRaw;
    const className = document.getElementById('select-kelas').value || "Semua Kelas";
    const semester = typeof currentSemesterNilai !== 'undefined' ? currentSemesterNilai : "Ganjil";
    
    // Informasi Tanda Tangan
    const namaGuru = currentUser && currentUser.user ? (currentUser.user["Nama Guru"] || "_____________________") : "_____________________";
    const kepsek = typeof namaKepsekGlobal !== 'undefined' ? namaKepsekGlobal : "_____________________";
    const labelGuru = isEkskul ? "Pembina Ekstrakurikuler" : "Guru Mata Pelajaran";
    
    let thDates = "";
    for(let i=1; i<=31; i++) thDates += `<th style="border: 1px solid black; padding: 2px; width: 20px;">${i}</th>`;
    
    let trBody = listMuridKelas.map((m, idx) => {
        let nis = m.NIS || m.nis || "-";
        let nama = m["Nama Lengkap"] || m.nama || m.Nama || "-";
        
        let tdDates = "";
        let tH = 0, tS = 0, tI = 0, tA = 0, tD = 0;
        
        for(let i=1; i<=31; i++) {
            let dt = rawAbsenData.find(a => hariDariTanggal(a.Tanggal) === i && String(a.NIS) === String(nis));
            let sts = dt ? dt.Status : "";
            if(sts==='H') tH++; if(sts==='S') tS++; if(sts==='I') tI++; if(sts==='A') tA++; if(sts==='D') tD++;
            tdDates += `<td style="border: 1px solid black; padding: 2px;">${sts}</td>`;
        }
        
        return `<tr>
            <td style="border: 1px solid black; padding: 4px; text-align: center;">${idx+1}</td>
            <td style="border: 1px solid black; padding: 4px; text-align: center;">${nis}</td>
            <td style="border: 1px solid black; padding: 4px; text-align: left; white-space: nowrap;">${nama}</td>
            ${tdDates}
            <td style="border: 1px solid black; padding: 4px; font-weight: bold; background: #e0ffe0;">${tH}</td>
            <td style="border: 1px solid black; padding: 4px; font-weight: bold; background: #ffffe0;">${tS}</td>
            <td style="border: 1px solid black; padding: 4px; font-weight: bold; background: #e0e0ff;">${tI}</td>
            <td style="border: 1px solid black; padding: 4px; font-weight: bold; background: #ffe0e0;">${tA}</td>
            <td style="border: 1px solid black; padding: 4px; font-weight: bold; background: #f0e0ff;">${tD}</td>
        </tr>`;
    }).join('');

    return `
        <div style="font-family: 'Times New Roman', Times, serif; font-size: 10px; color: #000; background: #fff; padding: 20px;">
            <h3 style="text-align: center; margin-bottom: 5px; font-size: 14px; text-transform: uppercase;">REKAP KEHADIRAN TATAP MUKA SISWA</h3>
            <p style="text-align: center; margin: 0.5px 0 15px 0; font-size: 11px;">
                Mapel/Ekskul: <b>${mapelName}</b> &nbsp;|&nbsp; Kelas: <b>${className}</b><br>
                Bulan: <b>${currentBulan} ${currentTahun}</b> &nbsp;|&nbsp; Semester: <b>${semester}</b>
            </p>
            
            <table style="width: 100%; border-collapse: collapse; text-align: center;">
                <thead style="background: #f0f0f0;">
                    <tr>
                        <th style="border: 1px solid black; padding: 4px; width: 3%;">No</th>
                        <th style="border: 1px solid black; padding: 4px; width: 10%;">NIS</th>
                        <th style="border: 1px solid black; padding: 4px; width: 20%;">Nama Siswa</th>
                        ${thDates}
                        <th style="border: 1px solid black; padding: 4px; width: 3%;">H</th>
                        <th style="border: 1px solid black; padding: 4px; width: 3%;">S</th>
                        <th style="border: 1px solid black; padding: 4px; width: 3%;">I</th>
                        <th style="border: 1px solid black; padding: 4px; width: 3%;">A</th>
                        <th style="border: 1px solid black; padding: 4px; width: 3%;">D</th>
                    </tr>
                </thead>
                <tbody>${trBody}</tbody>
            </table>

            <!-- Tanda Tangan Pengesahan -->
            <table style="width: 100%; margin-top: 30px; border: none; text-align: center; font-size: 11px; page-break-inside: avoid;">
                <tr>
                    <td style="width: 50%; border: none; vertical-align: top;">
                        Mengetahui,<br>Kepala Sekolah<br><br><br><br><br>
                        <b><u>${kepsek}</u></b>
                    </td>
                    <td style="width: 50%; border: none; vertical-align: top;">
                        ${labelGuru}<br><br><br><br><br>
                        <b><u>${namaGuru}</u></b>
                    </td>
                </tr>
            </table>
        </div>
    `;
}

window.exportAbsensiExcel = function() {
  const htmlTable = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body>${getAbsensiHTMLReport()}</body></html>`;
  const blob = new Blob([htmlTable], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url;
  a.download = `Kehadiran_${currentBulan}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500); // FIX LOW-BUG: revoke blob URL
};

window.exportAbsensiPDF = function() {
  const htmlContent = getAbsensiHTMLReport();
  const printWindow = window.open('', '_blank');
  // FIX LOW-BUG: popup blocker guard
  if (!printWindow) return Swal.fire({ icon: 'error', title: 'Popup Diblokir', text: 'Izinkan popup untuk mencetak PDF.', background: '#1e293b', color: '#fff' });
  printWindow.document.write(`
    <html><head><title>Cetak PDF</title>
    <style>@media print { @page { size: landscape; margin: 10mm; } }</style>
    </head><body>${htmlContent}</body></html>
  `);
  printWindow.document.close(); 
  printWindow.focus(); 
  setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
};

// Info Kelas Khusus Absen
function showInfoKelasAbsen() {
  const kelas = document.getElementById('select-kelas').value;
  
  let pengurus = listMuridKelas.filter(m => (m.jabatan || m["Jabatan Kelas"] || "").trim() !== "").map(m => {
    const nm = m.nama || m["Nama Lengkap"] || "-";
    const jb = m.jabatan || m["Jabatan Kelas"] || "";
    const hp = m.hp || m["No HP/WA"] || "-";
    return `• ${escapeHtml(nm)} <span class="text-blue-300">(${escapeHtml(jb)})</span> — ${linkWA(hp, `Assalamualaikum, kami menghubungi ${nm} (${jb}) kelas ${kelas}.`)}`;
  }).join('<br>');
  if(!pengurus) pengurus = "<i>Tidak ada data pengurus kelas</i>";
  
  let namaWali = typeof getNamaWaliKelas === 'function' ? getNamaWaliKelas(kelas) : "Nama Wali Kelas";
  let hpWali = "-";
  if (dataStatusKunciGuru && dataStatusKunciGuru.length > 0) {
    const w = dataStatusKunciGuru.find(g => (g["Wali Kelas"] || "") === kelas);
    if (w) hpWali = w["No HP"] || "-";
  }
  
  Swal.fire({ 
    title: `<div class="text-lg font-bold">Info Kelas ${escapeHtml(kelas)}</div>`, 
    html: `
    <div class="text-left text-sm text-slate-300 mt-2 bg-black/30 p-4 rounded border border-white/10 shadow-inner">
    
        <p class="mb-1 text-[10px] uppercase tracking-wider text-slate-500 font-bold">Wali Kelas</p>
        <p class="font-bold text-white"><i class="fa-solid fa-user-tie text-green-400"></i> ${escapeHtml(namaWali)}</p>
        <p class="text-xs text-green-300 mb-4">${linkWA(hpWali, `Assalamualaikum Bapak/Ibu ${namaWali}, wali kelas ${kelas}.`)}</p>
        
        <p class="mb-1 text-[10px] uppercase tracking-wider text-slate-500 font-bold">Pengurus</p>
        <p class="text-xs leading-relaxed mb-4">${pengurus}</p>
        
        <table class="w-full text-xs mt-2 border-t border-white/10 pt-2">
            <tr>
                <td class="py-1">Jumlah Siswa</td>
                <td class="py-1 text-right text-white font-bold">${listMuridKelas.length} Siswa</td>
            </tr>
        </table>
        
    </div>`, 
    background: '#1e293b', 
    color: '#fff', 
    confirmButtonText: 'Tutup' 
  });
}

// --- [REQ 4] BROADCAST WA ABSENSI ---
// --- [UPDATE] checklist target, rentang hari bebas, status D, preview editable + template ---
function muatTemplateWA() {
  const t = localStorage.getItem('sisip_wa_template');
  const el = document.getElementById('wa_preview');
  if (el && t) el.value = t;
  else showToast('info', 'Belum ada template tersimpan');
}

/** Ambil data absensi dari DB untuk rentang SEMESTER / HARI terpilih. */
async function ambilAbsenRentangWA(mode, daftarHari) {
  const mapelRaw = document.getElementById('select-mapel').value || "";
  const mapel = mapelRaw.includes('|') ? mapelRaw.split('|')[1] : mapelRaw;
  const kelas = document.getElementById('select-kelas').value || "";
  const parts = String(currentTahun || '').split('/');
  const arrB = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  const idx = arrB.indexOf(currentBulan);
  let tglAwal, tglAkhir;
  if (mode === 'SEMESTER') {
    const ganjil = idx >= 6;
    if (ganjil) { tglAwal = `${parts[0]}-07-01`; tglAkhir = `${parts[0]}-12-31`; }
    else { const th = parts[1] || parts[0]; tglAwal = `${th}-01-01`; tglAkhir = `${th}-06-30`; }
  } else {
    const tahunAktual = (idx >= 6) ? parts[0] : (parts[1] || parts[0]);
    const last = new Date(parseInt(tahunAktual, 10), idx + 1, 0).getDate();
    tglAwal = `${tahunAktual}-${String(idx + 1).padStart(2, '0')}-01`;
    tglAkhir = `${tahunAktual}-${String(idx + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  }
  let q = supaClient.from('absensi').select('nis, tanggal, status')
    .eq('mapel', mapel).gte('tanggal', tglAwal).lte('tanggal', tglAkhir);
  if (kelas && kelas !== 'Semua Kelas') q = q.eq('kelas', kelas);
  const { data, error } = await q;
  if (error) throw error;
  let rows = (data || []).map(a => ({ "NIS": a.nis, "Tanggal": a.tanggal, "Status": a.status }));
  if (mode === 'HARI') rows = rows.filter(r => daftarHari.includes(hariDariTanggal(r.Tanggal)));
  return rows;
}

function shareKehadiranWA() {
    const chkSiswa = listMuridKelas.map(m => {
        const nis = String(m.NIS || m.nis || '');
        const nama = m.nama || m["Nama Lengkap"] || m.Nama || '';
        return `<label class="flex items-center gap-1.5 cursor-pointer bg-slate-800 p-1.5 rounded border border-white/10"><input type="checkbox" class="wa_tgt" value="${escJs(nis)}"><span class="truncate text-[11px]">${escapeHtml(nama)}</span></label>`;
    }).join('');

    Swal.fire({
        title: '<div class="text-base font-bold text-green-400"><i class="fa-brands fa-whatsapp"></i> Broadcast Kehadiran</div>',
        html: `
          <div class="text-left text-sm text-slate-300">
            <label class="block text-[10px] font-bold mb-1 text-blue-300">Target Siswa</label>
            <label class="flex items-center gap-1.5 text-xs mb-1.5 cursor-pointer"><input type="checkbox" id="wa_tgt_semua" checked onchange="document.querySelectorAll('.wa_tgt').forEach(c => c.checked = this.checked)"> Kirim ke semua siswa</label>
            <div class="grid grid-cols-2 gap-1.5 max-h-32 overflow-y-auto mb-3 bg-black/20 p-2 rounded border border-white/10 custom-scrollbar">${chkSiswa}</div>

            <label class="block text-[10px] font-bold mb-1 text-blue-300">Rentang Waktu Laporan</label>
            <select id="wa_abs_waktu" class="w-full bg-slate-700 rounded px-2 py-1.5 text-xs text-white mb-2 outline-none" onchange="document.getElementById('wa_abs_hari_wrap').classList.toggle('hidden', this.value !== 'HARI')">
                <option value="BULAN">Bulan Ini Saja (${currentBulan})</option>
                <option value="SEMESTER">Satu Semester</option>
                <option value="HARI">Pilih Hari Tertentu</option>
            </select>
            <div id="wa_abs_hari_wrap" class="hidden mb-3">
                <input id="wa_abs_hari" placeholder="Cth: 1, 3-5, 8 dan 10" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 text-xs text-white outline-none">
                <p class="text-[9px] text-slate-400 mt-1">Pisah dengan koma; rentang pakai "-" / "sampai" / "antara"; gabung dengan "dan".</p>
            </div>

            <label class="block text-[10px] font-bold mb-1 text-blue-300">Filter Status (Ceklis yang akan dilaporkan)</label>
            <div class="flex gap-2 flex-wrap mb-2 text-xs bg-slate-700 p-2 rounded">
                <label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" class="wa_chk_sts" value="A" checked> Alpa (A)</label>
                <label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" class="wa_chk_sts" value="I" checked> Izin (I)</label>
                <label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" class="wa_chk_sts" value="S" checked> Sakit (S)</label>
                <label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" class="wa_chk_sts" value="D" checked> Dispen (D)</label>
                <label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" class="wa_chk_sts" value="H"> Hadir (H)</label>
            </div>
          </div>
        `,
        background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonText: 'Buat Pesan',
        preConfirm: () => {
            const popup = Swal.getPopup();
            const semua = popup.querySelector('#wa_tgt_semua').checked;
            const targets = [...popup.querySelectorAll('.wa_tgt:checked')].map(c => c.value);
            const waktu = popup.querySelector('#wa_abs_waktu').value;
            const hariInput = popup.querySelector('#wa_abs_hari') ? popup.querySelector('#wa_abs_hari').value : '';
            let sts = []; popup.querySelectorAll('.wa_chk_sts:checked').forEach(c => sts.push(c.value));
            if (!semua && targets.length === 0) { Swal.showValidationMessage('Pilih minimal 1 siswa target.'); return false; }
            if (sts.length === 0) { Swal.showValidationMessage('Pilih minimal 1 kategori status.'); return false; }
            if (waktu === 'HARI' && parseDaftarHari(hariInput).length === 0) { Swal.showValidationMessage('Isi daftar hari yang valid.'); return false; }
            return { semua, targets, waktu, hari: parseDaftarHari(hariInput), sts };
        }
    }).then(async (res) => {
        if (!res.isConfirmed) return;
        const { semua, targets, waktu, hari, sts } = res.value;
        Swal.fire({ title: 'Menyiapkan Pesan...', allowOutsideClick: false, didOpen: () => Swal.showLoading(), background: '#1e293b', color: '#fff' });
        try {
            const mapelRaw = document.getElementById('select-mapel').value || "";
            const mapel = mapelRaw.includes('|') ? mapelRaw.split('|')[1] : mapelRaw;
            let absenDb = rawAbsenData;
            if (waktu !== 'BULAN') absenDb = await ambilAbsenRentangWA(waktu, hari);

            const labelWaktu = waktu === 'BULAN'
              ? currentBulan
              : (waktu === 'SEMESTER'
                ? `Semester ${(['Juli','Agustus','September','Oktober','November','Desember'].includes(currentBulan)) ? 'Ganjil' : 'Genap'} (${currentTahun})`
                : `Hari: ${hari.join(', ')}`);

            let textWA = `*INFORMASI KEHADIRAN SISWA*\nMapel: ${mapel}\nRentang Waktu: ${labelWaktu}\n\n`;

            listMuridKelas.forEach((m) => {
                let nis = String(m.NIS || m.nis);
                let nama = m.nama || m["Nama Lengkap"] || m.Nama;
                if (!semua && !targets.includes(nis)) return;

                const absenSiswa = absenDb.filter(a => String(a.NIS) === nis);
                const tH = absenSiswa.filter(a => a.Status === 'H').length;
                const tS = absenSiswa.filter(a => a.Status === 'S').length;
                const tI = absenSiswa.filter(a => a.Status === 'I').length;
                const tA = absenSiswa.filter(a => a.Status === 'A').length;
                const tD = absenSiswa.filter(a => a.Status === 'D').length;

                let catat = [];
                if(sts.includes('A') && tA > 0) catat.push(`Alpa: ${tA}`);
                if(sts.includes('I') && tI > 0) catat.push(`Izin: ${tI}`);
                if(sts.includes('S') && tS > 0) catat.push(`Sakit: ${tS}`);
                if(sts.includes('D') && tD > 0) catat.push(`Dispen: ${tD}`);
                if(sts.includes('H') && tH > 0) catat.push(`Hadir: ${tH}`);

                if(catat.length > 0) {
                    textWA += `*${nama}*\n~> ${catat.join(' | ')}\n\n`;
                }
            });

            textWA += `_Demikian laporan kehadiran ini disampaikan. Mohon perhatiannya._`;

            Swal.fire({
                title: '<i class="fa-brands fa-whatsapp"></i> Preview Pesan',
                html: `
                  <textarea id="wa_preview" class="w-full h-52 bg-black/40 border border-white/20 rounded p-2 text-xs text-white outline-none custom-scrollbar">${escapeHtml(textWA)}</textarea>
                  <button type="button" onclick="muatTemplateWA()" class="mt-2 w-full bg-slate-700 hover:bg-slate-600 text-slate-200 rounded px-2 py-1.5 text-[10px] font-bold transition"><i class="fa-solid fa-file-lines"></i> Muat Template Tersimpan</button>`,
                background: '#1e293b', color: '#fff',
                showDenyButton: true,
                denyButtonText: '<i class="fa-solid fa-save"></i> Simpan Template',
                showCancelButton: true, cancelButtonText: 'Batal',
                confirmButtonText: '<i class="fa-brands fa-whatsapp"></i> Kirim via WA',
                preConfirm: () => (document.getElementById('wa_preview') ? document.getElementById('wa_preview').value : textWA)
            }).then((resWa) => {
                if (resWa.isDenied) {
                    const el = document.getElementById('wa_preview');
                    localStorage.setItem('sisip_wa_template', el ? el.value : textWA);
                    showToast('success', 'Template pesan tersimpan');
                    return;
                }
                if(resWa.isConfirmed) {
                    const teks = resWa.value || textWA;
                    window.open(`https://wa.me/?text=${encodeURIComponent(teks)}`, '_blank');
                }
            });
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Gagal', text: e.message || 'Gagal menyiapkan laporan.', background: '#1e293b', color: '#fff' });
        }
    });
}

// --- MODUL IMPORT EXCEL ABSENSI ---
function openImportExcelAbsen() {
  Swal.fire({
    title: '<div class="text-base font-bold text-teal-400"><i class="fa-solid fa-file-excel"></i> Import Data Absensi</div>',
    html: `
      <div class="text-sm text-slate-300 mb-4 text-left">
        1. Unduh template format kehadiran di bawah ini.<br>
        2. Isi kode (H, S, I, A) pada Excel.<br>
        3. Upload kembali file yang sudah diisi ke sini.
      </div>
      <button onclick="downloadTemplateExcelAbsen()" class="w-full mb-4 bg-teal-600 hover:bg-teal-700 text-white px-3 py-2 rounded shadow-md text-xs font-bold transition"><i class="fa-solid fa-download"></i> Download Format Kehadiran</button>
      <div class="border-t border-white/20 pt-4">
          <label class="block text-left text-[10px] font-bold text-teal-300 mb-1">Upload File Excel (.xlsx)</label>
          <input type="file" id="file-import-absen" accept=".xlsx, .xls" class="w-full bg-black/40 border border-white/20 rounded p-2 text-xs text-white outline-none focus:border-teal-500">
      </div>
    `,
    background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonText: '<i class="fa-solid fa-upload"></i> Proses Import',
    preConfirm: () => {
        const file = document.getElementById('file-import-absen').files[0];
        if(!file) { Swal.showValidationMessage('Pilih file Excel terlebih dahulu!'); return false; }
        return file;
    }
  }).then(res => {
      if(res.isConfirmed) prosesImportDataExcelAbsen(res.value);
  });
}

function downloadTemplateExcelAbsen() {
    if (typeof XLSX === 'undefined') return Swal.fire('Error', 'Library SheetJS tidak ditemukan.', 'error');
    
    const tahun = document.getElementById('select-tahun').value;
    const bulan = document.getElementById('select-bulan').value;
    const smt = ['Juli','Agustus','September','Oktober','November','Desember'].includes(bulan) ? 'Ganjil' : 'Genap';
    const mapelRaw = document.getElementById('select-mapel').value;
    const mapel = mapelRaw.includes('|') ? mapelRaw.split('|')[1] : mapelRaw;
    const kelas = document.getElementById('select-kelas').value;
    
    let headers = ["No", "NIS", "Nama Siswa"];
    for(let i=1; i<=31; i++) headers.push(`Tgl_${i}`);
    headers.push("Keterangan");

    let dataRows = [
        ["FORMAT IMPORT ABSENSI", "Hadir Tatap Muka"],
        ["Tahun", tahun], ["Semester", smt], ["Bulan", bulan],
        ["Mapel", mapel], ["Kelas", kelas],
        ["INFO", "Isi nilai H (Hadir), S (Sakit), I (Izin), A (Alpa), D (Dispen)"],
        headers
    ];
    
    listMuridKelas.forEach((m, idx) => {
        let row = [idx + 1, m.nis, m.nama];
        for(let i=1; i<=31; i++) {
            let el = document.getElementById(`A_${m.nis}_${i}`);
            row.push(el ? el.value : "");
        }
        let elKet = document.getElementById(`Ket_${m.nis}`);
        row.push(elKet ? elKet.value : "");
        dataRows.push(row);
    });

    const ws = XLSX.utils.aoa_to_sheet(dataRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template_Absensi");
    XLSX.writeFile(wb, `Absensi_${bulan}_${kelas}_${mapel}.xlsx`);
}

function prosesImportDataExcelAbsen(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const ws = workbook.Sheets[workbook.SheetNames[0]];
            const jsonArray = XLSX.utils.sheet_to_json(ws, {header: 1}); 

            if(jsonArray.length < 8) throw new Error("Format tidak dikenali.");
            
            const tTahun = jsonArray[1][1]; const tSmt = jsonArray[2][1]; const tBulan = jsonArray[3][1];
            const tMapel = jsonArray[4][1]; const tKelas = jsonArray[5][1];
            
            const vTahun = document.getElementById('select-tahun').value;
            const vBulan = document.getElementById('select-bulan').value;
            const vSmt = ['Juli','Agustus','September','Oktober','November','Desember'].includes(vBulan) ? 'Ganjil' : 'Genap';
            const vMapelRaw = document.getElementById('select-mapel').value;
            const vMapel = vMapelRaw.includes('|') ? vMapelRaw.split('|')[1] : vMapelRaw;
            const vKelas = document.getElementById('select-kelas').value;

            let warningMsg = "";
            if(tTahun != vTahun) warningMsg += `<br>- Tahun (File: ${tTahun})`;
            if(tSmt != vSmt) warningMsg += `<br>- Smt (File: ${tSmt})`;
            if(tBulan != vBulan) warningMsg += `<br>- Bulan (File: ${tBulan})`;
            if(tMapel != vMapel) warningMsg += `<br>- Mapel (File: ${tMapel})`;
            if(tKelas != vKelas) warningMsg += `<br>- Kelas (File: ${tKelas})`;
            
            const eksekusiData = () => {
                const headers = jsonArray[7];
                let countImport = 0;
                
                for(let i=8; i<jsonArray.length; i++) {
                    let row = jsonArray[i];
                    if(!row || !row[1]) continue; 
                    let nis = row[1].toString();
                    
                    const tr = document.getElementById(`row-murid-${nis}`);
                    if(tr || listMuridKelas.find(m => String(m.nis) === nis)) {
                        for(let j=3; j<headers.length; j++) {
                            let hk = headers[j];
                            if(!hk) continue;
                            let val = row[j] ? row[j].toString().toUpperCase() : "";
                            
                            let targetId = hk === "Keterangan" ? `Ket_${nis}` : `A_${nis}_${hk.split('_')[1]}`;
                            let inputEl = document.getElementById(targetId);
                            
                            if(inputEl) {
                                if(targetId.startsWith('A_') && val !== "" && !['H','S','I','A','D'].includes(val)) val = "";
                                inputEl.value = val;
                            }
                        }
                        if(typeof kalkulasiAbsen === 'function') kalkulasiAbsen(nis, true);
                        countImport++;
                    }
                }
                Swal.fire('Sukses', `${countImport} data absensi berhasil diinput. Menyimpan...`, 'success');
                setTimeout(() => { if(typeof forceSyncSemuaAbsensi === 'function') forceSyncSemuaAbsensi(); }, 1500);
            };

            if(warningMsg !== "") {
                Swal.fire({
                    title: 'Data Sinkronisasi Berbeda!',
                    html: `Ketidakcocokan file dengan kelas/bulan yang dibuka: ${warningMsg}<br><br><b>Tetap lanjutkan paksa import?</b>`,
                    icon: 'warning', showCancelButton: true, confirmButtonText: 'Ya, Paksa', cancelButtonText: 'Batal', background: '#1e293b', color: '#fff'
                }).then((r) => { if(r.isConfirmed) eksekusiData(); });
            } else eksekusiData();
        } catch(err) {
            Swal.fire('Error Import', err.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

// ==========================================
// 6. MODUL INPUT NILAI - PENGETAHUAN (STABIL & INTERAKTIF)
// ==========================================
let currentKategoriNilai = "Data Nilai Pengetahuan"; 
let currentSemesterNilai = "Ganjil"; 
let configNilaiAktif = null; 
let rawDataNilai = [];
let showNamaSiswaNilai = true; 
let undoStackNilai = [];
let redoStackNilai = [];
// Cache Nilai Akhir pasangan (Pengetahuan/Keterampilan) untuk Sumatif gabungan: { [nis]: {p, k} }
let cacheNilaiPasangan = {};
// Kelas yang diampu guru (wali + jadwal mapel terpilih) & jadwal guru (modul Nilai)
let cacheKelasDiampuGuru = new Set();
let cacheJadwalGuru = [];
let cacheListKelasNilai = [];
// Rating teman sejawat (kategori Sikap): { [nisTarget]: [skor, skor, ...] }
let cacheTemanSejawat = {};
// Urutan tampil kolom "Nama Siswa" tabel Nilai: '' (default) | 'az' | 'za'
let sortNamaNilai = '';
/** Daftar murid sesuai urutan tampil (default / A-Z / Z-A). */
function urutMuridTampil() {
  const arr = [...listMuridKelas];
  if (sortNamaNilai === 'az') arr.sort((a, b) => String(a["Nama Lengkap"]).localeCompare(String(b["Nama Lengkap"]), 'id'));
  else if (sortNamaNilai === 'za') arr.sort((a, b) => String(b["Nama Lengkap"]).localeCompare(String(a["Nama Lengkap"]), 'id'));
  return arr;
}
/** Siklus urut nama: default → A-Z → Z-A → default, lalu render ulang tabel aktif. */
function siklusUrutNamaNilai() {
  sortNamaNilai = sortNamaNilai === 'az' ? 'za' : (sortNamaNilai === 'za' ? '' : 'az');
  if (currentKategoriNilai === "Data Nilai Pengetahuan") renderTabelPengetahuan();
  else if (currentKategoriNilai === "Data Nilai Keterampilan") renderTabelKeterampilan();
  else if (currentKategoriNilai === "Data Nilai Sikap") renderTabelSikap();
  else if (currentKategoriNilai === "Data Nilai Eskul") renderTabelEskul();
}
/** Ikon tombol urut nama pada header "Nama Siswa". */
function ikonUrutNamaNilai() {
  if (sortNamaNilai === 'az') return '<i class="fa-solid fa-arrow-down-a-z text-green-400" title="Urut A-Z (klik: Z-A)"></i>';
  if (sortNamaNilai === 'za') return '<i class="fa-solid fa-arrow-up-a-z text-red-400" title="Urut Z-A (klik: default)"></i>';
  return '<i class="fa-solid fa-sort text-slate-400" title="Urutkan Nama (klik: A-Z)"></i>';
}
const LETTERS_KD = ['A','B','C','D','E','F','G','H'];

const hitungPredikat = (nilai) => {
  if (nilai === "" || nilai === null || isNaN(nilai)) return "-";
  const n = Number(nilai); if (n >= 91) return "A"; if (n >= 81) return "B"; if (n >= 71) return "C"; return "D";
};

// ---------- NILAI DESKRIPSI RAPORT (SUMATIF & CAPAIAN) ----------
/** Default konfigurasi deskripsi raport per jenis. */
const DEFAULT_DESKRIPSI_RAPORT = {
  sumatif: {
    mode: 'rata-rata',
    batas: 80,
    bobot_p: 50,
    bobot_k: 50,
    teks_tinggi: 'TP Yang diukur dan Tercapai dengan Optimal',
    teks_rendah: 'TP yang diukur dan Perlu Peningkatan'
  },
  capaian: {
    batas: 80,
    teks_tinggi: 'Deskripsi Capaian Tertinggi',
    teks_rendah: 'Deskripsi Capaian Terendah'
  }
};

/** Ambil konfigurasi deskripsi raport aktif (config + default injection). */
function cfgDeskripsiRaport() {
  const d = (configNilaiAktif && configNilaiAktif.deskripsi_raport) || {};
  const s = d.sumatif || {};
  const c = d.capaian || {};
  return {
    sumatif: {
      mode: s.mode === 'manual' ? 'manual' : 'rata-rata',
      batas: (s.batas === 0 || s.batas) ? Number(s.batas) : 80,
      bobot_p: (s.bobot_p === 0 || s.bobot_p) ? Number(s.bobot_p) : 50,
      bobot_k: (s.bobot_k === 0 || s.bobot_k) ? Number(s.bobot_k) : 50,
      teks_tinggi: s.teks_tinggi || 'TP Yang diukur dan Tercapai dengan Optimal',
      teks_rendah: s.teks_rendah || 'TP yang diukur dan Perlu Peningkatan'
    },
    capaian: {
      batas: (c.batas === 0 || c.batas) ? Number(c.batas) : 80,
      teks_tinggi: c.teks_tinggi || 'Deskripsi Capaian Tertinggi',
      teks_rendah: c.teks_rendah || 'Deskripsi Capaian Terendah'
    }
  };
}

/** Aturan deskripsi: nilai >= batas → teks_tinggi; nilai < batas → teks_rendah; kosong → "-". */
function hitungDeskripsiRaport(nilai, jenis, cfg = null) {
  if (nilai === "" || nilai === null || nilai === undefined || isNaN(Number(nilai))) return "-";
  const c = cfg || cfgDeskripsiRaport();
  const j = jenis === 'capaian' ? c.capaian : c.sumatif;
  return Number(nilai) >= Number(j.batas) ? (j.teks_tinggi || '-') : (j.teks_rendah || '-');
}

/** Nilai Sumatif gabungan = (NA Pengetahuan × Bobot P) + (NA Keterampilan × Bobot K), dibulatkan.
 *  nilaiKategoriAktif: NA kategori tabel yang sedang aktif (prioritas di atas cache pasangan).
 *  Salah satu kosong dihitung 0; keduanya kosong → "". */
function hitungSumatifGabungan(nis, nilaiKategoriAktif) {
  const cfg = cfgDeskripsiRaport().sumatif;
  const bp = (cfg.bobot_p === 0 || cfg.bobot_p) ? Number(cfg.bobot_p) : 50;
  const bk = (cfg.bobot_k === 0 || cfg.bobot_k) ? Number(cfg.bobot_k) : 50;
  const pasangan = cacheNilaiPasangan[String(nis)] || { p: "", k: "" };
  const isPengetahuan = currentKategoriNilai === "Data Nilai Pengetahuan";
  const p = isPengetahuan ? nilaiKategoriAktif : pasangan.p;
  const k = isPengetahuan ? pasangan.k : nilaiKategoriAktif;
  const kosong = (v) => v === "" || v === null || v === undefined || isNaN(Number(v));
  if (kosong(p) && kosong(k)) return "";
  return Math.round((kosong(p) ? 0 : Number(p)) * bp / 100 + (kosong(k) ? 0 : Number(k)) * bk / 100);
}

// ---------- SIKAP: TEMAN SEJAWAT & JURNAL PENILAIAN SIKAP ----------
/** Konfigurasi teman sejawat + kriteria skor 1-4 + bobot NA (config JSONB per kategori+mapel). */
function cfgSikapTeman() {
  const d = (configNilaiAktif && configNilaiAktif.sikap_teman) || {};
  const kr = d.kriteria || {};
  const bb = d.bobot || {};
  const jml = (d.jumlah_teman === 0 || d.jumlah_teman) ? Math.min(5, Math.max(1, Number(d.jumlah_teman))) : 5;
  const pct = (v) => (v === 0 || v) ? Math.max(0, Number(v)) : 25;
  return {
    judul: d.judul || 'Berilah nilai untuk 5 teman',
    keterangan: d.keterangan || 'Penilaian sikap oleh teman sejawat menggunakan skala 1-4 sesuai kriteria yang tertera.',
    jumlah_teman: jml,
    sesi_buka: !!d.sesi_buka,
    sesi_tahun: d.sesi_tahun || '',
    sesi_semester: d.sesi_semester || '',
    bobot: { obs: pct(bb.obs), diri: pct(bb.diri), teman: pct(bb.teman), jurnal: pct(bb.jurnal) },
    kriteria: {
      4: kr['4'] || kr[4] || 'Selalu konsisten dilakukan',
      3: kr['3'] || kr[3] || 'Sering dilakukan',
      2: kr['2'] || kr[2] || 'Kadang-kadang dilakukan',
      1: kr['1'] || kr[1] || 'Tidak pernah dilakukan'
    }
  };
}

/** Deskripsi karakter Kurikulum Merdeka dari modus 1-4 (=IF(H5=4,"Sangat Baik (SB)",...)). */
const DESKRIPSI_MODUS = { 4: 'Sangat Baik (SB)', 3: 'Baik (B)', 2: 'Cukup (C)', 1: 'Kurang (K)' };

/** Konversi nilai 0-100 → skor 1-4: 80-100=4, 60-79=3, 40-59=2, <40=1. */
function konversiSkor1to4(nilai) {
  if (nilai === "" || nilai === null || nilai === undefined || isNaN(Number(nilai))) return "";
  const n = Number(nilai);
  if (n >= 80) return 4;
  if (n >= 60) return 3;
  if (n >= 40) return 2;
  return 1;
}

/** Deskripsi Capaian Sikap 4 tingkat: teks = kriteria skor hasil konversi NA (dapat diedit di Jurnal Penilaian Sikap). */
function hitungDeskripsiCapaianSikap(nilai) {
  const skor = konversiSkor1to4(nilai);
  if (!skor) return "-";
  return cfgSikapTeman().kriteria[skor] || '-';
}

/** Modus ala Excel MODE.SNGL: nilai terbanyak; bila seri → yang pertama muncul di data. */
function hitungModusTeman(arr) {
  if (!arr || !arr.length) return "";
  const counts = {};
  arr.forEach(v => { const n = Number(v); counts[n] = (counts[n] || 0) + 1; });
  const maxCount = Math.max(...Object.values(counts));
  for (const v of arr) {
    if (counts[Number(v)] === maxCount) return Number(v);
  }
  return "";
}

/** Hasil agregat rating teman sejawat untuk satu siswa (target) dari cacheTemanSejawat.
 *  rata: rata-rata rating skala 1-4 (1 desimal); persen: (total ÷ maks) × 100. */
function hitungHasilTemanSejawat(nis) {
  const arr = cacheTemanSejawat[String(nis)] || [];
  if (!arr.length) return { rata: "", modus: "", desk: "-", persen: "", jumlahPenilai: 0 };
  const rata = arr.reduce((a, b) => a + Number(b), 0) / arr.length;
  const modus = hitungModusTeman(arr);
  return {
    rata: Math.round(rata * 10) / 10,
    modus,
    desk: DESKRIPSI_MODUS[modus] || '-',
    persen: Math.round((arr.reduce((a, b) => a + Number(b), 0) / (arr.length * 4)) * 100),
    jumlahPenilai: arr.length
  };
}

/** Derive "Nilai Raport" + deskripsi otomatis (tanpa menimpa override manual) untuk satu siswa.
 *  rptSuffix: suffix id sel label (RPT_); nrSuffix: suffix id input manual (NR_) atau null bila tak ada. */
function deriveNilaiRaport(nis, rptSuffix, nrSuffix, sumberNilai, jenis) {
  const cfg = cfgDeskripsiRaport();
  const keyDesk = jenis === 'capaian' ? 'Deskripsi Capaian' : 'Deskripsi Sumatif';
  const keyMan = keyDesk + ' Manual';
  const modeManual = jenis !== 'capaian' && cfg.sumatif.mode === 'manual';
  let nilaiRaport = sumberNilai;
  if (modeManual && nrSuffix) {
    const nrEl = document.getElementById(`NR_${nis}_${nrSuffix}`);
    if (nrEl && nrEl.value !== '') nilaiRaport = Number(nrEl.value);
  }
  const rptEl = document.getElementById(`RPT_${nis}_${rptSuffix}`);
  if (rptEl) { rptEl.innerText = nilaiRaport; updateWarnaEl(`RPT_${nis}_${rptSuffix}`, nilaiRaport); }
  const rowLama = rawDataNilai.find(d => String(d.NIS) === String(nis) || String(d.nis) === String(nis));
  const isManual = !!(rowLama && rowLama[keyMan]);
  // Capaian (Sikap): 4 tingkat kriteria skor (80-100=4, 60-79=3, 40-59=2, <40=1); lainnya: 2 tingkat batas
  const dsc = jenis === 'capaian' ? hitungDeskripsiCapaianSikap(nilaiRaport) : hitungDeskripsiRaport(nilaiRaport, jenis, cfg);
  const updates = { "Nilai Raport": nilaiRaport, [keyDesk]: isManual ? (rowLama[keyDesk] || dsc) : dsc, [keyMan]: isManual };
  if (rowLama) { Object.assign(rowLama, updates); }
  return updates;
}

/** Handler onblur kolom Nilai Raport (mode Isian Persentase) — simpan + hitung deskripsi. */
function onNilaiRaportManual(nis, kategori) {
  const rptSuffix = kategori === 'keterampilan' ? 'AkhirKet' : 'NilaiAkhir';
  const nrSuffix = kategori === 'keterampilan' ? 'AkhirKet' : 'NilaiRaport';
  const rowLama = rawDataNilai.find(d => String(d.NIS) === String(nis) || String(d.nis) === String(nis));
  const sumber = rowLama ? rowLama["Nilai Akhir Raport"] : '';
  const updates = deriveNilaiRaport(nis, rptSuffix, nrSuffix, sumber, 'sumatif');
  silentSaveNilai(nis, updates);
}

/** Popup icon Deskripsi: lihat & edit teks deskripsi Sumatif/Capaian per siswa (req 2). */
function popupDeskripsiRaport(nis) {
  const jenis = currentKategoriNilai === "Data Nilai Sikap" ? 'capaian' : 'sumatif';
  const keyDesk = jenis === 'capaian' ? 'Deskripsi Capaian' : 'Deskripsi Sumatif';
  const keyMan = keyDesk + ' Manual';
  const cfg = cfgDeskripsiRaport();
  const cari = d => String(d.NIS) === String(nis) || String(d.nis) === String(nis);
  const row = rawDataNilai.find(cari) || {};
  const m = listMuridKelas.find(x => String(x.NIS) === String(nis));
  const nama = m ? (m["Nama Lengkap"] || nis) : nis;

  let sumber = '';
  if (jenis === 'capaian') {
    const el = document.getElementById(`LBL_${nis}_AkhirSikap`);
    sumber = (el && el.innerText !== '') ? el.innerText : (row["Nilai Akhir Raport"] ?? '');
  } else {
    const idSuffix = currentKategoriNilai === "Data Nilai Keterampilan" ? 'AkhirKet' : 'NilaiAkhir';
    const el = document.getElementById(`LBL_${nis}_${idSuffix}`);
    const naAktif = (el && el.innerText !== '') ? el.innerText : (row["Nilai Akhir Raport"] ?? '');
    sumber = hitungSumatifGabungan(nis, naAktif);
  }

  const dscAuto = jenis === 'capaian' ? hitungDeskripsiCapaianSikap(sumber) : hitungDeskripsiRaport(sumber, jenis, cfg);
  const tersimpan = row[keyDesk];
  const dscTampil = (tersimpan && tersimpan !== '-') ? tersimpan : dscAuto;
  const isManual = !!row[keyMan];
  const labelSumber = jenis === 'capaian'
    ? 'Nilai Akhir Sikap (kalkulasi otomatis berbobot)'
    : (cfg.sumatif.mode === 'manual' ? 'Isian Persentase (input manual)' : 'Gabungan Nilai Akhir Pengetahuan & Keterampilan');
  const jDesk = jenis === 'capaian' ? cfg.capaian : cfg.sumatif;

  Swal.fire({
    title: `<i class="fa-solid fa-file-lines text-indigo-400"></i> Deskripsi ${jenis === 'capaian' ? 'Capaian' : 'Sumatif'}`,
    html: `
      <div class="text-left text-[11px] text-slate-300 mt-2">
        <div class="bg-black/30 border border-white/10 rounded p-2 mb-2 text-[10px]">
          <div class="font-bold text-white">${escapeHtml(nama)}</div>
          <div class="mt-1">Sumber Nilai: <b class="text-green-300">${escapeHtml(String(sumber) === '' ? '-' : String(sumber))}</b> <span class="text-slate-500">(${escapeHtml(labelSumber)})</span></div>
          <div>${jenis === 'capaian'
            ? 'Konversi skor 1-4: <b class="text-yellow-300">80-100=4, 60-79=3, 40-59=2, &lt;40=1</b> — teks deskripsi mengikuti kriteria skor (diedit di "Jurnal Penilaian Sikap")'
            : `Batas: <b class="text-yellow-300">${jDesk.batas}</b> — nilai ≥ batas → "Tercapai Optimal/Tertinggi", &lt; batas → "Perlu Peningkatan/Terendah"`}</div>
          <div class="mt-1">Hasil otomatis: <b class="text-indigo-300">${escapeHtml(dscAuto)}</b> ${isManual ? '<span class="text-[9px] bg-purple-900/50 text-purple-300 px-1 py-0.5 rounded">DIEDIT MANUAL</span>' : '<span class="text-[9px] bg-green-900/50 text-green-300 px-1 py-0.5 rounded">OTOMATIS</span>'}</div>
        </div>
        <label class="font-bold text-yellow-300">Teks Deskripsi (dapat diedit)</label>
        <textarea id="desc_raport_txt" rows="3" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-[11px] text-white outline-none">${escapeHtml(dscTampil)}</textarea>
        <button type="button" onclick="document.getElementById('desc_raport_txt').value = window.__dscAutoRaport" class="mt-1 bg-slate-600/40 hover:bg-slate-600 text-slate-300 hover:text-white px-2 py-1 rounded text-[10px] font-bold transition"><i class="fa-solid fa-rotate-left"></i> Kembalikan Otomatis</button>
      </div>`,
    didOpen: () => { window.__dscAutoRaport = dscAuto; },
    background: '#1e293b', color: '#fff', showCancelButton: true, cancelButtonText: 'Batal',
    confirmButtonText: '<i class="fa-solid fa-save"></i> Simpan',
    preConfirm: () => document.getElementById('desc_raport_txt').value.trim()
  }).then((res) => {
    if (!res.isConfirmed) return;
    const teks = res.value || '';
    const updates = {};
    updates[keyDesk] = teks || dscAuto;
    updates[keyMan] = teks !== dscAuto;
    const rowLama = rawDataNilai.find(cari);
    if (rowLama) Object.assign(rowLama, updates);
    silentSaveNilai(nis, updates);
    showToast('success', 'Deskripsi tersimpan');
  });
}

async function renderNilaiModule(container) {
  const user = currentUser.user || {}; 
  const role = currentUser.role;
  container.innerHTML = `<div class="p-6 text-center text-slate-300"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>Menyiapkan Modul Nilai...</div>`;

  // 1. Ambil Data Master untuk Filter
  if (masterDataCache.length === 0) {
    try {
        const { data, error } = await supaClient.from('master_data').select('*');
        if (!error && data) masterDataCache = data;
    } catch (e) {
        console.error("Gagal memuat master data", e);
    }
}
    
  let listTahun = [...new Set(masterDataCache.map(m => m["Tahun Pelajaran"]).filter(Boolean))];
  let listKelas = urutAz([...new Set(masterDataCache.map(m => m["Tingkat/Kelas"]).filter(Boolean))]);
  
  // Mengisi Cache Global dan Mendeklarasikan listActiveDropdown
  cacheListMapel = urutAz(role === 'admin' 
    ? [...new Set(masterDataCache.map(m => m["Mata Pelajaran"]).filter(Boolean))] 
    : (user["Custom Teks Mata Pelajaran"] || "").split(',').map(m => m.trim()).filter(Boolean));

  cacheListEkskul = await ambilDaftarEkskul();

  let listActiveDropdown = currentKategoriNilai === "Data Nilai Eskul" ? cacheListEkskul : cacheListMapel;

  // (e) Kelas diampu guru: wali kelas + jadwal_pelajaran guru tsb (tanda ★ & default kelas)
  cacheJadwalGuru = [];
  cacheListKelasNilai = listKelas;
  if (role === 'guru') {
    try {
      const { data: jdRows, error: jdErr } = await supaClient.from('jadwal_pelajaran').select('*');
      if (!jdErr && jdRows) cacheJadwalGuru = jdRows;
      else if (jdErr) console.warn('Gagal memuat jadwal pelajaran:', jdErr.message);
    } catch (e) { console.warn('jadwal_pelajaran:', e); }
  }
  cacheKelasDiampuGuru = hitungKelasDiampuGuru(listActiveDropdown[0] || "");

  // 2. Set Default Waktu Otomatis (Tahun Ajaran & Semester Saat Ini)
  const now = new Date();
  const curMonth = now.getMonth(); 
  const curYear = now.getFullYear();
  
  let defaultSemesterNilai = (curMonth >= 6) ? "Ganjil" : "Genap";
  let strTahunOtomatis = (curMonth >= 6) ? `${curYear}/${curYear+1}` : `${curYear-1}/${curYear}`;
  
  let defaultTahun = listTahun.includes(strTahunOtomatis) ? strTahunOtomatis : (listTahun[0] || strTahunOtomatis);
  if (role !== 'admin' && user["ID Tahun Pelajaran"]) {
    defaultTahun = user["ID Tahun Pelajaran"];
  }
  const prefNilai = getPreferensiSesi();
  if (prefNilai.tahun && listTahun.includes(prefNilai.tahun)) defaultTahun = prefNilai.tahun;
  if (prefNilai.semester === 'Ganjil' || prefNilai.semester === 'Genap') defaultSemesterNilai = prefNilai.semester;
  
  currentSemesterNilai = defaultSemesterNilai;
  if (!listTahun.includes(defaultTahun)) listTahun.push(defaultTahun);

  // 3. Render Struktur HTML Utama (Header, Filter Bar, dan Container Tabel)
  container.innerHTML = `
    <!-- LAYER 1: Filter Bar -->
    <div class="sticky top-0 z-40 p-2 rounded-b-2xl shadow-lg border-b border-white/10 bg-slate-800/90 w-full backdrop-blur-md flex flex-col gap-2">
      <div class="flex items-center justify-between gap-1 w-full">
        <div class="flex gap-1 sm:gap-2 flex-wrap items-center">
          
          <div class="relative w-7 h-7 sm:w-8 sm:h-8 group" title="Pilih Kategori">
             <div class="w-full h-full rounded-full bg-slate-700/50 border border-white/10 flex items-center justify-center text-blue-400 group-hover:bg-blue-500 group-hover:text-white transition shadow-sm"><i class="fa-solid fa-layer-group text-[10px] sm:text-xs"></i></div>
             <select id="select-kategori-nilai" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange="changeKategoriNilai()">
                 <option value="Data Nilai Pengetahuan" class="bg-slate-800 text-white" ${currentKategoriNilai === 'Data Nilai Pengetahuan' ? 'selected' : ''}>Pengetahuan</option>
                 <option value="Data Nilai Keterampilan" class="bg-slate-800 text-white" ${currentKategoriNilai === 'Data Nilai Keterampilan' ? 'selected' : ''}>Keterampilan</option>
                 <option value="Data Nilai Sikap" class="bg-slate-800 text-white" ${currentKategoriNilai === 'Data Nilai Sikap' ? 'selected' : ''}>Sikap</option>
                 <option value="Data Nilai Eskul" class="bg-slate-800 text-white" ${currentKategoriNilai === 'Data Nilai Eskul' ? 'selected' : ''}>Ekstrakurikuler</option>
             </select>
          </div>

          <div class="relative w-7 h-7 sm:w-8 sm:h-8 group" title="Pilih Tahun">
             <div class="w-full h-full rounded-full bg-slate-700/50 border border-white/10 flex items-center justify-center text-green-400 group-hover:bg-green-500 group-hover:text-white transition shadow-sm"><i class="fa-regular fa-calendar text-[10px] sm:text-xs"></i></div>
             <select id="select-tahun-nilai" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange="loadDataNilai()">
                 ${listTahun.map(t => `<option value="${t}" class="bg-slate-800 text-white" ${t===defaultTahun ? 'selected':''}>${t}</option>`).join('')}
             </select>
          </div>

          <div class="relative w-7 h-7 sm:w-8 sm:h-8 group" title="Pilih Semester">
             <div class="w-full h-full rounded-full bg-slate-700/50 border border-white/10 flex items-center justify-center text-teal-400 group-hover:bg-teal-500 group-hover:text-white transition shadow-sm"><i class="fa-solid fa-leaf text-[10px] sm:text-xs"></i></div>
             <select id="select-semester-nilai" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange="loadDataNilai()">
                 <option value="Ganjil" class="bg-slate-800 text-white" ${currentSemesterNilai === 'Ganjil' ? 'selected' : ''}>Ganjil</option>
                 <option value="Genap" class="bg-slate-800 text-white" ${currentSemesterNilai === 'Genap' ? 'selected' : ''}>Genap</option>
             </select>
          </div>

          <div class="relative w-7 h-7 sm:w-8 sm:h-8 group" title="Pilih Kelas">
             <div id="ikon-kelas-nilai" class="w-full h-full rounded-full bg-slate-700/50 border border-white/10 flex items-center justify-center text-pink-400 group-hover:bg-pink-500 group-hover:text-white transition shadow-sm"><i class="fa-solid fa-users text-[10px] sm:text-xs"></i></div>
             <select id="select-kelas-nilai" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange="loadDataNilai()">
                 ${opsiKelasNilaiHTML(listKelas, role, user)}
             </select>
          </div>

          <div class="relative w-7 h-7 sm:w-8 sm:h-8 group" title="Pilih Mapel / Ekstrakurikuler">
             <div class="w-full h-full rounded-full bg-slate-700/50 border border-white/10 flex items-center justify-center text-yellow-400 group-hover:bg-yellow-500 group-hover:text-white transition shadow-sm"><i class="fa-solid fa-book text-[10px] sm:text-xs"></i></div>
             <select id="select-mapel-nilai" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange="loadDataNilai()">
                 ${opsiMapelNilaiHTML(listActiveDropdown, role, user)}
             </select>
          </div>

        </div>

        <div class="flex gap-1 items-center flex-wrap justify-end">
          <button id="btn-undo" onclick="undoNilai()" class="w-6 h-6 sm:w-7 sm:h-7 bg-slate-700 hover:bg-slate-600 text-slate-400 rounded transition disabled:opacity-30" disabled title="Undo"><i class="fa-solid fa-rotate-left text-[9px] sm:text-[10px]"></i></button>
          <button id="btn-redo" onclick="redoNilai()" class="w-6 h-6 sm:w-7 sm:h-7 bg-slate-700 hover:bg-slate-600 text-slate-400 rounded transition disabled:opacity-30" disabled title="Redo"><i class="fa-solid fa-rotate-right text-[9px] sm:text-[10px]"></i></button>
          <span class="text-slate-600 px-0.5">|</span>
          <button onclick="openPenilaianMasal()" class="bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] sm:text-[10px] px-1.5 py-1.5 rounded flex items-center gap-1 transition" title="Input Masal"><i class="fa-solid fa-bolt"></i></button>
          <button onclick="showInfoKelas()" class="bg-blue-600 hover:bg-blue-700 text-white text-[9px] sm:text-[10px] px-1.5 py-1.5 rounded transition" title="Info Kelas & Pengurus"><i class="fa-solid fa-info-circle"></i></button>
          <button onclick="openPengaturanKolomNilai()" class="bg-purple-600 hover:bg-purple-700 text-white text-[9px] sm:text-[10px] px-1.5 py-1.5 rounded flex items-center gap-1 transition" title="Pengaturan Set Kolom"><i class="fa-solid fa-sliders"></i> <span class="hidden sm:inline">Set</span></button>
          
          <span class="text-slate-600 px-0.5">|</span>
          <button onclick="loadDataNilai()" class="bg-slate-600 hover:bg-slate-500 text-white text-[9px] sm:text-[10px] px-1.5 py-1.5 rounded transition" title="Refresh Data"><i class="fa-solid fa-rotate-right"></i></button>
          <button onclick="openImportExcel()" class="bg-teal-700 hover:bg-teal-600 text-white text-[9px] sm:text-[10px] px-1.5 py-1.5 rounded transition shadow-sm" title="Import Data Excel"><i class="fa-solid fa-file-import"></i></button>
          <button onclick="exportNilaiExcel()" class="bg-green-700 hover:bg-green-600 text-white text-[9px] sm:text-[10px] px-1.5 py-1.5 rounded transition" title="Export Laporan ke Excel"><i class="fa-solid fa-file-excel"></i></button>
          <button onclick="exportNilaiPDF()" class="bg-red-700 hover:bg-red-600 text-white text-[9px] sm:text-[10px] px-1.5 py-1.5 rounded transition" title="Cetak Laporan PDF"><i class="fa-solid fa-file-pdf"></i></button>
          <button onclick="forceSyncSemuaNilai()" class="bg-yellow-600 hover:bg-yellow-500 text-white text-[9px] sm:text-[10px] px-2 py-1.5 rounded flex items-center gap-1 font-bold transition shadow-md" title="Simpan Seluruh Perubahan ke Server"><i class="fa-solid fa-cloud-arrow-up"></i> <span class="hidden sm:inline">Simpan</span></button>
        </div>
      </div>
    </div>

    <!-- LAYER 2: Judul & Badges Dinamis -->
    <div class="text-center mb-4 pb-8 mt-4 px-2 relative z-0">
      <h3 class="text-sm sm:text-base font-extrabold text-white tracking-wider drop-shadow-md uppercase" id="lbl-judul-utama-nilai"><i class="fa-solid fa-star"></i> NILAI PENGETAHUAN</h3>
      <p class="text-[9px] sm:text-[10px] mt-1.5 flex flex-wrap justify-center gap-1.5 bg-slate-900/60 py-1 px-3 rounded-full inline-flex border border-white/20 shadow-inner" id="lbl-info-mapel-nilai"></p>
    </div>

    <!-- LAYER 3: Tabel Area -->
    <div class="relative z-50 bg-[#0f172a] rounded-xl border border-blue-500/30 shadow-[0_-15px_30px_rgba(0,0,0,0.7)] overflow-hidden mx-auto w-[99%] -mt-5 transition-all" style="min-height: 90vh;">
      <div class="w-full overflow-x-auto overflow-y-auto custom-scrollbar" style="max-height: 75vh; padding-bottom: 30px;">
        <table id="tabel-nilai" class="text-left w-full whitespace-nowrap" style="border-spacing: 0; border-collapse: separate;"></table>
      </div>
    </div>
  `;

  // (e) Default kelas = kelas diampu guru (★) pertama; segarkan tanda ★ & highlight ikon
  const selKelasNilai = document.getElementById('select-kelas-nilai');
  if (selKelasNilai && role === 'guru' && cacheKelasDiampuGuru.size > 0) {
    const dafKelas = [...selKelasNilai.options].map(o => o.value);
    const pilihKelas = [...cacheKelasDiampuGuru].filter(k => dafKelas.includes(k)).sort((a, b) => a.localeCompare(b, 'id'))[0];
    if (pilihKelas) selKelasNilai.value = pilihKelas;
  }
  perbaruiKelasDiampuGuru();

  // 4. Langsung eksekusi pemanggilan data tabel jika daftar Mapel tersedia
  if (cacheListMapel.length > 0 || cacheListEkskul.length > 0) {
    loadDataNilai();
  }
}

/** Simpan konfigurasi kategori nilai (KD/bobot) ke tabel nilai_konfigurasi.
 *  Mengembalikan objek mirip Response (json()) agar kompatibel dengan pemanggil lama. */
async function simpanKonfigurasiNilai(kategori, mapel, config) {
  const katMapel = kategori === "Data Nilai Eskul" ? "" : (mapel || "");
  const { error } = await supaClient.from('nilai_konfigurasi')
    .upsert({ kategori, mapel: katMapel, config: config || {}, updated_at: new Date().toISOString() },
            { onConflict: 'kategori,mapel' });
  if (error) throw error;
  return { json: async () => ({ status: 'success', message: 'Konfigurasi tersimpan' }) };
}

async function loadDataNilai() {
  const mapel = document.getElementById('select-mapel-nilai').value, kelas = document.getElementById('select-kelas-nilai').value;
  currentTahun = document.getElementById('select-tahun-nilai').value;
  currentSemesterNilai = document.getElementById('select-semester-nilai').value;
  // (e) Segarkan tanda ★ kelas diampu & highlight ikon mengikuti mapel terpilih
  perbaruiKelasDiampuGuru();
  const tableEl = document.getElementById('tabel-nilai');
  
  const elInfoMapel = document.getElementById('lbl-info-mapel-nilai');
  if(elInfoMapel) {
      elInfoMapel.innerHTML = `<span class="text-slate-300 font-bold"><i class="fa-regular fa-calendar"></i> Tahun: ${currentTahun}</span><span class="text-slate-600 hidden sm:inline">|</span><span class="text-green-400 font-bold"><i class="fa-solid fa-leaf"></i> Smt: ${currentSemesterNilai}</span><span class="text-slate-600 hidden sm:inline">|</span><span class="text-purple-400 font-bold"><i class="fa-solid fa-book"></i> Mapel: ${mapel}</span><span class="text-slate-600 hidden sm:inline">|</span><span class="text-pink-400 font-bold"><i class="fa-solid fa-users"></i> Kelas: ${kelas}</span>`;
  }
  
  // Update Judul Dinamis
  let iconJudul = "fa-star";
  if(currentKategoriNilai === "Data Nilai Keterampilan") iconJudul = "fa-tools";
  const elJudul = document.getElementById('lbl-judul-utama-nilai');
  if(elJudul) elJudul.innerHTML = `<i class="fa-solid ${iconJudul}"></i> NILAI ${currentKategoriNilai.replace('Data Nilai ', '').toUpperCase()}`;

  tableEl.innerHTML = `<tr><td class="p-6 text-center text-slate-400 text-xs"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>Sinkronisasi Database...</td></tr>`;

  try {
    const katMapel = currentKategoriNilai === "Data Nilai Eskul" ? "" : mapel;
    const katEkskul = currentKategoriNilai === "Data Nilai Eskul" ? mapel : "";

    // 1) Konfigurasi kategori+mapel dari Supabase
    const { data: konfigRow, error: errKonfig } = await supaClient.from('nilai_konfigurasi')
      .select('config').eq('kategori', currentKategoriNilai).eq('mapel', katMapel).maybeSingle();
    if (errKonfig) throw errKonfig;
    configNilaiAktif = (konfigRow && konfigRow.config) || null;

    // Default Config Injector
    if(!configNilaiAktif) {
      if (currentKategoriNilai === "Data Nilai Pengetahuan") {
        configNilaiAktif = { active_kd: 2, kds: [{name: "KD 1", t1: "Tugas 1", t2: "Tugas 2", uh: "Ulangan Harian"}, {name: "KD 2", t1: "Tugas 1", t2: "Tugas 2", uh: "Ulangan Harian"}], bobot: { cp: 50, uts: 20, uas: 30 } };
      } else if (currentKategoriNilai === "Data Nilai Keterampilan") {
        configNilaiAktif = { active_cp: 2, bobot: { prak: 40, proj: 30, port: 30 } };
      } else if (currentKategoriNilai === "Data Nilai Eskul") {
        configNilaiAktif = { format_deskripsi: {} };
      }
    }

    // 2) Murid + status guru (sumber tunggal: tabel akun)
    const json = await supabaseFetch('get_dashboard_data', { kelas: kelas, mapel: mapel, bulan: currentBulan, tahun: currentTahun });
    if (json.status !== 'success') throw new Error(json.message || 'Gagal memuat data murid');
    listMuridKelas = json.murid;
    // PERBAIKAN: Saring data tabel Nilai berdasarkan kolom "Ekstrakurikuler"
    if(currentKategoriNilai === "Data Nilai Eskul") {
        listMuridKelas = listMuridKelas.filter(m => {
            const dataEkskul = m["Ekstrakurikuler"] || "";
            const arrEkskul = dataEkskul.split(',').map(e => e.trim());
            return arrEkskul.includes(mapel);
        });
    }

    if(json.status_guru) dataStatusKunciGuru = json.status_guru; 

    // 3) Nilai tersimpan (JSONB per siswa) → dibangun ulang ke bentuk kolom dinamis
    const { data: nilaiRows, error: errNilai } = await supaClient.from('nilai')
      .select('*')
      .eq('kategori', currentKategoriNilai)
      .eq('mapel', katMapel)
      .eq('ekskul', katEkskul)
      .eq('kelas', kelas)
      .eq('tahun', currentTahun)
      .eq('semester', currentSemesterNilai);
    if (errNilai) throw errNilai;
    rawDataNilai = (nilaiRows || []).map(r => ({
      "NIS": r.nis,
      nis: r.nis,
      "Nama": r.nama || "",
      "Tahun": r.tahun,
      "Semester": r.semester,
      "Tingkat/Kelas": r.kelas,
      "Mata Pelajaran": r.mapel,
      "Ekstrakurikuler": r.ekskul,
      ...(r.data || {})
    }));
    // Lampirkan salinan JSONB untuk merge saat auto-save
    (nilaiRows || []).forEach((r, i) => { if (rawDataNilai[i]) rawDataNilai[i].__data = r.data || {}; });

    // 4) Cache Nilai Akhir pasangan (Pengetahuan & Keterampilan) → sumber Nilai Sumatif gabungan
    cacheNilaiPasangan = {};
    if (currentKategoriNilai === "Data Nilai Pengetahuan" || currentKategoriNilai === "Data Nilai Keterampilan") {
      const { data: pasanganRows, error: errPasangan } = await supaClient.from('nilai')
        .select('nis, kategori, data')
        .in('kategori', ["Data Nilai Pengetahuan", "Data Nilai Keterampilan"])
        .eq('mapel', katMapel)
        .eq('ekskul', katEkskul)
        .eq('kelas', kelas)
        .eq('tahun', currentTahun)
        .eq('semester', currentSemesterNilai);
      if (errPasangan) console.warn('Gagal memuat nilai pasangan:', errPasangan.message);
      (pasanganRows || []).forEach(r => {
        const na = (r.data || {})["Nilai Akhir Raport"];
        if (na === "" || na === null || na === undefined || isNaN(Number(na))) return;
        const key = String(r.nis);
        if (!cacheNilaiPasangan[key]) cacheNilaiPasangan[key] = { p: "", k: "" };
        if (r.kategori === "Data Nilai Pengetahuan") cacheNilaiPasangan[key].p = Number(na);
        else cacheNilaiPasangan[key].k = Number(na);
      });
      // Nilai kategori aktif di layar lebih baru daripada cache → timpa dari rawDataNilai
      rawDataNilai.forEach(r => {
        const na = r["Nilai Akhir Raport"];
        if (na === "" || na === null || na === undefined || isNaN(Number(na))) return;
        const key = String(r.NIS ?? r.nis);
        if (!cacheNilaiPasangan[key]) cacheNilaiPasangan[key] = { p: "", k: "" };
        if (currentKategoriNilai === "Data Nilai Pengetahuan") cacheNilaiPasangan[key].p = Number(na);
        else cacheNilaiPasangan[key].k = Number(na);
      });
    }

    // 5) Kategori Sikap: agregat rating teman sejawat (per target) untuk kelas+mapel+semester aktif
    cacheTemanSejawat = {};
    if (currentKategoriNilai === "Data Nilai Sikap") {
      try {
        const { data: nstsRows, error: errNsts } = await supaClient.from('nilai_teman_sejawat')
          .select('target_nis, skor')
          .eq('mapel', katMapel)
          .eq('kelas', kelas)
          .eq('tahun', currentTahun)
          .eq('semester', currentSemesterNilai);
        if (errNsts) throw errNsts;
        (nstsRows || []).forEach(r => {
          const key = String(r.target_nis);
          if (!cacheTemanSejawat[key]) cacheTemanSejawat[key] = [];
          cacheTemanSejawat[key].push(Number(r.skor));
        });
      } catch (e) { console.warn('Gagal memuat rating teman sejawat:', e.message || e); }
      // Simpan hasil agregat ke baris JSONB in-memory (ikut export/PDF & tunggakan);
      // persist ke DB dilakukan lewat tombol "Simpan" (forceSyncSemuaNilai)
      rawDataNilai.forEach(r => {
        const h = hitungHasilTemanSejawat(r.NIS ?? r.nis);
        r["Nilai Teman Sejawat"] = h.rata;
        r["Modus Teman Sejawat"] = h.modus;
        r["Deskripsi Karakter"] = h.desk;
      });
    }

    // Render Tabel berdasarkan Kategori
    if(currentKategoriNilai === "Data Nilai Pengetahuan") renderTabelPengetahuan();
    else if(currentKategoriNilai === "Data Nilai Keterampilan") renderTabelKeterampilan();
    else if(currentKategoriNilai === "Data Nilai Sikap") renderTabelSikap();
    else if(currentKategoriNilai === "Data Nilai Eskul") renderTabelEskul();
    else tableEl.innerHTML = `<tr><td class="p-6 text-center text-slate-400 text-xs">Modul dalam tahap pengembangan.</td></tr>`;

    // Validasi Kosong
    if (rawDataNilai.length === 0 && listMuridKelas.length > 0) {
      Swal.fire({ title: 'Database Belum Tersedia', text: 'Data untuk Semester ini belum ada. Klik "Simpan Semua" untuk otomatis menginisiasi kolom nilai ke dalam Database.', icon: 'info', background: '#1e293b', color: '#fff', confirmButtonText: 'Baik, Mengerti' });
    }
  } catch (e) { tableEl.innerHTML = `<tr><td class="p-6 text-center text-red-400">Gagal memuat data. Periksa koneksi internet Anda.</td></tr>`; }
}

function changeKategoriNilai() { 
    const mapelTerpilih = document.getElementById('select-mapel-nilai').value; // (g) kunci pilihan lama
    currentKategoriNilai = document.getElementById('select-kategori-nilai').value; 
    
    // Ganti dropdown dinamis berdasarkan kategori
    const selMapel = document.getElementById('select-mapel-nilai');
    const listActive = currentKategoriNilai === "Data Nilai Eskul" ? cacheListEkskul : cacheListMapel;
    
    selMapel.innerHTML = opsiMapelNilaiHTML(listActive, currentUser.role, currentUser.user);
    
    // (g) Pertahankan Mapel terpilih bila masih tersedia di daftar baru (filter lain tidak berubah)
    if (mapelTerpilih && [...selMapel.options].some(o => o.value === mapelTerpilih)) selMapel.value = mapelTerpilih;
    
    loadDataNilai(); 
}

/** Opsi dropdown mapel modul Nilai: diampu guru di atas (bisa edit), lainnya baca saja.
 *  Kategori-aware (req A1): kategori Eskul → hanya grup "Ekskul Diampu";
 *  kategori Pengetahuan/Keterampilan/Sikap → hanya grup "Mapel Diampu". */
function opsiMapelNilaiHTML(listActive, role, user) {
  const opt = (arr) => arr.map(m => `<option value="${escJs(m)}" class="bg-slate-800 text-white">${escapeHtml(m)}</option>`).join('');
  if (role === 'guru') {
    const isEskul = currentKategoriNilai === "Data Nilai Eskul";
    const diampu = urutAz(((user || {})["Custom Teks Mata Pelajaran"] || "").split(',').map(m => m.trim()).filter(Boolean));
    const ekskulGuru = urutAz(((user || {})["Ekstrakurikuler"] || "").split(',').map(m => m.trim()).filter(Boolean));
    const semua = listActive || [];
    let html = '';
    if (isEskul) {
      const ekskulDiampu = ekskulGuru.filter(e => semua.includes(e));
      const lain = semua.filter(e => !ekskulGuru.includes(e));
      if (ekskulDiampu.length) html += `<optgroup label="Ekskul Diampu (Bisa Edit)" class="bg-slate-700 text-yellow-300 font-bold">${opt(ekskulDiampu)}</optgroup>`;
      if (lain.length) html += `<optgroup label="Lainnya (Baca Saja)" class="bg-slate-700 text-slate-400 font-bold">${opt(lain)}</optgroup>`;
    } else {
      const mapelDiampu = diampu.filter(m => semua.includes(m));
      const lain = semua.filter(m => !diampu.includes(m));
      if (mapelDiampu.length) html += `<optgroup label="Mapel Diampu (Bisa Edit)" class="bg-slate-700 text-green-300 font-bold">${opt(mapelDiampu)}</optgroup>`;
      if (lain.length) html += `<optgroup label="Lainnya (Baca Saja)" class="bg-slate-700 text-slate-400 font-bold">${opt(lain)}</optgroup>`;
    }
    return html || opt(semua);
  }
  return opt(listActive || []);
}

/** Opsi dropdown kelas modul Nilai: kelas yang diampu (wali kelas + jadwal mapel) di atas + tanda ★. */
function opsiKelasNilaiHTML(listKelas, role, user) {
  const diampuSet = cacheKelasDiampuGuru instanceof Set ? cacheKelasDiampuGuru : new Set();
  const opt = (arr) => arr.map(k => `<option value="${escJs(k)}" class="bg-slate-800 text-white">${diampuSet.has(k) ? '★ ' : ''}${escapeHtml(k)}</option>`).join('');
  if (role === 'guru') {
    const diampu = urutAz([...diampuSet].filter(k => (listKelas || []).includes(k)));
    const lain = (listKelas || []).filter(k => !diampu.includes(k));
    let html = '';
    if (diampu.length) html += `<optgroup label="Kelas Diampu (★)" class="bg-slate-700 text-green-300 font-bold">${opt(diampu)}</optgroup>`;
    if (lain.length) html += `<optgroup label="Kelas Lainnya" class="bg-slate-700 text-slate-400 font-bold">${opt(lain)}</optgroup>`;
    return html || opt(listKelas || []);
  }
  return opt(listKelas || []);
}

/** Hitung set kelas yang diampu guru (wali kelas + jadwal_pelajaran guru tsb untuk mapel terpilih). */
function hitungKelasDiampuGuru(mapel) {
  const set = new Set();
  if (!currentUser || currentUser.role !== 'guru') return set;
  const user = currentUser.user || {};
  const wali = (user["Wali Kelas"] || "").trim();
  if (wali) set.add(wali);
  const idGuru = user["ID Akun Guru"] || "";
  (cacheJadwalGuru || []).forEach(j => {
    if (String(j["ID Akun Guru"] || "") === String(idGuru) && (j["Mapel"] || "") === (mapel || "")) {
      const k = (j["Tingkat/Kelas"] || "").trim();
      if (k) set.add(k);
    }
  });
  return set;
}

/** Segarkan dropdown Kelas (tanda ★ mengikuti mapel terpilih) + highlight ikon. */
function perbaruiKelasDiampuGuru() {
  const sel = document.getElementById('select-kelas-nilai');
  const mapel = document.getElementById('select-mapel-nilai')?.value || "";
  cacheKelasDiampuGuru = hitungKelasDiampuGuru(mapel);
  if (sel) {
    const nilaiLama = sel.value;
    sel.innerHTML = opsiKelasNilaiHTML(cacheListKelasNilai, currentUser.role, currentUser.user);
    if ([...sel.options].some(o => o.value === nilaiLama)) sel.value = nilaiLama;
  }
  perbaruiIkonKelasDiampu();
}

/** Highlight ikon "Pilih Kelas" (halo hijau) bila kelas terpilih termasuk yang diampu guru. */
function perbaruiIkonKelasDiampu() {
  const sel = document.getElementById('select-kelas-nilai');
  const ikon = document.getElementById('ikon-kelas-nilai');
  if (!sel || !ikon) return;
  const diampu = cacheKelasDiampuGuru.has(sel.value);
  ikon.style.boxShadow = diampu ? '0 0 0 2px #34d399, 0 0 10px rgba(52,211,153,0.7)' : '';
  ikon.style.backgroundColor = diampu ? 'rgba(5,150,105,0.9)' : '';
  ikon.style.color = diampu ? '#ffffff' : '';
  ikon.title = diampu ? `Kelas ${sel.value} diampu Anda (★)` : 'Pilih Kelas';
}

function renderTabelPengetahuan() {
  const maxKD = configNilaiAktif.active_kd || 1;
  const displayNama = showNamaSiswaNilai ? 'table-cell' : 'none';

  let head1 = '', head2 = '';
  for(let i=0; i<maxKD; i++) {
    const k = configNilaiAktif.kds[i] || {name: `KD ${i+1}`, t1: 'T1', t2: 'T2', uh: 'UH'};
    head1 += `<th colspan="5" class="px-2 py-2 border-r border-white/10 bg-blue-900/40 border-b border-blue-500/30 cursor-pointer hover:bg-blue-600/50" onclick="Swal.fire({title:'Info KD', html:'<b class=\\'text-blue-400\\'>${k.name}</b><br>T1: ${k.t1}<br>T2: ${k.t2}<br>UH: ${k.uh}', background:'#1e293b', color:'#fff', icon:'info'})">${k.name}</th>`;
    head2 += `<th class="px-1 py-1 border-r border-b border-white/10">T1</th><th class="px-1 py-1 border-r border-b border-white/10">T2</th><th class="px-1 py-1 border-r border-b border-white/10">UH</th><th class="px-1 py-1 border-r border-b border-white/10 text-slate-300">Rta</th><th class="px-1 py-1 border-r border-b border-white/10 text-slate-300">Prd</th>`;
  }

  const theadHTML = `
    <thead class="sticky top-0 z-40 shadow-lg">
      <tr class="bg-slate-800 text-slate-300 text-[10px] uppercase tracking-wider text-center border-b border-white/20">
        <th class="sticky left-0 bg-slate-800 z-50 px-2 py-2 border-r border-white/10 w-8 cursor-pointer hover:bg-slate-700 text-blue-400 shadow-md" onclick="toggleNamaSiswaNilai()">No</th>
        <!-- Ganti kode <th> Nama Siswa yang lama dengan ini: -->
        <th rowspan="2" class="th-nama-siswa sticky left-[32px] bg-slate-800 z-40 px-3 py-2 border-r border-b border-white/10 text-left align-middle select-none relative" style="display:${displayNama}; width: 160px; min-width: 50px;">
        <div class="flex items-center justify-between gap-1 pr-1"><span class="truncate font-semibold">Nama Siswa</span><button onclick="event.stopPropagation(); siklusUrutNamaNilai()" class="shrink-0 w-5 h-5 rounded bg-slate-700/70 hover:bg-slate-600 flex items-center justify-center text-[9px]" title="Urutkan Nama (A-Z / Z-A)">${ikonUrutNamaNilai()}</button></div>
        <!-- Garis Handle Geser (Kursor berubah jadi panah geser) -->
        <div class="col-resizer absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-500/50 transition-colors"></div></th>
        ${head1}
        <th colspan="2" class="px-2 py-2 border-r border-white/10 bg-purple-900/40 border-b border-purple-500/30">Rerata CP</th>
        <th class="px-2 py-2 border-r border-white/10 bg-yellow-900/40">UTS</th><th class="px-2 py-2 border-r border-white/10 bg-red-900/40">UAS</th>
        <th colspan="3" class="px-2 py-2 border-r border-white/10 bg-green-900/40 border-b border-green-500/30">NILAI RAPORT</th>
        
        <!-- KOLOM TUNGGAKAN -->
        <th rowspan="2" class="bg-red-900/30 border-r border-b border-white/10 cursor-pointer hover:bg-red-800 transition align-middle" onclick="toggleBelumTuntasNilai()" style="width: ${showBelumTuntasNilai ? '140px' : '30px'}; min-width: ${showBelumTuntasNilai ? '140px' : '30px'}; max-width: ${showBelumTuntasNilai ? '140px' : '30px'};">
            ${showBelumTuntasNilai ? '<div class="flex justify-between items-center px-1"><span class="text-[9px] text-red-300 font-bold tracking-normal leading-tight text-left">Belum<br>Tuntas</span> <button onclick="shareBelumTuntasWA(event)" class="bg-green-500 text-white px-1.5 py-1 rounded shadow hover:bg-green-400" title="Share WA"><i class="fa-brands fa-whatsapp"></i></button></div>' : '<i class="fa-solid fa-triangle-exclamation text-red-400" title="Klik lihat nilai belum tuntas"></i>'}
        </th>
        
        <th class="bg-slate-800 border-r border-white/10 align-middle"><div style="resize: horizontal; overflow: auto; min-width: 150px; width: 150px; padding: 8px;">Keterangan</div></th>
      </tr>
      <tr class="bg-slate-800 text-slate-400 text-[9px] text-center shadow-sm">
        <th class="sticky left-0 bg-slate-800 z-50 border-r border-b border-white/10"></th>
        ${head2}
        <th class="border-r border-b border-white/10 bg-purple-900/20">${configNilaiAktif.bobot.cp}%</th><th class="border-r border-b border-white/10 bg-purple-900/20 text-slate-300">Prd</th>
        <th class="border-r border-b border-white/10 bg-yellow-900/20">${configNilaiAktif.bobot.uts}%</th><th class="border-r border-b border-white/10 bg-red-900/20">${configNilaiAktif.bobot.uas}%</th>
        <th class="px-1 py-1 border-r border-b border-white/10 bg-green-900/20">NA</th><th class="px-1 py-1 border-r border-b border-white/10 bg-green-900/20 text-slate-300">Prd</th>
        <th class="px-1 py-1 border-r border-b border-white/10 bg-indigo-900/20 text-slate-300" title="Nilai Raport (Sumatif/Capaian)">Nilai Raport</th>
        <th class="px-1 py-1 bg-slate-800 border-r border-b border-white/10">Catatan</th>
      </tr>
    </thead>
  `;

  const tbodyHTML = urutMuridTampil().map((m, idx) => {
    const dt = rawDataNilai.find(d => d.NIS == m.NIS) || {};
    let kdsHTML = '';
    
    for(let i=0; i<maxKD; i++) {
      let ltr = LETTERS_KD[i]; 
      let t1 = dt[`KD ${ltr} T1`] || '', t2 = dt[`KD ${ltr} T2`] || '', uh = dt[`KD ${ltr} UH`] || '', rta = dt[`KD ${ltr} Rata-rata`] || ''; 
      let prd = dt[`KD ${ltr} Predikat`] || hitungPredikat(rta);
      
      kdsHTML += `
        <td class="border-b border-r border-white/5 p-0"><input type="number" onfocus="storeOldVal(this)" onblur="kalkulasiPengetahuan('${m.NIS}')" id="N_${m.NIS}_KD_${ltr}_T1" value="${t1}" class="w-10 h-8 bg-transparent text-center text-xs text-white outline-none focus:bg-blue-600/30"></td>
        <td class="border-b border-r border-white/5 p-0"><input type="number" onfocus="storeOldVal(this)" onblur="kalkulasiPengetahuan('${m.NIS}')" id="N_${m.NIS}_KD_${ltr}_T2" value="${t2}" class="w-10 h-8 bg-transparent text-center text-xs text-white outline-none focus:bg-blue-600/30"></td>
        <td class="border-b border-r border-white/5 p-0"><input type="number" onfocus="storeOldVal(this)" onblur="kalkulasiPengetahuan('${m.NIS}')" id="N_${m.NIS}_KD_${ltr}_UH" value="${uh}" class="w-10 h-8 bg-transparent text-center text-xs text-white outline-none focus:bg-blue-600/30"></td>
        <td class="border-b border-r border-white/5 p-0 bg-blue-900/10 text-center text-xs font-bold ${getWarnaPredikat(hitungPredikat(rta))}" id="LBL_${m.NIS}_KD_${ltr}_Rerata">${rta}</td>
        <td class="border-b border-r border-white/5 p-0 bg-blue-900/5 text-center text-xs font-bold ${getWarnaPredikat(prd)}" id="PRD_${m.NIS}_KD_${ltr}">${prd}</td>
      `;
    }

    let valCP = dt["Rerata CP"] || ''; let prdCP = valCP ? hitungPredikat(valCP) : '-';
    let valNA = dt["Nilai Akhir Raport"] || ''; let prdNA = dt["Predikat"] || (valNA ? hitungPredikat(valNA) : '-');

    const sumatifMode = cfgDeskripsiRaport().sumatif.mode;
    const valRPT = hitungSumatifGabungan(m.NIS, valNA);
    const selNilaiRaport = sumatifMode === 'manual'
      ? `<input type="number" onfocus="storeOldVal(this)" onblur="onNilaiRaportManual('${m.NIS}','pengetahuan')" id="NR_${m.NIS}_NilaiRaport" value="${dt["Nilai Raport"] ?? (valRPT || '')}" class="w-10 h-8 bg-transparent text-center text-[11px] font-bold text-white outline-none focus:bg-indigo-600/30">`
      : `<span id="RPT_${m.NIS}_NilaiAkhir" class="text-[12px] font-extrabold ${getWarnaPredikat(hitungPredikat(valRPT))}">${valRPT}</span>`;

    return `
      <tr class="hover:bg-white/5 transition text-xs" data-nis="${m.NIS}">
        <td class="sticky left-0 bg-[#0f172a] z-30 text-center border-b border-r border-white/10 px-2 cursor-pointer text-blue-400 font-bold group-hover:bg-slate-800" onclick="toggleNamaSiswaNilai()">${idx + 1}</td>
        <td class="sticky left-[32px] bg-[#0f172a] z-30 border-b border-r border-white/10 px-2 truncate text-left group-hover:bg-slate-800" style="display:${displayNama}; max-width: 0;">
    ${m["Nama Lengkap"]}
</td>
        ${kdsHTML}
        <td class="border-b border-r border-white/5 p-0 bg-purple-900/10 text-center font-bold ${getWarnaPredikat(hitungPredikat(valCP))}" id="LBL_${m.NIS}_RerataCP">${valCP}</td>
        <td class="border-b border-r border-white/5 p-0 bg-purple-900/5 text-center font-bold ${getWarnaPredikat(prdCP)}" id="PRD_${m.NIS}_RerataCP">${prdCP}</td>
        <td class="border-b border-r border-white/5 p-0"><input type="number" onfocus="storeOldVal(this)" onblur="kalkulasiPengetahuan('${m.NIS}')" id="N_${m.NIS}_UTS" value="${dt.UTS || ''}" class="w-10 h-8 bg-yellow-900/10 text-center text-white outline-none focus:bg-yellow-600/30"></td>
        <td class="border-b border-r border-white/5 p-0"><input type="number" onfocus="storeOldVal(this)" onblur="kalkulasiPengetahuan('${m.NIS}')" id="N_${m.NIS}_UAS" value="${dt["UAS/UKK"] || ''}" class="w-10 h-8 bg-red-900/10 text-center text-white outline-none focus:bg-red-600/30"></td>
        <td class="border-b border-r border-white/5 px-1 bg-green-900/20 text-center text-[13px] font-extrabold ${getWarnaPredikat(hitungPredikat(valNA))}" id="LBL_${m.NIS}_NilaiAkhir">${valNA}</td>
        <td class="border-b border-r border-white/10 px-1 bg-green-900/10 text-center text-[13px] font-extrabold ${getWarnaPredikat(prdNA)}" id="PRD_${m.NIS}_NilaiAkhir">${prdNA}</td>
        <td class="border-b border-r border-white/10 px-1 bg-indigo-900/10 text-center align-middle">
          <div class="flex items-center justify-center gap-1">
            ${selNilaiRaport}
            <button onclick="popupDeskripsiRaport('${m.NIS}')" class="w-5 h-5 shrink-0 rounded bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white transition" title="Lihat/Edit Deskripsi Nilai Sumatif"><i class="fa-solid fa-file-lines text-[9px]"></i></button>
          </div>
        </td>
        
        <!-- SEL TUNGGAKAN -->
        <td class="border-b border-r border-white/5 px-2 py-1 text-red-300 whitespace-normal bg-red-900/10 cursor-pointer align-middle" onclick="toggleBelumTuntasNilai()">
            ${(() => {
                let t = getTunggakan(m.NIS, currentKategoriNilai);
                if (!showBelumTuntasNilai) return t.length > 0 ? '<div class="text-center"><i class="fa-solid fa-circle text-[8px] text-red-500"></i></div>' : '<div class="text-center"><i class="fa-solid fa-check text-[10px] text-green-500"></i></div>';
                return t.length > 0 ? `<ul class="list-disc pl-3 text-[8.5px] leading-tight text-left max-w-[120px] mx-auto">${t.map(x=>`<li>${x}</li>`).join('')}</ul>` : '<div class="text-center text-[9px] text-green-400 font-bold">Tuntas</div>';
            })()}
        </td>
        
        <td class="border-b border-r border-white/5 p-0 align-middle"><input type="text" onfocus="storeOldVal(this)" onblur="saveKeteranganNilai('${m.NIS}')" id="KET_${m.NIS}" value="${dt.Keterangan || ''}" class="w-full h-8 bg-transparent text-left px-2 text-[10px] text-white outline-none focus:bg-white/10"></td>
      </tr>
    `;
  }).join('');

  document.getElementById('tabel-nilai').innerHTML = `${theadHTML}<tbody>${tbodyHTML}</tbody><tfoot><tr class="bg-slate-800 text-[10px] text-slate-400 border-t border-white/20"><td colspan="100%" class="py-2 px-3 text-center"><b>PREDIKAT:</b> &nbsp; <span class="text-green-400 font-bold">A(91-100)</span> <span class="mx-1">|</span> <span class="text-blue-400 font-bold">B(81-90)</span> <span class="mx-1">|</span> <span class="text-yellow-400 font-bold">C(71-80)</span> <span class="mx-1">|</span> <span class="text-red-400 font-bold">D(0-70)</span><br><i>Klik pada header kolom/KD untuk informasi nama label.</i></td></tr></tfoot>`;
  enableNamaSiswaResize();
}

// CATATAN: Versi duplikat kalkulasiPengetahuan yang mati (ditimpa deklarasi di bawah) DIHAPUS.
// Versi aktif: kalkulasiPengetahuan di bawah (dengan validateVal lokal & auto-save per KD).

function toggleNamaSiswaNilai() { 
  showNamaSiswaNilai = !showNamaSiswaNilai; 
  if (currentKategoriNilai === "Data Nilai Pengetahuan") renderTabelPengetahuan();
  else if (currentKategoriNilai === "Data Nilai Keterampilan") renderTabelKeterampilan();
  else if (currentKategoriNilai === "Data Nilai Sikap") renderTabelSikap();
}

function showInfoKelas() {
  const kelas = document.getElementById('select-kelas-nilai').value;
  const ekskul = document.getElementById('select-mapel-nilai').value || '';
  if (currentKategoriNilai === "Data Nilai Eskul") { showInfoEkskulNilai(ekskul); return; }
  let pengurus = listMuridKelas.filter(m => (m["Jabatan Kelas"] || "").trim() !== "").map(m => {
    const nm = m["Nama Lengkap"] || "-";
    const jb = m["Jabatan Kelas"] || "";
    const hp = m["No HP/WA"] || "-";
    return `• ${escapeHtml(nm)} <span class="text-blue-300">(${escapeHtml(jb)})</span> — ${linkWA(hp, `Assalamualaikum, kami menghubungi ${nm} (${jb}) kelas ${kelas}.`)}`;
  }).join('<br>');
  if(!pengurus) pengurus = "<i>Tidak ada data pengurus kelas</i>";
  let namaWali = getNamaWaliKelas(kelas);
  let hpWali = "-";
  if (dataStatusKunciGuru && dataStatusKunciGuru.length > 0) {
    const w = dataStatusKunciGuru.find(g => (g["Wali Kelas"] || "") === kelas);
    if (w) hpWali = w["No HP"] || "-";
  }

  // Guru Mata Pelajaran: daftar guru yang mengampu mapel terpilih (dari akun guru)
  const mapelDipilih = ekskul;
  let daftarGuruMapel = [];
  if (mapelDipilih && dataStatusKunciGuru && dataStatusKunciGuru.length > 0) {
    daftarGuruMapel = dataStatusKunciGuru.filter(g => (g["Custom Teks Mata Pelajaran"] || "").split(',').map(x => x.trim()).includes(mapelDipilih));
  }
  const htmlGuruMapel = daftarGuruMapel.length
    ? daftarGuruMapel.map(g => {
        const nm = g["Nama Guru Bergelar"] || g["Nama Guru"] || "-";
        return `• ${escapeHtml(nm)} — ${linkWA(g["No HP"], `Assalamualaikum Bapak/Ibu ${nm}, guru ${mapelDipilih} kelas ${kelas}.`)}`;
      }).join('<br>')
    : "<i>Tidak ada data guru pengampu mapel ini</i>";

  Swal.fire({ title: `<div class="text-lg font-bold">Info Kelas ${escapeHtml(kelas)}</div>`, html: `<div class="text-left text-sm text-slate-300 mt-2 bg-black/30 p-4 rounded border border-white/10"><p class="mb-1 text-[10px] uppercase tracking-wider text-slate-500 font-bold">Wali Kelas</p><p class="font-bold text-white"><i class="fa-solid fa-user-tie text-green-400"></i> ${escapeHtml(namaWali)}</p><p class="text-xs text-green-300 mb-4">${linkWA(hpWali, `Assalamualaikum Bapak/Ibu ${namaWali}, wali kelas ${kelas}.`)}</p><p class="mb-1 text-[10px] uppercase tracking-wider text-slate-500 font-bold">Guru Mata Pelajaran <span class="normal-case text-blue-300">${escapeHtml(mapelDipilih || '-')}</span></p><p class="text-xs leading-relaxed mb-4">${htmlGuruMapel}</p><p class="mb-1 text-[10px] uppercase tracking-wider text-slate-500 font-bold">Pengurus</p><p class="text-xs leading-relaxed">${pengurus}</p><table class="w-full text-xs mt-2 border-t border-white/10 pt-2"><tr><td class="py-1">Jumlah Siswa</td><td class="py-1 text-right text-white font-bold">: ${listMuridKelas.length} Siswa</td></tr></table></div>`, background: '#1e293b', color: '#fff', confirmButtonText: 'Tutup' });

}

/** Info Ekstrakurikuler: pembina (dari akun guru) + pengurus (kolom jabatan siswa) + HP klik-WA. */
function showInfoEkskulNilai(ekskul) {
  let pembinaNama = "Belum diatur", pembinaHp = "-";
  if (dataStatusKunciGuru && dataStatusKunciGuru.length > 0) {
    const p = dataStatusKunciGuru.find(g => (g["Ekskul"] || "").split(',').map(e => e.trim()).includes(ekskul));
    if (p) { pembinaNama = p["Nama Guru Bergelar"] || p["Nama Guru"]; pembinaHp = p["No HP"] || "-"; }
  }
  let pengurus = listMuridKelas
    .filter(m => (m["Jabatan Kelas"] || "").match(/Ekstra/i))
    .map(m => {
      const nm = m["Nama Lengkap"] || "-";
      const jb = m["Jabatan Kelas"] || "";
      const hp = m["No HP/WA"] || "-";
      return `• ${escapeHtml(nm)} <span class="text-blue-300">(${escapeHtml(jb)})</span> — ${linkWA(hp, `Assalamualaikum, kami menghubungi ${nm} (${jb}) ekstrakurikuler ${ekskul}.`)}`;
    }).join('<br>');
  if (!pengurus) pengurus = "<i>Tidak ada pengurus ekskul (kolom jabatan siswa tidak berisi jabatan ekstra)</i>";

  Swal.fire({
    title: `<div class="text-lg font-bold">Info Ekstrakurikuler ${escapeHtml(ekskul)}</div>`,
    html: `
    <div class="text-left text-sm text-slate-300 mt-2 bg-black/30 p-4 rounded border border-white/10">
        <p class="mb-1 text-[10px] uppercase tracking-wider text-slate-500 font-bold">Pembina Ekstrakurikuler</p>
        <p class="font-bold text-white"><i class="fa-solid fa-user-tie text-green-400"></i> ${escapeHtml(pembinaNama)}</p>
        <p class="text-xs text-green-300 mb-4">${linkWA(pembinaHp, `Assalamualaikum Bapak/Ibu ${pembinaNama}, pembina ekstrakurikuler ${ekskul}.`)}</p>
        <p class="mb-1 text-[10px] uppercase tracking-wider text-slate-500 font-bold">Pengurus</p>
        <p class="text-xs leading-relaxed mb-4">${pengurus}</p>
        <table class="w-full text-xs mt-2 border-t border-white/10 pt-2">
            <tr><td class="py-1">Jumlah Anggota</td><td class="py-1 text-right text-white font-bold">: ${listMuridKelas.length} Siswa</td></tr>
        </table>
    </div>`,
    background: '#1e293b', color: '#fff', confirmButtonText: 'Tutup'
  });
}
function getNamaWaliKelas(kelas) { if (dataStatusKunciGuru && dataStatusKunciGuru.length > 0) { const w = dataStatusKunciGuru.find(g => g["Wali Kelas"] === kelas); if(w) return w["Nama Guru"]; } return "-"; }

// ================= // ================= LOGIKA AUTO KALKULASI & VALIDASI =================
function storeOldVal(el) { el.dataset.oldval = el.value; }
function saveKeteranganNilai(nis) { const el = document.getElementById(`KET_${nis}`); if(el.dataset.oldval !== el.value) { recordUndo(nis, `KET`, el.dataset.oldval, el.value); silentSaveNilai(nis, { "Keterangan": el.value }); } }

// [REQ 5 & 6] Validasi Nilai 0-100 & Peringatan
function validateVal(elId, nis, isFromUndo) {
    let el = document.getElementById(elId); if(!el) return "";
    let valStr = el.value; if (valStr === "") return ""; // Kosong = Lewati
    let v = Number(valStr); 
    if (v > 100 || v < 0) {
        Swal.fire({toast: true, position: 'top-end', icon: 'warning', title: 'Nilai dibatasi 0 - 100!', showConfirmButton: false, timer: 2000, background: '#1e293b', color: '#fff'});
        if(v > 100) v = 100; if(v < 0) v = 0;
    }
    // Req 7: Otomatis memicu Save yang dijalankan dari fungsi onblur
    if(!isFromUndo && el.dataset.oldval !== String(v) && el.dataset.oldval !== undefined) recordUndo(nis, elId, el.dataset.oldval, v);
    el.value = v; return v;
}

function kalkulasiPengetahuan(nis, isFromUndo = false) {
  const maxKD = configNilaiAktif.active_kd; const bobotCP = configNilaiAktif.bobot.cp / 100; const bobotUTS = configNilaiAktif.bobot.uts / 100; const bobotUAS = configNilaiAktif.bobot.uas / 100;
  let totalRerataKD = 0; let kdTeriisi = 0; let updates = {}; 

  const validateVal = (elId) => {
    let el = document.getElementById(elId); if(!el) return "";
    let valStr = el.value; if (valStr === "") return ""; // Biarkan kosong jika dihapus
    let v = Number(valStr); if(v > 100) v = 100; if(v < 0) v = 0;
    if(!isFromUndo && el.dataset.oldval !== String(v) && el.dataset.oldval !== undefined) recordUndo(nis, elId, el.dataset.oldval, v);
    el.value = v; return v;
  };
  
  

  for(let i=0; i<maxKD; i++) {
    let ltr = LETTERS_KD[i];
    const t1 = validateVal(`N_${nis}_KD_${ltr}_T1`, nis, isFromUndo);
    const t2 = validateVal(`N_${nis}_KD_${ltr}_T2`);
    const uh = validateVal(`N_${nis}_KD_${ltr}_UH`);
    
    let arrKD = []; 
    if(t1 !== "") arrKD.push(Number(t1)); 
    if(t2 !== "") arrKD.push(Number(t2)); 
    if(uh !== "") arrKD.push(Number(uh));
    
    let rta = arrKD.length > 0 ? Math.round(calcRerata(arrKD)) : ""; 
    let prd = rta !== "" ? hitungPredikat(rta) : "-";
    
    document.getElementById(`LBL_${nis}_KD_${ltr}_Rerata`).innerText = rta; 
    document.getElementById(`PRD_${nis}_KD_${ltr}`).innerText = prd;
    
    // [PERBAIKAN] Selalu catat agar sel yang dihapus ikut terhapus di database
    updates[`KD ${ltr} T1`] = t1; updates[`KD ${ltr} T2`] = t2; updates[`KD ${ltr} UH`] = uh; 
    updates[`KD ${ltr} Rata-rata`] = rta; updates[`KD ${ltr} Predikat`] = prd;
    
    if(rta !== "") { totalRerataKD += Number(rta); kdTeriisi++; }
    if(!isFromUndo) silentSaveNilai(nis, updates); // Save otomatis selalu dipanggil setelah input kehilangan fokus
}

let rerataCP = kdTeriisi > 0 ? Math.round(totalRerataKD / kdTeriisi) : "";
  document.getElementById(`LBL_${nis}_RerataCP`).innerText = rerataCP; 
  document.getElementById(`PRD_${nis}_RerataCP`).innerText = rerataCP !== "" ? hitungPredikat(rerataCP) : "-";
  updates["Rerata CP"] = rerataCP;

  const uts = validateVal(`N_${nis}_UTS`), uas = validateVal(`N_${nis}_UAS`);
  updates["UTS"] = uts; updates["UAS/UKK"] = uas;

  let nilaiAkhir = "", akhirPrd = "-";
  if (rerataCP !== "" || uts !== "" || uas !== "") {
    nilaiAkhir = Math.round((Number(rerataCP)||0) * bobotCP + (Number(uts)||0) * bobotUTS + (Number(uas)||0) * bobotUAS); 
    akhirPrd = hitungPredikat(nilaiAkhir);
  }
  
document.getElementById(`LBL_${nis}_NilaiAkhir`).innerText = nilaiAkhir; 
  document.getElementById(`PRD_${nis}_NilaiAkhir`).innerText = akhirPrd;
  updates["Nilai Akhir Raport"] = nilaiAkhir; updates["Predikat"] = akhirPrd;
  Object.assign(updates, deriveNilaiRaport(nis, 'NilaiAkhir', 'NilaiRaport', hitungSumatifGabungan(nis, nilaiAkhir), 'sumatif'));
  
  const ketEl = document.getElementById(`KET_${nis}`);
  if(ketEl) updates["Keterangan"] = ketEl.value;

  if(!isFromUndo) silentSaveNilai(nis, updates);
}

// [PERBAIKAN] Auto-Sync ke Supabase (JSONB per siswa) + Lengkapi Data Statis
function silentSaveNilai(nis, updates) {
  const mapel = document.getElementById('select-mapel-nilai').value; 
  const kelas = document.getElementById('select-kelas-nilai').value;
  const mSiswa = listMuridKelas.find(m => m.NIS == nis);
  
  // ID Akun Guru diambil secara otomatis dari akun yang sedang login
  const idGuruAktif = currentUser && currentUser.user ? (currentUser.user["ID Akun Guru"] || "") : "";
  
  const Toast = Swal.mixin({ toast: true, position: 'bottom-end', showConfirmButton: false, timer: 1500, timerProgressBar: true, background: '#1e293b', color: '#fff' });
  
  // Merge dengan data JSONB yang sudah dimuat (rawDataNilai.__data)
  const rowLama = rawDataNilai.find(d => String(d["NIS"]) === String(nis) || String(d.nis) === String(nis));
  const dataBaru = { ...((rowLama && rowLama.__data) || {}), ...updates };
  if (rowLama) { rowLama.__data = dataBaru; Object.assign(rowLama, updates); }

  const row = {
    nis: String(nis),
    nama: (mSiswa && (mSiswa["Nama Lengkap"] || mSiswa.nama)) || (rowLama && rowLama["Nama"]) || "",
    kategori: currentKategoriNilai,
    mapel: currentKategoriNilai === "Data Nilai Eskul" ? "" : mapel,
    ekskul: currentKategoriNilai === "Data Nilai Eskul" ? mapel : "",
    kelas: kelas,
    tahun: currentTahun,
    semester: currentSemesterNilai,
    id_guru: idGuruAktif,
    data: dataBaru
  };
  
  return supaClient.from('nilai').upsert(row, { onConflict: 'nis,kategori,mapel,ekskul,tahun,semester' })
    .then(({ error }) => { if (error) throw error; Toast.fire({ icon: 'success', title: 'Tersimpan' }); })
    .catch(() => Toast.fire({ icon: 'error', title: 'Gagal Simpan!' }));
}

// --- UPDATE: FORCE SYNC / SIMPAN SEMUA ---
async function forceSyncSemuaNilai() {
  const kelas = document.getElementById('select-kelas-nilai').value;
  const mapel = document.getElementById('select-mapel-nilai').value;
  let idGuruAktif = currentUser && currentUser.user ? (currentUser.user["ID Akun Guru"] || "") : "";

    Swal.fire({ title: 'Menyimpan Masal...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });

  // INTERVENSI ADMIN (Pemilihan Guru Pengampu secara Paksa)
  if (currentUser.role === 'admin') {
      let availableTeachers = dataStatusKunciGuru.filter(g => (g["Custom Teks Mata Pelajaran"] || "").includes(mapel) || (g["Ekstrakurikuler"] || "").includes(mapel));
      
      let optionsHTML = availableTeachers.length > 0 
          ? availableTeachers.map(g => `<option value="${g["ID Akun Guru"]}">${g["Nama Guru"]} (${g["ID Akun Guru"]})</option>`).join('')
          : `<option value="">-- Tidak ada guru (Pilih Manual) --</option>` + dataStatusKunciGuru.map(g => `<option value="${g["ID Akun Guru"]}">${g["Nama Guru"]}</option>`).join('');

      const res = await Swal.fire({
          title: 'Otorisasi Admin: Pilih ID Guru',
          html: `
            <p class="text-xs text-slate-400 mb-3 leading-tight">Data nilai ini akan disimpan dan dilampirkan atas nama ID Akun Guru berikut (Otomatis difilter berdasarkan Mata Pelajaran <b>${mapel}</b>):</p>
            <select id="admin-pilih-guru" class="w-full bg-black/40 border border-blue-500/50 rounded px-3 py-2 text-sm text-white outline-none focus:border-blue-400">
              ${optionsHTML}
            </select>`,
          background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonText: '<i class="fa-solid fa-cloud-arrow-up"></i> Simpan Data',
          preConfirm: () => document.getElementById('admin-pilih-guru').value
      });

      if (!res.isConfirmed || !res.value) return; // Batal simpan
      idGuruAktif = res.value; // Tetapkan ID Guru pilihan Admin
  }

  let isNewDatabase = (rawDataNilai.length === 0);
  let semestersToSave = isNewDatabase ? ["Ganjil", "Genap"] : [currentSemesterNilai];

  try {
    for (let sem of semestersToSave) {
      let dataList = [];
      let isCurrentUI = (sem === currentSemesterNilai);
      
      listMuridKelas.forEach((m, idx) => {
        let updates = {};
        
        // PENGELOMPOKKAN GENERATOR UPDATES BERDASARKAN KATEGORI
        if (currentKategoriNilai === "Data Nilai Pengetahuan") {
            if (isCurrentUI) kalkulasiPengetahuan(m.NIS, true); 
            for(let i=0; i<configNilaiAktif.active_kd; i++) {
               let ltr = ['A','B','C','D','E','F','G','H'][i];
               updates[`KD ${ltr} T1`] = isCurrentUI ? document.getElementById(`N_${m.NIS}_KD_${ltr}_T1`).value : "";
               updates[`KD ${ltr} T2`] = isCurrentUI ? document.getElementById(`N_${m.NIS}_KD_${ltr}_T2`).value : "";
               updates[`KD ${ltr} UH`] = isCurrentUI ? document.getElementById(`N_${m.NIS}_KD_${ltr}_UH`).value : "";
               updates[`KD ${ltr} Rata-rata`] = isCurrentUI ? document.getElementById(`LBL_${m.NIS}_KD_${ltr}_Rerata`).innerText : "";
               updates[`KD ${ltr} Predikat`] = isCurrentUI ? document.getElementById(`PRD_${m.NIS}_KD_${ltr}`).innerText : "-";
            }
            updates["Rerata CP"] = isCurrentUI ? document.getElementById(`LBL_${m.NIS}_RerataCP`).innerText : "";
            updates["UTS"] = isCurrentUI ? document.getElementById(`N_${m.NIS}_UTS`).value : "";
            updates["UAS/UKK"] = isCurrentUI ? document.getElementById(`N_${m.NIS}_UAS`).value : "";
            updates["Nilai Akhir Raport"] = isCurrentUI ? document.getElementById(`LBL_${m.NIS}_NilaiAkhir`).innerText : "";
            updates["Predikat"] = isCurrentUI ? document.getElementById(`PRD_${m.NIS}_NilaiAkhir`).innerText : "-";
            {
                const rowNilai = rawDataNilai.find(d => String(d.NIS) === String(m.NIS) || String(d.nis) === String(m.NIS)) || {};
                updates["Nilai Raport"] = isCurrentUI ? (rowNilai["Nilai Raport"] ?? "") : "";
                updates["Deskripsi Sumatif"] = isCurrentUI ? (rowNilai["Deskripsi Sumatif"] || "") : "";
            }
            updates["Keterangan"] = isCurrentUI ? document.getElementById(`KET_${m.NIS}`).value : "";
            
        } else if (currentKategoriNilai === "Data Nilai Keterampilan") {
            if (isCurrentUI) kalkulasiKeterampilan(m.NIS, true); 
            const LTRS = ['A','B','C','D'];
            for(let i=0; i<configNilaiAktif.active_cp; i++) {
                let ltr = LTRS[i];
                for(let j=1; j<=4; j++) updates[`Prak ${ltr} ${j}`] = isCurrentUI ? document.getElementById(`N_${m.NIS}_Prak_${ltr}_${j}`).value : "";
                updates[`Optimum ${ltr}`] = isCurrentUI ? document.getElementById(`LBL_${m.NIS}_Opt_${ltr}`).innerText : "";
            }
            updates["Rerata Optimum"] = isCurrentUI ? document.getElementById(`LBL_${m.NIS}_RerataOpt`).innerText : "";
            
            for(let j=1; j<=4; j++) {
                updates[`Projek ${j}`] = isCurrentUI ? document.getElementById(`N_${m.NIS}_Proj_${j}`).value : "";
                updates[`Porto ${j}`] = isCurrentUI ? document.getElementById(`N_${m.NIS}_Port_${j}`).value : "";
            }
            updates["Rerata Projek"] = isCurrentUI ? document.getElementById(`LBL_${m.NIS}_RerataProj`).innerText : "";
            updates["Rerata Porto"] = isCurrentUI ? document.getElementById(`LBL_${m.NIS}_RerataPort`).innerText : ""; // Sesuai schema
            
            updates["Nilai Akhir Raport"] = isCurrentUI ? document.getElementById(`LBL_${m.NIS}_AkhirKet`).innerText : "";
            updates["Predikat"] = isCurrentUI ? document.getElementById(`PRD_${m.NIS}_AkhirKet`).innerText : "-";
            {
                const rowNilai = rawDataNilai.find(d => String(d.NIS) === String(m.NIS) || String(d.nis) === String(m.NIS)) || {};
                updates["Nilai Raport"] = isCurrentUI ? (rowNilai["Nilai Raport"] ?? "") : "";
                updates["Deskripsi Sumatif"] = isCurrentUI ? (rowNilai["Deskripsi Sumatif"] || "") : "";
            }
            updates["Keterangan"] = isCurrentUI ? document.getElementById(`KET_${m.NIS}`).value : "";

        } else if (currentKategoriNilai === "Data Nilai Sikap") { // <--- TAMBAHKAN BLOK INI
            if (isCurrentUI) kalkulasiSikap(m.NIS, true); 
            const LTRS = ['A','B','C','D'];
            const rowNilai = rawDataNilai.find(d => String(d.NIS) === String(m.NIS) || String(d.nis) === String(m.NIS)) || {};
            for(let i=0; i<configNilaiAktif.active_cp; i++) {
                for(let j=1; j<=configNilaiAktif.active_sub_cp; j++) updates[`CP ${LTRS[i]}${j}`] = isCurrentUI ? (document.getElementById(`N_${m.NIS}_CP_${LTRS[i]}${j}`)?.value ?? "") : "";
            }
            updates["Penilaian Diri"] = isCurrentUI ? (document.getElementById(`N_${m.NIS}_Diri`)?.value ?? "") : "";
            // [REQ 3 & 6] Teman Sejawat: agregat rating dari nilai_teman_sejawat (bukan input 1-5)
            updates["Nilai Teman Sejawat"] = isCurrentUI ? (rowNilai["Nilai Teman Sejawat"] ?? "") : "";
            updates["Modus Teman Sejawat"] = isCurrentUI ? (rowNilai["Modus Teman Sejawat"] ?? "") : "";
            updates["Deskripsi Karakter"] = isCurrentUI ? (rowNilai["Deskripsi Karakter"] ?? "") : "";
            updates["Nilai Jurnal"] = isCurrentUI ? (document.getElementById(`N_${m.NIS}_Jurnal`)?.value ?? "") : "";
            updates["Nilai Akhir Raport"] = isCurrentUI ? (document.getElementById(`LBL_${m.NIS}_AkhirSikap`)?.innerText ?? "") : "";
            updates["Predikat"] = isCurrentUI ? (document.getElementById(`PRD_${m.NIS}_AkhirSikap`)?.innerText ?? "-") : "-";
            {
                updates["Nilai Raport"] = isCurrentUI ? (rowNilai["Nilai Raport"] ?? "") : "";
                updates["Deskripsi Capaian"] = isCurrentUI ? (rowNilai["Deskripsi Capaian"] || "") : "";
            }
            updates["Keterangan"] = isCurrentUI ? (document.getElementById(`KET_${m.NIS}`)?.value ?? "") : "";
        } else if (currentKategoriNilai === "Data Nilai Eskul") {
            if (isCurrentUI) kalkulasiEskul(m.NIS, true); 
            updates["Nilai"] = isCurrentUI ? document.getElementById(`N_${m.NIS}_Nilai`).value : "";
            updates["Predikat"] = isCurrentUI ? document.getElementById(`PRD_${m.NIS}_Eskul`).innerText : "-";
            updates["Deskripsi"] = isCurrentUI ? (document.getElementById(`DESC_${m.NIS}_Eskul`)?.innerText ?? "") : "";
        }

        // Static data injector
        updates["ID Akun Guru"] = idGuruAktif;
        updates["No"] = idx + 1;
        updates["NISN"] = m["NISN"];
        updates["L/P"] = (m["Jenis Kelamin"]||"").toLowerCase().startsWith("l") ? "L" : "P";
        updates["Wali Kelas"] = getNamaWaliKelas(kelas);
        updates["Mata Pelajaran"] = currentKategoriNilai === "Data Nilai Eskul" ? "" : mapel;
        updates["Ekstrakurikuler"] = currentKategoriNilai === "Data Nilai Eskul" ? mapel : "";

        dataList.push({ nis: m.NIS, nama: m["Nama Lengkap"], updates: updates });
      });

      const res = await supaClient.from('nilai').upsert(dataList.map(({ nis, nama, updates }) => ({
        nis: String(nis),
        nama: nama || "",
        kategori: currentKategoriNilai,
        mapel: currentKategoriNilai === "Data Nilai Eskul" ? "" : mapel,
        ekskul: currentKategoriNilai === "Data Nilai Eskul" ? mapel : "",
        kelas: kelas,
        tahun: currentTahun,
        semester: sem,
        id_guru: idGuruAktif,
        data: updates
      })), { onConflict: 'nis,kategori,mapel,ekskul,tahun,semester' });
      if (res.error) throw res.error;
    }

    await loadDataNilai(); 
    Swal.fire({toast:true, position:'top-end', icon:'success', title: isNewDatabase ? 'Database Nilai Diinisiasi!' : 'Seluruh Nilai Tersimpan!', showConfirmButton:false, timer:2000, background:'#1e293b', color:'#fff'});
  } catch(e) { Swal.fire({ icon: 'error', title: 'Gagal', text: e.message || 'Error Jaringan', background: '#1e293b', color: '#fff' }); }
}

// Fitur Undo/Redo
function recordUndo(nis, elId, oldVal, newVal) { undoStackNilai.push({nis, elId, oldVal, newVal}); redoStackNilai = []; updateUndoRedoUI(); }
function updateUndoRedoUI() { document.getElementById('btn-undo').disabled = undoStackNilai.length === 0; document.getElementById('btn-redo').disabled = redoStackNilai.length === 0; }
// --- 2. ROUTING UNDO / REDO ---
function getColNameFromID(elId) {
    if (currentKategoriNilai === "Data Nilai Pengetahuan") {
        const p = elId.split('_'); return `KD ${p[3]} ${p[4]}`;
    } else if (currentKategoriNilai === "Data Nilai Keterampilan") {
        const p = elId.split('_'); 
        if (p[2] === "Prak") return `Prak ${p[3]} ${p[4]}`;
        else if (p[2] === "Proj") return `Projek ${p[3]}`;
        else if (p[2] === "Port") return `Porto ${p[3]}`;
    } else if (currentKategoriNilai === "Data Nilai Sikap") {
        // Format id: N_<nis>_CP_<A1> / N_<nis>_Diri / N_<nis>_Jurnal
        const p = elId.split('_');
        if (p[2] === "CP") return `CP ${p[3]}`;
        if (p[2] === "Diri") return "Penilaian Diri";
        if (p[2] === "Jurnal") return "Nilai Jurnal";
    } else if (currentKategoriNilai === "Data Nilai Eskul") {
        if (elId.startsWith("N_")) return "Nilai";
    }
    return "";
}

function undoNilai() {
  if(undoStackNilai.length === 0) return; const act = undoStackNilai.pop(); redoStackNilai.push(act); updateUndoRedoUI();
  const el = document.getElementById(act.elId === 'KET' ? `KET_${act.nis}` : act.elId);
  if(el) { 
      el.value = act.oldVal; el.dataset.oldval = act.oldVal;
      if(act.elId === 'KET') { silentSaveNilai(act.nis, { "Keterangan": act.oldVal }); } 
      else { 
          if(currentKategoriNilai === "Data Nilai Pengetahuan") kalkulasiPengetahuan(act.nis, true);
          else if(currentKategoriNilai === "Data Nilai Keterampilan") kalkulasiKeterampilan(act.nis, true);
          else if(currentKategoriNilai === "Data Nilai Sikap") kalkulasiSikap(act.nis, true);
          else if(currentKategoriNilai === "Data Nilai Eskul") kalkulasiEskul(act.nis, true);
          const kol = getColNameFromID(act.elId);
          if (kol) {
            const ekstra = {};
            if (currentKategoriNilai === "Data Nilai Eskul") {
              const prdU = document.getElementById(`PRD_${act.nis}_Eskul`);
              const descU = document.getElementById(`DESC_${act.nis}_Eskul`);
              if (prdU) ekstra["Predikat"] = prdU.innerText;
              if (descU) ekstra["Deskripsi"] = descU.innerText;
            }
            silentSaveNilai(act.nis, { [kol] : act.oldVal, ...ekstra });
          }
      }
  }
}

function redoNilai() {
  if(redoStackNilai.length === 0) return; const act = redoStackNilai.pop(); undoStackNilai.push(act); updateUndoRedoUI();
  const el = document.getElementById(act.elId === 'KET' ? `KET_${act.nis}` : act.elId);
  if(el) { 
      el.value = act.newVal; el.dataset.oldval = act.newVal;
      if(act.elId === 'KET') { silentSaveNilai(act.nis, { "Keterangan": act.newVal }); } 
      else { 
          if(currentKategoriNilai === "Data Nilai Pengetahuan") kalkulasiPengetahuan(act.nis, true);
          else if(currentKategoriNilai === "Data Nilai Keterampilan") kalkulasiKeterampilan(act.nis, true);
          else if(currentKategoriNilai === "Data Nilai Sikap") kalkulasiSikap(act.nis, true);
          else if(currentKategoriNilai === "Data Nilai Eskul") kalkulasiEskul(act.nis, true);
          const kol = getColNameFromID(act.elId);
          if (kol) {
            const ekstra = {};
            if (currentKategoriNilai === "Data Nilai Eskul") {
              const prdR = document.getElementById(`PRD_${act.nis}_Eskul`);
              const descR = document.getElementById(`DESC_${act.nis}_Eskul`);
              if (prdR) ekstra["Predikat"] = prdR.innerText;
              if (descR) ekstra["Deskripsi"] = descR.innerText;
            }
            silentSaveNilai(act.nis, { [kol] : act.newVal, ...ekstra });
          }
      }
  }
}



// [REQ 1] Popup Setting Kolom
function openPengaturanKolomNilai() {
    if (currentKategoriNilai === "Data Nilai Pengetahuan") openPengaturanKolomPengetahuan();
    else if (currentKategoriNilai === "Data Nilai Keterampilan") openPengaturanKolomKeterampilan();
    else if (currentKategoriNilai === "Data Nilai Sikap") openPengaturanKolomSikap();
    else if (currentKategoriNilai === "Data Nilai Eskul") openFormatDeskripsiEkskul();
    else Swal.fire({icon: 'info', title: 'Info', text: 'Set Kolom untuk kategori ini sedang disiapkan.', background: '#1e293b', color: '#fff'});
}

// ---------- [REQ A2] FORMAT DESKRIPSI KETERCAPAIAN (satu dialog untuk seluruh tabel Eskul) ----------
/** Dialog tunggal Format Deskripsi Ketercapaian (template per predikat A/B/C/D).
 *  Tersimpan di server: nilai_konfigurasi (kategori='Data Nilai Eskul', mapel='') → config.format_deskripsi. */
function openFormatDeskripsiEkskul() {
  let tpl = (configNilaiAktif && configNilaiAktif.format_deskripsi) || {};
  // Migrasi template lama dari localStorage bila server masih kosong
  if (!tpl["Sangat Baik"] && !tpl["Baik"] && !tpl["Cukup"] && !tpl["Kurang"]) {
    const lama = templateDeskripsiEskul();
    if (lama) tpl = { ...lama, ...tpl };
  }
  Swal.fire({
    title: '<div class="text-base font-bold text-purple-300"><i class="fa-solid fa-file-lines"></i> Format Deskripsi Ketercapaian</div>',
    html: `
      <p class="text-[10px] text-slate-400 mb-3 text-left">Template per <b class="text-purple-300">Predikat Akhir</b>. Isi otomatis muncul di kolom <b>"Deskripsi Ketercapaian"</b> tabel Nilai Ekstrakurikuler sesuai predikat (A/B/C/D) dan tetap dapat diedit manual per siswa. Tersimpan di server — berlaku untuk semua ekskul & perangkat.</p>
      <label class="block text-left text-[10px] font-bold text-green-300 mb-1">A — Sangat Baik</label>
      <input id="tpl_SB" value="${escJs(tpl["Sangat Baik"] || '')}" placeholder="Cth: Menunjukkan penguasaan keterampilan yang sangat baik pada seluruh materi..." class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mb-2 text-xs text-white outline-none">
      <label class="block text-left text-[10px] font-bold text-blue-300 mb-1">B — Baik</label>
      <input id="tpl_B" value="${escJs(tpl["Baik"] || '')}" placeholder="Cth: Menunjukkan penguasaan keterampilan yang baik..." class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mb-2 text-xs text-white outline-none">
      <label class="block text-left text-[10px] font-bold text-yellow-300 mb-1">C — Cukup</label>
      <input id="tpl_C" value="${escJs(tpl["Cukup"] || '')}" placeholder="Cth: Menunjukkan penguasaan keterampilan yang cukup..." class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mb-2 text-xs text-white outline-none">
      <label class="block text-left text-[10px] font-bold text-red-300 mb-1">D — Kurang</label>
      <input id="tpl_K" value="${escJs(tpl["Kurang"] || '')}" placeholder="Cth: Perlu bimbingan dalam penguasaan keterampilan..." class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 text-xs text-white outline-none">`,
    background: '#1e293b', color: '#fff',
    showCancelButton: true, cancelButtonText: 'Batal',
    confirmButtonText: '<i class="fa-solid fa-save"></i> Simpan Format',
    preConfirm: () => ({
      "Sangat Baik": document.getElementById('tpl_SB').value.trim(),
      "Baik": document.getElementById('tpl_B').value.trim(),
      "Cukup": document.getElementById('tpl_C').value.trim(),
      "Kurang": document.getElementById('tpl_K').value.trim()
    })
  }).then(async (res) => {
    if (!res.isConfirmed) return;
    if (!configNilaiAktif || typeof configNilaiAktif !== 'object') configNilaiAktif = {};
    configNilaiAktif.format_deskripsi = res.value;
    try {
      await simpanKonfigurasiNilai('Data Nilai Eskul', '', configNilaiAktif);
      try { localStorage.removeItem('sisip_tpl_desk_ekskul'); } catch (e) {} // migrasi selesai
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Format tersimpan!', showConfirmButton: false, timer: 1500, background: '#1e293b', color: '#fff' });
      if (currentKategoriNilai === "Data Nilai Eskul") renderTabelEskul();
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'Gagal Menyimpan', text: e.message || '', background: '#1e293b', color: '#fff' });
    }
  });
}

// ---------- SEKSI UI "NILAI DESKRIPSI RAPORT" PADA DIALOG SET KOLOM ----------
/** HTML seksi "Nilai Sumatif" untuk dialog Set Kolom Pengetahuan/Keterampilan. */
function htmlSetSumatif() {
  const c = cfgDeskripsiRaport().sumatif;
  return `
    <div class="mt-4 pt-3 border-t border-white/10">
      <label class="block text-[10px] font-bold mb-1 text-green-300"><i class="fa-solid fa-file-lines"></i> Nilai Deskripsi Raport — Sumatif</label>
      <p class="text-[9px] text-slate-500 mb-2 italic">Nilai Sumatif = (Nilai Akhir Pengetahuan × Bobot P) + (Nilai Akhir Keterampilan × Bobot K). Nilai ≥ batas → teks "Tercapai Optimal", nilai &lt; batas → teks "Perlu Peningkatan".</p>
      <div class="flex gap-2 mb-2">
        <div class="w-1/2">
          <span class="text-[9px] text-slate-400">Sumber Nilai Sumatif</span>
          <select id="cfg_dr_mode" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1 text-[10px] text-white outline-none">
            <option value="rata-rata" ${c.mode === 'rata-rata' ? 'selected' : ''}>Gabungan Pengetahuan &amp; Keterampilan</option>
            <option value="manual" ${c.mode === 'manual' ? 'selected' : ''}>Isian Persentase (input manual)</option>
          </select>
        </div>
        <div class="w-1/2">
          <span class="text-[9px] text-slate-400">Batas Nilai (dapat diedit)</span>
          <input type="number" id="cfg_dr_batas" value="${c.batas}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1 text-center text-[10px] text-white outline-none">
        </div>
      </div>
      <div class="flex gap-2 mb-2">
        <div class="w-1/2">
          <span class="text-[9px] text-slate-400">Bobot Pengetahuan (%) (dapat diedit)</span>
          <input type="number" id="cfg_dr_bobot_p" value="${c.bobot_p}" min="0" max="100" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1 text-center text-[10px] text-white outline-none">
        </div>
        <div class="w-1/2">
          <span class="text-[9px] text-slate-400">Bobot Keterampilan (%) (dapat diedit)</span>
          <input type="number" id="cfg_dr_bobot_k" value="${c.bobot_k}" min="0" max="100" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1 text-center text-[10px] text-white outline-none">
        </div>
      </div>
      <span class="text-[9px] text-green-300 font-bold">Teks jika Nilai ≥ batas (dapat diedit)</span>
      <textarea id="cfg_dr_tinggi" rows="2" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1 mt-0.5 mb-2 text-[10px] text-white outline-none">${escapeHtml(c.teks_tinggi)}</textarea>
      <span class="text-[9px] text-red-300 font-bold">Teks jika Nilai &lt; batas (dapat diedit)</span>
      <textarea id="cfg_dr_rendah" rows="2" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1 mt-0.5 text-[10px] text-white outline-none">${escapeHtml(c.teks_rendah)}</textarea>
    </div>`;
}

/** Baca input seksi Sumatif dari popup dialog. */
function bacaSetSumatif(popup) {
  const angka = (sel, dflt) => { const v = Number(popup.querySelector(sel)?.value); return isNaN(v) ? dflt : v; };
  return {
    mode: popup.querySelector('#cfg_dr_mode')?.value || 'rata-rata',
    batas: angka('#cfg_dr_batas', 80),
    bobot_p: angka('#cfg_dr_bobot_p', 50),
    bobot_k: angka('#cfg_dr_bobot_k', 50),
    teks_tinggi: popup.querySelector('#cfg_dr_tinggi')?.value.trim() || 'TP Yang diukur dan Tercapai dengan Optimal',
    teks_rendah: popup.querySelector('#cfg_dr_rendah')?.value.trim() || 'TP yang diukur dan Perlu Peningkatan'
  };
}

/** HTML seksi "Nilai Capaian" (kategori Sikap). */
function htmlSetCapaian() {
  const c = cfgDeskripsiRaport().capaian;
  return `
    <div class="mt-4 pt-3 border-t border-white/10">
      <label class="block text-[10px] font-bold mb-1 text-green-300"><i class="fa-solid fa-file-lines"></i> Nilai Deskripsi Raport — Capaian</label>
      <p class="text-[9px] text-slate-500 mb-2 italic">Sumber: Nilai Akhir Sikap (input manual). Nilai ≥ batas → teks "Tertinggi", nilai &lt; batas → teks "Terendah".</p>
      <div class="w-1/2 mb-2">
        <span class="text-[9px] text-slate-400">Batas Nilai (dapat diedit)</span>
        <input type="number" id="cfg_dc_batas" value="${c.batas}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1 text-center text-[10px] text-white outline-none">
      </div>
      <span class="text-[9px] text-green-300 font-bold">Teks jika Nilai ≥ batas (dapat diedit)</span>
      <textarea id="cfg_dc_tinggi" rows="2" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1 mt-0.5 mb-2 text-[10px] text-white outline-none">${escapeHtml(c.teks_tinggi)}</textarea>
      <span class="text-[9px] text-red-300 font-bold">Teks jika Nilai &lt; batas (dapat diedit)</span>
      <textarea id="cfg_dc_rendah" rows="2" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1 mt-0.5 text-[10px] text-white outline-none">${escapeHtml(c.teks_rendah)}</textarea>
    </div>`;
}

/** Baca input seksi Capaian dari popup dialog. */
function bacaSetCapaian(popup) {
  return {
    batas: Number(popup.querySelector('#cfg_dc_batas')?.value) || 80,
    teks_tinggi: popup.querySelector('#cfg_dc_tinggi')?.value.trim() || 'Deskripsi Capaian Tertinggi',
    teks_rendah: popup.querySelector('#cfg_dc_rendah')?.value.trim() || 'Deskripsi Capaian Terendah'
  };
}

/** Gabungkan konfigurasi deskripsi raport baru ke config aktif (tanpa menimpa key lain). */
function gabungDeskripsiRaport(sumatif, capaian) {
  const lama = (configNilaiAktif && configNilaiAktif.deskripsi_raport) || {};
  configNilaiAktif.deskripsi_raport = {
    sumatif: sumatif ? sumatif : (lama.sumatif || DEFAULT_DESKRIPSI_RAPORT.sumatif),
    capaian: capaian ? capaian : (lama.capaian || DEFAULT_DESKRIPSI_RAPORT.capaian)
  };
}

function openPengaturanKolomPengetahuan() {
  const curKD = configNilaiAktif ? configNilaiAktif.active_kd : 2; 
  const curB = configNilaiAktif ? configNilaiAktif.bobot : {cp: 50, uts: 20, uas: 30};
  
  let kdsInput = '';
  for(let i=0; i<8; i++) {
    let k = configNilaiAktif?.kds?.[i] || {name: `Bab ${i+1}`, t1: 'T1', t2: 'T2', uh: 'UH'};
    let show = i < curKD ? 'block' : 'none';
    kdsInput += `
      <div class="kd-config-group p-2 border border-white/10 rounded mb-2 bg-black/20" id="cfg_group_kd${i}" style="display:${show}">
        <input type="text" id="cfg_nama_kd${i}" value="${k.name}" placeholder="Nama KD/Bab ${i+1}" class="w-full bg-black/40 border border-blue-500/50 rounded px-2 py-1.5 text-[11px] font-bold text-white mb-1 outline-none focus:border-blue-400 transition">
        <div class="flex gap-1">
          <input type="text" id="cfg_t1_kd${i}" value="${k.t1}" class="w-1/3 bg-black/40 border border-white/20 rounded px-1.5 py-1 text-[10px] text-white outline-none focus:border-blue-400" placeholder="Label T1">
          <input type="text" id="cfg_t2_kd${i}" value="${k.t2}" class="w-1/3 bg-black/40 border border-white/20 rounded px-1.5 py-1 text-[10px] text-white outline-none focus:border-blue-400" placeholder="Label T2">
          <input type="text" id="cfg_uh_kd${i}" value="${k.uh}" class="w-1/3 bg-black/40 border border-white/20 rounded px-1.5 py-1 text-[10px] text-white outline-none focus:border-blue-400" placeholder="Label UH">
        </div>
      </div>
    `;
  }

  Swal.fire({
    title: '<div class="text-base font-bold text-blue-400"><i class="fa-solid fa-tools"></i> Set Kolom Pengetahuan</div>',
    html: `
      <div class="text-left text-sm text-slate-300">
        <label class="block text-[10px] font-bold mb-1 text-blue-300">Jumlah Bab/KD Aktif</label>
        <select id="cfg_jumlah_kd" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 text-xs text-white mb-3 outline-none focus:border-blue-400">
            ${[1,2,3,4,5,6,7,8].map(n => `<option value="${n}" class="bg-slate-800 text-white" ${n==curKD ? 'selected':''}>${n} Bab / KD</option>`).join('')}
        </select>
        
        <label class="block text-[10px] font-bold mb-1 text-blue-300">Edit Label Per-KD (T1 / T2 / UH)</label>
        <div class="max-h-[35vh] overflow-y-auto custom-scrollbar pr-1">${kdsInput}</div>
        
        <label class="block text-[10px] font-bold mt-3 mb-1 text-purple-300">Persentase Bobot Akhir (%)</label>
        <div class="flex gap-2 mb-1">
          <div class="w-1/3"><span class="text-[9px]">Rata-rata CP</span><input type="number" id="cfg_b_cp" value="${curB.cp}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1 text-center text-xs text-white outline-none focus:border-purple-400"></div>
          <div class="w-1/3"><span class="text-[9px]">UTS</span><input type="number" id="cfg_b_uts" value="${curB.uts}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1 text-center text-xs text-white outline-none focus:border-purple-400"></div>
          <div class="w-1/3"><span class="text-[9px]">UAS</span><input type="number" id="cfg_b_uas" value="${curB.uas}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1 text-center text-xs text-white outline-none focus:border-purple-400"></div>
        </div>
        ${htmlSetSumatif()}
      </div>
    `,
    background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonText: '<i class="fa-solid fa-save"></i> Simpan',
    didOpen: () => {
        const popup = Swal.getPopup();
        popup.querySelector('#cfg_jumlah_kd').addEventListener('change', (e) => {
            const val = parseInt(e.target.value);
            for(let i=0; i<8; i++) {
                const el = popup.querySelector(`#cfg_group_kd${i}`);
                if(el) el.style.display = (i < val) ? 'block' : 'none';
            }
        });
    }
  }).then(async (res) => {
    if (res.isConfirmed) {
      const popup = Swal.getPopup();
      let count = parseInt(popup.querySelector('#cfg_jumlah_kd').value); 
      let kdsArr = [];
      
      for(let i=0; i<count; i++) {
        kdsArr.push({ 
          name: popup.querySelector(`#cfg_nama_kd${i}`).value || `KD ${i+1}`, 
          t1: popup.querySelector(`#cfg_t1_kd${i}`).value || 'T1', 
          t2: popup.querySelector(`#cfg_t2_kd${i}`).value || 'T2', 
          uh: popup.querySelector(`#cfg_uh_kd${i}`).value || 'UH' 
        });
      }
      
      configNilaiAktif = { 
        active_kd: count, 
        kds: kdsArr, 
        bobot: { 
            cp: parseInt(popup.querySelector('#cfg_b_cp').value)||0, 
            uts: parseInt(popup.querySelector('#cfg_b_uts').value)||0, 
            uas: parseInt(popup.querySelector('#cfg_b_uas').value)||0 
        } 
      };
      gabungDeskripsiRaport(bacaSetSumatif(popup), null);
      
      const mapel = document.getElementById('select-mapel-nilai').value;
      Swal.fire({ title: 'Menyimpan Pengaturan...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
      
      try {
          const response = await simpanKonfigurasiNilai(currentKategoriNilai, mapel, configNilaiAktif);
          const result = await response.json();
          if (result.status === 'success') {
              Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Tersimpan!', showConfirmButton: false, timer: 1500, background: '#1e293b', color: '#fff'});
              loadDataNilai(); // Segarkan tabel dengan label baru
          } else throw new Error(result.message);
      } catch(e) {
          Swal.fire({icon: 'error', title: 'Gagal Menyimpan', text: e.message, background: '#1e293b', color: '#fff'});
      }
    }
  });
}

// [REQ 3] Router Set Kolom


// Fungsi Baru untuk Keterampilan
// [REQ 2 & 4] Kategori Keterampilan: Edit Nama Kolom, Sub-CP 1-4, Projek 1-4, Porto 1-4
function openPengaturanKolomKeterampilan() {
  if(!configNilaiAktif || !configNilaiAktif.labels) {
    configNilaiAktif = { 
        active_cp: 2, active_sub_cp: 4, active_proj: 4, active_port: 4, 
        bobot: { prak: 40, proj: 30, port: 30 },
        labels: { cp: ["CP A","CP B","CP C","CP D"], sub: ["1","2","3","4"], proj: ["Projek 1","Projek 2","Projek 3","Projek 4"], port: ["Porto 1","Porto 2","Porto 3","Porto 4"] }
    };
  }

  const cur = configNilaiAktif;
  
  const genInputs = (prefix, activeCount, labelsArray, placeholderPrefix) => {
     let html = `<div class="flex gap-1 mb-2">`;
     for(let i=0; i<4; i++) {
         let display = i < activeCount ? 'block' : 'none';
         html += `<input type="text" id="cfg_lbl_${prefix}_${i}" value="${labelsArray[i] || `${placeholderPrefix} ${i+1}`}" placeholder="${placeholderPrefix} ${i+1}" class="w-1/4 bg-black/40 border border-blue-500/50 rounded px-1.5 py-1 text-[10px] text-white outline-none focus:border-blue-400 transition" style="display:${display}">`;
     }
     return html + `</div>`;
  };

  Swal.fire({
    title: '<div class="text-base font-bold text-blue-400"><i class="fa-solid fa-tools"></i> Set Kolom Keterampilan</div>',
    width: '600px',
    html: `
      <div class="text-left text-sm text-slate-300 max-h-[65vh] overflow-y-auto custom-scrollbar pr-2">
        <label class="block text-[10px] font-bold mb-1 text-blue-300">Komponen Aktif (Maks 4)</label>
        <div class="flex gap-2 mb-3">
            <div class="w-1/4 text-center"><span class="text-[9px]">Jml CP</span><input type="number" id="cfg_cp_count" value="${cur.active_cp}" max="4" min="1" class="w-full bg-slate-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-blue-400" onchange="updateVis('cp', this.value)"></div>
            <div class="w-1/4 text-center"><span class="text-[9px]">Sub-CP</span><input type="number" id="cfg_sub_count" value="${cur.active_sub_cp}" max="4" min="1" class="w-full bg-slate-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-indigo-400" onchange="updateVis('sub', this.value)"></div>
            <div class="w-1/4 text-center"><span class="text-[9px]">Projek</span><input type="number" id="cfg_proj_count" value="${cur.active_proj}" max="4" min="1" class="w-full bg-slate-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-purple-400" onchange="updateVis('proj', this.value)"></div>
            <div class="w-1/4 text-center"><span class="text-[9px]">Porto</span><input type="number" id="cfg_port_count" value="${cur.active_port}" max="4" min="1" class="w-full bg-slate-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-yellow-400" onchange="updateVis('port', this.value)"></div>
        </div>

        <label class="block text-[10px] font-bold mt-2 text-blue-300">Edit Label CP (Praktikum Utama)</label>
        ${genInputs('cp', cur.active_cp, cur.labels.cp, 'CP')}
        
        <label class="block text-[10px] font-bold mt-2 text-indigo-300">Edit Label Sub-CP (Kolom Penilaian per CP)</label>
        ${genInputs('sub', cur.active_sub_cp, cur.labels.sub, 'Sub')}
        
        <label class="block text-[10px] font-bold mt-2 text-purple-300">Edit Label Projek/Produk</label>
        ${genInputs('proj', cur.active_proj, cur.labels.proj, 'Projek')}
        
        <label class="block text-[10px] font-bold mt-2 text-yellow-300">Edit Label Portofolio</label>
        ${genInputs('port', cur.active_port, cur.labels.port, 'Porto')}
        
        <label class="block text-[10px] font-bold mt-4 mb-1 text-green-300">Persentase Bobot Akhir (%)</label>
        <div class="flex gap-2 mb-1">
          <div class="w-1/3 text-center"><span class="text-[9px] font-bold">Praktikum</span><input type="number" id="cfg_b_prak" value="${cur.bobot.prak}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 text-center text-xs text-white outline-none focus:border-green-500"></div>
          <div class="w-1/3 text-center"><span class="text-[9px] font-bold">Projek</span><input type="number" id="cfg_b_proj" value="${cur.bobot.proj}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 text-center text-xs text-white outline-none focus:border-green-500"></div>
          <div class="w-1/3 text-center"><span class="text-[9px] font-bold">Porto</span><input type="number" id="cfg_b_port" value="${cur.bobot.port}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 text-center text-xs text-white outline-none focus:border-green-500"></div>
        </div>
        ${htmlSetSumatif()}
      </div>
    `,
    background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonText: '<i class="fa-solid fa-save"></i> Simpan',
    didOpen: () => {
        window.updateVis = function(prefix, val) {
            const popup = Swal.getPopup();
            for(let i=0; i<4; i++) {
                let el = popup.querySelector(`#cfg_lbl_${prefix}_${i}`);
                if(el) el.style.display = (i < parseInt(val)) ? 'block' : 'none';
            }
        };
    }
  }).then(async (res) => {
    if (res.isConfirmed) {
      const popup = Swal.getPopup();
      const getArr = (prefix) => [0,1,2,3].map(i => popup.querySelector(`#cfg_lbl_${prefix}_${i}`).value);
      
      let cpCount = parseInt(popup.querySelector('#cfg_cp_count').value) || 2;
      let subCount = parseInt(popup.querySelector('#cfg_sub_count').value) || 4;
      let projCount = parseInt(popup.querySelector('#cfg_proj_count').value) || 4;
      let portCount = parseInt(popup.querySelector('#cfg_port_count').value) || 4;

      configNilaiAktif = { 
        active_cp: cpCount > 4 ? 4 : cpCount,
        active_sub_cp: subCount > 4 ? 4 : subCount,
        active_proj: projCount > 4 ? 4 : projCount,
        active_port: portCount > 4 ? 4 : portCount,
        bobot: { 
            prak: parseInt(popup.querySelector('#cfg_b_prak').value)||0, 
            proj: parseInt(popup.querySelector('#cfg_b_proj').value)||0, 
            port: parseInt(popup.querySelector('#cfg_b_port').value)||0 
        },
        labels: { cp: getArr('cp'), sub: getArr('sub'), proj: getArr('proj'), port: getArr('port') }
      };
      gabungDeskripsiRaport(bacaSetSumatif(popup), null);
      
      const mapel = document.getElementById('select-mapel-nilai').value;
      Swal.fire({ title: 'Menyimpan Pengaturan...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
      
      try {
          const response = await simpanKonfigurasiNilai(currentKategoriNilai, mapel, configNilaiAktif);
          const result = await response.json();
          if (result.status === 'success') {
              Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Tersimpan!', showConfirmButton: false, timer: 1500, background: '#1e293b', color: '#fff'});
              loadDataNilai();
          } else throw new Error(result.message);
      } catch(e) {
          Swal.fire({icon: 'error', title: 'Gagal Menyimpan', text: e.message, background: '#1e293b', color: '#fff'});
      }
    }
  });
}

// [REQ 2] Set Kolom Sikap dengan 4 CP dan 4 Sub-CP Text Box Editable
function openPengaturanKolomSikap() {
  if(!configNilaiAktif || !configNilaiAktif.labels) {
    configNilaiAktif = { active_cp: 3, active_sub_cp: 3, active_teman: 5, labels: { cp: ["CP A","CP B","CP C","CP D"], sub: ["1","2","3","4"] } };
  }
  const cur = configNilaiAktif;
  
  const genInputs = (prefix, activeCount, labelsArray, placeholderPrefix) => {
     let html = `<div class="flex gap-1 mb-2">`;
     for(let i=0; i<4; i++) {
         let display = i < activeCount ? 'block' : 'none';
         html += `<input type="text" id="cfg_lbl_${prefix}_${i}" value="${labelsArray[i] || `${placeholderPrefix} ${i+1}`}" placeholder="${placeholderPrefix} ${i+1}" class="w-1/4 bg-black/40 border border-blue-500/50 rounded px-1.5 py-1 text-[10px] text-white outline-none focus:border-blue-400 transition" style="display:${display}">`;
     }
     return html + `</div>`;
  };

  const st = cfgSikapTeman();

  Swal.fire({
    title: '<div class="text-base font-bold text-blue-400"><i class="fa-solid fa-tools"></i> Set Kolom Sikap</div>',
    width: '500px',
    html: `
      <div class="text-left text-sm text-slate-300 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
        <label class="block text-[10px] font-bold mb-1 text-blue-300">Komponen Aktif</label>
        <div class="flex gap-2 mb-3">
            <div class="w-1/2 text-center"><span class="text-[9px]">Jml CP (Max 4)</span><input type="number" id="cfg_cp_count" value="${cur.active_cp}" max="4" min="1" class="w-full bg-slate-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-blue-400" onchange="updateVis('cp', this.value)"></div>
            <div class="w-1/2 text-center"><span class="text-[9px]">Sub-CP (Max 4)</span><input type="number" id="cfg_sub_count" value="${cur.active_sub_cp}" max="4" min="1" class="w-full bg-slate-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-indigo-400" onchange="updateVis('sub', this.value)"></div>
        </div>

        <label class="block text-[10px] font-bold mt-2 text-blue-300">Edit Label Observasi CP</label>
        ${genInputs('cp', cur.active_cp, cur.labels.cp, 'CP')}
        
        <label class="block text-[10px] font-bold mt-2 text-indigo-300">Edit Label Sub-CP</label>
        ${genInputs('sub', cur.active_sub_cp, cur.labels.sub, 'Sub')}
        <button type="button" onclick="popupJurnalSikap()" class="w-full mt-3 px-3 py-2 rounded bg-green-600 hover:bg-green-700 text-white text-[11px] font-bold transition flex items-center justify-center gap-2" title="Kriteria skor 1-4, kuesioner teman sejawat, sesi murid & jurnal guru">
          <i class="fa-solid fa-book-open"></i> Jurnal Penilaian Sikap
          <span class="text-[8px] font-normal ${st.sesi_buka ? 'text-green-200' : 'text-red-200'}">— Sesi ${st.sesi_buka ? 'BUKA' : 'TUTUP'}</span>
        </button>
        <div class="mt-4 pt-3 border-t border-white/10 text-[10px] text-slate-400 leading-relaxed">
          <label class="block text-[10px] font-bold mb-1 text-green-300"><i class="fa-solid fa-calculator"></i> Nilai Akhir & Deskripsi Capaian (Otomatis)</label>
          NA = (Observasi CP + Penilaian Diri + Teman Sejawat + Nilai Jurnal) berbobot — bobot diedit di tombol <b class="text-green-300">"Jurnal Penilaian Sikap"</b>.<br>
          Deskripsi Capaian = teks kriteria skor hasil konversi: <b class="text-yellow-300">80-100=4, 60-79=3, 40-59=2, &lt;40=1</b>.
        </div>
      </div>
    `,
    background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonText: '<i class="fa-solid fa-save"></i> Simpan',
    didOpen: () => {
        window.updateVis = function(prefix, val) {
            const popup = Swal.getPopup();
            for(let i=0; i<4; i++) {
                let el = popup.querySelector(`#cfg_lbl_${prefix}_${i}`);
                if(el) el.style.display = (i < parseInt(val)) ? 'block' : 'none';
            }
        };
    }
  }).then(async (res) => {
    if (res.isConfirmed) {
      const popup = Swal.getPopup();
      const getArr = (prefix) => [0,1,2,3].map(i => popup.querySelector(`#cfg_lbl_${prefix}_${i}`).value);
      
      let cpCount = parseInt(popup.querySelector('#cfg_cp_count').value) || 3;
      let subCount = parseInt(popup.querySelector('#cfg_sub_count').value) || 3;

      configNilaiAktif = { 
        active_cp: cpCount > 4 ? 4 : cpCount, active_sub_cp: subCount > 4 ? 4 : subCount,
        labels: { cp: getArr('cp'), sub: getArr('sub') },
        sikap_teman: cfgSikapTeman() // pertahankan konfigurasi teman sejawat, bobot & jurnal
      };
      
      const mapel = document.getElementById('select-mapel-nilai').value;
      Swal.fire({ title: 'Menyimpan Pengaturan...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
      await simpanKonfigurasiNilai(currentKategoriNilai, mapel, configNilaiAktif);
      Swal.close(); loadDataNilai();
    }
  });
}

// --- HELPER OPSI KOLOM MASAL ---
function getMasalColumnOptionsHTML() {
    let optHtml = '';
    const cfg = configNilaiAktif;
    if (currentKategoriNilai === "Data Nilai Pengetahuan") {
      for(let i=0; i<cfg.active_kd; i++) { 
          let ltr = ['A','B','C','D','E','F','G','H'][i]; 
          optHtml += `<option value="KD_${ltr}_T1" class="bg-slate-800 text-white">${cfg.kds[i].t1} - ${cfg.kds[i].name}</option><option value="KD_${ltr}_T2" class="bg-slate-800 text-white">${cfg.kds[i].t2} - ${cfg.kds[i].name}</option><option value="KD_${ltr}_UH" class="bg-slate-800 text-white">${cfg.kds[i].uh} - ${cfg.kds[i].name}</option>`;
      }
      optHtml += `<option value="UTS" class="bg-slate-800 text-white">Nilai UTS</option><option value="UAS" class="bg-slate-800 text-white">Nilai UAS/UKK</option>`;
    } else if (currentKategoriNilai === "Data Nilai Keterampilan") {
      const LTRS = ['A','B','C','D'];
      for(let i=0; i<cfg.active_cp; i++) {
          for(let j=1; j<=cfg.active_sub_cp; j++) optHtml += `<option value="Prak_${LTRS[i]}_${j}" class="bg-slate-800 text-white">${cfg.labels?.cp[i]||`CP ${LTRS[i]}`} - Sub ${cfg.labels?.sub[j-1]||j}</option>`;
      }
      for(let j=1; j<=cfg.active_proj; j++) optHtml += `<option value="Proj_${j}" class="bg-slate-800 text-white">${cfg.labels?.proj[j-1] || `Projek ${j}`}</option>`;
      for(let j=1; j<=cfg.active_port; j++) optHtml += `<option value="Port_${j}" class="bg-slate-800 text-white">${cfg.labels?.port[j-1] || `Porto ${j}`}</option>`;
    } else if (currentKategoriNilai === "Data Nilai Sikap") {
      const LTRS = ['A','B','C','D'];
      for(let i=0; i<cfg.active_cp; i++) {
          for(let j=1; j<=cfg.active_sub_cp; j++) optHtml += `<option value="CP_${LTRS[i]}${j}" class="bg-slate-800 text-white">Obs ${cfg.labels?.cp[i]||`CP ${LTRS[i]}`} - Sub ${cfg.labels?.sub[j-1]||j}</option>`;
      }
      optHtml += `<option value="Diri" class="bg-slate-800 text-white">Penilaian Diri</option>`;
      optHtml += `<option value="Jurnal" class="bg-slate-800 text-white">Nilai Jurnal</option>`;
    } else if (currentKategoriNilai === "Data Nilai Eskul") {
      optHtml += `<option value="Nilai" class="bg-slate-800 text-white">Nilai (A, B, C, D)</option>`;
    }
    return optHtml;
}

// --- FUNGSI INPUT MASAL UTAMA ---
// --- FUNGSI INPUT MASAL INTERAKTIF (UPDATE) ---
function openPenilaianMasal() {
  Swal.fire({
    title: '<div class="text-base font-bold">Input Masal Interaktif</div>',
    html: `
      <div class="text-left">
        <label class="text-[10px] text-blue-300 font-bold">Pilih Kolom ${currentKategoriNilai.replace('Data Nilai ','')}</label>
        <select id="masal_kolom" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 text-xs text-white mb-3 outline-none focus:border-blue-500">${getMasalColumnOptionsHTML()}</select>
        
        <label class="text-[10px] text-green-300 font-bold">Isi Masal & Reset Ceklis</label>
        <div class="flex gap-2 mb-2 items-center">
            <input type="number" id="masal_nilai_master" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1 text-xs text-white outline-none focus:border-green-500" placeholder="0-100">
            <button type="button" id="btn-terapkan-master" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-[10px] font-bold shadow-md transition whitespace-nowrap">Terapkan <i class="fa-solid fa-bolt"></i></button>
            <span id="notif-masal" class="text-[10px] text-green-400 font-bold hidden transition-all">Berhasil!</span>
        </div>
        
        <div class="flex justify-between items-center mb-1 mt-2">
          <label class="text-[10px] text-purple-300 font-bold">Daftar Siswa:</label>
          <div class="flex gap-1.5">
            <button type="button" id="btn-qr-masal-nilai" class="text-[9px] bg-blue-600 px-1.5 py-1 rounded hover:bg-blue-700 text-white shadow-md transition">Scan QR</button>
            <button type="button" id="btn-toggle-masal" class="text-[9px] bg-white/10 px-1.5 py-1 rounded hover:bg-white/20 text-white transition">Pilih Semua</button>
          </div>
        </div>
        
        <!-- Ukuran Canvas QR diperkecil -->
        <div id="qr-reader-nilai-masal" class="hidden border-2 border-blue-500/50 rounded-lg mb-2 overflow-hidden shadow-inner bg-black/50" style="max-width: 180px; margin: 0 auto;"></div>
        
        <div class="max-h-[35vh] overflow-y-auto custom-scrollbar bg-black/20 rounded border border-white/10 p-1 scroll-smooth" id="container-chk-masal"></div>
      </div>
    `,
    background: '#1e293b', color: '#fff',
    showConfirmButton: true,
    confirmButtonText: '<i class="fa-solid fa-save"></i> Simpan & Selesai',
    confirmButtonColor: '#16a34a',
    showCancelButton: true,
    cancelButtonText: 'Batal', // Tombol Batal resmi
    cancelButtonColor: '#475569',
    didOpen: () => {
        const popup = Swal.getPopup();
        const selectKolom = popup.querySelector('#masal_kolom');
        const container = popup.querySelector('#container-chk-masal');
        
        const renderListSiswa = () => {
            const field = selectKolom.value;
            let html = '';
            listMuridKelas.forEach((m, idx) => {
                let valSiswa = document.getElementById(`N_${m.NIS}_${field}`)?.value || '';
                html += `
                <label id="lbl-masal-${m.NIS}" class="flex items-center gap-2 p-1 border-b border-white/5 cursor-pointer hover:bg-white/5 rounded transition">
                    <input type="checkbox" class="chk-masal w-3.5 h-3.5" value="${m.NIS}" id="chk-masal-${m.NIS}">
                    <span class="text-xs text-slate-300 truncate font-medium flex-1">${idx+1}. ${m["Nama Lengkap"]}</span>
                    <input type="number" data-nis="${m.NIS}" class="input-masal-individu w-12 bg-black/60 border border-white/20 rounded px-1 py-1 text-[11px] text-center font-bold text-green-300 focus:bg-white/10 outline-none" value="${valSiswa}" placeholder="-">
                </label>`;
            });
            container.innerHTML = html;
            
            popup.querySelectorAll('.input-masal-individu').forEach(inp => {
                inp.addEventListener('change', (e) => {
                    let nis = e.target.getAttribute('data-nis');
                    let val = e.target.value;
                    if(val > 100) { val = 100; e.target.value = 100; }
                    if(val < 0) { val = 0; e.target.value = 0; }
                    updateNilaiLangsung(nis, selectKolom.value, val);
                });
            });
        };
        
        selectKolom.addEventListener('change', renderListSiswa);
        renderListSiswa(); 
        
        // Tombol Terapkan Master TANPA Menutup Popup
        popup.querySelector('#btn-terapkan-master').addEventListener('click', () => {
            let masterVal = popup.querySelector('#masal_nilai_master').value;
            if(masterVal === '') return;
            if(masterVal > 100) masterVal = 100; if(masterVal < 0) masterVal = 0;
            
            let checked = popup.querySelectorAll('.chk-masal:checked');
            if(checked.length === 0) return;
            
            let field = selectKolom.value;
            checked.forEach(chk => {
                let nis = chk.value;
                let inp = popup.querySelector(`.input-masal-individu[data-nis="${nis}"]`);
                if(inp) inp.value = masterVal; 
                updateNilaiLangsung(nis, field, masterVal); 
                chk.checked = false;
            });
            
            const notif = popup.querySelector('#notif-masal');
            notif.classList.remove('hidden');
            setTimeout(() => notif.classList.add('hidden'), 2000);
        });

        let isAll = false;
        popup.querySelector('#btn-toggle-masal').addEventListener('click', (e) => {
            isAll = !isAll; e.target.innerText = isAll ? "Batal Pilih" : "Pilih Semua";
            popup.querySelectorAll('.chk-masal').forEach(c => c.checked = isAll);
        });
        
        let scannerNilai = null;
        popup.querySelector('#btn-qr-masal-nilai').onclick = () => {
          const qrContainer = popup.querySelector('#qr-reader-nilai-masal');
          if(qrContainer.classList.contains('hidden')) {
            qrContainer.classList.remove('hidden');
            scannerNilai = new Html5QrcodeScanner("qr-reader-nilai-masal", { fps: 10, qrbox: {width: 120, height: 120} });
            scannerNilai.render((nis) => {
              const chk = popup.querySelector(`#chk-masal-${nis}`);
              if (chk && !chk.checked) {
                chk.checked = true; 
                const lbl = popup.querySelector(`#lbl-masal-${nis}`);
                lbl.classList.add('bg-green-900/60');
                lbl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => lbl.classList.remove('bg-green-900/60'), 1500);
                
                // 1. TTS Cepat Bahasa Indonesia
                const nama = listMuridKelas.find(m => m.NIS == nis)?.["Nama Lengkap"] || "Siswa"; 
                const utt = new SpeechSynthesisUtterance(nama); 
                utt.lang = 'id-ID'; 
                utt.rate = 1.4; // Kecepatan baca cepat
                window.speechSynthesis.speak(utt);
                
                // 2. Auto-focus ke kolom input siswa yang di-scan
                const inp = popup.querySelector(`.input-masal-individu[data-nis="${nis}"]`);
                if(inp) {
                    inp.focus();
                    inp.select();
                }
              }
            }, () => {});
          } else {
            qrContainer.classList.add('hidden');
            if(scannerNilai) { scannerNilai.clear(); scannerNilai = null; }
          }
        };
    }
  }).then((res) => {
      if (res.isConfirmed) {
          // Jika diklik Simpan & Selesai
          forceSyncSemuaNilai();
      } else {
          // Jika diklik "Batal", muat ulang data untuk membatalkan perubahan live sementara
          loadDataNilai();
          Swal.fire({toast: true, position: 'top-end', icon: 'info', title: 'Perubahan dibatalkan.', showConfirmButton: false, timer: 1500, background: '#1e293b', color: '#fff'});
      }
  });
}

// Fungsi untuk memanggil Scanner di dalam Modal
function bukaScannerModal() {
    const modal = document.getElementById('modal-scanner');
    modal.classList.remove('hidden');
    modal.classList.add('flex'); // Pastikan menggunakan flex untuk centering

    // html5QrcodeScanner sudah dideklarasikan di baris paling atas app.js
    if (!html5QrcodeScanner) {
        html5QrcodeScanner = new Html5QrcodeScanner(
            "qr-reader-in-modal", 
            { fps: 10, qrbox: { width: 250, height: 250 } }, 
            false // set true jika butuh log detail
        );
    }
    
    html5QrcodeScanner.render(onScanSuccess, onScanFailure);
}

function tutupScannerModal() {
    const modal = document.getElementById('modal-scanner');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    
    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear().catch(err => console.error("Gagal menutup kamera", err));
    }
}

function onScanSuccess(decodedText, decodedResult) {
    tutupScannerModal(); // Otomatis tutup kamera jika berhasil
    showToast('success', `Berhasil scan: ${decodedText}`);
    
    // TODO: Masukkan logika absensi Anda di sini berdasarkan decodedText (misal: mencari NIS)
    console.log("Hasil QR:", decodedText);
}

function onScanFailure(error) {
    // Diabaikan agar tidak spam console saat kamera sedang mencari QR Code
}

function updateNilaiLangsung(nis, field, val) {
    // Nilai Eskul memakai huruf A-D (select) — normalisasi input masal ke huruf besar
    if (field === 'Nilai' && currentKategoriNilai === "Data Nilai Eskul") val = String(val).trim().toUpperCase();
    let el = document.getElementById(`N_${nis}_${field}`);
    if(el) {
        recordUndo(nis, el.id, el.value, val);
        el.value = val;
        // Kalkulasi Live UI
        if (currentKategoriNilai === "Data Nilai Pengetahuan") kalkulasiPengetahuan(nis, true);
        else if (currentKategoriNilai === "Data Nilai Keterampilan") kalkulasiKeterampilan(nis, true);
        else if (currentKategoriNilai === "Data Nilai Sikap") kalkulasiSikap(nis, true);
        else if (currentKategoriNilai === "Data Nilai Eskul") kalkulasiEskul(nis, true);
    }
}

async function hapusPilihanAbsen() {
    const konfirmasi = await Swal.fire({
        title: 'Kosongkan Data?',
        text: 'Apakah Anda yakin ingin menghapus pilihan absensi (H, S, I, A, D) yang belum disimpan?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Ya, Kosongkan',
        cancelButtonText: 'Batal',
        background: '#1e293b',
        color: '#fff'
    });

    if (konfirmasi.isConfirmed) {
        // Kosongkan pilihan radio absensi (H/S/I/A/D) yang sedang dibuka di modal
        document.querySelectorAll('input[name^="absen_"]').forEach(r => {
            r.checked = false;
            r.dataset.on = '0';
        });
        showToast('success', 'Pilihan absen berhasil dikosongkan.');
    }
}

// --- MODUL IMPORT & TEMPLATE EXCEL (UPDATE) ---
function openImportExcel() {
  Swal.fire({
    title: '<div class="text-base font-bold text-green-400"><i class="fa-solid fa-file-excel"></i> Import Data Excel</div>',
    html: `
      <div class="text-sm text-slate-300 mb-4 text-left">
        1. Unduh template format tabel di bawah ini.<br>
        2. Isi nilai pada aplikasi Excel di komputer Anda.<br>
        3. Upload kembali file yang sudah diisi ke sini.
      </div>
      <button onclick="downloadTemplateExcel()" class="w-full mb-4 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded shadow-md text-xs font-bold transition"><i class="fa-solid fa-download"></i> Download Format Template ${currentKategoriNilai.replace('Data Nilai ','')}</button>
      <div class="border-t border-white/20 pt-4">
          <label class="block text-left text-[10px] font-bold text-green-300 mb-1">Upload File Excel (.xlsx)</label>
          <input type="file" id="file-import" accept=".xlsx, .xls" class="w-full bg-black/40 border border-white/20 rounded p-2 text-xs text-white outline-none focus:border-green-500">
      </div>
    `,
    background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonText: '<i class="fa-solid fa-upload"></i> Proses Import',
    preConfirm: () => {
        const file = document.getElementById('file-import').files[0];
        if(!file) { Swal.showValidationMessage('Pilih file Excel terlebih dahulu!'); return false; }
        return file;
    }
  }).then(res => {
      if(res.isConfirmed) prosesImportDataExcel(res.value);
  });
}

function downloadTemplateExcel() {
    if (typeof XLSX === 'undefined') return Swal.fire('Error', 'Library SheetJS tidak ditemukan.', 'error');
    
    const mapel = document.getElementById('select-mapel-nilai').value;
    const kelas = document.getElementById('select-kelas-nilai').value;
    const cfg = configNilaiAktif;
    
    // [UPDATE] Tambahkan Kolom No
    let headers = ["No", "NIS", "Nama Siswa"];
    
    if (currentKategoriNilai === "Data Nilai Pengetahuan") {
        for(let i=0; i<cfg.active_kd; i++) { headers.push(`KD ${['A','B','C','D','E','F','G','H'][i]} T1`, `KD ${['A','B','C','D','E','F','G','H'][i]} T2`, `KD ${['A','B','C','D','E','F','G','H'][i]} UH`); }
        headers.push("UTS", "UAS", "Keterangan");
    } else if (currentKategoriNilai === "Data Nilai Keterampilan") {
        const LTRS = ['A','B','C','D'];
        for(let i=0; i<cfg.active_cp; i++) { for(let j=1; j<=cfg.active_sub_cp; j++) headers.push(`Prak ${LTRS[i]}_${j}`); }
        for(let j=1; j<=cfg.active_proj; j++) headers.push(`Proj_${j}`);
        for(let j=1; j<=cfg.active_port; j++) headers.push(`Port_${j}`);
        headers.push("Keterangan");
    } else if (currentKategoriNilai === "Data Nilai Sikap") {
        const LTRS = ['A','B','C','D'];
        for(let i=0; i<cfg.active_cp; i++) { for(let j=1; j<=cfg.active_sub_cp; j++) headers.push(`CP_${LTRS[i]}${j}`); }
        headers.push("Diri");
        headers.push("Jurnal", "AkhirSikap", "Keterangan");
    }

    let dataRows = [
        ["FORMAT IMPORT NILAI", currentKategoriNilai.replace('Data Nilai ', '')],
        ["Tahun", currentTahun],
        ["Semester", currentSemesterNilai],
        ["Mapel", mapel],
        ["Kelas", kelas],
        ["INFO", "Hanya isi nilai berupa angka 0-100 pada kolom kosong."],
        headers
    ];
    
    listMuridKelas.forEach((m, idx) => {
        // [UPDATE] Sisipkan Index + 1 sebagai No Absen
        let row = [idx + 1, m.NIS, m["Nama Lengkap"]];
        
        // Loop dimulai dari index 3 karena 0=No, 1=NIS, 2=Nama
        for(let i=3; i<headers.length; i++) {
            let hk = headers[i];
            let targetId = "";
            if(hk === "Keterangan") targetId = `KET_${m.NIS}`;
            else if(currentKategoriNilai === "Data Nilai Pengetahuan") targetId = `N_${m.NIS}_${hk.replace(/ /g,'_')}`;
            else targetId = `N_${m.NIS}_${hk}`;
            
            let el = document.getElementById(targetId);
            row.push(el ? el.value : "");
        }
        dataRows.push(row);
    });

    const ws = XLSX.utils.aoa_to_sheet(dataRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template_Nilai");
    XLSX.writeFile(wb, `Template_${currentKategoriNilai.replace('Data Nilai ','')}_${kelas}_${mapel}.xlsx`);
}

function prosesImportDataExcel(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const ws = workbook.Sheets[workbook.SheetNames[0]];
            const jsonArray = XLSX.utils.sheet_to_json(ws, {header: 1}); 

            if(jsonArray.length < 7) throw new Error("Format tidak dikenali.");
            
            const tTahun = jsonArray[1][1]; const tSmt = jsonArray[2][1];
            const tMapel = jsonArray[3][1]; const tKelas = jsonArray[4][1];
            const curMapel = document.getElementById('select-mapel-nilai').value;
            const curKelas = document.getElementById('select-kelas-nilai').value;
            
            let warningMsg = "";
            if(tTahun != currentTahun) warningMsg += `<br>- Tahun (File: ${tTahun})`;
            if(tSmt != currentSemesterNilai) warningMsg += `<br>- Smt (File: ${tSmt})`;
            if(tMapel != curMapel) warningMsg += `<br>- Mapel (File: ${tMapel})`;
            if(tKelas != curKelas) warningMsg += `<br>- Kelas (File: ${tKelas})`;
            
            const eksekusiData = () => {
                const headers = jsonArray[6]; 
                let countImport = 0;
                
                for(let i=7; i<jsonArray.length; i++) {
                    let row = jsonArray[i];
                    // [UPDATE] Membaca NIS di Index 1 (Karena Index 0 sekarang adalah No)
                    if(!row || !row[1]) continue; 
                    let nis = row[1].toString();
                    
                    const tr = document.querySelector(`tr[data-nis="${nis}"]`);
                    if(tr) {
                        // Loop dimulai dari index 3
                        for(let j=3; j<headers.length; j++) {
                            let headerKey = headers[j];
                            if(!headerKey) continue;
                            let val = row[j] !== undefined ? row[j] : "";
                            
                            if(val !== "" && !isNaN(val)) {
                                if(Number(val) > 100) val = 100;
                                if(Number(val) < 0) val = 0;
                            }

                            let targetId = "";
                            if(headerKey === "Keterangan") targetId = `KET_${nis}`;
                            else if(currentKategoriNilai === "Data Nilai Pengetahuan") targetId = `N_${nis}_${headerKey.replace(/ /g,'_')}`;
                            else targetId = `N_${nis}_${headerKey}`;
                            
                            let inputEl = document.getElementById(targetId);
                            if(inputEl) inputEl.value = val;
                        }
                        
                        if (currentKategoriNilai === "Data Nilai Pengetahuan") kalkulasiPengetahuan(nis, true);
                        else if (currentKategoriNilai === "Data Nilai Keterampilan") kalkulasiKeterampilan(nis, true);
                        else if (currentKategoriNilai === "Data Nilai Sikap") kalkulasiSikap(nis, true);
                        countImport++;
                    }
                }
                Swal.fire('Sukses', `${countImport} data siswa berhasil diinput. Menyimpan...`, 'success');
                setTimeout(() => { forceSyncSemuaNilai(); }, 1500);
            };

            if(warningMsg !== "") {
                Swal.fire({
                    title: 'Data Sinkronisasi Berbeda!',
                    html: `Ketidakcocokan file dengan kelas yang dibuka: ${warningMsg}<br><br><b>Tetap lanjutkan paksa import?</b>`,
                    icon: 'warning', showCancelButton: true, confirmButtonText: 'Ya, Paksa', cancelButtonText: 'Batal', background: '#1e293b', color: '#fff'
                }).then((r) => { if(r.isConfirmed) eksekusiData(); });
            } else eksekusiData();
        } catch(err) {
            Swal.fire('Error Import', err.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

// --- UPDATE: EXPORT ROUTER ---
function getExportHTMLNilai() {
    if (currentKategoriNilai === "Data Nilai Pengetahuan") return getExportHTMLPengetahuan(); // Ubah nama fungsi export pengetahuan Anda yang lama menjadi ini
    else if (currentKategoriNilai === "Data Nilai Keterampilan") return getExportHTMLKeterampilan();
    return "Laporan tidak tersedia.";
}

function getExportHTMLPengetahuan() {
  
  const mapel = document.getElementById('select-mapel-nilai').value;
  const kelas = document.getElementById('select-kelas-nilai').value;
  const waliKelas = getNamaWaliKelas(kelas);
  const namaGuru = currentUser && currentUser.user ? (currentUser.user["Nama Guru"] || "_____________________") : "_____________________";
  const kepsek = namaKepsekGlobal || "_____________________";
  const maxKD = configNilaiAktif ? configNilaiAktif.active_kd : 2;

  let head1HTML = '';
  let head2HTML = '';
  for(let i=0; i<maxKD; i++) {
    const k = configNilaiAktif.kds[i] || {name: `KD ${i+1}`};
    head1HTML += `<th colspan="5" style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center;">${k.name}</th>`;
    head2HTML += `
      <th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 9px;">T1</th>
      <th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 9px;">T2</th>
      <th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 9px;">UH</th>
      <th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 9px;">Rta</th>
      <th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 9px;">Prd</th>
    `;
  }

  let rowsHTML = urutMuridTampil().map((m, idx) => {
    const dt = rawDataNilai.find(d => d.NIS == m.NIS) || {};
    let kdsExportHTML = '';
    for(let i=0; i<maxKD; i++) {
      let ltr = LETTERS_KD[i];
      kdsExportHTML += `
        <td style="border: 1px solid black; padding: 4px; text-align: center;">${dt[`KD ${ltr} T1`] || ''}</td>
        <td style="border: 1px solid black; padding: 4px; text-align: center;">${dt[`KD ${ltr} T2`] || ''}</td>
        <td style="border: 1px solid black; padding: 4px; text-align: center;">${dt[`KD ${ltr} UH`] || ''}</td>
        <td style="border: 1px solid black; padding: 4px; text-align: center; font-weight: bold;">${dt[`KD ${ltr} Rata-rata`] || ''}</td>
        <td style="border: 1px solid black; padding: 4px; text-align: center;">${dt[`KD ${ltr} Predikat`] || '-'}</td>
      `;
    }

    return `
      <tr>
        <td style="border: 1px solid black; padding: 4px; text-align: center; width: 30px;">${idx + 1}</td>
        <td style="border: 1px solid black; padding: 4px; text-align: center; width: 70px;">${m["NIS"] || '-'}</td>
        <td style="border: 1px solid black; padding: 4px; text-align: center; width: 80px;">${m["NISN"] || '-'}</td>
        <td style="border: 1px solid black; padding: 4px; text-align: left; width: 160px;">${m["Nama Lengkap"]}</td>
        ${kdsExportHTML}
        <td style="border: 1px solid black; padding: 4px; text-align: center; font-weight: bold;">${dt["Rerata CP"] || ''}</td>
        <td style="border: 1px solid black; padding: 4px; text-align: center;">${dt["Rerata CP"] ? hitungPredikat(dt["Rerata CP"]) : '-'}</td>
        <td style="border: 1px solid black; padding: 4px; text-align: center;">${dt.UTS || ''}</td>
        <td style="border: 1px solid black; padding: 4px; text-align: center;">${dt["UAS/UKK"] || ''}</td>
        <td style="border: 1px solid black; padding: 4px; text-align: center; font-weight: bold;">${dt["Nilai Akhir Raport"] || ''}</td>
        <td style="border: 1px solid black; padding: 4px; text-align: center;">${dt["Predikat"] || '-'}</td>
        <td style="border: 1px solid black; padding: 4px; text-align: left; width: 100px;">${dt.Keterangan || ''}</td>
      </tr>
    `;
  }).join('');

  // Total kolom dasar bertambah 1 (No, NIS, NISN, Nama, RerataCP(2), UTS, UAS, Raport(2), Ket = 11 kolom dasar)
  const totalColsSpan = 11 + (maxKD * 5);
  // Membangun daftar legenda Label T1, T2, UH sesuai input guru
  let legendLabels = configNilaiAktif.kds.map((k, i) => {
    if (i < configNilaiAktif.active_kd) return `<tr><td style="border:none; padding: 2px;"><b>${k.name}</b></td><td style="border:none; padding: 2px;">: T1 (${k.t1}), T2 (${k.t2}), UH (${k.uh})</td></tr>`;
    return '';
  }).filter(Boolean).join('');

  return `
    <div style="font-family: 'Times New Roman', Times, serif; font-size: 11px; color: #000; background: #fff; padding: 20px;">
      <h3 style="text-align: center; margin-bottom: 5px; font-size: 15px; font-weight: bold; text-transform: uppercase;">DAFTAR NILAI PENGETAHUAN</h3>
      <h4 style="text-align: center; margin-top: 0; margin-bottom: 15px; font-size: 12px;">Tahun Pelajaran: ${currentTahun}</h4>
      
      <table style="width: 100%; margin-bottom: 15px; border: none; font-size: 11px;">
        <tr>
          <td style="width: 50%; text-align: left; vertical-align: top; border: none;">
            <table style="border: none;">
              <tr><td style="padding-right: 10px; font-weight: bold; border: none;">Kelas</td><td style="border: none;">: ${kelas}</td></tr>
              <tr><td style="padding-right: 10px; font-weight: bold; border: none;">Wali Kelas</td><td style="border: none;">: ${waliKelas}</td></tr>
            </table>
          </td>
          <td style="width: 50%; text-align: right; vertical-align: top; border: none;">
            <table style="border: none; margin-left: auto;">
              <tr><td style="padding-right: 10px; text-align: left; font-weight: bold; border: none;">Semester</td><td style="text-align: left; border: none;">: ${currentSemesterNilai}</td></tr>
              <tr><td style="padding-right: 10px; text-align: left; font-weight: bold; border: none;">Mata Pelajaran</td><td style="text-align: left; border: none;">: ${mapel}</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <table style="width: 100%; border-collapse: collapse; font-size: 10px;">
        <thead>
          <tr>
            <th rowspan="2" style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center;">No</th>
            <th rowspan="2" style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center;">NIS</th>
            <th rowspan="2" style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center;">NISN</th>
            <th rowspan="2" style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: left;">Nama Siswa</th>
            ${head1HTML}
            <th colspan="2" style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center;">Rerata CP</th>
            <th rowspan="2" style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center;">UTS</th>
            <th rowspan="2" style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center;">UAS</th>
            <th colspan="2" style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center;">RAPORT</th>
            <th rowspan="2" style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center;">Keterangan</th>
          </tr>
          <tr>
            ${head2HTML}
            <th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 9px;">Nilai</th>
            <th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 9px;">Prd</th>
            <th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 9px;">Akhir</th>
            <th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 9px;">Prd</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHTML}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="${totalColsSpan}" style="border: 1px solid black; text-align: center; padding: 6px; font-weight: bold; background-color: #f9fafb;">
              PREDIKAT: &nbsp; A(91-100) &nbsp;|&nbsp; B(81-90) &nbsp;|&nbsp; C(71-80) &nbsp;|&nbsp; D(0-70)
            </td>
          </tr>
        </tfoot>
      </table>

<!-- TAMBAHAN LEGENDA CUSTOM LABEL PENGETAHUAN -->
      <div style="margin-top: 15px; font-size: 10px; text-align: left; background-color: #f8fafc; padding: 10px; border: 1px solid #e2e8f0;">
         <b style="color: #333;">KETERANGAN KOMPONEN PENILAIAN (LABEL):</b><br>
         <table style="border:none; font-size: 9px; margin-top: 5px;">
            ${legendLabels}
         </table>
      </div>

      <table style="width: 100%; margin-top: 30px; border: none; text-align: center; font-size: 11px;">
        <tr>
          <td style="width: 50%; border: none; vertical-align: top;">Mengetahui,<br>Kepala Sekolah<br><br><br><br><br><b><u>${kepsek}</u></b></td>
          <td style="width: 50%; border: none; vertical-align: top;">Guru Mata Pelajaran<br><br><br><br><br><b><u>${namaGuru}</u></b></td>
        </tr>
      </table>
    </div>
  `;
}  
// FIX SHADOWING BUG: one-liner `window.exportNilaiPDF = ...` DIHAPUS — ia menimpa
// fungsi router exportNilaiPDF() (deklarasi di bawah) yang dirutekan per kategori
// Pengetahuan/Keterampilan/Sikap, sehingga tombol toolbar selalu mencetak versi generik.

// ---------- DIALOG OPSI EXPORT: "Daftar Nilai (Lengkap)" / "Daftar Nilai Raport" (req 3) ----------
function dialogOpsiExportNilai(judul, cb) {
  Swal.fire({
    title: judul,
    html: `
      <div class="text-left text-[11px] text-slate-300">
        <label class="flex items-start gap-2 p-2 rounded cursor-pointer hover:bg-white/5 border border-white/10 mb-1">
          <input type="radio" name="ex_opt" value="lengkap" checked class="mt-0.5 accent-blue-500">
          <span><b class="text-white">Daftar Nilai (Lengkap)</b><br><span class="text-[10px] text-slate-400">Seluruh kolom penilaian sesuai kategori aktif (Set Kolom).</span></span>
        </label>
        <label class="flex items-start gap-2 p-2 rounded cursor-pointer hover:bg-white/5 border border-white/10">
          <input type="radio" name="ex_opt" value="raport" class="mt-0.5 accent-indigo-500">
          <span><b class="text-indigo-300">Daftar Nilai Raport</b><br><span class="text-[10px] text-slate-400">Ringkas untuk rapor: NA, Prd, Nilai Raport & Deskripsi (Sumatif/Capaian).</span></span>
        </label>
      </div>`,
    background: '#1e293b', color: '#fff', showCancelButton: true, cancelButtonText: 'Batal',
    confirmButtonText: '<i class="fa-solid fa-file-arrow-down"></i> Export',
    preConfirm: () => { const el = Swal.getPopup().querySelector('input[name="ex_opt"]:checked'); return el ? el.value : 'lengkap'; }
  }).then(res => { if (res.isConfirmed) cb(res.value || 'lengkap'); });
}

window.exportNilaiExcel = function() {
  dialogOpsiExportNilai('<i class="fa-solid fa-file-excel text-green-400"></i> Export Excel', (opt) => {
    const m = document.getElementById('select-mapel-nilai').value, k = document.getElementById('select-kelas-nilai').value;
    const htmlBody = opt === 'raport' ? getExportHTMLDaftarNilaiRaport() : getExportHTMLNilai();
    const blob = new Blob([`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body>${htmlBody}</body></html>`], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `${opt === 'raport' ? 'Nilai_Raport' : 'Nilai'}_${m}_${k}.xls`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500); // FIX LOW-BUG: revoke blob URL
  });
};

// ==========================================
// ROUTER EXPORT PDF
// ==========================================
function exportNilaiPDF() {
  dialogOpsiExportNilai('<i class="fa-solid fa-file-pdf text-red-400"></i> Cetak PDF', (opt) => {
    if (opt === 'raport') return cetakDaftarNilaiRaportPDF();
    let htmlRaw = "";
    
    // Routing berdasarkan kategori nilai yang sedang aktif
    if (currentKategoriNilai === "Data Nilai Pengetahuan") {
        htmlRaw = getExportHTMLPengetahuan();
    } else if (currentKategoriNilai === "Data Nilai Keterampilan") {
        htmlRaw = getExportHTMLKeterampilan();
    } else if (currentKategoriNilai === "Data Nilai Sikap") {
        htmlRaw = getExportHTMLSikap(); // <--- ROUTING UNTUK NILAI SIKAP
    } else {
        return Swal.fire({
            icon: 'info', 
            title: 'Perhatian', 
            text: 'Export PDF untuk kategori ini belum tersedia.', 
            background: '#1e293b', color: '#fff'
        });
    }
    
    // Eksekusi Cetak Jendela Baru (Print Preview)
    let printWindow = window.open('', '_blank');
    // FIX LOW-BUG: popup blocker guard
    if (!printWindow) { Swal.fire({ icon: 'error', title: 'Popup Diblokir', text: 'Izinkan popup untuk mencetak PDF.', background: '#1e293b', color: '#fff' }); return; }
    printWindow.document.write(`
      <html>
        <head>
          <title>Cetak Laporan ${currentKategoriNilai.replace('Data Nilai ', '')}</title>
          <style>
            body { font-family: Arial, sans-serif; color: #000; margin: 20px; background: #fff; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { border: 1px solid #333; padding: 4px; font-size: 9px; text-align: center; }
            th { background-color: #f1f5f9; }
            @media print {
              body { margin: 0; }
              @page { size: landscape; }
            }
          </style>
        </head>
        <body>
          ${htmlRaw}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    
    // Jeda sejenak agar elemen ter-render sempurna sebelum dialog print muncul
    setTimeout(() => {
        printWindow.print();
        printWindow.close();
    }, 600);
  });
}

// ---------- EXPORT "DAFTAR NILAI RAPORT" (req 3) ----------
/** Generator HTML Daftar Nilai Raport (Sumatif: Pengetahuan/Keterampilan; Capaian: Sikap). */
function getExportHTMLDaftarNilaiRaport() {
  const mapel = document.getElementById('select-mapel-nilai')?.value || '-';
  const kelas = document.getElementById('select-kelas-nilai')?.value || '-';
  const waliKelas = getNamaWaliKelas(kelas);
  const namaGuru = currentUser && currentUser.user ? namaDenganGelar(currentUser.user["Nama Guru"] || currentUser.user["Nama Lengkap"] || '', currentUser.user["Gelar Depan"], currentUser.user["Gelar Belakang"]) : "_____________________";
  const kepsek = namaKepsekGlobal || "_____________________";
  const idn = typeof barisIdentitasMaster === 'function' ? barisIdentitasMaster() : {};
  const namaSekolah = idn["Nama Sekolah"] || 'SEKOLAH';
  const alamat = idn["Alamat Sekolah"] || '';
  const cfg = cfgDeskripsiRaport();
  const isCapaian = currentKategoriNilai === "Data Nilai Sikap";
  const kolDesk = isCapaian ? 'Deskripsi Capaian' : 'Deskripsi Sumatif';
  const jDesk = isCapaian ? cfg.capaian : cfg.sumatif;
  const subJudul = isCapaian
    ? 'NILAI CAPAIAN — SIKAP'
    : `NILAI SUMATIF — ${currentKategoriNilai.replace('Data Nilai ', '').toUpperCase()}`;

  const rowsHTML = urutMuridTampil().map((m, idx) => {
    const dt = rawDataNilai.find(d => d.NIS == m.NIS) || {};
    return `<tr>
      <td style="border: 1px solid black; padding: 4px; text-align: center;">${idx + 1}</td>
      <td style="border: 1px solid black; padding: 4px; text-align: center;">${m["NIS"] || '-'}</td>
      <td style="border: 1px solid black; padding: 4px; text-align: left;">${m["Nama Lengkap"] || '-'}</td>
      <td style="border: 1px solid black; padding: 4px; text-align: center;">${m["Tingkat/Kelas"] || kelas}</td>
      <td style="border: 1px solid black; padding: 4px; text-align: center; font-weight: bold;">${dt["Nilai Akhir Raport"] || ''}</td>
      <td style="border: 1px solid black; padding: 4px; text-align: center;">${dt["Predikat"] || '-'}</td>
      <td style="border: 1px solid black; padding: 4px; text-align: center; font-weight: bold; background-color: #eef2ff;">${dt["Nilai Raport"] || ''}</td>
      <td style="border: 1px solid black; padding: 4px; text-align: left; font-size: 9px;">${dt[kolDesk] && dt[kolDesk] !== '-' ? dt[kolDesk] : ''}</td>
      <td style="border: 1px solid black; padding: 4px; text-align: left;">${dt.Keterangan || ''}</td>
    </tr>`;
  }).join('');

  return `
    <div style="font-family: 'Times New Roman', Times, serif; font-size: 11px; color: #000; background: #fff; padding: 20px;">
      <table width="100%" style="border:none;"><tr><td style="text-align:center;border:none;">
        <h2 style="margin:0;font-size:16px;">${escapeHtml(namaSekolah)}</h2>
        ${alamat ? `<div style="font-size:11px;">${escapeHtml(alamat)}</div>` : ''}
        <h3 style="margin:10px 0 2px;font-size:14px;">DAFTAR NILAI RAPORT — ${subJudul}</h3>
      </td></tr></table>
      <table style="width:100%;margin-bottom:12px;border:none;font-size:11px;">
        <tr>
          <td style="width:50%;border:none;">
            <table style="border:none;">
              <tr><td style="font-weight:bold;border:none;padding-right:8px;">Kelas</td><td style="border:none;">: ${escapeHtml(kelas)}</td></tr>
              <tr><td style="font-weight:bold;border:none;padding-right:8px;">Wali Kelas</td><td style="border:none;">: ${escapeHtml(waliKelas)}</td></tr>
            </table>
          </td>
          <td style="width:50%;border:none;vertical-align:top;">
            <table style="border:none;margin-left:auto;">
              <tr><td style="font-weight:bold;border:none;padding-right:8px;">Tahun Pelajaran</td><td style="border:none;">: ${escapeHtml(currentTahun)}</td></tr>
              <tr><td style="font-weight:bold;border:none;padding-right:8px;">Semester</td><td style="border:none;">: ${escapeHtml(currentSemesterNilai)}</td></tr>
              <tr><td style="font-weight:bold;border:none;padding-right:8px;">${escapeHtml(isCapaian ? 'Kategori' : 'Mata Pelajaran')}</td><td style="border:none;">: ${escapeHtml(isCapaian ? 'Sikap' : mapel)}</td></tr>
            </table>
          </td>
        </tr>
      </table>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr>
          <th style="border:1px solid black;padding:4px;background:#f1f5f9;width:5%;">No</th>
          <th style="border:1px solid black;padding:4px;background:#f1f5f9;">NIS</th>
          <th style="border:1px solid black;padding:4px;background:#f1f5f9;text-align:left;">Nama Lengkap</th>
          <th style="border:1px solid black;padding:4px;background:#f1f5f9;">Kelas</th>
          <th style="border:1px solid black;padding:4px;background:#f1f5f9;">NA</th>
          <th style="border:1px solid black;padding:4px;background:#f1f5f9;">Prd</th>
          <th style="border:1px solid black;padding:4px;background:#e0e7ff;">Nilai Raport</th>
          <th style="border:1px solid black;padding:4px;background:#f1f5f9;">Deskripsi</th>
          <th style="border:1px solid black;padding:4px;background:#f1f5f9;">Keterangan</th>
        </tr></thead>
        <tbody>${rowsHTML || `<tr><td colspan="9" style="border:1px solid black;padding:8px;text-align:center;">Belum ada data nilai.</td></tr>`}</tbody>
      </table>
      <div style="margin-top:10px;font-size:9px;background:#f8fafc;border:1px solid #e2e8f0;padding:8px;">
        ${isCapaian
          ? `<b>KETERANGAN DESKRIPSI CAPAIAN:</b> Konversi skor 1-4 — <b>80-100=4, 60-79=3, 40-59=2, &lt;40=1</b>; teks deskripsi mengikuti kriteria skor (dapat diedit di "Jurnal Penilaian Sikap").`
          : `<b>KETERANGAN DESKRIPSI:</b> Batas nilai <b>${jDesk.batas}</b> — nilai ≥ ${jDesk.batas}: "${escapeHtml(jDesk.teks_tinggi)}"; nilai &lt; ${jDesk.batas}: "${escapeHtml(jDesk.teks_rendah)}".`}
      </div>
      <table width="100%" style="margin-top:30px;border:none;"><tr>
        <td style="width:50%;border:none;vertical-align:top;text-align:center;">Mengetahui,<br>Kepala Sekolah<br><br><br><br><br><b><u>${escapeHtml(kepsek)}</u></b></td>
        <td style="width:50%;border:none;vertical-align:top;text-align:center;">Guru Mata Pelajaran<br><br><br><br><br><b><u>${escapeHtml(namaGuru)}</u></b></td>
      </tr></table>
    </div>`;
}

/** Cetak Daftar Nilai Raport ke print window (portrait, Times New Roman). */
function cetakDaftarNilaiRaportPDF() {
  const printWindow = window.open('', '_blank');
  if (!printWindow) { Swal.fire({ icon: 'error', title: 'Popup Diblokir', text: 'Izinkan popup untuk mencetak PDF.', background: '#1e293b', color: '#fff' }); return; }
  printWindow.document.write(`
    <html>
      <head><title>Daftar Nilai Raport</title>
        <style>
          body { font-family: 'Times New Roman', Times, serif; color: #000; margin: 20px; background: #fff; }
          table { border-collapse: collapse; }
          @media print { body { margin: 0; } }
        </style>
      </head>
      <body>${getExportHTMLDaftarNilaiRaport()}</body>
    </html>`);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => { printWindow.print(); printWindow.close(); }, 600);
}


// ==========================================
// ROUTER EXPORT EXCEL (MENGGUNAKAN SHEETJS)
// ==========================================
function exportNilaiExcel() {
  if (typeof XLSX === 'undefined') {
      return Swal.fire({
          icon: 'error', 
          title: 'Library Hilang', 
          text: 'Library SheetJS (XLSX) belum dimuat di index.html.', 
          background: '#1e293b', color: '#fff'
      });
  }

  let htmlRaw = "";
  
  // Routing berdasarkan kategori nilai yang sedang aktif
  if (currentKategoriNilai === "Data Nilai Pengetahuan") {
      htmlRaw = getExportHTMLPengetahuan();
  } else if (currentKategoriNilai === "Data Nilai Keterampilan") {
      htmlRaw = getExportHTMLKeterampilan();
  } else if (currentKategoriNilai === "Data Nilai Sikap") {
      htmlRaw = getExportHTMLSikap(); // <--- ROUTING UNTUK NILAI SIKAP
  } else {
      return Swal.fire({
          icon: 'info', 
          title: 'Perhatian', 
          text: 'Export Excel untuk kategori ini belum tersedia.', 
          background: '#1e293b', color: '#fff'
      });
  }

  try {
      // Konversi string HTML ke dalam Elemen DOM virtual untuk dibaca SheetJS
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlRaw, 'text/html');
      const table = doc.querySelector('table');
      
      if (!table) throw new Error("Format tabel data tidak ditemukan.");

      // Buat Workbook Excel dari tabel HTML
      const wb = XLSX.utils.table_to_book(table, { sheet: "Laporan Nilai" });
      
      // Ambil nama mapel & kelas untuk penamaan file otomatis
      const mapel = document.getElementById('select-mapel-nilai')?.value || "Mapel";
      const kelas = document.getElementById('select-kelas-nilai')?.value || "Kelas";
      const kategoriStr = currentKategoriNilai.replace('Data Nilai ', '');
      
      // Simpan dan unduh file
      XLSX.writeFile(wb, `Laporan_${kategoriStr}_${kelas}_${mapel}.xlsx`);
      
      Swal.fire({
          toast: true, position: 'top-end', icon: 'success', 
          title: 'File Excel berhasil diunduh!', 
          showConfirmButton: false, timer: 1500, background: '#1e293b', color: '#fff'
      });
  } catch (err) {
      Swal.fire({
          icon: 'error', 
          title: 'Gagal Export Excel', 
          text: err.message, 
          background: '#1e293b', color: '#fff'
      });
  }
}

// Fungsi Baru Laporan Keterampilan Resmi
function getExportHTMLKeterampilan() {
  const mapel = document.getElementById('select-mapel-nilai').value;
  const kelas = document.getElementById('select-kelas-nilai').value;
  const waliKelas = getNamaWaliKelas(kelas);
  const namaGuru = currentUser && currentUser.user ? (currentUser.user["Nama Guru"] || "_____________________") : "_____________________";
  const kepsek = namaKepsekGlobal || "_____________________";
  const maxCP = configNilaiAktif ? configNilaiAktif.active_cp : 2;
  const LTRS = ['A','B','C','D'];
  const cfg = configNilaiAktif;
  const lblCP = cfg.labels.cp.slice(0, cfg.active_cp).join(' | ');
  const lblSub = cfg.labels.sub.slice(0, cfg.active_sub_cp).join(', ');
  const lblProj = cfg.active_proj > 0 ? cfg.labels.proj.slice(0, cfg.active_proj).join(', ') : '-';
  const lblPort = cfg.active_port > 0 ? cfg.labels.port.slice(0, cfg.active_port).join(', ') : '-';

  let head1HTML = '', head2HTML = '';
  for(let i=0; i<maxCP; i++) {
    head1HTML += `<th colspan="5" style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center;">Praktikum CP ${LTRS[i]}</th>`;
    head2HTML += `<th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 8px;">1</th><th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 8px;">2</th><th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 8px;">3</th><th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 8px;">4</th><th style="border: 1px solid black; padding: 4px; background-color: #e2e8f0; text-align: center; font-size: 8px;">Opt</th>`;
  }

  let rowsHTML = urutMuridTampil().map((m, idx) => {
    const dt = rawDataNilai.find(d => d.NIS == m.NIS) || {};
    let ketExportHTML = '';
    
    // Praktikum
    for(let i=0; i<maxCP; i++) {
      let ltr = LTRS[i];
      for(let j=1; j<=4; j++) ketExportHTML += `<td style="border: 1px solid black; padding: 3px; text-align: center;">${dt[`Prak ${ltr} ${j}`] || ''}</td>`;
      ketExportHTML += `<td style="border: 1px solid black; padding: 3px; text-align: center; font-weight: bold; background-color: #f8fafc;">${dt[`Optimum ${ltr}`] || ''}</td>`;
    }
    ketExportHTML += `<td style="border: 1px solid black; padding: 3px; text-align: center; font-weight: bold; background-color: #eef2ff;">${dt["Rerata Optimum"] || ''}</td>`;

    // Projek
    for(let j=1; j<=4; j++) ketExportHTML += `<td style="border: 1px solid black; padding: 3px; text-align: center;">${dt[`Projek ${j}`] || ''}</td>`;
    ketExportHTML += `<td style="border: 1px solid black; padding: 3px; text-align: center; font-weight: bold; background-color: #faf5ff;">${dt["Rerata Projek"] || ''}</td>`;

    // Porto
    for(let j=1; j<=4; j++) ketExportHTML += `<td style="border: 1px solid black; padding: 3px; text-align: center;">${dt[`Porto ${j}`] || ''}</td>`;
    ketExportHTML += `<td style="border: 1px solid black; padding: 3px; text-align: center; font-weight: bold; background-color: #fefce8;">${dt["Rerata Porto"] || ''}</td>`; // Sesuai schema

    return `
      <tr>
        <td style="border: 1px solid black; padding: 3px; text-align: center;">${idx + 1}</td>
        <td style="border: 1px solid black; padding: 3px; text-align: center;">${m["NIS"] || '-'}</td>
        <td style="border: 1px solid black; padding: 3px; text-align: center;">${m["NISN"] || '-'}</td>
        <td style="border: 1px solid black; padding: 3px; text-align: left; white-space: nowrap;">${m["Nama Lengkap"]}</td>
        ${ketExportHTML}
        <td style="border: 1px solid black; padding: 3px; text-align: center; font-weight: bold; background-color: #f0fdf4;">${dt["Nilai Akhir Raport"] || ''}</td>
        <td style="border: 1px solid black; padding: 3px; text-align: center; background-color: #f0fdf4;">${dt["Predikat"] || '-'}</td>
        <td style="border: 1px solid black; padding: 3px; text-align: left;">${dt.Keterangan || ''}</td>
      </tr>
    `;
  }).join('');

  const totalColsSpan = 18 + (maxCP * 5); // Base Cols (No, NIS, NISN, Nama, Rta Opt, Proj 1-4, Rta Proj, Porto 1-4, Rta Porto, Raport Akhir, Raport Pred, Ket)

  return `
    <div style="font-family: 'Times New Roman', Times, serif; font-size: 10px; color: #000; background: #fff; padding: 15px;">
      <h3 style="text-align: center; margin-bottom: 5px; font-size: 14px; font-weight: bold; text-transform: uppercase;">DAFTAR NILAI KETERAMPILAN</h3>
      <h4 style="text-align: center; margin-top: 0; margin-bottom: 15px; font-size: 11px;">Tahun Pelajaran: ${currentTahun}</h4>
      
      <table style="width: 100%; margin-bottom: 10px; border: none; font-size: 10px;">
        <tr>
          <td style="width: 50%; text-align: left; vertical-align: top; border: none;">
            <table style="border: none;"><tr><td style="padding-right: 10px; font-weight: bold; border: none;">Kelas</td><td style="border: none;">: ${kelas}</td></tr><tr><td style="padding-right: 10px; font-weight: bold; border: none;">Wali Kelas</td><td style="border: none;">: ${waliKelas}</td></tr></table>
          </td>
          <td style="width: 50%; text-align: right; vertical-align: top; border: none;">
            <table style="border: none; margin-left: auto;"><tr><td style="padding-right: 10px; text-align: left; font-weight: bold; border: none;">Semester</td><td style="text-align: left; border: none;">: ${currentSemesterNilai}</td></tr><tr><td style="padding-right: 10px; text-align: left; font-weight: bold; border: none;">Mata Pelajaran</td><td style="text-align: left; border: none;">: ${mapel}</td></tr></table>
          </td>
        </tr>
      </table>

      <table style="width: 100%; border-collapse: collapse; font-size: 9px;">
        <thead>
          <tr>
            <th rowspan="2" style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center;">No</th>
            <th rowspan="2" style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center;">NIS</th>
            <th rowspan="2" style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center;">NISN</th>
            <th rowspan="2" style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: left;">Nama Siswa</th>
            ${head1HTML}
            <th rowspan="2" style="border: 1px solid black; padding: 4px; background-color: #e2e8f0; text-align: center; font-size: 8px;">Rerata<br>Optimum</th>
            <th colspan="5" style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center;">Projek/Produk</th>
            <th colspan="5" style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center;">Portofolio</th>
            <th colspan="2" style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center;">RAPORT</th>
            <th rowspan="2" style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center;">Keterangan</th>
          </tr>
          <tr>
            ${head2HTML}
            <th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 8px;">1</th><th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 8px;">2</th><th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 8px;">3</th><th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 8px;">4</th><th style="border: 1px solid black; padding: 4px; background-color: #e2e8f0; text-align: center; font-size: 8px;">Rta</th>
            <th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 8px;">1</th><th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 8px;">2</th><th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 8px;">3</th><th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 8px;">4</th><th style="border: 1px solid black; padding: 4px; background-color: #e2e8f0; text-align: center; font-size: 8px;">Rta</th>
            <th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 8px;">Akhir</th><th style="border: 1px solid black; padding: 4px; background-color: #f0f0f0; text-align: center; font-size: 8px;">Prd</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHTML}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="${totalColsSpan}" style="border: 1px solid black; text-align: center; padding: 5px; font-weight: bold; background-color: #f9fafb;">
              PREDIKAT: &nbsp; A(91-100) &nbsp;|&nbsp; B(81-90) &nbsp;|&nbsp; C(71-80) &nbsp;|&nbsp; D(0-70)
            </td>
          </tr>
        </tfoot>
      </table>

      <div style="margin-top: 15px; font-size: 10px; text-align: left; background-color: #f8fafc; padding: 10px; border: 1px solid #e2e8f0;">
         <b style="color: #333;">KETERANGAN KOMPONEN KETERAMPILAN (LABEL):</b><br>
         <table style="border:none; font-size: 9px; margin-top: 5px;">
            <tr><td style="border:none; padding: 2px;"><b>Praktikum / CP</b></td><td style="border:none; padding: 2px;">: ${lblCP}</td></tr>
            <tr><td style="border:none; padding: 2px;"><b>Sub-CP (Kolom Penilaian)</b></td><td style="border:none; padding: 2px;">: ${lblSub}</td></tr>
            <tr><td style="border:none; padding: 2px;"><b>Projek / Produk</b></td><td style="border:none; padding: 2px;">: ${lblProj}</td></tr>
            <tr><td style="border:none; padding: 2px;"><b>Portofolio</b></td><td style="border:none; padding: 2px;">: ${lblPort}</td></tr>
         </table>
      </div>

      <table style="width: 100%; margin-top: 25px; border: none; text-align: center; font-size: 10px;">
        <tr>
          <td style="width: 50%; border: none; vertical-align: top;">Mengetahui,<br>Kepala Sekolah<br><br><br><br><br><b><u>${kepsek}</u></b></td>
          <td style="width: 50%; border: none; vertical-align: top;">Guru Mata Pelajaran<br><br><br><br><br><b><u>${namaGuru}</u></b></td>
        </tr>
      </table>
    </div>
  `;
}

// --- [REQ 2] EXPORT SIKAP ---
function getExportHTMLSikap() {
  const mapel = document.getElementById('select-mapel-nilai').value;
  const kelas = document.getElementById('select-kelas-nilai').value;
  const cfg = configNilaiAktif;
  const LTRS = ['A','B','C','D'];

  let obsH1 = '', obsH2 = '';
  for(let i=0; i<cfg.active_cp; i++) {
    obsH1 += `<th colspan="${cfg.active_sub_cp}" style="border: 1px solid #333; padding: 4px; background: #e2e8f0;">${cfg.labels.cp[i] || `CP ${LTRS[i]}`}</th>`;
    for(let j=0; j<cfg.active_sub_cp; j++) obsH2 += `<th style="border: 1px solid #333; padding: 4px; background: #f8fafc;">${cfg.labels.sub[j] || (j+1)}</th>`;
  }
  let temanH2 = ''; // [REQ 3] Teman Sejawat: 2 sub-kolom hasil agregat

  let htmlString = `
    <div style="font-family: Arial, sans-serif; color: #000; width: 100%;">
      <h3 style="text-align: center; margin-bottom: 5px;">LAPORAN NILAI SIKAP</h3>
      <p style="text-align: center; font-size: 11px; margin-top: 0;">Mata Pelajaran: ${mapel} | Kelas: ${kelas} | Semester: ${currentSemesterNilai} | Tahun: ${currentTahun}</p>
      <table style="width: 100%; border-collapse: collapse; font-size: 9px; text-align: center;">
        <thead>
          <tr>
            <th rowspan="2" style="border: 1px solid #333; padding: 4px; background: #e2e8f0; width: 25px;">No</th>
            <th rowspan="2" style="border: 1px solid #333; padding: 4px; background: #e2e8f0; text-align: left;">Nama Siswa</th>
            ${obsH1}
            <th rowspan="2" style="border: 1px solid #333; padding: 4px; background: #e2e8f0;">Penilaian<br>Diri</th>
            <th colspan="2" style="border: 1px solid #333; padding: 4px; background: #e2e8f0;">Teman Sejawat</th>
            <th rowspan="2" style="border: 1px solid #333; padding: 4px; background: #e2e8f0;">Jurnal</th>
            <th rowspan="2" style="border: 1px solid #333; padding: 4px; background: #d1fae5;">Nilai<br>Akhir</th>
            <th rowspan="2" style="border: 1px solid #333; padding: 4px; background: #d1fae5;">Predikat</th>
          </tr>
          <tr>${obsH2}${temanH2}<th style="border: 1px solid #333; padding: 4px; background: #f8fafc;">Nilai Teman Sejawat</th><th style="border: 1px solid #333; padding: 4px; background: #f8fafc;">Modus Teman Sejawat</th></tr>
        </thead>
        <tbody>
  `;

  listMuridKelas.forEach((m, idx) => {
    const dt = rawDataNilai.find(d => d.NIS == m.NIS) || {};
    let rowData = `<td style="border: 1px solid #333; padding: 4px;">${idx + 1}</td><td style="border: 1px solid #333; padding: 4px; text-align: left;">${m["Nama Lengkap"]}</td>`;
    
    for(let i=0; i<cfg.active_cp; i++) {
      let ltr = LTRS[i]; 
      for(let j=1; j<=cfg.active_sub_cp; j++) rowData += `<td style="border: 1px solid #333; padding: 4px;">${dt[`CP ${ltr}${j}`] || ''}</td>`;
    }
    
    rowData += `<td style="border: 1px solid #333; padding: 4px;">${dt["Penilaian Diri"] || ''}</td>`;
    // [REQ 3 & 6] Teman Sejawat: rata-rata rating + modus & deskripsi karakter
    const modusT = dt["Modus Teman Sejawat"];
    const modusTampil = (modusT !== "" && modusT !== undefined && modusT !== null)
      ? `${modusT} — ${DESKRIPSI_MODUS[modusT] || '-'}`
      : (dt["Deskripsi Karakter"] || '');
    rowData += `
        <td style="border: 1px solid #333; padding: 4px; font-weight: bold;">${dt["Nilai Teman Sejawat"] || ''}</td>
        <td style="border: 1px solid #333; padding: 4px;">${modusTampil}</td>
    `;
    
    rowData += `
        <td style="border: 1px solid #333; padding: 4px;">${dt["Nilai Jurnal"] || ''}</td>
        <td style="border: 1px solid #333; padding: 4px; font-weight: bold;">${dt["Nilai Akhir Raport"] || ''}</td>
        <td style="border: 1px solid #333; padding: 4px;">${dt["Predikat"] || '-'}</td>
    `;
    htmlString += `<tr>${rowData}</tr>`;
  });

  htmlString += `</tbody></table>`;
  
  // Footer Tanda Tangan
  htmlString += `
      <table style="width: 100%; margin-top: 25px; border: none; text-align: center; font-size: 10px;">
        <tr>
          <td style="width: 50%; border: none; vertical-align: top;">Mengetahui,<br>Kepala Sekolah<br><br><br><br><br><b><u>${document.getElementById('lbl-kepsek')?.innerText || 'Kepala Sekolah'}</u></b></td>
          <td style="width: 50%; border: none; vertical-align: top;">Guru Mata Pelajaran<br><br><br><br><br><b><u>${currentUser.user["Nama Guru"] || 'Guru Mapel'}</u></b></td>
        </tr>
      </table>
    </div>
  `;
  return htmlString;
}

function getExportHTMLEskul() {
  const mapel = document.getElementById('select-mapel-nilai').value;
  const kelas = document.getElementById('select-kelas-nilai').value;
  const waliKelas = getNamaWaliKelas(kelas);
  const namaGuru = currentUser && currentUser.user ? (currentUser.user["Nama Guru"] || "_____________________") : "_____________________";
  const kepsek = namaKepsekGlobal || "_____________________";

  let rowsHTML = urutMuridTampil().map((m, idx) => {
    const dt = rawDataNilai.find(d => d.NIS == m.NIS) || {};
    return `
      <tr>
        <td style="border: 1px solid black; padding: 4px; text-align: center;">${idx + 1}</td>
        <td style="border: 1px solid black; padding: 4px; text-align: center;">${m.NIS || '-'}</td>
        <td style="border: 1px solid black; padding: 4px; text-align: center;">${m.NISN || '-'}</td>
        <td style="border: 1px solid black; padding: 4px; text-align: left; white-space: nowrap;">${m["Nama Lengkap"]}</td>
        <td style="border: 1px solid black; padding: 4px; text-align: center; font-weight: bold;">${dt.Nilai || ''}</td>
        <td style="border: 1px solid black; padding: 4px; text-align: center;">${dt.Predikat || '-'}</td>
        <td style="border: 1px solid black; padding: 4px; text-align: left;">${dt.Deskripsi || ''}</td>
      </tr>
    `;
  }).join('');

  return `
    <div style="font-family: 'Times New Roman', Times, serif; font-size: 11px; color: #000; background: #fff; padding: 20px;">
      <h3 style="text-align: center; margin-bottom: 5px; font-size: 15px; font-weight: bold; text-transform: uppercase;">LAPORAN NILAI EKSTRAKURIKULER</h3>
      <h4 style="text-align: center; margin-top: 0; margin-bottom: 15px; font-size: 12px;">Tahun Pelajaran: ${currentTahun}</h4>
      
      <table style="width: 100%; margin-bottom: 15px; border: none; font-size: 11px;">
        <tr>
          <td style="width: 50%; text-align: left; vertical-align: top; border: none;">
            <table style="border: none;">
              <tr><td style="padding-right: 10px; font-weight: bold; border: none;">Kelas</td><td style="border: none;">: ${kelas}</td></tr>
              <tr><td style="padding-right: 10px; font-weight: bold; border: none;">Wali Kelas</td><td style="border: none;">: ${waliKelas}</td></tr>
            </table>
          </td>
          <td style="width: 50%; text-align: right; vertical-align: top; border: none;">
            <table style="border: none; margin-left: auto;">
              <tr><td style="padding-right: 10px; text-align: left; font-weight: bold; border: none;">Semester</td><td style="text-align: left; border: none;">: ${currentSemesterNilai}</td></tr>
              <tr><td style="padding-right: 10px; text-align: left; font-weight: bold; border: none;">Ekstrakurikuler</td><td style="text-align: left; border: none;">: ${mapel}</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
        <thead>
          <tr>
            <th style="border: 1px solid black; padding: 6px; background-color: #f0f0f0; text-align: center; width: 5%;">No</th>
            <th style="border: 1px solid black; padding: 6px; background-color: #f0f0f0; text-align: center; width: 10%;">NIS</th>
            <th style="border: 1px solid black; padding: 6px; background-color: #f0f0f0; text-align: center; width: 15%;">NISN</th>
            <th style="border: 1px solid black; padding: 6px; background-color: #f0f0f0; text-align: left; width: 25%;">Nama Siswa</th>
            <th style="border: 1px solid black; padding: 6px; background-color: #f0f0f0; text-align: center; width: 10%;">Nilai</th>
            <th style="border: 1px solid black; padding: 6px; background-color: #f0f0f0; text-align: center; width: 10%;">Predikat</th>
            <th style="border: 1px solid black; padding: 6px; background-color: #f0f0f0; text-align: center; width: 25%;">Deskripsi Ketercapaian</th>
          </tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
      </table>

      <table style="width: 100%; margin-top: 30px; border: none; text-align: center; font-size: 11px;">
        <tr>
          <td style="width: 50%; border: none; vertical-align: top;">Mengetahui,<br>Kepala Sekolah<br><br><br><br><br><b><u>${kepsek}</u></b></td>
          <td style="width: 50%; border: none; vertical-align: top;">Pembina Ekstrakurikuler<br><br><br><br><br><b><u>${namaGuru}</u></b></td>
        </tr>
      </table>
    </div>
  `;
}

// CATATAN: Duplikat silentSaveNilai (versi tabel 'nilai_siswa' yang tidak ada → 404
// PGRST205) telah DIHAPUS. Versi aktif: silentSaveNilai JSONB di atas (tabel 'nilai').

// ==========================================
// FUNGSI UTILITAS: KALKULASI NILAI SANGAT CEPAT (DI BROWSER)
// ==========================================
const calcRerata = (arr) => arr.length ? arr.reduce((a,b) => a + Number(b), 0) / arr.length : 0;
const calcOptimum = (arr) => arr.length ? Math.max(...arr.map(Number)) : 0;
const calcModus = (arr) => {
  if(!arr.length) return "-";
  const counts = {}; let maxCount = 0; let modus = arr[0];
  arr.forEach(val => {
    if(val) {
      counts[val] = (counts[val] || 0) + 1;
      if (counts[val] > maxCount) { maxCount = counts[val]; modus = val; }
    }
  });
  return modus;
}

// HELPER: Fungsi untuk mengambil Koordinat GPS Pengguna
function getDeviceGPS() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve("GPS Tidak Didukung");
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(`${pos.coords.latitude}, ${pos.coords.longitude}`),
      (err) => resolve("Izin GPS Ditolak/Gagal")
    );
  });
}

// ==========================================
// KETERAMPILAN: RENDER TABEL & UI
// ==========================================
// [REQ 4 & 9] KETERAMPILAN: Pop-Up Kolom & Kolom Dinamis
// [UPDATE] Tampilan Keterampilan (Render Tabel)
function renderTabelKeterampilan() {
  if(!configNilaiAktif || !configNilaiAktif.labels) {
    configNilaiAktif = { 
        active_cp: 2, active_sub_cp: 4, active_proj: 4, active_port: 4, bobot: { prak: 40, proj: 30, port: 30 },
        labels: { cp: ["CP A","CP B","CP C","CP D"], sub: ["1","2","3","4"], proj: ["Projek 1","Projek 2","Projek 3","Projek 4"], port: ["Porto 1","Porto 2","Porto 3","Porto 4"] }
    };
  }
  const cfg = configNilaiAktif;
  const displayNama = showNamaSiswaNilai ? 'table-cell' : 'none';
  const LTRS = ['A','B','C','D'];

  let head1 = '', head2 = '';
  for(let i=0; i<cfg.active_cp; i++) {
    let lblCP = cfg.labels?.cp[i] || `CP ${LTRS[i]}`;
    head1 += `<th colspan="${cfg.active_sub_cp + 1}" class="px-2 py-2 border-r border-white/10 bg-blue-900/40 border-b border-blue-500/30 cursor-pointer hover:bg-blue-600/50" onclick="Swal.fire({title:'Info Komponen', html:'<b class=\\'text-blue-400\\'>Praktikum / Kinerja</b><br>${lblCP}', background:'#1e293b', color:'#fff', icon:'info'})">${lblCP}</th>`;
    for(let j=0; j<cfg.active_sub_cp; j++) {
        let lblSub = cfg.labels?.sub[j] || `${j+1}`;
        head2 += `<th class="px-1 border-r border-b border-white/10 cursor-pointer hover:bg-white/10" onclick="Swal.fire({title:'Detail Kolom', html:'<b class=\\'text-blue-400\\'>${lblCP}</b><br>Sub-CP: ${lblSub}', background:'#1e293b', color:'#fff', icon:'info'})">${lblSub}</th>`;
    }
    head2 += `<th class="px-1 border-r border-b border-white/10 text-slate-300 cursor-pointer hover:bg-white/10" onclick="Swal.fire({title:'Optimum', text:'Nilai Tertinggi dari Sub-CP di Praktikum ini.', background:'#1e293b', color:'#fff', icon:'info'})">Opt</th>`;
  }

  let projH1 = '', projH2 = '', portH1 = '', portH2 = '';
  if(cfg.active_proj > 0) projH1 = `<th colspan="${cfg.active_proj + 1}" class="px-2 py-2 border-r border-white/10 bg-purple-900/40 border-b border-purple-500/30">Projek/Produk</th>`;
  for(let j=0; j<cfg.active_proj; j++) {
      let lblProj = cfg.labels?.proj[j] || `Projek ${j+1}`;
      projH2 += `<th class="px-1 border-r border-b border-white/10 bg-purple-900/20 cursor-pointer hover:bg-purple-600/50" onclick="Swal.fire({title:'Detail Projek', html:'Komponen: <b class=\\'text-purple-400\\'>${lblProj}</b>', background:'#1e293b', color:'#fff'})">${j+1}</th>`;
  }
  if(cfg.active_proj > 0) projH2 += `<th class="px-1 border-r border-b border-white/10 bg-purple-900/40 text-slate-300">Rta</th>`;
  
  if(cfg.active_port > 0) portH1 = `<th colspan="${cfg.active_port + 1}" class="px-2 py-2 border-r border-white/10 bg-yellow-900/40 border-b border-yellow-500/30">Portofolio</th>`;
  for(let j=0; j<cfg.active_port; j++) {
      let lblPort = cfg.labels?.port[j] || `Porto ${j+1}`;
      portH2 += `<th class="px-1 border-r border-b border-white/10 bg-yellow-900/20 cursor-pointer hover:bg-yellow-600/50" onclick="Swal.fire({title:'Detail Portofolio', html:'Komponen: <b class=\\'text-yellow-400\\'>${lblPort}</b>', background:'#1e293b', color:'#fff'})">${j+1}</th>`;
  }
  if(cfg.active_port > 0) portH2 += `<th class="px-1 border-r border-b border-white/10 bg-yellow-900/40 text-slate-300">Rta</th>`;

  const theadHTML = `
    <thead class="sticky top-0 z-40 shadow-lg">
      <tr class="bg-slate-800 text-slate-300 text-[10px] uppercase tracking-wider text-center border-b border-white/20">
        <th class="sticky left-0 bg-slate-800 z-50 px-2 py-2 border-r border-white/10 w-8 cursor-pointer hover:bg-slate-700 text-blue-400 shadow-md" onclick="toggleNamaSiswaNilai()">No</th>
        <!-- Ganti kode <th> Nama Siswa yang lama dengan ini: -->
        <th rowspan="2" class="th-nama-siswa sticky left-[32px] bg-slate-800 z-40 px-3 py-2 border-r border-b border-white/10 text-left align-middle select-none relative" style="display:${displayNama}; width: 160px; min-width: 50px;">
        <div class="flex items-center justify-between gap-1 pr-1"><span class="truncate font-semibold">Nama Siswa</span><button onclick="event.stopPropagation(); siklusUrutNamaNilai()" class="shrink-0 w-5 h-5 rounded bg-slate-700/70 hover:bg-slate-600 flex items-center justify-center text-[9px]" title="Urutkan Nama (A-Z / Z-A)">${ikonUrutNamaNilai()}</button></div>
        <!-- Garis Handle Geser (Kursor berubah jadi panah geser) -->
        <div class="col-resizer absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-500/50 transition-colors"></div></th>
        ${head1}
        <th rowspan="2" class="px-2 py-2 border-r border-b border-white/10 bg-indigo-900/40 text-[9px]">Rerata<br>Optimum</th>
        ${projH1}
        ${portH1}
        <th colspan="3" class="px-2 py-2 border-r border-white/10 bg-green-900/40 border-b border-green-500/30">NILAI RAPORT</th>
        
        <!-- KOLOM TUNGGAKAN -->
        <th rowspan="2" class="bg-red-900/30 border-r border-b border-white/10 cursor-pointer hover:bg-red-800 transition align-middle" onclick="toggleBelumTuntasNilai()" style="width: ${showBelumTuntasNilai ? '140px' : '30px'}; min-width: ${showBelumTuntasNilai ? '140px' : '30px'}; max-width: ${showBelumTuntasNilai ? '140px' : '30px'};">
            ${showBelumTuntasNilai ? '<div class="flex justify-between items-center px-1"><span class="text-[9px] text-red-300 font-bold tracking-normal leading-tight text-left">Belum<br>Tuntas</span> <button onclick="shareBelumTuntasWA(event)" class="bg-green-500 text-white px-1.5 py-1 rounded shadow hover:bg-green-400" title="Share WA"><i class="fa-brands fa-whatsapp"></i></button></div>' : '<i class="fa-solid fa-triangle-exclamation text-red-400" title="Klik lihat nilai belum tuntas"></i>'}
        </th>
        
        <th rowspan="2" class="bg-slate-800 border-r border-b border-white/10 align-middle"><div style="resize: horizontal; overflow: auto; min-width: 150px; width: 150px; padding: 8px;">Keterangan</div></th>
      </tr>
      <tr class="bg-slate-800 text-slate-400 text-[9px] text-center shadow-sm">
        <th class="sticky left-0 bg-slate-800 z-50 border-r border-b border-white/10"></th>
        ${head2}
        ${projH2}
        ${portH2}
        <th class="px-2 py-1 border-r border-b border-white/10 bg-green-900/20">NA</th><th class="px-1 py-1 border-r border-b border-white/10 bg-green-900/20 text-slate-300">Prd</th>
        <th class="px-1 py-1 border-r border-b border-white/10 bg-indigo-900/20 text-slate-300" title="Nilai Raport (Sumatif/Capaian)">Nilai Raport</th>
      </tr>
    </thead>
  `;

  const tbodyHTML = urutMuridTampil().map((m, idx) => {
    const dt = rawDataNilai.find(d => d.NIS == m.NIS) || {};
    let prakHTML = '';
    
    for(let i=0; i<cfg.active_cp; i++) {
      let ltr = LTRS[i]; 
      for(let j=1; j<=cfg.active_sub_cp; j++) {
          prakHTML += `<td class="border-b border-r border-white/5 p-0"><input type="number" onfocus="storeOldVal(this)" onblur="kalkulasiKeterampilan('${m.NIS}')" id="N_${m.NIS}_Prak_${ltr}_${j}" value="${dt[`Prak ${ltr} ${j}`] || ''}" class="w-8 h-8 bg-transparent text-center text-[10px] text-white outline-none focus:bg-blue-600/30"></td>`;
      }
      let opt = dt[`Optimum ${ltr}`] || '';
      prakHTML += `<td class="border-b border-r border-white/5 p-0 bg-blue-900/10 text-center text-[10px] font-bold ${getWarnaPredikat(hitungPredikat(opt))}" id="LBL_${m.NIS}_Opt_${ltr}">${opt}</td>`;
    }

    let projHTML = '', portHTML = '';
    for(let j=1; j<=cfg.active_proj; j++) projHTML += `<td class="border-b border-r border-white/5 p-0"><input type="number" onfocus="storeOldVal(this)" onblur="kalkulasiKeterampilan('${m.NIS}')" id="N_${m.NIS}_Proj_${j}" value="${dt[`Projek ${j}`] || ''}" class="w-8 h-8 bg-purple-900/10 text-center text-[10px] text-white outline-none focus:bg-purple-600/30"></td>`;
    
    let vProj = dt["Rerata Projek"] || '';
    if(cfg.active_proj > 0) projHTML += `<td class="border-b border-r border-white/5 p-0 bg-purple-900/20 text-center font-bold ${getWarnaPredikat(hitungPredikat(vProj))}" id="LBL_${m.NIS}_RerataProj">${vProj}</td>`;

    for(let j=1; j<=cfg.active_port; j++) portHTML += `<td class="border-b border-r border-white/5 p-0"><input type="number" onfocus="storeOldVal(this)" onblur="kalkulasiKeterampilan('${m.NIS}')" id="N_${m.NIS}_Port_${j}" value="${dt[`Porto ${j}`] || ''}" class="w-8 h-8 bg-yellow-900/10 text-center text-[10px] text-white outline-none focus:bg-yellow-600/30"></td>`;
    
    let vPort = dt["Rerata Porto"] || '';
    if(cfg.active_port > 0) portHTML += `<td class="border-b border-r border-white/5 p-0 bg-yellow-900/20 text-center font-bold ${getWarnaPredikat(hitungPredikat(vPort))}" id="LBL_${m.NIS}_RerataPort">${vPort}</td>`;

    let valOpt = dt["Rerata Optimum"] || '';
    let valNA = dt["Nilai Akhir Raport"] || ''; 
    let prdNA = dt["Predikat"] || (valNA ? hitungPredikat(valNA) : '-');

    const sumatifMode = cfgDeskripsiRaport().sumatif.mode;
    const valRPT = hitungSumatifGabungan(m.NIS, valNA);
    const selNilaiRaport = sumatifMode === 'manual'
      ? `<input type="number" onfocus="storeOldVal(this)" onblur="onNilaiRaportManual('${m.NIS}','keterampilan')" id="NR_${m.NIS}_AkhirKet" value="${dt["Nilai Raport"] ?? (valRPT || '')}" class="w-10 h-8 bg-transparent text-center text-[11px] font-bold text-white outline-none focus:bg-indigo-600/30">`
      : `<span id="RPT_${m.NIS}_AkhirKet" class="text-[12px] font-extrabold ${getWarnaPredikat(hitungPredikat(valRPT))}">${valRPT}</span>`;

    return `
      <tr class="hover:bg-white/5 transition text-xs" data-nis="${m.NIS}">
        <td class="sticky left-0 bg-[#0f172a] z-30 text-center border-b border-r border-white/10 px-2 cursor-pointer text-blue-400 font-bold group-hover:bg-slate-800" onclick="toggleNamaSiswaNilai()">${idx + 1}</td>
        <td class="sticky left-[32px] bg-[#0f172a] z-30 border-b border-r border-white/10 px-2 truncate text-left group-hover:bg-slate-800" style="display:${displayNama}; max-width: 0;">${m["Nama Lengkap"]}</td>
        ${prakHTML}
        <td class="border-b border-r border-white/5 p-0 bg-indigo-900/20 text-center font-bold ${getWarnaPredikat(hitungPredikat(valOpt))}" id="LBL_${m.NIS}_RerataOpt">${valOpt}</td>
        ${projHTML}
        ${portHTML}
        <td class="border-b border-r border-white/5 px-1 bg-green-900/20 text-center text-[12px] font-extrabold ${getWarnaPredikat(hitungPredikat(valNA))}" id="LBL_${m.NIS}_AkhirKet">${valNA}</td>
        <td class="border-b border-r border-white/10 px-1 bg-green-900/10 text-center text-[12px] font-extrabold ${getWarnaPredikat(prdNA)}" id="PRD_${m.NIS}_AkhirKet">${prdNA}</td>
        <td class="border-b border-r border-white/10 px-1 bg-indigo-900/10 text-center align-middle">
          <div class="flex items-center justify-center gap-1">
            ${selNilaiRaport}
            <button onclick="popupDeskripsiRaport('${m.NIS}')" class="w-5 h-5 shrink-0 rounded bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white transition" title="Lihat/Edit Deskripsi Nilai Sumatif"><i class="fa-solid fa-file-lines text-[9px]"></i></button>
          </div>
        </td>
        
        <!-- SEL TUNGGAKAN -->
        <td class="border-b border-r border-white/5 px-2 py-1 text-red-300 whitespace-normal bg-red-900/10 cursor-pointer align-middle" onclick="toggleBelumTuntasNilai()">
            ${(() => {
                let t = getTunggakan(m.NIS, currentKategoriNilai);
                if (!showBelumTuntasNilai) return t.length > 0 ? '<div class="text-center"><i class="fa-solid fa-circle text-[8px] text-red-500"></i></div>' : '<div class="text-center"><i class="fa-solid fa-check text-[10px] text-green-500"></i></div>';
                return t.length > 0 ? `<ul class="list-disc pl-3 text-[8.5px] leading-tight text-left max-w-[120px] mx-auto">${t.map(x=>`<li>${x}</li>`).join('')}</ul>` : '<div class="text-center text-[9px] text-green-400 font-bold">Tuntas</div>';
            })()}
        </td>
        
        <td class="border-b border-r border-white/5 p-0 align-middle"><input type="text" onfocus="storeOldVal(this)" onblur="saveKeteranganNilai('${m.NIS}')" id="KET_${m.NIS}" value="${dt.Keterangan || ''}" class="w-full h-8 bg-transparent text-left px-2 text-[10px] text-white outline-none focus:bg-white/10"></td>
      </tr>
    `;
  }).join('');

  let footerInfo = `<b>INFO KETERAMPILAN:</b> CP Aktif (${cfg.active_cp}), Sub-CP per-Item (${cfg.active_sub_cp}), Projek (${cfg.active_proj}), Portofolio (${cfg.active_port}).<br><b>PREDIKAT:</b> &nbsp; <span class="text-green-400 font-bold">A(91-100)</span> <span class="mx-1">|</span> <span class="text-blue-400 font-bold">B(81-90)</span> <span class="mx-1">|</span> <span class="text-yellow-400 font-bold">C(71-80)</span> <span class="mx-1">|</span> <span class="text-red-400 font-bold">D(0-70)</span><br><i>Klik pada header (nama tugas) untuk info detail.</i>`;
  document.getElementById('tabel-nilai').innerHTML = `${theadHTML}<tbody>${tbodyHTML}</tbody><tfoot><tr class="bg-slate-800 text-[10px] text-slate-400 border-t border-white/20"><td colspan="100%" class="py-2 px-3 text-center">${footerInfo}</td></tr></tfoot>`;
  enableNamaSiswaResize();
}

// ==========================================
// KETERAMPILAN: KALKULASI & AUTO-SYNC
// ==========================================
// [UPDATE] Kalkulasi Dinamis Keterampilan
function kalkulasiKeterampilan(nis, isFromUndo = false) {
  const cfg = configNilaiAktif; 
  const bPrak = cfg.bobot.prak / 100, bProj = cfg.bobot.proj / 100, bPort = cfg.bobot.port / 100;
  let updates = {}; 
  const LTRS = ['A','B','C','D'];
  
  const calcOpt = (arr) => { let valid = arr.filter(x => x !== "").map(Number); return valid.length ? Math.max(...valid) : ""; };
  const calcRta = (arr) => { let valid = arr.filter(x => x !== "").map(Number); return valid.length ? Math.round(valid.reduce((a,b)=>a+b,0)/valid.length) : ""; };

  let allOpt = [];
  for(let i=0; i<cfg.active_cp; i++) {
    let ltr = LTRS[i], arrPrak = [];
    for(let j=1; j<=cfg.active_sub_cp; j++) {
      let val = validateVal(`N_${nis}_Prak_${ltr}_${j}`, nis, isFromUndo); 
      updates[`Prak ${ltr} ${j}`] = val; 
      if(val !== "") arrPrak.push(val);
    }
    let opt = calcOpt(arrPrak); 
    
    // [UPDATE REQ 2] Pewarnaan dinamis
    document.getElementById(`LBL_${nis}_Opt_${ltr}`).innerText = opt; updateWarnaEl(`LBL_${nis}_Opt_${ltr}`, opt);
    updates[`Optimum ${ltr}`] = opt;
    if(opt !== "") allOpt.push(opt);
  }

  let rerataOpt = calcRta(allOpt);
  document.getElementById(`LBL_${nis}_RerataOpt`).innerText = rerataOpt; updateWarnaEl(`LBL_${nis}_RerataOpt`, rerataOpt);
  updates["Rerata Optimum"] = rerataOpt;

  let arrProj = [], arrPort = [];
  for(let j=1; j<=cfg.active_proj; j++) {
    let vProj = validateVal(`N_${nis}_Proj_${j}`, nis, isFromUndo); updates[`Projek ${j}`] = vProj; if(vProj !== "") arrProj.push(vProj);
  }
  for(let j=1; j<=cfg.active_port; j++) {
    let vPort = validateVal(`N_${nis}_Port_${j}`, nis, isFromUndo); updates[`Porto ${j}`] = vPort; if(vPort !== "") arrPort.push(vPort);
  }
  
  let rtaProj = calcRta(arrProj); document.getElementById(`LBL_${nis}_RerataProj`).innerText = rtaProj; updateWarnaEl(`LBL_${nis}_RerataProj`, rtaProj);
  updates["Rerata Projek"] = rtaProj;
  
  let rtaPort = calcRta(arrPort); document.getElementById(`LBL_${nis}_RerataPort`).innerText = rtaPort; updateWarnaEl(`LBL_${nis}_RerataPort`, rtaPort);
  updates["Rerata Porto"] = rtaPort;

  let nilaiAkhir = "", akhirPrd = "-";
  if (rerataOpt !== "" || rtaProj !== "" || rtaPort !== "") {
    nilaiAkhir = Math.round((Number(rerataOpt)||0) * bPrak + (Number(rtaProj)||0) * bProj + (Number(rtaPort)||0) * bPort); 
    akhirPrd = hitungPredikat(nilaiAkhir);
  }
  
  document.getElementById(`LBL_${nis}_AkhirKet`).innerText = nilaiAkhir; updateWarnaEl(`LBL_${nis}_AkhirKet`, nilaiAkhir);
  document.getElementById(`PRD_${nis}_AkhirKet`).innerText = akhirPrd; updateWarnaEl(`PRD_${nis}_AkhirKet`, nilaiAkhir);
  updates["Nilai Akhir Raport"] = nilaiAkhir; updates["Predikat"] = akhirPrd;
  Object.assign(updates, deriveNilaiRaport(nis, 'AkhirKet', 'AkhirKet', hitungSumatifGabungan(nis, nilaiAkhir), 'sumatif'));

  const ketEl = document.getElementById(`KET_${nis}`);
  if(ketEl) updates["Keterangan"] = ketEl.value;

  if(!isFromUndo) silentSaveNilai(nis, updates);
}

// --- HELPER WARNA PREDIKAT DINAMIS ---
function getWarnaPredikat(prd) {
  if (prd === 'A') return 'text-green-400';
  if (prd === 'B') return 'text-blue-400';
  if (prd === 'C') return 'text-yellow-400';
  if (prd === 'D') return 'text-red-400';
  return 'text-slate-300';
}

function updateWarnaEl(elId, nilaiValue) {
  const el = document.getElementById(elId);
  if (!el) return;
  // Hapus semua warna bawaan sebelumnya
  el.classList.remove('text-green-400', 'text-blue-400', 'text-yellow-400', 'text-red-400', 'text-slate-300', 'text-blue-300', 'text-pink-300', 'text-purple-300', 'text-indigo-300', 'text-pink-400', 'text-yellow-300');
  
  // Terapkan warna berdasarkan predikat
  let prd = hitungPredikat(nilaiValue);
  el.classList.add(getWarnaPredikat(prd));
}

// --- [FITUR BARU] TUNGGAKAN & SHARE WHATSAPP ---
let showBelumTuntasNilai = false; // Status hide/show kolom

function toggleBelumTuntasNilai() { 
  showBelumTuntasNilai = !showBelumTuntasNilai; 
  if (currentKategoriNilai === "Data Nilai Pengetahuan") renderTabelPengetahuan();
  else if (currentKategoriNilai === "Data Nilai Keterampilan") renderTabelKeterampilan();
  else if (currentKategoriNilai === "Data Nilai Sikap") renderTabelSikap();
}

function getTunggakan(nis, kategori) {
    const dt = rawDataNilai.find(d => d.NIS == nis) || {};
    let tunggakan = [];
    const isKosongAtauKurang = (val) => (val === "" || val === null || Number(val) < 71); // Threshold Tuntas (KKM 71)

    if (kategori === "Data Nilai Pengetahuan") {
        const maxKD = configNilaiAktif.active_kd;
        for(let i=0; i<maxKD; i++) {
            let ltr = LETTERS_KD[i];
            let nm = configNilaiAktif.kds[i].name;
            if(isKosongAtauKurang(dt[`KD ${ltr} T1`])) tunggakan.push(`${nm} (T1)`);
            if(isKosongAtauKurang(dt[`KD ${ltr} T2`])) tunggakan.push(`${nm} (T2)`);
            if(isKosongAtauKurang(dt[`KD ${ltr} UH`])) tunggakan.push(`${nm} (UH)`);
        }
        if(isKosongAtauKurang(dt.UTS)) tunggakan.push("UTS");
        if(isKosongAtauKurang(dt["UAS/UKK"])) tunggakan.push("UAS");
    } 
    else if (kategori === "Data Nilai Keterampilan") {
        const cfg = configNilaiAktif;
        const LTRS = ['A','B','C','D'];
        for(let i=0; i<cfg.active_cp; i++) {
            let ltr = LTRS[i];
            let lblCP = cfg.labels?.cp[i] || `CP ${ltr}`;
            for(let j=1; j<=cfg.active_sub_cp; j++) {
                if(isKosongAtauKurang(dt[`Prak ${ltr} ${j}`])) tunggakan.push(`${lblCP}-Prak ${j}`);
            }
        }
        for(let j=1; j<=cfg.active_proj; j++) {
            if(isKosongAtauKurang(dt[`Projek ${j}`])) tunggakan.push(cfg.labels?.proj[j-1] || `Projek ${j}`);
        }
        for(let j=1; j<=cfg.active_port; j++) {
            if(isKosongAtauKurang(dt[`Porto ${j}`])) tunggakan.push(cfg.labels?.port[j-1] || `Porto ${j}`);
        }
    }
    else if (kategori === "Data Nilai Sikap") { // <--- TAMBAHKAN BLOK INI
    const cfg = configNilaiAktif;
    const LTRS = ['A','B','C','D'];
    for(let i=0; i<cfg.active_cp; i++) {
        let lblCP = cfg.labels?.cp[i] || `CP ${LTRS[i]}`;
        for(let j=1; j<=cfg.active_sub_cp; j++) {
            if(isKosongAtauKurang(dt[`CP ${LTRS[i]}${j}`])) tunggakan.push(`Obs ${lblCP}-${cfg.labels?.sub[j-1] || j}`);
        }
    }
    if(isKosongAtauKurang(dt["Penilaian Diri"])) tunggakan.push("Penilaian Diri");
    // [REQ 3 & 6] Teman Sejawat: tunggakan bila belum menerima rating
    if(dt["Nilai Teman Sejawat"] === "" || dt["Nilai Teman Sejawat"] === undefined || dt["Nilai Teman Sejawat"] === null) tunggakan.push("Teman Sejawat");
    if(isKosongAtauKurang(dt["Nilai Jurnal"])) tunggakan.push("Nilai Jurnal");
    }
    return tunggakan;
}

// --- [UPDATE REQ 9] BROADCAST WA 3 KATEGORI ---
async function shareBelumTuntasWA(e) {
    if(e) e.stopPropagation(); 

    const mapel = document.getElementById('select-mapel-nilai').value;
    const kelas = document.getElementById('select-kelas-nilai').value;

    Swal.fire({ 
        title: 'Menyiapkan Laporan...', 
        html: '<span class="text-xs text-slate-400">Menganalisis data Pengetahuan, Keterampilan, & Sikap...</span>', 
        allowOutsideClick: false, 
        background: '#1e293b', color: '#fff',
        didOpen: () => Swal.showLoading() 
    });

    try {
        // Ambil data 3 kategori + konfigurasinya dari Supabase (sudah terfilter kelas/tahun/semester)
        const ambilKategoriNilai = async (sheet) => {
          const [nv, kf] = await Promise.all([
            supaClient.from('nilai').select('nis, data')
              .eq('kategori', sheet).eq('mapel', mapel).eq('kelas', kelas)
              .eq('tahun', currentTahun).eq('semester', currentSemesterNilai),
            supaClient.from('nilai_konfigurasi').select('config')
              .eq('kategori', sheet).eq('mapel', mapel).maybeSingle()
          ]);
          if (nv.error) throw nv.error;
          const rows = (nv.data || []).map(r => ({ NIS: r.nis, ...(r.data || {}) }));
          return [rows, (kf.data && kf.data.config) || null];
        };
        const [dataP, cP] = await ambilKategoriNilai("Data Nilai Pengetahuan");
        const [dataK, cK] = await ambilKategoriNilai("Data Nilai Keterampilan");
        const [dataS, cS] = await ambilKategoriNilai("Data Nilai Sikap");

        const isKosongAtauKurang = (val) => (val === "" || val === null || Number(val) < 71);
        let hasData = false;
        
        let textWA = `*INFORMASI NILAI BELUM TUNTAS / KOSONG*\n`;
        textWA += `TA: ${currentTahun} | Smt: ${currentSemesterNilai}\nMapel: ${mapel} | Kelas: ${kelas}\n\n`;
        textWA += `Berikut daftar siswa yang memiliki nilai kosong atau di bawah KKM (71):\n\n`;

        listMuridKelas.forEach((m, idx) => {
            let p = dataP.find(d => d.NIS == m.NIS) || {};
            let k = dataK.find(d => d.NIS == m.NIS) || {};
            let s = dataS.find(d => d.NIS == m.NIS) || {};
            let tP=[], tK=[], tS=[];

            // Cek Pengetahuan
            for(let i=0; i<cP.active_kd; i++) {
                let ltr = ['A','B','C','D','E','F','G','H'][i];
                if(isKosongAtauKurang(p[`KD ${ltr} Rata-rata`])) tP.push(cP.kds[i]?.name || `KD ${ltr}`);
            }
            if(isKosongAtauKurang(p["UTS"])) tP.push("UTS"); if(isKosongAtauKurang(p["UAS/UKK"])) tP.push("UAS");

            // Cek Keterampilan
            const LTRS = ['A','B','C','D'];
            for(let i=0; i<cK.active_cp; i++) if(isKosongAtauKurang(k[`Optimum ${LTRS[i]}`])) tK.push(cK.labels?.cp[i] || `Prak CP ${LTRS[i]}`);
            for(let j=1; j<=cK.active_proj; j++) if(isKosongAtauKurang(k[`Projek ${j}`])) tK.push(cK.labels?.proj[j-1] || `Projek ${j}`);
            for(let j=1; j<=cK.active_port; j++) if(isKosongAtauKurang(k[`Porto ${j}`])) tK.push(cK.labels?.port[j-1] || `Porto ${j}`);

            // Cek Sikap
            for(let i=0; i<cS.active_cp; i++) {
                for(let j=1; j<=cS.active_sub_cp; j++) {
                    if(isKosongAtauKurang(s[`CP ${LTRS[i]}${j}`])) tS.push(`Obs ${cS.labels?.cp[i]||LTRS[i]}-${j}`);
                }
            }
            if(isKosongAtauKurang(s["Nilai Akhir Raport"])) tS.push("Nilai Akhir (Rapor)");

            if (tP.length > 0 || tK.length > 0 || tS.length > 0) {
                hasData = true;
                textWA += `${idx+1}. *${m["Nama Lengkap"]}*\n`;
                if(tP.length>0) textWA += `   ~> Pgthn: _${tP.join(', ')}_\n`;
                if(tK.length>0) textWA += `   ~> Ktrmpln: _${tK.join(', ')}_\n`;
                if(tS.length>0) textWA += `   ~> Sikap: _${tS.join(', ')}_\n`;
            }
        });

        if(!hasData) return Swal.fire({icon: 'success', title: 'Sempurna!', text: 'Semua siswa tuntas (Pengetahuan, Keterampilan, Sikap).', background: '#1e293b', color: '#fff'});

        textWA += `\n_Mohon segera dilengkapi. Terima kasih._`;

        Swal.fire({
            title: '<div class="text-base font-bold text-green-400"><i class="fa-brands fa-whatsapp"></i> Broadcast WhatsApp</div>',
            html: `<textarea id="wa-text-area" class="w-full h-56 bg-black/40 border border-white/20 rounded p-2 text-xs text-white outline-none focus:border-green-500 custom-scrollbar" readonly>${textWA}</textarea>`,
            background: '#1e293b', color: '#fff',
            showCancelButton: true, showDenyButton: true,
            confirmButtonColor: '#16a34a', denyButtonColor: '#3b82f6',
            confirmButtonText: '<i class="fa-brands fa-whatsapp"></i> Buka WA', denyButtonText: '<i class="fa-regular fa-copy"></i> Copy', cancelButtonText: 'Tutup'
        }).then((res) => {
            if (res.isConfirmed) window.open(`https://wa.me/?text=${encodeURIComponent(textWA)}`, '_blank');
            else if (res.isDenied) { navigator.clipboard.writeText(textWA); Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Disalin!', showConfirmButton: false, timer: 1500, background: '#1e293b', color: '#fff'}); }
        });
    } catch(e) {
        Swal.fire({icon: 'error', title: 'Gagal', text: e.message, background: '#1e293b', color: '#fff'});
    }
}

// ==========================================
// MODUL SIKAP: RENDER TABEL & UI
// ==========================================
function renderTabelSikap() {
  if(!configNilaiAktif || !configNilaiAktif.labels) {
    // [REQ 1 & 2] Default: 3 CP, 3 Sub-CP, 5 Teman Sejawat, Format JSON Standar
    configNilaiAktif = { 
        active_cp: 3, active_sub_cp: 3, active_teman: 5, 
        labels: { cp: ["CP A","CP B","CP C","CP D"], sub: ["1","2","3","4"] },
        sikap_teman: { judul: 'Berilah nilai untuk 5 teman', keterangan: '', jumlah_teman: 5, sesi_buka: false, kriteria: { "4": "Selalu konsisten dilakukan", "3": "Sering dilakukan", "2": "Kadang-kadang dilakukan", "1": "Tidak pernah dilakukan" } }
    };
  }
  const cfg = configNilaiAktif;
  const displayNama = showNamaSiswaNilai ? 'table-cell' : 'none'; // [REQ 8]
  const LTRS = ['A','B','C','D'];

  let obsH1 = '', obsH2 = '';
  for(let i=0; i<cfg.active_cp; i++) {
    let lblCP = cfg.labels?.cp[i] || `CP ${LTRS[i]}`;
    obsH1 += `<th colspan="${cfg.active_sub_cp}" class="px-2 py-2 border-r border-white/10 bg-blue-900/40 border-b border-blue-500/30 cursor-pointer hover:bg-blue-600/50" onclick="Swal.fire({title:'Info Komponen', html:'<b class=\\'text-blue-400\\'>Observasi</b><br>${lblCP}', background:'#1e293b', color:'#fff', icon:'info'})">${lblCP}</th>`;
    for(let j=0; j<cfg.active_sub_cp; j++) {
        obsH2 += `<th class="px-1 border-r border-b border-white/10 cursor-pointer hover:bg-white/10">${cfg.labels?.sub[j] || (j+1)}</th>`;
    }
  }

  // [REQ 3] Teman Sejawat: 2 sub-kolom (Nilai Teman Sejawat & Modus Teman Sejawat)

  const theadHTML = `
    <thead class="sticky top-0 z-40 shadow-lg">
      <tr class="bg-slate-800 text-slate-300 text-[10px] uppercase tracking-wider text-center border-b border-white/20">
        <th class="sticky left-0 bg-slate-800 z-50 px-2 py-2 border-r border-white/10 w-8 cursor-pointer hover:bg-slate-700 text-blue-400 shadow-md" onclick="toggleNamaSiswaNilai()">No</th>
        <!-- Ganti kode <th> Nama Siswa yang lama dengan ini: -->
        <th rowspan="2" class="th-nama-siswa sticky left-[32px] bg-slate-800 z-40 px-3 py-2 border-r border-b border-white/10 text-left align-middle select-none relative" style="display:${displayNama}; width: 160px; min-width: 50px;">
        <div class="flex items-center justify-between gap-1 pr-1"><span class="truncate font-semibold">Nama Siswa</span><button onclick="event.stopPropagation(); siklusUrutNamaNilai()" class="shrink-0 w-5 h-5 rounded bg-slate-700/70 hover:bg-slate-600 flex items-center justify-center text-[9px]" title="Urutkan Nama (A-Z / Z-A)">${ikonUrutNamaNilai()}</button></div>
        <!-- Garis Handle Geser (Kursor berubah jadi panah geser) -->
        <div class="col-resizer absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-500/50 transition-colors"></div></th>
        ${obsH1}
        <th rowspan="2" class="border-r border-b border-white/10 bg-indigo-900/40 text-[9px]" style="width:34px;min-width:34px;max-width:34px;padding:4px 2px;"><span style="display:inline-block;writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;">Penilaian Diri</span></th>
        <th colspan="2" class="px-2 py-2 border-r border-white/10 bg-yellow-900/40 border-b border-yellow-500/30">Teman Sejawat</th>
        <th rowspan="2" class="border-r border-b border-white/10 bg-purple-900/40 text-[9px]" style="width:34px;min-width:34px;max-width:34px;padding:4px 2px;"><span style="display:inline-block;writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;">Nilai Jurnal</span></th>
        <th colspan="3" class="px-2 py-2 border-r border-white/10 bg-green-900/40 border-b border-green-500/30">NILAI RAPORT</th>
        
        <!-- [REQ 7] KOLOM TUNGGAKAN BISA DI-TOGGLE -->
        <th rowspan="2" class="bg-red-900/30 border-r border-b border-white/10 cursor-pointer hover:bg-red-800 transition align-middle" onclick="toggleBelumTuntasNilai()" style="width: ${showBelumTuntasNilai ? '140px' : '30px'}; min-width: ${showBelumTuntasNilai ? '140px' : '30px'}; max-width: ${showBelumTuntasNilai ? '140px' : '30px'};">
            ${showBelumTuntasNilai ? '<div class="flex justify-between items-center px-1"><span class="text-[9px] text-red-300 font-bold tracking-normal leading-tight text-left">Belum<br>Tuntas</span> <button onclick="shareBelumTuntasWA(event)" class="bg-green-500 text-white px-1.5 py-1 rounded shadow hover:bg-green-400" title="Share WA"><i class="fa-brands fa-whatsapp"></i></button></div>' : '<i class="fa-solid fa-triangle-exclamation text-red-400" title="Klik lihat nilai belum tuntas"></i>'}
        </th>
        
        <th rowspan="2" class="bg-slate-800 border-r border-b border-white/10 align-middle"><div style="resize: horizontal; overflow: auto; min-width: 150px; width: 150px; padding: 8px;">Keterangan</div></th>
        </tr>
        <tr class="bg-slate-800 text-slate-400 text-[9px] text-center shadow-sm">
        <th class="sticky left-0 bg-slate-800 z-50 border-r border-b border-white/10"></th>
        ${obsH2}
        <th class="px-1 py-1 border-r border-b border-white/10 bg-yellow-900/20 text-slate-300" title="Rata-rata rating teman sejawat (skala 1-4)">Nilai Teman<br>Sejawat</th>
        <th class="px-1 py-1 border-r border-b border-white/10 bg-yellow-900/20 text-slate-300" title="Modus rating teman sejawat (1-4) + deskripsi karakter">Modus Teman<br>Sejawat</th>
        <th class="px-2 py-1 border-r border-b border-white/10 bg-green-900/20 text-slate-300">NA</th><th class="px-1 py-1 border-r border-b border-white/10 bg-green-900/20 text-slate-300">Prd</th>
        <th class="px-1 py-1 border-r border-b border-white/10 bg-indigo-900/20 text-slate-300" title="Nilai Raport (Sumatif/Capaian)">Nilai Raport</th>
      </tr>
    </thead>
  `;

  const tbodyHTML = urutMuridTampil().map((m, idx) => {
    const dt = rawDataNilai.find(d => d.NIS == m.NIS) || {};
    let obsHTML = '';
    
    // [REQ 4] BACA KOLOM SESUAI DATABASE: CP A1, CP A2, dst.
    for(let i=0; i<cfg.active_cp; i++) {
      let ltr = LTRS[i]; 
      for(let j=1; j<=cfg.active_sub_cp; j++) {
          obsHTML += `<td class="border-b border-r border-white/5 p-0"><input type="number" onfocus="storeOldVal(this)" onblur="kalkulasiSikap('${m.NIS}')" id="N_${m.NIS}_CP_${ltr}${j}" value="${dt[`CP ${ltr}${j}`] || ''}" class="w-8 h-8 bg-transparent text-center text-[10px] text-white outline-none focus:bg-blue-600/30"></td>`;
      }
    }

    // [REQ 3 & 5] Teman Sejawat: hasil agregat rating (bukan input 1-5)
    const hasilTeman = hitungHasilTemanSejawat(m.NIS);
    const modTemanTampil = hasilTeman.modus !== "" ? `${hasilTeman.modus} — ${hasilTeman.desk}` : '-';
    // [REQ 6c] Nilai Jurnal: saran otomatis dari hasil teman sejawat (dapat diedit guru)
    const saranJurnal = dt["Nilai Jurnal"] || hasilTeman.modus || '';

    let valAkhir = dt["Nilai Akhir Raport"] || ''; 
    let prdAkhir = dt["Predikat"] || (valAkhir ? hitungPredikat(valAkhir) : '-');

    // Cek Tunggakan Khusus UI Sikap saat dibuka
    let tHTML = '';
    if(showBelumTuntasNilai) {
        let t = [];
        const isMssg = (val) => (val === "" || val === null || Number(val) < 71);
        for(let i=0; i<cfg.active_cp; i++) {
            for(let j=1; j<=cfg.active_sub_cp; j++) { if(isMssg(dt[`CP ${LTRS[i]}${j}`])) t.push(`CP ${LTRS[i]}${j}`); }
        }
        if(isMssg(dt["Nilai Akhir Raport"])) t.push("Nilai Akhir");
        tHTML = t.length > 0 ? `<ul class="list-disc pl-3 text-[8.5px] leading-tight text-left max-w-[120px] mx-auto">${t.map(x=>`<li>${x}</li>`).join('')}</ul>` : '<div class="text-center text-[9px] text-green-400 font-bold">Tuntas</div>';
    } else {
        // Logika check icon ringan
        let hasMssg = false;
        if(valAkhir === "" || Number(valAkhir) < 71) hasMssg = true;
        tHTML = hasMssg ? '<div class="text-center"><i class="fa-solid fa-circle text-[8px] text-red-500"></i></div>' : '<div class="text-center"><i class="fa-solid fa-check text-[10px] text-green-500"></i></div>';
    }

    return `
      <tr class="hover:bg-white/5 transition text-xs" data-nis="${m.NIS}">
        <td class="sticky left-0 bg-[#0f172a] z-30 text-center border-b border-r border-white/10 px-2 cursor-pointer text-blue-400 font-bold group-hover:bg-slate-800" onclick="toggleNamaSiswaNilai()">${idx + 1}</td>
        <td class="sticky left-[32px] bg-[#0f172a] z-30 border-b border-r border-white/10 px-2 truncate text-left group-hover:bg-slate-800" style="display:${displayNama}; max-width: 0;">${m["Nama Lengkap"]}</td>
        ${obsHTML}
        <td class="border-b border-r border-white/5 p-0"><input type="number" onfocus="storeOldVal(this)" onblur="kalkulasiSikap('${m.NIS}')" id="N_${m.NIS}_Diri" value="${dt["Penilaian Diri"] || ''}" class="w-8 h-8 bg-indigo-900/10 text-center text-[10px] text-white outline-none focus:bg-indigo-600/30"></td>
        <!-- [REQ 3] NILAI TEMAN SEJAWAT (agregat) + tombol popup -->
        <td class="border-b border-r border-white/10 px-1 bg-yellow-900/10 text-center align-middle">
          <div class="flex items-center justify-center gap-1">
            <span id="LBL_${m.NIS}_NilaiTeman" class="text-[11px] font-bold text-yellow-200" title="Rata-rata rating teman sejawat (skala 1-4)">${hasilTeman.rata}</span>
            <button onclick="popupTemanSejawat('${m.NIS}')" class="w-5 h-5 shrink-0 rounded bg-yellow-600/20 hover:bg-yellow-600 text-yellow-300 hover:text-white transition" title="Input/Edit/Lihat Nilai Teman Sejawat"><i class="fa-solid fa-user-group text-[9px]"></i></button>
          </div>
        </td>
        <!-- [REQ 6] MODUS TEMAN SEJAWAT + deskripsi karakter -->
        <td class="border-b border-r border-white/10 px-1 bg-yellow-900/20 text-center align-middle">
          <div class="text-[10px] font-bold text-yellow-200 leading-tight" id="LBL_${m.NIS}_ModusTeman">${modTemanTampil}</div>
          ${hasilTeman.jumlahPenilai ? `<div class="text-[8px] text-slate-400 leading-tight">${hasilTeman.jumlahPenilai} penilai</div>` : ''}
        </td>
        <td class="border-b border-r border-white/5 p-0"><input type="number" min="1" max="4" onfocus="storeOldVal(this)" onblur="kalkulasiSikap('${m.NIS}')" id="N_${m.NIS}_Jurnal" value="${saranJurnal}" title="Saran otomatis dari hasil teman sejawat — dapat dikonfirmasi/diedit guru" class="w-8 h-8 bg-purple-900/10 text-center text-[10px] text-white outline-none focus:bg-purple-600/30"></td>
        
        <!-- [REQ: NA OTOMATIS] NILAI AKHIR = label hasil kalkulasi berbobot -->
        <td class="border-b border-r border-white/10 px-1 bg-green-900/10 text-center text-[12px] font-extrabold ${getWarnaPredikat(hitungPredikat(valAkhir))}" id="LBL_${m.NIS}_AkhirSikap" title="Kalkulasi otomatis: Observasi CP, Penilaian Diri, Teman Sejawat, Nilai Jurnal (bobot diedit di Jurnal Penilaian Sikap)">${valAkhir}</td>
        <td class="border-b border-r border-white/10 px-1 bg-green-900/10 text-center text-[12px] font-extrabold ${getWarnaPredikat(prdAkhir)}" id="PRD_${m.NIS}_AkhirSikap">${prdAkhir}</td>
        <td class="border-b border-r border-white/10 px-1 bg-indigo-900/10 text-center align-middle">
          <div class="flex items-center justify-center gap-1">
            <span id="RPT_${m.NIS}_AkhirSikap" class="text-[12px] font-extrabold ${getWarnaPredikat(hitungPredikat(valAkhir))}">${valAkhir}</span>
            <button onclick="popupDeskripsiRaport('${m.NIS}')" class="w-5 h-5 shrink-0 rounded bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white transition" title="Lihat/Edit Deskripsi Capaian"><i class="fa-solid fa-file-lines text-[9px]"></i></button>
          </div>
        </td>
        
        <td class="border-b border-r border-white/5 px-2 py-1 text-red-300 whitespace-normal bg-red-900/10 cursor-pointer align-middle" onclick="toggleBelumTuntasNilai()">${tHTML}</td>
        <td class="border-b border-r border-white/5 p-0 align-middle"><input type="text" onfocus="storeOldVal(this)" onblur="saveKeteranganNilai('${m.NIS}')" id="KET_${m.NIS}" value="${dt.Keterangan || ''}" class="w-full h-8 bg-transparent text-left px-2 text-[10px] text-white outline-none focus:bg-white/10"></td>
      </tr>
    `;
  }).join('');

  const stCfg = cfgSikapTeman();
  let footerInfo = `<b>INFO SIKAP:</b> CP Aktif (${cfg.active_cp}), Sub-CP per-Item (${cfg.active_sub_cp}). Teman Sejawat: rata-rata & modus rating skala 1-4 (${stCfg.jumlah_teman} teman; sesi ${stCfg.sesi_buka ? '<span class="text-green-400 font-bold">BUKA</span>' : '<span class="text-red-400 font-bold">TUTUP</span>'}). Nilai Akhir Raport diinput manual sesuai kebijakan.<br>
  <b>KRITERIA SKOR:</b> &nbsp; <span class="text-green-400 font-bold">4 = ${escapeHtml(stCfg.kriteria[4])}</span> <span class="mx-1">|</span> <span class="text-blue-400 font-bold">3 = ${escapeHtml(stCfg.kriteria[3])}</span> <span class="mx-1">|</span> <span class="text-yellow-400 font-bold">2 = ${escapeHtml(stCfg.kriteria[2])}</span> <span class="mx-1">|</span> <span class="text-red-400 font-bold">1 = ${escapeHtml(stCfg.kriteria[1])}</span><br><i>Modus → deskripsi karakter: 4 = Sangat Baik (SB), 3 = Baik (B), 2 = Cukup (C), 1 = Kurang (K). Atur di tombol "Set" → "Jurnal Penilaian Sikap".</i>`;
  document.getElementById('tabel-nilai').innerHTML = `${theadHTML}<tbody>${tbodyHTML}</tbody><tfoot><tr class="bg-slate-800 text-[10px] text-slate-400 border-t border-white/20"><td colspan="100%" class="py-2 px-3 text-center">${footerInfo}</td></tr></tfoot>`;
  enableNamaSiswaResize();
}

function kalkulasiSikap(nis, isFromUndo = false) {
  const cfg = configNilaiAktif; 
  let updates = {}; 
  const LTRS = ['A','B','C','D'];

  // [REQ 2] Validasi khusus skala Sikap: hanya angka 1-4 (kosong diperbolehkan)
  const addVal14 = (elId, dbKey) => {
      let el = document.getElementById(elId); if (!el) return "";
      let valStr = el.value;
      if (valStr === "") { updates[dbKey] = ""; return ""; }
      let v = Math.round(Number(valStr));
      if (isNaN(v)) v = 1;
      let diubah = false;
      if (v > 4) { v = 4; diubah = true; }
      if (v < 1) { v = 1; diubah = true; }
      if (diubah) {
          Swal.fire({toast: true, position: 'top-end', icon: 'warning', title: 'Nilai sikap hanya 1 - 4!', showConfirmButton: false, timer: 2000, background: '#1e293b', color: '#fff'});
      }
      if (!isFromUndo && el.dataset.oldval !== undefined && el.dataset.oldval !== String(v)) recordUndo(nis, elId, el.dataset.oldval, v);
      el.value = v; updates[dbKey] = v; return v;
  };

  // [REQ 4] Sinkronisasi baca tulis ke "CP A1", "CP B1", dst. (skala 1-4) + kumpulkan untuk NA
  let arrCP = [];
  for(let i=0; i<cfg.active_cp; i++) {
      for(let j=1; j<=cfg.active_sub_cp; j++) {
          const vCP = addVal14(`N_${nis}_CP_${LTRS[i]}${j}`, `CP ${LTRS[i]}${j}`);
          if (vCP !== "") arrCP.push(Number(vCP));
      }
  }
  const rataCP = arrCP.length ? arrCP.reduce((a, b) => a + b, 0) / arrCP.length : "";
  
  const vDiri = addVal14(`N_${nis}_Diri`, "Penilaian Diri");

  // [REQ 3 & 6] Teman Sejawat: hasil agregat dari tabel nilai_teman_sejawat (bukan input 1-5)
  const hTeman = hitungHasilTemanSejawat(nis);
  updates["Nilai Teman Sejawat"] = hTeman.rata;
  updates["Modus Teman Sejawat"] = hTeman.modus;
  updates["Deskripsi Karakter"] = hTeman.desk;

  // [REQ 6c] Nilai Jurnal (skala 1-4; saran otomatis dari hasil teman sejawat, konfirmasi guru)
  const vJurnal = addVal14(`N_${nis}_Jurnal`, "Nilai Jurnal");

  // [REQ: NA OTOMATIS] Komponen 1-4 → 0-100 (÷4×100), digabung berbobot (bobot diedit di Jurnal Penilaian Sikap)
  const bwNA = cfgSikapTeman().bobot;
  const ke100 = (v) => v !== "" ? (Number(v) / 4) * 100 : 0;
  const adaKomponen = rataCP !== "" || vDiri !== "" || hTeman.rata !== "" || vJurnal !== "";
  let vAkhir = "";
  if (adaKomponen) {
      vAkhir = Math.round(
          ke100(rataCP) * bwNA.obs / 100 +
          ke100(vDiri) * bwNA.diri / 100 +
          ke100(hTeman.rata) * bwNA.teman / 100 +
          ke100(vJurnal) * bwNA.jurnal / 100
      );
  }
  let prdAkhir = vAkhir !== "" ? hitungPredikat(vAkhir) : "-";

  // Sel NA = label otomatis (tidak dapat diketik manual)
  updateWarnaEl(`LBL_${nis}_AkhirSikap`, vAkhir);
  const elNa = document.getElementById(`LBL_${nis}_AkhirSikap`);
  if (elNa) elNa.innerText = vAkhir;
  
  document.getElementById(`PRD_${nis}_AkhirSikap`).innerText = prdAkhir; updateWarnaEl(`PRD_${nis}_AkhirSikap`, vAkhir);
  
  updates["Nilai Akhir Raport"] = vAkhir; 
  updates["Predikat"] = prdAkhir;
  Object.assign(updates, deriveNilaiRaport(nis, 'AkhirSikap', null, vAkhir, 'capaian'));

  const ketEl = document.getElementById(`KET_${nis}`);
  if(ketEl) updates["Keterangan"] = ketEl.value;

  if(!isFromUndo) silentSaveNilai(nis, updates);
}

// ==========================================
// SIKAP: POPUP TEMAN SEJAWAT (GURU/ADMIN)
// ==========================================
/** Muat seluruh rating teman sejawat kelas+mapel+tahun+semester aktif → { [penilai]: { [target]: skor } } */
async function muatRatingTemanSejawat() {
  const mapel = document.getElementById('select-mapel-nilai').value;
  const kelas = document.getElementById('select-kelas-nilai').value;
  const { data, error } = await supaClient.from('nilai_teman_sejawat')
    .select('penilai_nis, target_nis, skor')
    .eq('mapel', mapel)
    .eq('kelas', kelas)
    .eq('tahun', currentTahun)
    .eq('semester', currentSemesterNilai);
  if (error) throw error;
  const map = {};
  (data || []).forEach(r => {
    const p = String(r.penilai_nis);
    if (!map[p]) map[p] = {};
    map[p][String(r.target_nis)] = Number(r.skor);
  });
  return map;
}

/** Bangun ulang cache agregat per target dari peta rating penilai. */
function rebuildCacheTemanSejawat(ratingMap) {
  cacheTemanSejawat = {};
  Object.values(ratingMap || {}).forEach(targets => {
    Object.entries(targets || {}).forEach(([tgt, skor]) => {
      if (skor === "" || skor === null || skor === undefined) return;
      const key = String(tgt);
      if (!cacheTemanSejawat[key]) cacheTemanSejawat[key] = [];
      cacheTemanSejawat[key].push(Number(skor));
    });
  });
}

/** Buka/tutup sesi penilaian teman sejawat (disimpan ke config kategori Sikap). */
async function toggleSesiTemanSejawat() {
  const st = cfgSikapTeman();
  const bukaBaru = !st.sesi_buka;
  configNilaiAktif.sikap_teman = { ...st, sesi_buka: bukaBaru };
  if (bukaBaru) { configNilaiAktif.sikap_teman.sesi_tahun = currentTahun; configNilaiAktif.sikap_teman.sesi_semester = currentSemesterNilai; }
  const mapel = document.getElementById('select-mapel-nilai').value;
  try {
    await simpanKonfigurasiNilai(currentKategoriNilai, mapel, configNilaiAktif);
    const badge = document.getElementById('badge-sesi-teman');
    const btn = document.getElementById('btn-sesi-teman');
    if (badge) badge.innerHTML = bukaBaru ? '<i class="fa-solid fa-lock-open text-green-400"></i> Sesi BUKA' : '<i class="fa-solid fa-lock text-red-400"></i> Sesi TUTUP';
    if (btn) { btn.className = `text-[9px] px-2 py-1 rounded text-white transition ${bukaBaru ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`; btn.innerHTML = bukaBaru ? '<i class="fa-solid fa-lock"></i> Tutup Sesi' : '<i class="fa-solid fa-lock-open"></i> Buka Sesi'; }
    renderTabelSikap();
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Gagal', text: e.message || 'Gagal menyimpan sesi.', background: '#1e293b', color: '#fff' });
  }
}

/** [REQ 5] Popup guru/admin: input, edit, dan lihat hasil "Nilai Teman Sejawat".
 *  Matriks: baris = penilai (nama siswa), kolom = N teman (dropdown target + skor 1-4). */
async function popupTemanSejawat(nisSorot = '') {
  const kelas = document.getElementById('select-kelas-nilai').value;
  const st = cfgSikapTeman();
  let ratingMap = {};
  try { ratingMap = await muatRatingTemanSejawat(); }
  catch (e) { return Swal.fire({ icon: 'error', title: 'Gagal memuat rating', text: e.message || '', background: '#1e293b', color: '#fff' }); }
  rebuildCacheTemanSejawat(ratingMap);

  const namaByNis = {};
  listMuridKelas.forEach(m => { namaByNis[String(m.NIS)] = m["Nama Lengkap"] || String(m.NIS); });
  const urutNama = [...listMuridKelas].sort((a, b) => String(a["Nama Lengkap"]).localeCompare(String(b["Nama Lengkap"]), 'id')).map(m => String(m.NIS));

  // Matriks input: default target = rotasi alfabetis agar semua siswa mendapat penilai
  const barisMatriks = listMuridKelas.map((m, i) => {
    const nisP = String(m.NIS);
    const kandidat = urutNama.filter(n => n !== nisP);
    const tersimpanKeys = Object.keys(ratingMap[nisP] || {});
    let selTeman = '';
    for (let j = 0; j < st.jumlah_teman; j++) {
      const targetTersimpan = tersimpanKeys[j] || '';
      const target = targetTersimpan || (kandidat.length ? kandidat[(i + j) % kandidat.length] : '');
      const skor = targetTersimpan ? ratingMap[nisP][targetTersimpan] : '';
      const opts = ['<option value="">— pilih —</option>']
        .concat(kandidat.map(n => `<option value="${escJs(n)}" ${n === target ? 'selected' : ''}>${escapeHtml(namaByNis[n] || n)}</option>`))
        .join('');
      const skorOpts = ['<option value=""></option>']
        .concat([4, 3, 2, 1].map(s => `<option value="${s}" title="${escapeHtml(st.kriteria[s])}" ${String(skor) === String(s) ? 'selected' : ''}>${s}</option>`))
        .join('');
      selTeman += `
        <td class="border border-white/10 p-1 whitespace-nowrap">
          <select data-role="target" class="bg-slate-700 border border-white/20 rounded px-1 py-0.5 text-[9px] text-white outline-none max-w-[110px]">${opts}</select>
          <select data-role="skor" class="bg-slate-700 border border-white/20 rounded px-1 py-0.5 text-[9px] text-white outline-none w-11 ml-1">${skorOpts}</select>
        </td>`;
    }
    const sorot = String(nisSorot) === nisP ? 'bg-blue-900/30' : '';
    return `<tr data-penilai="${escJs(nisP)}" class="${sorot}">
      <td class="border border-white/10 px-2 py-1 text-[10px] text-slate-200 whitespace-nowrap sticky left-0 bg-slate-800">${escapeHtml(m["Nama Lengkap"] || nisP)}</td>
      ${selTeman}
    </tr>`;
  }).join('');

  // Tab Hasil: agregat per siswa (target)
  const barisHasil = listMuridKelas.map(m => {
    const h = hitungHasilTemanSejawat(m.NIS);
    const arr = (cacheTemanSejawat[String(m.NIS)] || []).join(', ') || '-';
    return `<tr>
      <td class="border border-white/10 px-2 py-1 text-[10px] text-left text-slate-200 whitespace-nowrap">${escapeHtml(m["Nama Lengkap"] || '')}</td>
      <td class="border border-white/10 px-2 py-1 text-center text-[10px]">${h.jumlahPenilai}</td>
      <td class="border border-white/10 px-2 py-1 text-center text-[10px]">${arr}</td>
      <td class="border border-white/10 px-2 py-1 text-center text-[10px] font-bold text-yellow-200">${h.rata}</td>
      <td class="border border-white/10 px-2 py-1 text-center text-[10px] font-bold">${h.modus || '-'}</td>
      <td class="border border-white/10 px-2 py-1 text-center text-[10px] ${h.modus ? (h.modus >= 3 ? 'text-green-300' : 'text-red-300') : 'text-slate-500'}">${h.desk}</td>
      <td class="border border-white/10 px-2 py-1 text-center text-[10px]">${h.persen !== "" ? h.persen + '%' : '-'}</td>
    </tr>`;
  }).join('');

  const kriteriaHTML = [4, 3, 2, 1].map(s => `<div class="text-[9px] text-slate-300"><b class="text-yellow-300">${s}</b> = ${escapeHtml(st.kriteria[s])}</div>`).join('');

  Swal.fire({
    title: `<div class="text-sm font-bold text-yellow-300"><i class="fa-solid fa-user-group"></i> Nilai Teman Sejawat — ${escapeHtml(kelas)}</div>`,
    width: '950px',
    html: `
      <div class="text-left text-[11px] text-slate-300">
        <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <div class="flex items-center gap-2">
            <span id="badge-sesi-teman" class="text-[10px] px-2 py-1 rounded bg-black/40 border border-white/10">${st.sesi_buka ? '<i class="fa-solid fa-lock-open text-green-400"></i> Sesi BUKA' : '<i class="fa-solid fa-lock text-red-400"></i> Sesi TUTUP'}</span>
            <button id="btn-sesi-teman" onclick="toggleSesiTemanSejawat()" class="text-[9px] px-2 py-1 rounded text-white transition ${st.sesi_buka ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}">${st.sesi_buka ? '<i class="fa-solid fa-lock"></i> Tutup Sesi' : '<i class="fa-solid fa-lock-open"></i> Buka Sesi'}</button>
          </div>
          <div class="flex gap-1">
            <button onclick="tabTemanSejawat('input')" id="tab-btn-input" class="px-3 py-1 rounded text-[10px] font-bold bg-yellow-600 text-white">Input / Edit</button>
            <button onclick="tabTemanSejawat('hasil')" id="tab-btn-hasil" class="px-3 py-1 rounded text-[10px] font-bold bg-slate-700 text-slate-300">Hasil</button>
          </div>
        </div>
        <div class="text-[9px] text-slate-400 mb-2 italic">"${escapeHtml(st.judul)}" — ${escapeHtml(st.keterangan)}</div>
        <div id="tab-input">
          <div class="max-h-[45vh] overflow-auto custom-scrollbar border border-white/10 rounded">
            <table class="w-full border-collapse">
              <thead><tr class="bg-slate-800 text-[9px] text-slate-300">
                <th class="border border-white/10 px-2 py-1 sticky left-0 bg-slate-800">Penilai</th>
                ${Array.from({length: st.jumlah_teman}, (_, j) => `<th class="border border-white/10 px-1 py-1">Teman ${j + 1}</th>`).join('')}
              </tr></thead>
              <tbody>${barisMatriks}</tbody>
            </table>
          </div>
          <div class="text-[8px] text-slate-500 mt-1">${kriteriaHTML}</div>
        </div>
        <div id="tab-hasil" style="display:none">
          <div class="max-h-[45vh] overflow-auto custom-scrollbar border border-white/10 rounded">
            <table class="w-full border-collapse">
              <thead><tr class="bg-slate-800 text-[9px] text-slate-300">
                <th class="border border-white/10 px-2 py-1">Nama Siswa</th><th class="border border-white/10 px-2 py-1">Penilai</th>
                <th class="border border-white/10 px-2 py-1">Rating</th><th class="border border-white/10 px-2 py-1">Rata-rata (1-4)</th>
                <th class="border border-white/10 px-2 py-1">Modus</th><th class="border border-white/10 px-2 py-1">Deskripsi Karakter</th>
                <th class="border border-white/10 px-2 py-1">Skor % (Total/Maks×100)</th>
              </tr></thead>
              <tbody>${barisHasil}</tbody>
            </table>
          </div>
        </div>
      </div>`,
    background: '#1e293b', color: '#fff',
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-save"></i> Simpan Semua Rating',
    cancelButtonText: 'Tutup',
    preConfirm: () => {
      const rows = [];
      Swal.getPopup().querySelectorAll('tr[data-penilai]').forEach(tr => {
        const penilai = tr.dataset.penilai;
        tr.querySelectorAll('td').forEach(td => {
          const target = td.querySelector('select[data-role="target"]')?.value;
          const skor = td.querySelector('select[data-role="skor"]')?.value;
          if (penilai && target && skor) rows.push({ penilai_nis: penilai, target_nis: target, skor: Number(skor) });
        });
      });
      return rows;
    }
  }).then(async (res) => {
    if (!res.isConfirmed) return;
    const rows = res.value || [];
    if (!rows.length) return Swal.fire({ icon: 'info', title: 'Tidak ada rating terisi', text: 'Isi minimal satu skor 1-4.', background: '#1e293b', color: '#fff' });
    const kelasV = document.getElementById('select-kelas-nilai').value;
    const mapelV = document.getElementById('select-mapel-nilai').value;
    const idGuru = currentUser && currentUser.user ? (currentUser.user["ID Akun Guru"] || "") : "";
    const payload = rows.map(r => ({ ...r, kelas: kelasV, mapel: mapelV, tahun: currentTahun, semester: currentSemesterNilai, id_guru: idGuru }));
    Swal.fire({ title: 'Menyimpan Rating...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
    const { error } = await supaClient.from('nilai_teman_sejawat')
      .upsert(payload, { onConflict: 'penilai_nis,target_nis,mapel,tahun,semester' });
    if (error) {
      Swal.fire({ icon: 'error', title: 'Gagal Simpan', text: error.message, background: '#1e293b', color: '#fff' });
      return;
    }
    rebuildCacheTemanSejawat(await muatRatingTemanSejawat());
    rawDataNilai.forEach(r => {
      const h = hitungHasilTemanSejawat(r.NIS ?? r.nis);
      r["Nilai Teman Sejawat"] = h.rata; r["Modus Teman Sejawat"] = h.modus; r["Deskripsi Karakter"] = h.desk;
    });
    renderTabelSikap();
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `${rows.length} rating tersimpan`, showConfirmButton: false, timer: 1800, background: '#1e293b', color: '#fff' });
  });
}

/** Toggle tab di popup Teman Sejawat. */
function tabTemanSejawat(tab) {
  const elInput = document.getElementById('tab-input');
  const elHasil = document.getElementById('tab-hasil');
  const btnIn = document.getElementById('tab-btn-input');
  const btnHa = document.getElementById('tab-btn-hasil');
  if (!elInput || !elHasil) return;
  elInput.style.display = tab === 'input' ? 'block' : 'none';
  elHasil.style.display = tab === 'hasil' ? 'block' : 'none';
  if (btnIn) btnIn.className = `px-3 py-1 rounded text-[10px] font-bold ${tab === 'input' ? 'bg-yellow-600 text-white' : 'bg-slate-700 text-slate-300'}`;
  if (btnHa) btnHa.className = `px-3 py-1 rounded text-[10px] font-bold ${tab === 'hasil' ? 'bg-yellow-600 text-white' : 'bg-slate-700 text-slate-300'}`;
}

/** Tambah baris kosong pada tabel jurnal di popup Jurnal Penilaian Sikap. */
function tambahBarisJurnalSikap() {
  const wrap = document.getElementById('jurnal-rows');
  if (!wrap || !window.__barisJurnalSikap) return;
  wrap.insertAdjacentHTML('beforeend', window.__barisJurnalSikap({}));
}

/** [REQ 1] Popup "Jurnal Penilaian Sikap": kriteria skor 1-4 (kuesioner semua indikator CP),
 *  judul/keterangan/jumlah teman kuesioner, sesi murid, dan tabel Integrasi Jurnal
 *  (hari/tanggal, kejadian, aspek sikap, tindak lanjut). */
async function popupJurnalSikap() {
  const kelas = document.getElementById('select-kelas-nilai').value;
  const mapel = document.getElementById('select-mapel-nilai').value;
  const st = cfgSikapTeman();

  // Muat jurnal tersimpan untuk kelas+mapel+tahun+semester aktif
  let jurnalRows = [];
  try {
    const { data, error } = await supaClient.from('jurnal_sikap')
      .select('id, hari_tanggal, kejadian, aspek_sikap, tindak_lanjut')
      .eq('kelas', kelas).eq('mapel', mapel)
      .eq('tahun', currentTahun).eq('semester', currentSemesterNilai);
    if (error) throw error;
    jurnalRows = data || [];
  } catch (e) { console.warn('Gagal memuat jurnal sikap:', e.message || e); }

  const barisJurnal = (j) => `
    <div class="jurnal-row grid grid-cols-12 gap-1 mb-1 items-start">
      <input type="text" data-role="hari_tanggal" value="${escapeHtml(j.hari_tanggal || '')}" placeholder="Hari/Tanggal" class="col-span-3 bg-black/40 border border-white/20 rounded px-1.5 py-1 text-[10px] text-white outline-none">
      <input type="text" data-role="kejadian" value="${escapeHtml(j.kejadian || '')}" placeholder="Kejadian" class="col-span-4 bg-black/40 border border-white/20 rounded px-1.5 py-1 text-[10px] text-white outline-none">
      <input type="text" data-role="aspek_sikap" value="${escapeHtml(j.aspek_sikap || '')}" placeholder="Aspek Sikap" class="col-span-2 bg-black/40 border border-white/20 rounded px-1.5 py-1 text-[10px] text-white outline-none">
      <input type="text" data-role="tindak_lanjut" value="${escapeHtml(j.tindak_lanjut || '')}" placeholder="Tindak Lanjut" class="col-span-2 bg-black/40 border border-white/20 rounded px-1.5 py-1 text-[10px] text-white outline-none">
      <button type="button" onclick="this.closest('.jurnal-row').remove()" class="col-span-1 w-7 h-7 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded transition" title="Hapus baris"><i class="fa-solid fa-trash text-[9px]"></i></button>
    </div>`;

  Swal.fire({
    title: `<div class="text-sm font-bold text-green-300"><i class="fa-solid fa-book-open"></i> Jurnal Penilaian Sikap</div>`,
    width: '760px',
    html: `
      <div class="text-left text-[11px] text-slate-300">
        <div class="bg-black/30 border border-white/10 rounded p-2 mb-3">
          <div class="text-[9px] uppercase tracking-wider text-slate-500 font-bold mb-1">Kelas ${escapeHtml(kelas)} — ${escapeHtml(mapel || 'Sikap')} | ${escapeHtml(currentTahun)} — ${escapeHtml(currentSemesterNilai)}</div>
          <label class="block text-[10px] font-bold mb-1 text-green-300">Kriteria Skor Kuesioner (semua indikator CP — dapat diedit)</label>
          ${[4, 3, 2, 1].map(s => `
            <div class="flex items-center gap-2 mb-1">
              <span class="w-6 h-6 shrink-0 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold text-yellow-300">${s}</span>
              <input type="text" id="cfg_st_k${s}" value="${escapeHtml(st.kriteria[s])}" class="flex-1 bg-black/40 border border-white/20 rounded px-2 py-1 text-[10px] text-white outline-none">
            </div>`).join('')}
        </div>
        <div class="bg-black/30 border border-white/10 rounded p-2 mb-3">
          <label class="block text-[10px] font-bold mb-1 text-yellow-300">Kuesioner Teman Sejawat</label>
          <div class="flex gap-2 mb-1">
            <div class="flex-1">
              <span class="text-[9px] text-slate-400">Judul (dapat diedit)</span>
              <input type="text" id="cfg_st_judul" value="${escapeHtml(st.judul)}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1 text-[10px] text-white outline-none">
            </div>
            <div class="w-24">
              <span class="text-[9px] text-slate-400">Jml Teman (1-5)</span>
              <input type="number" id="cfg_st_jumlah" min="1" max="5" value="${st.jumlah_teman}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1 text-center text-[10px] text-white outline-none">
            </div>
          </div>
          <span class="text-[9px] text-slate-400">Keterangan (dapat diedit)</span>
          <textarea id="cfg_st_ket" rows="2" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1 mt-0.5 text-[10px] text-white outline-none">${escapeHtml(st.keterangan)}</textarea>
          <label class="block text-[10px] font-bold mt-3 mb-1 text-purple-300">Bobot Nilai Akhir (%) — NA = Σ(komponen 0-100 × bobot%)</label>
          <div class="flex gap-2">
            <div class="w-1/4"><span class="text-[9px] text-slate-400">Obs. CP</span><input type="number" id="cfg_st_b_obs" min="0" max="100" value="${st.bobot.obs}" class="w-full bg-black/40 border border-white/20 rounded px-1 py-1 text-center text-[10px] text-white outline-none"></div>
            <div class="w-1/4"><span class="text-[9px] text-slate-400">Nilai Diri</span><input type="number" id="cfg_st_b_diri" min="0" max="100" value="${st.bobot.diri}" class="w-full bg-black/40 border border-white/20 rounded px-1 py-1 text-center text-[10px] text-white outline-none"></div>
            <div class="w-1/4"><span class="text-[9px] text-slate-400">Teman</span><input type="number" id="cfg_st_b_teman" min="0" max="100" value="${st.bobot.teman}" class="w-full bg-black/40 border border-white/20 rounded px-1 py-1 text-center text-[10px] text-white outline-none"></div>
            <div class="w-1/4"><span class="text-[9px] text-slate-400">Jurnal</span><input type="number" id="cfg_st_b_jurnal" min="0" max="100" value="${st.bobot.jurnal}" class="w-full bg-black/40 border border-white/20 rounded px-1 py-1 text-center text-[10px] text-white outline-none"></div>
          </div>
          <div class="flex items-center gap-2 mt-2 flex-wrap">
            <span class="text-[9px] text-slate-400">Sesi penilaian oleh murid:</span>
            <select id="cfg_st_sesi" class="bg-slate-700 border border-white/20 rounded px-2 py-1 text-[10px] text-white outline-none">
              <option value="buka" ${st.sesi_buka ? 'selected' : ''}>BUKA (murid dapat menilai)</option>
              <option value="tutup" ${!st.sesi_buka ? 'selected' : ''}>TUTUP</option>
            </select>
            <span class="text-[8px] text-slate-500">Tahun/Semester sesi mengikuti filter aktif (${escapeHtml(currentTahun)} — ${escapeHtml(currentSemesterNilai)}).</span>
          </div>
        </div>
        <div class="bg-black/30 border border-white/10 rounded p-2">
          <label class="block text-[10px] font-bold mb-1 text-blue-300">Integrasi ke Jurnal Penilaian Sikap (Oleh Guru)</label>
          <div class="grid grid-cols-12 gap-1 text-[8px] text-slate-500 font-bold mb-1 px-1">
            <span class="col-span-3">Hari/Tanggal</span><span class="col-span-4">Kejadian</span><span class="col-span-2">Aspek Sikap</span><span class="col-span-2">Tindak Lanjut</span><span class="col-span-1"></span>
          </div>
          <div id="jurnal-rows">${jurnalRows.map(barisJurnal).join('')}</div>
          <button type="button" onclick="tambahBarisJurnalSikap()" class="mt-1 text-[9px] px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white transition"><i class="fa-solid fa-plus"></i> Tambah Baris Jurnal</button>
        </div>
      </div>`,
    background: '#1e293b', color: '#fff',
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-save"></i> Simpan Jurnal & Konfigurasi',
    cancelButtonText: 'Batal',
    didOpen: () => { window.__barisJurnalSikap = barisJurnal; },
    preConfirm: () => {
      const popup = Swal.getPopup();
      const rows = [];
      popup.querySelectorAll('.jurnal-row').forEach(row => {
        const ambil = (r) => row.querySelector(`[data-role="${r}"]`)?.value.trim() || '';
        const baris = { hari_tanggal: ambil('hari_tanggal'), kejadian: ambil('kejadian'), aspek_sikap: ambil('aspek_sikap'), tindak_lanjut: ambil('tindak_lanjut') };
        if (baris.hari_tanggal || baris.kejadian || baris.aspek_sikap || baris.tindak_lanjut) rows.push(baris);
      });
      const kriteria = {};
      [4, 3, 2, 1].forEach(s => { kriteria[s] = popup.querySelector(`#cfg_st_k${s}`)?.value.trim() || ''; });
      return {
        rows, kriteria,
        judul: popup.querySelector('#cfg_st_judul')?.value.trim() || 'Berilah nilai untuk 5 teman',
        jumlah: Math.min(5, Math.max(1, parseInt(popup.querySelector('#cfg_st_jumlah')?.value) || 5)),
        keterangan: popup.querySelector('#cfg_st_ket')?.value.trim() || '',
        sesi: popup.querySelector('#cfg_st_sesi')?.value || 'tutup',
        bobot: {
          obs: Math.max(0, parseInt(popup.querySelector('#cfg_st_b_obs')?.value) || 0),
          diri: Math.max(0, parseInt(popup.querySelector('#cfg_st_b_diri')?.value) || 0),
          teman: Math.max(0, parseInt(popup.querySelector('#cfg_st_b_teman')?.value) || 0),
          jurnal: Math.max(0, parseInt(popup.querySelector('#cfg_st_b_jurnal')?.value) || 0)
        }
      };
    }
  }).then(async (res) => {
    if (!res.isConfirmed) return;
    const v = res.value || {};
    const stLama = cfgSikapTeman();
    const stBaru = {
      judul: v.judul,
      keterangan: v.keterangan,
      jumlah_teman: v.jumlah,
      sesi_buka: v.sesi === 'buka',
      sesi_tahun: v.sesi === 'buka' ? currentTahun : stLama.sesi_tahun,
      sesi_semester: v.sesi === 'buka' ? currentSemesterNilai : stLama.sesi_semester,
      bobot: v.bobot,
      kriteria: (v.kriteria && v.kriteria[4] !== '') ? v.kriteria : stLama.kriteria
    };
    await simpanJurnalSikapPopup(v.rows || [], stBaru);
  });
}

/** Simpan hasil popup Jurnal Sikap: konfigurasi + baris jurnal (hapus lalu tulis ulang per scope). */
async function simpanJurnalSikapPopup(rows, stBaru) {
  const kelas = document.getElementById('select-kelas-nilai').value;
  const mapel = document.getElementById('select-mapel-nilai').value;
  const idGuru = currentUser && currentUser.user ? (currentUser.user["ID Akun Guru"] || "") : "";
  Swal.fire({ title: 'Menyimpan Jurnal Sikap...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
  try {
    configNilaiAktif.sikap_teman = stBaru;
    await simpanKonfigurasiNilai(currentKategoriNilai, mapel, configNilaiAktif);
    // Jurnal: hapus lalu tulis ulang (scope kelas+mapel+tahun+semester)
    const del = await supaClient.from('jurnal_sikap')
      .delete()
      .eq('kelas', kelas).eq('mapel', mapel)
      .eq('tahun', currentTahun).eq('semester', currentSemesterNilai);
    if (del.error) throw del.error;
    if (rows.length) {
      const payload = rows.map(r => ({ ...r, kelas, mapel, tahun: currentTahun, semester: currentSemesterNilai, id_guru: idGuru }));
      const ins = await supaClient.from('jurnal_sikap').insert(payload);
      if (ins.error) throw ins.error;
    }
    renderTabelSikap();
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Jurnal Sikap tersimpan', showConfirmButton: false, timer: 1800, background: '#1e293b', color: '#fff' });
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Gagal Simpan', text: e.message || '', background: '#1e293b', color: '#fff' });
  }
}

// ==========================================
// SIKAP: MODUL MURID — PENILAIAN TEMAN SEJAWAT
// ==========================================
/** [REQ 4] Menu murid: menilai teman sejawat (skala 1-4) saat sesi dibuka guru.
 *  Data via RPC security definer (murid password lokal tidak punya sesi Auth). */
async function renderTemanSejawatMurid(container) {
  const user = currentUser.user || {};
  const nis = user["NIS"] || "";
  container.innerHTML = `<div class="p-6 text-center text-slate-300"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>Memuat Penilaian Teman Sejawat...</div>`;

  let sesiList = [];
  try {
    const { data, error } = await supaClient.rpc('sesi_teman_terbuka');
    if (error) throw error;
    sesiList = data || [];
  } catch (e) {
    container.innerHTML = `<div class="p-6 text-center text-red-400 text-xs">Gagal memuat sesi: ${escapeHtml(e.message || '')}</div>`;
    return;
  }

  if (!sesiList.length) {
    container.innerHTML = `
      <div class="max-w-md mx-auto mt-10 glass-card p-6 rounded-xl text-center">
        <i class="fa-solid fa-lock text-3xl text-red-400 mb-3"></i>
        <h3 class="text-sm font-bold text-white mb-1">Sesi Penilaian Belum Dibuka</h3>
        <p class="text-xs text-slate-400">Guru belum membuka sesi penilaian teman sejawat. Silakan hubungi guru mata pelajaran Anda.</p>
      </div>`;
    return;
  }

  const pilihSesi = sesiList.length > 1
    ? `<select id="murid-sesi-mapel" onchange="muatFormTemanSejawatMurid()" class="bg-slate-700 border border-white/20 rounded px-3 py-1.5 text-xs text-white outline-none">
        ${sesiList.map((s, i) => `<option value="${escJs(s.mapel || '')}" class="bg-slate-800">${escapeHtml(s.mapel || 'Sikap')}${s.tahun ? ` — ${escapeHtml(s.tahun)} ${escapeHtml(s.semester || '')}` : ''}</option>`).join('')}
      </select>`
    : '';

  container.innerHTML = `
    <div class="max-w-2xl mx-auto mt-4 mb-8">
      <div class="text-center mb-4">
        <h3 class="text-sm sm:text-base font-extrabold text-white tracking-wider uppercase"><i class="fa-solid fa-user-group text-yellow-400"></i> Penilaian Teman Sejawat</h3>
        <div class="mt-2 flex justify-center items-center gap-2">
          ${pilihSesi || `<span class="text-[10px] text-slate-400"><i class="fa-solid fa-lock-open text-green-400"></i> Sesi BUKA</span>`}
        </div>
      </div>
      <div id="murid-form-teman" class="glass-card rounded-xl border border-white/10 p-4"></div>
    </div>
  `;
  await muatFormTemanSejawatMurid();
}

/** Muat form rating (dipanggil ulang saat ganti sesi/mapel). */
async function muatFormTemanSejawatMurid() {
  const wrap = document.getElementById('murid-form-teman');
  if (!wrap) return;
  const user = currentUser.user || {};
  const nis = user["NIS"] || "";
  const mapel = document.getElementById('murid-sesi-mapel')?.value || '';

  wrap.innerHTML = `<div class="p-4 text-center text-slate-300 text-xs"><i class="fa-solid fa-circle-notch fa-spin"></i> Memuat daftar teman...</div>`;

  let res;
  try {
    const { data, error } = await supaClient.rpc('ambil_teman_sekelas', { p_nis: nis, p_mapel: mapel });
    if (error) throw error;
    res = data || {};
  } catch (e) {
    wrap.innerHTML = `<div class="p-4 text-center text-red-400 text-xs">Gagal memuat data: ${escapeHtml(e.message || '')}</div>`;
    return;
  }
  if (res.status !== 'success') {
    wrap.innerHTML = `<div class="p-4 text-center text-red-400 text-xs">${escapeHtml(res.message || 'Gagal memuat data.')}</div>`;
    return;
  }
  if (!res.sesi_buka) {
    wrap.innerHTML = `<div class="p-4 text-center text-slate-300 text-xs"><i class="fa-solid fa-lock text-red-400"></i> Sesi sudah ditutup guru.</div>`;
    return;
  }

  const teman = res.teman || [];
  const ratingSaya = res.rating_saya || {};
  const kriteria = res.kriteria || {};
  const jumlah = Math.max(1, Math.min(5, Number(res.jumlah_teman) || 5));
  const teksKriteria = (s) => escapeHtml(kriteria[String(s)] || kriteria[s] || '');
  // Default target: rotasi alfabetis (tanpa diri sendiri) agar seluruh teman mendapat penilai
  const urutTeman = [...teman].sort((a, b) => String(a.nama).localeCompare(String(b.nama), 'id'));
  const idxSaya = urutTeman.findIndex(t => String(t.nis) === String(nis));

  const baris = Array.from({ length: jumlah }, (_, j) => {
    const tersimpanNis = Object.keys(ratingSaya)[j] || '';
    const targetDefault = urutTeman.length ? urutTeman[(Math.max(idxSaya, 0) + 1 + j) % urutTeman.length] : null;
    const target = tersimpanNis || (targetDefault ? String(targetDefault.nis) : '');
    const skor = tersimpanNis ? ratingSaya[tersimpanNis] : '';
    const opts = ['<option value="">— pilih teman —</option>']
      .concat(urutTeman.map(t => `<option value="${escJs(t.nis)}" ${String(t.nis) === target ? 'selected' : ''}>${escapeHtml(t.nama)}</option>`))
      .join('');
    const skorOpts = ['<option value="">—</option>']
      .concat([4, 3, 2, 1].map(s => `<option value="${s}" ${String(skor) === String(s) ? 'selected' : ''}>${s}</option>`))
      .join('');
    return `
      <div class="flex items-center gap-2 mb-2">
        <span class="w-6 h-6 shrink-0 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold text-yellow-300">${j + 1}</span>
        <select id="murid_target_${j}" class="flex-1 bg-slate-700 border border-white/20 rounded px-2 py-1.5 text-[11px] text-white outline-none">${opts}</select>
        <select id="murid_skor_${j}" title="${teksKriteria(4)} / ${teksKriteria(3)} / ${teksKriteria(2)} / ${teksKriteria(1)}" class="w-16 bg-slate-700 border border-white/20 rounded px-2 py-1.5 text-[11px] text-white outline-none">${skorOpts}</select>
      </div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="text-center mb-3">
      <div class="text-sm font-bold text-yellow-300">"${escapeHtml(res.judul || 'Berilah nilai untuk 5 teman')}"</div>
      ${res.keterangan ? `<div class="text-[10px] text-slate-400 mt-1">${escapeHtml(res.keterangan)}</div>` : ''}
    </div>
    <div class="bg-black/30 border border-white/10 rounded p-2 mb-3 text-[9px] text-slate-300">
      <div class="font-bold text-green-300 mb-1">Kriteria Skor (1-4)</div>
      <div><b class="text-yellow-300">4</b> = ${teksKriteria(4)}</div>
      <div><b class="text-yellow-300">3</b> = ${teksKriteria(3)}</div>
      <div><b class="text-yellow-300">2</b> = ${teksKriteria(2)}</div>
      <div><b class="text-yellow-300">1</b> = ${teksKriteria(1)}</div>
    </div>
    ${baris}
    <button onclick="simpanTemanSejawatMurid()" class="w-full mt-2 px-3 py-2 rounded bg-green-600 hover:bg-green-700 text-white text-xs font-bold transition">
      <i class="fa-solid fa-paper-plane"></i> Kirim Penilaian
    </button>
  `;
}

/** Kirim rating murid via RPC (upsert idempoten; tahun/semester dipaksa dari sesi guru). */
async function simpanTemanSejawatMurid() {
  const user = currentUser.user || {};
  const nis = user["NIS"] || "";
  const mapel = document.getElementById('murid-sesi-mapel')?.value || '';
  const rows = [];
  for (let j = 0; j < 5; j++) {
    const tEl = document.getElementById(`murid_target_${j}`);
    const sEl = document.getElementById(`murid_skor_${j}`);
    if (!tEl || !sEl) continue;
    const target = tEl.value;
    const skor = sEl.value;
    if (target && skor) rows.push({ nis: target, skor: Number(skor) });
  }
  if (!rows.length) {
    return Swal.fire({ icon: 'warning', title: 'Belum ada rating', text: 'Pilih teman dan beri skor 1-4 terlebih dahulu.', background: '#1e293b', color: '#fff' });
  }
  const targetSet = new Set(rows.map(r => r.nis));
  if (targetSet.size !== rows.length) {
    return Swal.fire({ icon: 'warning', title: 'Teman ganda', text: 'Ada teman yang dinilai lebih dari sekali. Perbaiki pilihan Anda.', background: '#1e293b', color: '#fff' });
  }
  Swal.fire({ title: 'Mengirim Penilaian...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
  try {
    const { data, error } = await supaClient.rpc('simpan_penilaian_teman', { p_penilai_nis: nis, p_mapel: mapel, p_rows: rows });
    if (error) throw error;
    const r = data || {};
    if (r.status !== 'success') throw new Error(r.message || 'Gagal menyimpan.');
    if (r.gagal > 0) {
      Swal.fire({ icon: 'warning', title: `Tersimpan ${r.tersimpan}, gagal ${r.gagal}`, text: (r.detail_gagal || []).join(' '), background: '#1e293b', color: '#fff' });
    } else {
      Swal.fire({ icon: 'success', title: 'Penilaian Terkirim', text: `Terima kasih! ${r.tersimpan} penilaian tersimpan.`, background: '#1e293b', color: '#fff' });
    }
    muatFormTemanSejawatMurid();
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Gagal Mengirim', text: e.message || '', background: '#1e293b', color: '#fff' });
  }
}


function enableNamaSiswaResize() {
    // Beri jeda sejenak untuk memastikan DOM tabel selesai disuntikkan
    setTimeout(() => {
        const thElements = document.querySelectorAll('th.th-nama-siswa');
        
        thElements.forEach(th => {
            const resizer = th.querySelector('.col-resizer');
            if (!resizer) return;

            // Hapus duplikasi event agar tidak menumpuk saat tabel dirender ulang
            const newResizer = resizer.cloneNode(true);
            resizer.parentNode.replaceChild(newResizer, resizer);

            let startX, startWidth;

            newResizer.addEventListener('mousedown', function (e) {
                startX = e.clientX;
                startWidth = th.offsetWidth;
                
                function onMouseMove(e) {
                    let currentWidth = startWidth + (e.clientX - startX);
                    if (currentWidth < 50) currentWidth = 50;  // Batas minimum 50px
                    if (currentWidth > 400) currentWidth = 400; // Batas maksimum
                    
                    // Terapkan ukuran pada Header (th)
                    th.style.width = currentWidth + 'px';
                    th.style.minWidth = currentWidth + 'px';
                    th.style.maxWidth = currentWidth + 'px';
                    
                    // Terapkan ukuran secara sinkron pada seluruh isi baris (td) Nama Siswa di bawahnya
                    const table = th.closest('table');
                    if (table) {
                        const colIndex = Array.from(th.parentElement.children).indexOf(th);
                        table.querySelectorAll(`tbody tr`).forEach(row => {
                            const cell = row.children[colIndex];
                            if (cell) {
                                cell.style.width = currentWidth + 'px';
                                cell.style.minWidth = currentWidth + 'px';
                                cell.style.maxWidth = currentWidth + 'px';
                            }
                        });
                    }
                }

                function onMouseUp() {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    // Persist lebar kolom Nama tabel absensi
                    if (th.id === 'th-nama-absen') {
                        wNamaAbsen = th.offsetWidth;
                        localStorage.setItem('sisip_nama_width', String(wNamaAbsen));
                        refreshTableAbsenUI(); // hitung ulang offset sticky kolom setelahnya
                    }
                }

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
                e.preventDefault(); // Mencegah teks ter-highlight saat digeser
            });
        });
    }, 50);
}

// ==========================================
// MODUL EKSTRAKURIKULER (KURIKULUM MERDEKA)
// ==========================================

function getPredikatEskul(nilai) {
    if (nilai === "" || nilai === null || nilai === undefined) return "-";
    const s = String(nilai).trim();
    // [REQ A3] Nilai huruf A/B/C/D
    if (/^[ABCD]$/i.test(s)) {
        const m = { A: "Sangat Baik", B: "Baik", C: "Cukup", D: "Kurang" };
        return m[s.toUpperCase()];
    }
    // Kompatibilitas data angka lama (0-100)
    const n = Number(s);
    if (isNaN(n)) return "-";
    if (n >= 91) return "Sangat Baik";
    if (n >= 81) return "Baik";
    if (n >= 71) return "Cukup";
    return "Kurang";
}
/** Normalisasi nilai Eskul ke huruf A/B/C/D (untuk select): terima huruf, angka lama, atau teks predikat. */
function hurufDariNilaiEskul(nilai) {
    const s = String(nilai || '').trim();
    if (!s) return '';
    if (/^[ABCD]$/i.test(s)) return s.toUpperCase();
    const m = { "Sangat Baik": "A", "Baik": "B", "Cukup": "C", "Kurang": "D" };
    if (m[s]) return m[s];
    return m[getPredikatEskul(s)] || '';
}

function getWarnaPredikatEskul(prd) {
    if (prd === 'Sangat Baik') return 'text-green-400';
    if (prd === 'Baik') return 'text-blue-400';
    if (prd === 'Cukup') return 'text-yellow-400';
    if (prd === 'Kurang') return 'text-red-400';
    return 'text-slate-300';
}

function renderTabelEskul() {
    const displayNama = showNamaSiswaNilai ? 'table-cell' : 'none';
    const tabelEl = document.getElementById('tabel-nilai');

    if (listMuridKelas.length === 0) {
        tabelEl.innerHTML = `<tr><td class="p-6 text-center text-yellow-400"><i class="fa-solid fa-triangle-exclamation text-3xl mb-2"></i><br>Tidak ada siswa di kelas ini yang mendaftar Ekstrakurikuler terpilih.</td></tr>`;
        return;
    }

    const theadHTML = `
      <thead class="sticky top-0 z-40 shadow-lg">
        <tr class="bg-slate-800 text-slate-300 text-[10px] uppercase tracking-wider text-center border-b border-white/20">
          <th class="sticky left-0 bg-slate-800 z-50 px-2 py-2 border-r border-white/10 w-8 cursor-pointer hover:bg-slate-700 text-blue-400 shadow-md" onclick="toggleNamaSiswaNilai()">No</th>
          <th class="th-nama-siswa sticky left-[32px] bg-slate-800 z-40 px-3 py-2 border-r border-b border-white/10 text-left align-middle select-none relative" style="display:${displayNama}; width: 160px; min-width: 50px;">
            <div class="flex items-center justify-between gap-1 pr-1"><span class="truncate font-semibold">Nama Siswa</span><button onclick="event.stopPropagation(); siklusUrutNamaNilai()" class="shrink-0 w-5 h-5 rounded bg-slate-700/70 hover:bg-slate-600 flex items-center justify-center text-[9px]" title="Urutkan Nama (A-Z / Z-A)">${ikonUrutNamaNilai()}</button></div>
            <div class="col-resizer absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-500/50 transition-colors"></div>
          </th>
          <th class="px-2 py-2 border-r border-white/10 bg-slate-700/60 w-20">Kelas</th>
          <th class="px-2 py-2 border-r border-white/10 bg-indigo-900/40 w-20">Nilai<br>(A/B/C/D)</th>
          <th class="px-2 py-2 border-r border-white/10 bg-green-900/40 w-32">Predikat Akhir</th>
          <th class="px-2 py-2 border-r border-white/10 bg-purple-900/40">Deskripsi Ketercapaian <span class="text-[8px] text-slate-400 normal-case">(otomatis — Format di tombol Set)</span></th>
        </tr>
      </thead>
    `;

    const tbodyHTML = urutMuridTampil().map((m, idx) => {
      const dt = rawDataNilai.find(d => d.NIS == m.NIS) || {};
      let valNilai = dt.Nilai || '';
      let valPred = dt.Predikat || (valNilai !== '' ? getPredikatEskul(valNilai) : '-');
      let valDesc = dt.Deskripsi || '';
      if (valNilai !== '') {
        const fmt = (configNilaiAktif && configNilaiAktif.format_deskripsi) || {};
        const tpl = fmt[getPredikatEskul(valNilai)] || '';
        if (tpl) valDesc = tpl;
      }
      const valHuruf = hurufDariNilaiEskul(valNilai);
      const optHuruf = ['<option value=""></option>']
        .concat(['A', 'B', 'C', 'D'].map(h => {
          const prd = getPredikatEskul(h);
          return `<option value="${h}" ${h === valHuruf ? 'selected' : ''} title="${escapeHtml(prd)}">${h}</option>`;
        })).join('');

      return `
        <tr class="hover:bg-white/5 transition text-xs" data-nis="${m.NIS}">
          <td class="sticky left-0 bg-[#0f172a] z-30 text-center border-b border-r border-white/10 px-2 cursor-pointer text-blue-400 font-bold group-hover:bg-slate-800" onclick="toggleNamaSiswaNilai()">${idx + 1}</td>
          <td class="sticky left-[32px] bg-[#0f172a] z-30 border-b border-r border-white/10 px-2 truncate text-left group-hover:bg-slate-800" style="display:${displayNama};">${m["Nama Lengkap"]}</td>
          <td class="border-b border-r border-white/10 px-2 text-center text-[10px] text-indigo-300">${escapeHtml(m["Tingkat/Kelas"] || '-')}</td>

          <td class="border-b border-r border-white/5 p-0 bg-indigo-900/10">
              <select onfocus="storeOldVal(this)" onblur="kalkulasiEskul('${m.NIS}')" id="N_${m.NIS}_Nilai" title="Pilih Nilai: A/B/C/D" class="w-full h-10 bg-transparent text-center text-[13px] font-bold text-white outline-none focus:bg-indigo-600/30">${optHuruf}</select>
          </td>
          <td class="border-b border-r border-white/5 p-0 bg-green-900/10 text-center text-[11px] font-extrabold ${getWarnaPredikatEskul(valPred)}" id="PRD_${m.NIS}_Eskul">${valPred}</td>
          <td class="border-b border-r border-white/5 p-0 bg-purple-900/10 text-left px-3 text-[11px] text-white align-middle" id="DESC_${m.NIS}_Eskul" title="Otomatis sesuai Predikat Akhir — teks diatur lewat tombol Set">${escapeHtml(valDesc)}</td>
        </tr>
      `;
    }).join('');

    tabelEl.innerHTML = `${theadHTML}<tbody>${tbodyHTML}</tbody><tfoot><tr class="bg-slate-800 text-[10px] text-slate-400 border-t border-white/20"><td colspan="100%" class="py-2 px-3 text-center"><b>PREDIKAT (KURIKULUM MERDEKA):</b> &nbsp; <span class="text-green-400 font-bold">A — Sangat Baik</span> <span class="mx-1">|</span> <span class="text-blue-400 font-bold">B — Baik</span> <span class="mx-1">|</span> <span class="text-yellow-400 font-bold">C — Cukup</span> <span class="mx-1">|</span> <span class="text-red-400 font-bold">D — Kurang</span><br><i>Deskripsi Ketercapaian terisi otomatis sesuai Predikat Akhir dari "Format Deskripsi Ketercapaian" (tombol Set) dan hanya dapat diatur melalui tombol Set.</i></td></tr></tfoot>`;
    enableNamaSiswaResize();
}

function kalkulasiEskul(nis, isFromUndo = false) {
    let updates = {};
    const nilEl = document.getElementById(`N_${nis}_Nilai`);
    let vNilai = nilEl ? nilEl.value : "";
    let prd = vNilai !== "" ? getPredikatEskul(vNilai) : "-";

    let prdEl = document.getElementById(`PRD_${nis}_Eskul`);
    if(prdEl) {
        prdEl.innerText = prd;
        prdEl.className = `border-b border-r border-white/5 p-0 bg-green-900/10 text-center text-[11px] font-extrabold ${getWarnaPredikatEskul(prd)}`;
    }

    const descEl = document.getElementById(`DESC_${nis}_Eskul`);
    let desc = descEl ? descEl.innerText : "";

    // [REQ A4] Deskripsi Ketercapaian terkunci (seperti Predikat Akhir): terisi otomatis dari
    // Format Deskripsi Ketercapaian (tombol Set) sesuai predikat; template kosong → deskripsi lama dipertahankan.
    if (descEl && prd !== "-") {
        const fmt = (configNilaiAktif && configNilaiAktif.format_deskripsi) || {};
        const tplBaru = fmt[prd] || '';
        if (tplBaru) {
            desc = tplBaru;
            descEl.innerText = tplBaru;
        }
    }

    updates["Nilai"] = vNilai;
    updates["Predikat"] = prd;
    updates["Deskripsi"] = desc;

    if(!isFromUndo) silentSaveNilai(nis, updates);
}

/** Ambil template deskripsi ketercapaian ekskul lama dari localStorage (untuk migrasi ke server). */
function templateDeskripsiEskul() {
  try { return JSON.parse(localStorage.getItem('sisip_tpl_desk_ekskul') || 'null'); } catch (e) { return null; }
}

// [REQ A2] Tombol "Set" per-baris & fungsi setDeskripsiEskul DIHAPUS —
// Format Deskripsi Ketercapaian kini satu dialog di openPengaturanKolomNilai() → openFormatDeskripsiEkskul().

// ==========================================
// 7. MANAJEMEN AKUN MURID & GURU (CRUD)
// ==========================================

let cacheAkunData = [];

// ============ AKUN MURID ============
// ==========================================
// MANAJEMEN AKUN MURID (FRONTEND)
// ==========================================

let cacheAkunMurid = [];
// Perbaikan: Hapus kata 'let'
masterDataCache = masterDataCache || [];

async function renderManajemenMurid(container) {
    container.innerHTML = `<div class="p-6 text-center text-slate-300"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>Memuat Data Akun Murid...</div>`;
    
    try {
        // 1. Ambil Data Master jika belum ada (Untuk Dropdown)
        if (masterDataCache.length === 0) {
    try {
        const { data, error } = await supaClient.from('master_data').select('*');
        if (!error && data) masterDataCache = data;
    } catch (e) {
        console.error("Gagal memuat master data", e);
    }
}

        // 2. Ambil Data Murid → simpan ke cache khusus murid (JANGAN menimpa masterDataCache)
        const { data: muridRows, error } = await supaClient
          .from('akun')
          .select('*')
          .eq('tipe', 'murid');
        if (error) {
          console.error("Gagal memuat akun", error);
        } else {
          cacheAkunMurid = muridRows || [];
        }

        // 3. Ekstrak Data Unik dari Master Data (format lama & baru)
        const listTahun = [...new Set(masterDataCache.map(m => mdVal(m, "Tahun Pelajaran", "tahun_pelajaran")).filter(Boolean))];
        const listEkskul = urutAz(denganSto([...new Set(masterDataCache.map(m => mdVal(m, "Ekstrakurikuler", "ekstrakurikuler")).filter(Boolean))]));
        
        const tahunOptions = listTahun.map(t => `<option value="${t}">${t}</option>`).join('');
        const ekskulOptions = listEkskul.map(e => `<option value="${e}">${e}</option>`).join('');

        container.innerHTML = `
            <div class="glass-card rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex flex-col h-[85vh]">
                <div class="bg-slate-800/80 p-4 border-b border-white/10 flex flex-col sm:flex-row justify-between items-center gap-3">
                    <h2 class="text-sm sm:text-base font-bold text-white uppercase tracking-wider"><i class="fa-solid fa-user-graduate text-blue-400 mr-2"></i> Manajemen Akun Murid</h2>
                    
                    <div class="flex gap-2 w-full sm:w-auto flex-wrap justify-end items-center">
                        <!-- FITUR BARU: Dropdown Filter Tahun & Ekskul -->
                        <select id="filter-tahun-murid" class="w-full sm:w-32 bg-slate-700 border border-white/20 rounded-lg px-2 py-2 text-[11px] text-white outline-none focus:border-blue-500 cursor-pointer" onchange="filterTabelMurid()">
                            <option value="ALL">Semua Tahun</option>
                            ${tahunOptions}
                        </select>

                        <select id="filter-ekskul-murid" class="w-full sm:w-36 bg-slate-700 border border-white/20 rounded-lg px-2 py-2 text-[11px] text-white outline-none focus:border-blue-500 cursor-pointer" onchange="filterTabelMurid()">
                            <option value="ALL">Semua Ekskul</option>
                            ${ekskulOptions}
                        </select>
                        
                        <input type="text" id="search-murid" placeholder="Cari NIS / Nama..." class="w-full sm:w-40 bg-black/40 border border-white/20 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-blue-500" onkeyup="filterTabelMurid()">
                        <button onclick="exportExcelMurid()" class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition shadow-md whitespace-nowrap"><i class="fa-solid fa-file-excel"></i> Excel</button>
                        <button onclick="exportPdfMurid()" class="bg-rose-600 hover:bg-rose-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition shadow-md whitespace-nowrap"><i class="fa-solid fa-file-pdf"></i> PDF</button>
                        <button onclick="openExportQRMurid()" class="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition shadow-md whitespace-nowrap"><i class="fa-solid fa-qrcode"></i> Export QR</button>
<button onclick="openImportMurid()" class="bg-teal-600 hover:bg-teal-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition shadow-md whitespace-nowrap"><i class="fa-solid fa-file-import"></i> Import</button>
<button onclick="openFormAkunMurid(true)" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition shadow-md whitespace-nowrap"><i class="fa-solid fa-plus"></i> Tambah Murid</button>
                    </div>
                </div>
                <div class="flex-1 overflow-auto custom-scrollbar bg-[#0f172a]">
                    <table class="w-full text-left whitespace-nowrap">
                        <thead class="sticky top-0 bg-slate-900 z-10 text-[10px] uppercase text-slate-400 shadow-md">
                            <tr>
                                <th class="px-4 py-3 border-b border-white/10 text-center">No</th>
                                <th class="px-4 py-3 border-b border-white/10">NIS</th>
                                <th class="px-4 py-3 border-b border-white/10">NISN</th>
                                <th class="px-4 py-3 border-b border-white/10">Nama Lengkap</th>
                                <th class="px-4 py-3 border-b border-white/10 text-center">Kelas</th>
                                <th class="px-4 py-3 border-b border-white/10">Email Login</th>
                                <th class="px-4 py-3 border-b border-white/10 text-center">Aksi</th>
                            </tr>
                        </thead>
                        <tbody id="tbody-murid" class="text-xs text-slate-200">
                            ${generateTbodyMurid(cacheAkunMurid)}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    } catch(e) {
        console.error("Error renderManajemenMurid:", e);
        container.innerHTML = `<div class="p-6 text-center text-red-400">Gagal memuat data akun murid. Periksa koneksi jaringan.</div>`;
    }
}

/** Pastikan opsi "STO-Siswa Tanpa Organisasi" tersedia di daftar ekskul. */
function denganSto(list) {
  const l = [...(list || [])];
  if (!l.includes('STO-Siswa Tanpa Organisasi')) l.push('STO-Siswa Tanpa Organisasi');
  return l;
}

/** Export data murid (mengikuti filter tabel aktif) ke file Excel. */
async function exportExcelMurid() {
  if (typeof XLSX === 'undefined') return showToast('error', 'Library SheetJS tidak ditemukan.');
  const petaWali = await petaWaliKelas();
  const rows = (cacheAkunMurid || []).map((d, i) => ({
    "No": i + 1,
    "ID Tahun Pelajaran": d.tahun_pelajaran || "",
    "Semester": d.semester || "",
    "ID Akun": d.nis_nip || "",
    "NIS": d.nis_nip || "",
    "NISN": d.nisn || "",
    "Nama Lengkap": d.nama_lengkap || "",
    "Tingkat/Kelas": d.tingkat_kelas || "",
    "Wali Kelas": petaWali[d.tingkat_kelas] || "",
    "Jenis Kelamin": d.jenis_kelamin || "",
    "Tgl Lahir": d.tgl_lahir ? String(d.tgl_lahir).split('T')[0] : "",
    "Agama": d.agama || "",
    "Golongan Darah": d.golongan_darah || "",
    "Ekstrakurikuler": d.ekstrakurikuler || "",
    "Jabatan Kelas": d.jabatan || "",
    "Nama Orang tua Ayah": d.nama_ayah || "",
    "Pekerjaan Ayah": d.pekerjaan_ayah || "",
    "Nama Orang tua Ibu": d.nama_ibu || "",
    "Pekerjaan Ibu": d.pekerjaan_ibu || "",
    "Nama Wali": d.nama_wali || "",
    "Alamat": d.alamat || "",
    "No HP/WA": d.no_telepon || "",
    "Email": d.email || "",
    "Catatan Khusus": d.catatan_khusus || ""
  }));
  if (rows.length === 0) return showToast('error', 'Tidak ada data murid untuk diexport.');
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data_Akun_Murid");
  XLSX.writeFile(wb, `Data_Akun_Murid_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast('success', 'Excel murid diunduh');
}

/** Export data murid ke PDF (A4 landscape, semua kolom utama) via jendela cetak. */
async function exportPdfMurid() {
  const rows = cacheAkunMurid || [];
  if (rows.length === 0) return showToast('error', 'Tidak ada data murid untuk diexport.');
  const petaWali = await petaWaliKelas();
  const printWindow = window.open('', '_blank');
  if (!printWindow) return Swal.fire({ icon: 'error', title: 'Popup Diblokir', text: 'Izinkan popup untuk mencetak PDF.', background: '#1e293b', color: '#fff' });

  const th = ["No","NIS","NISN","Nama Lengkap","Kelas","Wali Kelas","JK","Tgl Lahir","Agama","Goldar","Ekskul","Jabatan","Ayah","Pk. Ayah","Ibu","Pk. Ibu","Wali Murid","Alamat","No HP/WA","Email","Catatan"];
  const esc = (v) => escapeHtml(v ?? '');
  const bodyRows = rows.map((d, i) => `<tr>
    <td>${i+1}</td>
    <td>${esc(d.nis_nip)}</td><td>${esc(d.nisn)}</td><td>${esc(d.nama_lengkap)}</td><td>${esc(d.tingkat_kelas)}</td>
    <td>${esc(petaWali[d.tingkat_kelas] || '')}</td>
    <td>${esc((d.jenis_kelamin || '').charAt(0).toUpperCase())}</td><td>${esc(d.tgl_lahir ? String(d.tgl_lahir).split('T')[0] : '')}</td>
    <td>${esc(d.agama)}</td><td>${esc(d.golongan_darah)}</td><td>${esc(d.ekstrakurikuler)}</td><td>${esc(d.jabatan)}</td>
    <td>${esc(d.nama_ayah)}</td><td>${esc(d.pekerjaan_ayah)}</td><td>${esc(d.nama_ibu)}</td><td>${esc(d.pekerjaan_ibu)}</td>
    <td>${esc(d.nama_wali)}</td><td>${esc(d.alamat)}</td><td>${esc(d.no_telepon)}</td><td>${esc(d.email)}</td><td>${esc(d.catatan_khusus)}</td>
  </tr>`).join('');

  printWindow.document.write(`
    <html><head><title>Data Akun Murid</title>
    <style>
      @page { size: A4 landscape; margin: 8mm; }
      body { font-family: Arial, sans-serif; font-size: 8px; color: #000; background: #fff; }
      h3 { text-align: center; margin: 0 0 2px; font-size: 14px; }
      p.sub { text-align: center; margin: 0 0 8px; font-size: 10px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #444; padding: 2px 3px; vertical-align: top; }
      thead th { background: #e5e7eb; font-size: 7.5px; text-transform: uppercase; }
    </style></head><body>
    <h3>DATA AKUN MURID</h3>
    <p class="sub">Dicetak: ${new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })} &mdash; Total: ${rows.length} murid</p>
    <table><thead><tr>${th.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${bodyRows}</tbody></table>
    <script>setTimeout(() => { window.print(); }, 400);<\/script>
    </body></html>
  `);
  printWindow.document.close();
}

function generateTbodyMurid(data) {
    if (!data || data.length === 0) return `<tr><td colspan="7" class="p-6 text-center text-slate-500">Belum ada data murid yang tersimpan.</td></tr>`;

    return data.map((d, i) => {
        let nis = d.nis_nip || d.NIS || d.nis || "-";
        let nisn = d.nisn || d.NISN || "-";
        let nama = d.nama_lengkap || d["Nama Lengkap"] || d.Nama || d.nama || "Tanpa Nama";
        let kelas = d.tingkat_kelas || d["Tingkat/Kelas"] || d.Kelas || "-";
        let jabatan = d.jabatan || d["Jabatan Kelas"] || "";
        let email = d.email || d.Email || "-";
        let ekskulData = (d.ekstrakurikuler || d.Ekstrakurikuler || d.ekskul || "").replace(/"/g, '&quot;');
        let tahunData = d.tahun_pelajaran || d["ID Tahun Pelajaran"] || "";

        return `
            <tr class="hover:bg-white/5 border-b border-white/5 transition row-murid" data-ekskul="${ekskulData}" data-tahun="${escapeHtml(tahunData)}">
                <td class="px-4 py-3 text-center">${i+1}</td>
                <td class="px-4 py-3 font-mono text-blue-300 search-target">${nis}</td>
                <td class="px-4 py-3 font-mono text-slate-300 search-target">${nisn}</td>
                <td class="px-4 py-3 font-bold search-target">${nama}${jabatan ? `<span class="ml-1 text-[9px] bg-blue-900/50 text-blue-300 px-1.5 py-0.5 rounded">${escapeHtml(jabatan)}</span>` : ''}</td>
                <td class="px-4 py-3 text-center search-target">
                    <span class="bg-indigo-900/50 text-indigo-300 px-2 py-1 rounded text-[10px]">${kelas}</span>
                </td>
                <td class="px-4 py-3"><div class="text-[10px] text-slate-400"><i class="fa-solid fa-envelope"></i> ${email}</div></td>
                <td class="px-4 py-3 text-center whitespace-nowrap">
                    <button onclick='openFormAkunMurid(false, ${JSON.stringify(d).replace(/'/g, "&#39;")})' class="w-7 h-7 bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white rounded transition mr-1" title="Edit"><i class="fa-solid fa-pen"></i></button>
                    <button onclick="resetPasswordMurid('${escJs(nis)}', '${escJs(nama)}')" class="w-7 h-7 bg-amber-600/20 hover:bg-amber-600 text-amber-400 hover:text-white rounded transition mr-1" title="Reset Password"><i class="fa-solid fa-key"></i></button>
                    <button onclick="deleteAkunMurid('${escJs(nis)}')" class="w-7 h-7 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded transition" title="Hapus"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    }).join('');
}

function filterTabelMurid() {
    const query = document.getElementById('search-murid').value.toLowerCase();
    const filterEks = document.getElementById('filter-ekskul-murid').value.toLowerCase();
    const filterTahun = document.getElementById('filter-tahun-murid').value;
    const rows = document.querySelectorAll('.row-murid');
    
    rows.forEach(row => {
        const text = row.innerText.toLowerCase();
        const ekskulRow = (row.getAttribute('data-ekskul') || "").toLowerCase();
        const tahunRow = row.getAttribute('data-tahun') || "";
        
        let matchText = text.includes(query);
        let matchEkskul = (filterEks === 'all') || ekskulRow.includes(filterEks);
        let matchTahun = (filterTahun === 'ALL') || (tahunRow === filterTahun);
        
        row.style.display = (matchText && matchEkskul && matchTahun) ? '' : 'none';
    });
}

function openFormAkunMurid(isNew, data = {}) {
    // Ambil pilihan dari Master Data (nama kolom = nama persis gaya Sheets)
    const listKelas = urutAz([...new Set(masterDataCache.map(m => m["Tingkat/Kelas"]).filter(Boolean))]);
    const listEkskul = urutAz(denganSto([...new Set(masterDataCache.map(m => m["Ekstrakurikuler"]).filter(Boolean))]));
    const listJabatan = urutAz([...new Set(masterDataCache.map(m => m["Jabatan Kelas"]).filter(Boolean))]);
    const listTahun = [...new Set(masterDataCache.map(m => m["Tahun Pelajaran"]).filter(Boolean))];
    const listAgama = urutAz([...new Set(masterDataCache.map(m => m["Agama"]).filter(Boolean))]);
    // Opsi standar ekskul: STO (bila belum ada di Master Data)
    if (!listEkskul.includes('STO-Siswa Tanpa Organisasi')) listEkskul.push('STO-Siswa Tanpa Organisasi');

    // Nilai existing (snake_case dulu, fallback gaya Sheets)
    const nisV = data.nis_nip || data.NIS || data.nis || "";
    const namaV = data.nama_lengkap || data["Nama Lengkap"] || data.nama || "";
    const nisnV = data.nisn || data.NISN || "";
    const tahunV = data.tahun_pelajaran || data["ID Tahun Pelajaran"] || "";
    const semesterV = data.semester || data["Semester"] || "";
    const kelasV = data.tingkat_kelas || data["Tingkat/Kelas"] || "";
    const jkV = data.jenis_kelamin || data["Jenis Kelamin"] || "";
    const lahirV = data.tgl_lahir ? String(data.tgl_lahir).split('T')[0] : "";
    const agamaV = data.agama || data["Agama"] || "";
    const goldarV = data.golongan_darah || data["Golongan Darah"] || "";
    const jabatanV = data.jabatan || data["Jabatan Kelas"] || "";
    const emailV = data.email || data.Email || "";
    const waV = data.no_telepon || data["No HP/WA"] || "";
    const ekskulV = data.ekstrakurikuler || data.Ekstrakurikuler || "";
    const ayahV = data.nama_ayah || data["Nama Orang tua Ayah"] || "";
    const pkAyahV = data.pekerjaan_ayah || data["Pekerjaan Ayah"] || "";
    const ibuV = data.nama_ibu || data["Nama Orang tua Ibu"] || "";
    const pkIbuV = data.pekerjaan_ibu || data["Pekerjaan Ibu"] || "";
    const waliV = data.nama_wali || data["Nama Wali"] || "";
    const alamatV = data.alamat || data["Alamat"] || "";
    const catatanV = data.catatan_khusus || data["Catatan Khusus"] || "";

    const optKelas = listKelas.map(k => `<option value="${escJs(k)}" ${kelasV === k ? 'selected' : ''}>${k}</option>`).join('');
    const optJabatan = listJabatan.map(j => `<option value="${escJs(j)}" ${jabatanV === j ? 'selected' : ''}>${j}</option>`).join('');
    const optTahun = listTahun.map(t => `<option value="${escJs(t)}" ${tahunV === t ? 'selected' : ''}>${t}</option>`).join('');

    const ekskulArr = ekskulV.split(',').map(e => e.trim()).filter(Boolean);
    const chkEkskulHTML = listEkskul.map(e => `
        <label class="flex items-center gap-1.5 cursor-pointer hover:text-white bg-slate-800 p-1.5 rounded border border-white/10">
            <input type="checkbox" class="chk-ekskul-form" value="${escJs(e)}" ${ekskulArr.includes(e) ? 'checked' : ''}>
            <span class="truncate">${e}</span>
        </label>
    `).join('');

    const formHTML = `
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left text-[11px] text-slate-300 mt-2 max-h-[65vh] overflow-y-auto custom-scrollbar p-1 pr-2">
            <div><label class="font-bold text-blue-300">ID Akun</label><input id="f_idakun" value="${escJs(nisV)}" readonly class="w-full bg-black/60 border border-white/10 rounded px-2 py-1.5 mt-1 text-slate-400 outline-none opacity-70"></div>
            <div><label class="font-bold text-blue-300">NIS *</label><input id="f_nis" value="${escJs(nisV)}" ${!isNew?'readonly':''} class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500 disabled:opacity-50"></div>
            <div><label class="font-bold text-blue-300">NISN</label><input id="f_nisn" value="${escJs(nisnV)}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            <div><label class="font-bold text-blue-300">No HP/WA</label><input id="f_wa" value="${escJs(waV)}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>

            <div class="sm:col-span-2"><label class="font-bold text-blue-300">Nama Lengkap *</label><input id="f_nama" value="${escJs(namaV)}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>

            <div><label class="font-bold text-blue-300">ID Tahun Pelajaran</label>
                <select id="f_tahun" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none"><option value="">-- Pilih --</option>${optTahun}</select>
            </div>
            <div><label class="font-bold text-blue-300">Semester</label>
                <select id="f_semester" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none">
                    <option value="">-- Pilih --</option>
                    <option value="Ganjil" ${semesterV==='Ganjil'?'selected':''}>Ganjil</option>
                    <option value="Genap" ${semesterV==='Genap'?'selected':''}>Genap</option>
                </select>
            </div>

            <div><label class="font-bold text-blue-300">Tingkat/Kelas</label>
                <select id="f_kelas" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none"><option value="">-- Pilih --</option>${optKelas}</select>
            </div>
            <div><label class="font-bold text-blue-300">Jenis Kelamin</label>
                <select id="f_jk" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none">
                    <option value="">-- Pilih --</option>
                    <option value="Laki-laki" ${jkV==='Laki-laki'?'selected':''}>Laki-laki</option>
                    <option value="Perempuan" ${jkV==='Perempuan'?'selected':''}>Perempuan</option>
                </select>
            </div>

            <div><label class="font-bold text-blue-300">Tgl Lahir</label><input id="f_lahir" type="date" value="${escJs(lahirV)}" style="color-scheme: dark;" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            <div><label class="font-bold text-blue-300">Golongan Darah</label>
                <select id="f_goldar" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none">
                    <option value="">-- Pilih --</option>
                    ${['A','B','AB','O'].map(g => `<option value="${g}" ${goldarV===g?'selected':''}>${g}</option>`).join('')}
                </select>
            </div>

            <div><label class="font-bold text-blue-300">Agama</label>
                <select id="f_agama" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none"><option value="">-- Pilih --</option>${listAgama.map(a => `<option value="${escJs(a)}" ${agamaV === a ? 'selected' : ''}>${a}</option>`).join('')}</select>
            </div>
            <div><label class="font-bold text-blue-300">Jabatan Kelas</label>
                <select id="f_jabatan" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none"><option value="">-- Tidak Ada --</option>${optJabatan}</select>
            </div>

            <div><label class="font-bold text-blue-300">Nama Orang tua Ayah</label><input id="f_ayah" value="${escJs(ayahV)}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            <div><label class="font-bold text-blue-300">Pekerjaan Ayah</label><input id="f_pk_ayah" value="${escJs(pkAyahV)}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            <div><label class="font-bold text-blue-300">Nama Orang tua Ibu</label><input id="f_ibu" value="${escJs(ibuV)}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            <div><label class="font-bold text-blue-300">Pekerjaan Ibu</label><input id="f_pk_ibu" value="${escJs(pkIbuV)}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            <div><label class="font-bold text-blue-300">Nama Wali</label><input id="f_wali" value="${escJs(waliV)}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            <div><label class="font-bold text-blue-300">Email Login (opsional)</label><input id="f_email" type="email" value="${escJs(emailV)}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>

            <div class="sm:col-span-2"><label class="font-bold text-blue-300">Alamat</label><input id="f_alamat" value="${escJs(alamatV)}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            <div class="sm:col-span-2"><label class="font-bold text-blue-300">Catatan Khusus</label><input id="f_catatan" value="${escJs(catatanV)}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>

            <div><label class="font-bold text-blue-300">Password ${isNew ? '*' : '(kosong = tidak diubah)'}</label><input id="f_pass" type="text" value="${isNew ? '123456' : ''}" placeholder="${isNew ? '' : 'biarkan kosong'}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"><p class="text-[9px] text-slate-400 mt-1">Disimpan sebagai hash (password lokal, tanpa Google). Minimal 6 karakter.</p></div>

            <div class="sm:col-span-2">
                <label class="font-bold text-blue-300 mb-1 block">Ekstrakurikuler (Bisa pilih lebih dari satu)</label>
                <div class="grid grid-cols-2 gap-2 bg-black/20 p-2 rounded border border-white/10 max-h-32 overflow-y-auto">
                    ${chkEkskulHTML}
                </div>
            </div>
        </div>
    `;

    Swal.fire({
        title: `<div class="text-lg font-bold">${isNew ? 'Tambah' : 'Edit'} Akun Murid</div>`,
        html: formHTML, width: 600, background: '#1e293b', color: '#fff',
        showCancelButton: true, confirmButtonText: '<i class="fa-solid fa-save"></i> Simpan Data',
        preConfirm: () => {
            const nisVal = document.getElementById('f_nis').value.trim();
            const namaVal = document.getElementById('f_nama').value.trim();
            if (!nisVal || !namaVal) { Swal.showValidationMessage('NIS dan Nama Lengkap wajib diisi!'); return false; }
            const passVal = document.getElementById('f_pass').value.trim();
            if (passVal && passVal.length < 6) { Swal.showValidationMessage('Password minimal 6 karakter!'); return false; }
            if (isNew && !passVal) { Swal.showValidationMessage('Password wajib untuk murid baru!'); return false; }

            const ekskulChecked = [];
            document.querySelectorAll('.chk-ekskul-form:checked').forEach(el => ekskulChecked.push(el.value));

            return {
                nis: nisVal,
                nama_lengkap: namaVal,
                nisn: document.getElementById('f_nisn').value.trim(),
                tahun_pelajaran: document.getElementById('f_tahun').value,
                semester: document.getElementById('f_semester').value,
                tingkat_kelas: document.getElementById('f_kelas').value,
                jenis_kelamin: document.getElementById('f_jk').value,
                tgl_lahir: document.getElementById('f_lahir').value,
                agama: document.getElementById('f_agama').value,
                golongan_darah: document.getElementById('f_goldar').value,
                jabatan: document.getElementById('f_jabatan').value,
                email: document.getElementById('f_email').value.trim(),
                no_telepon: document.getElementById('f_wa').value.trim(),
                ekstrakurikuler: ekskulChecked.join(', '),
                nama_ayah: document.getElementById('f_ayah').value.trim(),
                pekerjaan_ayah: document.getElementById('f_pk_ayah').value.trim(),
                nama_ibu: document.getElementById('f_ibu').value.trim(),
                pekerjaan_ibu: document.getElementById('f_pk_ibu').value.trim(),
                nama_wali: document.getElementById('f_wali').value.trim(),
                alamat: document.getElementById('f_alamat').value.trim(),
                catatan_khusus: document.getElementById('f_catatan').value.trim(),
                password: passVal
            };
        }
    }).then(async (res) => {
        if (!res.isConfirmed) return;
        await simpanAkunMurid(res.value, isNew);
    });
}

/** Simpan tambah/edit murid via RPC (hash password ditangani server). */
async function simpanAkunMurid(formData, isNew) {
  Swal.fire({ title: 'Menyimpan Data...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });

  const p_data = { ...formData };
  if (!isNew && !p_data.password) delete p_data.password; // kosong = tidak diubah

  const { data, error } = await supaClient.rpc('buat_akun_murid', { p_data });

  if (error || !data || data.status !== 'success') {
    const pesan = (data && data.message) || (error && error.message) || 'Gagal menyimpan.';
    console.error("Error simpan akun murid:", error || data);
    Swal.fire({ icon: 'error', title: 'Gagal', text: pesan, background: '#1e293b', color: '#fff' });
    return;
  }
  Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: data.message || 'Data murid tersimpan!', showConfirmButton: false, timer: 2000, background: '#1e293b', color: '#fff' });
  if (typeof renderManajemenMurid === 'function') {
    renderManajemenMurid(document.getElementById('main-content'));
  }
}

/** Reset password murid (default 123456) via RPC — hash ditangani server. */
function resetPasswordMurid(nis, nama) {
    Swal.fire({
        title: 'Reset Password',
        html: `Password baru untuk <b>${nama}</b>:`,
        input: 'text',
        inputValue: '123456',
        showCancelButton: true,
        confirmButtonText: '<i class="fa-solid fa-key"></i> Reset',
        background: '#1e293b', color: '#fff',
        inputValidator: (v) => (!v || v.trim().length < 6) ? 'Password minimal 6 karakter!' : null
    }).then(async (res) => {
        if (!res.isConfirmed) return;
        Swal.fire({ title: 'Menyimpan...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
        const { data, error } = await supaClient.rpc('set_password_murid', { p_nis: nis, p_password: res.value.trim() });
        if (!error && data && data.status === 'success') {
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: data.message, showConfirmButton: false, timer: 2000, background: '#1e293b', color: '#fff' });
        } else {
            Swal.fire({ icon: 'error', title: 'Gagal', text: (data && data.message) || (error && error.message) || 'Gagal reset.', background: '#1e293b', color: '#fff' });
        }
    });
}

// ==========================================
// LOGIKA FILTER & CETAK QR CODE MURID
// ==========================================
function openExportQRMurid() {
    // Ambil data unik dari cache untuk opsi dropdown (skema tabel akun: snake_case)
    const listTahun = [...new Set(cacheAkunMurid.map(m => m.tahun_pelajaran || m["ID Tahun Pelajaran"]).filter(Boolean))];
    const listKelas = urutAz([...new Set(cacheAkunMurid.map(m => m.tingkat_kelas || m["Tingkat/Kelas"]).filter(Boolean))]);
    const listSiswa = cacheAkunMurid.slice()
      .sort((a, b) => String(a.nama_lengkap || a["Nama Lengkap"] || '').localeCompare(String(b.nama_lengkap || b["Nama Lengkap"] || ''), 'id', { sensitivity: 'base' }))
      .map(m => {
        const nis = m.nis_nip || m.NIS;
        const nama = m.nama_lengkap || m["Nama Lengkap"] || '';
        return `<option value="${escJs(nis)}">${escJs(nis)} - ${escJs(nama)}</option>`;
      }).join('');
    
    // Pecah ekstrakurikuler jika pakai koma
    let rawEkskul = [];
    cacheAkunMurid.forEach(m => { if(m.ekstrakurikuler || m.Ekstrakurikuler) rawEkskul = rawEkskul.concat((m.ekstrakurikuler || m.Ekstrakurikuler).split(',').map(e => e.trim())); });
    const listEkskul = urutAz(denganSto([...new Set(rawEkskul)].filter(Boolean)));

    let formHTML = `
        <div class="text-left text-xs text-slate-300">
            <label class="block font-bold text-indigo-300 mb-1">Target Data QR (Isi QR Code)</label>
            <select id="qr_target" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mb-3 outline-none text-white">
                <option value="NIS">NIS Siswa</option>
                <option value="NISN">NISN Siswa</option>
            </select>

            <label class="block font-bold text-indigo-300 mb-1 mt-2">Filter Tahun Pelajaran</label>
            <select id="qr_tahun" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mb-3 outline-none text-white"><option value="ALL">Semua Tahun</option>${listTahun.map(t => `<option value="${t}">${t}</option>`).join('')}</select>

            <label class="block font-bold text-indigo-300 mb-1">Filter Kelas</label>
            <select id="qr_kelas" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mb-3 outline-none text-white"><option value="ALL">Semua Kelas</option>${listKelas.map(k => `<option value="${k}">${k}</option>`).join('')}</select>

            <label class="block font-bold text-indigo-300 mb-1">Filter Ekstrakurikuler</label>
            <select id="qr_ekskul" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mb-3 outline-none text-white"><option value="ALL">Semua Ekstrakurikuler</option>${listEkskul.map(e => `<option value="${e}">${e}</option>`).join('')}</select>
            
            <label class="block font-bold text-indigo-300 mb-1">Pilih Spesifik 1 Siswa (Opsional)</label>
            <select id="qr_siswa" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mb-3 outline-none text-white"><option value="ALL">Cetak Semua Siswa Berdasarkan Filter Di Atas</option>${listSiswa}</select>
            
            <label class="block font-bold text-yellow-300 mb-1 mt-2">Label Tambahan (Misal: Mata Pelajaran)</label>
            <input type="text" id="qr_label_mapel" placeholder="Kosongkan jika tidak perlu..." class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mb-2 text-white outline-none focus:border-indigo-500">
        </div>
    `;

    Swal.fire({
        title: '<i class="fa-solid fa-qrcode text-indigo-400"></i> Export QR Code',
        html: formHTML, background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonText: '<i class="fa-solid fa-print"></i> Generate & Cetak'
    }).then((res) => {
        if (res.isConfirmed) {
            const config = {
                target: document.getElementById('qr_target').value,
                tahun: document.getElementById('qr_tahun').value,
                kelas: document.getElementById('qr_kelas').value,
                ekskul: document.getElementById('qr_ekskul').value,
                siswa: document.getElementById('qr_siswa').value,
                label_mapel: document.getElementById('qr_label_mapel').value
            };
            cetakQRMuridTerfilter(config);
        }
    });
}

function cetakQRMuridTerfilter(config) {
    let filtered = cacheAkunMurid;
    if (config.siswa !== 'ALL') {
        filtered = filtered.filter(m => (m.nis_nip || m.NIS) === config.siswa);
    } else {
        if (config.tahun !== 'ALL') filtered = filtered.filter(m => (m.tahun_pelajaran || m["ID Tahun Pelajaran"] || "") === config.tahun);
        if (config.kelas !== 'ALL') filtered = filtered.filter(m => (m.tingkat_kelas || m["Tingkat/Kelas"] || "") === config.kelas);
        if (config.ekskul !== 'ALL') filtered = filtered.filter(m => {
            const e = m.ekstrakurikuler || m.Ekstrakurikuler || "";
            return e.split(',').map(x => x.trim()).includes(config.ekskul);
        });
    }

    if(filtered.length === 0) return Swal.fire('Kosong', 'Tidak ada siswa yang cocok dengan filter tersebut.', 'warning');

    const printWindow = window.open('', '_blank');
    
    // FIX LOW-BUG: popup blocker guard sebelum menulis ke jendela cetak kartu QR
    if (!printWindow) return Swal.fire({ icon: 'error', title: 'Popup Diblokir', text: 'Izinkan popup untuk mencetak kartu QR.', background: '#1e293b', color: '#fff' });

    let htmlCards = filtered.map(m => {
        const nisVal = m.nis_nip || m.NIS || '';
        const nisnVal = m.nisn || m.NISN || '';
        let qrDataVal = config.target === 'NISN' ? (nisnVal || nisVal) : nisVal;
        // Memperkecil resolusi QR agar load lebih cepat (80x80)
        let qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=80x80&margin=0&data=${encodeURIComponent(qrDataVal)}`;
        
        return `
            <div class="qr-card">
                <div class="card-header">
                    <h4>${escapeHtml(m.nama_lengkap || m["Nama Lengkap"] || '-')}</h4>
                    <p>${escapeHtml(m.tingkat_kelas || m["Tingkat/Kelas"] || '-')}</p>
                </div>
                <img src="${qrUrl}" alt="QR Code"/>
                <div class="card-footer">
                    <p class="qr-val">${escapeHtml(qrDataVal)}</p>
                    ${config.label_mapel ? `<span class="lbl-mapel">${escapeHtml(config.label_mapel)}</span>` : ''}
                    ${config.ekskul !== 'ALL' ? `<span class="lbl-eks">${escapeHtml(config.ekskul)}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');

    printWindow.document.write(`
        <html>
            <head>
                <title>Cetak QR Code Siswa A4</title>
                <style>
                    * { box-sizing: border-box; }
                    body { 
                        margin: 0; 
                        padding: 0; 
                        background: #fff;
                        font-family: Arial, sans-serif;
                    }
                    /* Mengatur Ukuran A4 dan Margin Ujung Kertas Maksimal */
                    @page { 
                        size: A4; 
                        margin: 5mm; 
                    }
                    .info-header {
                        text-align: center;
                        margin-bottom: 10px;
                    }
                    .info-header h2 { margin: 5px 0; font-size: 14px; }
                    
                    /* Sistem 4 Kolom Rapat */
                    .grid-container {
                        display: grid;
                        grid-template-columns: repeat(4, 1fr);
                        gap: 3px; /* Jarak antar kartu sangat kecil */
                        width: 100%;
                    }
                    
                    /* Desain Kartu Mini */
                    .qr-card {
                        border: 1px dashed #666;
                        border-radius: 4px;
                        padding: 5px;
                        text-align: center;
                        display: flex;
                        flex-direction: column;
                        justify-content: space-between;
                        align-items: center;
                        height: 100%;
                        page-break-inside: avoid; /* Mencegah kartu terpotong di tengah halaman */
                    }
                    .card-header { width: 100%; min-height: 25px; margin-bottom: 2px; }
                    .card-header h4 { margin: 0; font-size: 10px; line-height: 1.1; text-transform: uppercase; }
                    .card-header p { margin: 2px 0 0 0; font-size: 9px; color: #333; font-weight: bold; }
                    
                    .qr-card img { width: 70px; height: 70px; display: block; margin: 0 auto; }
                    
                    .card-footer { width: 100%; margin-top: 3px; }
                    .qr-val { margin: 0; font-weight: bold; font-size: 11px; letter-spacing: 1px; }
                    .lbl-mapel { display: block; margin-top: 2px; font-size: 7px; background: #eee; padding: 1px; }
                    .lbl-eks { display: block; margin-top: 1px; font-size: 7px; color: #555; }

                    /* Menghilangkan header info saat di print agar muat lebih banyak */
                    @media print {
                        .info-header { display: none; }
                    }
                </style>
            </head>
            <body>
                <div class="info-header">
                    <h2>PREVIEW QR CODE KEHADIRAN</h2>
                    <p style="margin: 0; font-size: 10px;">Akan otomatis disembunyikan saat dicetak (Total: ${filtered.length} Siswa)</p>
                </div>
                <div class="grid-container">
                    ${htmlCards}
                </div>
                <script>
                    setTimeout(() => { window.print(); window.close(); }, 1500); 
                </script>
            </body>
        </html>
    `);
    printWindow.document.close();
}

function deleteAkunMurid(nisKey) {
    const d = (cacheAkunMurid || []).find(r => (r.nis_nip || r.NIS || r.nis) === nisKey);
    if (!d) { showToast('error', 'Data murid tidak ditemukan di cache.'); return; }
    const nama = d.nama_lengkap || d["Nama Lengkap"] || nisKey;
    Swal.fire({
        title: 'Yakin Hapus?', html: `Akun murid <b>${nama}</b> akan dihapus permanen.`, icon: 'warning',
        background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Ya, Hapus'
    }).then(async (result) => {
        if (!result.isConfirmed) return;
        Swal.fire({title: 'Menghapus...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading()});
        // Tertaut user Auth → hapus Auth + profil via Edge Function; baris lokal → hapus profil saja
        const payload = d.user_id
          ? { action: 'hapus_akun', user_id: d.user_id }
          : { action: 'hapus_akun', profil_id: d.id };
        const hasil = await kelolaAkunAuth(payload);
        if (hasil.status === 'success') {
            Swal.fire({toast:true, position:'top-end', icon:'success', title:'Terhapus!', showConfirmButton:false, timer:1500, background: '#1e293b', color: '#fff'});
            renderManajemenMurid(document.getElementById('main-content'));
        } else {
            Swal.fire({icon:'error', title:'Gagal', text: hasil.message || 'Terjadi kesalahan.', background:'#1e293b', color:'#fff'});
        }
    });
}

function openImportMurid() {
    Swal.fire({
        title: '<div class="text-base font-bold text-teal-400"><i class="fa-solid fa-file-excel"></i> Import Data Murid</div>',
        html: `
            <div class="text-sm text-slate-300 mb-4 text-left">
                1. Unduh template format Excel di bawah ini.<br>
                2. Isi data murid pada aplikasi Excel.<br>
                3. Upload kembali file yang sudah diisi ke sini.
            </div>
            <button onclick="downloadTemplateMurid()" class="w-full mb-4 bg-teal-600 hover:bg-teal-700 text-white px-3 py-2 rounded shadow-md text-xs font-bold transition"><i class="fa-solid fa-download"></i> Download Template Murid</button>
            <div class="border-t border-white/20 pt-4">
                <label class="block text-left text-[10px] font-bold text-teal-300 mb-1">Upload File Excel (.xlsx)</label>
                <input type="file" id="file-import-murid" accept=".xlsx, .xls" class="w-full bg-black/40 border border-white/20 rounded p-2 text-xs text-white outline-none focus:border-teal-500">
            </div>
        `,
        background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonText: '<i class="fa-solid fa-upload"></i> Proses Import',
        preConfirm: () => {
            const file = document.getElementById('file-import-murid').files[0];
            if(!file) { Swal.showValidationMessage('Pilih file Excel terlebih dahulu!'); return false; }
            return file;
        }
    }).then(res => {
        if(res.isConfirmed) prosesImportDataMurid(res.value);
    });
}

function downloadTemplateMurid() {
    if (typeof XLSX === 'undefined') return Swal.fire('Error', 'Library SheetJS tidak ditemukan.', 'error');

    // Header sesuai kolom tabel akun yang didukung import
    const headers = ["NIS", "NISN", "Nama Lengkap", "Tahun Pelajaran", "Semester", "Tingkat/Kelas", "Jenis Kelamin", "Tgl Lahir", "Agama", "Golongan Darah", "Ekstrakurikuler", "Jabatan Kelas", "Nama Orang tua Ayah", "Pekerjaan Ayah", "Nama Orang tua Ibu", "Pekerjaan Ibu", "Nama Wali", "Alamat", "No HP/WA", "Email", "Catatan Khusus", "Password"];

    const dataRows = [
        ["FORMAT IMPORT DATA MURID"],
        ["INFO", "Isi baris di bawah header dengan data murid. Kolom NIS dan Nama Lengkap wajib diisi. Tgl Lahir format YYYY-MM-DD. Ekskul pisah dengan koma. Password kosong = otomatis 123456."],
        headers
    ];

    const ws = XLSX.utils.aoa_to_sheet(dataRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template_Murid");
    XLSX.writeFile(wb, 'Template_Data_Murid.xlsx');
}

function prosesImportDataMurid(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const ws = workbook.Sheets[workbook.SheetNames[0]];
            const jsonArray = XLSX.utils.sheet_to_json(ws, {header: 1});

            if(jsonArray.length < 3) throw new Error("Format template tidak dikenali.");

            const headers = jsonArray[2].map(h => String(h || '').trim());
            const idxOf = (nama) => headers.findIndex(h => h.toLowerCase() === nama.toLowerCase());
            const idxNis = idxOf('NIS');
            if (idxNis === -1) throw new Error("Kolom 'NIS' tidak ditemukan di template.");

            const ambil = (row, nama) => {
                const i = idxOf(nama);
                return (i !== -1 && row[i] !== undefined) ? String(row[i]).trim() : '';
            };

            let rows = [];
            for(let i=3; i<jsonArray.length; i++) {
                const row = jsonArray[i];
                if (!row || !row[idxNis]) continue; // Skip jika NIS kosong
                const tglLahirRaw = ambil(row, 'Tgl Lahir');
                rows.push({
                    nis: String(row[idxNis]).trim(),
                    nisn: ambil(row, 'NISN'),
                    nama_lengkap: ambil(row, 'Nama Lengkap'),
                    tahun_pelajaran: ambil(row, 'Tahun Pelajaran'),
                    semester: ambil(row, 'Semester'),
                    tingkat_kelas: ambil(row, 'Tingkat/Kelas'),
                    jenis_kelamin: ambil(row, 'Jenis Kelamin'),
                    tgl_lahir: tglLahirRaw,
                    agama: ambil(row, 'Agama'),
                    golongan_darah: ambil(row, 'Golongan Darah'),
                    ekstrakurikuler: ambil(row, 'Ekstrakurikuler'),
                    jabatan: ambil(row, 'Jabatan Kelas'),
                    nama_ayah: ambil(row, 'Nama Orang tua Ayah'),
                    pekerjaan_ayah: ambil(row, 'Pekerjaan Ayah'),
                    nama_ibu: ambil(row, 'Nama Orang tua Ibu'),
                    pekerjaan_ibu: ambil(row, 'Pekerjaan Ibu'),
                    nama_wali: ambil(row, 'Nama Wali'),
                    alamat: ambil(row, 'Alamat'),
                    no_telepon: ambil(row, 'No HP/WA'),
                    email: ambil(row, 'Email'),
                    catatan_khusus: ambil(row, 'Catatan Khusus'),
                    password: ambil(row, 'Password')
                });
            }

            if(rows.length === 0) throw new Error("Tidak ada data murid yang ditemukan untuk diimport.");

            simpanMasalAkunMurid(rows);

        } catch(err) {
            Swal.fire('Error Import', err.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

async function simpanMasalAkunMurid(rows) {
    Swal.fire({ title: 'Menyimpan Data...', html: `Memproses ${rows.length} murid...`, allowOutsideClick: false, didOpen: () => Swal.showLoading(), background: '#1e293b', color: '#fff' });

    try {
        const { data, error } = await supaClient.rpc('import_akun_murid', { p_rows: rows, p_default_password: '123456' });
        if (error) throw error;
        if (!data || data.status !== 'success') throw new Error((data && data.message) || 'Import gagal.');

        const detailGagal = (data.detail_gagal || []).slice(0, 5).map(t => `<li class="text-left">${escapeHtml(t)}</li>`).join('');
        Swal.fire({
            icon: 'success',
            title: 'Import Selesai',
            html: `<div class="text-sm text-left">Ditambahkan: <b>${data.ditambahkan}</b><br>Diperbarui: <b>${data.diperbarui}</b><br>Gagal: <b>${data.gagal}</b>${detailGagal ? `<ul class="text-[10px] text-red-300 mt-2 list-disc list-inside">${detailGagal}</ul>` : ''}</div>`,
            background: '#1e293b', color: '#fff', confirmButtonColor: '#0ea5e9'
        });
        renderManajemenMurid(document.getElementById('main-content'));
    } catch (error) {
        console.error("Error import masal murid:", error);
        Swal.fire({ icon: 'error', title: 'Gagal', text: error.message || 'Terjadi kesalahan saat import data.', background: '#1e293b', color: '#fff' });
    }
}

// ==========================================
// MANAJEMEN AKUN ADMIN (FRONTEND)
// Akun dibuat via Edge Function 'buat-akun' → user Auth + profil tabel 'akun'
// ==========================================

let cacheAkunAdmin = [];

async function renderManajemenAdmin(container) {
    container.innerHTML = `<div class="p-6 text-center text-slate-300"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>Memuat Data Admin...</div>`;

    try {
        const { data, error } = await supaClient
          .from('akun')
          .select('*')
          .eq('tipe', 'admin')
          .order('nama_lengkap', { ascending: true });
        if (error) throw error;
        cacheAkunAdmin = data || [];

        container.innerHTML = `
            <div class="glass-card rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex flex-col h-[85vh]">
                <div class="bg-slate-800/80 p-4 border-b border-white/10 flex flex-col sm:flex-row justify-between items-center gap-3">
                    <h2 class="text-sm sm:text-base font-bold text-white uppercase tracking-wider"><i class="fa-solid fa-user-shield text-amber-400 mr-2"></i> Manajemen Akun Admin</h2>
                    <div class="flex gap-2 w-full sm:w-auto">
                        <input type="text" id="search-admin" placeholder="Cari NIP / Nama / Email..." class="w-full sm:w-48 bg-black/40 border border-white/20 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-amber-500" onkeyup="filterTabelAdmin()">
                        <button onclick="openFormAkunAdmin(true)" class="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition shadow-md whitespace-nowrap"><i class="fa-solid fa-plus"></i> Tambah Admin</button>
                    </div>
                </div>
                <div class="flex-1 overflow-auto custom-scrollbar bg-[#0f172a]">
                    <table class="w-full text-left whitespace-nowrap">
                        <thead class="sticky top-0 bg-slate-900 z-10 text-[10px] uppercase text-slate-400 shadow-md">
                            <tr>
                                <th class="px-4 py-3 border-b border-white/10 text-center">No</th>
                                <th class="px-4 py-3 border-b border-white/10">NIP</th>
                                <th class="px-4 py-3 border-b border-white/10">Nama Admin</th>
                                <th class="px-4 py-3 border-b border-white/10">Email Login</th>
                                <th class="px-4 py-3 border-b border-white/10 text-center">Aksi</th>
                            </tr>
                        </thead>
                        <tbody id="tbody-admin" class="text-xs text-slate-200">
                            ${generateTbodyAdmin(cacheAkunAdmin)}
                        </tbody>
                    </table>
                </div>
                <div class="bg-slate-800/60 px-4 py-2 border-t border-white/10 text-[10px] text-slate-400">
                    <i class="fa-solid fa-shield-halved"></i> Password disimpan terenkripsi di Supabase Auth (tidak tampil & tidak bisa dilihat siapa pun).
                </div>
            </div>
        `;
    } catch(e) {
        console.error("Error renderManajemenAdmin:", e);
        container.innerHTML = `<div class="p-6 text-center text-red-400">Gagal memuat data admin. Periksa koneksi jaringan.</div>`;
    }
}

function generateTbodyAdmin(data) {
    if (!data || data.length === 0) return `<tr><td colspan="5" class="p-6 text-center text-slate-500">Belum ada admin. Klik "Tambah Admin" untuk membuat.</td></tr>`;
    return data.map((d, i) => `
        <tr class="hover:bg-white/5 border-b border-white/5 transition row-admin">
            <td class="px-4 py-3 text-center">${i+1}</td>
            <td class="px-4 py-3 font-mono text-amber-300 search-target">${d.nis_nip || '-'}</td>
            <td class="px-4 py-3 search-target font-bold text-white">${d.nama_lengkap || 'Tanpa Nama'}</td>
            <td class="px-4 py-3 search-target"><div class="text-[11px] text-slate-300"><i class="fa-solid fa-envelope"></i> ${d.email || '-'}</div></td>
            <td class="px-4 py-3 text-center whitespace-nowrap">
                <button onclick='openFormAkunAdmin(false, ${JSON.stringify(d).replace(/'/g, "&#39;")})' class="w-7 h-7 bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white rounded transition mr-1" title="Edit"><i class="fa-solid fa-pen"></i></button>
                ${d.user_id ? `<button onclick="resetPasswordGuru('${escJs(d.user_id)}', '${escJs(d.nama_lengkap || '')}')" class="w-7 h-7 bg-amber-600/20 hover:bg-amber-600 text-amber-400 hover:text-white rounded transition mr-1" title="Reset Password"><i class="fa-solid fa-key"></i></button>` : ''}
                <button onclick="deleteAkunAdmin('${escJs(d.user_id || '')}', '${escJs(d.nama_lengkap || '')}', '${escJs(d.id || '')}')" class="w-7 h-7 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded transition" title="Hapus"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

function filterTabelAdmin() {
    const query = (document.getElementById('search-admin')?.value || '').toLowerCase();
    document.querySelectorAll('.row-admin').forEach(row => {
        row.style.display = row.innerText.toLowerCase().includes(query) ? '' : 'none';
    });
}

function openFormAkunAdmin(isNew, data = {}) {
    Swal.fire({
        title: `<div class="text-lg font-bold">${isNew ? 'Tambah' : 'Edit'} Akun Admin</div>`,
        html: `
            <div class="grid grid-cols-1 gap-3 text-left text-[11px] text-slate-300 mt-2">
                <div><label class="font-bold text-amber-300">Nama Lengkap *</label><input id="f_nama_admin" value="${data.nama_lengkap || ''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-amber-500"></div>
                <div><label class="font-bold text-amber-300">NIP (opsional)</label><input id="f_nip_admin" value="${data.nis_nip || ''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-amber-500"></div>
                <div><label class="font-bold text-amber-300">Email Login *</label><input id="f_email_admin" type="email" value="${data.email || ''}" ${isNew ? '' : 'disabled'} class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-amber-500 disabled:opacity-50"></div>
                ${isNew ? `<div><label class="font-bold text-amber-300">Password *</label><input id="f_pass_admin" type="text" value="123456" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-amber-500"><p class="text-[9px] text-slate-400 mt-1">Minimal 6 karakter. Disimpan terenkripsi di Supabase Auth.</p></div>` : ''}
            </div>
        `,
        width: 460, background: '#1e293b', color: '#fff',
        showCancelButton: true, confirmButtonText: '<i class="fa-solid fa-save"></i> Simpan',
        preConfirm: () => {
            const nama = document.getElementById('f_nama_admin').value.trim();
            const email = document.getElementById('f_email_admin').value.trim();
            if (!nama) { Swal.showValidationMessage('Nama wajib diisi!'); return false; }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { Swal.showValidationMessage('Email tidak valid!'); return false; }
            if (isNew && document.getElementById('f_pass_admin').value.trim().length < 6) {
                Swal.showValidationMessage('Password minimal 6 karakter!'); return false;
            }
            return {
                nama_lengkap: nama,
                nis_nip: document.getElementById('f_nip_admin').value.trim(),
                email,
                password: isNew ? document.getElementById('f_pass_admin').value.trim() : undefined
            };
        }
    }).then(async (res) => {
        if (!res.isConfirmed) return;
        Swal.fire({ title: 'Menyimpan...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
        const payload = { action: isNew ? 'buat_akun' : 'update_akun', tipe: 'admin', ...res.value };
        if (!isNew) {
            payload.user_id = data.user_id || '';
            delete payload.password;
        }
        const hasil = await kelolaAkunAuth(payload);
        if (hasil.status === 'success') {
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: hasil.message, showConfirmButton: false, timer: 2500, background: '#1e293b', color: '#fff' });
            renderManajemenAdmin(document.getElementById('main-content'));
        } else {
            Swal.fire({ icon: 'error', title: 'Gagal', text: hasil.message || 'Terjadi kesalahan.', background: '#1e293b', color: '#fff' });
        }
    });
}

function deleteAkunAdmin(userId, nama, profilId) {
    if (!userId && !profilId) { showToast('error', 'Akun tidak memiliki user_id / id profil.'); return; }
    Swal.fire({
        title: 'Yakin Hapus?',
        html: `Akun admin <b>${nama || ''}</b> akan dihapus permanen dari Auth & tabel akun.`,
        icon: 'warning', background: '#1e293b', color: '#fff',
        showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Ya, Hapus'
    }).then(async (result) => {
        if (!result.isConfirmed) return;
        Swal.fire({ title: 'Menghapus...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
        const payload = { action: 'hapus_akun' };
        if (userId) payload.user_id = userId; else payload.profil_id = profilId;
        const hasil = await kelolaAkunAuth(payload);
        if (hasil.status === 'success') {
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: hasil.message, showConfirmButton: false, timer: 2000, background: '#1e293b', color: '#fff' });
            renderManajemenAdmin(document.getElementById('main-content'));
        } else {
            Swal.fire({ icon: 'error', title: 'Gagal', text: hasil.message || 'Terjadi kesalahan.', background: '#1e293b', color: '#fff' });
        }
    });
}

// ==========================================
// MASTER DATA (FRONTEND)
// Kolom tabel master_data = nama persis gaya Sheets:
//   "Nama Dinas", "Nama Sekolah", "URL LOGO 1", "URL LOGO 2", "Ket. Nama Dinas",
//   "Alamat Sekolah", "Semester", "Tahun Pelajaran", "Tingkat/Kelas",
//   "Mata Pelajaran", "Ekstrakurikuler", "Jabatan Kelas", "Jabatan Guru",
//   "Status Kehadiran", "Jam Pelajaran Senin".."Jam Pelajaran Sabtu",
//   "Jurusan", "Kategori Nilai", "Agama", "Jadwal Ujian", "Kegiatan",
//   "NPSN", "Kepala Sekolah", "Telepon Sekolah", "Email Sekolah",
//   "Website Sekolah", "Kurikulum"
// Tab Identitas: 12 field sekolah (baris tunggal).
// Tab Daftar: 10 kategori; 9 kategori jadwal (Status Kehadiran, Jam Pelajaran
//   per hari, Jadwal Ujian, Kegiatan) dirender di menu Jadwal & Libur → tab Master Jadwal.
// ==========================================

let currentTabMaster = 'identitas';
let masterSortDir = {};

const MASTER_DAFTAR_SECTIONS = [
    { kolom: "Tahun Pelajaran", icon: 'fa-calendar-days', ph: '2026/2027' },
    { kolom: "Semester", icon: 'fa-repeat', ph: 'Ganjil' },
    { kolom: "Tingkat/Kelas", icon: 'fa-school', ph: 'X RPL 1' },
    { kolom: "Mata Pelajaran", icon: 'fa-book', ph: 'Matematika' },
    { kolom: "Ekstrakurikuler", icon: 'fa-futbol', ph: 'Pramuka' },
    { kolom: "Jabatan Kelas", icon: 'fa-user-tie', ph: 'Ketua Kelas' },
    { kolom: "Jabatan Guru", icon: 'fa-chalkboard-user', ph: 'Kepala Sekolah' },
    { kolom: "Jurusan", icon: 'fa-graduation-cap', ph: 'Rekayasa Perangkat Lunak' },
    { kolom: "Kategori Nilai", icon: 'fa-star-half-stroke', ph: 'Tugas Harian' },
    { kolom: "Agama", icon: 'fa-hands-praying', ph: 'Islam' }
];

const MASTER_JADWAL_SECTIONS = [
    { kolom: "Status Kehadiran", icon: 'fa-user-check', ph: 'Hadir' },
    { kolom: "Jam Pelajaran Senin", icon: 'fa-clock', ph: '1 - 07.00-07.40' },
    { kolom: "Jam Pelajaran Selasa", icon: 'fa-clock', ph: '1 - 07.00-07.40' },
    { kolom: "Jam Pelajaran Rabu", icon: 'fa-clock', ph: '1 - 07.00-07.40' },
    { kolom: "Jam Pelajaran Kamis", icon: 'fa-clock', ph: '1 - 07.00-07.40' },
    { kolom: "Jam Pelajaran Jumat", icon: 'fa-clock', ph: '1 - 07.00-07.40' },
    { kolom: "Jam Pelajaran Sabtu", icon: 'fa-clock', ph: '1 - 07.00-07.40' },
    { kolom: "Jadwal Ujian", icon: 'fa-file-pen', ph: 'PTS Matematika - 12 Sep' },
    { kolom: "Kegiatan", icon: 'fa-flag-checkered', ph: 'MPLS 2026' }
];

const MASTER_KOLOM_DAFTAR = [...MASTER_DAFTAR_SECTIONS, ...MASTER_JADWAL_SECTIONS].map(s => s.kolom);
const MASTER_KOLOM_IDENTITAS = ["Nama Dinas", "Nama Sekolah", "URL LOGO 1", "URL LOGO 2", "Ket. Nama Dinas", "Alamat Sekolah"];

function renderMasterDataModule(container) {
    const tabBtn = (id, label, icon) => `
        <button onclick="gantiTabMaster('${id}')" class="px-4 py-2 rounded-lg text-xs font-bold transition ${currentTabMaster === id ? 'bg-blue-600 text-white shadow-md' : 'bg-white/10 text-slate-300 hover:bg-white/20'}">
            <i class="fa-solid ${icon} mr-1"></i> ${label}
        </button>`;

    container.innerHTML = `
        <div class="glass-card rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex flex-col h-[85vh]">
            <div class="bg-slate-800/80 p-4 border-b border-white/10 flex flex-col sm:flex-row justify-between items-center gap-3">
                <h2 class="text-sm sm:text-base font-bold text-white uppercase tracking-wider"><i class="fa-solid fa-database text-purple-400 mr-2"></i> Master Data</h2>
                <div class="flex gap-2">
                    ${tabBtn('identitas', 'Identitas Sekolah', 'fa-school')}
                    ${tabBtn('daftar', `Daftar (${MASTER_DAFTAR_SECTIONS.length} Kategori)`, 'fa-list')}
                </div>
            </div>
            <div id="content-master" class="flex-1 overflow-auto custom-scrollbar bg-[#0f172a] p-4"></div>
        </div>
    `;
    if (currentTabMaster === 'identitas') renderTabIdentitas(); else renderTabDaftar();
}

function gantiTabMaster(tab) {
    currentTabMaster = tab;
    renderMasterDataModule(document.getElementById('main-content'));
}

async function ambilMasterData() {
    const { data, error } = await supaClient.from('master_data').select('*');
    if (error) throw error;
    masterDataCache = data || []; // refresh cache bersama (format kunci = nama kolom)
    return masterDataCache;
}

async function renderTabIdentitas() {
    const box = document.getElementById('content-master');
    box.innerHTML = `<div class="p-6 text-center text-slate-300"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>Memuat...</div>`;
    try {
        const rows = await ambilMasterData();
        const idn = rows.find(r => r["Nama Sekolah"]) || {};
        const F = [
            { id: 'nama_dinas', kol: 'Nama Dinas', ph: 'DINAS PENDIDIKAN...' },
            { id: 'nama_sekolah', kol: 'Nama Sekolah', ph: 'SMKN 2 BANJAR' },
            { id: 'url_logo1', kol: 'URL LOGO 1', ph: 'https://...' },
            { id: 'url_logo2', kol: 'URL LOGO 2', ph: 'https://...' },
            { id: 'ket_dinas', kol: 'Ket. Nama Dinas', ph: 'Provinsi Jawa Barat' },
            { id: 'alamat', kol: 'Alamat Sekolah', ph: 'Jl. ...' },
            { id: 'npsn', kol: 'NPSN', ph: '20219705' },
            { id: 'kepsek', kol: 'Kepala Sekolah', ph: 'Nama Kepala Sekolah' },
            { id: 'telp', kol: 'Telepon Sekolah', ph: '(0265) xxx xxxx' },
            { id: 'email', kol: 'Email Sekolah', ph: 'info@sekolah.sch.id' },
            { id: 'website', kol: 'Website Sekolah', ph: 'https://sekolah.sch.id' },
            { id: 'kurikulum', kol: 'Kurikulum', ph: 'Kurikulum Merdeka' }
        ];
        box.innerHTML = `
            <div class="max-w-lg mx-auto space-y-3 text-left text-[11px] text-slate-300">
                <p class="text-[10px] text-slate-400"><i class="fa-solid fa-circle-info"></i> Baris identitas dipakai header aplikasi (logo &amp; nama sekolah). Simpan hanya satu baris identitas.</p>
                ${F.map(f => `<div><label class="font-bold text-purple-300">${f.kol}</label><input id="mi_${f.id}" value="${escJs(idn[f.kol] || '')}" placeholder="${f.ph}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-purple-500"></div>`).join('')}
                <div class="pt-2"><button onclick="simpanIdentitasMaster('${idn.id ?? ''}')" class="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-md"><i class="fa-solid fa-save"></i> Simpan Identitas</button></div>
            </div>
        `;
    } catch (e) {
        box.innerHTML = `<div class="p-6 text-center text-red-400">Gagal memuat: ${escapeHtml(e.message || '')}</div>`;
    }
}

async function simpanIdentitasMaster(rowId) {
    const ambil = id => (document.getElementById('mi_' + id)?.value || '').trim();
    const payload = {
        "Nama Dinas": ambil('nama_dinas'),
        "Nama Sekolah": ambil('nama_sekolah'),
        "URL LOGO 1": ambil('url_logo1'),
        "URL LOGO 2": ambil('url_logo2'),
        "Ket. Nama Dinas": ambil('ket_dinas'),
        "Alamat Sekolah": ambil('alamat'),
        "NPSN": ambil('npsn'),
        "Kepala Sekolah": ambil('kepsek'),
        "Telepon Sekolah": ambil('telp'),
        "Email Sekolah": ambil('email'),
        "Website Sekolah": ambil('website'),
        "Kurikulum": ambil('kurikulum')
    };
    if (!payload["Nama Sekolah"]) { showToast('error', 'Nama sekolah wajib diisi.'); return; }
    Swal.fire({ title: 'Menyimpan...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
    try {
        const { error } = rowId
          ? await supaClient.from('master_data').update(payload).eq('id', rowId)
          : await supaClient.from('master_data').insert(payload);
        if (error) throw error;
        await ambilMasterData();
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Identitas tersimpan!', showConfirmButton: false, timer: 2000, background: '#1e293b', color: '#fff' });
        renderTabIdentitas();
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Gagal', text: e.message, background: '#1e293b', color: '#fff' });
    }
}

let masterSectionContext = 'master';

function ubahSortMaster(kolom) {
    masterSortDir[kolom] = masterSortDir[kolom] === 'desc' ? 'asc' : 'desc';
    refreshMasterUI();
}

async function renderMasterDaftarUI(containerId, sections) {
    const box = document.getElementById(containerId);
    if (!box) return;
    box.innerHTML = `<div class="p-6 text-center text-slate-300"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>Memuat...</div>`;
    try {
        const rows = await ambilMasterData();
        // Kelompokkan nilai per kolom (baris bisa berisi campuran; tampilkan per kategori)
        const sectionHTML = sections.map(s => {
            const items = rows
              .filter(r => (r[s.kolom] || '').trim() !== '')
              .map(r => ({ id: r.id, val: (r[s.kolom] || '').trim() }))
              .sort((a, b) => masterSortDir[s.kolom] === 'desc'
                  ? b.val.localeCompare(a.val, { sensitivity: 'base' })
                  : a.val.localeCompare(b.val, { sensitivity: 'base' }));
            const idInput = 'mi_' + s.kolom.replace(/[^A-Za-z]/g, '');
            return `
                <div class="bg-white/5 border border-white/10 rounded-xl p-3">
                    <div class="flex items-center justify-between mb-2">
                        <h3 class="text-[11px] font-bold text-purple-300 uppercase tracking-wide"><i class="fa-solid ${s.icon} mr-1"></i> ${s.kolom}</h3>
                        <button onclick="ubahSortMaster('${escJs(s.kolom)}')" title="${masterSortDir[s.kolom] === 'desc' ? 'Urutkan Z-A' : 'Urutkan A-Z'}" class="w-6 h-6 flex items-center justify-center rounded-md bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white transition">
                            <i class="fa-solid ${masterSortDir[s.kolom] === 'desc' ? 'fa-arrow-up-a-z' : 'fa-arrow-down-a-z'} text-[10px]"></i>
                        </button>
                    </div>
                    <div class="flex gap-2 mb-2">
                        <input id="${idInput}" placeholder="${s.ph}" onkeydown="if(event.key==='Enter')tambahMasterDaftar('${escJs(s.kolom)}')" class="flex-1 bg-black/40 border border-white/20 rounded px-2 py-1.5 text-[11px] text-white outline-none focus:border-purple-500">
                        <button onclick="tambahMasterDaftar('${escJs(s.kolom)}')" class="bg-purple-600 hover:bg-purple-700 text-white px-3 rounded-lg text-xs font-bold shadow-md"><i class="fa-solid fa-plus"></i></button>
                    </div>
                    ${items.length === 0
                      ? `<p class="text-[10px] text-slate-500 italic">Belum ada data.</p>`
                      : `<div class="flex flex-wrap gap-1.5">${items.map(it => `
                            <span class="inline-flex items-center gap-1.5 bg-slate-800 border border-white/10 rounded-full pl-2.5 pr-1 py-1 text-[10px] text-slate-200">
                                ${escapeHtml(it.val)}
                                <button onclick="hapusMasterDaftar('${r_id(it.id)}', '${escJs(s.kolom)}')" class="w-4 h-4 flex items-center justify-center bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded-full" title="Hapus"><i class="fa-solid fa-xmark text-[8px]"></i></button>
                            </span>`).join('')}
                        </div>`}
                </div>`;
        });
        box.innerHTML = `
            <div class="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-3">
                ${sectionHTML.join('')}
            </div>
        `;
    } catch (e) {
        box.innerHTML = `<div class="p-6 text-center text-red-400">Gagal memuat: ${escapeHtml(e.message || '')}</div>`;
    }
}

async function renderTabDaftar() {
    masterSectionContext = 'master';
    await renderMasterDaftarUI('content-master', MASTER_DAFTAR_SECTIONS);
}

async function renderTabMasterJadwal() {
    masterSectionContext = 'jadwal';
    await renderMasterDaftarUI('content-jadwal-libur', MASTER_JADWAL_SECTIONS);
}

function refreshMasterUI() {
    if (masterSectionContext === 'jadwal') renderTabMasterJadwal(); else renderTabDaftar();
}

// helper id aman utk atribut onclick
function r_id(v) { return v == null ? '' : String(v); }

async function tambahMasterDaftar(kolom) {
    const idInput = 'mi_' + kolom.replace(/[^A-Za-z]/g, '');
    const nilai = (document.getElementById(idInput)?.value || '').trim();
    if (!nilai) { showToast('error', 'Isi nilai terlebih dahulu.'); return; }
    // Hindari duplikat pada kolom yang sama (cek cache terakhir)
    const dup = (masterDataCache || []).some(r => (r[kolom] || '').trim().toLowerCase() === nilai.toLowerCase());
    if (dup) { showToast('error', `"${nilai}" sudah ada di ${kolom}.`); return; }
    Swal.fire({ title: 'Menyimpan...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
    try {
        // Hemat baris: isi kolom kosong pada baris existing (bukan baris identitas) sebelum membuat baris baru
        const target = (masterDataCache || []).find(r =>
            !(r[kolom] || '').trim() &&
            !MASTER_KOLOM_IDENTITAS.some(k => (r[k] || '').trim() !== ''));
        const { error } = target
          ? await supaClient.from('master_data').update({ [kolom]: nilai }).eq('id', target.id)
          : await supaClient.from('master_data').insert({ [kolom]: nilai });
        if (error) throw error;
        await ambilMasterData();
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Ditambahkan!', showConfirmButton: false, timer: 1200, background: '#1e293b', color: '#fff' });
        refreshMasterUI();
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Gagal', text: e.message, background: '#1e293b', color: '#fff' });
    }
}

async function hapusMasterDaftar(rowId, kolom) {
    const konf = await Swal.fire({
        title: 'Hapus data ini?',
        text: `"${kolom}" akan dihapus permanen dari database.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Ya, Hapus',
        cancelButtonText: 'Batal',
        background: '#1e293b',
        color: '#fff'
    });
    if (!konf.isConfirmed) return;
    Swal.fire({ title: 'Menghapus...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
    try {
        // Jika baris masih dipakai kategori lain, kosongkan kolom ini saja; hapus baris hanya jika sudah kosong
        const row = (masterDataCache || []).find(r => String(r.id) === String(rowId));
        let error;
        if (row && MASTER_KOLOM_DAFTAR.some(k => k !== kolom && (row[k] || '').trim() !== '')) {
            ({ error } = await supaClient.from('master_data').update({ [kolom]: null }).eq('id', rowId));
        } else {
            ({ error } = await supaClient.from('master_data').delete().eq('id', rowId));
        }
        if (error) throw error;
        await ambilMasterData();
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Terhapus!', showConfirmButton: false, timer: 1200, background: '#1e293b', color: '#fff' });
        refreshMasterUI();
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Gagal', text: e.message, background: '#1e293b', color: '#fff' });
    }
}

// ==========================================
// MANAJEMEN AKUN GURU (FRONTEND)
// ==========================================

let cacheAkunGuru = [];

/** Baca kolom master_data dengan format lama ("Tingkat/Kelas") atau baru (snake_case). */
function mdVal(m, kunciLama, kunciBaru) {
    return (m && (m[kunciLama] ?? m[kunciBaru])) || "";
}

async function renderManajemenGuru(container) {
    container.innerHTML = `<div class="p-6 text-center text-slate-300"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>Memuat Data Guru...</div>`;

    try {
        // 1. Muat master data (untuk dropdown) — JANGAN menimpa cache yang sudah ada
        if (!masterDataCache || masterDataCache.length === 0) {
            const { data: master, error: mErr } = await supaClient.from('master_data').select('*');
            if (!mErr && master) masterDataCache = master;
        }
        // 2. Ambil semua guru dari tabel akun
        const { data, error } = await supaClient
          .from('akun')
          .select('*')
          .eq('tipe', 'guru')
          .order('nama_lengkap', { ascending: true });
        if (error) throw error;
        cacheAkunGuru = data || [];

        container.innerHTML = `
            <div class="glass-card rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex flex-col h-[85vh]">
                <div class="bg-slate-800/80 p-4 border-b border-white/10 flex flex-col sm:flex-row justify-between items-center gap-3">
                    <h2 class="text-sm sm:text-base font-bold text-white uppercase tracking-wider"><i class="fa-solid fa-chalkboard-user text-green-400 mr-2"></i> Manajemen Akun Guru</h2>
                    <div class="flex gap-2 w-full sm:w-auto">
                        <input type="text" id="search-guru" placeholder="Cari NIP / Nama / Email..." class="w-full sm:w-48 bg-black/40 border border-white/20 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-green-500" onkeyup="filterTabelGuru()">
                        <button onclick="openFormAkunGuru(true)" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition shadow-md whitespace-nowrap"><i class="fa-solid fa-plus"></i> Tambah Guru</button>
                    </div>
                </div>
                <div class="flex-1 overflow-auto custom-scrollbar bg-[#0f172a]">
                    <table class="w-full text-left whitespace-nowrap">
                        <thead class="sticky top-0 bg-slate-900 z-10 text-[10px] uppercase text-slate-400 shadow-md">
                            <tr>
                                <th class="px-4 py-3 border-b border-white/10 text-center">No</th>
                                <th class="px-4 py-3 border-b border-white/10">NIP</th>
                                <th class="px-4 py-3 border-b border-white/10">Nama Guru & Jabatan</th>
                                <th class="px-4 py-3 border-b border-white/10">Akses (Mapel & Ekskul)</th>
                                <th class="px-4 py-3 border-b border-white/10">Email & Status</th>
                                <th class="px-4 py-3 border-b border-white/10 text-center">Aksi</th>
                            </tr>
                        </thead>
                        <tbody id="tbody-guru" class="text-xs text-slate-200">
                            ${generateTbodyGuru(cacheAkunGuru)}
                        </tbody>
                    </table>
                </div>
                <div class="bg-slate-800/60 px-4 py-2 border-t border-white/10 text-[10px] text-slate-400">
                    <i class="fa-solid fa-shield-halved"></i> Password disimpan terenkripsi di Supabase Auth. Gunakan <i class="fa-solid fa-key"></i> untuk reset password.
                </div>
            </div>
        `;
    } catch(e) {
        console.error("renderManajemenGuru:", e);
        container.innerHTML = `<div class="p-6 text-center text-red-400">Gagal memuat data guru: ${escapeHtml(e.message || 'Server Error')}</div>`;
    }
}

/** Escape string utk dipakai di dalam atribut onclick ber-quote tunggal. */
function escJs(s) {
    return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function generateTbodyGuru(data) {
    if (!data || data.length === 0) return `<tr><td colspan="6" class="p-6 text-center text-slate-500">Belum ada data guru. Klik "Tambah Guru" untuk membuat (akun langsung bisa login).</td></tr>`;
    return data.map((d, i) => {
        const nama = namaDenganGelar(
          d.nama_lengkap || d["Nama Guru"] || 'Tanpa Nama',
          d.gelar_depan, d.gelar_belakang
        );
        const nip = d.nis_nip || d.NIP || '-';
        const jabatan = d.jabatan || d.Jabatan || '-';
        const wali = d.wali_kelas || d["Wali Kelas"] || '';
        const mapel = d.mapel || d["Custom Teks Mata Pelajaran"] || '';
        const ekskul = d.ekstrakurikuler || d.Ekstrakurikuler || '';
        const email = d.email || d.Email || '-';
        const tertaut = !!d.user_id;
        return `
        <tr class="hover:bg-white/5 border-b border-white/5 transition row-guru">
            <td class="px-4 py-3 text-center">${i+1}</td>
            <td class="px-4 py-3 font-mono text-green-300 search-target">${nip}</td>
            <td class="px-4 py-3 search-target"><div class="font-bold text-white">${nama}</div><div class="text-[9px] text-slate-400">${jabatan}${wali ? ' | Wali: ' + wali : ''}</div></td>
            <td class="px-4 py-3 search-target">
                <div class="truncate max-w-[150px] text-[10px] text-yellow-300"><i class="fa-solid fa-book"></i> ${mapel || '-'}</div>
                <div class="truncate max-w-[150px] text-[10px] text-indigo-300"><i class="fa-solid fa-futbol"></i> ${ekskul || '-'}</div>
            </td>
            <td class="px-4 py-3 search-target"><div class="text-[10px] text-slate-400"><i class="fa-solid fa-envelope"></i> ${email}</div><div class="text-[9px] ${tertaut ? 'text-emerald-400' : 'text-amber-400'}"><i class="fa-${tertaut ? 'solid fa-circle-check' : 'regular fa-circle-question'}"></i> ${tertaut ? 'Auth aktif' : 'Belum tertaut Auth'}</div></td>
            <td class="px-4 py-3 text-center whitespace-nowrap">
                <button onclick='openFormAkunGuru(false, ${JSON.stringify(d).replace(/'/g, "&#39;")})' class="w-7 h-7 bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white rounded transition mr-1" title="Edit"><i class="fa-solid fa-pen"></i></button>
                ${tertaut ? `<button onclick="resetPasswordGuru('${escJs(d.user_id)}', '${escJs(nama)}')" class="w-7 h-7 bg-amber-600/20 hover:bg-amber-600 text-amber-400 hover:text-white rounded transition mr-1" title="Reset Password"><i class="fa-solid fa-key"></i></button>` : ''}
                <button onclick="deleteAkunGuru('${escJs(d.user_id || '')}', '${escJs(nama)}', '${escJs(d.id || '')}')" class="w-7 h-7 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded transition" title="Hapus"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>
    `; }).join('');
}

function filterTabelGuru() {
    const query = document.getElementById('search-guru').value.toLowerCase();
    const rows = document.querySelectorAll('.row-guru');
    rows.forEach(row => {
        const text = row.innerText.toLowerCase();
        row.style.display = text.includes(query) ? '' : 'none';
    });
}

function openFormAkunGuru(isNew, data = {}) {
    // 1. Ekstrak Data Unik dari Master Data (format lama & baru)
    masterDataCache = masterDataCache || [];
    const listKelas = urutAz([...new Set(masterDataCache.map(m => mdVal(m, "Tingkat/Kelas", "tingkat_kelas")).filter(Boolean))]);
    const listMapel = urutAz([...new Set(masterDataCache.map(m => mdVal(m, "Mata Pelajaran", "mata_pelajaran")).filter(Boolean))]);
    const listEkskul = urutAz(denganSto([...new Set(masterDataCache.map(m => mdVal(m, "Ekstrakurikuler", "ekstrakurikuler")).filter(Boolean))]));
    const listJabatanGuru = urutAz([...new Set(masterDataCache.map(m => mdVal(m, "Jabatan Guru", "jabatan_guru")).filter(Boolean))]);

    // 2. Nilai existing (snake_case dulu, fallback format lama)
    const namaV = data.nama_lengkap || data["Nama Guru"] || "";
    const gelarDepanV = data.gelar_depan || "";
    const gelarBelakangV = data.gelar_belakang || "";
    const nipV = data.nis_nip || data.NIP || "";
    const jabatanV = data.jabatan || data.Jabatan || "";
    const waliV = data.wali_kelas || data["Wali Kelas"] || "";
    const mapelV = data.mapel || data["Custom Teks Mata Pelajaran"] || "";
    const ekskulV = data.ekstrakurikuler || data.Ekstrakurikuler || "";
    const emailV = data.email || data.Email || "";

    // 3. Format Dropdowns (Memastikan nilai eksisting terpilih otomatis)
    const optWali = listKelas.map(k => `<option value="${escJs(k)}" ${waliV === k ? 'selected' : ''}>${k}</option>`).join('');
    const optJabatan = listJabatanGuru.map(j => `<option value="${escJs(j)}" ${jabatanV === j ? 'selected' : ''}>${j}</option>`).join('');

    // 4. Format Checkboxes untuk Mapel Diampu
    const mapelArr = mapelV.split(',').map(e => e.trim()).filter(Boolean);
    const chkMapelHTML = listMapel.map(m => `
        <label class="flex items-center gap-1.5 cursor-pointer hover:text-white bg-slate-800 p-1.5 rounded border border-white/10">
            <input type="checkbox" class="chk-mapel-form" value="${escJs(m)}" ${mapelArr.includes(m) ? 'checked' : ''}>
            <span class="truncate">${m}</span>
        </label>
    `).join('');

    // 5. Format Checkboxes untuk Pembina Ekstrakurikuler
    const ekskulArr = ekskulV.split(',').map(e => e.trim()).filter(Boolean);
    const chkEkskulHTML = listEkskul.map(e => `
        <label class="flex items-center gap-1.5 cursor-pointer hover:text-white bg-slate-800 p-1.5 rounded border border-white/10">
            <input type="checkbox" class="chk-ekskul-guru-form" value="${escJs(e)}" ${ekskulArr.includes(e) ? 'checked' : ''}>
            <span class="truncate">${e}</span>
        </label>
    `).join('');

    const formHTML = `
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left text-[11px] text-slate-300 mt-2 max-h-[65vh] overflow-y-auto custom-scrollbar p-1 pr-2">
            <div><label class="font-bold text-green-300">NIP</label><input id="f_nip" value="${escJs(nipV)}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-green-500"></div>
            <div><label class="font-bold text-green-300">Jabatan</label>
                <select id="f_jabatan_guru" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none"><option value="">-- Pilih Jabatan --</option>${optJabatan}</select>
            </div>

            <div class="col-span-1 sm:col-span-2"><label class="font-bold text-green-300">Nama Guru *</label><input id="f_nama_guru" value="${escJs(namaV)}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-green-500"></div>
            <div><label class="font-bold text-green-300">Gelar Depan</label><input id="f_gelar_depan" value="${escJs(gelarDepanV)}" placeholder="Dr. / H." class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-green-500"></div>
            <div><label class="font-bold text-green-300">Gelar Belakang</label><input id="f_gelar_belakang" value="${escJs(gelarBelakangV)}" placeholder="S.Pd., M.Pd." class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-green-500"></div>

            <div><label class="font-bold text-green-300">Wali Kelas</label>
                <select id="f_wali" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none"><option value="">-- Bukan Wali Kelas --</option>${optWali}</select>
            </div>
            <div><label class="font-bold text-green-300">Email Login *</label><input id="f_email_guru" type="email" value="${escJs(emailV)}" ${isNew ? '' : 'disabled'} class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-green-500 disabled:opacity-50"></div>

            ${isNew ? `<div><label class="font-bold text-green-300">Password *</label><input id="f_pass_guru" type="text" value="123456" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-green-500"><p class="text-[9px] text-slate-400 mt-1">Minimal 6 karakter, disimpan terenkripsi di Supabase Auth.</p></div>` : ''}

            <div class="col-span-1 sm:col-span-2">
                <label class="font-bold text-green-300 mb-1 block">Mapel Diampu (Bisa pilih lebih dari satu)</label>
                <div class="grid grid-cols-2 gap-2 bg-black/20 p-2 rounded border border-white/10 max-h-32 overflow-y-auto custom-scrollbar">
                    ${chkMapelHTML}
                </div>
            </div>

            <div class="col-span-1 sm:col-span-2">
                <label class="font-bold text-green-300 mb-1 block">Pembina Ekstrakurikuler (Bisa pilih lebih dari satu)</label>
                <div class="grid grid-cols-2 gap-2 bg-black/20 p-2 rounded border border-white/10 max-h-32 overflow-y-auto custom-scrollbar">
                    ${chkEkskulHTML}
                </div>
            </div>
        </div>
    `;

    Swal.fire({
        title: `<div class="text-lg font-bold">${isNew ? 'Tambah' : 'Edit'} Akun Guru</div>`,
        html: formHTML, width: 600, background: '#1e293b', color: '#fff',
        showCancelButton: true, confirmButtonText: '<i class="fa-solid fa-save"></i> Simpan Data',
        preConfirm: () => {
            const namaVal = document.getElementById('f_nama_guru').value.trim();
            const emailVal = document.getElementById('f_email_guru').value.trim();
            if (!namaVal) { Swal.showValidationMessage('Nama wajib diisi!'); return false; }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) { Swal.showValidationMessage('Email tidak valid!'); return false; }
            if (isNew && document.getElementById('f_pass_guru').value.trim().length < 6) {
                Swal.showValidationMessage('Password minimal 6 karakter!'); return false;
            }

            // Gabungkan checkbox mapel & ekskul yang dipilih
            const mapelChecked = [];
            document.querySelectorAll('.chk-mapel-form:checked').forEach(el => mapelChecked.push(el.value));
            const ekskulChecked = [];
            document.querySelectorAll('.chk-ekskul-guru-form:checked').forEach(el => ekskulChecked.push(el.value));

            return {
                nama_lengkap: namaVal,
                gelar_depan: document.getElementById('f_gelar_depan').value.trim(),
                gelar_belakang: document.getElementById('f_gelar_belakang').value.trim(),
                nis_nip: document.getElementById('f_nip').value.trim(),
                jabatan: document.getElementById('f_jabatan_guru').value,
                wali_kelas: document.getElementById('f_wali').value,
                mapel: mapelChecked.join(', '),
                ekstrakurikuler: ekskulChecked.join(', '),
                email: emailVal,
                password: isNew ? document.getElementById('f_pass_guru').value.trim() : undefined
            };
        }
    }).then(async (res) => {
        if (!res.isConfirmed) return;
        Swal.fire({title: 'Menyimpan...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading()});
        const payload = { action: isNew ? 'buat_akun' : 'update_akun', tipe: 'guru', ...res.value };
        if (!isNew) {
            payload.user_id = data.user_id || '';
            delete payload.password;
        }
        const hasil = await kelolaAkunAuth(payload);
        if (hasil.status === 'success') {
            Swal.fire({toast:true, position:'top-end', icon:'success', title: hasil.message || 'Tersimpan!', showConfirmButton:false, timer:2000, background: '#1e293b', color: '#fff'});
            renderManajemenGuru(document.getElementById('main-content'));
        } else {
            Swal.fire({icon:'error', title:'Gagal', text: hasil.message || 'Terjadi kesalahan.', background:'#1e293b', color:'#fff'});
        }
    });
}

/** Reset password guru via Edge Function (hash ditangani Supabase Auth). */
function resetPasswordGuru(userId, nama) {
    if (!userId) { showToast('error', 'Akun belum tertaut user Auth.'); return; }
    Swal.fire({
        title: 'Reset Password',
        html: `Password baru untuk <b>${nama}</b>:`,
        input: 'text',
        inputValue: '123456',
        inputAttributes: { autocapitalize: 'off' },
        showCancelButton: true,
        confirmButtonText: '<i class="fa-solid fa-key"></i> Reset',
        background: '#1e293b', color: '#fff',
        inputValidator: (v) => {
            if (!v || v.trim().length < 6) return 'Password minimal 6 karakter!';
            return null;
        }
    }).then(async (res) => {
        if (!res.isConfirmed) return;
        Swal.fire({title: 'Menyimpan...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading()});
        const hasil = await kelolaAkunAuth({ action: 'update_akun', user_id: userId, password: res.value.trim() });
        if (hasil.status === 'success') {
            Swal.fire({toast:true, position:'top-end', icon:'success', title:'Password direset!', showConfirmButton:false, timer:2000, background:'#1e293b', color:'#fff'});
        } else {
            Swal.fire({icon:'error', title:'Gagal', text: hasil.message || 'Terjadi kesalahan.', background:'#1e293b', color:'#fff'});
        }
    });
}

function deleteAkunGuru(userId, nama, profilId) {
    if (!userId && !profilId) { showToast('error', 'Akun tidak memiliki user_id / id profil.'); return; }
    Swal.fire({
        title: 'Yakin Hapus?', html: `Akun guru <b>${nama}</b> akan dihapus permanen dari Auth & tabel akun.`, icon: 'warning',
        background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Ya, Hapus'
    }).then(async (result) => {
        if (!result.isConfirmed) return;
        Swal.fire({title: 'Menghapus...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading()});
        const payload = { action: 'hapus_akun' };
        if (userId) payload.user_id = userId; else payload.profil_id = profilId;
        const hasil = await kelolaAkunAuth(payload);
        if (hasil.status === 'success') {
            Swal.fire({toast:true, position:'top-end', icon:'success', title:'Terhapus!', showConfirmButton:false, timer:1500, background: '#1e293b', color: '#fff'});
            renderManajemenGuru(document.getElementById('main-content'));
        } else {
            Swal.fire({icon:'error', title:'Gagal', text: hasil.message || 'Terjadi kesalahan.', background:'#1e293b', color:'#fff'});
        }
    });
}

// ============ FUNGSI PENDUKUNG (Search, CRUD) ============
function filterTabelAkun(tipe) {
    const query = document.getElementById(`search-${tipe}`).value.toLowerCase();
    const rows = document.querySelectorAll('.row-akun');
    rows.forEach(row => {
        const text = row.querySelector('.search-target').parentElement.innerText.toLowerCase();
        row.style.display = text.includes(query) ? '' : 'none';
    });
}

function openFormAkun(tipe, isNew, data = {}) {
    const isMurid = tipe === 'murid';
    
    // Ambil list kelas dari cache (jika ada)
    let klsOptions = "";
    if (typeof masterDataCache !== 'undefined' && masterDataCache.length > 0) {
        const lKelas = [...new Set(masterDataCache.map(m => m["Tingkat/Kelas"]).filter(Boolean))];
        klsOptions = lKelas.map(k => `<option value="${k}" ${data["Tingkat/Kelas"] === k ? 'selected' : ''}>${k}</option>`).join('');
    }

    let formHTML = isMurid ? `
        <div class="grid grid-cols-2 gap-3 text-left text-[11px] text-slate-300 mt-2">
            <div><label class="font-bold text-blue-300">NIS *</label><input id="f_nis" value="${data.NIS||''}" ${!isNew?'readonly':''} class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            <div><label class="font-bold text-blue-300">NISN</label><input id="f_nisn" value="${data.NISN||''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            <div class="col-span-2"><label class="font-bold text-blue-300">Nama Lengkap *</label><input id="f_nama" value="${data["Nama Lengkap"]||''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            <div><label class="font-bold text-blue-300">Tingkat/Kelas</label>
                <select id="f_kelas" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none"><option value="">-- Pilih --</option>${klsOptions}</select>
            </div>
            <div><label class="font-bold text-blue-300">Jenis Kelamin</label>
                <select id="f_jk" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none">
                    <option value="L" ${data["Jenis Kelamin"]==='L'?'selected':''}>Laki-laki</option>
                    <option value="P" ${data["Jenis Kelamin"]==='P'?'selected':''}>Perempuan</option>
                </select>
            </div>
            <div class="col-span-2"><label class="font-bold text-blue-300">Ekstrakurikuler (Pisahkan dengan koma)</label><input id="f_ekskul" value="${data.Ekstrakurikuler||''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500" placeholder="Pramuka, PMR, Futsal"></div>
            <div><label class="font-bold text-blue-300">Email Login</label><input id="f_email" type="email" value="${data.Email||''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            <div><label class="font-bold text-blue-300">Password</label><input id="f_pass" value="${data.Password||'123456'}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
        </div>
    ` : `
        <div class="grid grid-cols-2 gap-3 text-left text-[11px] text-slate-300 mt-2">
            <div class="col-span-2"><label class="font-bold text-green-300">ID Akun Guru / NIP *</label><input id="f_idguru" value="${data["ID Akun Guru"]||''}" ${!isNew?'readonly':''} class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-green-500"></div>
            <div class="col-span-2"><label class="font-bold text-green-300">Nama Guru *</label><input id="f_nama_guru" value="${data["Nama Guru"]||''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-green-500"></div>
            <div><label class="font-bold text-green-300">Jabatan</label><input id="f_jabatan" value="${data.Jabatan||'Guru'}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-green-500"></div>
            <div><label class="font-bold text-green-300">Wali Kelas</label>
                <select id="f_wali" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none"><option value="">-- Bukan Wali Kelas --</option>${klsOptions}</select>
            </div>
            <div class="col-span-2"><label class="font-bold text-green-300">Mapel Diampu (Pisahkan Koma)</label><input id="f_mapel_guru" value="${data["Custom Teks Mata Pelajaran"]||''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-green-500" placeholder="Matematika, IPA"></div>
            <div><label class="font-bold text-green-300">Pembina Ekstrakurikuler</label><input id="f_ekskul_guru" value="${data.Ekstrakurikuler||''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-green-500"></div>
            <div><label class="font-bold text-green-300">Password</label><input id="f_pass_guru" value="${data.Password||'123456'}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-green-500"></div>
        </div>
    `;

    Swal.fire({
        title: `<div class="text-lg font-bold">${isNew ? 'Tambah' : 'Edit'} Akun ${isMurid ? 'Murid' : 'Guru'}</div>`,
        html: formHTML,
        background: '#1e293b', color: '#fff',
        showCancelButton: true, confirmButtonText: '<i class="fa-solid fa-save"></i> Simpan Data',
        preConfirm: () => {
            let payload = {};
            if(isMurid) {
                payload = { "NIS": document.getElementById('f_nis').value, "NISN": document.getElementById('f_nisn').value, "Nama Lengkap": document.getElementById('f_nama').value, "Tingkat/Kelas": document.getElementById('f_kelas').value, "Jenis Kelamin": document.getElementById('f_jk').value, "Ekstrakurikuler": document.getElementById('f_ekskul').value, "Email": document.getElementById('f_email').value, "Password": document.getElementById('f_pass').value };
                if(!payload.NIS || !payload["Nama Lengkap"]) { Swal.showValidationMessage('NIS dan Nama wajib diisi!'); return false; }
            } else {
                payload = { "ID Akun Guru": document.getElementById('f_idguru').value, "Nama Guru": document.getElementById('f_nama_guru').value, "Jabatan": document.getElementById('f_jabatan').value, "Wali Kelas": document.getElementById('f_wali').value, "Custom Teks Mata Pelajaran": document.getElementById('f_mapel_guru').value, "Ekstrakurikuler": document.getElementById('f_ekskul_guru').value, "Password": document.getElementById('f_pass_guru').value };
                if(!payload["ID Akun Guru"] || !payload["Nama Guru"]) { Swal.showValidationMessage('ID Guru dan Nama wajib diisi!'); return false; }
            }
            return payload;
        }
    }).then(async (res) => {
        if(res.isConfirmed) {
            Swal.fire({title: 'Menyimpan...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading()});
            try {
                const sendData = { action: 'save_akun', tipe: tipe, isNew: isNew, data: res.value };
                const postRes = await fetch(API_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(sendData) });
                const json = await postRes.json();
                if(json.status === 'success') {
                    Swal.fire({toast:true, position:'top-end', icon:'success', title:'Tersimpan!', showConfirmButton:false, timer:1500, background: '#1e293b', color: '#fff'});
                    if(isMurid) renderManajemenMurid(document.getElementById('main-content'));
                    else renderManajemenGuru(document.getElementById('main-content'));
                } else throw new Error(json.message);
            } catch(e) { Swal.fire({icon: 'error', title: 'Gagal', text: e.message, background: '#1e293b', color: '#fff'}); }
        }
    });
}

function deleteAkun(tipe, idKey) {
    Swal.fire({
        title: 'Yakin Hapus?', text: "Data akun akan dihapus permanen dari Database (Google Sheets).", icon: 'warning',
        background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Ya, Hapus'
    }).then(async (result) => {
        if (result.isConfirmed) {
            Swal.fire({title: 'Menghapus...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading()});
            try {
               //const sendData = { action: 'delete_akun', tipe: tipe, key: idKey };
                //const postRes = await fetch(API_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(sendData) });
                const json = await postRes.json();
                if(json.status === 'success') {
                    Swal.fire({toast:true, position:'top-end', icon:'success', title:'Terhapus!', showConfirmButton:false, timer:1500, background: '#1e293b', color: '#fff'});
                    if(tipe === 'murid') renderManajemenMurid(document.getElementById('main-content'));
                    else renderManajemenGuru(document.getElementById('main-content'));
                } else throw new Error(json.message);
            } catch(e) { Swal.fire({icon: 'error', title: 'Gagal', text: e.message, background: '#1e293b', color: '#fff'}); }
        }
    });
}

function getSheetDataAsObjects(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  
  const headers = data[0];
  let result = [];
  
  for(let i=1; i<data.length; i++) {
    // PERBAIKAN: Hanya lewati jika seluruh sel dalam baris tersebut kosong
    const isRowEmpty = data[i].every(cell => cell === "");
    if(isRowEmpty) continue;
    
    let obj = {};
    headers.forEach((h, idx) => { obj[h] = data[i][idx]; });
    result.push(obj);
  }
  return result;
}

// ==========================================
// MODUL JADWAL PELAJARAN & HARI LIBUR
// ==========================================

let cacheLibur = [];
let cacheJadwal = [];
let currentTabJadwal = 'libur'; // Default tab

/**
 * Muat modul jadwal & hari libur dari server SEKALIGUS, lalu sinkronkan ke
 * liburConfigCache sehingga isHoliday()/kalendar absensi memakai data nyata.
 */
async function simpanJadwalPelajaran(dataJadwal) {
  // dataJadwal = { hari: 'Senin', mapel: 'Matematika', id_guru: 'G01', jam_mulai: '07:00' }
  // Tidak perlu menyertakan 'id' jika di Supabase ID di-generate otomatis.

  const { data, error } = await supaClient
    .from('jadwal_pelajaran')
    .insert([dataJadwal]) // Gunakan .insert() alih-alih .upsert()
    .select(); // Tambahkan .select() jika ingin mengembalikan data (beserta ID baru) yang baru saja dibuat

  if (error) {
    console.error("Gagal menambah jadwal:", error);
  } else {
    console.log("Jadwal berhasil ditambahkan dengan ID:", data[0].id);
    // Tutup modal form dan refresh UI
  }
}
async function muatDataJadwalLibur() {
  // 1. Mengambil data jadwal_libur
  const { data: dataLibur, error: errLibur } = await supaClient
    .from('jadwal_libur') 
    .select('*');

  if (errLibur) {
    console.error("Gagal memuat jadwal libur:", errLibur);
    cacheLibur = [];
  } else {
    cacheLibur = dataLibur || [];
  }

  // 2. Mengambil data jadwal_pelajaran
  const { data: dataJadwal, error: errJadwal } = await supaClient
    .from('jadwal_pelajaran') 
    .select('*');

  if (errJadwal) {
    console.error("Gagal memuat jadwal pelajaran:", errJadwal);
    cacheJadwal = [];
  } else {
    cacheJadwal = dataJadwal || [];
  }

  sinkronkanKonfigurasiLibur();
  return { libur: cacheLibur, jadwal: cacheJadwal };
}

/** Salin daftar libur server ke liburConfigCache.customList (tanggal 'yyyy-MM-dd') */
function sinkronkanKonfigurasiLibur() {
  liburConfigCache.customList = (cacheLibur || [])
    .map(l => ({
      tahun: String(l.Tahun ?? "").slice(0, 4),
      tanggal: String(l.Tanggal ?? "").slice(0, 10),
      keterangan: l.Keterangan || "",
      tipe: l.Tipe || "Umum"
    }))
    .filter(l => /^\d{4}-\d{2}-\d{2}$/.test(l.tanggal));
}

async function renderJadwalLiburModule(container) {
    container.innerHTML = `<div class="p-6 text-center text-slate-300"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>Memuat Data Jadwal & Libur...</div>`;
    
    try {
        if (masterDataCache.length === 0) {
    try {
        const { data, error } = await supaClient.from('master_data').select('*');
        if (!error && data) masterDataCache = data;
    } catch (e) {
        console.error("Gagal memuat master data", e);
    }
}

        await muatDataJadwalLibur();

        // UI Tabs & Container
        container.innerHTML = `
            <div class="glass-card rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex flex-col h-[85vh]">
                <div class="bg-slate-800/80 p-4 border-b border-white/10 flex flex-col sm:flex-row justify-between items-center gap-3">
                    <h2 class="text-sm sm:text-base font-bold text-white uppercase tracking-wider"><i class="fa-solid fa-calendar-days text-pink-400 mr-2"></i> Pengaturan Jadwal & Kalender</h2>
                    <div class="flex gap-2 w-full sm:w-auto p-1 bg-black/40 rounded-lg">
                        <button onclick="switchTabJadwal('libur')" class="tab-btn px-4 py-1.5 rounded text-xs font-bold transition ${currentTabJadwal==='libur' ? 'bg-pink-600 text-white' : 'text-slate-400 hover:text-white'}">Hari Libur</button>
                        <button onclick="switchTabJadwal('jadwal')" class="tab-btn px-4 py-1.5 rounded text-xs font-bold transition ${currentTabJadwal==='jadwal' ? 'bg-pink-600 text-white' : 'text-slate-400 hover:text-white'}">Jadwal Pelajaran</button>
                        <button onclick="switchTabJadwal('master')" class="tab-btn px-4 py-1.5 rounded text-xs font-bold transition ${currentTabJadwal==='master' ? 'bg-pink-600 text-white' : 'text-slate-400 hover:text-white'}">Master Jadwal</button>
                    </div>
                </div>
                
                <div id="content-jadwal-libur" class="flex-1 overflow-auto custom-scrollbar bg-[#0f172a]">
                    ${currentTabJadwal === 'libur' ? getHTMLHariLibur() : currentTabJadwal === 'jadwal' ? getHTMLJadwalPelajaran() : `<div class="p-6 text-center text-slate-300"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>Memuat Master Jadwal...</div>`}
                </div>
            </div>
        `;
        if (currentTabJadwal === 'master') await renderTabMasterJadwal();
    } catch(e) {
        container.innerHTML = `<div class="p-6 text-center text-red-400">Gagal memuat modul.</div>`;
    }
}

function switchTabJadwal(tabName) {
    currentTabJadwal = tabName;
    renderJadwalLiburModule(document.getElementById('main-content')); // Re-render
}

// ---------------- TAB HARI LIBUR ----------------
function getHTMLHariLibur() {
    let rows = cacheLibur.length === 0 ? `<tr><td colspan="4" class="p-4 text-center text-slate-500">Belum ada hari libur yang diatur.</td></tr>` 
    : cacheLibur.sort((a,b) => new Date(b.Tanggal) - new Date(a.Tanggal)).map((d, i) => `
        <tr class="hover:bg-white/5 border-b border-white/5 transition">
            <td class="px-4 py-3 text-center">${i+1}</td>
            <td class="px-4 py-3 font-bold text-red-400">${d.Tanggal}</td>
            <td class="px-4 py-3"><div class="font-bold text-white">${d.Keterangan}</div><div class="text-[10px] bg-red-900/50 text-red-300 px-2 py-0.5 rounded inline-block mt-1">${d.Tipe || 'Umum'}</div></td>
            <td class="px-4 py-3 text-center">
                <button onclick='openFormLibur(false, ${JSON.stringify(d).replace(/'/g, "&#39;")})' class="w-7 h-7 bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white rounded transition mr-1"><i class="fa-solid fa-pen"></i></button>
                <button onclick="deleteLibur('${d.Tanggal}')" class="w-7 h-7 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded transition"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>
    `).join('');

    return `
        <div class="p-4 flex justify-between items-center bg-red-900/10 border-b border-red-500/20">
            <p class="text-xs text-slate-400"><i class="fa-solid fa-circle-info text-red-400"></i> Tanggal yang diinput di sini akan otomatis mengunci/memerahkan tabel di menu Absensi.</p>
            <button onclick="openFormLibur(true)" class="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition shadow"><i class="fa-solid fa-plus"></i> Tambah Libur</button>
        </div>
        <table class="w-full text-left whitespace-nowrap"><thead class="bg-slate-900 text-[10px] uppercase text-slate-400"><tr><th class="px-4 py-3 text-center w-12">No</th><th class="px-4 py-3">Tanggal (YYYY-MM-DD)</th><th class="px-4 py-3">Keterangan</th><th class="px-4 py-3 text-center w-24">Aksi</th></tr></thead><tbody class="text-xs text-slate-200">${rows}</tbody></table>
    `;
}

function openFormLibur(isNew, data = {}) {
    // Format YYYY-MM-DD untuk input type=date
    let tglVal = data.Tanggal || '';
    if (tglVal && tglVal.includes('T')) tglVal = tglVal.split('T')[0];

    Swal.fire({
        title: `<div class="text-lg font-bold">${isNew ? 'Tambah' : 'Edit'} Hari Libur</div>`,
        html: `
            <div class="text-left text-[11px] text-slate-300 mt-2">
                <label class="font-bold text-red-300">Tanggal Libur *</label>
                <input type="date" id="l_tgl" value="${tglVal}" ${!isNew?'readonly':''} class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 mb-3 text-white outline-none" style="color-scheme: dark;">
                <label class="font-bold text-red-300">Keterangan (Cth: Idul Fitri) *</label>
                <input type="text" id="l_ket" value="${data.Keterangan || ''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 mb-3 text-white outline-none">
                <label class="font-bold text-red-300">Tipe Libur</label>
                <select id="l_tipe" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none"><option value="Nasional" ${data.Tipe==='Nasional'?'selected':''}>Libur Nasional</option><option value="Sekolah" ${data.Tipe==='Sekolah'?'selected':''}>Libur Khusus Sekolah</option></select>
            </div>
        `,
        background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonText: 'Simpan',
        preConfirm: () => {
            let tgl = document.getElementById('l_tgl').value;
            let ket = document.getElementById('l_ket').value.trim();
            if(!tgl || !ket) { Swal.showValidationMessage('Tanggal & Keterangan wajib diisi!'); return false; }
            return { "Tahun": tgl.split('-')[0], "Tanggal": tgl, "Keterangan": ket, "Tipe": document.getElementById('l_tipe').value };
        }
    }).then(async (res) => {
        if(res.isConfirmed) {
            Swal.fire({title: 'Menyimpan...', didOpen: () => Swal.showLoading(), background: '#1e293b', color: '#fff'});
            try {
                await fetch(API_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'save_libur', isNew: isNew, data: res.value }) });
                renderJadwalLiburModule(document.getElementById('main-content'));
                Swal.close();
            } catch(e) { Swal.fire('Error', e.message, 'error'); }
        }
    });
}

function deleteLibur(tgl) {
    Swal.fire({ title: 'Hapus Libur?', icon: 'warning', background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Ya, Hapus' })
    .then(async (res) => {
        if(res.isConfirmed) {
            await fetch(API_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'delete_libur', key: tgl }) });
            renderJadwalLiburModule(document.getElementById('main-content'));
        }
    });
}

// ---------------- TAB JADWAL PELAJARAN ----------------
function getHTMLJadwalPelajaran() {
    let rows = cacheJadwal.length === 0 ? `<tr><td colspan="5" class="p-4 text-center text-slate-500">Belum ada jadwal yang diatur.</td></tr>` 
    : cacheJadwal.map((d, i) => `
        <tr class="hover:bg-white/5 border-b border-white/5 transition">
            <td class="px-4 py-3 text-center">${i+1}</td>
            <td class="px-4 py-3 font-bold text-yellow-300">${d.Waktu}</td>
            <td class="px-4 py-3 text-white">${d["ID Akun Guru"]}</td>
            <td class="px-4 py-3"><span class="bg-indigo-900/50 text-indigo-300 px-2 py-0.5 rounded text-[10px]">${d["Tingkat/Kelas"]}</span> | ${d.Mapel}</td>
            <td class="px-4 py-3 text-center">
                <button onclick='openFormJadwal(false, ${JSON.stringify(d).replace(/'/g, "&#39;")})' class="w-7 h-7 bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white rounded transition mr-1"><i class="fa-solid fa-pen"></i></button>
                <button onclick='deleteJadwal(${JSON.stringify({guru: d["ID Akun Guru"], waktu: d.Waktu, kelas: d["Tingkat/Kelas"]}).replace(/'/g, "&#39;")})' class="w-7 h-7 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded transition"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>
    `).join('');

    return `
        <div class="p-4 flex justify-end bg-blue-900/10 border-b border-blue-500/20">
            <button onclick="openFormJadwal(true)" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition shadow"><i class="fa-solid fa-plus"></i> Tambah Jadwal</button>
        </div>
        <table class="w-full text-left whitespace-nowrap"><thead class="bg-slate-900 text-[10px] uppercase text-slate-400"><tr><th class="px-4 py-3 text-center w-12">No</th><th class="px-4 py-3">Hari & Jam</th><th class="px-4 py-3">ID Guru</th><th class="px-4 py-3">Kelas & Mapel</th><th class="px-4 py-3 text-center w-24">Aksi</th></tr></thead><tbody class="text-xs text-slate-200">${rows}</tbody></table>
    `;
}

function openFormJadwal(isNew, data = {}) {
    const listKelas = [...new Set(masterDataCache.map(m => m["Tingkat/Kelas"]).filter(Boolean))];
    const listMapel = [...new Set(masterDataCache.map(m => m["Mata Pelajaran"]).filter(Boolean))];
    const listTahun = [...new Set(masterDataCache.map(m => m["Tahun Pelajaran"]).filter(Boolean))];
    const prefJadwal = getPreferensiSesi();

    Swal.fire({
        title: `<div class="text-lg font-bold">${isNew ? 'Tambah' : 'Edit'} Jadwal</div>`,
        html: `
            <div class="text-left text-[11px] text-slate-300 mt-2 grid grid-cols-2 gap-3">
                <div class="col-span-2"><label class="font-bold text-blue-300">Waktu (Hari, Jam) *</label><input type="text" id="j_waktu" placeholder="Senin, 07:00 - 08:30" value="${data.Waktu || ''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 outline-none text-white focus:border-blue-500"></div>
                <div><label class="font-bold text-blue-300">ID Akun Guru *</label><input type="text" id="j_guru" value="${data["ID Akun Guru"] || ''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 outline-none text-white focus:border-blue-500"></div>
                <div><label class="font-bold text-blue-300">Tahun Ajaran</label><select id="j_tahun" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none">${listTahun.map(t=>`<option value="${t}" ${(data.Tahun===t || (!data.Tahun && prefJadwal.tahun===t))?'selected':''}>${t}</option>`).join('')}</select></div>
                <div><label class="font-bold text-blue-300">Kelas</label><select id="j_kelas" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none">${listKelas.map(k=>`<option value="${k}" ${data["Tingkat/Kelas"]===k?'selected':''}>${k}</option>`).join('')}</select></div>
                <div><label class="font-bold text-blue-300">Mata Pelajaran</label><select id="j_mapel" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none">${listMapel.map(m=>`<option value="${m}" ${data.Mapel===m?'selected':''}>${m}</option>`).join('')}</select></div>
            </div>
        `,
        background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonText: 'Simpan',
        preConfirm: () => {
            let guru = document.getElementById('j_guru').value.trim();
            let waktu = document.getElementById('j_waktu').value.trim();
            if(!guru || !waktu) { Swal.showValidationMessage('Guru & Waktu wajib diisi!'); return false; }
            return { "ID Akun Guru": guru, "ID Jadwal Murid": "", "Tahun": document.getElementById('j_tahun').value, "Semester": (prefJadwal.semester || "Ganjil"), "Waktu": waktu, "Mapel": document.getElementById('j_mapel').value, "Tingkat/Kelas": document.getElementById('j_kelas').value };
        }
    }).then(async (res) => {
        if(res.isConfirmed) {
            Swal.fire({title: 'Menyimpan...', didOpen: () => Swal.showLoading(), background: '#1e293b', color: '#fff'});
            try {
                let payload = { action: 'save_jadwal', isNew: isNew, data: res.value };
                if (!isNew) payload.oldKey = { guru: data["ID Akun Guru"], waktu: data.Waktu, kelas: data["Tingkat/Kelas"] };
                await fetch(API_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
                renderJadwalLiburModule(document.getElementById('main-content'));
                Swal.close();
            } catch(e) { Swal.fire('Error', e.message, 'error'); }
        }
    });
}

function deleteJadwal(keyObj) {
    Swal.fire({ title: 'Hapus Jadwal?', icon: 'warning', background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Ya, Hapus' })
    .then(async (res) => {
        if(res.isConfirmed) {
            await fetch(API_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'delete_jadwal', key: keyObj }) });
            renderJadwalLiburModule(document.getElementById('main-content'));
        }
    });
}

// ==========================================
// INTEGRASI CERDAS: KUNCI HARI LIBUR
// ==========================================
async function terapkanKunciLiburAbsensi() {
    if(cacheLibur.length === 0) {
        try {
            // Ganti menjadi:
    const { data, error } = await supaClient
      .from('jadwal_libur') // Sesuaikan dengan nama tabel di Supabase
      .select('*');

    if (error) {
      console.error("Gagal memuat jadwal_libur:", error);
    } else {
      masterDataCache = data;
    }
        } catch(e) { return; }
    }

    const mapBulan = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
    const blnIndex = mapBulan.indexOf(currentBulan) + 1;
    if(blnIndex === 0) return; 

    // Ambil tahun aktual dari currentTahun (Contoh format: "2026/2027")
    let tahunParts = currentTahun.split('/');
    let tahunAktual = (blnIndex >= 7) ? tahunParts[0] : (tahunParts[1] || tahunParts[0]);

    for (let tgl = 1; tgl <= 31; tgl++) {
        let dateStr = `${tahunAktual}-${String(blnIndex).padStart(2,'0')}-${String(tgl).padStart(2,'0')}`;
        
        let libur = cacheLibur.find(l => {
            let dbTgl = l.Tanggal;
            if (dbTgl && dbTgl.includes('T')) dbTgl = dbTgl.split('T')[0];
            return dbTgl === dateStr;
        });

        if (libur) {
            // Merahkan Header Tabel
            document.querySelectorAll('th').forEach(th => {
                if (th.innerText.trim() === String(tgl) && th.style.width === '35px') { // spesifik kolom tanggal
                    th.classList.add('bg-red-900', 'text-red-200');
                    th.title = libur.Keterangan;
                }
            });

            // Kunci Input Absensi
            if (typeof listMuridKelas !== 'undefined') {
                listMuridKelas.forEach(m => {
                    let nis = m.NIS || m.nis;
                    let inputSiswa = document.getElementById(`A_${nis}_${tgl}`);
                    if (inputSiswa) {
                        inputSiswa.disabled = true;
                        inputSiswa.value = 'L'; // Tampilkan 'L' (Libur)
                        inputSiswa.classList.add('cursor-not-allowed', 'text-red-400', 'font-extrabold', 'bg-red-900/50');
                        inputSiswa.parentElement.classList.add('bg-red-900/20'); 
                        inputSiswa.parentElement.title = `LIBUR: ${libur.Keterangan}`;
                    }
                });
            }
        }
    }
}
// ==========================================
// MODUL MENU EKSTRAKURIKULER (PROFIL & ANGGOTA, AGENDA, DISPENSASI)
// ==========================================
let currentTabEkskul = 'profil';

/** Peran akses modul Ekstrakurikuler: 'admin' | 'guru' | 'pengurus' | 'anggota' (req 1f/1g). */
function hakAksesEkskul() {
  const role = (currentUser || {}).role || '';
  if (role === 'admin') return 'admin';
  if (role === 'guru') return 'guru';
  const user = (currentUser || {}).user || {};
  if (role === 'murid' && String(user["Jabatan Kelas"] || '').match(/Ketua Ekstra|Sekretaris Ekstra/i)) return 'pengurus';
  return 'anggota';
}

/** Cek cepat: peran akses ekskul termasuk salah satu peran yang diberikan. */
function ekskulAksesTermasuk(...peran) { return peran.includes(hakAksesEkskul()); }

/** Daftar ekskul yang diikuti murid aktif (kolom Ekstrakurikuler, dipisah koma). */
function ekskulDiikutiMurid() {
  const user = (currentUser || {}).user || {};
  return urutAz(String(user["Ekstrakurikuler"] || "").split(',').map(e => e.trim()).filter(Boolean));
}

async function renderEkstrakurikulerModule(container) {
  container.innerHTML = `<div class="p-6 text-center text-slate-300"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>Memuat Modul Ekstrakurikuler...</div>`;
  try {
    if (masterDataCache.length === 0) {
      try { const { data, error } = await supaClient.from('master_data').select('*'); if (!error && data) masterDataCache = data; } catch (e) {}
    }
    const akses = hakAksesEkskul();
    let daftar = await ambilDaftarEkskul();
    // Pengurus & anggota murid hanya melihat ekskul yang diikutinya (req 1f/1g)
    if (akses === 'pengurus' || akses === 'anggota') {
      const milik = ekskulDiikutiMurid();
      daftar = daftar.filter(e => milik.includes(e));
      if (daftar.length === 0) {
        container.innerHTML = `<div class="glass-card p-8 rounded-2xl text-center text-slate-300"><i class="fa-solid fa-medal text-3xl text-yellow-400 mb-2"></i><p class="text-sm">Anda belum terdaftar sebagai anggota ekstrakurikuler manapun.</p></div>`;
        return;
      }
    }
    window.__daftarEkskul = daftar;
    if (!window.__ekskulAktif || !daftar.includes(window.__ekskulAktif)) window.__ekskulAktif = daftar[0] || '';
    if (!window.__tabEkskulInit) { currentTabEkskul = (akses === 'admin' || akses === 'guru') ? 'profil' : 'info'; window.__tabEkskulInit = true; }
    if (currentTabEkskul === 'dispensasi' && akses === 'anggota') currentTabEkskul = 'info';
    try {
      const { data } = await supaClient.from('akun').select('nis_nip, nama_lengkap, gelar_depan, gelar_belakang, no_telepon, ekstrakurikuler').in('tipe', ['guru', 'admin']);
      window.__cacheGuruEkskul = data || [];
    } catch (e) { window.__cacheGuruEkskul = []; }

    const isAdminGuru = akses === 'admin' || akses === 'guru';
    const tabBtn = (id, label, icon, tampil) => tampil ? `<button onclick="switchTabEkskul('${id}')" class="px-3 sm:px-4 py-1.5 rounded text-xs font-bold transition ${currentTabEkskul === id ? 'bg-yellow-600 text-white' : 'text-slate-400 hover:text-white'}"><i class="fa-solid ${icon} mr-1"></i> ${label}</button>` : '';

    container.innerHTML = `
      <div class="glass-card rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex flex-col h-[85vh]">
        <div class="bg-slate-800/80 p-4 border-b border-white/10 flex flex-col sm:flex-row justify-between items-center gap-3">
          <h2 class="text-sm sm:text-base font-bold text-white uppercase tracking-wider"><i class="fa-solid fa-medal text-yellow-400 mr-2"></i> Ekstrakurikuler</h2>
          <div class="flex gap-2 w-full sm:w-auto p-1 bg-black/40 rounded-lg flex-wrap justify-center">
            ${tabBtn('info', 'Info Ekskul', 'fa-circle-info', true)}
            ${tabBtn('profil', 'Profil & Anggota', 'fa-users', true)}
            ${tabBtn('agenda', 'Agenda Kegiatan', 'fa-calendar-check', true)}
            ${tabBtn('dispensasi', 'Surat Dispensasi', 'fa-file-signature', isAdminGuru || akses === 'pengurus')}
            ${isAdminGuru ? `<button onclick="bukaAbsensiEkskul()" class="px-3 sm:px-4 py-1.5 rounded text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white transition" title="Absensi Ekskul terpilih"><i class="fa-solid fa-clipboard-user mr-1"></i> Hadir Tatap Muka</button>` : ''}
            ${isAdminGuru ? `<button onclick="bukaNilaiEkskul()" class="px-3 sm:px-4 py-1.5 rounded text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition"><i class="fa-solid fa-star mr-1"></i> Nilai</button>` : ''}
          </div>
        </div>
        <div id="content-ekskul" class="flex-1 overflow-auto custom-scrollbar bg-[#0f172a]">
          <div class="p-6 text-center text-slate-300"><i class="fa-solid fa-circle-notch fa-spin"></i> Memuat...</div>
        </div>
      </div>`;
    await renderTabEkskul();
  } catch (e) {
    container.innerHTML = `<div class="p-6 text-center text-red-400">Gagal memuat modul: ${escapeHtml(e.message || '')}</div>`;
  }
}

function switchTabEkskul(tab) {
  // Anggota murid (read-only, req 1g) tidak boleh masuk tab Dispensasi
  if (tab === 'dispensasi' && hakAksesEkskul() === 'anggota') tab = 'info';
  currentTabEkskul = tab;
  renderEkstrakurikulerModule(document.getElementById('main-content'));
}
function pilihEkskulModul(ekskul) {
  const akses = hakAksesEkskul();
  if ((akses === 'pengurus' || akses === 'anggota') && !ekskulDiikutiMurid().includes(ekskul)) return showToast('error', 'Anda bukan anggota ekstrakurikuler tersebut.');
  window.__ekskulAktif = ekskul; renderTabEkskul();
}
async function renderTabEkskul() {
  if (currentTabEkskul === 'info') return renderTabInfoEkskul();
  if (currentTabEkskul === 'agenda') return renderTabAgendaEkskul();
  if (currentTabEkskul === 'dispensasi') return renderTabDispensasiEkskul();
  return renderTabProfilEkskul();
}

/** Buka Input Nilai langsung pada kategori Ekstrakurikuler + ekskul terpilih. */
function bukaNilaiEkskul() {
  if (!ekskulAksesTermasuk('admin', 'guru')) return showToast('error', 'Akses khusus pembina/guru.');
  currentKategoriNilai = "Data Nilai Eskul";
  changeMenu('nilai', 'Input Nilai');
  setTimeout(() => {
    const selK = document.getElementById('select-kategori-nilai');
    if (selK) selK.value = "Data Nilai Eskul";
    const selM = document.getElementById('select-mapel-nilai');
    if (selM && window.__ekskulAktif) selM.value = window.__ekskulAktif;
    loadDataNilai();
  }, 700);
}

/** Buka Hadir Tatap Muka langsung pada mode Ekskul terpilih (req 1a). */
function bukaAbsensiEkskul() {
  if (!ekskulAksesTermasuk('admin', 'guru')) return showToast('error', 'Akses khusus pembina/guru.');
  const ekskul = window.__ekskulAktif;
  if (!ekskul) return showToast('error', 'Pilih ekstrakurikuler dulu.');
  changeMenu('absensi', 'Hadir Tatap Muka');
  setTimeout(() => {
    const selM = document.getElementById('select-mapel');
    if (selM) {
      const val = `Ekskul|${ekskul}`;
      let ada = [...selM.options].some(o => o.value === val);
      if (!ada) {
        let grp = selM.querySelector('optgroup[label="Ekstrakurikuler"]');
        if (!grp) { grp = document.createElement('optgroup'); grp.label = 'Ekstrakurikuler'; selM.appendChild(grp); }
        const o = document.createElement('option'); o.value = val; o.textContent = ekskul; grp.appendChild(o);
      }
      selM.value = val;
      handleMapelChange();
    }
  }, 700);
}

// ---------- TAB 0: INFO EKSTRAKURIKULER (read-only, req 1e) ----------
/** Label jadwal agenda: tanggal, atau "Setiap <hari>" untuk agenda berulang (req 1d). */
function labelJadwalAgenda(r) {
  const hari = String(r.hari || '').split(',').map(h => h.trim()).filter(Boolean);
  if (hari.length > 0) return `Setiap ${hari.join(', ')}`;
  return String(r.tanggal || '').split('T')[0];
}

/** Apakah agenda berulang mingguan (berdasarkan ceklis hari)? */
function agendaBerulang(r) { return String(r.hari || '').trim() !== ''; }

/** Urutkan agenda: yang berulang di atas (urut Senin-Minggu), lalu tanggal terbaru. */
function urutkanAgendaEkskul(rows) {
  const URUT_HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
  const idxHari = (r) => {
    const h = String(r.hari || '').split(',').map(x => x.trim()).filter(Boolean)[0] || '';
    const i = URUT_HARI.indexOf(h);
    return i < 0 ? 99 : i;
  };
  const ulang = [], tgl = [];
  (rows || []).forEach(r => (agendaBerulang(r) ? ulang : tgl).push(r));
  ulang.sort((a, b) => idxHari(a) - idxHari(b));
  tgl.sort((a, b) => String(b.tanggal || '').localeCompare(String(a.tanggal || '')));
  return [...ulang, ...tgl];
}

async function renderTabInfoEkskul() {
  const box = document.getElementById('content-ekskul');
  const daftar = window.__daftarEkskul || [];
  const aktif = window.__ekskulAktif;
  const row = (cacheEkstrakurikuler || []).find(e => e.nama_ekskul === aktif) || {};
  const guruRows = window.__cacheGuruEkskul || [];
  const pembina = guruRows.find(g => g.nis_nip === (row.pembina_nip || ''));
  const pembinaNama = pembina ? namaDenganGelar(pembina.nama_lengkap, pembina.gelar_depan, pembina.gelar_belakang) : 'Belum diatur';

  box.innerHTML = `
    <div class="p-4 space-y-3">
      <div class="flex gap-2 items-center flex-wrap">
        <select id="ekskul-pilih" onchange="pilihEkskulModul(this.value)" class="bg-slate-700 border border-white/20 rounded-lg px-3 py-2 text-xs text-white outline-none">${daftar.map(e => `<option value="${escJs(e)}" ${e === aktif ? 'selected' : ''}>${escapeHtml(e)}</option>`).join('')}</select>
      </div>
      <div class="bg-white/5 border border-white/10 rounded-xl p-4 text-sm">
        <div class="font-bold text-white text-base mb-1"><i class="fa-solid fa-medal text-yellow-400"></i> ${escapeHtml(aktif || 'Belum ada ekskul')}</div>
        <p class="text-xs text-slate-300 mb-2">${escapeHtml(row.deskripsi || 'Belum ada deskripsi.')}</p>
        <p class="text-xs mb-0.5"><span class="text-slate-400 font-bold">Pembina:</span> ${escapeHtml(pembinaNama)} ${pembina ? `— ${linkWA(pembina.no_telepon || '', 'Assalamualaikum, terkait ekstrakurikuler ' + aktif + '.')}` : ''}</p>
        <p class="text-xs"><span class="text-slate-400 font-bold">Jadwal Latihan:</span> ${escapeHtml(row.jadwal || '-')}</p>
      </div>
      <div id="info-pengurus-ekskul" class="text-xs text-slate-400"><i class="fa-solid fa-circle-notch fa-spin"></i> Memuat pengurus & anggota...</div>
      <div id="info-agenda-ekskul" class="text-xs text-slate-400"><i class="fa-solid fa-circle-notch fa-spin"></i> Memuat agenda...</div>
    </div>`;

  const anggota = await ambilAnggotaEkskul(aktif);
  const pengurus = anggota.filter(a => /Ekstra/i.test(a.jabatan || ''));
  const boxP = document.getElementById('info-pengurus-ekskul');
  if (boxP) {
    const htmlPengurus = pengurus.length === 0
      ? `<i>Tidak ada pengurus ekskul (kolom jabatan siswa tidak berisi jabatan ekstra).</i>`
      : pengurus.map(p => `• ${escapeHtml(p.nama_lengkap || '-')} <span class="text-blue-300">(${escapeHtml(p.jabatan || '')})</span> <span class="text-[9px] text-indigo-300">(${escapeHtml(p.tingkat_kelas || '-')})</span> — ${linkWA(p.no_telepon || '', `Assalamualaikum, kami menghubungi ${p.nama_lengkap || ''} (${p.jabatan || ''}) ekstrakurikuler ${aktif}.`)}`).join('<br>');
    boxP.outerHTML = `<div class="bg-white/5 border border-white/10 rounded-xl p-3">
      <h3 class="text-[11px] font-bold text-yellow-300 uppercase mb-2"><i class="fa-solid fa-user-tie"></i> Pengurus & Anggota (${anggota.length})</h3>
      <div class="text-[11px] text-slate-200 leading-relaxed">${htmlPengurus}</div>
      <div class="text-[10px] text-slate-400 mt-2 italic">Total anggota aktif: ${anggota.length} siswa. Daftar lengkap tersedia di tab "Profil & Anggota".</div>
    </div>`;
  }

  let agendaRows = [];
  try {
    const { data } = await supaClient.from('agenda_ekskul').select('*').eq('ekskul', aktif).order('tanggal', { ascending: false, nullsFirst: false });
    agendaRows = data || [];
  } catch (e) {}
  const boxA = document.getElementById('info-agenda-ekskul');
  if (boxA) {
    const hariIni = new Date().toISOString().split('T')[0];
    const mendatang = urutkanAgendaEkskul(agendaRows.filter(r => agendaBerulang(r) || String(r.tanggal || '') >= hariIni)).slice(0, 5);
    boxA.outerHTML = `<div class="bg-white/5 border border-white/10 rounded-xl p-3">
      <h3 class="text-[11px] font-bold text-yellow-300 uppercase mb-2"><i class="fa-solid fa-calendar-check"></i> Agenda Terdekat</h3>
      ${mendatang.length === 0
        ? `<p class="italic text-slate-400">Belum ada agenda yang akan datang.</p>`
        : mendatang.map(r => `<div class="flex items-center gap-2 bg-slate-800/70 border border-white/10 rounded px-3 py-2 mb-1.5">
            <span class="text-[10px] text-red-300 font-bold shrink-0">${escapeHtml(labelJadwalAgenda(r))}</span>
            <span class="text-[11px] text-white font-bold">${escapeHtml(r.kegiatan)}</span>
            ${r.keterangan ? `<div class="text-[10px] text-slate-400 w-full">${escapeHtml(r.keterangan)}</div>` : ''}
          </div>`).join('')}
      <p class="text-[10px] text-slate-500 mt-2">Agenda lengkap tersedia di tab "Agenda Kegiatan".</p>
    </div>`;
  }
}

// ---------- TAB 1: PROFIL & ANGGOTA ----------
async function renderTabProfilEkskul() {
  const box = document.getElementById('content-ekskul');
  const daftar = window.__daftarEkskul || [];
  const aktif = window.__ekskulAktif;
  const akses = hakAksesEkskul();
  const isAdminGuru = akses === 'admin' || akses === 'guru';
  const bolehKelolaAnggota = isAdminGuru || akses === 'pengurus'; // Tambah Anggota (req 1f)
  const row = (cacheEkstrakurikuler || []).find(e => e.nama_ekskul === aktif) || {};
  const guruRows = window.__cacheGuruEkskul || [];
  const pembina = guruRows.find(g => g.nis_nip === (row.pembina_nip || ''));
  const pembinaNama = pembina ? namaDenganGelar(pembina.nama_lengkap, pembina.gelar_depan, pembina.gelar_belakang) : 'Belum diatur';
  // [REQ B3] Sub-ekstrakurikuler + penandaan sub anggota
  const subs = await ambilSubEkskul(aktif);
  const subMap = await ambilSubAnggota(aktif);
  const htmlSubs = subs.length
    ? `<div class="mt-2 flex flex-wrap gap-1 items-center">${subs.map(s => `<span class="text-[9px] bg-indigo-900/50 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/30"><i class="fa-solid fa-sitemap"></i> ${escapeHtml(s.nama_sub)} <b class="text-indigo-100">(${(s.anggota || []).length})</b></span>`).join('')}
       <button onclick="cetakAnggotaPerSub()" class="text-[9px] px-2 py-0.5 rounded bg-blue-600/30 hover:bg-blue-600 text-blue-200 hover:text-white transition" title="Cetak daftar anggota per Sub"><i class="fa-solid fa-print"></i> Cetak per Sub</button></div>`
    : '';

  box.innerHTML = `
    <div class="p-4 space-y-3">
      <div class="flex gap-2 items-center flex-wrap">
        <select id="ekskul-pilih" onchange="pilihEkskulModul(this.value)" class="bg-slate-700 border border-white/20 rounded-lg px-3 py-2 text-xs text-white outline-none">${daftar.map(e => `<option value="${escJs(e)}" ${e === aktif ? 'selected' : ''}>${escapeHtml(e)}</option>`).join('')}</select>
        ${isAdminGuru ? `<button onclick="formEkstrakurikuler('${escJs(aktif)}')" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition"><i class="fa-solid fa-pen"></i> Edit Profil</button>` : ''}
        ${isAdminGuru ? `<button onclick="formEkstrakurikuler('')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition"><i class="fa-solid fa-plus"></i> Tambah Ekskul</button>` : ''}
        ${bolehKelolaAnggota ? `<button onclick="formTambahAnggotaEkskul()" class="bg-teal-600 hover:bg-teal-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition"><i class="fa-solid fa-user-plus"></i> Tambah Anggota</button>` : ''}
        ${isAdminGuru ? `<button onclick="formHapusAnggotaEkskul()" class="bg-orange-600 hover:bg-orange-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition" title="Hapus sementara — tidak tercetak di export, dapat diaktifkan kembali"><i class="fa-solid fa-user-minus"></i> Hapus Anggota</button>` : ''}
        ${isAdminGuru ? `<button onclick="exportAnggotaEkskulExcel()" class="bg-green-700 hover:bg-green-600 text-white px-3 py-2 rounded-lg text-xs font-bold transition" title="Export ke Excel"><i class="fa-solid fa-file-excel"></i></button>` : ''}
        ${isAdminGuru ? `<button onclick="exportAnggotaEkskulPDF()" class="bg-red-700 hover:bg-red-600 text-white px-3 py-2 rounded-lg text-xs font-bold transition" title="Cetak PDF"><i class="fa-solid fa-file-pdf"></i></button>` : ''}
      </div>
      <div class="bg-white/5 border border-white/10 rounded-xl p-4 text-sm">
        <div class="flex items-center gap-3">
          ${row.logo_url ? `<img src="${escapeHtml(row.logo_url)}" alt="Logo" class="w-12 h-12 rounded-lg object-contain bg-white/10 border border-white/20 p-1" onerror="this.style.display='none'">` : ''}
          <div class="font-bold text-white text-base mb-1"><i class="fa-solid fa-medal text-yellow-400"></i> ${escapeHtml(aktif || 'Belum ada ekskul')}</div>
        </div>
        <p class="text-xs text-slate-300 mb-2">${escapeHtml(row.deskripsi || 'Belum ada deskripsi.')}</p>
        <p class="text-xs mb-0.5"><span class="text-slate-400 font-bold">Pembina:</span> ${escapeHtml(pembinaNama)} ${pembina ? `— ${linkWA(pembina.no_telepon || '', 'Assalamualaikum, terkait ekstrakurikuler ' + aktif + '.')}` : ''}</p>
        <p class="text-xs"><span class="text-slate-400 font-bold">Jadwal Latihan:</span> ${escapeHtml(row.jadwal || '-')}</p>
        ${htmlSubs}
      </div>
      <div id="anggota-ekskul" class="text-xs text-slate-400"><i class="fa-solid fa-circle-notch fa-spin"></i> Memuat anggota...</div>
    </div>`;
  const anggota = (await ambilAnggotaEkskul(aktif))
    .slice()
    .sort((a, b) => String(a.nama_lengkap || '').localeCompare(String(b.nama_lengkap || '')));
  // Rekap kehadiran ekskul bulan berjalan (saran tambahan no.2)
  const rekap = {};
  try {
    const now = new Date(); const y = now.getFullYear(); const mi = now.getMonth();
    const tglAwal = `${y}-${String(mi + 1).padStart(2, '0')}-01`;
    const tglAkhir = `${y}-${String(mi + 1).padStart(2, '0')}-${String(new Date(y, mi + 1, 0).getDate()).padStart(2, '0')}`;
    const { data: absenRows, error } = await supaClient.from('absensi')
      .select('nis, status').eq('mapel', aktif).eq('kelas', 'Semua Kelas')
      .gte('tanggal', tglAwal).lte('tanggal', tglAkhir);
    if (!error) (absenRows || []).forEach(a => {
      const r = rekap[a.nis] || (rekap[a.nis] = { H: 0, S: 0, I: 0, A: 0 });
      if (r[a.status] !== undefined) r[a.status]++;
    });
  } catch (e) {}
  const htmlRekap = (nis) => {
    const r = rekap[nis];
    if (!r) return `<span class="text-[9px] text-slate-500">Belum ada absensi bulan ini</span>`;
    const total = r.H + r.S + r.I + r.A;
    const pct = total > 0 ? Math.round((r.H / total) * 100) : 0;
    return `<span class="text-[9px]"><span class="text-green-400 font-bold">H:${r.H}</span> <span class="text-yellow-400">S:${r.S}</span> <span class="text-blue-300">I:${r.I}</span> <span class="text-red-400">A:${r.A}</span> <span class="text-slate-400">(${pct}%)</span></span>`;
  };
  const html = anggota.length === 0
    ? `<p class="italic p-2">Belum ada anggota aktif. Gunakan tombol "Tambah Anggota" untuk mendaftarkan siswa.</p>`
    : `<div class="bg-white/5 border border-white/10 rounded-xl p-3">
        <h3 class="text-[11px] font-bold text-yellow-300 uppercase mb-2"><i class="fa-solid fa-users"></i> Anggota Aktif (${anggota.length}) — Rekap Hadir Bulan Ini</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-1.5">
        ${anggota.map((a, i) => {
          const jb = a.jabatan || '';
          const isPengurus = /Ekstra/i.test(jb);
          const subSaya = subMap[String(a.nis_nip)] || '';
          const optSub = ['<option value="">— sub —</option>']
            .concat(subs.map(s => `<option value="${escJs(s.nama_sub)}" ${s.nama_sub === subSaya ? 'selected' : ''}>${escapeHtml(s.nama_sub)}</option>`))
            .join('');
          const ddSub = bolehKelolaAnggota && subs.length
            ? `<select onchange="setSubAnggota('${escJs(a.nis_nip)}', window.__ekskulAktif, this.value)" class="bg-slate-700 border border-white/20 rounded px-1 py-0.5 text-[9px] text-white outline-none max-w-[110px]" title="Sub-Ekstrakurikuler anggota">${optSub}</select>`
            : (subSaya ? `<span class="text-[9px] bg-indigo-900/50 text-indigo-300 px-1.5 py-0.5 rounded">${escapeHtml(subSaya)}</span>` : '');
          return `<div class="flex items-center justify-between bg-slate-800/70 border border-white/10 rounded px-2 py-1.5 gap-2">
            <div class="min-w-0">
              <div class="text-[11px] text-slate-200 truncate">${i + 1}. ${escapeHtml(a.nama_lengkap || '-')} <span class="text-[9px] text-indigo-300">(${escapeHtml(a.tingkat_kelas || '-')})</span> ${isPengurus ? `<span class="text-[9px] bg-yellow-900/50 text-yellow-300 px-1.5 py-0.5 rounded">${escapeHtml(jb)}</span>` : ''}</div>
              ${htmlRekap(a.nis_nip)}
            </div>
            <div class="flex items-center gap-1.5 shrink-0">${ddSub} ${linkWA(a.no_telepon || '', `Assalamualaikum, kami menghubungi ${a.nama_lengkap || ''} terkait kegiatan ${aktif}.`)}</div>
          </div>`;
        }).join('')}
        </div></div>`;
  const boxA = document.getElementById('anggota-ekskul');
  if (boxA) boxA.outerHTML = html;
}

// ---------- KEANGGOTAAN: GABUNG / BUANG NAMA EKSKUL PADA KOLOM SISWA ----------
/** Gabungkan nama ekskul ke string ekstrakurikuler siswa (hindari duplikat). */
function gabungEkskulSiswa(lama, ekskul) {
  const arr = String(lama || '').split(',').map(e => e.trim()).filter(Boolean);
  if (!arr.includes(ekskul)) arr.push(ekskul);
  return arr.join(',');
}

/** Buang nama ekskul dari string ekstrakurikuler siswa (hapus sementara, req 1c). */
function buangEkskulSiswa(lama, ekskul) {
  return String(lama || '').split(',').map(e => e.trim()).filter(Boolean).filter(e => e !== ekskul).join(',');
}

/** Ubah keanggotaan satu siswa pada satu ekskul; return true bila ada perubahan. */
async function terapkanKeanggotaanEkskul(nis, ekskul, tambah) {
  const { data, error } = await supaClient.from('akun')
    .select('ekstrakurikuler').eq('nis_nip', nis).eq('tipe', 'murid').maybeSingle();
  if (error) throw error;
  if (!data) return false;
  const baru = tambah ? gabungEkskulSiswa(data.ekstrakurikuler, ekskul) : buangEkskulSiswa(data.ekstrakurikuler, ekskul);
  if (baru === String(data.ekstrakurikuler || '')) return false;
  const { error: errUp } = await supaClient.from('akun')
    .update({ ekstrakurikuler: baru }).eq('nis_nip', nis).eq('tipe', 'murid');
  if (errUp) throw errUp;
  return true;
}

// ---------- TAMBAH ANGGOTA (req 1b) ----------
/** Toggle centang satu kandidat anggota pada modal Tambah Anggota. */
function toggleTambahAnggota(nis, checked) {
  window.__taTerpilih = window.__taTerpilih || new Set();
  if (checked) window.__taTerpilih.add(nis); else window.__taTerpilih.delete(nis);
  hitungTerpilihTambahAnggota();
}

/** Render ulang tabel kandidat sesuai filter ID Tahun / Kelas / pencarian. */
function renderDaftarTambahAnggota() {
  const wrap = document.getElementById('daftar-tambah-anggota');
  if (!wrap) return;
  const thn = document.getElementById('ta_tahun')?.value || '';
  const kls = document.getElementById('ta_kelas')?.value || '';
  const cari = (document.getElementById('ta_cari')?.value || '').toLowerCase();
  const ekskul = window.__ekskulAktif || '';
  const semua = window.__cacheMuridTambah || [];
  const terpilih = window.__taTerpilih || new Set();
  const filtered = semua.filter(m => {
    if (thn && (m.tahun_pelajaran || '') !== thn) return false;
    if (kls && (m.tingkat_kelas || '') !== kls) return false;
    if (cari && !String(m.nama_lengkap || '').toLowerCase().includes(cari) && !String(m.nis_nip || '').includes(cari)) return false;
    return true;
  });
  // Anggota aktif di atas, lalu nama A-Z
  filtered.sort((a, b) => {
    const aa = terpilih.has(a.nis_nip) ? 0 : 1, bb = terpilih.has(b.nis_nip) ? 0 : 1;
    return aa !== bb ? aa - bb : String(a.nama_lengkap || '').localeCompare(String(b.nama_lengkap || ''));
  });
  wrap.innerHTML = filtered.length === 0
    ? `<p class="italic text-slate-400 p-3 text-center">Tidak ada siswa cocok dengan filter.</p>`
    : `<table class="w-full text-left"><thead><tr class="text-[10px] uppercase text-yellow-300">
        <th class="p-2 border-b border-white/10 w-8">✔</th><th class="p-2 border-b border-white/10">NIS</th><th class="p-2 border-b border-white/10">Nama Lengkap</th><th class="p-2 border-b border-white/10">Kelas</th><th class="p-2 border-b border-white/10">Sub-Ekskul</th><th class="p-2 border-b border-white/10">Ekskul Sekarang</th></tr></thead>
      <tbody>${filtered.map(m => {
        const anggotaSekarang = String(m.ekstrakurikuler || '').split(',').map(e => e.trim()).filter(Boolean);
        const sudah = anggotaSekarang.includes(ekskul);
        const cek = terpilih.has(m.nis_nip);
        const subSaya = (window.__taSub || {})[m.nis_nip] || '';
        const optSub = ['<option value="">—</option>']
          .concat((window.__taSubList || []).map(n => `<option value="${escJs(n)}" ${n === subSaya ? 'selected' : ''}>${escapeHtml(n)}</option>`))
          .join('');
        return `<tr class="text-[11px] hover:bg-white/5 ${sudah ? 'bg-green-900/10' : ''}">
          <td class="p-2 border-b border-white/5 text-center"><input type="checkbox" ${cek ? 'checked' : ''} onchange="toggleTambahAnggota('${escJs(m.nis_nip)}', this.checked)" class="w-4 h-4 accent-teal-500 cursor-pointer"></td>
          <td class="p-2 border-b border-white/5 text-slate-300">${escapeHtml(m.nis_nip || '-')}</td>
          <td class="p-2 border-b border-white/5 text-white font-bold">${escapeHtml(m.nama_lengkap || '-')} ${sudah ? `<span class="text-[9px] bg-green-900/50 text-green-300 px-1.5 py-0.5 rounded ml-1">Anggota</span>` : ''}</td>
          <td class="p-2 border-b border-white/5 text-indigo-300">${escapeHtml(m.tingkat_kelas || '-')}</td>
          <td class="p-2 border-b border-white/5"><select onchange="setSubTambahAnggota('${escJs(m.nis_nip)}', this.value)" class="bg-slate-700 border border-white/20 rounded px-1 py-0.5 text-[10px] text-white outline-none max-w-[120px]">${optSub}</select></td>
          <td class="p-2 border-b border-white/5 text-slate-400">${escapeHtml(anggotaSekarang.join(', ') || '-')}</td>
        </tr>`;
      }).join('')}</tbody></table>
      <p class="text-[10px] text-slate-500 p-2 italic">Catatan: menghilangkan centang tidak menghapus anggota — gunakan tombol "Hapus Anggota". Siswa pasif (pernah dihapus) dapat dicentang kembali di sini untuk mengaktifkannya lagi.</p>`;
  const lbl = document.getElementById('ta_jumlah');
  if (lbl) lbl.textContent = filtered.length;
  hitungTerpilihTambahAnggota();
}

/** Modal Tambah Anggota: daftar siswa + filter ID Tahun & Kelas + ceklis (req 1b). */
async function formTambahAnggotaEkskul() {
  if (!ekskulAksesTermasuk('admin', 'guru', 'pengurus')) return showToast('error', 'Akses tidak diizinkan.');
  const aktif = window.__ekskulAktif;
  if (!aktif) return showToast('error', 'Pilih ekstrakurikuler dulu.');
  const anggotaSaatIni = await ambilAnggotaEkskul(aktif);
  window.__taTerpilih = new Set(anggotaSaatIni.map(a => a.nis_nip));
  // [REQ 1] Sub-Ekstrakurikuler per kandidat anggota
  const subsTersedia = await ambilSubEkskul(aktif);
  window.__taSubList = subsTersedia.map(s => s.nama_sub);
  window.__taSub = await ambilSubAnggota(aktif);
  let murid = [];
  try {
    const { data, error } = await supaClient.from('akun')
      .select('nis_nip, nama_lengkap, tingkat_kelas, tahun_pelajaran, ekstrakurikuler, jabatan, no_telepon')
      .eq('tipe', 'murid');
    if (error) throw error;
    murid = data || [];
  } catch (e) { return Swal.fire({ icon: 'error', title: 'Gagal', text: 'Gagal memuat daftar siswa: ' + (e.message || ''), background: '#1e293b', color: '#fff' }); }
  window.__cacheMuridTambah = murid;
  const listTahun = urutAz([...new Set(murid.map(m => m.tahun_pelajaran).filter(Boolean))]);
  const listKelas = urutAz([...new Set(murid.map(m => m.tingkat_kelas).filter(Boolean))]);
  Swal.fire({
    title: `<i class="fa-solid fa-user-plus text-teal-400"></i> Tambah Anggota ${escapeHtml(aktif)}`,
    html: `
      <div class="text-left text-[11px] text-slate-300 mt-2">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
          <div><label class="font-bold text-yellow-300">ID Tahun</label>
            <select id="ta_tahun" onchange="renderDaftarTambahAnggota()" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none"><option value="">-- Semua Tahun --</option>${listTahun.map(t => `<option value="${escJs(t)}">${escapeHtml(t)}</option>`).join('')}</select></div>
          <div><label class="font-bold text-yellow-300">Kelas</label>
            <select id="ta_kelas" onchange="renderDaftarTambahAnggota()" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none"><option value="">-- Semua Kelas --</option>${listKelas.map(k => `<option value="${escJs(k)}">${escapeHtml(k)}</option>`).join('')}</select></div>
          <div><label class="font-bold text-yellow-300">Cari Nama / NIS</label>
            <input id="ta_cari" oninput="renderDaftarTambahAnggota()" placeholder="Ketik nama..." class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none"></div>
        </div>
        <div class="flex items-center justify-between mb-1 flex-wrap gap-1">
          <div class="flex gap-1">
            <button type="button" onclick="pilihSemuaTambahAnggota(true)" class="bg-teal-600/30 hover:bg-teal-600 text-teal-300 hover:text-white px-2 py-1 rounded text-[10px] font-bold transition">Pilih Semua</button>
            <button type="button" onclick="pilihSemuaTambahAnggota(false)" class="bg-slate-600/30 hover:bg-slate-600 text-slate-300 hover:text-white px-2 py-1 rounded text-[10px] font-bold">Kosongkan</button>
          </div>
          <span class="text-[10px] text-slate-400">Tampil: <b id="ta_jumlah">0</b> siswa • Terpilih: <b id="ta_pilih" class="text-teal-300">0</b></span>
        </div>
        <div id="daftar-tambah-anggota" class="max-h-64 overflow-y-auto custom-scrollbar border border-white/10 rounded"></div>
      </div>`,
    width: '60rem',
    background: '#1e293b', color: '#fff', showCancelButton: true, cancelButtonText: 'Batal',
    confirmButtonText: '<i class="fa-solid fa-user-plus"></i> Jadikan Anggota',
    didOpen: () => renderDaftarTambahAnggota(),
    preConfirm: () => ({ nisList: [...(window.__taTerpilih || new Set())], subMap: { ...(window.__taSub || {}) } })
  }).then(async (res) => {
    if (!res.isConfirmed) return;
    const { nisList = [], subMap = {} } = res.value || {};
    if (nisList.length === 0) return showToast('info', 'Tidak ada siswa yang dipilih.');
    let sukses = 0, gagal = 0, pesanErr = '';
    Swal.fire({ title: 'Menyimpan anggota...', didOpen: () => Swal.showLoading(), allowOutsideClick: false, showConfirmButton: false, background: '#1e293b', color: '#fff' });
    for (const nis of nisList) {
      try { if (await terapkanKeanggotaanEkskul(nis, aktif, true)) sukses++; }
      catch (e) { gagal++; pesanErr = e.message || ''; }
    }
    // [REQ 1] Simpan penandaan Sub hanya untuk siswa yang dipilih
    const petaDipilih = {};
    nisList.forEach(n => { if (subMap[n] !== undefined) petaDipilih[n] = subMap[n]; });
    await setSubAnggotaMassal(aktif, petaDipilih);
    Swal.close();
    if (gagal > 0) showToast('error', `${sukses} anggota ditambahkan, ${gagal} gagal: ${pesanErr}`);
    else showToast('success', `${sukses} anggota ditambahkan ke ${aktif}`);
    renderTabEkskul();
  });
}

/** [REQ 1] Ubah pilihan Sub-Ekskul pada modal Tambah Anggota (di memori; disimpan saat konfirmasi). */
function setSubTambahAnggota(nis, sub) {
  window.__taSub = window.__taSub || {};
  window.__taSub[nis] = sub;
}

/** Pilih / kosongkan semua siswa pada hasil filter Tambah Anggota. */
function pilihSemuaTambahAnggota(pilih) {
  const thn = document.getElementById('ta_tahun')?.value || '';
  const kls = document.getElementById('ta_kelas')?.value || '';
  const cari = (document.getElementById('ta_cari')?.value || '').toLowerCase();
  window.__taTerpilih = window.__taTerpilih || new Set();
  (window.__cacheMuridTambah || []).forEach(m => {
    if (thn && (m.tahun_pelajaran || '') !== thn) return;
    if (kls && (m.tingkat_kelas || '') !== kls) return;
    if (cari && !String(m.nama_lengkap || '').toLowerCase().includes(cari) && !String(m.nis_nip || '').includes(cari)) return;
    if (pilih) window.__taTerpilih.add(m.nis_nip); else window.__taTerpilih.delete(m.nis_nip);
  });
  renderDaftarTambahAnggota();
  hitungTerpilihTambahAnggota();
}

/** Perbarui counter "Terpilih" pada modal Tambah Anggota. */
function hitungTerpilihTambahAnggota() {
  const el = document.getElementById('ta_pilih');
  if (el) el.textContent = (window.__taTerpilih || new Set()).size;
}

// ---------- HAPUS ANGGOTA (req 1c) ----------
/** Toggle pilihan hapus anggota pada modal Hapus Anggota. */
function toggleHapusAnggota(nis, checked) {
  window.__haTerpilih = window.__haTerpilih || new Set();
  if (checked) window.__haTerpilih.add(nis); else window.__haTerpilih.delete(nis);
  hitungTerpilihHapusAnggota();
}

function hitungTerpilihHapusAnggota() {
  const el = document.getElementById('ha_pilih');
  if (el) el.textContent = (window.__haTerpilih || new Set()).size;
}

/** Pilih / kosongkan semua anggota pada modal Hapus Anggota. */
function pilihSemuaHapusAnggota(pilih) {
  window.__haTerpilih = window.__haTerpilih || new Set();
  document.querySelectorAll('#swal2-html-container input[data-ha-nis]').forEach(cb => {
    const nis = cb.getAttribute('data-ha-nis') || '';
    if (pilih) window.__haTerpilih.add(nis); else window.__haTerpilih.delete(nis);
    cb.checked = !!pilih;
  });
  hitungTerpilihHapusAnggota();
}

/** Modal Hapus Anggota: hapus sementara (tidak tercetak di export, bisa diaktifkan kembali) — req 1c. */
async function formHapusAnggotaEkskul() {
  if (!ekskulAksesTermasuk('admin', 'guru')) return showToast('error', 'Akses khusus pembina/guru.');
  const aktif = window.__ekskulAktif;
  if (!aktif) return showToast('error', 'Pilih ekstrakurikuler dulu.');
  const anggota = await ambilAnggotaEkskul(aktif);
  if (anggota.length === 0) return showToast('info', 'Belum ada anggota untuk dihapus.');
  window.__haTerpilih = new Set();
  Swal.fire({
    title: `<i class="fa-solid fa-user-minus text-orange-400"></i> Hapus Anggota ${escapeHtml(aktif)}`,
    html: `
      <div class="text-left text-[11px] text-slate-300 mt-2">
        <p class="mb-2 bg-orange-900/20 border border-orange-500/30 rounded px-2 py-1.5 text-[10px]"><i class="fa-solid fa-circle-info text-orange-400"></i> Anggota dihapus <b>sementara</b>: tidak tercetak di export Excel/PDF & tidak muncul di absensi/nilai. Bisa diaktifkan kembali lewat tombol "Tambah Anggota".</p>
        <div class="flex items-center justify-between mb-1">
          <button type="button" onclick="pilihSemuaHapusAnggota(true)" class="bg-red-600/30 hover:bg-red-600 text-red-300 hover:text-white px-2 py-1 rounded text-[10px] font-bold">Pilih Semua</button>
          <span class="text-[10px]">Terpilih: <b id="ha_pilih" class="text-red-300">0</b> / ${anggota.length}</span>
        </div>
        <div class="max-h-64 overflow-y-auto custom-scrollbar border border-white/10 rounded">
        ${anggota.slice().sort((a, b) => String(a.nama_lengkap || '').localeCompare(String(b.nama_lengkap || ''))).map(a => `
          <label class="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 border-b border-white/5 cursor-pointer">
            <input type="checkbox" data-ha-nis="${escJs(a.nis_nip)}" onchange="toggleHapusAnggota('${escJs(a.nis_nip)}', this.checked)" class="w-4 h-4 accent-red-500 cursor-pointer">
            <span class="text-[11px] text-white">${escapeHtml(a.nama_lengkap || '-')}</span>
            <span class="text-[9px] text-indigo-300">(${escapeHtml(a.tingkat_kelas || '-')})</span>
            <span class="text-[10px] text-slate-500 ml-auto">${escapeHtml(a.nis_nip || '')}</span>
          </label>`).join('')}
        </div>
      </div>`,
    width: '34rem',
    background: '#1e293b', color: '#fff', showCancelButton: true, cancelButtonText: 'Batal',
    confirmButtonColor: '#ef4444',
    confirmButtonText: '<i class="fa-solid fa-user-minus"></i> Hapus Terpilih',
    preConfirm: () => [...(window.__haTerpilih || new Set())]
  }).then(async (res) => {
    if (!res.isConfirmed) return;
    const terpilih = res.value || [];
    if (terpilih.length === 0) return showToast('info', 'Tidak ada anggota yang dipilih.');
    let sukses = 0, gagal = 0, pesanErr = '';
    Swal.fire({ title: 'Menghapus anggota...', didOpen: () => Swal.showLoading(), showConfirmButton: false, background: '#1e293b', color: '#fff' });
    for (const nis of terpilih) {
      try { if (await terapkanKeanggotaanEkskul(nis, aktif, false)) sukses++; }
      catch (e) { gagal++; pesanErr = e.message || ''; }
    }
    Swal.close();
    if (gagal > 0) showToast('error', `${sukses} dihapus, ${gagal} gagal: ${pesanErr}`);
    else showToast('success', `${sukses} anggota dihapus sementara dari ${aktif}`);
    renderTabEkskul();
  });
}

// ---------- EXPORT DAFTAR ANGGOTA (saran tambahan no.1) ----------
function getExportHTMLAnggotaEkskul(anggota) {
  const aktif = window.__ekskulAktif || '';
  const idn = typeof barisIdentitasMaster === 'function' ? barisIdentitasMaster() : {};
  const namaSekolah = idn["Nama Sekolah"] || 'SEKOLAH';
  const alamat = idn["Alamat Sekolah"] || '';
  const th = document.getElementById('header-tahun')?.value || '';
  const namaGuru = namaDenganGelar((currentUser.user["Nama Guru"] || currentUser.user["Nama Lengkap"] || ''), currentUser.user["Gelar Depan"], currentUser.user["Gelar Belakang"]);
  return `<div style="font-family:Arial,sans-serif;color:#000;">
    <table width="100%" style="border:none;"><tr>
      <td style="text-align:center;border:none;">
        <h2 style="margin:0;">${escapeHtml(namaSekolah)}</h2>
        ${alamat ? `<div style="font-size:11px;">${escapeHtml(alamat)}</div>` : ''}
        <h3 style="margin:10px 0 2px;">DAFTAR ANGGOTA EKSTRAKURIKULER</h3>
        <div style="font-size:12px;font-weight:bold;">${escapeHtml(aktif)}${th ? ` — Tahun Pelajaran ${escapeHtml(th)}` : ''}</div>
      </td></tr></table>
    <table width="100%" style="border-collapse:collapse;margin-top:10px;">
      <thead><tr>
        <th style="border:1px solid #333;padding:4px;width:5%;">No</th>
        <th style="border:1px solid #333;padding:4px;">NIS</th>
        <th style="border:1px solid #333;padding:4px;">Nama Lengkap</th>
        <th style="border:1px solid #333;padding:4px;">Kelas</th>
        <th style="border:1px solid #333;padding:4px;">Jabatan</th>
        <th style="border:1px solid #333;padding:4px;">No HP/WA</th>
      </tr></thead>
      <tbody>${anggota.map((a, i) => `<tr>
        <td style="border:1px solid #333;padding:4px;text-align:center;">${i + 1}</td>
        <td style="border:1px solid #333;padding:4px;">${escapeHtml(a.nis_nip || '-')}</td>
        <td style="border:1px solid #333;padding:4px;">${escapeHtml(a.nama_lengkap || '-')}</td>
        <td style="border:1px solid #333;padding:4px;">${escapeHtml(a.tingkat_kelas || '-')}</td>
        <td style="border:1px solid #333;padding:4px;">${escapeHtml(a.jabatan || '-')}</td>
        <td style="border:1px solid #333;padding:4px;">${escapeHtml(a.no_telepon || '-')}</td>
      </tr>`).join('')}</tbody>
    </table>
    <table width="100%" style="border:none;margin-top:30px;"><tr>
      <td style="width:50%;border:none;"></td>
      <td style="width:50%;border:none;text-align:center;">Pembina Ekstrakurikuler<br><br><br><br><b><u>${escapeHtml(namaGuru)}</u></b></td>
    </tr></table>
  </div>`;
}

async function exportAnggotaEkskulExcel() {
  if (!ekskulAksesTermasuk('admin', 'guru')) return showToast('error', 'Akses khusus pembina/guru.');
  const aktif = window.__ekskulAktif || '';
  const anggota = await ambilAnggotaEkskul(aktif);
  if (!anggota.length) return showToast('error', 'Belum ada anggota untuk diexport.');
  const blob = new Blob([`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body>${getExportHTMLAnggotaEkskul(anggota)}</body></html>`], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `Anggota_Ekskul_${aktif}.xls`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function exportAnggotaEkskulPDF() {
  const anggota = await ambilAnggotaEkskul(window.__ekskulAktif || '');
  if (!anggota.length) return showToast('error', 'Belum ada anggota untuk dicetak.');
  const win = window.open('', '_blank');
  if (!win) return Swal.fire({ icon: 'error', title: 'Popup Diblokir', text: 'Izinkan popup untuk mencetak PDF.', background: '#1e293b', color: '#fff' });
  win.document.write(`<html><head><title>Daftar Anggota ${escapeHtml(window.__ekskulAktif || '')}</title><style>
    body { font-family: Arial, sans-serif; color: #000; margin: 20px; background: #fff; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #333; padding: 4px; font-size: 10px; }
    th { background-color: #f1f5f9; }
  </style></head><body>${getExportHTMLAnggotaEkskul(anggota)}</body></html>`);
  win.document.close(); win.focus();
  setTimeout(() => { win.print(); }, 600);
}

// ---------- [REQ B3] SUB-EKSTRAKURIKULER (SATU TABEL: sub_ekstrakurikuler + anggota JSONB) ----------
let cacheSubEkskul = {};

/** Daftar sub-ekstrakurikuler untuk satu ekskul (cached). anggota = array NIS. */
async function ambilSubEkskul(ekskul) {
  if (!ekskul) return [];
  if (cacheSubEkskul[ekskul]) return cacheSubEkskul[ekskul];
  try {
    const { data, error } = await supaClient.from('sub_ekstrakurikuler')
      .select('*').eq('ekskul', ekskul).order('urutan').order('nama_sub');
    cacheSubEkskul[ekskul] = (!error && data) ? data : [];
  } catch (e) { cacheSubEkskul[ekskul] = []; }
  return cacheSubEkskul[ekskul];
}

function namaSubEkskul(ekskul) {
  return (cacheSubEkskul[ekskul] || []).map(s => s.nama_sub);
}

/** Sinkronkan daftar sub satu ekskul dengan UPSET-BY-NAME:
 *  baris yang tetap ada TIDAK disentuh (keanggotaan aman), baru di-insert, yang dihapus di-delete. */
async function simpanSubEkskul(ekskul, daftarSub) {
  const lama = await ambilSubEkskul(ekskul);
  const baru = [...new Set((daftarSub || []).map(s => s.trim()).filter(Boolean))];
  const namaLama = new Set(lama.map(s => s.nama_sub));
  const namaBaru = new Set(baru);
  // Hapus sub yang dihilangkan
  const dihapus = lama.filter(s => !namaBaru.has(s.nama_sub));
  for (const s of dihapus) {
    const del = await supaClient.from('sub_ekstrakurikuler').delete().eq('id', s.id);
    if (del.error) throw del.error;
  }
  // Tambah sub baru
  const tambahan = baru.filter(n => !namaLama.has(n));
  if (tambahan.length) {
    const mulaiUrut = lama.length + 1;
    const ins = await supaClient.from('sub_ekstrakurikuler')
      .insert(tambahan.map((nama, i) => ({ ekskul, nama_sub: nama, urutan: mulaiUrut + i, anggota: [] })));
    if (ins.error) throw ins.error;
  }
  delete cacheSubEkskul[ekskul];
  return baru;
}

/** Penandaan sub anggota: map nis → sub (dibaca dari array anggota tiap baris sub). */
async function ambilSubAnggota(ekskul) {
  const subs = await ambilSubEkskul(ekskul);
  const map = {};
  subs.forEach(s => (s.anggota || []).forEach(nis => { map[String(nis)] = s.nama_sub; }));
  return map;
}

/** Simpan sub satu anggota: keluarkan dari sub lain, masukkan ke sub tujuan (update per baris). */
async function setSubAnggota(nis, ekskul, sub) {
  const subs = await ambilSubEkskul(ekskul);
  const key = String(nis);
  try {
    for (const row of subs) {
      const arr = (row.anggota || []).map(String);
      const ada = arr.includes(key);
      const target = row.nama_sub === sub;
      if (ada && !target) {
        const sisa = arr.filter(n => n !== key);
        const { error } = await supaClient.from('sub_ekstrakurikuler').update({ anggota: sisa }).eq('id', row.id);
        if (error) throw error;
      } else if (!ada && target) {
        const { error } = await supaClient.from('sub_ekstrakurikuler').update({ anggota: [...arr, key] }).eq('id', row.id);
        if (error) throw error;
      }
    }
    return true;
  } catch (e) { showToast('error', 'Gagal menyimpan sub: ' + (e.message || '')); return false; }
}

/** Simpan seluruh peta sub anggota sekaligus (dipakai Tambah Anggota massal).
 *  petaSub = { nis: subTujuan } — nis tanpa entri dibiarkan di sub asalnya. */
async function setSubAnggotaMassal(ekskul, petaSub) {
  const subs = await ambilSubEkskul(ekskul);
  const peta = petaSub || {};
  try {
    for (const row of subs) {
      const arrLama = (row.anggota || []).map(String);
      // Pertahankan anggota yang tidak disebut dalam peta, atau yang memang menuju sub ini
      let arrBaru = arrLama.filter(n => peta[n] === undefined || peta[n] === row.nama_sub);
      // Tambahkan siswa yang dipetakan ke sub ini
      Object.entries(peta).forEach(([nis, sub]) => { if (sub && sub === row.nama_sub && !arrBaru.includes(String(nis))) arrBaru.push(String(nis)); });
      arrBaru = [...new Set(arrBaru)];
      if (JSON.stringify(arrLama) !== JSON.stringify(arrBaru)) {
        const { error } = await supaClient.from('sub_ekstrakurikuler').update({ anggota: arrBaru }).eq('id', row.id);
        if (error) throw error;
      }
    }
    return true;
  } catch (e) { showToast('error', 'Gagal menyimpan sub: ' + (e.message || '')); return false; }
}

/** [REQ 13b] Cetak daftar anggota per Sub-Ekstrakurikuler (PDF, satu halaman per sub). */
async function cetakAnggotaPerSub() {
  const aktif = window.__ekskulAktif;
  if (!aktif) return showToast('error', 'Pilih ekstrakurikuler dulu.');
  const subs = await ambilSubEkskul(aktif);
  if (!subs.length) return showToast('info', 'Belum ada Sub-Ekstrakurikuler pada ekskul ini.');
  const anggota = (await ambilAnggotaEkskul(aktif)).slice()
    .sort((a, b) => String(a.nama_lengkap || '').localeCompare(String(b.nama_lengkap || ''), 'id'));
  const subMap = await ambilSubAnggota(aktif);
  const idn = barisIdentitasMaster();
  const win = window.open('', '_blank');
  if (!win) return Swal.fire({ icon: 'error', title: 'Popup Diblokir', text: 'Izinkan popup untuk mencetak.', background: '#1e293b', color: '#fff' });
  const kop = `<div style="border-bottom:3px double #000;margin-bottom:12px;padding-bottom:6px;text-align:center;">
      <div style="font-size:15px;font-weight:bold;text-transform:uppercase;">${escapeHtml(idn["Nama Sekolah"] || 'SEKOLAH')}</div>
      ${idn["Alamat Sekolah"] ? `<div style="font-size:10px;">${escapeHtml(idn["Alamat Sekolah"])}</div>` : ''}
      <div style="font-size:12px;font-weight:bold;margin-top:2px;">DAFTAR ANGGOTA EKSTRAKURIKULER ${escapeHtml(String(aktif).toUpperCase())}</div>
    </div>`;
  const tabel = (judul, list) => `
    <div style="page-break-after:always;">
      <h3 style="font-size:12px;margin:4px 0 6px;">SUB: ${escapeHtml(judul)} <span style="font-weight:normal;">— ${list.length} anggota</span></h3>
      ${list.length === 0 ? '<p style="font-size:11px;font-style:italic;">Belum ada anggota pada sub ini.</p>' : `
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead><tr><th style="border:1px solid #000;padding:4px;width:6%;">No</th><th style="border:1px solid #000;padding:4px;">Nama Lengkap</th><th style="border:1px solid #000;padding:4px;">NIS</th><th style="border:1px solid #000;padding:4px;">Kelas</th></tr></thead>
        <tbody>${list.map((a, i) => `<tr><td style="border:1px solid #000;padding:3px 5px;text-align:center;">${i + 1}</td><td style="border:1px solid #000;padding:3px 5px;">${escapeHtml(a.nama_lengkap || '-')}</td><td style="border:1px solid #000;padding:3px 5px;text-align:center;">${escapeHtml(a.nis_nip || '-')}</td><td style="border:1px solid #000;padding:3px 5px;text-align:center;">${escapeHtml(a.tingkat_kelas || '-')}</td></tr>`).join('')}</tbody>
      </table>`}
    </div>`;
  let html = kop;
  subs.forEach(s => { html += tabel(s.nama_sub, anggota.filter(a => subMap[String(a.nis_nip)] === s.nama_sub)); });
  html += tabel('Tanpa Sub', anggota.filter(a => !subMap[String(a.nis_nip)]));
  win.document.write(`<html><head><title>Anggota ${escapeHtml(aktif)} per Sub</title><style>@page{size:A4;margin:15mm;}body{font-family:'Times New Roman',serif;color:#000;background:#fff;padding:20px;font-size:12px;}table{border-collapse:collapse;}</style></head><body>${html}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 700);
}

function formEkstrakurikuler(namaLama) {
  if (!ekskulAksesTermasuk('admin', 'guru')) return showToast('error', 'Akses khusus pembina/guru.');
  const isEdit = !!namaLama;
  const row = (cacheEkstrakurikuler || []).find(e => e.nama_ekskul === namaLama) || { deskripsi: '', pembina_nip: '', jadwal: '', logo_url: '' };
  const guruRows = window.__cacheGuruEkskul || [];
  Swal.fire({
    title: `${isEdit ? 'Edit' : 'Tambah'} Ekstrakurikuler`,
    width: '560px',
    html: `
      <div class="text-left text-[11px] text-slate-300 mt-2">
        <label class="font-bold text-yellow-300">Nama Ekstrakurikuler *</label>
        <input id="ex_nama" value="${escJs(isEdit ? namaLama : '')}" ${isEdit ? 'readonly' : ''} class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 mb-3 text-white outline-none">
        <label class="font-bold text-yellow-300">Deskripsi</label>
        <textarea id="ex_desk" rows="2" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 mb-3 text-white outline-none">${escapeHtml(row.deskripsi || '')}</textarea>
        <label class="font-bold text-yellow-300">Pembina</label>
        <select id="ex_pembina" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 mb-3 text-white outline-none"><option value="">-- Pilih Guru --</option>${guruRows.map(g => `<option value="${escJs(g.nis_nip)}" ${row.pembina_nip === g.nis_nip ? 'selected' : ''}>${escapeHtml(namaDenganGelar(g.nama_lengkap, g.gelar_depan, g.gelar_belakang))}</option>`).join('')}</select>
        <label class="font-bold text-yellow-300">Jadwal Latihan</label>
        <input id="ex_jadwal" value="${escJs(row.jadwal || '')}" placeholder="Cth: Sabtu, 07.00-09.00" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 mb-3 text-white outline-none">
        <label class="font-bold text-yellow-300">Logo URL Ekstrakurikuler</label>
        <input id="ex_logo" value="${escJs(row.logo_url || '')}" placeholder="https://... (tampil di kop surat dispensasi)" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 mb-3 text-white outline-none">
        <label class="font-bold text-yellow-300">Sub-Ekstrakurikuler</label>
        <div id="ex-sub-rows" class="space-y-1"></div>
        <button type="button" onclick="tambahBarisSubEkskul()" class="mt-1 text-[10px] px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white transition"><i class="fa-solid fa-plus"></i> Tambah Sub</button>
        <p class="text-[9px] text-slate-500 mt-1 italic">Cth: "Paskibra" → Sub: "Bendera", "Bendera Putih". Dipakai untuk pengelompokan anggota & lampiran surat dispensasi.</p>
      </div>`,
    background: '#1e293b', color: '#fff', showCancelButton: true, cancelButtonText: 'Batal',
    confirmButtonText: '<i class="fa-solid fa-save"></i> Simpan',
    didOpen: async () => {
      // Isi baris sub yang sudah tersimpan
      const subs = isEdit ? await ambilSubEkskul(namaLama) : [];
      (subs.map(s => s.nama_sub).length ? subs.map(s => s.nama_sub) : ['']).forEach(n => tambahBarisSubEkskul(n));
    },
    preConfirm: () => ({
      nama_ekskul: document.getElementById('ex_nama').value.trim(),
      deskripsi: document.getElementById('ex_desk').value.trim(),
      pembina_nip: document.getElementById('ex_pembina').value,
      jadwal: document.getElementById('ex_jadwal').value.trim(),
      logo_url: document.getElementById('ex_logo').value.trim(),
      subs: [...document.querySelectorAll('#ex-sub-rows input')].map(i => i.value.trim()).filter(Boolean)
    })
  }).then(async (res) => {
    if (!res.isConfirmed) return;
    const d = res.value;
    if (!d.nama_ekskul) { showToast('error', 'Nama ekstrakurikuler wajib diisi.'); return; }
    try {
      const sudahAda = (cacheEkstrakurikuler || []).some(e => e.nama_ekskul === d.nama_ekskul);
      const payload = { nama_ekskul: d.nama_ekskul, deskripsi: d.deskripsi, pembina_nip: d.pembina_nip, jadwal: d.jadwal, logo_url: d.logo_url };
      if (sudahAda) {
        const { error } = await supaClient.from('ekstrakurikuler').update(payload).eq('nama_ekskul', d.nama_ekskul);
        if (error) throw error;
      } else {
        const { error } = await supaClient.from('ekstrakurikuler').insert(payload);
        if (error) throw error;
      }
      await simpanSubEkskul(d.nama_ekskul, d.subs);
      showToast('success', 'Ekstrakurikuler tersimpan');
      window.__ekskulAktif = d.nama_ekskul;
      renderEkstrakurikulerModule(document.getElementById('main-content'));
    } catch (e) { Swal.fire({ icon: 'error', title: 'Gagal', text: e.message || '', background: '#1e293b', color: '#fff' }); }
  });
}

/** Tambah satu baris input sub-ekskul pada dialog Edit/Tambah Ekskul. */
function tambahBarisSubEkskul(nilai = '') {
  const wrap = document.getElementById('ex-sub-rows');
  if (!wrap) return;
  const row = document.createElement('div');
  row.className = 'flex gap-1 items-center';
  row.innerHTML = `
    <input type="text" value="${escJs(nilai)}" placeholder="Nama Sub-Ekstrakurikuler" class="flex-1 bg-black/40 border border-white/20 rounded px-2 py-1 text-[10px] text-white outline-none">
    <button type="button" class="w-7 h-7 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded transition" title="Hapus sub" onclick="this.closest('div').remove()"><i class="fa-solid fa-trash text-[9px]"></i></button>`;
  wrap.appendChild(row);
}

// ---------- TAB 2: AGENDA KEGIATAN ----------
async function renderTabAgendaEkskul() {
  const box = document.getElementById('content-ekskul');
  const daftar = window.__daftarEkskul || [];
  const aktif = window.__ekskulAktif;
  const akses = hakAksesEkskul();
  const bolehKelola = akses === 'admin' || akses === 'guru' || akses === 'pengurus';
  const bolehHapus = akses === 'admin' || akses === 'guru';
  box.innerHTML = `
    <div class="p-4 space-y-3">
      <div class="flex gap-2 items-center flex-wrap">
        <select id="ekskul-pilih" onchange="pilihEkskulModul(this.value)" class="bg-slate-700 border border-white/20 rounded-lg px-3 py-2 text-xs text-white outline-none">${daftar.map(e => `<option value="${escJs(e)}" ${e === aktif ? 'selected' : ''}>${escapeHtml(e)}</option>`).join('')}</select>
        ${bolehKelola ? `<button onclick="formAgendaEkskul(true)" class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition"><i class="fa-solid fa-plus"></i> Tambah Kegiatan</button>` : ''}
        <button onclick="shareAgendaEkskulWA()" class="bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition"><i class="fa-brands fa-whatsapp"></i> Bagikan WA</button>
      </div>
      <div id="list-agenda-ekskul" class="text-xs text-slate-400"><i class="fa-solid fa-circle-notch fa-spin"></i> Memuat agenda...</div>
    </div>`;
  const { data: rows, error } = await supaClient.from('agenda_ekskul').select('*').eq('ekskul', aktif).order('tanggal', { ascending: false, nullsFirst: false });
  const lb = document.getElementById('list-agenda-ekskul');
  if (!lb) return;
  const urut = urutkanAgendaEkskul(rows || []);
  lb.outerHTML = error || !urut.length
    ? `<p class="italic p-2">${error ? 'Gagal memuat agenda: ' + escapeHtml(error.message) : 'Belum ada agenda kegiatan.'}</p>`
    : `<div class="bg-white/5 border border-white/10 rounded-xl p-3"><h3 class="text-[11px] font-bold text-yellow-300 uppercase mb-2"><i class="fa-solid fa-calendar-check"></i> Agenda ${escapeHtml(aktif)} (${urut.length})</h3>
       ${urut.map(r => `<div class="flex items-center justify-between bg-slate-800/70 border border-white/10 rounded px-3 py-2 mb-1.5">
          <div><span class="text-[10px] font-bold ${agendaBerulang(r) ? 'text-yellow-300' : 'text-red-300'}">${escapeHtml(labelJadwalAgenda(r))}</span> — <span class="text-[11px] text-white font-bold">${escapeHtml(r.kegiatan)}</span> ${r.keterangan ? `<div class="text-[10px] text-slate-400">${escapeHtml(r.keterangan)}</div>` : ''}</div>
          <div class="flex gap-1">
            ${bolehKelola ? `<button onclick='popupBroadcastAgenda(${JSON.stringify(r).replace(/'/g, "&#39;")})' class="w-6 h-6 bg-green-600/20 hover:bg-green-600 text-green-400 rounded transition" title="Broadcast WA ke anggota/ortu"><i class="fa-brands fa-whatsapp text-[9px]"></i></button>` : ''}
            ${bolehKelola ? `<button onclick='formAgendaEkskul(false, ${JSON.stringify(r).replace(/'/g, "&#39;")})' class="w-6 h-6 bg-blue-600/20 hover:bg-blue-600 text-blue-400 rounded transition" title="Edit"><i class="fa-solid fa-pen text-[9px]"></i></button>` : ''}
            ${bolehHapus ? `<button onclick="hapusAgendaEkskul('${escJs(r.id)}')" class="w-6 h-6 bg-red-600/20 hover:bg-red-600 text-red-400 rounded transition" title="Hapus"><i class="fa-solid fa-trash text-[9px]"></i></button>` : ''}
          </div></div>`).join('')}</div>`;
}

/** Normalisasi nomor HP untuk link WA (0/62). */
function normNoWA(no) {
  const a = String(no || '').replace(/\D/g, '');
  return a.startsWith('0') ? '62' + a.slice(1) : a;
}

/** [REQ 13c] Broadcast WA: pengingat kegiatan agenda ke anggota/ortu (pesan dapat diedit). */
async function popupBroadcastAgenda(data) {
  const aktif = data.ekskul || window.__ekskulAktif;
  const jadwal = typeof labelJadwalAgenda === 'function' ? labelJadwalAgenda(data) : (data.hari || data.tanggal || '-');
  const defaultTeks = `*PENGINGAT KEGIATAN ${String(aktif || '').toUpperCase()}*\nKegiatan: ${data.kegiatan || '-'}\nJadwal: ${jadwal}\n${data.keterangan ? `Keterangan: ${data.keterangan}\n` : ''}\nMohon perhatian dan dukungannya. Terima kasih.`;
  const anggota = (await ambilAnggotaEkskul(aktif)).slice().sort((a, b) => String(a.nama_lengkap || '').localeCompare(String(b.nama_lengkap || ''), 'id'));
  const penerima = anggota.filter(a => normNoWA(a.no_telepon));
  const tombol = penerima.slice(0, 60).map(a =>
    `<button onclick="window.open('https://wa.me/${normNoWA(a.no_telepon)}?text=' + encodeURIComponent(document.getElementById('bc_teks').value), '_blank')" class="text-[9px] px-2 py-1 rounded bg-green-600/30 hover:bg-green-600 text-green-200 hover:text-white transition m-0.5">${escapeHtml(a.nama_lengkap || a.nis_nip)}</button>`).join('');
  Swal.fire({
    title: `<i class="fa-brands fa-whatsapp text-green-400"></i> Broadcast WA — ${escapeHtml(data.kegiatan || '')}`,
    width: '640px',
    html: `
      <div class="text-left text-[11px] text-slate-300">
        <label class="text-[10px] font-bold text-yellow-300">Pesan (dapat diedit)</label>
        <textarea id="bc_teks" rows="8" class="w-full bg-black/40 border border-white/20 rounded p-2 mt-1 text-[11px] text-white outline-none">${escapeHtml(defaultTeks)}</textarea>
        ${tombol ? `<div class="mt-2"><div class="text-[10px] text-slate-400 mb-1">Kirim ke anggota/ortu (${penerima.length} nomor tersimpan — klik nama):</div>${tombol}</div>` : '<p class="text-[10px] text-slate-500 mt-2 italic">Tidak ada nomor HP tersimpan pada anggota ekskul ini.</p>'}
      </div>`,
    background: '#1e293b', color: '#fff', showCancelButton: true, cancelButtonText: 'Tutup',
    confirmButtonText: '<i class="fa-solid fa-copy"></i> Salin Teks',
    preConfirm: () => document.getElementById('bc_teks').value
  }).then(async (res) => {
    if (res.isConfirmed && res.value && navigator.clipboard) {
      try { await navigator.clipboard.writeText(res.value); showToast('success', 'Teks tersalin'); } catch (e) {}
    }
  });
}

/** Nonaktifkan input Tanggal saat ceklis "Setiap Hari" aktif (req 1d). */
function onChangeAgendaHari(cek) {
  const tgl = document.getElementById('ag_tgl');
  if (tgl) { tgl.disabled = cek; if (cek) tgl.value = ''; }
  const wrap = document.getElementById('ag_tgl_wrap');
  if (wrap) wrap.classList.toggle('opacity-40', cek);
}

/** Kumpulkan ceklis hari (Senin-Minggu) dari form agenda. */
function hitungAgendaHari() {
  return ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']
    .filter(h => document.getElementById(`ag_hari_${h}`)?.checked);
}

function formAgendaEkskul(isNew, data = {}) {
  if (!ekskulAksesTermasuk('admin', 'guru', 'pengurus')) return showToast('error', 'Akses tidak diizinkan.');
  const aktif = window.__ekskulAktif;
  if (!aktif) { showToast('error', 'Pilih ekstrakurikuler dulu.'); return; }
  const tgl = data.tanggal ? String(data.tanggal).split('T')[0] : '';
  const hariTersimpan = String(data.hari || '').split(',').map(h => h.trim()).filter(Boolean);
  const chkHari = (h) => hariTersimpan.includes(h) ? 'checked' : '';
  Swal.fire({
    title: `${isNew ? 'Tambah' : 'Edit'} Kegiatan ${aktif}`,
    html: `<div class="text-left text-[11px] text-slate-300 mt-2">
      <label class="font-bold text-yellow-300">Tanggal <span class="text-slate-400 font-normal">(kosongkan bila memakai jadwal berulang)</span></label>
      <div id="ag_tgl_wrap" class="${hariTersimpan.length > 0 ? 'opacity-40' : ''}"><input type="date" id="ag_tgl" value="${tgl}" ${hariTersimpan.length > 0 ? 'disabled' : ''} style="color-scheme: dark;" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none disabled:bg-slate-800"></div>
      <div class="mt-2 mb-3"><label class="font-bold text-yellow-300">atau Setiap Hari (Senin-Minggu)</label>
        <div class="flex flex-wrap gap-2 mt-1 bg-black/40 border border-white/20 rounded px-2 py-2">
          ${['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'].map(h => `<label class="flex items-center gap-1 text-[10px] cursor-pointer"><input type="checkbox" id="ag_hari_${h}" ${chkHari(h)} onchange="onChangeAgendaHari(hitungAgendaHari().length > 0)" class="w-3.5 h-3.5 accent-yellow-500 cursor-pointer"> ${h}</label>`).join('')}
        </div></div>
      <label class="font-bold text-yellow-300">Kegiatan *</label><input id="ag_keg" value="${escJs(data.kegiatan || '')}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 mb-3 text-white outline-none">
      <label class="font-bold text-yellow-300">Keterangan</label><textarea id="ag_ket" rows="2" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none">${escapeHtml(data.keterangan || '')}</textarea></div>`,
    background: '#1e293b', color: '#fff', showCancelButton: true, cancelButtonText: 'Batal',
    confirmButtonText: '<i class="fa-solid fa-save"></i> Simpan',
    preConfirm: () => {
      const hari = hitungAgendaHari();
      return { tanggal: document.getElementById('ag_tgl').value, hari: hari.join(','), kegiatan: document.getElementById('ag_keg').value.trim(), keterangan: document.getElementById('ag_ket').value.trim() };
    }
  }).then(async (res) => {
    if (!res.isConfirmed) return;
    const d = res.value;
    if (!d.tanggal && !d.hari) { showToast('error', 'Isi Tanggal ATAU ceklis "Setiap Hari" (minimal satu).'); return; }
    if (!d.kegiatan) { showToast('error', 'Kegiatan wajib diisi.'); return; }
    try {
      const payload = {
        ekskul: aktif,
        tanggal: d.hari ? null : d.tanggal,
        hari: d.hari,
        kegiatan: d.kegiatan,
        keterangan: d.keterangan,
        dibuat_oleh: (currentUser.user["ID Akun Guru"] || currentUser.user["NIP"] || '')
      };
      const { error } = isNew ? await supaClient.from('agenda_ekskul').insert(payload)
        : await supaClient.from('agenda_ekskul').update(payload).eq('id', data.id);
      if (error) throw error;
      showToast('success', 'Agenda tersimpan');
      renderTabEkskul();
    } catch (e) { Swal.fire({ icon: 'error', title: 'Gagal', text: e.message || '', background: '#1e293b', color: '#fff' }); }
  });
}

async function hapusAgendaEkskul(id) {
  if (!ekskulAksesTermasuk('admin', 'guru')) return showToast('error', 'Akses khusus pembina/guru.');
  const konf = await Swal.fire({ title: 'Hapus agenda ini?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Ya, Hapus', cancelButtonText: 'Batal', background: '#1e293b', color: '#fff' });
  if (!konf.isConfirmed) return;
  const { error } = await supaClient.from('agenda_ekskul').delete().eq('id', id);
  if (error) return Swal.fire({ icon: 'error', title: 'Gagal', text: error.message, background: '#1e293b', color: '#fff' });
  showToast('success', 'Agenda terhapus');
  renderTabEkskul();
}

async function shareAgendaEkskulWA() {
  const aktif = window.__ekskulAktif;
  if (!aktif) { showToast('error', 'Pilih ekstrakurikuler dulu.'); return; }
  const { data: rows, error } = await supaClient.from('agenda_ekskul').select('*').eq('ekskul', aktif).order('tanggal', { ascending: false, nullsFirst: false });
  if (error) return showToast('error', error.message);
  let text = `*AGENDA KEGIATAN ${aktif.toUpperCase()}*`;
  urutkanAgendaEkskul(rows || []).slice(0, 15).forEach(r => { text += `\n\n📅 ${labelJadwalAgenda(r)} — ${r.kegiatan}${r.keterangan ? `\n   ${r.keterangan}` : ''}`; });
  if (!(rows || []).length) text += `\n\nBelum ada agenda.`;
  text += `\n\n_Dikirim oleh pengurus/pembina ekstrakurikuler._`;
  Swal.fire({
    title: '<i class="fa-brands fa-whatsapp text-green-400"></i> Preview Pesan',
    html: `<textarea id="wa_agenda" class="w-full h-48 bg-black/40 border border-white/20 rounded p-2 text-xs text-white outline-none">${escapeHtml(text)}</textarea>`,
    background: '#1e293b', color: '#fff', showCancelButton: true, cancelButtonText: 'Batal',
    confirmButtonText: '<i class="fa-brands fa-whatsapp"></i> Kirim via WA',
    preConfirm: () => document.getElementById('wa_agenda').value
  }).then((res) => { if (res.isConfirmed) window.open(`https://wa.me/?text=${encodeURIComponent(res.value || text)}`, '_blank'); });
}

// ---------- TAB 3: SURAT DISPENSASI ----------
// ==================== [REQ B1/B2/B3] SURAT DISPENSASI EKSTRAKURIKULER ====================
// ==================== [REQ 1-13] SURAT DISPENSASI EKSTRAKURIKULER ====================
async function renderTabDispensasiEkskul() {
  if (hakAksesEkskul() === 'anggota') return renderTabInfoEkskul();
  const box = document.getElementById('content-ekskul');
  const daftar = window.__daftarEkskul || [];
  const aktif = window.__ekskulAktif;
  const akses = hakAksesEkskul();
  const bolehHapus = akses === 'admin' || akses === 'guru';
  window.__dpTerpilih = window.__dpTerpilih || [];
  window.__dpEditId = '';

  const inp = (id, label, ph = '', type = 'text', extra = '') => `<div ${extra}><label class="text-slate-400 font-bold">${label}</label><input type="${type}" id="${id}" placeholder="${escapeHtml(ph)}" ${type === 'date' ? 'style="color-scheme: dark;"' : ''} class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 text-white outline-none"></div>`;

  box.innerHTML = `
    <div class="p-4 space-y-3">
      <div class="bg-white/5 border border-white/10 rounded-xl p-3">
        <div class="flex items-center justify-between gap-2 flex-wrap mb-2">
          <h3 class="text-[11px] font-bold text-yellow-300 uppercase"><i class="fa-solid fa-file-signature"></i> Buat Surat Dispensasi</h3>
          <span id="dp-edit-badge" style="display:none" class="text-[10px] px-2 py-1 rounded bg-orange-900/50 text-orange-300 border border-orange-500/40"></span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
          <div><label class="text-slate-400 font-bold">Ekstrakurikuler</label><select id="dp_ekskul" onchange="pilihEkskulModul(this.value)" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 text-white outline-none">${daftar.map(e => `<option value="${escJs(e)}" ${e === aktif ? 'selected' : ''}>${escapeHtml(e)}</option>`).join('')}</select></div>
          <div><label class="text-slate-400 font-bold">Siswa (anggota)</label>
            <button onclick="popupSiswaDispensasi()" class="w-full bg-slate-700 hover:bg-slate-600 border border-white/20 rounded px-2 py-1.5 text-white text-left outline-none flex items-center justify-between gap-2">
              <span id="dp_siswa_label"><i class="fa-solid fa-users text-yellow-300"></i> Pilih Siswa (anggota)</span>
              <i class="fa-solid fa-chevron-down text-[9px] text-slate-400"></i>
            </button>
          </div>
          ${inp('dp_tgl_dari', 'Tanggal Izin (KBM) — Dari', '', 'date')}
          ${inp('dp_tgl_sampai', 'Sampai (opsional)', '', 'date')}
          ${inp('dp_tgl_tambahan', 'Dan tanggal lain (opsional)', 'Cth: 20 September 2026; 25 September 2026')}
          <div class="sm:col-span-2"><label class="text-slate-400 font-bold">Preset Surat <span class="text-slate-500 font-normal">(menyimpan isian, isi surat & pilihan siswa)</span></label>
            <div class="flex gap-1 flex-wrap">
              <select id="sp_preset" onchange="terapkanPresetDispensasi(this.value)" class="flex-1 min-w-[160px] bg-slate-700 border border-white/20 rounded px-2 py-1.5 text-white outline-none"><option value="">-- Pilih Preset --</option></select>
              <button onclick="simpanPresetDispensasi()" class="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1.5 rounded text-[10px] font-bold transition" title="Simpan isian saat ini sebagai preset"><i class="fa-solid fa-save"></i></button>
              <button onclick="duplikatPresetDispensasi()" class="bg-teal-600 hover:bg-teal-700 text-white px-2 py-1.5 rounded text-[10px] font-bold transition" title="Duplikat preset terpilih"><i class="fa-solid fa-copy"></i></button>
              <button onclick="renamePresetDispensasi()" class="bg-indigo-600/40 hover:bg-indigo-600 text-indigo-200 hover:text-white px-2 py-1.5 rounded text-[10px] font-bold transition" title="Rename preset terpilih"><i class="fa-solid fa-i-cursor"></i></button>
              <button onclick="hapusPresetDispensasi()" class="bg-red-600/30 hover:bg-red-600 text-red-300 hover:text-white px-2 py-1.5 rounded text-[10px] font-bold transition" title="Hapus preset terpilih"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
          <div>
            <label class="text-slate-400 font-bold">Nomor Surat</label>
            <div class="flex gap-1">
              <input id="sp_nomor" placeholder="Cth: 001/DIS/PRIPSMI/IX/2026" class="flex-1 bg-black/40 border border-white/20 rounded px-2 py-1.5 text-white outline-none">
              <button onclick="pakaiNomorOtomatis()" class="bg-indigo-600/40 hover:bg-indigo-600 text-indigo-200 hover:text-white px-2 py-1.5 rounded text-[9px] font-bold transition whitespace-nowrap" title="Buat nomor otomatis dari format"><i class="fa-solid fa-wand-magic-sparkles"></i> Otomatis</button>
            </div>
            <input id="sp_nomor_fmt" value="${escJs(fmtNomorEkskul(aktif))}" placeholder="Format: {URUT}/DIS/{EKSKUL}/{BULAN_ROMAWI}/{TAHUN}" class="w-full bg-black/20 border border-white/10 rounded px-2 py-1 mt-1 text-[9px] text-slate-400 outline-none" oninput="simpanFmtNomorEkskul()">
            <div class="text-[8px] text-slate-500 mt-0.5">Placeholder: {URUT} {EKSKUL} {BULAN} {BULAN_ROMAWI} {TAHUN} — urut dihitung dari riwayat bulan &amp; tahun surat.</div>
          </div>
          ${inp('sp_perihal', 'Perihal', 'Cth: Dispensasi Kegiatan Ekstrakurikuler')}
          ${inp('sp_kegiatan', 'Nama Kegiatan', 'Cth: Lomba Paskibra Tingkat Kota')}
          ${inp('sp_tempat', 'Tempat Kegiatan', 'Cth: Lapangan Merdeka')}
          ${inp('sp_waktu', 'Hari, Tanggal, Waktu', 'Cth: Sabtu-Minggu, 12-13 September 2026, 07.00-16.00 WIB')}
          ${inp('sp_kota', 'Kota', 'Cth: Bandung')}
          ${inp('sp_tgl_surat', 'Tanggal Pembuatan Surat', '', 'date')}
          ${inp('sp_keterangan', 'Keterangan', 'Cth: Wajib membawa perlengkapan latihan (opsional)')}
        </div>
        <div class="mt-2">
          <label class="text-slate-400 font-bold text-[11px]">Isi Surat <span class="text-slate-500 font-normal">(otomatis tersusun; dapat diedit — tersimpan di preset)</span>
            <button onclick="regenIsiDispensasi(true)" class="ml-1 text-[9px] px-1.5 py-0.5 rounded bg-blue-600/40 hover:bg-blue-600 text-blue-200 hover:text-white transition" title="Susun ulang dari template"><i class="fa-solid fa-rotate"></i> Susun Ulang</button>
          </label>
          <textarea id="sp_isi" rows="9" oninput="this.dataset.auto='0'" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-[11px] text-white outline-none leading-relaxed"></textarea>
        </div>
        <div class="mt-2">
          <label class="text-slate-400 font-bold text-[11px]">Tanda Tangan Pembina Ekstrakurikuler</label>
          <div id="sp_ttd_rows" class="space-y-1 mt-1"></div>
          <button onclick="tambahTtdDispensasi()" class="mt-1 text-[9px] px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white transition"><i class="fa-solid fa-plus"></i> Tambah Pembina (jika lebih)</button>
        </div>
        <div class="flex gap-2 mt-3 flex-wrap">
          <button onclick="buatSuratDispensasi('pdf')" class="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition"><i class="fa-solid fa-print"></i> Buat Surat & Simpan (PDF)</button>
          <button onclick="buatSuratDispensasi('wa')" class="bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition"><i class="fa-brands fa-whatsapp"></i> Kirim WA Ortu</button>
          <button onclick="buatSuratDispensasi('excel')" class="bg-green-700 hover:bg-green-600 text-white px-3 py-2 rounded-lg text-xs font-bold transition"><i class="fa-solid fa-file-excel"></i> Excel Lampiran</button>
        </div>
      </div>
      <div id="riwayat-dispensasi" class="text-xs text-slate-400"><i class="fa-solid fa-circle-notch fa-spin"></i> Memuat riwayat...</div>
    </div>`;

  // [REQ 8] Tanggal pembuatan surat default hari ini
  const tglSuratEl = document.getElementById('sp_tgl_surat');
  if (tglSuratEl && !tglSuratEl.value) tglSuratEl.value = new Date().toISOString().slice(0, 10);
  // Format nomor tersimpan per ekskul (localStorage)
  const fmtEl = document.getElementById('sp_nomor_fmt');
  if (fmtEl) fmtEl.addEventListener('input', () => regenIsiDispensasi(false));

  await muatPresetDispensasi(aktif);
  renderLabelSiswaDispensasi();
  regenIsiDispensasi(true);
  await refreshRiwayatDispensasi();
}

/** Segarkan HANYA segmen riwayat (draft form tidak disentuh — REQ 6). */
async function refreshRiwayatDispensasi() {
  const aktif = window.__ekskulAktif;
  const akses = hakAksesEkskul();
  const bolehHapus = akses === 'admin' || akses === 'guru';
  const lb = document.getElementById('riwayat-dispensasi');
  if (!lb) return;
  try {
    const { data: rows, error } = await supaClient.from('dispensasi').select('*').eq('ekskul', aktif).order('created_at', { ascending: false }).limit(60);
    lb.outerHTML = error || !(rows || []).length
      ? `<p class="italic p-2">${error ? 'Gagal memuat riwayat: ' + escapeHtml(error.message) : 'Belum ada riwayat dispensasi.'}</p>`
      : `<div class="bg-white/5 border border-white/10 rounded-xl p-3"><h3 class="text-[11px] font-bold text-yellow-300 uppercase mb-2">Riwayat Dispensasi (terbaru)</h3>${renderRiwayatDispensasi(rows || [], bolehHapus)}</div>`;
  } catch (e) { lb.outerHTML = `<p class="italic p-2">Gagal memuat riwayat.</p>`; }
}

/** Kelompokkan baris riwayat per surat_id (satu surat = banyak siswa) + tombol Edit/Cetak/Hapus. */
function renderRiwayatDispensasi(rows, bolehHapus) {
  const grup = {};
  rows.forEach(r => {
    const key = r.surat_id || r.id;
    (grup[key] = grup[key] || []).push(r);
  });
  return Object.entries(grup).slice(0, 15).map(([key, list]) => {
    const pertama = list[0];
    const detail = pertama.detail || {};
    const nomor = detail.nomor || '-';
    const tgl = String(pertama.tanggal_izin || '').split('T')[0];
    return `<div class="flex items-center justify-between bg-slate-800/70 border border-white/10 rounded px-3 py-2 mb-1.5">
      <div class="text-[11px]">
        <span class="text-red-300 font-bold">${escapeHtml(tgl)}</span> — <span class="text-white font-bold">No. ${escapeHtml(String(nomor))}</span> <span class="text-yellow-300">[${escapeHtml(pertama.ekskul)}]</span>
        <div class="text-slate-400 text-[10px]">${list.length} siswa: ${escapeHtml(list.map(s => s.nama || s.nis).slice(0, 5).join(', '))}${list.length > 5 ? ', ...' : ''}</div>
      </div>
      <div class="flex gap-1">
        <button onclick='editSuratDispensasi("${escJs(key)}")' class="w-6 h-6 bg-orange-600/20 hover:bg-orange-600 text-orange-400 rounded transition" title="Edit surat"><i class="fa-solid fa-pen text-[9px]"></i></button>
        <button onclick='cetakUlangDispensasi("${escJs(key)}")' class="w-6 h-6 bg-blue-600/20 hover:bg-blue-600 text-blue-400 rounded transition" title="Cetak ulang surat"><i class="fa-solid fa-print text-[9px]"></i></button>
        ${bolehHapus ? `<button onclick="hapusDispensasi('${escJs(key)}')" class="w-6 h-6 bg-red-600/20 hover:bg-red-600 text-red-400 rounded transition" title="Hapus surat"><i class="fa-solid fa-trash text-[9px]"></i></button>` : ''}
      </div>
    </div>`;
  }).join('');
}

/** Tambah baris TTD pembina (nama + NIP). */
function tambahTtdDispensasi(nama = '', nip = '') {
  const wrap = document.getElementById('sp_ttd_rows');
  if (!wrap) return;
  const row = document.createElement('div');
  row.className = 'flex gap-1 items-center';
  row.innerHTML = `
    <input type="text" data-role="nama" value="${escJs(nama)}" placeholder="Nama Pembina (bergelar)" class="flex-1 bg-black/40 border border-white/20 rounded px-2 py-1 text-[10px] text-white outline-none">
    <input type="text" data-role="nip" value="${escJs(nip)}" placeholder="NIP" class="w-32 bg-black/40 border border-white/20 rounded px-2 py-1 text-[10px] text-white outline-none">
    <button type="button" class="w-7 h-7 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded transition" title="Hapus baris TTD" onclick="this.closest('div').remove()"><i class="fa-solid fa-trash text-[9px]"></i></button>`;
  wrap.appendChild(row);
}

/** [REQ B1] Popup pilih siswa (anggota): checkbox per sub, ceklis massal, keterangan massal/per siswa. */
async function popupSiswaDispensasi() {
  const aktif = window.__ekskulAktif || document.getElementById('dp_ekskul')?.value || '';
  if (!aktif) return showToast('error', 'Pilih ekstrakurikuler dulu.');
  const terpilihSebelum = window.__dpTerpilih || [];
  const mapLama = {}; terpilihSebelum.forEach(t => { mapLama[t.nis] = t; });

  const anggota = (await ambilAnggotaEkskul(aktif)).slice().sort((a, b) => String(a.nama_lengkap || '').localeCompare(String(b.nama_lengkap || ''), 'id'));
  if (!anggota.length) return Swal.fire({ icon: 'info', title: 'Belum ada anggota', text: 'Tambahkan anggota terlebih dahulu di tab Profil.', background: '#1e293b', color: '#fff' });
  const subs = await ambilSubEkskul(aktif);
  const subMap = await ambilSubAnggota(aktif);

  // Kelompokkan anggota per sub (tanpa sub → "Tanpa Sub")
  const grup = { '': [] };
  (subs.map(s => s.nama_sub)).forEach(n => { grup[n] = []; });
  anggota.forEach(a => {
    const sub = subMap[String(a.nis_nip)] || '';
    (grup[sub] ? grup[sub] : grup['']).push(a);
  });

  const barisSiswa = (a) => {
    const t = mapLama[String(a.nis_nip)] || {};
    const optSub = ['<option value="">— sub —</option>']
      .concat(subs.map(s => `<option value="${escJs(s.nama_sub)}" ${s.nama_sub === (t.sub || subMap[String(a.nis_nip)] || '') ? 'selected' : ''}>${escapeHtml(s.nama_sub)}</option>`))
      .join('');
    return `<div class="flex items-center gap-2 bg-slate-800/70 border border-white/10 rounded px-2 py-1.5 mb-1 dp-siswa-row" data-nis="${escJs(a.nis_nip)}">
      <input type="checkbox" class="dp-check accent-yellow-500 w-4 h-4" data-nis="${escJs(a.nis_nip)}" ${t.nis ? 'checked' : ''}>
      <div class="min-w-0 flex-1">
        <div class="text-[11px] text-slate-200 truncate">${escapeHtml(a.nama_lengkap || '-')} <span class="text-[9px] text-indigo-300">(${escapeHtml(a.tingkat_kelas || '-')})</span></div>
        <input type="text" data-role="ket" value="${escapeHtml(t.ket || '')}" placeholder="Keterangan siswa ini (opsional)" class="w-full bg-black/40 border border-white/10 rounded px-1.5 py-0.5 mt-0.5 text-[9px] text-white outline-none">
      </div>
      <select data-role="sub" class="bg-slate-700 border border-white/20 rounded px-1 py-0.5 text-[9px] text-white outline-none max-w-[110px]" title="Sub-Ekstrakurikuler">${optSub}</select>
    </div>`;
  };

  const grupHTML = Object.entries(grup).map(([sub, list]) => list.length === 0 ? '' : `
    <div class="mb-2">
      <div class="flex items-center justify-between mb-1">
        <span class="text-[10px] font-bold ${sub ? 'text-indigo-300' : 'text-slate-400'}"><i class="fa-solid fa-sitemap"></i> ${escapeHtml(sub || 'Tanpa Sub')} (${list.length})</span>
        <button onclick="ceklisGrupDispensasi(this, ${JSON.stringify(list.map(a => String(a.nis_nip))).replace(/"/g, '&quot;')}, true)" class="text-[9px] px-2 py-0.5 rounded bg-yellow-600/30 hover:bg-yellow-600 text-yellow-200 hover:text-white transition">Ceklis Semua</button>
      </div>
      ${list.map(barisSiswa).join('')}
    </div>`).join('');

  Swal.fire({
    title: `<div class="text-sm font-bold text-yellow-300"><i class="fa-solid fa-users"></i> Pilih Siswa — ${escapeHtml(aktif)}</div>`,
    width: '620px',
    html: `
      <div class="text-left text-[11px] text-slate-300">
        <div class="flex gap-1 mb-2 flex-wrap">
          <button onclick="ceklisSemuaDispensasi(true)" class="text-[9px] px-2 py-1 rounded bg-green-600 hover:bg-green-700 text-white transition"><i class="fa-solid fa-check-double"></i> Ceklis Semua Siswa</button>
          <button onclick="ceklisSemuaDispensasi(false)" class="text-[9px] px-2 py-1 rounded bg-red-600/30 hover:bg-red-600 text-red-200 hover:text-white transition"><i class="fa-solid fa-eraser"></i> Hapus Ceklis</button>
        </div>
        <div class="bg-black/30 border border-white/10 rounded p-2 mb-2">
          <label class="text-[10px] font-bold text-yellow-300">Keterangan Massal (terisi ke semua tercentang yang kosong)</label>
          <input type="text" id="dp_ket_massal" placeholder="Cth: Mengikuti latihan rutin" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1 mt-1 text-[10px] text-white outline-none">
        </div>
        <div class="max-h-[42vh] overflow-auto custom-scrollbar pr-1">${grupHTML}</div>
      </div>`,
    background: '#1e293b', color: '#fff',
    showCancelButton: true, cancelButtonText: 'Batal',
    confirmButtonText: '<i class="fa-solid fa-check"></i> Gunakan Pilihan',
    preConfirm: () => {
      const ketMassal = document.getElementById('dp_ket_massal')?.value.trim() || '';
      const hasil = [];
      document.querySelectorAll('.dp-siswa-row').forEach(row => {
        const chk = row.querySelector('.dp-check');
        if (!chk || !chk.checked) return;
        let ket = row.querySelector('[data-role="ket"]')?.value.trim() || '';
        if (!ket && ketMassal) ket = ketMassal;
        hasil.push({ nis: row.dataset.nis, sub: row.querySelector('[data-role="sub"]')?.value || '', ket });
      });
      return hasil;
    }
  }).then(async (res) => {
    if (!res.isConfirmed) return;
    let hasil = res.value || [];
    const byNis = {}; anggota.forEach(a => { byNis[String(a.nis_nip)] = a; });
    hasil = hasil.map(h => {
      const a = byNis[h.nis] || {};
      return { nis: h.nis, nama: a.nama_lengkap || h.nis, kelas: a.tingkat_kelas || '', sub: h.sub || '', ket: h.ket || '', no: a.no_telepon || '' };
    });
    window.__dpTerpilih = hasil;
    renderLabelSiswaDispensasi();
    // Persist pilihan sub anggota (perubahan di popup tersimpan)
    await setSubAnggotaMassal(aktif, Object.fromEntries(hasil.map(h => [h.nis, h.sub])));
    regenIsiDispensasi(false);
    showToast('success', `${hasil.length} siswa dipilih`);
  });
}

/** Ceklis/hapus ceklis satu grup sub (di dalam popup). */
function ceklisGrupDispensasi(btn, nisListJson, ceklis) {
  const list = JSON.parse(nisListJson);
  list.forEach(nis => {
    const chk = document.querySelector(`.dp-check[data-nis="${CSS.escape(nis)}"]`);
    if (chk) chk.checked = ceklis;
  });
}

/** Ceklis/hapus ceklis seluruh siswa (di dalam popup). */
function ceklisSemuaDispensasi(ceklis) {
  document.querySelectorAll('.dp-check').forEach(c => { c.checked = ceklis; });
}

/** Perbarui label tombol "Siswa (anggota)" pada form utama. */
function renderLabelSiswaDispensasi() {
  const el = document.getElementById('dp_siswa_label');
  const n = (window.__dpTerpilih || []).length;
  if (el) el.innerHTML = n > 0
    ? `<i class="fa-solid fa-user-check text-green-400"></i> ${n} siswa dipilih <span class="text-[9px] text-slate-400">(klik untuk ubah)</span>`
    : `<i class="fa-solid fa-users text-yellow-300"></i> Pilih Siswa (anggota)`;
}

// ---------- [REQ 13a] NOMOR SURAT OTOMATIS (format dapat diedit) ----------
const ROMAWI = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function fmtNomorEkskul(ekskul) {
  try { return (JSON.parse(localStorage.getItem('sisip_fmt_nomor_ekskul') || '{}'))[ekskul] || '{URUT}/DIS/{EKSKUL}/{BULAN_ROMAWI}/{TAHUN}'; }
  catch (e) { return '{URUT}/DIS/{EKSKUL}/{BULAN_ROMAWI}/{TAHUN}'; }
}

function simpanFmtNomorEkskul() {
  const aktif = window.__ekskulAktif || '';
  const fmt = document.getElementById('sp_nomor_fmt')?.value.trim();
  if (!aktif || !fmt) return;
  try {
    const all = JSON.parse(localStorage.getItem('sisip_fmt_nomor_ekskul') || '{}');
    all[aktif] = fmt;
    localStorage.setItem('sisip_fmt_nomor_ekskul', JSON.stringify(all));
  } catch (e) {}
}

/** Susun nomor surat otomatis: urut = jumlah surat ekskul pada bulan+tahun tanggal surat + 1. */
async function pakaiNomorOtomatis() {
  const aktif = document.getElementById('dp_ekskul')?.value || window.__ekskulAktif || '';
  const fmt = document.getElementById('sp_nomor_fmt')?.value.trim() || '{URUT}/DIS/{EKSKUL}/{BULAN_ROMAWI}/{TAHUN}';
  const tgl = document.getElementById('sp_tgl_surat')?.value || new Date().toISOString().slice(0, 10);
  const [thn, bln] = tgl.split('-');
  let urut = 1;
  try {
    const { data } = await supaClient.from('dispensasi').select('surat_id, tanggal_izin').eq('ekskul', aktif);
    const kunci = `${thn}-${bln}`;
    const grup = new Set((data || []).filter(r => String(r.tanggal_izin || '').startsWith(kunci)).map(r => r.surat_id || r.id));
    urut = grup.size + 1;
  } catch (e) {}
  const urutPad = String(urut).padStart(3, '0');
  const nomor = fmt
    .replaceAll('{URUT}', urutPad)
    .replaceAll('{EKSKUL}', String(aktif).toUpperCase())
    .replaceAll('{BULAN_ROMAWI}', ROMAWI[parseInt(bln, 10)] || bln)
    .replaceAll('{BULAN}', bln)
    .replaceAll('{TAHUN}', thn);
  const el = document.getElementById('sp_nomor');
  if (el) el.value = nomor;
  showToast('success', `Nomor otomatis: ${nomor}`);
}

// ---------- PRESET SURAT (REQ 4/5/9: simpan+siswa, duplikat, rename, hapus) ----------
async function muatPresetDispensasi(ekskul) {
  const sel = document.getElementById('sp_preset');
  if (!sel) return;
  let rows = [];
  try {
    const { data, error } = await supaClient.from('preset_dispensasi').select('id, ekskul, nama_preset');
    rows = (!error && data) ? data.filter(r => r.ekskul === ekskul || !r.ekskul) : [];
  } catch (e) { rows = []; }
  sel.innerHTML = '<option value="">-- Pilih Preset --</option>' +
    rows.map(r => `<option value="${escJs(r.nama_preset)}" data-ekskul="${escJs(r.ekskul)}">${escapeHtml(r.nama_preset)}${r.ekskul ? '' : ' (Global)'}</option>`).join('');
}

/** Baca seluruh isian form surat (untuk preset & pembuatan surat). */
function kumpulkanDetailSuratDispensasi() {
  const ttd = [];
  document.querySelectorAll('#sp_ttd_rows > div').forEach(row => {
    const nama = row.querySelector('[data-role="nama"]')?.value.trim() || '';
    const nip = row.querySelector('[data-role="nip"]')?.value.trim() || '';
    if (nama || nip) ttd.push({ nama, nip });
  });
  const dari = document.getElementById('dp_tgl_dari')?.value || '';
  const sampai = document.getElementById('dp_tgl_sampai')?.value || '';
  const tambahan = document.getElementById('dp_tgl_tambahan')?.value.trim() || '';
  let tanggalTeks = dari || '';
  if (sampai) tanggalTeks += tanggalTeks ? ` s.d. ${sampai}` : sampai;
  if (tambahan) tanggalTeks += tanggalTeks ? `, ${tambahan}` : tambahan;
  const isiEl = document.getElementById('sp_isi');
  return {
    ekskul: document.getElementById('dp_ekskul')?.value || window.__ekskulAktif || '',
    tanggal: dari, tanggalDari: dari, tanggalSampai: sampai, tanggalTambahan: tambahan, tanggalTeks,
    nomor: document.getElementById('sp_nomor')?.value.trim() || '',
    perihal: document.getElementById('sp_perihal')?.value.trim() || '',
    kegiatan: document.getElementById('sp_kegiatan')?.value.trim() || '',
    tempat: document.getElementById('sp_tempat')?.value.trim() || '',
    waktu: document.getElementById('sp_waktu')?.value.trim() || '',
    kota: document.getElementById('sp_kota')?.value.trim() || '',
    tglSurat: document.getElementById('sp_tgl_surat')?.value || '',
    keterangan: document.getElementById('sp_keterangan')?.value.trim() || '',
    isi_surat: isiEl ? isiEl.value : '',
    isiAuto: isiEl ? isiEl.dataset.auto !== '0' : true,
    ttd
  };
}

/** Susun ulang teks isi surat dari template (REQ 11). force=true menimpa edit manual. */
function regenIsiDispensasi(force = false) {
  const isiEl = document.getElementById('sp_isi');
  if (!isiEl) return;
  if (!force && isiEl.dataset.auto === '0') return; // manual edit dipertahankan
  const detail = kumpulkanDetailSuratDispensasi();
  const subUnik = [...new Set((window.__dpTerpilih || []).map(s => (s.sub || '').trim()).filter(Boolean))];
  isiEl.value = isiSuratDispensasi(detail, subUnik.join(', '));
  isiEl.dataset.auto = '1';
}

async function terapkanPresetDispensasi(namaPreset) {
  if (!namaPreset) return;
  const ekskul = document.getElementById('dp_ekskul')?.value || window.__ekskulAktif || '';
  try {
    const { data, error } = await supaClient.from('preset_dispensasi')
      .select('isi').eq('ekskul', ekskul).eq('nama_preset', namaPreset).maybeSingle();
    if (error || !data) throw (error || new Error('Preset tidak ditemukan.'));
    const isi = data.isi || {};
    const setV = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined && v !== null) el.value = v; };
    setV('sp_nomor', isi.nomor); setV('sp_perihal', isi.perihal); setV('sp_kegiatan', isi.kegiatan);
    setV('sp_tempat', isi.tempat); setV('sp_waktu', isi.waktu); setV('sp_kota', isi.kota);
    setV('sp_tgl_surat', isi.tglSurat); setV('sp_keterangan', isi.keterangan);
    setV('dp_tgl_dari', isi.tanggalDari); setV('dp_tgl_sampai', isi.tanggalSampai); setV('dp_tgl_tambahan', isi.tanggalTambahan);
    if (isi.isi_surat) {
      const isiEl = document.getElementById('sp_isi');
      if (isiEl) { isiEl.value = isi.isi_surat; isiEl.dataset.auto = '0'; }
    } else {
      regenIsiDispensasi(true);
    }
    if (Array.isArray(isi.ttd) && isi.ttd.length) {
      const wrap = document.getElementById('sp_ttd_rows');
      if (wrap) { wrap.innerHTML = ''; isi.ttd.forEach(t => tambahTtdDispensasi(t.nama, t.nip)); }
    }
    // [REQ 4] Pilihan siswa tersimpan di preset → dipulihkan
    if (Array.isArray(isi.siswa)) {
      window.__dpTerpilih = isi.siswa;
      renderLabelSiswaDispensasi();
    }
    showToast('success', `Preset "${namaPreset}" diterapkan${Array.isArray(isi.siswa) ? ` (${isi.siswa.length} siswa)` : ''}`);
  } catch (e) { showToast('error', e.message || 'Gagal memuat preset.'); }
}

async function simpanPresetDispensasi() {
  const ekskul = document.getElementById('dp_ekskul')?.value || window.__ekskulAktif || '';
  const detail = kumpulkanDetailSuratDispensasi();
  const res = await Swal.fire({
    title: 'Simpan Preset Surat',
    input: 'text',
    inputLabel: 'Nama Preset (menyimpan nama sama = edit isi preset)',
    inputValue: document.getElementById('sp_preset')?.value || '',
    showCancelButton: true, cancelButtonText: 'Batal',
    confirmButtonText: '<i class="fa-solid fa-save"></i> Simpan Preset',
    background: '#1e293b', color: '#fff',
    preConfirm: (v) => String(v || '').trim()
  });
  if (!res.isConfirmed || !res.value) return;
  const isi = {
    nomor: detail.nomor, perihal: detail.perihal, kegiatan: detail.kegiatan, tempat: detail.tempat,
    waktu: detail.waktu, kota: detail.kota, tglSurat: detail.tglSurat, keterangan: detail.keterangan,
    tanggalDari: detail.tanggalDari, tanggalSampai: detail.tanggalSampai, tanggalTambahan: detail.tanggalTambahan,
    isi_surat: detail.isi_surat, ttd: detail.ttd,
    siswa: window.__dpTerpilih || [] // [REQ 4] pilihan siswa ikut tersimpan
  };
  try {
    const { error } = await supaClient.from('preset_dispensasi')
      .upsert({ ekskul, nama_preset: res.value, isi }, { onConflict: 'ekskul,nama_preset' });
    if (error) throw error;
    await muatPresetDispensasi(ekskul);
    const sel = document.getElementById('sp_preset');
    if (sel) sel.value = res.value;
    showToast('success', `Preset "${res.value}" tersimpan`);
  } catch (e) { Swal.fire({ icon: 'error', title: 'Gagal', text: e.message || '', background: '#1e293b', color: '#fff' }); }
}

/** [REQ 5] Duplikat preset terpilih ke nama baru. */
async function duplikatPresetDispensasi() {
  const ekskul = document.getElementById('dp_ekskul')?.value || window.__ekskulAktif || '';
  const sel = document.getElementById('sp_preset');
  const namaLama = sel?.value;
  if (!namaLama) return showToast('error', 'Pilih preset yang akan diduplikat.');
  try {
    const { data, error } = await supaClient.from('preset_dispensasi')
      .select('isi').eq('ekskul', ekskul).eq('nama_preset', namaLama).maybeSingle();
    if (error || !data) throw (error || new Error('Preset tidak ditemukan.'));
    const res = await Swal.fire({
      title: `Duplikat Preset "${namaLama}"`,
      input: 'text',
      inputLabel: 'Nama Preset Baru',
      inputValue: `${namaLama} (copy)`,
      showCancelButton: true, cancelButtonText: 'Batal',
      confirmButtonText: '<i class="fa-solid fa-copy"></i> Duplikat',
      background: '#1e293b', color: '#fff',
      preConfirm: (v) => String(v || '').trim()
    });
    if (!res.isConfirmed || !res.value) return;
    const ins = await supaClient.from('preset_dispensasi')
      .upsert({ ekskul, nama_preset: res.value, isi: data.isi || {} }, { onConflict: 'ekskul,nama_preset' });
    if (ins.error) throw ins.error;
    await muatPresetDispensasi(ekskul);
    if (sel) sel.value = res.value;
    showToast('success', `Preset diduplikat menjadi "${res.value}"`);
  } catch (e) { Swal.fire({ icon: 'error', title: 'Gagal', text: e.message || '', background: '#1e293b', color: '#fff' }); }
}

/** [REQ 9] Rename preset terpilih. */
async function renamePresetDispensasi() {
  const ekskul = document.getElementById('dp_ekskul')?.value || window.__ekskulAktif || '';
  const sel = document.getElementById('sp_preset');
  const namaLama = sel?.value;
  if (!namaLama) return showToast('error', 'Pilih preset yang akan di-rename.');
  const res = await Swal.fire({
    title: `Rename Preset "${namaLama}"`,
    input: 'text',
    inputLabel: 'Nama Preset Baru',
    inputValue: namaLama,
    showCancelButton: true, cancelButtonText: 'Batal',
    confirmButtonText: '<i class="fa-solid fa-check"></i> Rename',
    background: '#1e293b', color: '#fff',
    preConfirm: (v) => String(v || '').trim()
  });
  if (!res.isConfirmed || !res.value || res.value === namaLama) return;
  try {
    const upd = await supaClient.from('preset_dispensasi')
      .update({ nama_preset: res.value }).eq('ekskul', ekskul).eq('nama_preset', namaLama);
    if (upd.error) throw upd.error;
    await muatPresetDispensasi(ekskul);
    if (sel) sel.value = res.value;
    showToast('success', `Preset di-rename menjadi "${res.value}"`);
  } catch (e) { Swal.fire({ icon: 'error', title: 'Gagal', text: e.message || '', background: '#1e293b', color: '#fff' }); }
}

async function hapusPresetDispensasi() {
  const ekskul = document.getElementById('dp_ekskul')?.value || window.__ekskulAktif || '';
  const sel = document.getElementById('sp_preset');
  const nama = sel?.value;
  if (!nama) return showToast('error', 'Pilih preset yang akan dihapus.');
  const konf = await Swal.fire({ title: `Hapus preset "${nama}"?`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Ya, Hapus', cancelButtonText: 'Batal', background: '#1e293b', color: '#fff' });
  if (!konf.isConfirmed) return;
  const { error } = await supaClient.from('preset_dispensasi').delete().eq('ekskul', ekskul).eq('nama_preset', nama);
  if (error) return Swal.fire({ icon: 'error', title: 'Gagal', text: error.message, background: '#1e293b', color: '#fff' });
  await muatPresetDispensasi(ekskul);
  showToast('success', 'Preset terhapus');
}

// ---------- PEMBANGUN SURAT (REQ 10/11/12) ----------
/** Susun isi surat (teks polos dengan \n) sesuai template resmi. */
function isiSuratDispensasi(detail, subTeks) {
  const subsTxt = subTeks ? ` (${subTeks})` : '';
  let isi = `Yth.\nBapak/Ibu (Guru/Orang Tua/Wali)\ndi tempat\n\n`;
  isi += `Assalamu’alaikum Warohmatullohi Wabarokatuh\n`;
  isi += `Puji syukur kehadirat Allah SWT yang telah memberikan nikmat hingga saat ini,\n`;
  isi += `Sehubungan dengan adanya pelaksanaan kegiatan "${detail.kegiatan || '-'}" di "${detail.tempat || '-'}", maka dengan ini kami sampaikan bahwa anggota dari ekstrakurikuler "${detail.ekskul || '-'}"${subsTxt} (lampiran) untuk diberikan izin tidak dapat mengikuti proses KBM di sekolah selama latihan & kegiatan berlangsung, yaitu pada:\n\n`;
  isi += `"${detail.waktu || '-'}"\n\n`;
  isi += `Demikian surat ini kami sampaikan, untuk menjadi perhatian semua pihak dan kepada pihak-pihak terkait supaya membantu kelancaran tugas yang bersangkutan.\n\n`;
  isi += `Wassalamu’alaikum Warohmatullohi Wabarokatuh.`;
  return isi;
}

/** Teks tanggal izin KBM: dari-sampai + "dan" tanggal lain (REQ 12). */
function teksTanggalIzin(detail) {
  return detail.tanggalTeks || detail.tanggal || '';
}

/** HTML lengkap surat untuk cetak PDF (kop 2 logo, isi, ttd, lampiran halaman berikutnya). */
function htmlSuratDispensasi(detail, siswaList, kertas = 'A4') {
  const idn = typeof barisIdentitasMaster === 'function' ? barisIdentitasMaster() : {};
  const namaSekolah = idn["Nama Sekolah"] || 'SEKOLAH';
  const alamat = idn["Alamat Sekolah"] || '';
  const logoKiri = idn["URL LOGO 1"] || '';
  const ekskulRow = (cacheEkstrakurikuler || []).find(e => e.nama_ekskul === detail.ekskul) || {};
  const logoKanan = ekskulRow.logo_url || idn["URL LOGO 2"] || '';
  const isi = detail.isi_surat || isiSuratDispensasi(detail, detail.subTeks || '');
  const tglSuratTampil = detail.tglSurat ? `${detail.kota ? detail.kota + ', ' : ''}${detail.tglSurat}` : (detail.kota ? detail.kota : '');
  const tglIzin = teksTanggalIzin(detail);
  const ttdHTML = (detail.ttd || []).map(t => `
    <td style="width:${Math.floor(100 / Math.max(1, detail.ttd.length))}%;border:none;vertical-align:top;text-align:center;">
      Pembina Ekstrakurikuler<br><br><br><br>
      <b><u>${escapeHtml(t.nama || '______________________')}</u></b><br>
      ${t.nip ? `NIP. ${escapeHtml(t.nip)}` : '&nbsp;'}
    </td>`).join('');
  const lampiranRows = siswaList.map((s, i) => `
    <tr>
      <td style="border:1px solid #000;padding:4px;text-align:center;">${i + 1}</td>
      <td style="border:1px solid #000;padding:4px;">${escapeHtml(s.nama || s.nis || '-')}</td>
      <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(s.kelas || '-')}</td>
      <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(s.sub || '-')}</td>
      <td style="border:1px solid #000;padding:4px;">${escapeHtml(s.ket || '-')}</td>
    </tr>`).join('');
  const ukuran = kertas === 'F4' ? '215mm 330mm' : 'A4';

  return `
    <div style="font-family:'Times New Roman',Times,serif;color:#000;background:#fff;padding:32px;font-size:13px;line-height:1.5;">
      <table width="100%" style="border:none;border-bottom:3px double #000;margin-bottom:16px;">
        <tr>
          <td style="width:18%;border:none;text-align:center;vertical-align:middle;">${logoKiri ? `<img src="${escapeHtml(logoKiri)}" style="max-width:80px;max-height:90px;">` : ''}</td>
          <td style="border:none;text-align:center;vertical-align:middle;">
            <div style="font-size:16px;font-weight:bold;text-transform:uppercase;">${escapeHtml(namaSekolah)}</div>
            ${alamat ? `<div style="font-size:10px;">${escapeHtml(alamat)}</div>` : ''}
            <div style="font-size:13px;font-weight:bold;margin-top:2px;">Ekstrakurikuler ${escapeHtml(detail.ekskul || '-')}</div>
          </td>
          <td style="width:18%;border:none;text-align:center;vertical-align:middle;">${logoKanan ? `<img src="${escapeHtml(logoKanan)}" style="max-width:80px;max-height:90px;">` : ''}</td>
        </tr>
      </table>
      <div style="text-align:center;margin-bottom:14px;">
        <div style="font-size:14px;font-weight:bold;text-decoration:underline;">SURAT DISPENSASI KEGIATAN</div>
        ${detail.nomor ? `<div style="font-size:11px;">Nomor: ${escapeHtml(detail.nomor)}</div>` : ''}
      </div>
      ${detail.perihal ? `<div style="margin-bottom:6px;"><b>Perihal:</b> ${escapeHtml(detail.perihal)}</div>` : ''}
      ${tglIzin ? `<div style="margin-bottom:10px;"><b>Tanggal Izin (KBM):</b> ${escapeHtml(tglIzin)}</div>` : ''}
      <div style="white-space:pre-wrap;text-align:justify;">${escapeHtml(isi)}</div>
      ${detail.keterangan ? `<div style="margin-top:10px;"><b>Keterangan:</b> ${escapeHtml(detail.keterangan)}</div>` : ''}
      <div style="margin-top:24px;">
        ${tglSuratTampil ? `<div style="margin-bottom:4px;text-align:right;">${escapeHtml(tglSuratTampil)}</div>` : ''}
        <table style="border:none;margin-left:auto;"><tr>${ttdHTML || `<td style="border:none;text-align:center;">Pembina Ekstrakurikuler<br><br><br><br><b><u>______________________</u></b></td>`}</tr></table>
      </div>
      <div style="page-break-before:always;"></div>
      <div style="font-size:13px;font-weight:bold;text-align:center;margin-bottom:10px;">LAMPIRAN — DAFTAR SISWA (Izin Kegiatan ${escapeHtml(detail.ekskul || '-')})</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead><tr>
          <th style="border:1px solid #000;padding:4px;width:5%;">No</th>
          <th style="border:1px solid #000;padding:4px;">Nama Siswa</th>
          <th style="border:1px solid #000;padding:4px;width:15%;">Kelas</th>
          <th style="border:1px solid #000;padding:4px;width:22%;">Sub-Ekstrakurikuler</th>
          <th style="border:1px solid #000;padding:4px;">Keterangan</th>
        </tr></thead>
        <tbody>${lampiranRows || `<tr><td colspan="5" style="border:1px solid #000;padding:8px;text-align:center;">Belum ada siswa dipilih.</td></tr>`}</tbody>
      </table>
    </div>`;
}

/** Pilihan kertas A4 / F4 (REQ 10) — dapat diingat. */
async function pilihKertasDispensasi() {
  const simpan = localStorage.getItem('sisip_kertas_dispensasi');
  if (simpan === 'A4' || simpan === 'F4') return simpan;
  const res = await Swal.fire({
    title: 'Ukuran Kertas',
    html: `<div class="text-[11px] text-slate-300">
      <label class="block mb-1"><input type="radio" name="kertas_dp" value="A4" checked> A4 (210 × 297 mm)</label>
      <label class="block mb-2"><input type="radio" name="kertas_dp" value="F4"> F4 / Folio (215 × 330 mm)</label>
      <label class="text-[10px]"><input type="checkbox" id="dp_ingat_kertas"> Jangan tanya lagi (gunakan pilihan ini selanjutnya)</label>
    </div>`,
    showCancelButton: true, cancelButtonText: 'Batal',
    confirmButtonText: '<i class="fa-solid fa-check"></i> OK',
    background: '#1e293b', color: '#fff',
    preConfirm: () => {
      const pilih = document.querySelector('input[name="kertas_dp"]:checked')?.value || 'A4';
      const ingat = document.getElementById('dp_ingat_kertas')?.checked;
      if (ingat) localStorage.setItem('sisip_kertas_dispensasi', pilih);
      return pilih;
    }
  });
  return res.isConfirmed ? (res.value || 'A4') : null;
}

/** Cetak surat (PDF via print, ukuran kertas pilihan) — REQ 10. */
function cetakSuratDispensasi(detail, siswaList, kertas = 'A4') {
  const win = window.open('', '_blank');
  if (!win) { Swal.fire({ icon: 'error', title: 'Popup Diblokir', text: 'Izinkan popup untuk mencetak surat.', background: '#1e293b', color: '#fff' }); return; }
  const size = kertas === 'F4' ? '215mm 330mm' : 'A4';
  win.document.write(`<html><head><title>Surat Dispensasi — ${escapeHtml(detail.ekskul || '')}</title><style>@page{size:${size};margin:15mm;} body{margin:0;} table{border-collapse:collapse;} @media print{body{margin:0;}}</style></head><body>${htmlSuratDispensasi(detail, siswaList, kertas)}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 700);
}

/** Teks WhatsApp (teks saja, tanpa kop/tabel) + daftar siswa. */
function teksWaDispensasi(detail, siswaList) {
  const subTeks = detail.subTeks || '';
  let teks = `*SURAT DISPENSASI KEGIATAN*\n`;
  teks += `${detail.nomor ? `Nomor: ${detail.nomor}\n` : ''}`;
  teks += `${detail.perihal ? `Perihal: ${detail.perihal}\n` : ''}`;
  const tglIzin = teksTanggalIzin(detail);
  if (tglIzin) teks += `Tanggal Izin (KBM): ${tglIzin}\n`;
  teks += `\n`;
  teks += (detail.isi_surat || isiSuratDispensasi(detail, subTeks));
  if (detail.keterangan) teks += `\nKeterangan: ${detail.keterangan}`;
  if (siswaList.length) {
    teks += `\n\n*LAMPIRAN — SISWA:*\n`;
    siswaList.forEach((s, i) => {
      teks += `${i + 1}. ${s.nama || s.nis} (${s.kelas || '-'})${s.sub ? ` — ${s.sub}` : ''}${s.ket ? ` — ${s.ket}` : ''}\n`;
    });
  }
  return teks;
}

/** Export lampiran surat ke Excel (SheetJS) — ukuran kertas best-effort. */
function excelSuratDispensasi(detail, siswaList, kertas = 'A4') {
  if (typeof XLSX === 'undefined') return showToast('error', 'Library SheetJS belum dimuat.');
  const tglIzin = teksTanggalIzin(detail);
  const aoa = [
    ['SURAT DISPENSASI KEGIATAN EKSTRAKURIKULER'],
    [],
    ['Nama Ekstrakurikuler', detail.ekskul || ''],
    ['Nomor Surat', detail.nomor || ''],
    ['Perihal', detail.perihal || ''],
    ['Nama Kegiatan', detail.kegiatan || ''],
    ['Tempat Kegiatan', detail.tempat || ''],
    ['Hari, Tanggal, Waktu', detail.waktu || ''],
    ['Tanggal Izin (KBM)', tglIzin],
    ['Keterangan', detail.keterangan || ''],
    [],
    ['LAMPIRAN — DAFTAR SISWA'],
    ['No', 'Nama Siswa', 'Kelas', 'Sub-Ekstrakurikuler', 'Keterangan'],
    ...siswaList.map((s, i) => [i + 1, s.nama || s.nis || '', s.kelas || '', s.sub || '', s.ket || ''])
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 5 }, { wch: 30 }, { wch: 14 }, { wch: 22 }, { wch: 40 }];
  ws['!pageSetup'] = { paperSize: kertas === 'F4' ? 14 : 9, orientation: 'portrait' }; // best-effort
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dispensasi');
  XLSX.writeFile(wb, `Dispensasi_${(detail.ekskul || 'ekskul').replace(/[^\w-]+/g, '_')}_${detail.tanggal || 'surat'}.xlsx`);
}

/** Simpan riwayat: satu baris per siswa dengan surat_id sama.
 *  [REQ 7] Mode edit → timpa baris surat yang sama (surat_id tetap). */
async function simpanRiwayatDispensasi(detail, siswaList) {
  let suratId = window.__dpEditId || '';
  if (!suratId) suratId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `surat-${Date.now()}`;
  if (window.__dpEditId) {
    const del = await supaClient.from('dispensasi').delete().eq('surat_id', window.__dpEditId);
    if (del.error) { showToast('error', 'Gagal memperbarui riwayat: ' + (del.error.message || '')); return null; }
  }
  const rows = siswaList.map(s => ({
    ekskul: detail.ekskul, nis: s.nis, nama: s.nama, kelas: s.kelas,
    tanggal_izin: detail.tanggal || new Date().toISOString().slice(0, 10),
    alasan: detail.kegiatan || detail.perihal || '',
    sub_ekskul: s.sub || '', keterangan: s.ket || '',
    detail: { ...detail },
    surat_id: suratId,
    dibuat_oleh: (currentUser.user["ID Akun Guru"] || currentUser.user["NIP"] || '')
  }));
  const { error } = await supaClient.from('dispensasi').insert(rows);
  if (error) { showToast('error', 'Riwayat gagal disimpan: ' + (error.message || '')); return null; }
  return suratId;
}

/** [REQ 7] Muat surat dari riwayat ke form (mode edit). */
async function editSuratDispensasi(suratId) {
  try {
    const { data, error } = await supaClient.from('dispensasi').select('*').eq('surat_id', suratId);
    if (error || !(data || []).length) throw (error || new Error('Riwayat tidak ditemukan.'));
    const detail = data[0].detail || {};
    detail.ekskul = detail.ekskul || data[0].ekskul;
    const setV = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined && v !== null) el.value = v; };
    setV('sp_nomor', detail.nomor); setV('sp_perihal', detail.perihal); setV('sp_kegiatan', detail.kegiatan);
    setV('sp_tempat', detail.tempat); setV('sp_waktu', detail.waktu); setV('sp_kota', detail.kota);
    setV('sp_tgl_surat', detail.tglSurat); setV('sp_keterangan', detail.keterangan);
    setV('dp_tgl_dari', detail.tanggalDari || detail.tanggal); setV('dp_tgl_sampai', detail.tanggalSampai); setV('dp_tgl_tambahan', detail.tanggalTambahan);
    const isiEl = document.getElementById('sp_isi');
    if (isiEl) { isiEl.value = detail.isi_surat || ''; isiEl.dataset.auto = detail.isi_surat ? '0' : '1'; }
    const wrap = document.getElementById('sp_ttd_rows');
    if (wrap) { wrap.innerHTML = ''; (detail.ttd || [{ nama: '', nip: '' }]).forEach(t => tambahTtdDispensasi(t.nama, t.nip)); }
    window.__dpTerpilih = data.map(r => ({ nis: r.nis, nama: r.nama, kelas: r.kelas, sub: r.sub_ekskul || '', ket: r.keterangan || '', no: '' }));
    window.__dpEditId = suratId;
    renderLabelSiswaDispensasi();
    tampilkanBadgeEdit(detail.nomor || '(tanpa nomor)');
    document.getElementById('content-ekskul')?.scrollIntoView({ behavior: 'smooth' });
    showToast('success', 'Mode edit surat — perubahan akan menimpa surat ini');
  } catch (e) { Swal.fire({ icon: 'error', title: 'Gagal', text: e.message || '', background: '#1e293b', color: '#fff' }); }
}

function tampilkanBadgeEdit(nomor) {
  const badge = document.getElementById('dp-edit-badge');
  if (badge) {
    badge.style.display = 'inline-block';
    badge.innerHTML = `<i class="fa-solid fa-pen"></i> Mengedit surat No. ${escapeHtml(String(nomor))} <button onclick="batalEditDispensasi()" class="ml-1 underline text-[9px]">batal</button>`;
  }
}

function batalEditDispensasi() {
  window.__dpEditId = '';
  const badge = document.getElementById('dp-edit-badge');
  if (badge) badge.style.display = 'none';
  showToast('info', 'Mode edit dibatalkan — surat baru akan dibuat');
}

/** Router utama: validasi → kertas (PDF/Excel) → simpan riwayat → dispatch. Draft TIDAK di-reset (REQ 6). */
async function buatSuratDispensasi(mode) {
  if (!ekskulAksesTermasuk('admin', 'guru', 'pengurus')) return showToast('error', 'Akses tidak diizinkan.');
  const detail = kumpulkanDetailSuratDispensasi();
  const siswaList = window.__dpTerpilih || [];
  if (!siswaList.length) { showToast('error', 'Pilih siswa (anggota) terlebih dahulu.'); return popupSiswaDispensasi(); }
  if (!detail.tanggal) { showToast('error', 'Isi Tanggal Izin (KBM) — Dari dulu.'); return; }
  if (!detail.kegiatan || !detail.waktu) { showToast('error', 'Isi Nama Kegiatan & Hari/Tanggal/Waktu dulu.'); return; }
  const subUnik = [...new Set(siswaList.map(s => (s.sub || '').trim()).filter(Boolean))];
  detail.subTeks = subUnik.join(', ');
  if (detail.isiAuto) detail.isi_surat = isiSuratDispensasi(detail, detail.subTeks);

  let kertas = 'A4';
  if (mode === 'pdf' || mode === 'excel') {
    kertas = await pilihKertasDispensasi();
    if (!kertas) return;
  }

  const suratId = await simpanRiwayatDispensasi(detail, siswaList);
  if (!suratId) return;

  if (mode === 'pdf') {
    cetakSuratDispensasi(detail, siswaList, kertas);
    batalEditDispensasi();
  } else if (mode === 'excel') {
    excelSuratDispensasi(detail, siswaList, kertas);
    batalEditDispensasi();
  } else {
    const teks = teksWaDispensasi(detail, siswaList);
    const tombolOrtu = siswaList.filter(s => normNoWA(s.no)).slice(0, 30).map(s =>
      `<button onclick="window.open('https://wa.me/${normNoWA(s.no)}?text=' + encodeURIComponent(document.getElementById('wa_disp').value), '_blank')" class="text-[9px] px-2 py-1 rounded bg-green-600/30 hover:bg-green-600 text-green-200 hover:text-white transition m-0.5">${escapeHtml(s.nama || s.nis)}</button>`).join('');
    Swal.fire({
      title: '<i class="fa-brands fa-whatsapp text-green-400"></i> Preview Pesan',
      width: '640px',
      html: `<textarea id="wa_disp" class="w-full h-48 bg-black/40 border border-white/20 rounded p-2 text-xs text-white outline-none">${escapeHtml(teks)}</textarea>
             ${tombolOrtu ? `<div class="mt-2 text-left"><div class="text-[10px] text-slate-400 mb-1">Kirim ke ortu/wali siswa (klik nama):</div>${tombolOrtu}</div>` : '<p class="text-[10px] text-slate-500 mt-2 italic">Tidak ada nomor HP tersimpan pada siswa terpilih.</p>'}`,
      background: '#1e293b', color: '#fff', showCancelButton: true, cancelButtonText: 'Tutup',
      confirmButtonText: '<i class="fa-solid fa-copy"></i> Salin Teks',
      preConfirm: () => document.getElementById('wa_disp').value
    }).then(async (res) => {
      if (res.isConfirmed && res.value && navigator.clipboard) {
        try { await navigator.clipboard.writeText(res.value); showToast('success', 'Teks tersalin'); } catch (e) {}
      }
    });
  }
  await refreshRiwayatDispensasi(); // [REQ 6] hanya riwayat yang segar — draft tetap
}

/** Cetak ulang surat dari riwayat (gabung seluruh baris dengan surat_id sama). */
async function cetakUlangDispensasi(suratId) {
  try {
    const kertas = await pilihKertasDispensasi();
    if (!kertas) return;
    const { data, error } = await supaClient.from('dispensasi').select('*').eq('surat_id', suratId);
    if (error || !(data || []).length) throw (error || new Error('Riwayat tidak ditemukan.'));
    const detail = data[0].detail || {};
    detail.ekskul = detail.ekskul || data[0].ekskul;
    const siswaList = data.map(r => ({ nis: r.nis, nama: r.nama, kelas: r.kelas, sub: r.sub_ekskul || '', ket: r.keterangan || '', no: '' }));
    const subUnik = [...new Set(siswaList.map(s => (s.sub || '').trim()).filter(Boolean))];
    detail.subTeks = detail.subTeks || subUnik.join(', ');
    cetakSuratDispensasi(detail, siswaList, kertas);
  } catch (e) { Swal.fire({ icon: 'error', title: 'Gagal', text: e.message || '', background: '#1e293b', color: '#fff' }); }
}

async function hapusDispensasi(key) {
  if (!ekskulAksesTermasuk('admin', 'guru')) return showToast('error', 'Akses khusus pembina/guru.');
  const konf = await Swal.fire({ title: 'Hapus riwayat surat dispensasi ini (seluruh siswa)?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Ya, Hapus', cancelButtonText: 'Batal', background: '#1e293b', color: '#fff' });
  if (!konf.isConfirmed) return;
  const { error } = await supaClient.from('dispensasi')
    .delete()
    .or(`surat_id.eq.${key},id.eq.${key}`);
  if (error) return Swal.fire({ icon: 'error', title: 'Gagal', text: error.message, background: '#1e293b', color: '#fff' });
  showToast('success', 'Riwayat terhapus');
  await refreshRiwayatDispensasi();
}