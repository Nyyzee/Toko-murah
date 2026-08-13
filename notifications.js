// =========================================
// NOTIFIKASI ADMIN
// Semua notifikasi deposit dikirim langsung ke OWNER_CHAT_ID.
// =========================================

const { OWNER_CHAT_ID } = require("./config");

function getAdminNotificationTarget() {
    return OWNER_CHAT_ID;
}

function sendAdminNotification(bot, text, options = {}) {
    if (!bot || !OWNER_CHAT_ID) return Promise.resolve({ skipped: true });
    return bot.sendMessage(OWNER_CHAT_ID, text, options);
}

module.exports = {
    getAdminNotificationTarget,
    sendAdminNotification
};
