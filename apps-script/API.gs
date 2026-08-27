/**
 * SISTEM INFORMASI HADIR TATAP MUKA DAN NILAI MURID (SIAKAD)
 * BACKEND CORE API (GOOGLE APPS SCRIPT)
 * Versi Lengkap: Absensi, Nilai (Kurmer), Manajemen Akun tes
 */

// ==========================================
// 1. SETUP DATABASE
// Jalankan fungsi ini sekali secara manual melalui editor Apps Script
// ==========================================
function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const generateDates = () => Array.from({length: 31}, (_, i) => (i + 1).toString());

  // Dinamis Kolom KD (A sampai H) untuk Pengetahuan
  const huruf = ['A','B','C','D','E','F','G','H'];
  let headerKD = [];
  huruf.forEach(h => { headerKD.push(`KD ${h} T1`, `KD ${h} T2`, `KD ${h} UH`, `KD ${h} Rata-rata`, `KD ${h} Predikat`); });

  // Dinamis Kolom Observasi untuk Sikap
  let headerObs = [];
  ['A','B','C','D'].forEach(h => { for(let i=1; i<=4; i++) headerObs.push(`CP ${h}${i}`); });
  let headerTeman = [];
  for(let i=1; i<=5; i++) headerTeman.push(`Teman Sejawat ${i}`);

  const schema = [
    { name: "Master Data", headers: ["Nama Dinas", "Nama Sekolah", "URL LOGO 1", "URL LOGO 2", "Ket. Nama Dinas", "Alamat Sekolah", "Mata Pelajaran", "Ekstrakurikuler", "Tingkat/Kelas", "Semester", "Tahun Pelajaran", "Jabatan Kelas", "Jabatan Guru"] },
    { name: "Data Akun Guru", headers: ["ID Tahun Pelajaran", "Semester", "ID Akun Guru", "NIP", "Nama Guru", "Jabatan", "Wali Kelas", "Custom Teks Mata Pelajaran", "Ekstrakurikuler", "Email", "Password", "ID Jadwal Pelajaran Guru", "Captcha", "Kunci Absen"] },
    { name: "Data Akun Murid", headers: ["ID Tahun Pelajaran", "Semester", "ID Akun Murid", "NIS", "NISN", "Nama Lengkap", "Tingkat/Kelas", "Jenis Kelamin", "Tgl Lahir", "Ekstrakurikuler", "Nama Ortu/Wali", "Alamat", "No HP/WA", "Email", "Jabatan Kelas", "Catatan Khusus", "ID Jadwal Pelajaran Murid", "Password"] },
    { name: "Data Hadir Tatap Muka", headers: ["ID Akun Guru", "Tahun Pelajaran", "Semester", "Bulan", "Tanggal", "Tingkat/Kelas", "Mata Pelajaran", "Ekstrakurikuler", "NIS", "Nama", "Status", "Keterangan ketidakhadiran", "Keterangan kehadiran", "Metode", "Timestamp", "GPS"] },
    { name: "Data Rekap Hadir Tatap Muka", headers: ["ID Akun Guru", "Tahun", "Semester", "Bulan", "Tingkat/Kelas", "Wali Kelas", "Mata Pelajaran", "No", "NIS", "NISN", "Nama", "L/P", ...generateDates(), "Total H", "Total S", "Total I", "Total A", "%", "TTD"] },
    { name: "Data Nilai Pengetahuan", headers: ["ID Akun Guru", "Tahun", "Semester", "Bulan", "Tingkat/Kelas", "Wali Kelas", "Mata Pelajaran", "No", "NIS", "NISN", "Nama", "L/P", ...headerKD, "Rerata CP", "UTS", "UAS/UKK", "Nilai Akhir Raport", "Predikat", "Keterangan"] },
    { name: "Data Nilai Keterampilan", headers: ["ID Akun Guru", "Tahun", "Semester", "Bulan", "Tingkat/Kelas", "Wali Kelas", "Mata Pelajaran", "No", "NIS", "NISN", "Nama", "L/P", "Prak A 1", "Prak A 2", "Prak A 3", "Prak A 4", "Optimum A", "Prak B 1", "Prak B 2", "Prak B 3", "Prak B 4", "Optimum B", "Prak C 1", "Prak C 2", "Prak C 3", "Prak C 4", "Optimum C", "Prak D 1", "Prak D 2", "Prak D 3", "Prak D 4", "Optimum D", "Rerata Optimum", "Projek 1", "Projek 2", "Projek 3", "Projek 4", "Rerata Projek", "Porto 1", "Porto 2", "Porto 3", "Porto 4", "Rerata Porto", "Nilai Akhir Raport", "Predikat", "Keterangan"] },
    { name: "Data Nilai Sikap", headers: ["ID Akun Guru", "Tahun", "Semester", "Bulan", "Tingkat/Kelas", "Wali Kelas", "Mata Pelajaran", "No", "NIS", "NISN", "Nama", "L/P", ...headerObs, "Penilaian Diri", ...headerTeman, "Modus Teman", "Nilai Jurnal", "Nilai Akhir Raport", "Predikat", "Keterangan"] },
    { name: "Data Nilai Eskul", headers: ["ID Akun Guru", "Tahun", "Semester", "Bulan", "Tingkat/Kelas", "Wali Kelas", "Mata Pelajaran", "Ekstrakurikuler", "No", "NIS", "NISN", "Nama", "L/P", "Nilai", "Predikat", "Deskripsi"] },
    { name: "Jadwal Pelajaran", headers: ["ID Akun Guru", "ID Jadwal Murid", "Tahun", "Semester", "Waktu", "Mapel", "Tingkat/Kelas"] },
    { name: "Jadwal Hari Libur", headers: ["Tahun", "Tanggal", "Keterangan", "Tipe"] }
  ];

  schema.forEach(sheetData => {
    let sheet = ss.getSheetByName(sheetData.name);
    if (!sheet) sheet = ss.insertSheet(sheetData.name);
    const filter = sheet.getFilter(); if (filter) filter.remove();
    sheet.getRange(1, 1, 1, sheetData.headers.length).setValues([sheetData.headers])
         .setFontWeight("bold").setBackground("#e2e8f0").setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
  });

  const defaultSheet = ss.getSheetByName("Sheet1");
  if (defaultSheet && ss.getSheets().length > 1) ss.deleteSheet(defaultSheet);
}

