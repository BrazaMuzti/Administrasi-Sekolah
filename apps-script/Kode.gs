/**
 * SISTEM INFORMASI HADIR TATAP MUKA DAN NILAI MURID
 * TAHAP 1: SETUP DATABASE (SPREADSHEET)
 */

/**
 * SISTEM INFORMASI HADIR TATAP MUKA DAN NILAI MURID
 * SETUP DATABASE (UPDATED SKEMA)
 */

function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const generateDates = () => Array.from({length: 31}, (_, i) => (i + 1).toString());

  // GENERATE OTOMATIS KOLOM KODE 1 SAMPAI 8 (KD A s.d KD H)
  const huruf = ['A','B','C','D','E','F','G','H'];
  let headerKD = [];
  huruf.forEach(h => {
    headerKD.push(`KD ${h} T1`, `KD ${h} T2`, `KD ${h} UH`, `KD ${h} Rata-rata`, `KD ${h} Predikat`);
  });

  const schema = [
    { name: "Master Data", headers: ["Nama Dinas", "Nama Sekolah", "URL LOGO 1", "URL LOGO 2", "Ket. Nama Dinas", "Alamat Sekolah", "Mata Pelajaran", "Ekstrakurikuler", "Tingkat/Kelas", "Semester", "Tahun Pelajaran"] },
    { name: "Data Akun Guru", headers: ["ID Tahun Pelajaran", "Semester", "ID Akun Guru", "NIP", "Nama Guru", "Jabatan", "Wali Kelas", "Custom Teks Mata Pelajaran", "Ekstrakurikuler", "Email", "Password", "ID Jadwal Pelajaran Guru", "Captcha", "Kunci Absen"] },
    { name: "Data Akun Murid", headers: ["ID Tahun Pelajaran", "Semester", "ID Akun Murid", "NIS", "NISN", "Nama Lengkap", "Tingkat/Kelas", "Jenis Kelamin", "Tgl Lahir", "Ekstrakurikuler", "Nama Ortu/Wali", "Alamat", "No HP/WA", "Email", "Jabatan Kelas", "Catatan Khusus", "ID Jadwal Pelajaran Murid", "Password"] },
    { name: "Data Hadir Tatap Muka", headers: ["ID Akun Guru", "Tahun Pelajaran", "Semester", "Bulan", "Tanggal", "Tingkat/Kelas", "Mata Pelajaran", "Ekstrakurikuler", "NIS", "Nama", "Status", "Keterangan ketidakhadiran", "Keterangan kehadiran", "Metode", "Timestamp", "GPS"] },
    { name: "Data Rekap Hadir Tatap Muka", headers: ["ID Akun Guru", "Tahun", "Semester", "Bulan", "Tingkat/Kelas", "Wali Kelas", "Mata Pelajaran", "No", "NIS", "NISN", "Nama", "L/P", ...generateDates(), "Total H", "Total S", "Total I", "Total A", "%", "TTD"] },
    { name: "Data Nilai Pengetahuan", headers: ["ID Akun Guru", "Tahun", "Semester", "Tingkat/Kelas", "Wali Kelas", "Mata Pelajaran", "No", "NIS", "NISN", "Nama", "L/P",...headerKD, "Rerata CP", "UTS", "UAS/UKK", "Nilai Akhir Raport", "Predikat", "Keterangan"] },
    { name: "Data Nilai Keterampilan", headers: ["ID Akun Guru", "Tahun", "Semester", "Tingkat/Kelas", "Wali Kelas", "Mata Pelajaran", "No", "NIS", "NISN", "Nama", "L/P", "Prak A 1", "Prak A 2", "Prak A 3", "Prak A 4", "Optimum A", "Prak B 1", "Prak B 2", "Prak B 3", "Prak B 4", "Optimum B", "Prak C 1", "Prak C 2", "Prak C 3", "Prak C 4", "Optimum C", "Prak D 1", "Prak D 2", "Prak D 3", "Prak D 4", "Optimum D", "Rerata Optimum", "Projek 1", "Projek 2", "Projek 3", "Projek 4", "Rerata Projek", "Porto 1", "Porto 2", "Porto 3", "Porto 4", "Rerata Portofolio", "Nilai Akhir Raport", "Predikat", "Keterangan"] },
    { name: "Data Nilai Sikap", headers: ["ID Akun Guru", "Tahun", "Semester", "Tingkat/Kelas", "Wali Kelas", "Mata Pelajaran", "No", "NIS", "NISN", "Nama", "L/P", "CP A1", "CP A2", "CP A3", "CP A4", "Modus CP A", "CP B1", "CP B2", "CP B3", "CP B4",  "Modus CP B", "CP C1", "CP C2", "CP C3", "CP C4", " Modus CP C", "CP D1", "CP D2", "CP D3", "CP D4", " Modus CP D", " Modus Akhir", "Penilaian Diri", "Penilaian Teman Sejawat 1", "Penilaian Teman Sejawat 2", "Penilaian Teman Sejawat 3", "Penilaian Teman Sejawat 4", "Modus", "Nilai Jurnal", "Nilai Akhir", "Predikat", "Keterangan"] },
    { name: "Data Nilai Eskul", headers: ["ID Akun Guru", "Tahun", "Semester", "Tingkat/Kelas", "Wali Kelas", "Ekstrakurikuler", "No", "NIS", "NISN", "Nama", "L/P", "Nilai", "Predikat", "Deskripsi"] },
    { name: "Jadwal Pelajaran", headers: ["ID Akun Guru", "ID Jadwal Murid", "Tahun", "Semester", "Waktu", "Mapel", "Tingkat/Kelas"] },
    { name: "Jadwal Hari Libur", headers: ["Tahun", "Tanggal", "Keterangan", "Tipe"] }
  ];

  schema.forEach(sheetData => {
    let sheet = ss.getSheetByName(sheetData.name);
    if (!sheet) sheet = ss.insertSheet(sheetData.name);
    const filter = sheet.getFilter(); if (filter) filter.remove();
    
    // Paksa update header spreadsheet agar sesuai dengan struktur terbaru
    sheet.getRange(1, 1, 1, sheetData.headers.length).setValues([sheetData.headers])
         .setFontWeight("bold").setBackground("#e2e8f0").setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
  });

  const defaultSheet = ss.getSheetByName("Sheet1");
  if (defaultSheet && ss.getSheets().length > 1) ss.deleteSheet(defaultSheet);
}

