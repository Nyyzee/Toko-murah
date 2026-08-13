// =========================================
// FORMAT RUPIAH
// =========================================

function formatRupiah(angka) {
    return new Intl.NumberFormat("id-ID", {
        style:                 "currency",
        currency:              "IDR",
        minimumFractionDigits: 0
    }).format(angka);
}

// =========================================
// HELPER — ambil waktu sekarang dalam WIB (Asia/Jakarta, UTC+7)
// Indonesia tidak menerapkan DST, jadi offset selalu +7 jam.
// =========================================

function getNowWIB() {
    // Tambahkan 7 jam ke UTC untuk mendapatkan WIB
    return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

// =========================================
// FORMAT TANGGAL — DD / MM / YYYY HH:MM  (WIB)
// =========================================

function formatDate() {
    const now  = getNowWIB();
    const dd   = String(now.getUTCDate()).padStart(2, "0");
    const mm   = String(now.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = now.getUTCFullYear();
    const hh   = String(now.getUTCHours()).padStart(2, "0");
    const mi   = String(now.getUTCMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

// =========================================
// FORMAT K — 5000 → 5k
// =========================================

function formatK(angka) {
    if (angka >= 1000000) return `${(angka / 1000000).toFixed(1)}jt`;
    if (angka >= 1000)    return `${angka / 1000}k`;
    return `${angka}`;
}

// =========================================
// GENERATE REF ID  (menggunakan waktu WIB)
// =========================================

function generateRefId() {
    const now  = getNowWIB();
    const yy   = String(now.getUTCFullYear()).slice(-2);
    const mm   = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd   = String(now.getUTCDate()).padStart(2, "0");
    const time = Date.now().toString().slice(-6);
    return `NYY${yy}${mm}${dd}${time}`;
}

// =========================================
// VALIDASI NOMOR HP
// Format: 08xxxxxxxx atau 628xxxxxxxx
// =========================================

function isValidPhone(number) {
    return /^(08\d{8,11}|628\d{8,11})$/.test(number);
}

// =========================================
// VALIDASI NOMOR METER PLN
// Format: 11-12 digit angka
// =========================================

function isValidMeter(number) {
    return /^\d{11,12}$/.test(number);
}

// =========================================
// NORMALISASI NOMOR HP
// =========================================

function normalizePhone(number) {
    if (number.startsWith("628")) {
        return "0" + number.slice(2);
    }
    return number;
}

// =========================================
// FORMAT SN TOKEN LISTRIK DARI TOKOVOUCHER
// Format API: KODE_TOKEN/NO_METER
// Pemisahan hanya dilakukan pada "/" pertama.
// =========================================

function formatTokenListrikSN(sn) {
    if (sn === undefined || sn === null || sn === "") {
        return "";
    }

    const nilai = String(sn);
    const separatorIndex = nilai.indexOf("/");

    if (separatorIndex === -1) {
        return `\nKODE TOKEN : ${nilai}\nNO METER : -`;
    }

    const kodeToken = nilai.slice(0, separatorIndex);
    const noMeter   = nilai.slice(separatorIndex + 1);

    return `\nKODE TOKEN : ${kodeToken}\nNO METER : ${noMeter}`;
}

module.exports = {
    formatRupiah,
    formatDate,
    formatK,
    generateRefId,
    isValidPhone,
    isValidMeter,
    normalizePhone,
    formatTokenListrikSN,
    getNowWIB
};