// ==========================================
// KEAMANAN DATA: SANITASI RESPON (FASE B)
// Kolom sensitif dihapus SEBELUM data akun dikirim ke klien,
// apa pun endpoint-nya (dashboard, CRUD, nilai).
// ==========================================
const KOLOM_RAHASIA = ['Password'];

/** Salin objek baris tanpa kolom rahasia */
function bersihkanBaris(obj) {
  const o = Object.assign({}, obj || {});
  KOLOM_RAHASIA.forEach(k => delete o[k]);
  return o;
}

/** Terapkan bersihkanBaris ke seluruh daftar baris */
function bersihkanDaftar(rows) {
  return (rows || []).map(bersihkanBaris);
}

// ==========================================
// 2. HTTP GET REQUESTS (AMBIL DATA)
// ==========================================
function doGet(e) {
  // PENGAMAN: Jika dijalankan manual di editor atau URL dibuka tanpa parameter
  if (!e || !e.parameter) {
    return ContentService.createTextOutput("API SIAKAD Berjalan Normal. Endpoint ini hanya menerima request dari Frontend.")
                         .setMimeType(ContentService.MimeType.TEXT);
  }

  const action = e.parameter.action;
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  try {
    // A. LOGIN SYSTEM (GET legacy) — delegasi penuh ke handleLogin() di Auth.gs:
    // kini mendukung hash SHA-256 dan ikut MENERBITKAN token sesi.
    if (action === 'login') {
      const data = JSON.parse(decodeURIComponent(e.parameter.data));
      return sendJSON(handleLogin({ data: data }));
    }

    // B. MASTER DATA — GET publik SATU-SATUNYA (dipakai layar login: logo & nama sekolah)
    if (action === 'get_master_data') {
      return sendJSON({ status: 'success', data: bersihkanDaftar(getSheetDataAsObjects(ss, "Master Data")) });
    }

    // 🔒 FASE B: SEMUA GET LAIN WAJIB TOKEN SESI (?token=... — disuntik otomatis oleh utils.js)
    const authGet = requireAuth({ token: e.parameter.token });
    if (authGet.status !== 'success') return sendJSON(authGet);

    // C. DASHBOARD UTAMA (Ambil Murid, Kehadiran, Status Kunci)
    if (action === 'get_dashboard_data') {
      const req = JSON.parse(decodeURIComponent(e.parameter.data));
      
      let muridAll = getSheetDataAsObjects(ss, "Data Akun Murid");
      // Sanitasi: baris murid TIDAK boleh membawa kolom Password ke klien
      let muridKelas = bersihkanDaftar(req.kelas === "Semua Kelas" ? muridAll : muridAll.filter(m => m["Tingkat/Kelas"] == req.kelas));
      
      let absenAll = getSheetDataAsObjects(ss, "Data Hadir Tatap Muka");
      let absenFilter = absenAll.filter(a => 
         (req.mapel ? (a["Mata Pelajaran"] == req.mapel || a["Ekstrakurikuler"] == req.mapel) : true) &&
         (req.bulan ? a.Bulan == req.bulan : true) &&
         (req.tahun ? a["Tahun Pelajaran"] == req.tahun : true)
      );

      let guruStatus = getSheetDataAsObjects(ss, "Data Akun Guru").map(g => ({
         "ID Akun Guru": g["ID Akun Guru"], "Nama Guru": g["Nama Guru"], "Mapel": g["Custom Teks Mata Pelajaran"], 
         "Ekskul": g["Ekstrakurikuler"], "Kunci": g["Kunci Absen"], "Wali Kelas": g["Wali Kelas"]
      }));

      // Ambil nama Kepsek dari Master Data baris pertama
      let kepsek = "_____________________"; 

      return sendJSON({ status: 'success', murid: muridKelas, absen: absenFilter, status_guru: guruStatus, kepsek: kepsek });
    }

    // D. DATA NILAI
    if (action === 'get_data_nilai') {
      const req = JSON.parse(decodeURIComponent(e.parameter.data));
      // 🔒 WHITELIST sheet: dahulu nama sheet dibebaskan (req.sheetName arbitrer),
      // memungkinkan pembacaan "Data Akun Guru"/"Data Akun Murid" (bocor Password).
      const SHEET_NILAI_IZINKAN = ["Data Nilai Pengetahuan", "Data Nilai Keterampilan", "Data Nilai Sikap", "Data Nilai Eskul", "Data Rekap Hadir Tatap Muka"];
      if (!SHEET_NILAI_IZINKAN.includes(req.sheetName)) {
        return sendJSON({ status: 'error', message: 'Nama sheet tidak diizinkan.' });
      }
      return sendJSON({ status: 'success', data: bersihkanDaftar(getSheetDataAsObjects(ss, req.sheetName)) });
    }

    // E. KONFIGURASI KOLOM NILAI
    if (action === 'get_konfigurasi_nilai') {
      const req = JSON.parse(decodeURIComponent(e.parameter.data));
      const key = `CONF_${req.sheetName}_${req.mapel}`.replace(/\s+/g, '_');
      const savedConf = PropertiesService.getDocumentProperties().getProperty(key);
      return sendJSON({ status: 'success', data: savedConf ? JSON.parse(savedConf) : null });
    }

    // H. JADWAL HARI LIBUR & JADWAL PELAJARAN (MODUL PENGATURAN)
    // Frontend renderJadwalLiburModule() mengharapkan SATU respons gabungan:
    // { status:'success', libur:[...], jadwal:[...] }.
    if (action === 'get_jadwal_libur') {
      const libur = getSheetDataAsObjects(ss, "Jadwal Hari Libur")
        .map(r => Object.assign({}, r, { Tanggal: gasNormTanggal(r.Tanggal) })); // normalisasi 'yyyy-MM-dd' utk isHoliday()
      const jadwal = getSheetDataAsObjects(ss, "Jadwal Pelajaran");
      return sendJSON({ status: 'success', libur: libur, jadwal: jadwal });
    }

    // F. UPDATE CAPTCHA (KUNCI ABSEN)
    if (action === 'update_kunci') {
      const req = JSON.parse(decodeURIComponent(e.parameter.data));
      const sheet = ss.getSheetByName("Data Akun Guru");
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      const idIdx = headers.indexOf("ID Akun Guru");
      const captchaIdx = headers.indexOf("Captcha");
      const kunciIdx = headers.indexOf("Kunci Absen");
      
      for(let i=1; i<data.length; i++){
        if(data[i][idIdx] == req.id_guru){
           sheet.getRange(i+1, captchaIdx+1).setValue(req.captcha);
           sheet.getRange(i+1, kunciIdx+1).setValue(req.kunci);
           break;
        }
      }
      return sendJSON({ status: 'success' });
    }

    // G. MANAJEMEN AKUN (CRUD READ)
    if (action === 'get_akun') {
      const sheetName = e.parameter.tipe === 'murid' ? 'Data Akun Murid' : 'Data Akun Guru';
      // 🔒 Sanitasi: dump akun TANPA kolom Password
      return sendJSON({ status: 'success', data: bersihkanDaftar(getSheetDataAsObjects(ss, sheetName)) });
    }

    return sendJSON({ status: 'error', message: 'Action GET tidak dikenali.' });
  } catch (err) {
    return sendJSON({ status: 'error', message: err.toString() });
  }
}

