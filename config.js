// =========================================
// KONFIGURASI SERVICE WEB + BOT NOTIFIKASI
// Semua nilai dibaca dari Variables saat deploy.
// =========================================
require("dotenv").config();

const requiredEnv = [
    "DATABASE_URL",
    "SESSION_SECRET",
    "DASHBOARD_KEY",
    "DANA_QR_STRING"
];

for (const key of requiredEnv) {
    if (!process.env[key]) {
        throw new Error(`Environment variable "${key}" belum diisi`);
    }
}

module.exports = {
    BOT_TOKEN:        process.env.BOT_TOKEN || "",
    OWNER_CHAT_ID:    process.env.OWNER_CHAT_ID || "",
    DATABASE_URL:     process.env.DATABASE_URL,
    SESSION_SECRET:   process.env.SESSION_SECRET,
    DASHBOARD_KEY:    process.env.DASHBOARD_KEY,
    DANA_QR_STRING:   process.env.DANA_QR_STRING,
    API_BASE_URL:     process.env.API_BASE_URL || "https://api.tokovoucher.net",
    MEMBER_CODE:      process.env.MEMBER_CODE || "",
    SECRET_KEY:       process.env.SECRET_KEY || "",
    PRODUCT_API_URL:  process.env.PRODUCT_API_URL || "",
    PRODUCT_API_KEY:  process.env.PRODUCT_API_KEY || "",
    KEDAI_API_ID:     process.env.KEDAI_API_ID || "",
    KEDAI_API_KEY:    process.env.KEDAI_API_KEY || "",
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
    AI_MODEL:         process.env.AI_MODEL || "",
    GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "",
    GOOGLE_SERVICE_ACCOUNT_FILE: process.env.GOOGLE_SERVICE_ACCOUNT_FILE || "",
    DEFAULT_PRODUCT_MARKUP: Number(process.env.DEFAULT_PRODUCT_MARKUP || 2500),
    PORT:             Number(process.env.PORT || 3000)
};
