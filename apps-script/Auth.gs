/**
 * Auth.gs — Sistem autentikasi SISIP
 * - Password disimpan sebagai hash SHA-256 (tidak plain text)
 * - Token sesi setelah login (berlaku 24 jam)
 * Semua request lain wajib membawa token ini.
 */

const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 jam dalam ms

/** Hash password: teks biasa -> hex string */
function hashPassword(plain) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(plain),
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

/** Cari akun di sheet "Data Akun Guru" atau "Data Akun Murid" */
function findUser(username) {
  const sheets = ['Data Akun Guru', 'Data Akun Murid'];
  for (const name of sheets) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(name);
    if (!sheet) continue;
    const data = getSheetDataAsObjects(ss, name); // fungsi dari Kode.gs/API.gs Anda
    const user = data.find(r => String(r.Username).trim() === String(username).trim());
    if (user) return { ...user, __role: name.includes('Guru') ? 'guru' : 'siswa', __rowName: name };
  }
  return null;
}

/**
 * LOGIN — dipanggil via POST
 * payload: { action:'login', data:{ username, password } }
 */
function handleLogin(payload) {
  const { username, password } = payload.data || {};
  if (!username || !password) {
    return { status: 'error', message: 'Username dan password wajib diisi.' };
  }

  const user = findUser(username);
  // Hash password yang tersimpan di spreadsheet.
  // Jika masih plain text, migrasikan sekali dengan migratePasswords() di bawah.
  const storedHash = user ? String(user.Password || '').toLowerCase() : '';
  const inputHash = hashPassword(password);

  // Dukung transisi: jika tersimpan plain text, cocokkan langsung lalu otomatis hash.
  let ok = false;
  if (storedHash === inputHash) {
    ok = true;
  } else if (storedHash === String(password)) {
    updatePasswordHash(user.__rowName, user.Username, inputHash);
    ok = true;
  }

  if (!ok || !user) {
    return { status: 'error', message: 'Username atau password salah.' };
  }

  const token = Utilities.getUuid();
  const cache = CacheService.getScriptCache();
  cache.put('sess_' + token, JSON.stringify({
    username: user.Username,
    role: user.__role,
    nama: user['Nama Lengkap'] || user.Username,
    expires: Date.now() + SESSION_DURATION
  }), 21600); // maksimal cache 6 jam; diperpanjang saat validasi

  return {
    status: 'success',
    token: token,
    user: {
      username: user.Username,
      role: user.__role,
      nama: user['Nama Lengkap'] || user.Username
    }
  };
}

/** Update kolom Password menjadi hash (untuk auto-migrasi) */
function updatePasswordHash(sheetName, username, newHash) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const colUser = headers.indexOf('Username');
  const colPass = headers.indexOf('Password');
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][colUser]).trim() === String(username).trim()) {
      sheet.getRange(i + 1, colPass + 1).setValue(newHash);
      return;
    }
  }
}

/**
 * Validasi token untuk SEMUA action selain login.
 * Dipanggil di awal doGet/doPost:
 *   const session = requireAuth(payload);
 *   if (session.error) return sendJSON(session);
 */
function requireAuth(payload) {
  const token = payload.token;
  if (!token) {
    return { status: 'error', message: 'Token tidak ada. Silakan login ulang.', code: 'NO_TOKEN' };
  }
  const cache = CacheService.getScriptCache();
  const raw = cache.get('sess_' + token);
  if (!raw) {
    return { status: 'error', message: 'Sesi berakhir. Silakan login ulang.', code: 'SESSION_EXPIRED' };
  }
  const sess = JSON.parse(raw);
  if (Date.now() > sess.expires) {
    cache.remove('sess_' + token);
    return { status: 'error', message: 'Sesi kedaluwarsa.', code: 'SESSION_EXPIRED' };
  }
  // Perpanjang sesi (sliding)
  cache.put('sess_' + token, raw, 21600);
  return { status: 'success', session: sess }; // berisi username, role, nama
}

/**
 * OPSIONAL — jalankan SEKALI saja dari editor Apps Script
 * untuk meng-hash semua password plain text yang sudah ada.
 * Menu: Run ▶ migratePasswords (setelah pilih fungsi ini)
 */
function migratePasswords() {
  const sheets = ['Data Akun Guru', 'Data Akun Murid'];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  sheets.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const values = sheet.getDataRange().getValues();
    const headers = values[0];
    const colUser = headers.indexOf('Username');
    const colPass = headers.indexOf('Password');
    if (colUser < 0 || colPass < 0) return;
    for (let i = 1; i < values.length; i++) {
      const pass = String(values[i][colPass] || '').trim();
      if (!pass) continue;
      const isHex64 = /^[0-9a-f]{64}$/.test(pass); // sudah hash?
      if (!isHex64) {
        sheet.getRange(i + 1, colPass + 1).setValue(hashPassword(pass));
      }
    }
  });
  Logger.log('Selesai! Semua password sudah di-hash.');
}