// ==========================================
// 3. HTTP POST REQUESTS (SIMPAN/UBAH DATA)
// ==========================================
function doPost(e) {
  if (!e || !e.postData) return sendJSON({ status:'error', message:'No payload' });

  let payload;
  try { payload = JSON.parse(e.postData.contents); }
  catch { return sendJSON({ status:'error', message:'Payload tidak valid' }); }

  try {
    // ✅ Login bebas token; sisanya WAJIB token sesi (FASE A — restrukturisasi).
    // Token dapat tiba di BODY (payload.token) atau QUERY STRING (?token=, disuntik
    // otomatis oleh pembungkus fetch di web/js/utils.js — GAS menyatukan keduanya
    // di e.parameter untuk POST juga).
    if (payload.action === 'login') {
      return sendJSON(handleLogin(payload));
    }

    const auth = requireAuth({ token: (payload && payload.token) || (e.parameter && e.parameter.token) });
    if (auth.status !== 'success') return sendJSON(auth);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const action = payload.action;

    // MODUL JADWAL & LIBUR — kini DI DALAM wilayah ter-autentikasi
    // dan TERJANGKAU karena blok switch(default) usang telah dihapus.
    if (action === 'save_libur' || action === 'delete_libur') {
      return sendJSON(handleModulLibur(payload));
    }

    // A. ABSENSI MANDIRI (Siswa)
    if (action === 'absen_mandiri') {
      const sheet = ss.getSheetByName("Data Hadir Tatap Muka");
      const guruSheet = getSheetDataAsObjects(ss, "Data Akun Guru");
      
      const targetGuru = guruSheet.find(g => (g["Custom Teks Mata Pelajaran"]||"").includes(payload.mapel) || (g.Ekstrakurikuler||"").includes(payload.mapel));
      if(!targetGuru) return sendJSON({status: 'error', message: 'Guru mapel ini tidak ditemukan.'});
      if(targetGuru["Kunci Absen"] !== 'BUKA') return sendJSON({status: 'error', message: 'Sesi absensi sedang ditutup oleh Guru.'});
      if(targetGuru.Captcha !== payload.captcha) return sendJSON({status: 'error', message: 'Captcha salah!'});

      // Cek jika sudah absen
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      const dateIdx = headers.indexOf("Tanggal"); const nisIdx = headers.indexOf("NIS"); const mapelIdx = headers.indexOf("Mata Pelajaran"); const ekskulIdx = headers.indexOf("Ekstrakurikuler");
      
      for(let i=1; i<data.length; i++) {
         if(data[i][dateIdx] == payload.tanggal && data[i][nisIdx] == payload.nis && (data[i][mapelIdx] == payload.mapel || data[i][ekskulIdx] == payload.mapel)) {
            return sendJSON({status: 'error', message: 'Anda sudah melakukan presensi hari ini!'});
         }
      }
      
      // Append Row Baru
      let newRow = headers.map(h => {
        if(h === "ID Akun Guru") return targetGuru["ID Akun Guru"];
        if(h === "Tahun Pelajaran") return payload.tahun;
        if(h === "Semester") return payload.semester;
        if(h === "Bulan") return payload.bulan;
        if(h === "Tanggal") return payload.tanggal;
        if(h === "Tingkat/Kelas") return payload.kelas;
        if(h === "Mata Pelajaran") return payload.jenis === 'Mapel' ? payload.mapel : "";
        if(h === "Ekstrakurikuler") return payload.jenis === 'Ekskul' ? payload.mapel : "";
        if(h === "NIS") return payload.nis;
        if(h === "Nama") return payload.nama;
        if(h === "Status") return "H";
        if(h === "Metode") return "Mandiri";
        if(h === "Timestamp") return new Date().toLocaleString('id-ID');
        if(h === "GPS") return payload.gps || "";
        return "";
      });
      sheet.appendRow(newRow);
      return sendJSON({ status: 'success' });
    }

    // B. SAVE ABSEN MASAL (Guru/Admin/KM)
    if (action === 'save_absen_masal') {
      const sheet = ss.getSheetByName("Data Hadir Tatap Muka");
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      const dateIdx = headers.indexOf("Tanggal"); const nisIdx = headers.indexOf("NIS"); const mapelIdx = headers.indexOf("Mata Pelajaran"); const ekskulIdx = headers.indexOf("Ekstrakurikuler");
      
      // Buat peta data agar pencarian baris lebih cepat
      let rowMap = {};
      for(let i=1; i<data.length; i++) {
         let key = `${data[i][dateIdx]}_${data[i][nisIdx]}_${data[i][mapelIdx]}_${data[i][ekskulIdx]}`;
         rowMap[key] = i + 1; // Index baris Google Sheets
      }

      let rowsToAppend = [];
      payload.absenList.forEach(m => {
          if(!m.status) return; // Skip jika tidak ada status
          let key = `${payload.tanggal}_${m.nis}_${payload.mapel}_${payload.ekskul}`;
          let rowIndex = rowMap[key];
          
          let rowData = headers.map(h => {
              if(h === "ID Akun Guru") return payload.id_guru;
              if(h === "Tahun Pelajaran") return payload.tahun;
              if(h === "Semester") return payload.semester;
              if(h === "Bulan") return payload.bulan;
              if(h === "Tanggal") return payload.tanggal;
              if(h === "Tingkat/Kelas") return payload.kelas;
              if(h === "Mata Pelajaran") return payload.mapel;
              if(h === "Ekstrakurikuler") return payload.ekskul;
              if(h === "NIS") return m.nis;
              if(h === "Nama") return m.nama;
              if(h === "Status") return m.status;
              if(h === "Keterangan ketidakhadiran") return m.keterangan || "";
              if(h === "Keterangan kehadiran") return payload.keterangan_kehadiran_masal || "";
              if(h === "Metode") return payload.metode || "Manual";
              if(h === "Timestamp") return new Date().toLocaleString('id-ID');
              if(h === "GPS") return payload.gps || "";
              return "";
          });

          if(rowIndex) {
             sheet.getRange(rowIndex, 1, 1, headers.length).setValues([rowData]);
          } else {
             rowsToAppend.push(rowData);
          }
      });
      
      if(rowsToAppend.length > 0) {
         sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, headers.length).setValues(rowsToAppend);
      }
      return sendJSON({ status: 'success' });
    }

    // C. SAVE KETERANGAN SISWA ABSEN (Edit Keterangan Izin/Sakit)
    if (action === 'save_keterangan_siswa') {
       const sheet = ss.getSheetByName("Data Hadir Tatap Muka");
       const data = sheet.getDataRange().getValues();
       const headers = data[0];
       const dateIdx = headers.indexOf("Tanggal"); const nisIdx = headers.indexOf("NIS"); const blnIdx = headers.indexOf("Bulan"); const mplIdx = headers.indexOf("Mata Pelajaran"); const ketIdx = headers.indexOf("Keterangan ketidakhadiran");
       
       payload.updates.forEach(upd => {
          for(let i=1; i<data.length; i++) {
             if(data[i][nisIdx] == payload.nis && data[i][dateIdx] == upd.tanggal && data[i][blnIdx] == payload.bulan && (data[i][mplIdx] == payload.mapel || data[i][headers.indexOf("Ekstrakurikuler")] == payload.mapel)) {
                 sheet.getRange(i+1, ketIdx+1).setValue(upd.keterangan);
                 break;
             }
          }
       });
       return sendJSON({ status: 'success' });
    }

    // D. KONFIGURASI SET KOLOM NILAI
    if (action === 'save_konfigurasi_nilai') {
       const key = `CONF_${payload.sheetName}_${payload.mapel}`.replace(/\s+/g, '_');
       PropertiesService.getDocumentProperties().setProperty(key, JSON.stringify(payload.config));
       return sendJSON({ status: 'success' });
    }

    // E. SAVE SINGLE SISWA NILAI (Live Sync)
    if (action === 'save_nilai_siswa') {
       const sheet = ss.getSheetByName(payload.sheetName);
       const data = sheet.getDataRange().getValues();
       const headers = data[0];
       
       let rowIndex = -1;
       const nisIdx = headers.indexOf("NIS"); const thnIdx = headers.indexOf("Tahun"); const smtIdx = headers.indexOf("Semester");
       const mIdX = payload.sheetName === "Data Nilai Eskul" ? headers.indexOf("Ekstrakurikuler") : headers.indexOf("Mata Pelajaran");
       
       for(let i=1; i<data.length; i++) {
           if(data[i][nisIdx] == payload.nis && data[i][thnIdx] == payload.tahun && data[i][smtIdx] == payload.semester && data[i][mIdX] == payload.mapel) {
               rowIndex = i + 1; break;
           }
       }

       if (rowIndex > -1) {
           // Update Kolom Parsial
           Object.keys(payload.updates).forEach(k => {
               const colIdx = headers.indexOf(k);
               if(colIdx > -1) sheet.getRange(rowIndex, colIdx + 1).setValue(payload.updates[k]);
           });
       } else {
           // Append Data Baru
           let newRow = headers.map(h => {
               if(payload.updates[h] !== undefined) return payload.updates[h];
               if(payload.static[h] !== undefined) return payload.static[h];
               return "";
           });
           sheet.appendRow(newRow);
       }
       return sendJSON({ status: 'success' });
    }

    // F. SAVE NILAI MASAL (Force Sync)
    if (action === 'save_nilai_masal') {
       const sheet = ss.getSheetByName(payload.sheetName);
       const data = sheet.getDataRange().getValues();
       const headers = data[0];
       const nisIdx = headers.indexOf("NIS"); const thnIdx = headers.indexOf("Tahun"); const smtIdx = headers.indexOf("Semester");
       const mIdX = payload.sheetName === "Data Nilai Eskul" ? headers.indexOf("Ekstrakurikuler") : headers.indexOf("Mata Pelajaran");

       // Peta Data 
       let rowMap = {};
       for(let i=1; i<data.length; i++) {
           rowMap[`${data[i][nisIdx]}_${data[i][thnIdx]}_${data[i][smtIdx]}_${data[i][mIdX]}`] = i + 1;
       }

       let rowsToAppend = [];
       payload.dataList.forEach(m => {
           let key = `${m.nis}_${payload.tahun}_${payload.semester}_${payload.mapel}`;
           let rowIndex = rowMap[key];

           let rowData = headers.map((h, hIdx) => {
               if (m.updates[h] !== undefined) return m.updates[h];
               // Ambil data eksisting jika sedang update
               if (rowIndex && rowIndex <= data.length) return data[rowIndex - 1][hIdx];
               return "";
           });

           if (rowIndex) sheet.getRange(rowIndex, 1, 1, headers.length).setValues([rowData]);
           else rowsToAppend.push(rowData);
       });

       if (rowsToAppend.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, headers.length).setValues(rowsToAppend);
       return sendJSON({ status: 'success' });
    }

    // G. MANAJEMEN AKUN (CRUD POST)
    // GANTI BLOK action === 'save_akun' DENGAN KODE INI:
    if (action === 'save_akun') {
      try {
        const sheetName = payload.tipe === 'murid' ? 'Data Akun Murid' : 'Data Akun Guru';
        let sheet = ss.getSheetByName(sheetName);
        
        if (!sheet) {
          return sendJSON({ status: 'error', message: 'Sheet "' + sheetName + '" tidak ditemukan di Spreadsheet!' });
        }
        
        const lastRow = sheet.getLastRow();
        const lastCol = sheet.getLastColumn();
        
        if (lastRow < 1 || lastCol < 1) {
          return sendJSON({ status: 'error', message: 'Sheet ' + sheetName + ' kosong atau belum memiliki header.' });
        }
        
        const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
        const keyField = payload.tipe === 'murid' ? "NIS" : "ID Akun Guru";
        const keyColIndex = headers.indexOf(keyField);
        
        if (keyColIndex === -1) {
          return sendJSON({ status: 'error', message: 'Kolom kunci "' + keyField + '" tidak ditemukan di baris header sheet ' + sheetName });
        }
        
        const data = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
        const keyVal = payload.tipe === 'murid' ? payload.data["NIS"] : payload.data["ID Akun Guru"];
        
        if (payload.isNew) {
           // Cek duplikasi NIS / ID Guru
           let exists = data.some(row => row[keyColIndex] == keyVal);
           if (exists) {
             return sendJSON({ status: 'error', message: 'Gagal: NIS / ID tersebut sudah terdaftar sebelumnya!' });
           }
           let newRow = headers.map(h => payload.data[h] !== undefined && payload.data[h] !== null ? payload.data[h] : "");
           sheet.appendRow(newRow);
        } else {
           let found = false;
           for (let i = 0; i < data.length; i++) {
              if (data[i][keyColIndex] == keyVal) {
                 // Petakan data baru sesuai urutan header di spreadsheet
                 // Petakan data baru sesuai urutan header di spreadsheet.
                  // 🔒 EDIT AKUN: kolom Password JANGAN ditimpa bila input kosong —
                  // nilai lama dipertahankan (form edit mengirim "" sbg "tidak diubah").
                  let updateRow = headers.map((h, idx) => {
                      if (h === "Password" && (payload.data[h] === undefined || payload.data[h] === null || String(payload.data[h]).trim() === "")) return data[i][idx];
                      return payload.data[h] !== undefined && payload.data[h] !== null ? payload.data[h] : data[i][idx];
                  });
                 sheet.getRange(i + 2, 1, 1, headers.length).setValues([updateRow]);
                 found = true;
                 break;
              }
           }
           // Jika data lama tidak ditemukan saat tombol Edit diklik, buat baris baru
           if (!found) {
             let newRow = headers.map(h => payload.data[h] !== undefined && payload.data[h] !== null ? payload.data[h] : "");
             sheet.appendRow(newRow);
           }
        }
        return sendJSON({ status: 'success' });
      } catch(err) {
        // Mengembalikan pesan error asli dari Apps Script agar mudah dilacak di Console
        return sendJSON({ status: 'error', message: 'GAS Exception: ' + err.toString() });
      }
    }

    if (action === 'delete_akun') {
      const sheetName = payload.tipe === 'murid' ? 'Data Akun Murid' : 'Data Akun Guru';
      const sheet = ss.getSheetByName(sheetName);
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      const keyColIndex = payload.tipe === 'murid' ? headers.indexOf("NIS") : headers.indexOf("ID Akun Guru");
      
      for (let i = 1; i < data.length; i++) {
        if (data[i][keyColIndex] == payload.key) {
           sheet.deleteRow(i + 1); 
           break;
        }
      }
      return sendJSON({status: 'success'});
    }



    return sendJSON({ status: 'error', message: 'Action POST tidak dikenali.' });
  } catch (err) {
    return sendJSON({ status: 'error', message: err.toString() });
  }
}

