/**
 * utils.js — Helper bersama SISIP (dimuat sebelum app.js)
 */

/* ---------- API: satu pintu ke server ---------- */

// Ganti sesuai URL Web App Apps Script Anda:
const API_URL = 'https://script.google.com/macros/s/AKfycbyy0CEj__h7DfMZ2mEetcH2_X55szRRO_V0eiddKnY7ZNxO8u6xSCML3qBJ31-8QrTP/exec';

// Simpan token sesi di localStorage
function getToken() { return localStorage.getItem('sisip_token') || ''; }
function setSession(token, user) {
  localStorage.setItem('sisip_token', token);
  localStorage.setItem('sisip_user', JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem('sisip_token');
  localStorage.removeItem('sisip_user');
}
function getCurrentUser() {
  try { return JSON.parse(localStorage.getItem('sisip_user') || 'null'); }
  catch { return null; }
}

/**
 * Panggil server (POST). Otomatis menyertakan token.
 * @returns {Promise<Object>} respons JSON
 */
async function apiCall(action, data = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // hindari preflight CORS GAS
    body: JSON.stringify({ action, data, token: getToken() })
  });
  const json = await res.json();

  // Sesi habis → arahkan ke login
  if (json.code === 'SESSION_EXPIRED' || json.code === 'NO_TOKEN') {
    clearSession();
    showToast('warning', json.message);
    setTimeout(() => location.reload(), 1500);
    throw new Error(json.message);
  }
  return json;
}

/* ---------- Keamanan: XSS guard ---------- */

/** Escape semua karakter berbahaya sebelum dimasukkan ke HTML */
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape khusus atribut onclick="..." */
function escapeAttr(str) {
  return escapeHtml(String(str)).replace(/`/g, '&#96;');
}

/* ---------- UI: Toast & Loading ---------- */

function showToast(icon = 'success', title = '') {
  if (typeof Swal !== 'undefined') {
    Swal.fire({ toast: true, position: 'top-end', icon, title,
                showConfirmButton: false, timer: 2500, timerProgressBar: true });
  } else {
    console.log(`[${icon}] ${title}`);
  }
}

let loadingCount = 0;
function showLoading(msg = 'Memproses...') {
  loadingCount++;
  if (typeof Swal !== 'undefined') {
    Swal.fire({ title: msg, allowOutsideClick: false,
                didOpen: () => Swal.showLoading() });
  }
}
function hideLoading() {
  loadingCount = Math.max(0, loadingCount - 1);
  if (loadingCount === 0 && typeof Swal !== 'undefined') Swal.close();
}

/* ---------- Utilitas umum ---------- */

/* ---------- 🔒 Pembungkus fetch global (FASE B, sisi klien) ----------
 * Setiap fetch yang menuju API_URL otomatis diberi ?token=<sesi> — GET maupun
 * POST — sehingga TIDAK ADA call site yang perlu diedit satu per satu.
 * Bonus: respons {code:'SESSION_EXPIRED'|'NO_TOKEN'} langsung dipaketkan ke
 * alur logout → login ulang, sama seperti perilaku apiCall().
 */
(function pasangPembungkusFetch() {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  if (window._sisipFetchAsli) return; // jangan dobel-bungkus

  window._sisipFetchAsli = window.fetch.bind(window);

  window.fetch = async function sisipFetch(input, init) {
    // 1) Suntik token ke URL
    try {
      let url = (typeof input === 'string') ? input : ((input && input.url) || '');
      if (url.indexOf(API_URL) === 0) {
        const sep = (url.indexOf('?') >= 0) ? '&' : '?';
        const urlBerToken = url + sep + 'token=' + encodeURIComponent(getToken());
        input = (typeof input === 'string')
          ? urlBerToken
          : new Request(urlBerToken, input);
      }
    } catch (e) { console.warn('sisipFetch › suntik token:', e); }

    const res = await window._sisipFetchAsli(input, init);

    // 2) Intersep sesi kedaluwarsa (aman-diam jika bukan JSON / bukan kasus itu)
    try {
      const ct = (res.headers && res.headers.get('content-type')) || '';
      const diHalamanLogin = document.getElementById('view-login') &&
                             !document.getElementById('view-login').classList.contains('hidden');
      if (ct.indexOf('application/json') >= 0 && !diHalamanLogin) {
        const peek = await res.clone().json();
        if (peek && (peek.code === 'SESSION_EXPIRED' || peek.code === 'NO_TOKEN')) {
          clearSession();
          showToast('warning', peek.message || 'Sesi berakhir. Silakan login ulang.');
          setTimeout(() => location.reload(), 1500);
          return new Response(JSON.stringify(peek), { status: res.status, headers: { 'Content-Type': 'application/json' } });
        }
      }
    } catch (e) { /* body JSON bermasalah / bukan JSON — biarkan lewat */ }

    return res;
  };
})();

function formatTanggal(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function confirmDialog(title, text = 'Tindakan ini tidak bisa dibatalkan.') {
  return Swal.fire({
    title, text, icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Ya, lanjutkan',
    cancelButtonText: 'Batal',
    confirmButtonColor: '#d33'
  }).then(r => r.isConfirmed);
}

/** Debounce untuk pencarian */
function debounce(fn, delay = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}
