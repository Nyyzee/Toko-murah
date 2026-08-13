// =========================================
// SESSION STORAGE (in-memory)
// =========================================

const sessions = new Map();

function getSession(chatId) {

    const key = String(chatId);

    if (!sessions.has(key)) {
        sessions.set(key, {
            step:          null,
            kategoriId:    null,
            kategoriLabel: null,
            isPLN:         false,
            isGameId:      false,
            tujuanLabel:   null,
            tujuanPrompt:  null,
            nama:          null,
            resellerId:    null,   // ID reseller dari DB
            tujuan:        null,
            kode:          null,
            nominal:       null,
            harga:         null,
            label:         null,
            refId:         null,
            processing:    false
        });
    }

    return sessions.get(key);

}

function clearSession(chatId) {
    sessions.delete(String(chatId));
}

module.exports = { getSession, clearSession };