// ==========================================
// 4. FUNGSI UTILITIES HELPER
// ==========================================
// A. Fungsi Helper Pembaca Baris Spreadsheet (Aman dari data kosong)
function getSheetDataAsObjects(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  
  const headers = data[0];
  let result = [];
  
  for(let i=1; i<data.length; i++) {
    const isRowEmpty = data[i].every(cell => cell === "");
    if(isRowEmpty) continue;
    
    let obj = {};
    headers.forEach((h, idx) => { obj[h] = data[i][idx]; });
    result.push(obj);
  }
  return result;
}



function sendJSON(jsonObject) {
  return ContentService.createTextOutput(JSON.stringify(jsonObject)).setMimeType(ContentService.MimeType.JSON);
}

// ==========================================
// 5. MODUL JADWAL HARI LIBUR (LIBUR CUSTOM)
// ==========================================

/** Normalisasi nilai sel tanggal (Date Sheets / string ISO / string biasa) → 'yyyy-MM-dd' */
function gasNormTanggal(v) {
  if (!v) return "";
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  return String(v).slice(0, 10);
}

/**
 * Handler POST save_libur / delete_libur.
 * Kontrak frontend (app.js):
 *   save_libur   : { isNew, data:{ Tahun, Tanggal:'yyyy-MM-dd', Keterangan, Tipe } }
 *   delete_libur : { key: '<tanggal>' }
 */
