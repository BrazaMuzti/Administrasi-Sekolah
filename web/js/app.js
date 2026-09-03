let html5QrcodeScanner = null;
let clockInterval = null;

let showNamaSiswa = true; let rekapModeState = 0; 
let listMuridKelas = []; let masterDataCache = []; let rawAbsenData = []; let dataStatusKunciGuru = [];
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
    cekSesiOAuth(); // kembalian OAuth (Google) → boot dashboard bila sesi valid
    return; // jangan render dashboard
  }

  initApp(user); // sesi tersimpan → langsung boot dashboard
}); // PERBAIKAN: Menambahkan kurung penutup ");" di sini

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

  // Tentukan Variabel Header
  let logoUrl = "https://cdn-icons-png.flaticon.com/512/3135/3135807.png"; // Fallback Icon
  let namaSekolah = "SIAKAD";
  if (masterDataCache.length > 0) {
     logoUrl = masterDataCache[0]["URL LOGO 1"] || logoUrl;
     namaSekolah = masterDataCache[0]["Nama Sekolah"] || namaSekolah;
  }

  let userName = user["Nama Guru"] || user["Nama Lengkap"] || "Pengguna";
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
      menus.push({ id: 'akun-murid', icon: 'fa-user-graduate', text: 'Data Akun Murid' });
  }

  if (isPengurus) menus.push({ id: 'absensi', icon: 'fa-clipboard-user', text: 'Input Hadir (Pengurus)' });
  menus.push({ id: 'logout', icon: 'fa-right-from-bracket', text: 'Keluar (Logout)' });
  
  fabMenusList = menus;
  changeMenu(menus[0].id, menus[0].text);
}

function changeMenu(menuId, menuText) {
  if(menuId === 'logout') { logout(); return; }
  
  const mainContent = document.getElementById('main-content');
  
  if (menuId === 'absensi' || menuId === 'laporan-absen') renderAbsensiModule(mainContent);
  else if (menuId === 'dashboard-murid') renderDashboardMurid(mainContent);
  else if (menuId === 'nilai') renderNilaiModule(mainContent);
  // TAMBAHKAN DUA BARIS INI:
  else if (menuId === 'akun-admin') renderManajemenAdmin(mainContent);
  else if (menuId === 'akun-murid') renderManajemenMurid(mainContent);
  else if (menuId === 'akun-guru') renderManajemenGuru(mainContent);
  else if (menuId === 'jadwal-libur') renderJadwalLiburModule(mainContent);
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
// 4. MODUL DASHBOARD MURID (ABSEN MANDIRI)
// ==========================================
async function renderAbsensiModule(container) {
  const user = currentUser.user || {}; 
  const role = currentUser.role;
  container.innerHTML = `<div class="p-6 text-center text-slate-300"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>Menyiapkan Modul Absensi...</div>`;

  if (masterDataCache.length === 0) {
    try {
        const { data, error } = await supaClient.from('master_data').select('*');
        if (!error && data) masterDataCache = data;
    } catch (e) {
        console.error("Gagal memuat master data", e);
    }
}

  let listTahun = [...new Set(masterDataCache.map(m => m["Tahun Pelajaran"]).filter(Boolean))];
  let listKelas = [...new Set(masterDataCache.map(m => m["Tingkat/Kelas"]).filter(Boolean))];
  let listMapel = role === 'admin' ? [...new Set(masterDataCache.map(m => m["Mata Pelajaran"]).filter(Boolean))] : (user["Custom Teks Mata Pelajaran"] || "").split(',').map(m => m.trim()).filter(Boolean);

  const now = new Date();
  const curMonth = now.getMonth(); 
  const curYear = now.getFullYear();
  const namaBulan = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  
  let defaultSemester = (curMonth >= 6) ? "Ganjil" : "Genap";
  let strTahunOtomatis = (curMonth >= 6) ? `${curYear}/${curYear+1}` : `${curYear-1}/${curYear}`;
  let defaultTahun = listTahun.includes(strTahunOtomatis) ? strTahunOtomatis : (listTahun[0] || strTahunOtomatis);
  let defaultBulan = namaBulan[curMonth];

  if (role !== 'admin' && user["ID Tahun Pelajaran"]) defaultTahun = user["ID Tahun Pelajaran"];
  if (!listTahun.includes(defaultTahun)) listTahun.push(defaultTahun);

  container.innerHTML = `
    <!-- FILTER BAR ABSENSI -->
    <div class="sticky top-0 z-40 p-2 rounded-b-2xl shadow-lg border-b border-white/10 bg-slate-800/90 w-full backdrop-blur-md flex flex-col gap-2">
      <div class="flex items-center justify-between gap-1 w-full">
        <div class="flex gap-1 sm:gap-2 flex-wrap items-center">
          
          <div class="relative w-7 h-7 sm:w-8 sm:h-8 group" title="Pilih Tahun">
             <div class="w-full h-full rounded-full bg-slate-700/50 border border-white/10 flex items-center justify-center text-green-400 group-hover:bg-green-500 group-hover:text-white transition shadow-sm"><i class="fa-regular fa-calendar text-[10px] sm:text-xs"></i></div>
             <select id="select-tahun-absen" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange="loadDataAbsensi()">
                 ${listTahun.map(t => `<option value="${t}" class="bg-slate-800 text-white" ${t===defaultTahun ? 'selected':''}>${t}</option>`).join('')}
             </select>
          </div>

          <div class="relative w-7 h-7 sm:w-8 sm:h-8 group" title="Pilih Semester">
             <div class="w-full h-full rounded-full bg-slate-700/50 border border-white/10 flex items-center justify-center text-teal-400 group-hover:bg-teal-500 group-hover:text-white transition shadow-sm"><i class="fa-solid fa-leaf text-[10px] sm:text-xs"></i></div>
             <select id="select-semester-absen" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange="loadDataAbsensi()">
                 <option value="Ganjil" class="bg-slate-800 text-white" ${defaultSemester === 'Ganjil' ? 'selected' : ''}>Ganjil</option>
                 <option value="Genap" class="bg-slate-800 text-white" ${defaultSemester === 'Genap' ? 'selected' : ''}>Genap</option>
             </select>
          </div>

          <div class="relative w-7 h-7 sm:w-8 sm:h-8 group" title="Pilih Bulan">
             <div class="w-full h-full rounded-full bg-slate-700/50 border border-white/10 flex items-center justify-center text-indigo-400 group-hover:bg-indigo-500 group-hover:text-white transition shadow-sm"><i class="fa-solid fa-moon text-[10px] sm:text-xs"></i></div>
             <select id="select-bulan-absen" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange="loadDataAbsensi()">
                 ${namaBulan.map(b => `<option value="${b}" class="bg-slate-800 text-white" ${b===defaultBulan ? 'selected':''}>${b}</option>`).join('')}
             </select>
          </div>

          <div class="relative w-7 h-7 sm:w-8 sm:h-8 group" title="Pilih Kelas">
             <div class="w-full h-full rounded-full bg-slate-700/50 border border-white/10 flex items-center justify-center text-pink-400 group-hover:bg-pink-500 group-hover:text-white transition shadow-sm"><i class="fa-solid fa-users text-[10px] sm:text-xs"></i></div>
             <select id="select-kelas-absen" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange="loadDataAbsensi()">
                 ${listKelas.map(k => `<option value="${k}" class="bg-slate-800 text-white">${k}</option>`).join('')}
             </select>
          </div>

          <div class="relative w-7 h-7 sm:w-8 sm:h-8 group" title="Pilih Mapel">
             <div class="w-full h-full rounded-full bg-slate-700/50 border border-white/10 flex items-center justify-center text-yellow-400 group-hover:bg-yellow-500 group-hover:text-white transition shadow-sm"><i class="fa-solid fa-book text-[10px] sm:text-xs"></i></div>
             <select id="select-mapel-absen" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange="loadDataAbsensi()">
                 ${listMapel.map(m => `<option value="${m}" class="bg-slate-800 text-white">${m}</option>`).join('')}
             </select>
          </div>
        </div>

        <!-- TOOLBAR TOMBOL -->
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
          <button onclick="forceSyncSemuaAbsensi()" class="bg-yellow-600 hover:bg-yellow-500 text-white text-[9px] sm:text-[10px] px-2 py-1.5 rounded flex items-center gap-1 font-bold transition shadow-md" title="Simpan Semua"><i class="fa-solid fa-cloud-arrow-up"></i> <span class="hidden sm:inline">Simpan</span></button>
        </div>
      </div>
    </div>

    <div class="text-center mb-4 pb-8 mt-4 px-2 relative z-0">
      <h3 class="text-sm sm:text-base font-extrabold text-white tracking-wider drop-shadow-md uppercase"><i class="fa-solid fa-clipboard-user"></i> LAPORAN KEHADIRAN TATAP MUKA</h3>
      <p class="text-[9px] sm:text-[10px] mt-1.5 bg-slate-900/60 py-1 px-3 rounded-full inline-flex border border-white/20 shadow-inner" id="lbl-info-mapel-absen"></p>
    </div>

    <!-- AREA TABEL ABSENSI -->
    <div class="relative z-50 bg-[#0f172a] rounded-xl border border-blue-500/30 shadow-[0_-15px_30px_rgba(0,0,0,0.7)] overflow-hidden mx-auto w-[99%] -mt-5 transition-all" style="min-height: 90vh;">
      <div class="w-full overflow-x-auto overflow-y-auto custom-scrollbar" style="max-height: 75vh; padding-bottom: 30px;">
        <table id="tabel-absensi" class="text-left w-full whitespace-nowrap" style="border-spacing: 0; border-collapse: separate;"></table>
      </div>
    </div>
  `;
  if(listMapel.length > 0) loadDataAbsensi(); // Panggil fungsi load bawaan Anda
}


async function submitAbsenMandiri() {
  const mapelRaw = document.getElementById('murid-mapel').value.split('|');
  const captcha = document.getElementById('murid-captcha').value.trim();
  const btn = document.getElementById('btn-absen-mandiri');
  if(!captcha) return Swal.fire({toast: true, position: 'top-end', icon: 'warning', title: 'Captcha kosong!', showConfirmButton: false, timer: 2000});
  
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Mendapatkan Lokasi GPS...`; btn.disabled = true;
  
  // Meminta Izin dan Kordinat Lokasi HP/Laptop
  const gpsLokasi = await getDeviceGPS(); 

  try {
    const payload = { action: 'absen_mandiri', tahun: currentTahun, semester: "Ganjil", bulan: currentBulan, tanggal: new Date().getDate(), kelas: currentUser.user["Tingkat/Kelas"], jenis: mapelRaw[0], mapel: mapelRaw[1], nis: currentUser.user["NIS"], nama: currentUser.user["Nama Lengkap"], captcha: captcha, gps: gpsLokasi };
    const res = await fetch(API_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    const textData = await res.text();
    let json; try { json = JSON.parse(textData); } catch(e) { throw new Error("Terjadi masalah pada server."); }
    
    if(json.status === 'success') {
      Swal.fire({ icon: 'success', title: 'Berhasil Absen!', html: `Kehadiran tercatat.<br><span class="text-xs text-slate-400">Lokasi: ${gpsLokasi}</span>`, background: '#1e293b', color: '#fff' });
      document.getElementById('murid-captcha').value = '';
    } else Swal.fire({ icon: 'error', title: 'Ditolak', text: json.message, background: '#1e293b', color: '#fff' });
  } catch (e) { Swal.fire({ icon: 'error', title: 'Error Jaringan', text: e.message, background: '#1e293b', color: '#fff' }); }
  finally { btn.innerHTML = `<i class="fa-solid fa-check-circle"></i> Saya Hadir Hari Ini`; btn.disabled = false; }
}

async function simpanKeDatabase(tanggal, absenList, keteranganMasal = '') {
  // Tampilkan loading spinner
  Swal.fire({ title: 'Menyimpan Absensi...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

  try {
    // 1. Format payload sesuai kolom pada tabel 'absensi' di Supabase
    const payload = absenList.map(item => ({
      tanggal: tanggal, // Format YYYY-MM-DD
      nis: item.nis,
      status: item.status, // Misal: 'H', 'I', 'S', 'A'
      keterangan: item.keterangan || keteranganMasal,
      // Jika butuh menyimpan kelas dan mapel, Anda bisa mengambilnya dari elemen UI/variabel global:
      // kelas: document.getElementById('select-kelas-nilai').value,
      // mapel: document.getElementById('select-mapel-nilai').value
    }));

    // 2. Eksekusi Upsert ke Supabase
    // PERBAIKAN: Gunakan 'supaClient' (bukan _supabase)
    // Pastikan di database Supabase Anda telah mengatur Unique/Primary Key gabungan untuk (tanggal, nis)
    const { data, error } = await supaClient
      .from('absensi') 
      .upsert(payload, { onConflict: 'tanggal, nis' });

    // 3. Tangani Response Database
    if (error) {
      throw error; // Lempar error ke blok catch
    } 
    
    // Jika sukses
    Swal.fire({ 
      toast: true, position: 'top-end', icon: 'success', 
      title: 'Absensi Tersimpan', showConfirmButton: false, 
      timer: 1500, background: '#1e293b', color: '#fff' 
    });
    
    // Opsional: Muat ulang data UI absensi jika fungsinya ada
    // if (typeof loadDataMuridDanAbsen === 'function') loadDataMuridDanAbsen(); 
    
  } catch (error) {
    console.error("Gagal menyimpan absensi:", error);
    Swal.fire({ 
      icon: 'error', 
      title: 'Gagal', 
      text: error.message || 'Terjadi kesalahan saat menyimpan ke database.', 
      background: '#1e293b', 
      color: '#fff' 
    });
  }
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
  let listKelas = [...new Set(masterDataCache.map(m => m["Tingkat/Kelas"]).filter(Boolean))];
  let listMapel = [...new Set(masterDataCache.map(m => m["Mata Pelajaran"]).filter(Boolean))];
  let listEkskul = [...new Set(masterDataCache.map(m => m["Ekstrakurikuler"]).filter(Boolean))];

  if(role === 'murid') { 
    listKelas = [user["Tingkat/Kelas"]]; 
    if(!isPengurusEkskul) listEkskul = []; 
    if(isPengurusEkskul && !isPengurusKelas) { listEkskul = (user["Ekstrakurikuler"] || "").split(',').map(e=>e.trim()); listMapel = []; }
  }

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
             <select id="select-mapel" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange="handleMapelChange()">
               ${listMapel.length > 0 ? `<optgroup label="Mata Pelajaran" class="bg-slate-700 text-blue-300 font-bold">${listMapel.map(m => `<option value="Mapel|${m}" class="bg-slate-800 text-white">${m}</option>`).join('')}</optgroup>` : ''}
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
  handleMapelChange();
}

function handleMapelChange() {
  const mapelRaw = document.getElementById('select-mapel').value, isEkskul = mapelRaw.startsWith('Ekskul');
  const selKelas = document.getElementById('select-kelas'), optSemua = document.getElementById('opt-semua-kelas');
  if (isEkskul) { optSemua.classList.remove('hidden'); selKelas.value = "Semua Kelas"; document.getElementById('lbl-judul-utama').innerText = `Daftar Hadir Ekstrakurikuler`; } 
  else { optSemua.classList.add('hidden'); if (selKelas.value === "Semua Kelas") selKelas.selectedIndex = 1; document.getElementById('lbl-judul-utama').innerText = `Laporan Hadir Tatap Muka`; }
  loadDataMuridDanAbsen();
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

  const w_no = 36, w_nama = 110, w_kelas = 55, w_tgl = 38, w_icon = 32, w_hsia = 28, w_pct = 36, w_ket = 45; 
  let widthNamaCol = showNamaSiswa ? w_nama : 0;
  let widthKelasCol = (showNamaSiswa && isEkskul) ? w_kelas : 0;
  
  let totalLebarTabel = w_no + widthNamaCol + widthKelasCol + (datesToRender.length * w_tgl) + w_icon;
  if (rekapModeState >= 1) totalLebarTabel += (w_hsia * 4);
  if (rekapModeState >= 2) totalLebarTabel += w_pct;
  if (rekapModeState >= 3) totalLebarTabel += w_ket;

  const leftNo = 0, leftNama = w_no, leftKelas = w_no + w_nama;
  const sKiri = (w, left) => `position: sticky; left: ${left}px; z-index: 20; width: ${w}px; min-width: ${w}px; max-width: ${w}px; background-color: #0f172a;`;
  
  let rightOffsets = { icon: 0, h: 0, s: 0, i: 0, a: 0, pct: 0, ket: 0 };
  if (rekapModeState >= 1) { rightOffsets.a = w_icon; rightOffsets.i = w_icon + w_hsia; rightOffsets.s = w_icon + w_hsia * 2; rightOffsets.h = w_icon + w_hsia * 3; }
  else if (rekapModeState >= 2) { rightOffsets.pct = w_icon; rightOffsets.a = w_icon + w_pct; rightOffsets.i = w_icon + w_pct + w_hsia; rightOffsets.s = w_icon + w_pct + w_hsia * 2; rightOffsets.h = w_icon + w_pct + w_hsia * 3; }
  else if (rekapModeState >= 3) { rightOffsets.ket = w_icon; rightOffsets.pct = w_icon + w_ket; rightOffsets.a = w_icon + w_ket + w_pct; rightOffsets.i = w_icon + w_ket + w_pct + w_hsia; rightOffsets.s = w_icon + w_ket + w_pct + w_hsia * 2; rightOffsets.h = w_icon + w_ket + w_pct + w_hsia * 3; }
  
  const sKanan = (w, right) => `position: sticky; right: ${right}px; z-index: 20; width: ${w}px; min-width: ${w}px; max-width: ${w}px; background-color: #0f172a; border-bottom: 1px solid rgba(255,255,255,0.1);`;

  let tbodyHTML = listMuridKelas.map(m => {
    const ketAda = rawAbsenData.find(a => a.NIS == m.nis && (a["Keterangan ketidakhadiran"] || a.Keterangan || "").trim() !== "");
    const colorBtnKet = ketAda ? 'text-blue-400 bg-blue-500/20' : 'text-slate-500 bg-white/5';

    return `
      <tr class="hover:bg-white/5 transition group text-[11px] border-b border-white/5">
        <td style="${sKiri(w_no, leftNo)}" class="px-1 py-1.5 text-center border-r border-white/10 text-blue-400 font-bold cursor-pointer" onclick="toggleNamaSiswa()">${m.no}</td>
        ${showNamaSiswa ? `<td style="${sKiri(w_nama, leftNama)}" class="px-2 py-1.5 border-r border-white/10 truncate">${m.nama}</td>` : ''}
        ${showNamaSiswa && isEkskul ? `<td style="${sKiri(w_kelas, leftKelas)}" class="px-1 py-1.5 border-r border-white/10 text-center text-[9px] text-yellow-400 truncate">${m.kelasAsli}</td>` : ''}
        
        ${datesToRender.map(d => {
          const dataDb = rawAbsenData.find(a => parseInt(a.Tanggal) === parseInt(d) && a.NIS == m.nis);
          const st = dataDb ? dataDb.Status : "-";
          let color = "bg-white/5 text-slate-400";
          if(st==='H') color="bg-green-500 text-white"; else if(st==='S') color="bg-blue-500 text-white"; else if(st==='I') color="bg-yellow-500 text-white"; else if(st==='A') color="bg-red-500 text-white";
          
          let isLibur = isHoliday(d, currentBulan, currentTahun);
          let tdClass = `px-0.5 py-1.5 border-r border-white/10 text-center cursor-pointer ${isLibur ? 'bg-red-500/10' : ''}`;
          if(isRealToday(d)) tdClass += ` bg-blue-900/40`;
          
          return `<td class="${tdClass}" onclick="openEditAbsenMasal(${d}, ${isLibur})" style="min-width:${w_tgl}px"><div class="w-5 h-5 rounded mx-auto flex items-center justify-center font-bold ${color}">${st}</div></td>`;
        }).join('')}
        
        ${rekapModeState >= 1 ? `<td style="${sKanan(w_hsia, rightOffsets.h)}" class="px-1 py-1.5 text-center font-bold text-green-400 border-l border-white/20">${m.totalH}</td><td style="${sKanan(w_hsia, rightOffsets.s)}" class="px-1 py-1.5 text-center font-bold text-blue-400">${m.totalS}</td><td style="${sKanan(w_hsia, rightOffsets.i)}" class="px-1 py-1.5 text-center font-bold text-yellow-400">${m.totalI}</td><td style="${sKanan(w_hsia, rightOffsets.a)}" class="px-1 py-1.5 text-center font-bold text-red-400 border-r border-white/20">${m.totalA}</td>` : ''}
        ${rekapModeState >= 2 ? `<td style="${sKanan(w_pct, rightOffsets.pct)}" class="px-1 py-1.5 text-center font-bold text-purple-400 border-r border-white/10">${((m.totalH/pembagiPersen)*100).toFixed(1)}%</td>` : ''}
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
        ${showNamaSiswa ? `<th style="${sKiri(w_nama, leftNama)}" class="text-[11px]">Nama Siswa</th>` : ''}
        ${showNamaSiswa && isEkskul ? `<th style="${sKiri(w_kelas, leftKelas)}" class="text-[11px] text-center">Kls</th>` : ''}
        ${headTgl}
        ${rekapModeState >= 1 ? `<th style="${sKanan(w_hsia, rightOffsets.h)}" class="border-l border-white/20 text-[11px]">H</th><th style="${sKanan(w_hsia, rightOffsets.s)}" class="text-[11px]">S</th><th style="${sKanan(w_hsia, rightOffsets.i)}" class="text-[11px]">I</th><th style="${sKanan(w_hsia, rightOffsets.a)}" class="border-r border-white/20 text-[11px]">A</th>` : ''}
        ${rekapModeState >= 2 ? `<th style="${sKanan(w_pct, rightOffsets.pct)}" class="border-r border-white/10 text-[11px]">％</th>` : ''}
        ${rekapModeState >= 3 ? `<th style="${sKanan(w_ket, rightOffsets.ket)}" class="text-[11px]">Ket</th>` : ''}
        <th style="${sKanan(w_icon, 0)}" class="text-[11px]" onclick="cycleRekapMode()">⚙️</th>
      </tr>
    </thead>
    <tbody class="text-slate-300">${tbodyHTML}</tbody>
  `;
  setTimeout(() => { terapkanKunciLiburAbsensi(); }, 500);
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
    const { data, error } = await supaClient
      .from('dashboard_data') // Sesuaikan dengan nama tabel di Supabase
      .select('*');

      if (error) {
        console.error("Gagal memuat dashboard_data:", error);
      } else {
        masterDataCache = data;
      }
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
        let tH = 0, tS = 0, tI = 0, tA = 0;
        absenSiswa.forEach(a => { if (a.Status === 'H') tH++; if (a.Status === 'S') tS++; if (a.Status === 'I') tI++; if (a.Status === 'A') tA++; });
        let jkStr = "-"; if(m["Jenis Kelamin"]) { const jkL = m["Jenis Kelamin"].toLowerCase(); if(jkL.startsWith('l')) jkStr = "L"; else if(jkL.startsWith('p')) jkStr = "P"; }
        return { no: idx + 1, nis: m.NIS || "-", nisn: m.NISN || "-", nama: m["Nama Lengkap"] || "-", kelasAsli: m["Tingkat/Kelas"], jk: jkStr, totalH: tH, totalS: tS, totalI: tI, totalA: tA, ket: m["Catatan Khusus"] || "" };
      });
      refreshTableAbsenUI();
    }
  } catch (e) { if(tableEl) tableEl.innerHTML = `<tr><td class="p-6 text-center text-red-400"><i class="fa-solid fa-triangle-exclamation text-2xl mb-2"></i><br>Gagal memuat data.</td></tr>`; }
}

