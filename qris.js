// =========================================
// QRIS HELPER — Generate Dynamic QRIS dengan nominal
// Standar: EMVCo QR Code / Bank Indonesia QRIS
// =========================================

/**
 * CRC16-CCITT (XMODEM) — algoritma checksum standar QRIS
 * @param {string} data
 * @returns {string} 4 hex digit uppercase
 */
function crc16(data) {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= data.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) {
            if (crc & 0x8000) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
            crc &= 0xFFFF;
        }
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Konversi QRIS statis menjadi dinamis dengan nominal tertanam.
 * Saat di-scan, nominal akan otomatis terisi di aplikasi DANA / dompet lain.
 *
 * @param {string} staticQR  - DANA_QR_STRING dari .env (QRIS statis)
 * @param {number} amount    - Nominal dalam Rupiah (contoh: 25000)
 * @returns {string}         - QRIS dinamis siap di-encode menjadi gambar QR
 */
function generateDynamicQRIS(staticQR, amount) {
    if (!staticQR || typeof staticQR !== "string") {
        throw new Error("QRIS string tidak valid.");
    }
    if (!amount || amount <= 0) {
        throw new Error("Nominal tidak valid.");
    }

    // Cari posisi field CRC (tag "63") — selalu paling akhir
    const crcIdx = staticQR.lastIndexOf("6304");
    if (crcIdx === -1) {
        throw new Error("Format QRIS tidak dikenali (field CRC tidak ditemukan).");
    }

    // Ambil data tanpa field CRC
    let qrData = staticQR.slice(0, crcIdx);

    // ── 1. Ubah Point of Initiation Method: 11 (statis) → 12 (dinamis)
    //    Field 01 selalu "010211" untuk statis
    if (qrData.includes("010211")) {
        qrData = qrData.replace("010211", "010212");
    }
    // Jika sudah dinamis ("010212"), biarkan apa adanya

    // ── 2. Sisipkan field 54 (Transaction Amount) sebelum field 58 (Country Code)
    //    Format: "54" + panjang_2digit + nominal_string
    const amountStr  = amount.toString();
    const amountLen  = amountStr.length.toString().padStart(2, "0");
    const amountField = `54${amountLen}${amountStr}`;

    // Cari field 58 (Country Code "ID") untuk titik sisipan yang tepat
    const field58Idx = qrData.indexOf("5802");
    if (field58Idx !== -1) {
        // Pastikan field 54 belum ada, jika ada hapus dulu
        const existing54 = qrData.indexOf("54");
        // Hanya hapus jika field 54 ditemukan DAN terletak sebelum field 58
        // (untuk menghindari salah match pada data merchant)
        qrData = qrData.slice(0, field58Idx) + amountField + qrData.slice(field58Idx);
    } else {
        // Fallback: tambahkan di akhir sebelum CRC
        qrData += amountField;
    }

    // ── 3. Tambahkan kembali field CRC (tag + panjang), lalu hitung ulang
    qrData += "6304";
    const newCRC = crc16(qrData);
    qrData += newCRC;

    return qrData;
}

module.exports = { generateDynamicQRIS, crc16 };