function handleModulLibur(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Jadwal Hari Libur");

  // Sheet belum dibuat (spreadsheet lama pra-setupDatabase) → buat otomatis
  if (!sheet) {
    sheet = ss.insertSheet("Jadwal Hari Libur");
    sheet.getRange(1, 1, 1, 4).setValues([["Tahun", "Tanggal", "Keterangan", "Tipe"]]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const thnIdx = headers.indexOf("Tahun"), tglIdx = headers.indexOf("Tanggal");
  const ketIdx = headers.indexOf("Keterangan"), tipeIdx = headers.indexOf("Tipe");

  if (payload.action === 'save_libur') {
    const d = payload.data || {};
    if (!d.Tanggal || !d.Keterangan) return { status: 'error', message: 'Tanggal & Keterangan wajib diisi.' };
    const tglKey = gasNormTanggal(d.Tanggal);

    // Upsert per tanggal (input tanggal readonly saat edit → tanggal adalah kunci unik)
    for (let i = 1; i < data.length; i++) {
      if (gasNormTanggal(data[i][tglIdx]) === tglKey) {
        sheet.getRange(i + 1, thnIdx + 1).setValue(d.Tahun || "");
        sheet.getRange(i + 1, ketIdx + 1).setValue(d.Keterangan);
        sheet.getRange(i + 1, tipeIdx + 1).setValue(d.Tipe || "Umum");
        return { status: 'success', mode: 'update' };
      }
    }

    sheet.appendRow([d.Tahun || "", d.Tanggal, d.Keterangan, d.Tipe || "Umum"]);
    return { status: 'success', mode: 'create' };
  }

  if (payload.action === 'delete_libur') {
    const key = gasNormTanggal(payload.key);
    let barisTerhapus = 0;
    for (let i = data.length - 1; i >= 1; i--) {
      if (gasNormTanggal(data[i][tglIdx]) === key) { sheet.deleteRow(i + 1); barisTerhapus++; }
    }
    return { status: 'success', deleted: barisTerhapus };
  }

  return { status: 'error', message: 'Action libur tidak dikenal.' };
}