function perbaikiKolomDataNilaiPengetahuan() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Data Nilai Pengetahuan");
  if (!sheet) return;
  
  const huruf = ['A','B','C','D','E','F','G','H'];
  let headerKD = [];
  
  // Membangun otomatis kolom fisik KD A sampai KD H
  huruf.forEach(h => {
    headerKD.push(`KD ${h} T1`, `KD ${h} T2`, `KD ${h} UH`, `KD ${h} Rata-rata`, `KD ${h} Predikat`);
  });
  
  const headers = [
    "ID Akun Guru", "Tahun", "Semester", "Bulan", "Tingkat/Kelas", "Wali Kelas", "Mata Pelajaran", 
    "No", "NIS", "NISN", "Nama", "L/P", 
    ...headerKD, // <--- Menyisipkan 40 Kolom KD secara dinamis
    "Rerata CP", "UTS", "UAS/UKK", "Nilai Akhir Raport", "Predikat", "Keterangan"
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
       .setFontWeight("bold").setBackground("#e2e8f0").setHorizontalAlignment("center");
  sheet.setFrozenRows(1);
}

function perbaikiKolomDataNilaiSikap() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Data Nilai Sikap");
  if (!sheet) sheet = ss.insertSheet("Data Nilai Sikap");
  
  let headerObs = [];
  // Membangun persis: CP A1, CP A2 ... CP D4
  ['A','B','C','D'].forEach(h => { for(let i=1; i<=4; i++) headerObs.push(`CP ${h}${i}`); });
  
  let headerTeman = [];
  for(let i=1; i<=5; i++) headerTeman.push(`Teman Sejawat ${i}`);

  const headers = [
    "ID Akun Guru", "Tahun", "Semester", "Bulan", "Tingkat/Kelas", "Wali Kelas", "Mata Pelajaran", 
    "No", "NIS", "NISN", "Nama", "L/P", 
    ...headerObs, 
    "Penilaian Diri", 
    ...headerTeman, 
    "Modus Teman", "Nilai Jurnal", "Nilai Akhir Raport", "Predikat", "Keterangan"
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setBackground("#e2e8f0").setHorizontalAlignment("center");
  sheet.setFrozenRows(1);
}