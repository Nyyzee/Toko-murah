// =========================================
// LOAD ENVIRONMENT
// =========================================
require("dotenv").config();
// =========================================
// VALIDASI ENV
// =========================================
const requiredEnv = [
    "BOT_TOKEN",
    "OWNER_CHAT_ID",
    "MEMBER_CODE",
    "SECRET_KEY",
    "DATABASE_URL",
    "REKAP_GROUP_ID"
];
for (const key of requiredEnv) {
    if (!process.env[key]) {
        throw new Error(`❌ Environment variable "${key}" belum diisi`);
    }
}
// =========================================
// EXPORT CONFIG
// =========================================
module.exports = {
    BOT_TOKEN:        process.env.BOT_TOKEN,
    OWNER_CHAT_ID:    process.env.OWNER_CHAT_ID,
    MEMBER_CODE:      process.env.MEMBER_CODE,
    SECRET_KEY:       process.env.SECRET_KEY,
    API_BASE_URL:     process.env.API_BASE_URL || "https://api.tokovoucher.net",
    DATABASE_URL:     process.env.DATABASE_URL,
    // ID grup admin/rekap. Pendaftaran dan transaksi sukses dikirim ke sini.
    REKAP_GROUP_ID:   process.env.REKAP_GROUP_ID,
    GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "",
    GOOGLE_SERVICE_ACCOUNT_FILE: process.env.GOOGLE_SERVICE_ACCOUNT_FILE || "",
    // String QR DANA milik owner (untuk generate gambar QR pembayaran)
    DANA_QR_STRING:   process.env.DANA_QR_STRING   || "",
    // Kunci akses dashboard produk. Simpan hanya di Variables/Environment.
    DASHBOARD_KEY:    process.env.DASHBOARD_KEY    || ""
};
