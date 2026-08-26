/**
 * utils.js — Helper bersama SISIP (dimuat sebelum app.js)
 */

/* ---------- API: satu pintu ke server ---------- */

// Ganti sesuai URL Web App Apps Script Anda:
const API_URL = 'https://script.google.com/macros/s/XXXX/exec';

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
    console.log(`[icon]{icon}]icon]{title}`);
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
