// =========================================
// NOTIFIKASI ADMIN / GRUP REKAP
// Semua notifikasi operasional bot dikirim melalui helper ini.
// =========================================

const { REKAP_GROUP_ID } = require("./config");

function getAdminNotificationTarget() {
    return REKAP_GROUP_ID;
}

function sendAdminNotification(bot, text, options = {}) {
    // Grup hanya menerima hasil transaksi yang sukses.
    // Pesan pending/gagal tetap dikirim ke customer melalui private chat
    // dari alur transaksi masing-masing.
    if (
        typeof text === "string" &&
        (
            /\bTRANSAKSI\s+(TOP UP|SOSMED)\s+PENDING\b/i.test(text) ||
            /\bTRANSAKSI\s+(TOP UP|SOSMED)\s+GAGAL\b/i.test(text)
        )
    ) {
        return Promise.resolve({ skipped: true });
    }

    return bot.sendMessage(getAdminNotificationTarget(), text, options);
}

module.exports = {
    getAdminNotificationTarget,
    sendAdminNotification
};