function toggleNamaSiswa() { showNamaSiswa = !showNamaSiswa; refreshTableAbsenUI(); }
function cycleRekapMode() { rekapModeState = (rekapModeState + 1) % 4; refreshTableAbsenUI(); }

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
  
  const payload = { action: 'save_keterangan_siswa', nis: nis, bulan: currentBulan, mapel: namaMapel, updates: updates };
  Swal.fire({ title: 'Menyimpan...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
  
  try {
    const res = await fetch(API_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    const textData = await res.text();
    let json; try { json = JSON.parse(textData); } catch(e) { throw new Error("Server Error"); }
    if (json.status === 'success') { Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Tersimpan!', showConfirmButton: false, timer: 1500, background: '#1e293b', color: '#fff' }); loadDataMuridDanAbsen(); } 
    else { Swal.fire({ icon: 'error', title: 'Gagal', text: json.message, background: '#1e293b', color: '#fff' }); }
  } catch (e) { Swal.fire({ icon: 'error', title: 'Error Jaringan', background: '#1e293b', color: '#fff' }); }
}

function showModalEditAbsen(tanggal) {
  tempKeteranganHarian = {}; 
  let ketMasalDB = "";
  let siswaListHTML = listMuridKelas.map(m => {
    const dataDb = rawAbsenData.find(a => parseInt(a.Tanggal) === parseInt(tanggal) && a.NIS == m.nis);
    const s = dataDb ? dataDb.Status : "";
    const ketDB = dataDb ? (dataDb["Keterangan ketidakhadiran"] || dataDb.Keterangan || "") : "";
    
    if (dataDb && dataDb["Keterangan kehadiran"]) ketMasalDB = dataDb["Keterangan kehadiran"]; 
    if (ketDB) tempKeteranganHarian[m.nis] = ketDB;
    
    const cH = s === 'H' ? 'checked' : '', cS = s === 'S' ? 'checked' : '', cI = s === 'I' ? 'checked' : '', cA = s === 'A' ? 'checked' : '';
    const colorKet = ketDB ? 'text-blue-400' : 'text-slate-500';
    
    return `<div class="flex items-center justify-between border-b border-white/10 py-2.5" id="row-murid-${m.nis}"><span class="text-xs font-medium text-slate-200 text-left w-[40%] leading-tight">${m.no}. ${m.nama}</span><div class="flex gap-1.5 w-[60%] justify-end items-center"><label class="cursor-pointer"><input type="radio" name="absen_${m.nis}" value="H" ${cH} class="hidden peer radio-h"><div class="w-6 h-6 rounded bg-white/10 flex items-center justify-center text-[10px] font-bold text-slate-400 peer-checked:bg-green-500 peer-checked:text-white">H</div></label><label class="cursor-pointer"><input type="radio" name="absen_${m.nis}" value="S" ${cS} class="hidden peer"><div class="w-6 h-6 rounded bg-white/10 flex items-center justify-center text-[10px] font-bold text-slate-400 peer-checked:bg-blue-500 peer-checked:text-white">S</div></label><label class="cursor-pointer"><input type="radio" name="absen_${m.nis}" value="I" ${cI} class="hidden peer"><div class="w-6 h-6 rounded bg-white/10 flex items-center justify-center text-[10px] font-bold text-slate-400 peer-checked:bg-yellow-500 peer-checked:text-white">I</div></label><label class="cursor-pointer"><input type="radio" name="absen_${m.nis}" value="A" ${cA} class="hidden peer"><div class="w-6 h-6 rounded bg-white/10 flex items-center justify-center text-[10px] font-bold text-slate-400 peer-checked:bg-red-500 peer-checked:text-white">A</div></label><div class="flex items-center gap-1 ml-1" style="width: 50px;"><span class="text-[8px] text-yellow-400 truncate w-8 text-right" title="${ketDB}">${ketDB || '-'}</span><button id="btn-ket-${m.nis}" onclick="popupEditKeterangan('${m.nis}', '${m.nama.replace(/'/g, "\\'")}')" class="w-5 h-5 rounded bg-black/30 hover:bg-black/50 transition ${colorKet}"><i class="fa-solid fa-pen-to-square text-[10px]"></i></button></div></div></div>`;
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
</button></button></div><div id="qr-reader-in-modal" class="w-full hidden border-2 border-blue-500 rounded-lg mb-3"></div><div class="max-h-[35vh] overflow-y-auto px-2 text-left custom-scrollbar border-t border-white/10 pt-2">${siswaListHTML}</div>`,
    background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonText: '<i class="fa-solid fa-save"></i> Simpan', cancelButtonText: 'Batal',
        didOpen: () => {
      document.getElementById('btn-hadir-semua').addEventListener('click', () => document.querySelectorAll('.radio-h').forEach(r => r.checked = true));
      const btnToggle = document.getElementById('btn-toggle-kunci-panel');
      if(btnToggle) { btnToggle.addEventListener('click', () => { const panel = document.getElementById('panel-kunci-admin'); if(panel.classList.contains('hidden')) { panel.classList.remove('hidden'); btnToggle.classList.add('bg-blue-600', 'text-white'); btnToggle.classList.remove('bg-white/10', 'text-slate-300'); } else { panel.classList.add('hidden'); btnToggle.classList.add('bg-white/10', 'text-slate-300'); btnToggle.classList.remove('bg-blue-600', 'text-white'); } }); }
      document.getElementById('btn-qr-modal').addEventListener('click', () => { if (html5QrcodeScanner) { try { const prevClear = html5QrcodeScanner.clear && html5QrcodeScanner.clear(); if (prevClear && prevClear.catch) prevClear.catch(() => {}); } catch (e) {} html5QrcodeScanner = null; } document.getElementById('qr-reader-in-modal').classList.remove('hidden'); html5QrcodeScanner = new Html5QrcodeScanner("qr-reader-in-modal", { fps: 10, qrbox: {width: 200, height: 200} }); html5QrcodeScanner.render((nis) => { const radioH = document.querySelector(`input[name="absen_${nis}"][value="H"]`); if (radioH && !radioH.checked) { radioH.checked = true; const nama = listMuridKelas.find(m => m.nis == nis)?.nama || "Siswa"; const utt = new SpeechSynthesisUtterance(`Hadir, ${nama}`); utt.lang = 'id-ID';utt.rate = 1.4; window.speechSynthesis.speak(utt); const r = document.getElementById(`row-murid-${nis}`); r.classList.add('bg-green-900/50'); setTimeout(() => r.classList.remove('bg-green-900/50'), 1500); } }, () => {}); });
    },
    preConfirm: () => {
      let absenPayload = [];
      listMuridKelas.forEach(m => { const rad = document.querySelector(`input[name="absen_${m.nis}"]:checked`); if (rad) absenPayload.push({ nis: m.nis, nama: m.nama, status: rad.value, keterangan: tempKeteranganHarian[m.nis] || "" }); });
      const inputEl = document.getElementById('input-ket-kehadiran-masal'); return { absenList: absenPayload, ketMasal: inputEl ? inputEl.value : "" };
    }
  }).then((res) => { if (res.isConfirmed && res.value && res.value.absenList.length > 0) simpanKeDatabase(tanggal, res.value.absenList, res.value.ketMasal); });
}

//async function simpanKeDatabase(tanggal, absenList, keteranganMasal = "") {
//  const mapelRaw = document.getElementById('select-mapel').value, arrMapel = mapelRaw.split('|'), jenisData = arrMapel[0], namaMapelEkskul = arrMapel[1], kelasDipilih = document.getElementById('select-kelas').value;
//  const idGuruTarget = (currentUser.role === 'admin' || currentUser.role === 'guru') ? currentUser.user["ID Akun Guru"] : "MURID-" + currentUser.user["NIS"];
//  const payload = { action: 'save_absen_masal', id_guru: idGuruTarget, tahun: currentTahun, semester: "Ganjil", bulan: currentBulan, tanggal: tanggal, kelas: kelasDipilih, jenis: jenisData, mapel: jenisData === 'Mapel' ? namaMapelEkskul : "", ekskul: jenisData === 'Ekskul' ? namaMapelEkskul : "", metode: "Manual / QR", keterangan_kehadiran_masal: keteranganMasal, absenList: absenList };
  
//  Swal.fire({ title: 'Menyimpan...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
//  try {
//    const res = await fetch(API_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
//    const textData = await res.text(); let json; try { json = JSON.parse(textData); } catch(e) { throw new Error("Server Error"); }
//    if (json.status === 'success') { Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Data Berhasil Disimpan!', showConfirmButton: false, timer: 1500, background: '#1e293b', color: '#fff' }); loadDataMuridDanAbsen(); } 
//    else { Swal.fire({ icon: 'error', title: 'Ditolak', text: json.message, background: '#1e293b', color: '#fff' }); }
//  } catch (e) { Swal.fire({ icon: 'error', title: 'Gagal Menyimpan', background: '#1e293b', color: '#fff' }); }
//}

async function updateKunciServer() {
  const newCaptcha = document.getElementById('input-captcha').value.trim(), newKunci = document.getElementById('toggle-kunci').checked ? 'BUKA' : 'TUTUP';
  if(!newCaptcha) return Swal.fire({toast:true, position:'top-end', icon:'error', title:'Captcha kosong!', showConfirmButton:false, timer:2000});
  try {
    const payload = { action: 'update_kunci', id_guru: currentUser.user["ID Akun Guru"], captcha: newCaptcha, kunci: newKunci };
    // FIX BUG LOCALSTORAGE: verifikasi respons server SEBELUM menyentuh state/sesi lokal.
    // Dulu: seolah sukses walau server gagal → localStorage & Google Sheet tidak sinkron.
    const res = await fetch(`${API_URL}?action=update_kunci&data=${encodeURIComponent(JSON.stringify(payload))}`);
    const textData = await res.text(); let json; try { json = JSON.parse(textData); } catch(e) { throw new Error("Server Error"); }
    if (json.status !== 'success') throw new Error(json.message || 'Gagal menyimpan kunci.');
    currentUser.user["Captcha"] = newCaptcha; currentUser.user["Kunci Absen"] = newKunci;
    // Simpan hanya bila token valid — jangan timpa token sesi dengan string kosong.
    const tokenAktif = getToken();
    if (tokenAktif) setSession(tokenAktif, currentUser);
    else console.warn('updateKunciServer: token sesi kosong, sesi localStorage dilewati.');
    Swal.fire({toast:true, position:'top-end', icon:'success', title:'Kunci Diperbarui!', showConfirmButton:false, timer:2000, background: '#1e293b', color: '#fff'});
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

    const mapelRaw = document.getElementById('select-mapel').value || "";
    const arrMapel = mapelRaw.split('|');
    const jenisData = arrMapel[0] || "Mapel";
    const namaMapelEkskul = arrMapel[1] || mapelRaw;
    const kelasDipilih = document.getElementById('select-kelas').value || "Semua Kelas";
    const idGuruTarget = (currentUser.role === 'admin' || currentUser.role === 'guru') ? currentUser.user["ID Akun Guru"] : "MURID-" + currentUser.user["NIS"];

    try {
        const dates = Object.keys(groupedByDate);
        for(let i=0; i < dates.length; i++) {
            let tgl = dates[i];
            let absenList = groupedByDate[tgl];
            const payload = { action: 'save_absen_masal', id_guru: idGuruTarget, tahun: currentTahun, semester: "Ganjil", bulan: currentBulan, tanggal: tgl, kelas: kelasDipilih, jenis: jenisData, mapel: jenisData === 'Mapel' ? namaMapelEkskul : "", ekskul: jenisData === 'Ekskul' ? namaMapelEkskul : "", metode: "Form Masal", keterangan_kehadiran_masal: "", absenList: absenList };
            
            await fetch(API_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
        }
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Seluruh Kehadiran Tersimpan!', showConfirmButton: false, timer: 2000, background: '#1e293b', color: '#fff' });
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Gagal Menyimpan', text: 'Periksa koneksi jaringan Anda.', background: '#1e293b', color: '#fff' });
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
        let tH = 0, tS = 0, tI = 0, tA = 0;
        
        for(let i=1; i<=31; i++) {
            let dt = rawAbsenData.find(a => parseInt(a.Tanggal) === i && String(a.NIS) === String(nis));
            let sts = dt ? dt.Status : "";
            if(sts==='H') tH++; if(sts==='S') tS++; if(sts==='I') tI++; if(sts==='A') tA++;
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
  
  let pengurus = listMuridKelas.filter(m => m["Jabatan Kelas"]).map(m => `• ${m["Nama Lengkap"]} <span class="text-blue-300">(${m["Jabatan Kelas"]})</span>`).join('<br>');
  if(!pengurus) pengurus = "<i>Tidak ada data pengurus kelas</i>";
  
  let namaWali = typeof getNamaWaliKelas === 'function' ? getNamaWaliKelas(kelas) : "Nama Wali Kelas";
  
  Swal.fire({ 
    title: `<div class="text-lg font-bold">Info Kelas ${kelas}</div>`, 
    html: `
    <div class="text-left text-sm text-slate-300 mt-2 bg-black/30 p-4 rounded border border-white/10 shadow-inner">
    
        <p class="mb-1 text-[10px] uppercase tracking-wider text-slate-500 font-bold">Wali Kelas</p>
        <p class="font-bold text-white mb-4"><i class="fa-solid fa-user-tie text-green-400"></i> ${namaWali}</p>
        
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
// --- [UPDATE PERBAIKAN BUG] BROADCAST WA ABSENSI ---
function shareKehadiranWA() {
    Swal.fire({
        title: '<div class="text-base font-bold text-green-400"><i class="fa-brands fa-whatsapp"></i> Broadcast Kehadiran</div>',
        html: `
          <div class="text-left text-sm text-slate-300">
            <label class="block text-[10px] font-bold mb-1 text-blue-300">Target Siswa</label>
            <select id="wa_abs_siswa" class="w-full bg-slate-700 rounded px-2 py-1.5 text-xs text-white mb-3 outline-none">
                <option value="ALL">Semua Siswa di Kelas Ini</option>
                ${listMuridKelas.map(m => `<option value="${m.NIS || m.nis}">${m["Nama Lengkap"] || m.nama || m.Nama}</option>`).join('')}
            </select>
            
            <label class="block text-[10px] font-bold mb-1 text-blue-300">Rentang Waktu Laporan</label>
            <select id="wa_abs_waktu" class="w-full bg-slate-700 rounded px-2 py-1.5 text-xs text-white mb-3 outline-none">
                <option value="BULAN">Bulan Ini Saja (${currentBulan})</option>
                <option value="SEMESTER">Satu Semester</option>
            </select>

            <label class="block text-[10px] font-bold mb-1 text-blue-300">Filter Status (Ceklis yang akan dilaporkan)</label>
            <div class="flex gap-2 flex-wrap mb-2 text-xs bg-slate-700 p-2 rounded">
                <label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" class="wa_chk_sts" value="A" checked> Alpa (A)</label>
                <label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" class="wa_chk_sts" value="I" checked> Izin (I)</label>
                <label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" class="wa_chk_sts" value="S" checked> Sakit (S)</label>
                <label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" class="wa_chk_sts" value="H"> Hadir (H)</label>
            </div>
          </div>
        `,
        background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonText: 'Buat Pesan'
    }).then((res) => {
        if (res.isConfirmed) {
            const popup = Swal.getPopup();
            const targetSiswa = popup.querySelector('#wa_abs_siswa').value;
            const waktu = popup.querySelector('#wa_abs_waktu').value;
            let sts = []; popup.querySelectorAll('.wa_chk_sts:checked').forEach(c => sts.push(c.value));
            
            if(sts.length === 0) return Swal.fire('Error', 'Pilih minimal 1 kategori status.', 'error');

            let mapelRaw = document.getElementById('select-mapel').value;
            let mapel = mapelRaw.includes('|') ? mapelRaw.split('|')[1] : mapelRaw;
            
            let textWA = `*INFORMASI KEHADIRAN SISWA*\nMapel: ${mapel}\nRentang Waktu: ${waktu === 'BULAN' ? currentBulan : waktu}\n\n`;

            listMuridKelas.forEach((m) => {
                let nis = m.NIS || m.nis;
                let nama = m["Nama Lengkap"] || m.nama || m.Nama;
                if(targetSiswa !== "ALL" && String(nis) !== String(targetSiswa)) return;
                
                // Hitung aktual kehadiran dari rawAbsenData
                let absenSiswa = rawAbsenData.filter(a => String(a.NIS) === String(nis));
                let tH = absenSiswa.filter(a => a.Status === 'H').length;
                let tS = absenSiswa.filter(a => a.Status === 'S').length;
                let tI = absenSiswa.filter(a => a.Status === 'I').length;
                let tA = absenSiswa.filter(a => a.Status === 'A').length;
                
                let catat = [];
                if(sts.includes('A') && tA > 0) catat.push(`Alpa: ${tA}`);
                if(sts.includes('I') && tI > 0) catat.push(`Izin: ${tI}`);
                if(sts.includes('S') && tS > 0) catat.push(`Sakit: ${tS}`);
                if(sts.includes('H') && tH > 0) catat.push(`Hadir: ${tH}`);

                if(catat.length > 0) {
                    textWA += `*${nama}*\n~> ${catat.join(' | ')}\n\n`;
                }
            });

            textWA += `_Demikian laporan kehadiran ini disampaikan. Mohon perhatiannya._`;

            Swal.fire({
                title: '<i class="fa-brands fa-whatsapp"></i> Preview Pesan',
                html: `<textarea class="w-full h-56 bg-black/40 border border-white/20 rounded p-2 text-xs text-white outline-none custom-scrollbar" readonly>${textWA}</textarea>`,
                background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonText: 'Kirim via WA'
            }).then((resWa) => {
                if(resWa.isConfirmed) window.open(`https://wa.me/?text=${encodeURIComponent(textWA)}`, '_blank');
            });
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
        ["INFO", "Isi nilai H (Hadir), S (Sakit), I (Izin), A (Alpa)"],
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
                                if(targetId.startsWith('A_') && val !== "" && !['H','S','I','A'].includes(val)) val = "";
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
const LETTERS_KD = ['A','B','C','D','E','F','G','H'];

const hitungPredikat = (nilai) => {
  if (nilai === "" || nilai === null || isNaN(nilai)) return "-";
  const n = Number(nilai); if (n >= 91) return "A"; if (n >= 81) return "B"; if (n >= 71) return "C"; return "D";
};

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
  let listKelas = [...new Set(masterDataCache.map(m => m["Tingkat/Kelas"]).filter(Boolean))];
  
  // Mengisi Cache Global dan Mendeklarasikan listActiveDropdown
  cacheListMapel = role === 'admin' 
    ? [...new Set(masterDataCache.map(m => m["Mata Pelajaran"]).filter(Boolean))] 
    : (user["Custom Teks Mata Pelajaran"] || "").split(',').map(m => m.trim()).filter(Boolean);

  cacheListEkskul = role === 'admin'
    ? [...new Set(masterDataCache.map(m => m["Ekstrakurikuler"]).filter(Boolean))]
    : (user["Ekstrakurikuler"] || "").split(',').map(m => m.trim()).filter(Boolean);

  let listActiveDropdown = currentKategoriNilai === "Data Nilai Eskul" ? cacheListEkskul : cacheListMapel;

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
             <div class="w-full h-full rounded-full bg-slate-700/50 border border-white/10 flex items-center justify-center text-pink-400 group-hover:bg-pink-500 group-hover:text-white transition shadow-sm"><i class="fa-solid fa-users text-[10px] sm:text-xs"></i></div>
             <select id="select-kelas-nilai" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange="loadDataNilai()">
                 ${listKelas.map(k => `<option value="${k}" class="bg-slate-800 text-white">${k}</option>`).join('')}
             </select>
          </div>

          <div class="relative w-7 h-7 sm:w-8 sm:h-8 group" title="Pilih Mapel / Ekstrakurikuler">
             <div class="w-full h-full rounded-full bg-slate-700/50 border border-white/10 flex items-center justify-center text-yellow-400 group-hover:bg-yellow-500 group-hover:text-white transition shadow-sm"><i class="fa-solid fa-book text-[10px] sm:text-xs"></i></div>
             <select id="select-mapel-nilai" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange="loadDataNilai()">
                 ${listActiveDropdown.map(m => `<option value="${m}" class="bg-slate-800 text-white">${m}</option>`).join('')}
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

  // 4. Langsung eksekusi pemanggilan data tabel jika daftar Mapel tersedia
  if (cacheListMapel.length > 0 || cacheListEkskul.length > 0) {
    loadDataNilai();
  }
}

async function loadDataNilai() {
  const mapel = document.getElementById('select-mapel-nilai').value, kelas = document.getElementById('select-kelas-nilai').value;
  currentTahun = document.getElementById('select-tahun-nilai').value;
  currentSemesterNilai = document.getElementById('select-semester-nilai').value;
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
    const noCache = new Date().getTime(); 
    const resKonfig = await fetch(`${API_URL}?action=get_konfigurasi_nilai&t=${noCache}&data=${encodeURIComponent(JSON.stringify({sheetName: currentKategoriNilai, mapel: mapel}))}`);
    const jsonKonfig = await resKonfig.json(); configNilaiAktif = jsonKonfig.data;

    // Default Config Injector
    if(!configNilaiAktif) {
      if (currentKategoriNilai === "Data Nilai Pengetahuan") {
        configNilaiAktif = { active_kd: 2, kds: [{name: "Bab 1", t1: "Tugas 1", t2: "Tugas 2", uh: "Ulangan Harian"}, {name: "Bab 2", t1: "Tugas 1", t2: "Tugas 2", uh: "Ulangan Harian"}], bobot: { cp: 50, uts: 20, uas: 30 } };
      } else if (currentKategoriNilai === "Data Nilai Keterampilan") {
        configNilaiAktif = { active_cp: 2, bobot: { prak: 40, proj: 30, port: 30 } };
      }
    }

    const payloadDash = JSON.stringify({ action: 'get_dashboard_data', kelas: kelas, mapel: mapel, tahun: currentTahun });
    const resDash = await fetch(`${API_URL}?action=get_dashboard_data&t=${noCache}&data=${encodeURIComponent(payloadDash)}`);
    const jsonDash = await resDash.json();
    listMuridKelas = jsonDash.status === 'success' ? jsonDash.murid : [];
    // PERBAIKAN: Saring data tabel Nilai berdasarkan kolom "Ekstrakurikuler"
    if(currentKategoriNilai === "Data Nilai Eskul") {
        listMuridKelas = listMuridKelas.filter(m => {
            const dataEkskul = m["Ekstrakurikuler"] || "";
            const arrEkskul = dataEkskul.split(',').map(e => e.trim());
            return arrEkskul.includes(mapel);
        });
    }

    if(jsonDash.status_guru) dataStatusKunciGuru = jsonDash.status_guru; 

    const resNilai = await fetch(`${API_URL}?action=get_data_nilai&t=${noCache}&data=${encodeURIComponent(JSON.stringify({sheetName: currentKategoriNilai}))}`);
    const jsonNilai = await resNilai.json();
    rawDataNilai = jsonNilai.status === 'success' ? jsonNilai.data.filter(d => d["Mata Pelajaran"] == mapel && d["Tahun"] == currentTahun && d["Tingkat/Kelas"] == kelas && d["Semester"] == currentSemesterNilai) : [];

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
    currentKategoriNilai = document.getElementById('select-kategori-nilai').value; 
    
    // Ganti dropdown dinamis berdasarkan kategori
    const selMapel = document.getElementById('select-mapel-nilai');
    const listActive = currentKategoriNilai === "Data Nilai Eskul" ? cacheListEkskul : cacheListMapel;
    
    selMapel.innerHTML = listActive.map(m => `<option value="${m}" class="bg-slate-800 text-white">${m}</option>`).join('');
    
    loadDataNilai(); 
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
        <div class="truncate font-semibold">Nama Siswa</div>
        <!-- Garis Handle Geser (Kursor berubah jadi panah geser) -->
        <div class="col-resizer absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-500/50 transition-colors"></div></th>
        ${head1}
        <th colspan="2" class="px-2 py-2 border-r border-white/10 bg-purple-900/40 border-b border-purple-500/30">Rerata CP</th>
        <th class="px-2 py-2 border-r border-white/10 bg-yellow-900/40">UTS</th><th class="px-2 py-2 border-r border-white/10 bg-red-900/40">UAS</th>
        <th colspan="2" class="px-2 py-2 border-r border-white/10 bg-green-900/40 border-b border-green-500/30">NILAI RAPORT</th>
        
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
        <th class="px-1 py-1 border-r border-b border-white/10 bg-green-900/20">Nilai Akhir</th><th class="px-1 py-1 border-r border-b border-white/10 bg-green-900/20 text-slate-300">Predikat</th>
        <th class="px-1 py-1 bg-slate-800 border-r border-b border-white/10">Catatan</th>
      </tr>
    </thead>
  `;

  const tbodyHTML = listMuridKelas.map((m, idx) => {
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

function kalkulasiPengetahuan(nis, isFromUndo = false) {
  const maxKD = configNilaiAktif.active_kd; const bobotCP = configNilaiAktif.bobot.cp / 100; const bobotUTS = configNilaiAktif.bobot.uts / 100; const bobotUAS = configNilaiAktif.bobot.uas / 100;
  let totalRerataKD = 0; let kdTeriisi = 0; let updates = {}; 

  for(let i=0; i<maxKD; i++) {
    let ltr = LETTERS_KD[i];
    const t1 = validateVal(`N_${nis}_KD_${ltr}_T1`, nis, isFromUndo);
    const t2 = validateVal(`N_${nis}_KD_${ltr}_T2`, nis, isFromUndo);
    const uh = validateVal(`N_${nis}_KD_${ltr}_UH`, nis, isFromUndo);
    
    let arrKD = []; if(t1 !== "") arrKD.push(Number(t1)); if(t2 !== "") arrKD.push(Number(t2)); if(uh !== "") arrKD.push(Number(uh));
    let rta = arrKD.length > 0 ? Math.round(calcRerata(arrKD)) : ""; 
    let prd = rta !== "" ? hitungPredikat(rta) : "-";
    
    // [UPDATE REQ 1] Perubahan Warna Dinamis via JS
    document.getElementById(`LBL_${nis}_KD_${ltr}_Rerata`).innerText = rta; updateWarnaEl(`LBL_${nis}_KD_${ltr}_Rerata`, rta);
    document.getElementById(`PRD_${nis}_KD_${ltr}`).innerText = prd; updateWarnaEl(`PRD_${nis}_KD_${ltr}`, rta);
    
    updates[`KD ${ltr} T1`] = t1; updates[`KD ${ltr} T2`] = t2; updates[`KD ${ltr} UH`] = uh; 
    updates[`KD ${ltr} Rata-rata`] = rta; updates[`KD ${ltr} Predikat`] = prd;
    if(rta !== "") { totalRerataKD += Number(rta); kdTeriisi++; }
  }

  let rerataCP = kdTeriisi > 0 ? Math.round(totalRerataKD / kdTeriisi) : "";
  document.getElementById(`LBL_${nis}_RerataCP`).innerText = rerataCP; updateWarnaEl(`LBL_${nis}_RerataCP`, rerataCP);
  document.getElementById(`PRD_${nis}_RerataCP`).innerText = rerataCP !== "" ? hitungPredikat(rerataCP) : "-"; updateWarnaEl(`PRD_${nis}_RerataCP`, rerataCP);
  updates["Rerata CP"] = rerataCP;

  const uts = validateVal(`N_${nis}_UTS`, nis, isFromUndo), uas = validateVal(`N_${nis}_UAS`, nis, isFromUndo);
  updates["UTS"] = uts; updates["UAS/UKK"] = uas;

  let nilaiAkhir = "", akhirPrd = "-";
  if (rerataCP !== "" || uts !== "" || uas !== "") {
    nilaiAkhir = Math.round((Number(rerataCP)||0) * bobotCP + (Number(uts)||0) * bobotUTS + (Number(uas)||0) * bobotUAS); 
    akhirPrd = hitungPredikat(nilaiAkhir);
  }
  
  document.getElementById(`LBL_${nis}_NilaiAkhir`).innerText = nilaiAkhir; updateWarnaEl(`LBL_${nis}_NilaiAkhir`, nilaiAkhir);
  document.getElementById(`PRD_${nis}_NilaiAkhir`).innerText = akhirPrd; updateWarnaEl(`PRD_${nis}_NilaiAkhir`, nilaiAkhir);
  updates["Nilai Akhir Raport"] = nilaiAkhir; updates["Predikat"] = akhirPrd;
  
  const ketEl = document.getElementById(`KET_${nis}`);
  if(ketEl) updates["Keterangan"] = ketEl.value;

  if(!isFromUndo) silentSaveNilai(nis, updates);
}

function toggleNamaSiswaNilai() { 
  showNamaSiswaNilai = !showNamaSiswaNilai; 
  if (currentKategoriNilai === "Data Nilai Pengetahuan") renderTabelPengetahuan();
  else if (currentKategoriNilai === "Data Nilai Keterampilan") renderTabelKeterampilan();
  else if (currentKategoriNilai === "Data Nilai Sikap") renderTabelSikap();
}

function showInfoKelas() {
  const kelas = document.getElementById('select-kelas-nilai').value;
  let pengurus = listMuridKelas.filter(m => m["Jabatan Kelas"]).map(m => `• ${m["Nama Lengkap"]} <span class="text-blue-300">(${m["Jabatan Kelas"]})</span>`).join('<br>');
  if(!pengurus) pengurus = "<i>Tidak ada data pengurus kelas</i>";
  let namaWali = getNamaWaliKelas(kelas);
  
  Swal.fire({ title: `<div class="text-lg font-bold">Info Kelas ${kelas}</div>`, html: `<div class="text-left text-sm text-slate-300 mt-2 bg-black/30 p-4 rounded border border-white/10"><p class="mb-1 text-[10px] uppercase tracking-wider text-slate-500 font-bold">Wali Kelas</p><p class="font-bold text-white mb-4"><i class="fa-solid fa-user-tie text-green-400"></i> ${namaWali}</p><p class="mb-1 text-[10px] uppercase tracking-wider text-slate-500 font-bold">Pengurus</p><p class="text-xs leading-relaxed">${pengurus}</p><<p><tr><td class="py-1 border-b border-white/10">Jumlah Siswa</td><td class="py-1 border-b border-white/10 text-white font-bold">: ${listMuridKelas.length} Siswa</td></tr></div><div></p></div>`, background: '#1e293b', color: '#fff', confirmButtonText: 'Tutup' });

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
  
  const ketEl = document.getElementById(`KET_${nis}`);
  if(ketEl) updates["Keterangan"] = ketEl.value;

  if(!isFromUndo) silentSaveNilai(nis, updates);
}

// [PERBAIKAN] Fix CORS Auto-Sync & Lengkapi Data Statis
function silentSaveNilai(nis, updates) {
  const mapel = document.getElementById('select-mapel-nilai').value; 
  const kelas = document.getElementById('select-kelas-nilai').value;
  const mSiswa = listMuridKelas.find(m => m.NIS == nis);
  
  // ID Akun Guru diambil secara otomatis dari akun yang sedang login
  const idGuruAktif = currentUser && currentUser.user ? (currentUser.user["ID Akun Guru"] || "") : "";
  
  const payload = {
    action: 'save_nilai_siswa', 
    sheetName: currentKategoriNilai, 
    nis: nis, 
    mapel: mapel, 
    tahun: currentTahun,
    static: { 
      "ID Akun Guru": idGuruAktif, // <--- Otomatis terisi dari akun login
      "Tahun": currentTahun, 
      "Semester": currentSemesterNilai, 
      "Bulan": currentBulan, 
      "Tingkat/Kelas": kelas, 
      "Wali Kelas": getNamaWaliKelas(kelas), 
      "Mata Pelajaran": currentKategoriNilai === "Data Nilai Eskul" ? "" : mapel,
      "Ekstrakurikuler": currentKategoriNilai === "Data Nilai Eskul" ? mapel : "",
      "No": listMuridKelas.findIndex(m=>m.NIS==nis)+1, 
      "NISN": mSiswa["NISN"], 
      "Nama": mSiswa["Nama Lengkap"], 
      "L/P": (mSiswa["Jenis Kelamin"]||"").toLowerCase().startsWith("l") ? "L" : "P" 
    },
    updates: updates
  };
  
  const Toast = Swal.mixin({ toast: true, position: 'bottom-end', showConfirmButton: false, timer: 1500, timerProgressBar: true, background: '#1e293b', color: '#fff' });
  
  return fetch(API_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
    .then(res => res.json())
    .then(data => { if(data.status === 'success') Toast.fire({ icon: 'success', title: 'Tersimpan' }); })
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
            updates["Keterangan"] = isCurrentUI ? document.getElementById(`KET_${m.NIS}`).value : "";

        } else if (currentKategoriNilai === "Data Nilai Sikap") { // <--- TAMBAHKAN BLOK INI
            if (isCurrentUI) kalkulasiSikap(m.NIS, true); 
            const LTRS = ['A','B','C','D'];
            for(let i=0; i<configNilaiAktif.active_cp; i++) {
                for(let j=1; j<=configNilaiAktif.active_sub_cp; j++) updates[`Observasi CP ${LTRS[i]} ${j}`] = isCurrentUI ? document.getElementById(`N_${m.NIS}_Obs_${LTRS[i]}_${j}`).value : "";
            }
            updates["Penilaian Diri"] = isCurrentUI ? document.getElementById(`N_${m.NIS}_Diri`).value : "";
            for(let j=1; j<=configNilaiAktif.active_teman; j++) updates[`Penilaian Teman Sejawat ${j}`] = isCurrentUI ? document.getElementById(`N_${m.NIS}_Teman_${j}`).value : "";
            updates["Nilai Jurnal"] = isCurrentUI ? document.getElementById(`N_${m.NIS}_Jurnal`).value : "";
            updates["Nilai Akhir Raport"] = isCurrentUI ? document.getElementById(`LBL_${m.NIS}_AkhirSikap`).innerText : "";
            updates["Predikat"] = isCurrentUI ? document.getElementById(`PRD_${m.NIS}_AkhirSikap`).innerText : "-";
            updates["Keterangan"] = isCurrentUI ? document.getElementById(`KET_${m.NIS}`).value : "";
        } else if (currentKategoriNilai === "Data Nilai Eskul") {
            if (isCurrentUI) kalkulasiEskul(m.NIS, true); 
            updates["Nilai"] = isCurrentUI ? document.getElementById(`N_${m.NIS}_Nilai`).value : "";
            updates["Predikat"] = isCurrentUI ? document.getElementById(`PRD_${m.NIS}_Eskul`).innerText : "-";
            updates["Deskripsi"] = isCurrentUI ? document.getElementById(`DESC_${m.NIS}_Eskul`).value : "";
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

      const payload = {
        action: 'save_nilai_masal', sheetName: currentKategoriNilai, id_guru: idGuruAktif,
        tahun: currentTahun, semester: sem, kelas: kelas, mapel: mapel, dataList: dataList
      };

      const res = await fetch(API_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
      const json = await supabaseFetch('get_master_data')
      if(json.status !== 'success') throw new Error(json.message);
    }

    await loadDataNilai(); 
    Swal.fire({toast:true, position:'top-end', icon:'success', title: isNewDatabase ? 'Database Diinisiasi!' : 'Seluruh Nilai Tersimpan!', showConfirmButton:false, timer:2000, background:'#1e293b', color:'#fff'});
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
          silentSaveNilai(act.nis, { [getColNameFromID(act.elId)] : act.oldVal }); 
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
          silentSaveNilai(act.nis, { [getColNameFromID(act.elId)] : act.newVal }); 
      }
  }
}



// [REQ 1] Popup Setting Kolom
function openPengaturanKolomNilai() {
    if (currentKategoriNilai === "Data Nilai Pengetahuan") openPengaturanKolomPengetahuan();
    else if (currentKategoriNilai === "Data Nilai Keterampilan") openPengaturanKolomKeterampilan();
    else if (currentKategoriNilai === "Data Nilai Sikap") openPengaturanKolomSikap();
    else Swal.fire({icon: 'info', title: 'Info', text: 'Set Kolom untuk kategori ini sedang disiapkan.', background: '#1e293b', color: '#fff'});
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
      
      const mapel = document.getElementById('select-mapel-nilai').value;
      Swal.fire({ title: 'Menyimpan Pengaturan...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
      
      try {
          const response = await fetch(API_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'save_konfigurasi_nilai', sheetName: currentKategoriNilai, mapel: mapel, config: configNilaiAktif }) });
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
      
      const mapel = document.getElementById('select-mapel-nilai').value;
      Swal.fire({ title: 'Menyimpan Pengaturan...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
      
      try {
          const response = await fetch(API_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'save_konfigurasi_nilai', sheetName: currentKategoriNilai, mapel: mapel, config: configNilaiAktif }) });
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

  Swal.fire({
    title: '<div class="text-base font-bold text-blue-400"><i class="fa-solid fa-tools"></i> Set Kolom Sikap</div>',
    width: '500px',
    html: `
      <div class="text-left text-sm text-slate-300 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
        <label class="block text-[10px] font-bold mb-1 text-blue-300">Komponen Aktif</label>
        <div class="flex gap-2 mb-3">
            <div class="w-1/3 text-center"><span class="text-[9px]">Jml CP (Max 4)</span><input type="number" id="cfg_cp_count" value="${cur.active_cp}" max="4" min="1" class="w-full bg-slate-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-blue-400" onchange="updateVis('cp', this.value)"></div>
            <div class="w-1/3 text-center"><span class="text-[9px]">Sub-CP (Max 4)</span><input type="number" id="cfg_sub_count" value="${cur.active_sub_cp}" max="4" min="1" class="w-full bg-slate-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-indigo-400" onchange="updateVis('sub', this.value)"></div>
            <div class="w-1/3 text-center"><span class="text-[9px]">Jml Teman (Max 5)</span><input type="number" id="cfg_teman_count" value="${cur.active_teman}" max="5" min="0" class="w-full bg-slate-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-yellow-400"></div>
        </div>

        <label class="block text-[10px] font-bold mt-2 text-blue-300">Edit Label Observasi CP</label>
        ${genInputs('cp', cur.active_cp, cur.labels.cp, 'CP')}
        
        <label class="block text-[10px] font-bold mt-2 text-indigo-300">Edit Label Sub-CP</label>
        ${genInputs('sub', cur.active_sub_cp, cur.labels.sub, 'Sub')}
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
      let temanCount = parseInt(popup.querySelector('#cfg_teman_count').value) || 5; // [REQ 3]

      configNilaiAktif = { 
        active_cp: cpCount > 4 ? 4 : cpCount, active_sub_cp: subCount > 4 ? 4 : subCount, active_teman: temanCount > 5 ? 5 : temanCount,
        labels: { cp: getArr('cp'), sub: getArr('sub') }
      };
      
      const mapel = document.getElementById('select-mapel-nilai').value;
      Swal.fire({ title: 'Menyimpan Pengaturan...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
      await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'save_konfigurasi_nilai', sheetName: currentKategoriNilai, mapel: mapel, config: configNilaiAktif }) });
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
      for(let j=1; j<=cfg.active_teman; j++) optHtml += `<option value="Teman_${j}" class="bg-slate-800 text-white">Teman Sejawat ${j}</option>`;
      optHtml += `<option value="Jurnal" class="bg-slate-800 text-white">Nilai Jurnal</option><option value="AkhirSikap" class="bg-slate-800 font-bold text-green-300">Nilai Akhir Raport</option>`;
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
    let el = document.getElementById(`N_${nis}_${field}`);
    if(el) {
        recordUndo(nis, el.id, el.value, val);
        el.value = val;
        // Kalkulasi Live UI
        if (currentKategoriNilai === "Data Nilai Pengetahuan") kalkulasiPengetahuan(nis, true);
        else if (currentKategoriNilai === "Data Nilai Keterampilan") kalkulasiKeterampilan(nis, true);
        else if (currentKategoriNilai === "Data Nilai Sikap") kalkulasiSikap(nis, true);
    }
}

async function hapusPilihanAbsen() {
    const konfirmasi = await confirmDialog(
        'Kosongkan Data?', 
        'Apakah Anda yakin ingin menghapus pilihan absensi (H, S, I, A) yang belum disimpan?'
    );
    
    if (konfirmasi) {
        const inputs = document.querySelectorAll('.input-absen-siswa'); 
        
        inputs.forEach(input => {
            if (!input.disabled) {
                input.value = ''; // Kosongkan nilainya
            }
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
        for(let j=1; j<=cfg.active_teman; j++) headers.push(`Teman_${j}`);
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

  let rowsHTML = listMuridKelas.map((m, idx) => {
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
window.exportNilaiExcel = function() {
  const m = document.getElementById('select-mapel-nilai').value, k = document.getElementById('select-kelas-nilai').value;
  const blob = new Blob([`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body>${getExportHTMLNilai()}</body></html>`], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `Nilai_${m}_${k}.xls`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500); // FIX LOW-BUG: revoke blob URL
};

// ==========================================
// ROUTER EXPORT PDF
// ==========================================
function exportNilaiPDF() {
  let htmlRaw = "";
  
  // Routing berdasarkan kategori nilai yang sedang aktif
  if (currentKategoriNilai === "Data Nilai Pengetahuan") {
      htmlRaw = getExportHTMLPengetahuan();
  } else if (currentKategoriNilai === "Data Nilai Keterampilan") {
      htmlRaw = getExportHTMLKeterampilan();
  } else if (currentKategoriNilai === "Data Nilai Sikap") {
      htmlRaw = getExportHTMLSikap(); // <--- ROUTING UNTUK NILAI SIKAP
  } else {
      Swal.fire({
          icon: 'info', 
          title: 'Perhatian', 
          text: 'Export PDF untuk kategori ini belum tersedia.', 
          background: '#1e293b', color: '#fff'
      });
      return;
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

  let rowsHTML = listMuridKelas.map((m, idx) => {
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
  let temanH2 = '';
  for(let j=1; j<=cfg.active_teman; j++) temanH2 += `<th style="border: 1px solid #333; padding: 4px; background: #f8fafc;">${j}</th>`;

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
            <th colspan="${cfg.active_teman}" style="border: 1px solid #333; padding: 4px; background: #e2e8f0;">Teman Sejawat</th>
            <th rowspan="2" style="border: 1px solid #333; padding: 4px; background: #e2e8f0;">Jurnal</th>
            <th rowspan="2" style="border: 1px solid #333; padding: 4px; background: #d1fae5;">Nilai<br>Akhir</th>
            <th rowspan="2" style="border: 1px solid #333; padding: 4px; background: #d1fae5;">Predikat</th>
          </tr>
          <tr>${obsH2}${temanH2}</tr>
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
    for(let j=1; j<=cfg.active_teman; j++) rowData += `<td style="border: 1px solid #333; padding: 4px;">${dt[`Teman Sejawat ${j}`] || ''}</td>`;
    
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

  let rowsHTML = listMuridKelas.map((m, idx) => {
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


async function silentSaveNilai(nis, updates) {
  // 1. Ambil konteks saat ini dari UI/State aplikasi
  const mapel = document.getElementById('select-mapel-nilai').value;
  const idGuruAktif = currentUser && currentUser.user ? (currentUser.user["ID Akun Guru"] || "") : "";

  // (Pastikan variabel global currentTahun dan currentSemesterNilai sudah diatur sebelumnya)

  // 2. Siapkan data yang akan disimpan/diperbarui
  const payloadData = {
    nis: nis,
    mapel: mapel,
    tahun_ajaran: currentTahun,
    semester: currentSemesterNilai,
    id_guru: idGuruAktif,
    ...updates // Menggabungkan objek updates ke dalam baris data
  };

  // 3. Siapkan Notifikasi Toast
  const Toast = Swal.mixin({ 
    toast: true, 
    position: 'bottom-end', 
    showConfirmButton: false, 
    timer: 1500, 
    timerProgressBar: true,
    background: '#1e293b', 
    color: '#fff' 
  });

  try {
    // 4. Eksekusi Upsert menggunakan Supabase
    // PERBAIKAN: Menggunakan 'supabase' (tanpa underscore)
    // Pastikan tabel Anda bernama 'nilai_siswa' dan memiliki Unique Constraint (kombinasi 4 kolom ini)
    const { data, error } = await supaClient
      .from('nilai_siswa') 
      .upsert(payloadData, { onConflict: 'nis, mapel, semester, tahun_ajaran' });

    if (error) {
      throw error; // Lempar error agar ditangkap oleh blok catch di bawah
    }

    // Jika sukses
    Toast.fire({ icon: 'success', title: 'Tersimpan' });

  } catch (error) {
    console.error("Error silent save nilai:", error);
    Toast.fire({ icon: 'error', title: 'Gagal Simpan!' });
  }
}

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
        <div class="truncate font-semibold">Nama Siswa</div>
        <!-- Garis Handle Geser (Kursor berubah jadi panah geser) -->
        <div class="col-resizer absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-500/50 transition-colors"></div></th>
        ${head1}
        <th rowspan="2" class="px-2 py-2 border-r border-b border-white/10 bg-indigo-900/40 text-[9px]">Rerata<br>Optimum</th>
        ${projH1}
        ${portH1}
        <th colspan="2" class="px-2 py-2 border-r border-white/10 bg-green-900/40 border-b border-green-500/30">NILAI RAPORT</th>
        
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
        <th class="px-2 py-1 border-r border-b border-white/10 bg-green-900/20">Nilai Akhir</th><th class="px-1 py-1 border-r border-b border-white/10 bg-green-900/20 text-slate-300">Predikat</th>
      </tr>
    </thead>
  `;

  const tbodyHTML = listMuridKelas.map((m, idx) => {
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
            if(isKosongAtauKurang(dt[`Observasi CP ${LTRS[i]} ${j}`])) tunggakan.push(`Obs ${lblCP}-${cfg.labels?.sub[j-1] || j}`);
        }
    }
    if(isKosongAtauKurang(dt["Penilaian Diri"])) tunggakan.push("Penilaian Diri");
    for(let j=1; j<=cfg.active_teman; j++) {
        if(isKosongAtauKurang(dt[`Penilaian Teman Sejawat ${j}`])) tunggakan.push(`Teman Sejawat ${j}`);
    }
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
        const getUrl = (sheet) => `${API_URL}?action=get_data_nilai&t=${new Date().getTime()}&data=${encodeURIComponent(JSON.stringify({sheetName: sheet}))}`;
        const getCfg = (sheet) => `${API_URL}?action=get_konfigurasi_nilai&t=${new Date().getTime()}&data=${encodeURIComponent(JSON.stringify({sheetName: sheet, mapel: mapel}))}`;

        // Fetch seluruh data 3 Sheet secara paralel (Sangat Cepat)
        const [resP, resK, resS, cfgP, cfgK, cfgS] = await Promise.all([
            fetch(getUrl("Data Nilai Pengetahuan")).then(r => r.json()),
            fetch(getUrl("Data Nilai Keterampilan")).then(r => r.json()),
            fetch(getUrl("Data Nilai Sikap")).then(r => r.json()),
            fetch(getCfg("Data Nilai Pengetahuan")).then(r => r.json()),
            fetch(getCfg("Data Nilai Keterampilan")).then(r => r.json()),
            fetch(getCfg("Data Nilai Sikap")).then(r => r.json())
        ]);

        const filterData = (json) => json.status === 'success' ? json.data.filter(d => d["Mata Pelajaran"] == mapel && d["Tahun"] == currentTahun && d["Tingkat/Kelas"] == kelas && d["Semester"] == currentSemesterNilai) : [];
        const dataP = filterData(resP); const dataK = filterData(resK); const dataS = filterData(resS);

        const cP = cfgP.data || { active_kd: 2, kds: [{name: "Bab 1"}, {name: "Bab 2"}] };
        const cK = cfgK.data || { active_cp: 2, active_sub_cp: 4, active_proj: 4, active_port: 4, labels: { cp: ["CP A","CP B"], proj: [], port: [] } };
        const cS = cfgS.data || { active_cp: 3, active_sub_cp: 3, active_teman: 5, labels: { cp: ["CP A","CP B","CP C"] } };

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
        labels: { cp: ["CP A","CP B","CP C","CP D"], sub: ["1","2","3","4"] }
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

  // [REQ 3] Header Teman Sejawat 1-5
  let temanH2 = '';
  for(let j=1; j<=cfg.active_teman; j++) temanH2 += `<th class="px-1 border-r border-b border-white/10 bg-yellow-900/20">${j}</th>`;

  const theadHTML = `
    <thead class="sticky top-0 z-40 shadow-lg">
      <tr class="bg-slate-800 text-slate-300 text-[10px] uppercase tracking-wider text-center border-b border-white/20">
        <th class="sticky left-0 bg-slate-800 z-50 px-2 py-2 border-r border-white/10 w-8 cursor-pointer hover:bg-slate-700 text-blue-400 shadow-md" onclick="toggleNamaSiswaNilai()">No</th>
        <!-- Ganti kode <th> Nama Siswa yang lama dengan ini: -->
        <th rowspan="2" class="th-nama-siswa sticky left-[32px] bg-slate-800 z-40 px-3 py-2 border-r border-b border-white/10 text-left align-middle select-none relative" style="display:${displayNama}; width: 160px; min-width: 50px;">
        <div class="truncate font-semibold">Nama Siswa</div>
        <!-- Garis Handle Geser (Kursor berubah jadi panah geser) -->
        <div class="col-resizer absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-500/50 transition-colors"></div></th>
        ${obsH1}
        <th rowspan="2" class="px-2 py-2 border-r border-b border-white/10 bg-indigo-900/40 text-[9px]">Penilaian<br>Diri</th>
        <th colspan="${cfg.active_teman}" class="px-2 py-2 border-r border-white/10 bg-yellow-900/40 border-b border-yellow-500/30">Teman Sejawat</th>
        <th rowspan="2" class="px-2 py-2 border-r border-b border-white/10 bg-yellow-900/40 text-[9px]">Modus<br>Teman</th>
        <th rowspan="2" class="px-2 py-2 border-r border-b border-white/10 bg-purple-900/40 text-[9px]">Nilai<br>Jurnal</th>
        <th colspan="2" class="px-2 py-2 border-r border-white/10 bg-green-900/40 border-b border-green-500/30">NILAI RAPORT</th>
        
        <!-- [REQ 7] KOLOM TUNGGAKAN BISA DI-TOGGLE -->
        <th rowspan="2" class="bg-red-900/30 border-r border-b border-white/10 cursor-pointer hover:bg-red-800 transition align-middle" onclick="toggleBelumTuntasNilai()" style="width: ${showBelumTuntasNilai ? '140px' : '30px'}; min-width: ${showBelumTuntasNilai ? '140px' : '30px'}; max-width: ${showBelumTuntasNilai ? '140px' : '30px'};">
            ${showBelumTuntasNilai ? '<div class="flex justify-between items-center px-1"><span class="text-[9px] text-red-300 font-bold tracking-normal leading-tight text-left">Belum<br>Tuntas</span> <button onclick="shareBelumTuntasWA(event)" class="bg-green-500 text-white px-1.5 py-1 rounded shadow hover:bg-green-400" title="Share WA"><i class="fa-brands fa-whatsapp"></i></button></div>' : '<i class="fa-solid fa-triangle-exclamation text-red-400" title="Klik lihat nilai belum tuntas"></i>'}
        </th>
        
        <th rowspan="2" class="bg-slate-800 border-r border-b border-white/10 align-middle"><div style="resize: horizontal; overflow: auto; min-width: 150px; width: 150px; padding: 8px;">Keterangan</div></th>
        </tr>
        <tr class="bg-slate-800 text-slate-400 text-[9px] text-center shadow-sm">
        <th class="sticky left-0 bg-slate-800 z-50 border-r border-b border-white/10"></th>
        ${obsH2}
        ${temanH2}
        <th class="px-2 py-1 border-r border-b border-white/10 bg-green-900/20 text-slate-300">Nilai Akhir</th><th class="px-1 py-1 border-r border-b border-white/10 bg-green-900/20 text-slate-300">Predikat</th>
      </tr>
    </thead>
  `;

  const tbodyHTML = listMuridKelas.map((m, idx) => {
    const dt = rawDataNilai.find(d => d.NIS == m.NIS) || {};
    let obsHTML = '';
    
    // [REQ 4] BACA KOLOM SESUAI DATABASE: CP A1, CP A2, dst.
    for(let i=0; i<cfg.active_cp; i++) {
      let ltr = LTRS[i]; 
      for(let j=1; j<=cfg.active_sub_cp; j++) {
          obsHTML += `<td class="border-b border-r border-white/5 p-0"><input type="number" onfocus="storeOldVal(this)" onblur="kalkulasiSikap('${m.NIS}')" id="N_${m.NIS}_CP_${ltr}${j}" value="${dt[`CP ${ltr}${j}`] || ''}" class="w-8 h-8 bg-transparent text-center text-[10px] text-white outline-none focus:bg-blue-600/30"></td>`;
      }
    }

    let temanHTML = '';
    for(let j=1; j<=cfg.active_teman; j++) temanHTML += `<td class="border-b border-r border-white/5 p-0"><input type="number" onfocus="storeOldVal(this)" onblur="kalkulasiSikap('${m.NIS}')" id="N_${m.NIS}_Teman_${j}" value="${dt[`Teman Sejawat ${j}`] || ''}" class="w-8 h-8 bg-yellow-900/10 text-center text-[10px] text-white outline-none focus:bg-yellow-600/30"></td>`;

    let valAkhir = dt["Nilai Akhir Raport"] || ''; 
    let prdAkhir = dt["Predikat"] || (valAkhir ? hitungPredikat(valAkhir) : '-');
    let modTeman = dt["Modus Teman"] || '';

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
        ${temanHTML}
        <td class="border-b border-r border-white/5 p-0 bg-yellow-900/20 text-center font-bold text-[10px] text-yellow-300" id="LBL_${m.NIS}_ModusTeman">${modTeman}</td>
        <td class="border-b border-r border-white/5 p-0"><input type="number" onfocus="storeOldVal(this)" onblur="kalkulasiSikap('${m.NIS}')" id="N_${m.NIS}_Jurnal" value="${dt["Nilai Jurnal"] || ''}" class="w-8 h-8 bg-purple-900/10 text-center text-[10px] text-white outline-none focus:bg-purple-600/30"></td>
        
        <!-- [REQ 6] NILAI AKHIR (INPUT) -->
        <td class="border-b border-r border-white/5 p-0 bg-green-900/10"><input type="number" onfocus="storeOldVal(this)" onblur="kalkulasiSikap('${m.NIS}')" id="N_${m.NIS}_AkhirSikap" value="${valAkhir}" class="w-10 h-8 bg-transparent text-center text-[12px] font-extrabold ${getWarnaPredikat(hitungPredikat(valAkhir))} outline-none focus:bg-green-600/30"></td>
        <td class="border-b border-r border-white/10 px-1 bg-green-900/10 text-center text-[12px] font-extrabold ${getWarnaPredikat(prdAkhir)}" id="PRD_${m.NIS}_AkhirSikap">${prdAkhir}</td>
        
        <td class="border-b border-r border-white/5 px-2 py-1 text-red-300 whitespace-normal bg-red-900/10 cursor-pointer align-middle" onclick="toggleBelumTuntasNilai()">${tHTML}</td>
        <td class="border-b border-r border-white/5 p-0 align-middle"><input type="text" onfocus="storeOldVal(this)" onblur="saveKeteranganNilai('${m.NIS}')" id="KET_${m.NIS}" value="${dt.Keterangan || ''}" class="w-full h-8 bg-transparent text-left px-2 text-[10px] text-white outline-none focus:bg-white/10"></td>
      </tr>
    `;
  }).join('');

  let footerInfo = `<b>INFO SIKAP:</b> CP Aktif (${cfg.active_cp}), Sub-CP per-Item (${cfg.active_sub_cp}), Teman Sejawat (${cfg.active_teman}). Modus dihitung khusus dari inputan Teman Sejawat. Nilai Akhir Raport diinput manual sesuai kebijakan.`;
  document.getElementById('tabel-nilai').innerHTML = `${theadHTML}<tbody>${tbodyHTML}</tbody><tfoot><tr class="bg-slate-800 text-[10px] text-slate-400 border-t border-white/20"><td colspan="100%" class="py-2 px-3 text-center">${footerInfo}</td></tr></tfoot>`;
  enableNamaSiswaResize();
}

function kalkulasiSikap(nis, isFromUndo = false) {
  const cfg = configNilaiAktif; 
  let updates = {}; 
  const LTRS = ['A','B','C','D'];
  
  const addVal = (elId, dbKey) => {
      let v = validateVal(elId, nis, isFromUndo);
      updates[dbKey] = v; return v;
  };

  // [REQ 4] Sinkronisasi baca tulis ke "CP A1", "CP B1", dst.
  for(let i=0; i<cfg.active_cp; i++) {
      for(let j=1; j<=cfg.active_sub_cp; j++) addVal(`N_${nis}_CP_${LTRS[i]}${j}`, `CP ${LTRS[i]}${j}`);
  }
  
  addVal(`N_${nis}_Diri`, "Penilaian Diri");
  
  // [REQ 5] Rumus Modus Khusus Penilaian Teman Sejawat
  let arrTeman = [];
  for(let j=1; j<=cfg.active_teman; j++) {
      let v = addVal(`N_${nis}_Teman_${j}`, `Teman Sejawat ${j}`);
      if(v !== "") arrTeman.push(Number(v));
  }
  let modusAkhir = calcModus(arrTeman);
  document.getElementById(`LBL_${nis}_ModusTeman`).innerText = modusAkhir; 
  updates["Modus Teman"] = modusAkhir;
  
  addVal(`N_${nis}_Jurnal`, "Nilai Jurnal");

  // [REQ 6] Nilai Akhir sebagai INPUT (Bukan Auto-kalkulasi)
  let vAkhir = validateVal(`N_${nis}_AkhirSikap`, nis, isFromUndo);
  let prdAkhir = vAkhir !== "" ? hitungPredikat(vAkhir) : "-";
  
  const elAkhir = document.getElementById(`N_${nis}_AkhirSikap`);
  if(elAkhir) { elAkhir.className = `w-10 h-8 bg-transparent text-center text-[12px] font-extrabold ${getWarnaPredikat(hitungPredikat(vAkhir))} outline-none focus:bg-green-600/30`; }
  
  document.getElementById(`PRD_${nis}_AkhirSikap`).innerText = prdAkhir; updateWarnaEl(`PRD_${nis}_AkhirSikap`, vAkhir);
  
  updates["Nilai Akhir Raport"] = vAkhir; 
  updates["Predikat"] = prdAkhir;

  const ketEl = document.getElementById(`KET_${nis}`);
  if(ketEl) updates["Keterangan"] = ketEl.value;

  if(!isFromUndo) silentSaveNilai(nis, updates);
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
    if (nilai === "" || nilai === null || isNaN(nilai)) return "-";
    const n = Number(nilai); 
    if (n >= 91) return "Sangat Baik"; 
    if (n >= 81) return "Baik"; 
    if (n >= 71) return "Cukup"; 
    return "Kurang";
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
            <div class="truncate font-semibold">Nama Siswa</div>
            <div class="col-resizer absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-500/50 transition-colors"></div>
          </th>
          <th class="px-2 py-2 border-r border-white/10 bg-indigo-900/40 w-20">Nilai Angka</th>
          <th class="px-2 py-2 border-r border-white/10 bg-green-900/40 w-32">Predikat Akhir</th>
          <th class="px-2 py-2 border-r border-white/10 bg-purple-900/40">Deskripsi Ketercapaian</th>
        </tr>
      </thead>
    `;

    const tbodyHTML = listMuridKelas.map((m, idx) => {
      const dt = rawDataNilai.find(d => d.NIS == m.NIS) || {};
      let valNilai = dt.Nilai || '';
      let valPred = dt.Predikat || (valNilai !== '' ? getPredikatEskul(valNilai) : '-');
      let valDesc = dt.Deskripsi || '';

      return `
        <tr class="hover:bg-white/5 transition text-xs" data-nis="${m.NIS}">
          <td class="sticky left-0 bg-[#0f172a] z-30 text-center border-b border-r border-white/10 px-2 cursor-pointer text-blue-400 font-bold group-hover:bg-slate-800" onclick="toggleNamaSiswaNilai()">${idx + 1}</td>
          <td class="sticky left-[32px] bg-[#0f172a] z-30 border-b border-r border-white/10 px-2 truncate text-left group-hover:bg-slate-800" style="display:${displayNama};">${m["Nama Lengkap"]}</td>
          
          <td class="border-b border-r border-white/5 p-0 bg-indigo-900/10">
              <input type="number" onfocus="storeOldVal(this)" onblur="kalkulasiEskul('${m.NIS}')" id="N_${m.NIS}_Nilai" value="${valNilai}" class="w-full h-10 bg-transparent text-center text-[12px] font-bold text-white outline-none focus:bg-indigo-600/30" placeholder="0-100">
          </td>
          <td class="border-b border-r border-white/5 p-0 bg-green-900/10 text-center text-[11px] font-extrabold ${getWarnaPredikatEskul(valPred)}" id="PRD_${m.NIS}_Eskul">${valPred}</td>
          <td class="border-b border-r border-white/5 p-0 bg-purple-900/10">
              <input type="text" onfocus="storeOldVal(this)" onblur="kalkulasiEskul('${m.NIS}')" id="DESC_${m.NIS}_Eskul" value="${valDesc}" class="w-full h-10 bg-transparent text-left px-3 text-[11px] text-white outline-none focus:bg-purple-600/30" placeholder="Contoh: Sangat baik dalam mengaplikasikan baris-berbaris...">
          </td>
        </tr>
      `;
    }).join('');

    tabelEl.innerHTML = `${theadHTML}<tbody>${tbodyHTML}</tbody><tfoot><tr class="bg-slate-800 text-[10px] text-slate-400 border-t border-white/20"><td colspan="100%" class="py-2 px-3 text-center"><b>PREDIKAT (KURIKULUM MERDEKA):</b> &nbsp; <span class="text-green-400 font-bold">Sangat Baik (91-100)</span> <span class="mx-1">|</span> <span class="text-blue-400 font-bold">Baik (81-90)</span> <span class="mx-1">|</span> <span class="text-yellow-400 font-bold">Cukup (71-80)</span> <span class="mx-1">|</span> <span class="text-red-400 font-bold">Kurang (0-70)</span></td></tr></tfoot>`;
    enableNamaSiswaResize();
}

function kalkulasiEskul(nis, isFromUndo = false) {
    let updates = {};
    let vNilai = validateVal(`N_${nis}_Nilai`, nis, isFromUndo);
    let prd = vNilai !== "" ? getPredikatEskul(vNilai) : "-";
    
    let prdEl = document.getElementById(`PRD_${nis}_Eskul`);
    if(prdEl) {
        prdEl.innerText = prd;
        prdEl.className = `border-b border-r border-white/5 p-0 bg-green-900/10 text-center text-[11px] font-extrabold ${getWarnaPredikatEskul(prd)}`;
    }
    
    const descEl = document.getElementById(`DESC_${nis}_Eskul`);
    let desc = descEl ? descEl.value : "";

    // Simpan ke Undo Tracking khusus input Text
    if (!isFromUndo && descEl && descEl.dataset.oldval !== desc && descEl.dataset.oldval !== undefined) {
        recordUndo(nis, `DESC_${nis}_Eskul`, descEl.dataset.oldval, desc);
        descEl.dataset.oldval = desc;
    }

    updates["Nilai"] = vNilai;
    updates["Predikat"] = prd;
    updates["Deskripsi"] = desc;

    if(!isFromUndo) silentSaveNilai(nis, updates);
}

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
        const listEkskul = [...new Set(masterDataCache.map(m => mdVal(m, "Ekstrakurikuler", "ekstrakurikuler")).filter(Boolean))];
        
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
                                <th class="px-4 py-3 border-b border-white/10">NIS / NISN</th>
                                <th class="px-4 py-3 border-b border-white/10">Nama Lengkap</th>
                                <th class="px-4 py-3 border-b border-white/10 text-center">Kelas & Tahun</th>
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

function generateTbodyMurid(data) {
    if (!data || data.length === 0) return `<tr><td colspan="6" class="p-6 text-center text-slate-500">Belum ada data murid yang tersimpan.</td></tr>`;
    
    return data.map((d, i) => {
        let nis = d.NIS || d.nis || d.nis_nip || "-";
        let nisn = d.NISN || d.nisn || "-";
        let nama = d["Nama Lengkap"] || d.Nama || d.nama || d.nama_lengkap || "Tanpa Nama";
        let kelas = d["Tingkat/Kelas"] || d.Kelas || d.tingkat_kelas || "-";
        let tahun = d["ID Tahun Pelajaran"] || d.tahun_pelajaran || "-";
        let email = d.Email || d.email || "-";
        let ekskulData = (d.Ekstrakurikuler || d.ekskul || d.ekstrakurikuler || "").replace(/"/g, '&quot;'); 

        return `
            <tr class="hover:bg-white/5 border-b border-white/5 transition row-murid" data-ekskul="${ekskulData}" data-tahun="${tahun}">
                <td class="px-4 py-3 text-center">${i+1}</td>
                <td class="px-4 py-3 font-mono text-blue-300 search-target">${nis}<br><span class="text-[9px] text-slate-500">${nisn}</span></td>
                <td class="px-4 py-3 font-bold search-target">${nama}</td>
                <td class="px-4 py-3 text-center search-target">
                    <span class="bg-indigo-900/50 text-indigo-300 px-2 py-1 rounded text-[10px]">${kelas}</span><br>
                    <span class="text-[9px] text-slate-400">${tahun}</span>
                </td>
                <td class="px-4 py-3"><div class="text-[10px] text-slate-400"><i class="fa-solid fa-envelope"></i> ${email}</div></td>
                <td class="px-4 py-3 text-center">
                    <button onclick='openFormAkunMurid(false, ${JSON.stringify(d).replace(/'/g, "&#39;")})' class="w-7 h-7 bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white rounded transition mr-1" title="Edit"><i class="fa-solid fa-pen"></i></button>
                    <button onclick="deleteAkunMurid('${nis}')" class="w-7 h-7 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded transition" title="Hapus"><i class="fa-solid fa-trash"></i></button>
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
    // Ambil Data dari Master Data
    const listKelas = [...new Set(masterDataCache.map(m => m["Tingkat/Kelas"]).filter(Boolean))];
    const listTahun = [...new Set(masterDataCache.map(m => m["Tahun Pelajaran"]).filter(Boolean))];
    const listEkskul = [...new Set(masterDataCache.map(m => m["Ekstrakurikuler"]).filter(Boolean))];
    const listJabatan = [...new Set(masterDataCache.map(m => m["Jabatan Kelas"]).filter(Boolean))]; // <--- TARIK DARI MASTER DATA

    // 2. Format HTML Dropdowns
    const optKelas = listKelas.map(k => `<option value="${k}" ${(data["Tingkat/Kelas"] || data.Kelas) === k ? 'selected' : ''}>${k}</option>`).join('');
    const optTahun = listTahun.map(t => `<option value="${t}" ${data["ID Tahun Pelajaran"] === t ? 'selected' : ''}>${t}</option>`).join('');
    const optJabatan = listJabatan.map(j => `<option value="${j}" ${data["Jabatan Kelas"] === j ? 'selected' : ''}>${j}</option>`).join(''); // <--- RENDER OPSI JABATAN
    
    // Format Checkboxes untuk Ekskul (Karena siswa bisa ikut lebih dari 1)
    let ekskulArr = (data.Ekstrakurikuler || "").split(',').map(e => e.trim());
    let chkEkskulHTML = listEkskul.map(e => `
        <label class="flex items-center gap-1.5 cursor-pointer hover:text-white bg-slate-800 p-1.5 rounded border border-white/10">
            <input type="checkbox" class="chk-ekskul-form" value="${e}" ${ekskulArr.includes(e) ? 'checked' : ''}>
            <span class="truncate">${e}</span>
        </label>
    `).join('');

    // Format Date (Tanggal Lahir)
    let tglLahirVal = data["Tgl Lahir"] || '';
    if (tglLahirVal.match(/^\d{2}-\d{2}-\d{4}$/)) {
        let p = tglLahirVal.split('-'); tglLahirVal = `${p[2]}-${p[1]}-${p[0]}`;
    } else if (tglLahirVal.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
        let p = tglLahirVal.split('/'); tglLahirVal = `${p[2]}-${p[1]}-${p[0]}`;
    }

    let formHTML = `
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left text-[11px] text-slate-300 mt-2 max-h-[65vh] overflow-y-auto custom-scrollbar p-1 pr-2">
            <div><label class="font-bold text-blue-300">ID Tahun Pelajaran</label>
                <select id="f_tahun" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none"><option value="">-- Pilih --</option>${optTahun}</select>
            </div>
            <div><label class="font-bold text-blue-300">ID Akun Murid</label><input id="f_idakun" value="${data["ID Akun Murid"] || ''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            
            <div><label class="font-bold text-blue-300">NIS *</label><input id="f_nis" value="${data.NIS || data.nis || ''}" ${!isNew?'readonly':''} class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            <div><label class="font-bold text-blue-300">NISN</label><input id="f_nisn" value="${data.NISN || data.nisn || ''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            
            <div class="sm:col-span-2"><label class="font-bold text-blue-300">Nama Lengkap *</label><input id="f_nama" value="${data["Nama Lengkap"] || data.Nama || data.nama || ''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            
            <div><label class="font-bold text-blue-300">Tingkat/Kelas</label>
                <select id="f_kelas" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none"><option value="">-- Pilih --</option>${optKelas}</select>
            </div>
            <div><label class="font-bold text-blue-300">Jenis Kelamin</label>
                <select id="f_jk" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none">
                    <option value="L" ${((data["Jenis Kelamin"] || data.JenisKelamin) === 'L')?'selected':''}>Laki-laki</option>
                    <option value="P" ${((data["Jenis Kelamin"] || data.JenisKelamin) === 'P')?'selected':''}>Perempuan</option>
                </select>
            </div>
            
            <div><label class="font-bold text-blue-300">Tanggal Lahir</label><input id="f_tgllahir" type="date" value="${tglLahirVal}" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500" style="color-scheme: dark;"></div>
            <div><label class="font-bold text-blue-300">Nama Ortu/Wali</label><input id="f_ortu" value="${data["Nama Ortu/Wali"] || ''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            
            <div class="sm:col-span-2"><label class="font-bold text-blue-300">Alamat Lengkap</label><input id="f_alamat" value="${data.Alamat || ''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            
            <div><label class="font-bold text-blue-300">No HP/WA</label><input id="f_wa" value="${data["No HP/WA"] || ''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            <div><label class="font-bold text-blue-300">Email Login</label><input id="f_email" type="email" value="${data.Email || data.email || ''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            
            <div class="sm:col-span-2">
                <label class="font-bold text-blue-300 mb-1 block">Ekstrakurikuler (Bisa pilih lebih dari satu)</label>
                <div class="grid grid-cols-2 gap-2 bg-black/20 p-2 rounded border border-white/10 max-h-32 overflow-y-auto">
                    ${chkEkskulHTML}
                </div>
            </div>

            <!-- TAMPILAN DROPDOWN JABATAN KELAS -->
            <div><label class="font-bold text-blue-300">Jabatan Kelas</label>
                <select id="f_jabatan" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none"><option value="">-- Tidak Ada --</option>${optJabatan}</select>
            </div>
            
            <div><label class="font-bold text-blue-300">ID Jadwal Pelajaran Murid</label><input id="f_jadwal" value="${data["ID Jadwal Pelajaran Murid"] || ''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            <div><label class="font-bold text-blue-300">Password</label><input id="f_pass" value="${data.Password || data.password || '123456'}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
            
            <div class="sm:col-span-2"><label class="font-bold text-blue-300">Catatan Khusus</label><input id="f_catatan" value="${data["Catatan Khusus"] || ''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-blue-500"></div>
        </div>
    `;

    Swal.fire({
        title: `<div class="text-lg font-bold">${isNew ? 'Tambah' : 'Edit'} Akun Murid</div>`,
        html: formHTML, width: 600, background: '#1e293b', color: '#fff',
        showCancelButton: true, confirmButtonText: '<i class="fa-solid fa-save"></i> Simpan Data',
        preConfirm: () => {
            let nisVal = document.getElementById('f_nis').value.trim();
            let namaVal = document.getElementById('f_nama').value.trim();
            if(!nisVal || !namaVal) { Swal.showValidationMessage('NIS dan Nama Lengkap wajib diisi!'); return false; }
            
            let ekskulChecked = [];
            document.querySelectorAll('.chk-ekskul-form:checked').forEach(el => ekskulChecked.push(el.value));
            
            let dateInput = document.getElementById('f_tgllahir').value;
            let formattedDate = dateInput;
            if (dateInput && dateInput.includes('-') && dateInput.split('-')[0].length === 4) {
                let p = dateInput.split('-'); formattedDate = `${p[2]}-${p[1]}-${p[0]}`; 
            }

            return {
                "ID Tahun Pelajaran": document.getElementById('f_tahun').value,
                "Semester": data.Semester || "Ganjil",
                "ID Akun Murid": document.getElementById('f_idakun').value.trim(),
                "NIS": nisVal,
                "NISN": document.getElementById('f_nisn').value.trim(),
                "Nama Lengkap": namaVal,
                "Tingkat/Kelas": document.getElementById('f_kelas').value,
                "Jenis Kelamin": document.getElementById('f_jk').value,
                "Tgl Lahir": formattedDate, 
                "Ekstrakurikuler": ekskulChecked.join(', '), 
                "Nama Ortu/Wali": document.getElementById('f_ortu').value.trim(),
                "Alamat": document.getElementById('f_alamat').value.trim(),
                "No HP/WA": document.getElementById('f_wa').value.trim(),
                "Email": document.getElementById('f_email').value.trim(),
                "Jabatan Kelas": document.getElementById('f_jabatan').value,
                "Catatan Khusus": document.getElementById('f_catatan').value.trim(),
                "ID Jadwal Pelajaran Murid": document.getElementById('f_jadwal').value.trim(),
                "Password": document.getElementById('f_pass').value.trim()
            };
        }
    }).then(async (res) => {
        if(res.isConfirmed) {
            Swal.fire({title: 'Menyimpan...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading()});
            try {
                const sendData = { action: 'save_akun', tipe: 'murid', isNew: isNew, data: res.value };
                const postRes = await fetch(API_URL, { 
                    method: 'POST', 
                    redirect: 'follow', 
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify(sendData) 
                });
                
                const json = await postRes.json();
                if(json.status === 'success') {
                    Swal.fire({toast:true, position:'top-end', icon:'success', title:'Data Tersimpan!', showConfirmButton:false, timer:2000, background: '#1e293b', color: '#fff'});
                    renderManajemenMurid(document.getElementById('main-content'));
                } else throw new Error(json.message);
            } catch(e) { 
                console.error("Save Error:", e);
                Swal.fire('Error', 'Gagal menyimpan. Pastikan internet stabil dan Web App URL valid.', 'error'); 
            }
        }
    });
}

// ==========================================
// LOGIKA FILTER & CETAK QR CODE MURID
// ==========================================
function openExportQRMurid() {
    // Ambil data unik dari cache untuk opsi dropdown
    const listTahun = [...new Set(cacheAkunMurid.map(m => m["ID Tahun Pelajaran"]).filter(Boolean))];
    const listKelas = [...new Set(cacheAkunMurid.map(m => m["Tingkat/Kelas"]).filter(Boolean))];
    const listSiswa = cacheAkunMurid.map(m => `<option value="${m.NIS}">${m.NIS} - ${m["Nama Lengkap"]}</option>`).join('');
    
    // Pecah ekstrakurikuler jika pakai koma
    let rawEkskul = [];
    cacheAkunMurid.forEach(m => { if(m.Ekstrakurikuler) rawEkskul = rawEkskul.concat(m.Ekstrakurikuler.split(',').map(e => e.trim())); });
    const listEkskul = [...new Set(rawEkskul)].filter(Boolean);

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
        filtered = filtered.filter(m => m.NIS === config.siswa);
    } else {
        if (config.tahun !== 'ALL') filtered = filtered.filter(m => m["ID Tahun Pelajaran"] === config.tahun);
        if (config.kelas !== 'ALL') filtered = filtered.filter(m => m["Tingkat/Kelas"] === config.kelas);
        if (config.ekskul !== 'ALL') filtered = filtered.filter(m => {
            const e = m.Ekstrakurikuler || "";
            return e.split(',').map(x => x.trim()).includes(config.ekskul);
        });
    }

    if(filtered.length === 0) return Swal.fire('Kosong', 'Tidak ada siswa yang cocok dengan filter tersebut.', 'warning');

    const printWindow = window.open('', '_blank');
    
    // FIX LOW-BUG: popup blocker guard sebelum menulis ke jendela cetak kartu QR
    if (!printWindow) return Swal.fire({ icon: 'error', title: 'Popup Diblokir', text: 'Izinkan popup untuk mencetak kartu QR.', background: '#1e293b', color: '#fff' });

    let htmlCards = filtered.map(m => {
        let qrDataVal = config.target === 'NISN' ? (m.NISN || m.NIS) : m.NIS;
        // Memperkecil resolusi QR agar load lebih cepat (80x80)
        let qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=80x80&margin=0&data=${encodeURIComponent(qrDataVal)}`;
        
        return `
            <div class="qr-card">
                <div class="card-header">
                    <h4>${m["Nama Lengkap"]}</h4>
                    <p>${m["Tingkat/Kelas"] || '-'}</p>
                </div>
                <img src="${qrUrl}" alt="QR Code"/>
                <div class="card-footer">
                    <p class="qr-val">${qrDataVal}</p>
                    ${config.label_mapel ? `<span class="lbl-mapel">${config.label_mapel}</span>` : ''}
                    ${config.ekskul !== 'ALL' ? `<span class="lbl-eks">${config.ekskul}</span>` : ''}
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

async function simpanAkunMurid(formData) {
  // formData diasumsikan berupa objek { nis: '12345', nama: 'Budi', kelas: 'X RPL 1', password: '***' }
  
  Swal.fire({ title: 'Menyimpan Data...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

  const { data, error } = await supaClient
    .from('siswa') // Nama tabel data induk siswa
    .upsert(formData, { onConflict: 'nis' }); // 'nis' adalah Primary Key di tabel Supabase

  if (error) {
    console.error("Error simpan akun murid:", error);
    Swal.fire({ icon: 'error', title: 'Gagal', text: error.message, background: '#1e293b', color: '#fff' });
  } else {
    Swal.fire({ icon: 'success', title: 'Berhasil', text: 'Data murid berhasil disimpan', background: '#1e293b', color: '#fff' });
    
    // Refresh tabel/list manajemen murid setelah simpan
    if (typeof renderManajemenMurid === 'function') {
      renderManajemenMurid(document.getElementById('main-content'));
    }
  }
}

function deleteAkunMurid(nisKey) {
    Swal.fire({
        title: 'Yakin Hapus?', text: "Data akun murid akan dihapus permanen dari Google Sheets.", icon: 'warning',
        background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Ya, Hapus'
    }).then(async (result) => {
        if (result.isConfirmed) {
            Swal.fire({title: 'Menghapus...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading()});
            try {
                const sendData = { action: 'delete_akun', tipe: 'murid', key: nisKey };
                const postRes = await fetch(API_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(sendData) });
                const json = await postRes.json();
                if(json.status === 'success') {
                    Swal.fire({toast:true, position:'top-end', icon:'success', title:'Terhapus!', showConfirmButton:false, timer:1500, background: '#1e293b', color: '#fff'});
                    renderManajemenMurid(document.getElementById('main-content'));
                } else throw new Error(json.message);
            } catch(e) { 
                Swal.fire({icon: 'error', title: 'Gagal', text: e.message, background: '#1e293b', color: '#fff'}); 
            }
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
    
    // Sesuaikan header dengan skema database akun murid
    const headers = [
        "ID Tahun Pelajaran", "Semester", "ID Akun Murid", "NIS", "NISN", "Nama Lengkap", "Tingkat/Kelas", 
        "Jenis Kelamin", "Tgl Lahir", "Nama Ortu/Wali", "Alamat", "No HP/WA", 
        "Email", "Ekstrakurikuler", "Jabatan Kelas", "ID Jadwal Pelajaran Murid", "Password", "Catatan Khusus"
    ];
    
    const dataRows = [
        ["FORMAT IMPORT DATA MURID"],
        ["INFO", "Isi baris di bawah header dengan data murid. Kolom NIS dan Nama Lengkap wajib diisi."],
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
            
            const headers = jsonArray[2]; 
            let validData = [];
            
            for(let i=3; i<jsonArray.length; i++) {
                let row = jsonArray[i];
                if(!row || !row[3]) continue; // Skip jika kolom NIS (index 3) kosong
                
                let obj = {};
                headers.forEach((h, idx) => {
                    obj[h] = row[idx] !== undefined ? row[idx] : "";
                });
                
                obj["tipe"] = "murid";
                validData.push(obj);
            }
            
            if(validData.length === 0) throw new Error("Tidak ada data murid yang ditemukan untuk diimport.");

            simpanMasalAkunMurid(validData);

        } catch(err) {
            Swal.fire('Error Import', err.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

async function simpanMasalAkunMurid(dataMurid) {
    Swal.fire({ title: 'Menyimpan Data...', html: `Memproses ${dataMurid.length} murid`, allowOutsideClick: false, didOpen: () => Swal.showLoading(), background: '#1e293b', color: '#fff' });

    try {
        const { error } = await supaClient
            .from('akun')
            .upsert(dataMurid, { onConflict: 'NIS' }); // Sesuaikan dengan Primary Key/Unique key constraint database Anda

        if (error) throw error;
        
        Swal.fire({ icon: 'success', title: 'Berhasil', text: `${dataMurid.length} Data murid berhasil diimport!`, background: '#1e293b', color: '#fff' });
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
// Identitas sekolah (baris tunggal) + daftar tahun/kelas/mapel/ekskul.
// Kolom tabel master_data: nama_sekolah, url_logo, tahun_pelajaran,
// tingkat_kelas, mata_pelajaran, ekstrakurikuler.
// ==========================================

let currentTabMaster = 'identitas';

function renderMasterDataModule(container) {
    const tab = currentTabMaster;
    const tabBtn = (id, label, icon) => `
        <button onclick="gantiTabMaster('${id}')" class="px-4 py-2 rounded-lg text-xs font-bold transition ${currentTabMaster === id ? 'bg-blue-600 text-white shadow-md' : 'bg-white/10 text-slate-300 hover:bg-white/20'}">
            <i class="fa-solid ${icon} mr-1"></i> ${label}
        </button>`;

    container.innerHTML = `
        <div class="glass-card rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex flex-col h-[85vh]">
            <div class="bg-slate-800/80 p-4 border-b border-white/10 flex flex-col sm:flex-row justify-between items-center gap-3">
                <h2 class="text-sm sm:text-base font-bold text-white uppercase tracking-wider"><i class="fa-solid fa-database text-purple-400 mr-2"></i> Master Data</h2>
                <div class="flex gap-2">
                    ${tabBtn('identitas', 'Identitas', 'fa-school')}
                    ${tabBtn('daftar', 'Tahun / Kelas / Mapel / Ekskul', 'fa-list')}
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
    masterDataCache = data || []; // refresh cache bersama
    return masterDataCache;
}

async function renderTabIdentitas() {
    const box = document.getElementById('content-master');
    box.innerHTML = `<div class="p-6 text-center text-slate-300"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>Memuat...</div>`;
    try {
        const rows = await ambilMasterData();
        const idn = rows.find(r => r.nama_sekolah) || rows[0] || {};
        box.innerHTML = `
            <div class="max-w-lg mx-auto space-y-3 text-left text-[11px] text-slate-300">
                <p class="text-[10px] text-slate-400"><i class="fa-solid fa-circle-info"></i> Baris identitas dipakai header aplikasi (logo & nama sekolah). Simpan hanya satu baris identitas.</p>
                <div><label class="font-bold text-purple-300">Nama Sekolah</label><input id="m_nama_sekolah" value="${idn.nama_sekolah || ''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-purple-500"></div>
                <div><label class="font-bold text-purple-300">URL Logo</label><input id="m_url_logo" value="${idn.url_logo || ''}" placeholder="https://..." class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none focus:border-purple-500"></div>
                <div class="pt-2"><button onclick="simpanIdentitasMaster('${idn.id ?? ''}')" class="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-md"><i class="fa-solid fa-save"></i> Simpan Identitas</button></div>
            </div>
        `;
    } catch (e) {
        box.innerHTML = `<div class="p-6 text-center text-red-400">Gagal memuat: ${escapeHtml(e.message || '')}</div>`;
    }
}

async function simpanIdentitasMaster(rowId) {
    const payload = {
        nama_sekolah: document.getElementById('m_nama_sekolah').value.trim(),
        url_logo: document.getElementById('m_url_logo').value.trim()
    };
    if (!payload.nama_sekolah) { showToast('error', 'Nama sekolah wajib diisi.'); return; }
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

async function renderTabDaftar() {
    const box = document.getElementById('content-master');
    box.innerHTML = `<div class="p-6 text-center text-slate-300"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>Memuat...</div>`;
    try {
        const rows = await ambilMasterData();
        const daftar = rows.filter(r => r.tahun_pelajaran || r.tingkat_kelas || r.mata_pelajaran || r.ekstrakurikuler);
        box.innerHTML = `
            <div class="max-w-3xl mx-auto">
                <div class="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-4 text-[11px]">
                    <input id="m_tahun" placeholder="Tahun (2026/2027)" class="bg-black/40 border border-white/20 rounded px-2 py-1.5 text-white outline-none focus:border-purple-500">
                    <input id="m_kelas" placeholder="Kelas (X RPL 1)" class="bg-black/40 border border-white/20 rounded px-2 py-1.5 text-white outline-none focus:border-purple-500">
                    <input id="m_mapel" placeholder="Mata Pelajaran" class="bg-black/40 border border-white/20 rounded px-2 py-1.5 text-white outline-none focus:border-purple-500">
                    <div class="flex gap-2">
                        <input id="m_ekskul" placeholder="Ekstrakurikuler" class="flex-1 bg-black/40 border border-white/20 rounded px-2 py-1.5 text-white outline-none focus:border-purple-500">
                        <button onclick="tambahBarisMaster()" class="bg-purple-600 hover:bg-purple-700 text-white px-3 rounded-lg font-bold shadow-md"><i class="fa-solid fa-plus"></i></button>
                    </div>
                </div>
                <table class="w-full text-left text-xs text-slate-200">
                    <thead class="text-[10px] uppercase text-slate-400 border-b border-white/10">
                        <tr><th class="py-2">Tahun</th><th class="py-2">Kelas</th><th class="py-2">Mapel</th><th class="py-2">Ekskul</th><th class="py-2 text-center">Aksi</th></tr>
                    </thead>
                    <tbody>
                        ${daftar.length === 0 ? `<tr><td colspan="5" class="py-6 text-center text-slate-500">Belum ada data. Isi form di atas lalu klik +.</td></tr>` :
                          daftar.map(r => `
                            <tr class="border-b border-white/5 hover:bg-white/5">
                                <td class="py-2">${r.tahun_pelajaran || '-'}</td>
                                <td class="py-2">${r.tingkat_kelas || '-'}</td>
                                <td class="py-2">${r.mata_pelajaran || '-'}</td>
                                <td class="py-2">${r.ekstrakurikuler || '-'}</td>
                                <td class="py-2 text-center"><button onclick="hapusBarisMaster(${r.id ?? 0}, '${escJs(JSON.stringify(r)).replace(/"/g, '&quot;')}')" class="w-6 h-6 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded" title="Hapus"><i class="fa-solid fa-trash text-[10px]"></i></button></td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (e) {
        box.innerHTML = `<div class="p-6 text-center text-red-400">Gagal memuat: ${escapeHtml(e.message || '')}</div>`;
    }
}

async function tambahBarisMaster() {
    const payload = {
        tahun_pelajaran: document.getElementById('m_tahun').value.trim(),
        tingkat_kelas: document.getElementById('m_kelas').value.trim(),
        mata_pelajaran: document.getElementById('m_mapel').value.trim(),
        ekstrakurikuler: document.getElementById('m_ekskul').value.trim()
    };
    if (!payload.tahun_pelajaran && !payload.tingkat_kelas && !payload.mata_pelajaran && !payload.ekstrakurikuler) {
        showToast('error', 'Isi minimal satu kolom.'); return;
    }
    Swal.fire({ title: 'Menyimpan...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
    try {
        const { error } = await supaClient.from('master_data').insert(payload);
        if (error) throw error;
        await ambilMasterData();
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Baris ditambahkan!', showConfirmButton: false, timer: 1500, background: '#1e293b', color: '#fff' });
        renderTabDaftar();
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Gagal', text: e.message, background: '#1e293b', color: '#fff' });
    }
}

async function hapusBarisMaster(rowId, jsonRow) {
    Swal.fire({ title: 'Menghapus...', allowOutsideClick: false, background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
    try {
        let error;
        if (rowId) {
            ({ error } = await supaClient.from('master_data').delete().eq('id', rowId));
        } else {
            // Tabel tanpa id → hapus dengan mencocokkan seluruh nilai baris
            const match = JSON.parse(jsonRow);
            ({ error } = await supaClient.from('master_data').delete().match(match));
        }
        if (error) throw error;
        await ambilMasterData();
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Terhapus!', showConfirmButton: false, timer: 1500, background: '#1e293b', color: '#fff' });
        renderTabDaftar();
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
        const nama = d.nama_lengkap || d["Nama Guru"] || 'Tanpa Nama';
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
    const listKelas = [...new Set(masterDataCache.map(m => mdVal(m, "Tingkat/Kelas", "tingkat_kelas")).filter(Boolean))];
    const listMapel = [...new Set(masterDataCache.map(m => mdVal(m, "Mata Pelajaran", "mata_pelajaran")).filter(Boolean))];
    const listEkskul = [...new Set(masterDataCache.map(m => mdVal(m, "Ekstrakurikuler", "ekstrakurikuler")).filter(Boolean))];
    const listJabatanGuru = [...new Set(masterDataCache.map(m => mdVal(m, "Jabatan Guru", "jabatan_guru")).filter(Boolean))];

    // 2. Nilai existing (snake_case dulu, fallback format lama)
    const namaV = data.nama_lengkap || data["Nama Guru"] || "";
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
                    </div>
                </div>
                
                <div id="content-jadwal-libur" class="flex-1 overflow-auto custom-scrollbar bg-[#0f172a]">
                    ${currentTabJadwal === 'libur' ? getHTMLHariLibur() : getHTMLJadwalPelajaran()}
                </div>
            </div>
        `;
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

    Swal.fire({
        title: `<div class="text-lg font-bold">${isNew ? 'Tambah' : 'Edit'} Jadwal</div>`,
        html: `
            <div class="text-left text-[11px] text-slate-300 mt-2 grid grid-cols-2 gap-3">
                <div class="col-span-2"><label class="font-bold text-blue-300">Waktu (Hari, Jam) *</label><input type="text" id="j_waktu" placeholder="Senin, 07:00 - 08:30" value="${data.Waktu || ''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 outline-none text-white focus:border-blue-500"></div>
                <div><label class="font-bold text-blue-300">ID Akun Guru *</label><input type="text" id="j_guru" value="${data["ID Akun Guru"] || ''}" class="w-full bg-black/40 border border-white/20 rounded px-2 py-1.5 mt-1 outline-none text-white focus:border-blue-500"></div>
                <div><label class="font-bold text-blue-300">Tahun Ajaran</label><select id="j_tahun" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none">${listTahun.map(t=>`<option value="${t}" ${data.Tahun===t?'selected':''}>${t}</option>`).join('')}</select></div>
                <div><label class="font-bold text-blue-300">Kelas</label><select id="j_kelas" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none">${listKelas.map(k=>`<option value="${k}" ${data["Tingkat/Kelas"]===k?'selected':''}>${k}</option>`).join('')}</select></div>
                <div><label class="font-bold text-blue-300">Mata Pelajaran</label><select id="j_mapel" class="w-full bg-slate-700 border border-white/20 rounded px-2 py-1.5 mt-1 text-white outline-none">${listMapel.map(m=>`<option value="${m}" ${data.Mapel===m?'selected':''}>${m}</option>`).join('')}</select></div>
            </div>
        `,
        background: '#1e293b', color: '#fff', showCancelButton: true, confirmButtonText: 'Simpan',
        preConfirm: () => {
            let guru = document.getElementById('j_guru').value.trim();
            let waktu = document.getElementById('j_waktu').value.trim();
            if(!guru || !waktu) { Swal.showValidationMessage('Guru & Waktu wajib diisi!'); return false; }
            return { "ID Akun Guru": guru, "ID Jadwal Murid": "", "Tahun": document.getElementById('j_tahun').value, "Semester": "Ganjil", "Waktu": waktu, "Mapel": document.getElementById('j_mapel').value, "Tingkat/Kelas": document.getElementById('j_kelas').value };
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