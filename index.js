// =========================================
// TELEGRAM BOT — TOP UP DANA & GAME
// Versi dengan PostgreSQL untuk saldo reseller
// =========================================

const TelegramBot = require("node-telegram-bot-api");

const {
    BOT_TOKEN,
    OWNER_CHAT_ID,
    DANA_QR_STRING
} = require("./config");

const {
    categories,
    groups,
    getCategoryById,
    getProductByKode,
    getSellingPrice,
    syncHargaDariAPI,
    syncHargaSosmed,
    loadProductsFromDB
} = require("./products");

const { getSession, clearSession }       = require("./session");
const { topup }                          = require("./tokovoucher");
const { orderSosmed }                    = require("./kedaisosmed");
const { savePending }                    = require("./pending");
const { startWebhookServer }             = require("./webhook");
const { kirimKeRekapBot }                = require("./rekap-client");
const { sendAdminNotification }          = require("./notifications");
const { getRekap, getListReseller, hapusTerakhir, formatRekapText, RESELLERS: REKAP_RESELLERS, resolveReseller, addResellerToConfig, extractSpreadsheetId, validateSpreadsheet } = require("./rekap");
const askAI                              = require("./ai/ai");
const QRCode                             = require("qrcode");
const { generateDynamicQRIS }            = require("./qris");

const {
    initDB,
    tambahReseller,
    tambahResellerLengkap,
    simpanSpreadsheetId,
    getAllResellersWithSpreadsheet,
    getResellerByPassword,
    getResellerByUsername,
    ubahPasswordReseller,
    getResellerById,
    getAllResellers,
    topupSaldo,
    kurangSaldo,
    potongSaldo,
    kembalikanSaldo,
    hapusReseller,
    saveRekapUser,
    getRekapChatId
} = require("./db");

const {
    formatRupiah,
    formatDate,
    formatK,
    formatTokenListrikSN,
    generateRefId,
    isValidPhone,
    isValidMeter
} = require("./utils");

// =========================================
// EMOJI (Unicode escape — aman di semua server)
// =========================================

const E = {
    ok:      "\u2705",         // ✅
    fail:    "\u274C",         // ❌
    wait:    "\u23F3",         // ⏳
    lock:    "\uD83D\uDD12",   // 🔒
    phone:   "\uD83D\uDCF1",   // 📱
    card:    "\uD83D\uDCB3",   // 💳
    money:   "\uD83D\uDCB0",   // 💰
    id:      "\uD83C\uDD94",   // 🆔
    receipt: "\uD83E\uDDFE",   // 🧾
    reload:  "\uD83D\uDD04",   // 🔄
    rocket:  "\uD83D\uDE80",   // 🚀
    person:  "\uD83D\uDC64",   // 👤
    list:    "\uD83D\uDCCB",   // 📋
    plus:    "\u2795",         // ➕
    minus:   "\u2796",         // ➖
    trash:   "\uD83D\uDDD1",   // 🗑️
    key:     "\uD83D\uDD11",   // 🔑
    wallet:  "\uD83D\uDCB8",   // 💸
    bar:     "\uD83D\uDCCA",   // 📊
    robot:   "\uD83E\uDD16",   // 🤖
    chat:    "💬",   // 💬
    shake:   "🤝",   // 🤝
    home:    "\uD83C\uDFE0",   // 🏠
};

// =========================================
// INISIALISASI BOT + DB
// =========================================

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// =========================================
// SYNC HARGA OTOMATIS DARI TOKOVOUCHER API
// Dijalankan saat startup, lalu setiap 6 jam
// =========================================

const INTERVAL_SYNC_MS = 6 * 60 * 60 * 1000; // 6 jam

async function jalankanSyncHarga() {
    console.log("[SYNC HARGA] Memperbarui harga dari TokoVoucher API...");
    await syncHargaDariAPI();
}

// =========================================
// SYNC HARGA SOSMED (KedaiSosmed) OTOMATIS
// Ambil harga per 1k dari API saat startup
// =========================================

async function jalankanSyncSosmed() {
    console.log("[SYNC SOSMED] Memperbarui harga dari KedaiSosmed API...");
    await syncHargaSosmed();
}

// Database dan katalog harus siap sebelum bot mulai menyinkronkan harga.
initDB().then(async () => {
    console.log(E.ok + " Database siap.");
    await loadProductsFromDB();

    // Muat reseller yang sudah punya spreadsheet dari DB ke konfigurasi rekap.
    try {
        const rows = await getAllResellersWithSpreadsheet();
        for (const r of rows) {
            addResellerToConfig(r.nama, r.spreadsheet_id);
        }
        if (rows.length > 0) {
            console.log(`[REKAP] ${rows.length} reseller dimuat dari DB ke konfigurasi spreadsheet.`);
        }
    } catch (err) {
        console.log("[REKAP] Gagal muat reseller dari DB:", err.message);
    }

    jalankanSyncHarga().catch(err => console.log("[SYNC HARGA] Error:", err.message));
    jalankanSyncSosmed().catch(err => console.log("[SYNC SOSMED] Error:", err.message));
    setInterval(() => jalankanSyncHarga().catch(err => {
        console.log("[SYNC HARGA] Error:", err.message);
    }), INTERVAL_SYNC_MS);
    setInterval(() => jalankanSyncSosmed().catch(err => {
        console.log("[SYNC SOSMED] Error:", err.message);
    }), INTERVAL_SYNC_MS);
}).catch(err => {
    console.error("[DB] Gagal inisialisasi:", err.message);
    process.exit(1);
});

console.log(E.ok + " Bot Telegram berhasil dijalankan.");

startWebhookServer(bot);

// =========================================
// JOIN RESELLER — pendaftaran reseller baru
// Map pendingRegistrations: invoiceId → data pendaftar
// =========================================

const pendingRegistrations = new Map();
let invoiceSeq = 0;

function generateInvoiceId() {
    invoiceSeq++;
    // Gunakan waktu WIB agar nomor invoice sesuai tanggal Indonesia
    const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const y = wib.getUTCFullYear();
    const m = String(wib.getUTCMonth() + 1).padStart(2, "0");
    const d = String(wib.getUTCDate()).padStart(2, "0");
    return `INV${y}${m}${d}${String(invoiceSeq).padStart(4, "0")}`;
}

// =========================================
// HELPER: cek apakah chatId adalah owner
// =========================================

function isOwner(chatId, fromId) {
    return String(chatId) === String(OWNER_CHAT_ID) ||
           (fromId != null && String(fromId) === String(OWNER_CHAT_ID));
}

// =========================================
// HELPER: escape karakter khusus Markdown v1
// Mencegah error "Can't parse entities" saat data user mengandung _, *, `, [
// =========================================
function escapeMd(text) {
    return String(text || "").replace(/([_*`[\]])/g, "\\$1");
}

// Password harus diawali nama reseller dan diakhiri angka.
// Perbandingan nama tidak membedakan huruf besar/kecil.
function isPasswordForName(nama, password) {
    const namaNormal     = String(nama     || "").trim();
    const passwordNormal = String(password || "").trim();

    if (!namaNormal || !passwordNormal || passwordNormal.length <= namaNormal.length) {
        return false;
    }

    const prefix = passwordNormal.slice(0, namaNormal.length);
    const suffix = passwordNormal.slice(namaNormal.length);

    return prefix.toLocaleLowerCase("id-ID") === namaNormal.toLocaleLowerCase("id-ID")
        && /^\d+$/.test(suffix);
}

// =========================================
// KEYBOARD MENU UTAMA (GRUP)
// =========================================

function createGroupKeyboard() {
    return {
        inline_keyboard: [
            ...groups.map(grp => ([
                { text: `${grp.emoji} ${grp.label}`, callback_data: `GRP_${grp.id}` }
            ])),
            [{ text: `👥 Join Reseller`, callback_data: "JOIN_RESELLER" }],
[{ text: `💬 Bantuan Admin`, callback_data: "BANTUAN_ADMIN" }]
        ]
    };
}

// =========================================
// KEYBOARD SUB-KATEGORI (dalam grup)
// =========================================

function createSubCategoryKeyboard(grp) {
    return {
        inline_keyboard: grp.categoryIds.map(catId => {
            const cat = getCategoryById(catId);
            return [{ text: `${cat.emoji ? `${cat.emoji} ` : ""}${cat.label}`, callback_data: `CAT_${cat.id}` }];
        })
    };
}

// =========================================
// KEYBOARD PILIH NOMINAL
// =========================================

function createProductKeyboard(cat) {
    const tampilkanEmojiNominal = cat.id === "dana"
        || cat.id === "gopay"
        || cat.id === "shopee"
        || cat.id === "pln"
        || cat.isGameId;

    const emojiNominal = tampilkanEmojiNominal && cat.emoji ? `${cat.emoji} ` : "";

    // Khusus DANA: urutkan berdasarkan nominal
    const products = cat.id === "dana"
        ? [...cat.products].sort((a, b) => a.nominal - b.nominal)
        : cat.products;

    // Sosmed: 5 produk per baris agar tidak melampaui limit Telegram
    if (cat.isSosmed) {
        const rows = [];
        for (let i = 0; i < products.length; i += 5) {
            const row = products.slice(i, i + 5).map(item => ({
                text: `${emojiNominal}${item.label}`,
                callback_data: `BUY_${item.kode}`
            }));
            rows.push(row);
        }
        return { inline_keyboard: rows };
    }

    return {
        inline_keyboard: products.map(item => ([
            {
                text: `${emojiNominal}${item.label}`,
                callback_data: `BUY_${item.kode}`
            }
        ]))
    };
}

// Menu inline dipakai sebagai satu layar yang terus diperbarui.
// Jika Telegram tidak mengizinkan pengeditan (misalnya pesan lama berupa foto),
// gunakan fallback kirim pesan baru agar alur tetap berjalan.
async function replaceMenuMessage(query, text, replyMarkup, options = {}) {
    const message = query.message;
    const editOptions = {
        chat_id: message.chat.id,
        message_id: message.message_id,
        reply_markup: replyMarkup,
        ...options
    };

    try {
        return await bot.editMessageText(text, editOptions);
    } catch (error) {
        const description = String(error?.response?.body?.description || error.message || "");
        if (/message is not modified/i.test(description)) {
            return;
        }

        console.log("[MENU] Tidak dapat mengedit pesan lama, kirim pesan baru:", description);
        return bot.sendMessage(message.chat.id, text, {
            ...options,
            reply_markup: replyMarkup
        });
    }
}

// =========================================
// FITUR REKAP — terintegrasi di bot utama
// =========================================
const rekapSendState = new Map();

function isRekapOwner(msg) {
    return isOwner(msg.chat.id, msg.from?.id);
}

function rekapKeyboard(prefix) {
    return {
        inline_keyboard: Object.keys(REKAP_RESELLERS).map(name => ([
            { text: `👤 ${name}`, callback_data: `${prefix}:${name}` }
        ]))
    };
}

bot.onText(/^\/rekap(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!isRekapOwner(msg)) return bot.sendMessage(msg.chat.id, `${E.fail} Kamu tidak punya akses perintah rekap.`);
    const raw = (match?.[1] || "").trim();
    const reseller = raw ? resolveReseller(raw) : null;
    if (raw && !reseller) return bot.sendMessage(msg.chat.id, `${E.fail} Reseller tidak ditemukan. Tersedia: ${Object.keys(REKAP_RESELLERS).join(", ")}`);
    try {
        const data = await getRekap(reseller);
        const label = reseller ? `REKAP RESELLER — ${reseller}` : "REKAP SEMUA RESELLER";
        return bot.sendMessage(msg.chat.id, formatRekapText(label, data));
    } catch (err) {
        console.log("[REKAP] Gagal /rekap:", err.message);
        return bot.sendMessage(msg.chat.id, `${E.fail} Gagal mengambil rekap.\nError: ${err.message}`);
    }
});

bot.onText(/^\/list(?:@\w+)?$/i, async (msg) => {
    if (!isRekapOwner(msg)) return bot.sendMessage(msg.chat.id, `${E.fail} Kamu tidak punya akses perintah rekap.`);
    return bot.sendMessage(msg.chat.id, "📋 Pilih nama yang ingin dilihat transaksinya:", { reply_markup: rekapKeyboard("REKAP_LIST") });
});

bot.onText(/^\/hapus(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!isRekapOwner(msg)) return bot.sendMessage(msg.chat.id, `${E.fail} Kamu tidak punya akses perintah rekap.`);
    const raw=(match?.[1] || "").trim();
    if (!raw) return bot.sendMessage(msg.chat.id, "Gunakan: /hapus Dodi");
    const reseller=resolveReseller(raw);
    if (!reseller) return bot.sendMessage(msg.chat.id, `${E.fail} Reseller tidak ditemukan.`);
    try {
        const ok=await hapusTerakhir(reseller);
        return bot.sendMessage(msg.chat.id, ok ? `🗑️ Transaksi terakhir ${reseller} berhasil dihapus.` : `❌ Reseller tidak ditemukan atau belum memiliki transaksi.`);
    } catch (err) {
        console.log("[REKAP] Gagal /hapus:", err.message);
        return bot.sendMessage(msg.chat.id, `${E.fail} Gagal menghapus transaksi.\nError: ${err.message}`);
    }
});

bot.onText(/^\/kirimrekap(?:@\w+)?$/i, async (msg) => {
    if (!isRekapOwner(msg)) return bot.sendMessage(msg.chat.id, `${E.fail} Kamu tidak punya akses perintah rekap.`);
    rekapSendState.set(msg.chat.id, { step: "username" });
    return bot.sendMessage(msg.chat.id,
        "📤 Kirim Rekap ke Reseller\n\n" +
        "Masukkan salah satu:\n" +
        "• username Telegram, contoh: @dodi123\n" +
        "• ID reseller, contoh: 5\n" +
        "• chat_id Telegram, contoh: 123456789"
    );
});

// =========================================
// OWNER: /set_rekap [id reseller] [URL/ID spreadsheet]
// Spreadsheet dibuat manual oleh owner dan dibagikan
// ke service account sebagai Editor.
// =========================================
bot.onText(/^\/set_rekap(?:@\w+)?(?:\s+(\d+))(?:\s+(\S+))?$/i, async (msg, match) => {
    if (!isRekapOwner(msg)) return bot.sendMessage(msg.chat.id, `${E.fail} Kamu tidak punya akses perintah rekap.`);

    const resellerId = Number(match?.[1]);
    const spreadsheetId = extractSpreadsheetId(match?.[2]);
    if (!spreadsheetId) {
        return bot.sendMessage(
            msg.chat.id,
            `${E.fail} Format salah.\nGunakan:\n/set_rekap ID_RESELLER URL_SPREADSHEET`
        );
    }

    try {
        const reseller = await getResellerById(resellerId);
        if (!reseller) {
            return bot.sendMessage(msg.chat.id, `${E.fail} Reseller ID ${resellerId} tidak ditemukan.`);
        }

        await validateSpreadsheet(spreadsheetId);
        await simpanSpreadsheetId(reseller.id, spreadsheetId);
        addResellerToConfig(reseller.nama, spreadsheetId);

        return bot.sendMessage(
            msg.chat.id,
            `${E.ok} Spreadsheet berhasil dihubungkan.\n\n` +
            `Reseller: ${reseller.nama}\n` +
            `Spreadsheet: https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit\n\n` +
            `Transaksi berikutnya akan otomatis masuk ke spreadsheet ini.`
        );
    } catch (err) {
        console.log("[REKAP] Gagal /set_rekap:", err.message);
        return bot.sendMessage(
            msg.chat.id,
            `${E.fail} Spreadsheet tidak bisa diakses.\n\n` +
            `Pastikan spreadsheet sudah dibagikan ke email service account sebagai Editor.\n` +
            `Pastikan worksheet bernama Sheet1.\n\n` +
            `Detail: ${err.message}`
        );
    }
});

// =========================================
// COMMAND /start — sambut pengguna
// =========================================

bot.onText(/\/start/, async (msg) => {

    const chatId = msg.chat.id;

    if (msg.chat.type !== "private") return;

    if (msg.from?.username) {
        saveRekapUser(msg.from.username, chatId).catch(err => console.log("[REKAP] Gagal simpan user:", err.message));
    }

    clearSession(chatId);

    await bot.sendMessage(
        chatId,
        `\uD83C\uDF19 Assalamu'alaikum Warahmatullahi Wabarakatuh\n\nSelamat datang! Semoga transaksi hari ini berkah dan lancar \uD83E\uDD0D\n\nSilakan pilih produk yang ingin di top up.`,
        { reply_markup: createGroupKeyboard() }
    );

});

// =========================================
// COMMAND /saldo — cek saldo reseller
// =========================================

bot.onText(/\/saldo/, async (msg) => {

    const chatId = msg.chat.id;

    if (msg.chat.type !== "private") return;

    const session = getSession(chatId);

    // Jika reseller sudah login di session, tampilkan saldo langsung
    if (session.resellerId) {
        const reseller = await getResellerById(session.resellerId).catch(() => null);
        if (reseller) {
            return bot.sendMessage(
                chatId,
                `${E.wallet} Saldo kamu: *${formatRupiah(reseller.saldo)}*\nNama: ${reseller.nama}`,
                { parse_mode: "Markdown" }
            );
        }
    }

    // Jika belum login, minta password dulu
    const tempSession = getSession(chatId);
    tempSession.step = "WAIT_PASSWORD_SALDO";
    await bot.sendMessage(chatId, `${E.lock} Masukkan password kamu untuk cek saldo.`);

});

// =========================================
// COMMAND /help — panduan
// =========================================

bot.onText(/\/help/, async (msg) => {

    const chatId = msg.chat.id;

    if (msg.chat.type !== "private") return;

    let text = `${E.rocket} *PANDUAN BOT TOP UP*\n`;
    text += `━━━━━━━━━━━━━━━━━━━\n\n`;

    text += `*📋 PERINTAH UTAMA*\n`;
    text += `/start — Mulai / kembali ke menu utama\n`;
    text += `/saldo — Cek saldo kamu\n`;
    text += `/bantuan — Tanya Bantuan Admin (AI)\n`;
    text += `/help — Tampilkan panduan ini\n\n`;

    text += `━━━━━━━━━━━━━━━━━━━\n`;
    text += `*💡 CARA PENGGUNAAN*\n\n`;

    text += `1. Pilih layanan yang ingin digunakan.\n`;
    text += `2. Pilih produk atau paket yang tersedia.\n`;
    text += `3. Masukkan data tujuan sesuai petunjuk.\n`;
    text += `4. Periksa kembali detail pesanan.\n`;
    text += `5. Tekan Konfirmasi untuk memproses transaksi.\n`;
    text += `6. Tunggu sampai pesanan selesai diproses.\n\n`;
    text += `Pastikan data tujuan yang dimasukkan sudah benar.\n\n`;

    text += `━━━━━━━━━━━━━━━━━━━\n`;
    text += `ℹ️ Setiap transaksi membutuhkan konfirmasi sebelum diproses. Pastikan data yang dimasukkan sudah benar.`;

    await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });

});
// =========================================
// COMMAND /bantuan — aktifkan mode AI
// =========================================

bot.onText(/\/bantuan/, async (msg) => {

    const chatId = msg.chat.id;

    if (msg.chat.type !== "private") return;

    const session = getSession(chatId);
    session.step = "WAIT_AI";

    await bot.sendMessage(
        chatId,
        `${E.chat} *BANTUAN ADMIN*\n━━━━━━━━━━━━━━━━━━━\n\nHalo! Saya siap membantu menjelaskan cara penggunaan bot ini.\n\nSilakan ketik pertanyaan kamu.\nContoh:\n• Cara melakukan top up DANA\n• Cara cek saldo\n• Cara membeli token listrik\n• Cara top up Free Fire\n\nKetik /start untuk kembali ke menu utama.`,
        { parse_mode: "Markdown" }
    );

});

// =========================================
// OWNER: /tambah_reseller [password] [nama] [saldo]
// Contoh: /tambah_reseller pass123 Dodi 100000
// =========================================

bot.onText(/^\/tambah_reseller(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {

    const chatId = msg.chat.id;

    if (!isOwner(chatId, msg.from?.id)) {
        return bot.sendMessage(chatId, `${E.fail} Kamu tidak punya akses perintah ini.`);
    }

    const args = (match[1] || "").trim().split(/\s+/);

    if (args.length < 2) {
        return bot.sendMessage(
            chatId,
            `${E.fail} Format salah.\n\nGunakan: /tambah_reseller [password] [nama] [saldo_awal]\n\nContoh: /tambah_reseller pass123 Dodi 100000`
        );
    }

    const password   = args[0];
    const nama       = args[1];
    const saldoAwal  = args[2] ? parseInt(args[2], 10) : 0;

    if (!isPasswordForName(nama, password)) {
        return bot.sendMessage(
            chatId,
            `${E.fail} Password tidak valid.\n\nPassword harus diawali nama reseller dan diakhiri angka.\nContoh: Dodi12345`
        );
    }

    if (isNaN(saldoAwal) || saldoAwal < 0) {
        return bot.sendMessage(chatId, `${E.fail} Saldo tidak valid.`);
    }

    try {
        const reseller = await tambahReseller(nama, password, saldoAwal);
        await bot.sendMessage(
            chatId,
            `${E.ok} Reseller berhasil ditambahkan!\n\n${E.id} ID      : ${reseller.id}\n${E.person} Nama    : ${reseller.nama}\n${E.key} Password: ${reseller.password}\n${E.wallet} Saldo   : ${formatRupiah(reseller.saldo)}`
        );
    } catch (err) {
        if (err.code === "23505") {
            return bot.sendMessage(chatId, `${E.fail} Password sudah digunakan oleh reseller lain.`);
        }
        console.log("[TAMBAH_RESELLER] Error:", err.message);
        return bot.sendMessage(chatId, `${E.fail} Gagal tambah reseller: ${err.message}`);
    }

});

// =========================================
// OWNER: /ubah_password_reseller [id] [password_baru]
// Contoh: /ubah_password_reseller 1 Dodi98765
// =========================================

bot.onText(/^\/ubah_password_reseller(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {

    const chatId = msg.chat.id;

    if (!isOwner(chatId, msg.from?.id)) {
        return bot.sendMessage(chatId, `${E.fail} Kamu tidak punya akses perintah ini.`);
    }

    const args = (match[1] || "").trim().split(/\s+/);

    if (args.length < 2) {
        return bot.sendMessage(
            chatId,
            `${E.fail} Format salah.\n\nGunakan: /ubah_password_reseller [id] [password_baru]\n\nContoh: /ubah_password_reseller 1 Dodi98765`
        );
    }

    const id = parseInt(args[0], 10);
    const passwordBaru = args[1];

    if (isNaN(id) || id <= 0) {
        return bot.sendMessage(chatId, `${E.fail} ID reseller tidak valid.`);
    }

    try {
        const resellerLama = await getResellerById(id);

        if (!resellerLama) {
            return bot.sendMessage(chatId, `${E.fail} Reseller dengan ID ${id} tidak ditemukan.`);
        }

        if (!isPasswordForName(resellerLama.nama, passwordBaru)) {
            return bot.sendMessage(
                chatId,
                `${E.fail} Password tidak valid.\n\nPassword harus diawali nama reseller (${resellerLama.nama}) dan diakhiri angka.\nContoh: ${resellerLama.nama}98765`
            );
        }

        const reseller = await ubahPasswordReseller(id, passwordBaru);

        await bot.sendMessage(
            chatId,
            `${E.ok} Password reseller berhasil diubah.\n\n${E.id} ID       : ${reseller.id}\n${E.person} Nama     : ${reseller.nama}\n${E.key} Password : ${reseller.password}`
        );
    } catch (err) {
        if (err.code === "23505") {
            return bot.sendMessage(chatId, `${E.fail} Password sudah digunakan oleh reseller lain.`);
        }
        console.log("[UBAH_PASSWORD_RESELLER] Error:", err.message);
        return bot.sendMessage(chatId, `${E.fail} Gagal mengubah password reseller.`);
    }

});

// =========================================
// OWNER: /topup_saldo [id] [jumlah]
// =========================================

bot.onText(/^\/topup_saldo(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {

    const chatId = msg.chat.id;

    if (!isOwner(chatId, msg.from?.id)) {
        return bot.sendMessage(chatId, `${E.fail} Kamu tidak punya akses perintah ini.`);
    }

    const args = (match[1] || "").trim().split(/\s+/);

    if (args.length < 2) {
        return bot.sendMessage(
            chatId,
            `${E.fail} Format salah.\n\nGunakan: /topup_saldo [id] [jumlah]\n\nContoh: /topup_saldo 1 50000`
        );
    }

    const id     = parseInt(args[0], 10);
    const jumlah = parseInt(args[1], 10);

    if (isNaN(id) || isNaN(jumlah) || jumlah <= 0) {
        return bot.sendMessage(chatId, `${E.fail} ID atau jumlah tidak valid.`);
    }

    try {
        const reseller = await topupSaldo(id, jumlah);

        if (!reseller) {
            return bot.sendMessage(chatId, `${E.fail} Reseller dengan ID ${id} tidak ditemukan.`);
        }

        await bot.sendMessage(
            chatId,
            `${E.ok} Saldo berhasil ditambahkan!\n\n${E.id} ID      : ${reseller.id}\n${E.person} Nama    : ${reseller.nama}\n${E.plus} Ditambah: ${formatRupiah(jumlah)}\n${E.wallet} Saldo   : ${formatRupiah(reseller.saldo)}`
        );
    } catch (err) {
        console.log("[TOPUP_SALDO] Error:", err.message);
        return bot.sendMessage(chatId, `${E.fail} Gagal topup saldo: ${err.message}`);
    }

});

// =========================================
// OWNER: /kurang_saldo [id] [jumlah]
// =========================================

bot.onText(/^\/kurang_saldo(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {

    const chatId = msg.chat.id;

    if (!isOwner(chatId, msg.from?.id)) {
        return bot.sendMessage(chatId, `${E.fail} Kamu tidak punya akses perintah ini.`);
    }

    const args = (match[1] || "").trim().split(/\s+/);

    if (args.length < 2) {
        return bot.sendMessage(
            chatId,
            `${E.fail} Format salah.\n\nGunakan: /kurang_saldo [id] [jumlah]\n\nContoh: /kurang_saldo 1 10000`
        );
    }

    const id     = parseInt(args[0], 10);
    const jumlah = parseInt(args[1], 10);

    if (isNaN(id) || isNaN(jumlah) || jumlah <= 0) {
        return bot.sendMessage(chatId, `${E.fail} ID atau jumlah tidak valid.`);
    }

    try {
        const reseller = await kurangSaldo(id, jumlah);

        if (!reseller) {
            return bot.sendMessage(chatId, `${E.fail} Reseller dengan ID ${id} tidak ditemukan.`);
        }

        await bot.sendMessage(
            chatId,
            `${E.ok} Saldo berhasil dikurangi!\n\n${E.id} ID       : ${reseller.id}\n${E.person} Nama     : ${reseller.nama}\n${E.minus} Dikurangi: ${formatRupiah(jumlah)}\n${E.wallet} Saldo    : ${formatRupiah(reseller.saldo)}`
        );
    } catch (err) {
        console.log("[KURANG_SALDO] Error:", err.message);
        return bot.sendMessage(chatId, `${E.fail} Gagal kurangi saldo: ${err.message}`);
    }

});

// =========================================
// OWNER: /lihat_reseller
// =========================================

bot.onText(/^\/lihat_reseller(?:@\w+)?$/i, async (msg) => {

    const chatId = msg.chat.id;

    if (!isOwner(chatId, msg.from?.id)) {
        return bot.sendMessage(chatId, `${E.fail} Kamu tidak punya akses perintah ini.`);
    }

    try {
        const list = await getAllResellers();

        if (list.length === 0) {
            return bot.sendMessage(chatId, `${E.list} Belum ada reseller terdaftar.`);
        }

        let text = `${E.list} *DAFTAR RESELLER* (${list.length})\n\n`;

        for (const r of list) {
            text += `${E.id} ID ${r.id} — ${r.nama}\n`;
            text += `   ${E.key} Pass: \`${r.password}\`\n`;
            text += `   ${E.wallet} Saldo: ${formatRupiah(r.saldo)}\n\n`;
        }

        await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
    } catch (err) {
        console.log("[LIHAT_RESELLER] Error:", err.message);
        return bot.sendMessage(chatId, `${E.fail} Gagal ambil data reseller.`);
    }

});

// =========================================
// OWNER: /info_reseller [id]
// =========================================

bot.onText(/^\/info_reseller(?:@\w+)?(?:\s+(\d+))?$/i, async (msg, match) => {

    const chatId = msg.chat.id;

    if (!isOwner(chatId, msg.from?.id)) {
        return bot.sendMessage(chatId, `${E.fail} Kamu tidak punya akses perintah ini.`);
    }

    const id = parseInt(match[1] || "", 10);

    if (!id) {
        return bot.sendMessage(chatId, `${E.fail} Gunakan: /info_reseller [id]`);
    }

    try {
        const r = await getResellerById(id);

        if (!r) {
            return bot.sendMessage(chatId, `${E.fail} Reseller ID ${id} tidak ditemukan.`);
        }

        await bot.sendMessage(
            chatId,
            `${E.person} *DETAIL RESELLER*\n\n${E.id} ID       : ${r.id}\n${E.person} Nama     : ${r.nama}\n${E.key} Password : \`${r.password}\`\n${E.wallet} Saldo    : ${formatRupiah(r.saldo)}\n${E.receipt} Terdaftar: ${new Date(r.created_at).toLocaleDateString("id-ID")}`,
            { parse_mode: "Markdown" }
        );
    } catch (err) {
        return bot.sendMessage(chatId, `${E.fail} Gagal ambil info reseller.`);
    }

});

// =========================================
// OWNER: /hapus_reseller [id]
// =========================================

bot.onText(/^\/hapus_reseller(?:@\w+)?(?:\s+(\d+))?$/i, async (msg, match) => {

    const chatId = msg.chat.id;

    if (!isOwner(chatId, msg.from?.id)) {
        return bot.sendMessage(chatId, `${E.fail} Kamu tidak punya akses perintah ini.`);
    }

    const id = parseInt(match[1] || "", 10);

    if (!id) {
        return bot.sendMessage(chatId, `${E.fail} Gunakan: /hapus_reseller [id]`);
    }

    try {
        const r = await hapusReseller(id);

        if (!r) {
            return bot.sendMessage(chatId, `${E.fail} Reseller ID ${id} tidak ditemukan.`);
        }

        await bot.sendMessage(
            chatId,
            `${E.trash} Reseller berhasil dihapus.\n\n${E.id} ID   : ${r.id}\n${E.person} Nama : ${r.nama}`
        );
    } catch (err) {
        console.log("[HAPUS_RESELLER] Error:", err.message);
        return bot.sendMessage(chatId, `${E.fail} Gagal hapus reseller.`);
    }

});

// =========================================
// CALLBACK BUTTON
// =========================================

bot.on("callback_query", async (query) => {

    const chatId   = query.message.chat.id;
    const data     = query.data;
    const isPrivate = query.message.chat.type === "private";

    await bot.answerCallbackQuery(query.id);

    // =========================================
    // REKAP: pilih reseller untuk /list
    // =========================================
    if (data.startsWith("REKAP_LIST:")) {
        if (!isOwner(chatId, query.from?.id)) return;
        const reseller = resolveReseller(data.split(":")[1]);
        if (!reseller) return bot.sendMessage(chatId, `${E.fail} Reseller tidak ditemukan.`);
        try {
            const rows = await getListReseller(reseller, 10);
            if (!rows || rows.length === 0) return bot.editMessageText(`Belum ada transaksi untuk ${reseller}.`, { chat_id: chatId, message_id: query.message.message_id });
            let text = `📋 10 Transaksi Terakhir — ${reseller}\n\n`;
            rows.forEach((trx, i) => { text += `${i+1}. ${trx.tanggal}\n   📦 ${trx.produk}\n   💰 ${trx.harga}\n   📈 ${trx.profit}\n\n`; });
            return bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id });
        } catch (err) {
            return bot.editMessageText(`${E.fail} Gagal mengambil data.\nError: ${err.message}`, { chat_id: chatId, message_id: query.message.message_id });
        }
    }

    // =========================================
    // REKAP: pilih reseller untuk /kirimrekap
    // =========================================
    if (data.startsWith("REKAP_KIRIM:")) {
        if (!isOwner(chatId, query.from?.id)) return;
        const reseller = resolveReseller(data.split(":")[1]);
        const state = rekapSendState.get(chatId);
        if (!reseller || !state?.targetChatId) return bot.sendMessage(chatId, `${E.fail} Proses /kirimrekap sudah tidak tersedia. Ulangi /kirimrekap.`);
        rekapSendState.delete(chatId);
        try {
            const recap = await getRekap(reseller);
            await bot.sendMessage(state.targetChatId, formatRekapText(`REKAP RESELLER — ${reseller}`, recap));
            return bot.editMessageText(`✅ Rekap ${reseller} berhasil dikirim ke ${state.targetUsername}.`, { chat_id: chatId, message_id: query.message.message_id });
        } catch (err) {
            console.log("[REKAP] Gagal kirim:", err.message);
            return bot.editMessageText(`${E.fail} Gagal mengirim rekap.\nError: ${err.message}`, { chat_id: chatId, message_id: query.message.message_id });
        }
    }

    // =========================================
    // ADMIN: TERIMA / TOLAK PENDAFTARAN RESELLER
    // Bisa dari grup rekap maupun private
    // =========================================
    if (data.startsWith("TERIMA_REG_") || data.startsWith("TOLAK_REG_")) {
        if (!isOwner(chatId, query.from?.id)) {
            return bot.sendMessage(chatId, `${E.fail} Hanya owner yang boleh memproses pendaftaran reseller.`);
        }

        const invoiceId = data.replace("TERIMA_REG_", "").replace("TOLAK_REG_", "");
        const reg = pendingRegistrations.get(invoiceId);

        if (!reg) {
            return bot.sendMessage(chatId, `${E.fail} Pendaftaran tidak ditemukan atau sudah diproses.`);
        }
        if (reg.processed) {
            return bot.sendMessage(chatId, `${E.fail} Pendaftaran ini sudah diproses sebelumnya.`);
        }

        reg.processed = true;
        pendingRegistrations.set(invoiceId, reg);

        if (data.startsWith("TERIMA_REG_")) {
            // Daftarkan reseller ke database
            try {
                const reseller = await tambahResellerLengkap(reg.nama, reg.password, reg.deposit, {
                    telegram_id: reg.from.id,
                    chat_id:     reg.chatId,
                    username:    reg.from.username || null,
                    first_name:  reg.from.first_name || null,
                    last_name:   reg.from.last_name  || null
                });

                // Konfirmasi ke user
                await bot.sendMessage(
                    reg.chatId,
                    `${E.ok} *PENDAFTARAN RESELLER DITERIMA*\n` +
                    `━━━━━━━━━━━━━━━━━━━\n\n` +
                    `${E.person} Nama     : ${escapeMd(reseller.nama)}\n` +
                    `${E.key} Password : ${escapeMd(reseller.password)}\n` +
                    `${E.wallet} Saldo    : ${formatRupiah(reseller.saldo)}\n\n` +
                    `${E.ok} Akun reseller telah aktif.\n` +
                    `Saldo awal telah masuk.\n\n` +
                    `Ketik /start untuk mulai bertransaksi.`,
                    { parse_mode: "Markdown" }
                );

                await bot.editMessageText(
                    `${E.ok} PENDAFTARAN DITERIMA\n\n` +
                    `${E.person} ${reg.nama} | ID ${reseller.id}\n` +
                    `${E.receipt} ${invoiceId}\n` +
                    `${E.wallet} Deposit: ${formatRupiah(reg.deposit)}\n` +
                    `📊 Buat spreadsheet manual, bagikan ke service account, lalu jalankan:\n` +
                    `/set_rekap ${reseller.id} URL_SPREADSHEET`,
                    { chat_id: chatId, message_id: query.message.message_id }
                ).catch(() => {});

            } catch (err) {
                reg.processed = false; // rollback flag
                if (err.code === "23505") {
                    return bot.sendMessage(chatId, `${E.fail} Password sudah digunakan reseller lain.`);
                }
                console.log("[TERIMA_REG] Error:", err.message);
                return bot.sendMessage(chatId, `${E.fail} Gagal mendaftarkan reseller: ${err.message}`);
            }

        } else {
            // TOLAK
            await bot.sendMessage(
                reg.chatId,
                `${E.fail} *PENDAFTARAN RESELLER DITOLAK*
━━━━━━━━━━━━━━━━━━━

Maaf, pendaftaran kamu tidak dapat diproses saat ini.

Silakan hubungi Admin untuk informasi lebih lanjut.`,
                { parse_mode: "Markdown" }
            ).catch(() => {});

            await bot.editMessageText(
                `${E.fail} PENDAFTARAN DITOLAK

${E.person} ${reg.nama}
${E.receipt} ${invoiceId}
${E.wallet} Deposit: ${formatRupiah(reg.deposit)}`,
                { chat_id: chatId, message_id: query.message.message_id }
            ).catch(() => {});
        }

        pendingRegistrations.delete(invoiceId);
        return;
    }

    // Semua callback lainnya hanya untuk private chat
    if (!isPrivate) return;

    // =========================================
    // ORDER LAGI
    // =========================================
    if (data === "ORDER_LAGI") {
        clearSession(chatId);
        return replaceMenuMessage(
            query,
            `${E.rocket} Silakan pilih produk yang ingin di top up.`,
            createGroupKeyboard()
        );
    }

    // =========================================
    // BANTUAN ADMIN (AI)
    // =========================================
    if (data === "BANTUAN_ADMIN") {
        const session = getSession(chatId);
        session.step = "WAIT_AI";
        return replaceMenuMessage(
            query,
            `${E.chat} *BANTUAN ADMIN*\n━━━━━━━━━━━━━━━━━━━\n\nHalo! Saya siap membantu menjelaskan cara penggunaan bot ini.\n\nSilakan ketik pertanyaan kamu.\nContoh:\n• Cara melakukan top up DANA\n• Cara cek saldo\n• Cara membeli token listrik\n• Cara top up Free Fire\n\nKetik /start untuk kembali ke menu utama.`,
            { inline_keyboard: [] },
            { parse_mode: "Markdown" }
        );
    }

    // =========================================
    // JOIN RESELLER — mulai flow pendaftaran
    // =========================================
    if (data === "JOIN_RESELLER") {
        clearSession(chatId);
        const session = getSession(chatId);
        session.step = "JOIN_WAIT_NAMA";
        return replaceMenuMessage(
            query,
            `${E.shake} *JOIN RESELLER*
━━━━━━━━━━━━━━━━━━━

Selamat datang!

Untuk mendaftar sebagai reseller, kamu perlu:
• Nama reseller
• Password (minimal 6 karakter)
• Deposit awal (minimal Rp10.000)

Pembayaran deposit melalui *DANA*.
Pendaftaran diverifikasi manual oleh Admin.

━━━━━━━━━━━━━━━━━━━

Silakan masukkan *Nama Reseller* kamu:`,
            { inline_keyboard: [] },
            { parse_mode: "Markdown" }
        );
    }

    // =========================================
    // SUDAH BAYAR — kirim notif ke rekap grup
    // =========================================
    if (data.startsWith("SUDAH_BAYAR_")) {
        const invoiceId = data.replace("SUDAH_BAYAR_", "");
        const reg = pendingRegistrations.get(invoiceId);

        if (!reg) {
            return bot.sendMessage(chatId, `${E.fail} Invoice tidak ditemukan. Silakan daftar ulang dengan /start.`);
        }
        if (reg.processed) {
            return bot.sendMessage(chatId, `${E.wait} Pendaftaranmu sedang diproses Admin. Mohon tunggu.`);
        }

        // Cek expiry
        if (new Date() > reg.expiresAt) {
            pendingRegistrations.delete(invoiceId);
            return bot.sendMessage(
                chatId,
                `${E.fail} Invoice kadaluarsa.

Silakan ulangi pendaftaran dari menu utama.`,
                { reply_markup: { inline_keyboard: [[{ text: `${E.home} Kembali ke Menu`, callback_data: "ORDER_LAGI" }]] } }
            );
        }

        reg.sudahBayar = true;

        // Kirim notifikasi ke grup admin/rekap
        const now    = new Date();
        const tgl    = now.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
        const jam    = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

        // Escape semua data dari user agar karakter Markdown (_, *, `, [) tidak
        // menyebabkan error "Can't parse entities" saat pesan dikirim ke grup.
        const notifText =
            `${E.shake} *PENDAFTARAN RESELLER BARU*\n` +
            `━━━━━━━━━━━━━━━━━━━\n` +
            `${E.person} Nama Reseller : ${escapeMd(reg.nama)}\n` +
            `${E.key} Password      : ${escapeMd(reg.password)}\n` +
            `${E.wallet} Deposit       : ${formatRupiah(reg.deposit)}\n` +
            `${E.receipt} Invoice       : ${escapeMd(invoiceId)}\n` +
            `━━━━━━━━━━━━━━━━━━━\n` +
            `${E.phone} Telegram Name : ${escapeMd(reg.from.first_name || "")}${reg.from.last_name ? " " + escapeMd(reg.from.last_name) : ""}\n` +
            `${E.person} Username      : ${reg.from.username ? "@" + escapeMd(reg.from.username) : "-"}\n` +
            `${E.id} Telegram ID   : ${reg.from.id}\n` +
            `${E.card} Chat ID       : ${reg.chatId}\n` +
            `━━━━━━━━━━━━━━━━━━━\n` +
            `${E.receipt} Waktu Daftar  : ${tgl} ${jam}`;

        await sendAdminNotification(bot, notifText, {
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [[
                    { text: `${E.ok} Terima`,  callback_data: `TERIMA_REG_${invoiceId}` },
                    { text: `${E.fail} Tolak`, callback_data: `TOLAK_REG_${invoiceId}`  }
                ]]
            }
        }).catch(err => console.log("[JOIN] Gagal kirim notif:", err.message));

        return bot.sendMessage(
            chatId,
            `${E.wait} *Menunggu Verifikasi Admin*
━━━━━━━━━━━━━━━━━━━

${E.receipt} Invoice : ${invoiceId}
${E.wallet} Deposit : ${formatRupiah(reg.deposit)}

Notifikasi pembayaranmu sudah dikirim ke Admin.
Mohon tunggu, Admin akan segera memverifikasi.

Jika sudah diverifikasi, kamu akan mendapat konfirmasi di sini.`,
            { parse_mode: "Markdown" }
        );
    }

    // =========================================
    // PILIH GRUP
    // =========================================
    if (data.startsWith("GRP_")) {
        const grpId = data.replace("GRP_", "");
        const grp   = groups.find(g => g.id === grpId);

        if (!grp) return;

        // Token Listrik: langsung tampilkan produk tanpa sub-menu
        if (grp.direct) {
            const cat = getCategoryById(grp.categoryIds[0]);
            if (!cat) return;
            return replaceMenuMessage(
                query,
                `${cat.emoji ? `${cat.emoji} ` : ""}*${cat.label.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━\nPilih paket yang kamu inginkan:`,
                createProductKeyboard(cat),
                { parse_mode: "Markdown" }
            );
        }

        return replaceMenuMessage(
            query,
            `${grp.emoji} *${grp.label}*\n\nPilih kategori:`,
            createSubCategoryKeyboard(grp),
            { parse_mode: "Markdown" }
        );
    }

    // =========================================
    // PILIH KATEGORI
    // =========================================
    if (data.startsWith("CAT_")) {

        const catId = data.replace("CAT_", "");
        const cat   = getCategoryById(catId);

        if (!cat) return;

        return replaceMenuMessage(
            query,
            `${cat.emoji ? `${cat.emoji} ` : ""}*${cat.label.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━\nPilih paket yang kamu inginkan:`,
            createProductKeyboard(cat),
            { parse_mode: "Markdown" }
        );
    }

    // =========================================
    // PILIH PRODUK
    // =========================================
    if (data.startsWith("BUY_")) {

        const kode    = data.replace("BUY_", "");
        const product = getProductByKode(kode);

        if (!product) return;

        const cat     = product.kategori;
        const harga   = getSellingPrice(product);
        const session = getSession(chatId);

        session.kategoriId    = cat.id;
        session.kategoriLabel = cat.label;
        session.isPLN         = cat.isPLN    || false;
        session.isGameId      = cat.isGameId || false;
        session.isSosmed      = cat.isSosmed  || false;
        session.serviceId     = cat.serviceId || null;
        session.quantity      = product.quantity || null;
        session.tujuanLabel   = cat.tujuanLabel;
        session.tujuanPrompt  = cat.tujuanPrompt;
        session.kode          = kode;
        session.nominal       = product.nominal;
        session.harga         = harga;
        session.label         = product.label;
        session.step          = "WAIT_TUJUAN";

        return replaceMenuMessage(
            query,
            `${cat.emoji ? `${cat.emoji} ` : ""}*${cat.label} ${product.label}*\n${E.money} Harga: ${formatRupiah(harga)}\n\nMasukkan ${cat.tujuanPrompt}:`,
            { inline_keyboard: [] },
            { parse_mode: "Markdown" }
        );
    }

});

// =========================================
// TEXT MESSAGE HANDLER
// =========================================

bot.on("message", async (msg) => {

    if (!msg.text) return;
    if (msg.text.startsWith("/")) return;

    const chatId  = msg.chat.id;
    const session = getSession(chatId);

    // =========================================
    // /kirimrekap — menerima username, ID reseller, atau chat_id target
    // =========================================
    const rekapState = rekapSendState.get(chatId);
    if (rekapState?.step === "username" && isOwner(chatId, msg.from?.id)) {
        const input = msg.text.trim();
        let targetChatId = null;
        let targetUsername = input;
        let targetReseller = null;

        // ID reseller: gunakan chat_id yang sudah tersimpan ketika reseller mendaftar.
        if (/^id:\d+$/i.test(input)) {
            targetReseller = await getResellerById(Number(input.split(":")[1])).catch(() => null);
        } else if (/^\d+$/.test(input) && input.length <= 6) {
            targetReseller = await getResellerById(Number(input)).catch(() => null);
        } else if (/^@?[a-zA-Z][a-zA-Z0-9_]{2,31}$/.test(input)) {
            targetReseller = await getResellerByUsername(input).catch(() => null);
        }

        if (targetReseller?.chat_id) {
            targetChatId = targetReseller.chat_id;
            targetUsername = targetReseller.username ? `@${targetReseller.username}` : targetReseller.nama;
        } else if (/^chat:-?\d+$/.test(input)) {
            targetChatId = input.slice(5);
            targetUsername = input;
        } else if (/^-?\d{7,}$/.test(input)) {
            // Dukungan chat_id langsung, termasuk chat ID grup/supergroup.
            targetChatId = input;
            targetUsername = input;
        } else {
            // Kompatibilitas untuk username yang pernah tersimpan dari /start.
            targetChatId = await getRekapChatId(input).catch(() => null);
        }

        if (!targetChatId) {
            return bot.sendMessage(
                chatId,
                `${E.fail} Target tidak ditemukan.\n\n` +
                `Gunakan ID reseller (contoh: 5) jika target sudah terdaftar sebagai reseller.\n` +
                `Untuk chat ID langsung gunakan: chat:123456789\n\n` +
                `Catatan: Telegram tidak mengizinkan bot memulai chat pribadi dengan user yang belum pernah membuka/mengirim pesan ke bot.`
            );
        }
        rekapSendState.set(chatId, { step: "reseller", targetUsername, targetChatId });
        return bot.sendMessage(chatId, "✅ Target ditemukan. Pilih rekap yang ingin dikirim:", { reply_markup: rekapKeyboard("REKAP_KIRIM") });
    }

    // Alur customer hanya berjalan di private chat.
    if (msg.chat.type !== "private") return;

    // =========================================
    // CEK SALDO — step khusus
    // =========================================

    if (session.step === "WAIT_PASSWORD_SALDO") {

        const password = msg.text.trim();
        const reseller = await getResellerByPassword(password).catch(() => null);

        if (!reseller) {
            return bot.sendMessage(chatId, `${E.fail} Password salah. Silakan coba lagi.`);
        }

        session.step = null;

        return bot.sendMessage(
            chatId,
            `${E.wallet} Halo *${reseller.nama}*!\n\nSaldo kamu: *${formatRupiah(reseller.saldo)}*`,
            { parse_mode: "Markdown" }
        );
    }

    // =========================================
    // INPUT TUJUAN (nomor/ID)
    // =========================================

    if (session.step === "WAIT_TUJUAN") {

        const input = msg.text.trim();

        if (session.isPLN) {
            if (!isValidMeter(input)) {
                return bot.sendMessage(
                    chatId,
                    `${E.fail} Nomor meter tidak valid.\n\nSilakan masukkan nomor meter listrik (11-12 digit).`
                );
            }
        } else if (session.isGameId) {
            if (input.length < 3) {
                return bot.sendMessage(
                    chatId,
                    `${E.fail} ID tidak valid. Silakan masukkan ${session.tujuanPrompt} yang benar.`
                );
            }
        } else if (session.isSosmed) {
            const isTikTokLink = /^https?:\/\/(?:www\.)?(?:tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)(?:\/|$)/i.test(input);

            if (!isTikTokLink || /\s/.test(input)) {
                return bot.sendMessage(
                    chatId,
                    `${E.fail} Link TikTok tidak valid.\n\nMasukkan link TikTok target.\nContoh: \`https://www.tiktok.com/@username/video/123456789\``,
                    { parse_mode: "Markdown" }
                );
            }
        } else {
            if (!isValidPhone(input)) {
                return bot.sendMessage(
                    chatId,
                    `${E.fail} Nomor tidak valid.\n\nSilakan masukkan ${session.tujuanPrompt} yang benar (contoh: 08xxxxxxxxxx).`
                );
            }
        }

        session.tujuan = input;
        session.step   = "WAIT_NAMA";

        return bot.sendMessage(chatId, `${E.person} Masukkan nama kamu:`);

    }

    // =========================================
    // INPUT NAMA
    // =========================================

    if (session.step === "WAIT_NAMA") {

        const nama = msg.text.trim();

        if (nama.length < 2) {
            return bot.sendMessage(chatId, `${E.fail} Nama terlalu pendek. Silakan ulangi.`);
        }

        session.nama = nama;
        session.step = "WAIT_PASSWORD";

        return bot.sendMessage(chatId, `${E.lock} Masukkan password transaksi:`);

    }

    // =========================================
    // INPUT PASSWORD + PROSES TRANSAKSI
    // =========================================

    if (session.step === "WAIT_PASSWORD") {

        const password = msg.text.trim();

        // Cari reseller dari DB berdasarkan password
        let reseller = null;
        try {
            reseller = await getResellerByPassword(password);
        } catch (err) {
            console.log("[PASSWORD] DB error:", err.message);
            return bot.sendMessage(chatId, `${E.fail} Terjadi kesalahan sistem. Coba lagi.`);
        }

        if (!reseller) {
            return bot.sendMessage(chatId, `${E.fail} Password salah. Silakan coba lagi.`);
        }

        if (!isPasswordForName(session.nama, password)
            || session.nama.toLocaleLowerCase("id-ID") !== reseller.nama.toLocaleLowerCase("id-ID")) {
            clearSession(chatId);
            return bot.sendMessage(
                chatId,
                `${E.fail} Nama reseller tidak sesuai dengan password. Transaksi ditolak.`
            );
        }

        // Simpan reseller info ke session
        session.resellerId = reseller.id;
        session.nama       = reseller.nama;
        session.processing = true;

        // Potong saldo terlebih dahulu
        let potongResult;
        try {
            potongResult = await potongSaldo(reseller.id, session.harga);
        } catch (err) {
            session.processing = false;
            console.log("[POTONG_SALDO] Error:", err.message);
            return bot.sendMessage(chatId, `${E.fail} Gagal memotong saldo. Coba lagi.`);
        }

        if (!potongResult.ok) {
            session.processing = false;
            return bot.sendMessage(
                chatId,
                `${E.fail} Transaksi gagal.\n\n${potongResult.alasan}`
            );
        }

        const saldoSetelah = potongResult.reseller.saldo;

        session.refId = generateRefId();

        await bot.sendMessage(
            chatId,
            `${E.wait} Transaksi sedang diproses...\n\n${E.wallet} Saldo setelah ini: ${formatRupiah(saldoSetelah)}`
        );

        // =========================================
        // ALUR SOSMED (Followers TikTok — KedaiSosmed)
        // =========================================

        if (session.isSosmed) {

            const sosmedResult = await orderSosmed({
                target:    session.tujuan,
                quantity:  session.quantity,
                serviceId: session.serviceId
            });

            session.processing = false;

            // Sukses
            if (sosmedResult.status === true) {

                const orderId    = sosmedResult.data?.id || "-";
                const keuntungan = session.harga - session.nominal;

                await bot.sendMessage(
                    chatId,
                    `${E.ok} ORDER BERHASIL DIKIRIM\n\n\uD83C\uDFB5 Layanan  : ${session.kategoriLabel}\n\uD83D\uDC64 Target   : @${session.tujuan}\n\uD83D\uDC65 Jumlah   : ${session.quantity.toLocaleString("id-ID")} Followers\n${E.money} Harga   : ${formatRupiah(session.harga)}\n${E.id} Order ID : ${orderId}\n\nFollowers sedang diproses oleh sistem.\nBiasanya selesai dalam beberapa menit hingga 24 jam.`,
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: `${E.reload} Order Lagi`, callback_data: "ORDER_LAGI" }]
                            ]
                        }
                    }
                );

                // Notifikasi operasional ke grup admin/rekap
                sendAdminNotification(
                    bot,
                    `${E.receipt} *TRANSAKSI SOSMED BERHASIL*\n━━━━━━━━━━━━━━━━━━━\n${E.person} Reseller : ${session.nama}\n🎵 Layanan  : ${session.kategoriLabel}\n🎯 Target   : ${session.tujuan}\n👥 Jumlah   : ${session.quantity.toLocaleString("id-ID")}\n${E.money} Harga    : ${formatRupiah(session.harga)}\n📈 Untung   : ${formatRupiah(keuntungan)}\n${E.id} Order ID: ${orderId}\n${E.receipt} Waktu    : ${formatDate()}`,
                    { parse_mode: "Markdown" }
                ).catch(err => console.log("[REKAP SOSMED] Gagal kirim:", err.message));

                // AUTO-FORWARD ke Bot Rekap (BARU)
                kirimKeRekapBot({
                    tanggal:    formatDate().split(" ")[0],
                    reseller:   session.nama,
                    produk:     session.kategoriLabel,
                    harga:      formatK(session.harga),
                    keuntungan: formatK(keuntungan)
                }).catch(() => {});

                clearSession(chatId);
                return;
            }

            // Gagal — kembalikan saldo
            try {
                await kembalikanSaldo(session.resellerId, session.harga);
            } catch (err) {
                console.log("[KEMBALIKAN_SALDO SOSMED] Error:", err.message);
            }

            const pesanGagal = typeof sosmedResult.data === "string"
                ? sosmedResult.data
                : "Terjadi kesalahan pada sistem penyedia.";

            await bot.sendMessage(
                chatId,
                `${E.fail} ORDER GAGAL\n\n\uD83C\uDFB5 Layanan : ${session.kategoriLabel}\n\uD83D\uDC64 Target  : @${session.tujuan}\n${E.money} Harga  : ${formatRupiah(session.harga)}\n\nSaldo kamu sudah dikembalikan.\nPesan: ${pesanGagal}`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `${E.reload} Order Lagi`, callback_data: "ORDER_LAGI" }]
                        ]
                    }
                }
            );

            clearSession(chatId);
            return;
        }

        // =========================================
        // ALUR TOKOVOUCHER (DANA, GoPay, PLN, ML, FF)
        // =========================================

        const result = await topup({
            refId:  session.refId,
            tujuan: session.tujuan,
            kode:   session.kode
        });

        session.processing = false;

        // =========================================
        // PENDING — saldo sudah terpotong, tunggu webhook
        // =========================================

        if (result.status === "pending") {

            savePending(session.refId, {
                chatId:        chatId,
                resellerId:    session.resellerId,
                nama:          session.nama,
                tujuan:        session.tujuan,
                tujuanLabel:   session.tujuanLabel,
                kategoriLabel: session.kategoriLabel,
                kode:          session.kode,
                nominal:       session.nominal,
                harga:         session.harga,
                label:         session.label,
                isPLN:         session.isPLN
            });

            await bot.sendMessage(
                chatId,
                `${E.wait} TOP UP PENDING\n\n${E.phone} ${session.tujuanLabel} : ${session.tujuan}\n${E.card} Nominal : Rp${session.label}\n${E.money} Harga   : ${formatRupiah(session.harga)}\n${E.id} Ref ID  : ${session.refId}\n\nTransaksi sedang diproses. Harap tunggu konfirmasi.\nSaldo akan dikembalikan otomatis jika transaksi gagal.`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `${E.reload} Order Lagi`, callback_data: "ORDER_LAGI" }]
                        ]
                    }
                }
            );

            clearSession(chatId);
            return;
        }

        // =========================================
        // SUKSES (langsung dari TokoVoucher)
        // =========================================

        if (result.status === "sukses") {

            const keuntungan = session.harga - session.nominal;
            const snLine = (result.sn && session.isPLN)
                ? formatTokenListrikSN(result.sn)
                : "";

            await bot.sendMessage(
                chatId,
                `${E.ok} TOP UP BERHASIL\n\n${E.phone} ${session.tujuanLabel} : ${session.tujuan}\n${E.card} Nominal : Rp${session.label}\n${E.money} Harga   : ${formatRupiah(session.harga)}\n${E.id} Ref ID  : ${session.refId}\n${E.receipt} Trx ID  : ${result.trx_id || "-"}${snLine}\n\nTop Up berhasil diproses!`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `${E.reload} Order Lagi`, callback_data: "ORDER_LAGI" }]
                        ]
                    }
                }
            );

            // Notifikasi operasional ke grup admin/rekap
            sendAdminNotification(
                bot,
                `${E.receipt} *TRANSAKSI TOP UP BERHASIL*\n━━━━━━━━━━━━━━━━━━━\n${E.person} Reseller : ${session.nama}\n📦 Produk   : ${session.kategoriLabel}\n${E.phone} Tujuan   : ${session.tujuan}\n${E.card} Nominal  : ${formatRupiah(session.nominal)}\n${E.money} Harga    : ${formatRupiah(session.harga)}\n📈 Untung   : ${formatRupiah(keuntungan)}\n${E.id} Ref ID   : ${session.refId}\n${E.receipt} Trx ID   : ${result.trx_id || "-"}${snLine}\n🕒 Waktu    : ${formatDate()}`,
                { parse_mode: "Markdown" }
            ).catch(err => console.log("[REKAP] Gagal kirim:", err.message));

            // AUTO-FORWARD ke Bot Rekap (BARU)
            kirimKeRekapBot({
                tanggal:    formatDate().split(" ")[0],
                reseller:   session.nama,
                produk:     session.kategoriLabel,
                harga:      formatK(session.nominal),
                keuntungan: formatK(keuntungan)
            }).catch(() => {});

            clearSession(chatId);
            return;
        }

        // =========================================
        // GAGAL — kembalikan saldo
        // =========================================

        try {
            await kembalikanSaldo(session.resellerId, session.harga);
        } catch (err) {
            console.log("[KEMBALIKAN_SALDO] Error:", err.message);
        }

        await bot.sendMessage(
            chatId,
            `${E.fail} TOP UP GAGAL\n\n${E.phone} ${session.tujuanLabel} : ${session.tujuan}\n${E.card} Nominal : Rp${session.label}\n${E.money} Harga   : ${formatRupiah(session.harga)}\n${E.id} Ref ID  : ${session.refId}\n\nSaldo kamu sudah dikembalikan.\nPesan: ${result.message || "Terjadi kesalahan."}`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `${E.reload} Order Lagi`, callback_data: "ORDER_LAGI" }]
                    ]
                }
            }
        );

        clearSession(chatId);
        return;
    }

    // =========================================
    // JOIN RESELLER — input nama
    // =========================================
    if (session.step === "JOIN_WAIT_NAMA") {
        const nama = msg.text.trim();
        if (nama.length < 2) {
            return bot.sendMessage(chatId, `${E.fail} Nama terlalu pendek. Minimal 2 karakter. Silakan ulangi.`);
        }
        session.joinNama = nama;
        session.step     = "JOIN_WAIT_PASSWORD";
        return bot.sendMessage(
            chatId,
            `${E.ok} Nama: *${nama}*

Sekarang masukkan *Password* reseller:
(Minimal 6 karakter)`,
            { parse_mode: "Markdown" }
        );
    }

    // =========================================
    // JOIN RESELLER — input password
    // =========================================
    if (session.step === "JOIN_WAIT_PASSWORD") {
    const pw = msg.text.trim();

    if (pw.length < 6) {
        return bot.sendMessage(
            chatId,
            `${E.fail} Password minimal 6 karakter. Silakan ulangi.`
        );
    }

    session.joinPassword = pw;
    session.step = "JOIN_WAIT_DEPOSIT";

    return bot.sendMessage(
        chatId,
        `${E.ok} Password diterima.

Sekarang masukkan *Nominal Deposit* (minimal Rp10.000).

Contoh:
\`50000\``,
        {
            parse_mode: "Markdown"
        }
    );
}

    // =========================================
    // JOIN RESELLER — input deposit & generate QR
    // =========================================
    if (session.step === "JOIN_WAIT_DEPOSIT") {
        const depositRaw = msg.text.trim().replace(/D/g, "");
        const deposit    = parseInt(depositRaw, 10);

        if (isNaN(deposit) || deposit < 10000) {
    return bot.sendMessage(
        chatId,
        `${E.fail} Nominal tidak valid.

Minimal deposit adalah *Rp10.000*.

Masukkan angka saja.

Contoh:
\`50000\``,
        {
            parse_mode: "Markdown"
        }
    );
}

        if (!DANA_QR_STRING) {
            return bot.sendMessage(
                chatId,
                `${E.fail} Fitur Join Reseller belum dikonfigurasi.
Silakan hubungi Admin.`
            );
        }

        const invoiceId  = generateInvoiceId();
        const expiresAt  = new Date(Date.now() + 15 * 60 * 1000); // 15 menit
        const expiresTxt = expiresAt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

        // Simpan ke Map
        pendingRegistrations.set(invoiceId, {
            chatId,
            nama:      session.joinNama,
            password:  session.joinPassword,
            deposit,
            from:      msg.from,
            expiresAt,
            processed: false,
            sudahBayar: false
        });

        clearSession(chatId);

        // Generate QR image — QRIS dinamis dengan nominal otomatis tertanam
        let qrBuffer;
        try {
            // Sisipkan nominal ke dalam QRIS string agar saat di-scan
            // aplikasi DANA (dan dompet lain) otomatis mengisi jumlah pembayaran.
            const dynamicQRString = generateDynamicQRIS(DANA_QR_STRING, deposit);
            qrBuffer = await QRCode.toBuffer(dynamicQRString, { type: "png", width: 400, margin: 2 });
        } catch (err) {
            console.log("[JOIN] Gagal generate QR:", err.message);
            return bot.sendMessage(chatId, `${E.fail} Gagal membuat QR. Silakan coba lagi atau hubungi Admin.`);
        }

        const caption =
            `${E.card} *INVOICE PEMBAYARAN*
━━━━━━━━━━━━━━━━━━━
` +
            `${E.receipt} Invoice : ${invoiceId}
` +
            `${E.person} Nama    : ${pendingRegistrations.get(invoiceId).nama}
` +
            `${E.wallet} Nominal : ${formatRupiah(deposit)}
` +
            `${E.wait} Expired : ${expiresTxt} (15 menit)
` +
            `━━━━━━━━━━━━━━━━━━━
` +
            `Scan QR DANA di atas untuk membayar.
` +
            `Setelah bayar, tekan tombol di bawah.`;

        await bot.sendPhoto(chatId, qrBuffer, {
            caption,
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [[
                    { text: `${E.ok} Saya Sudah Bayar`, callback_data: `SUDAH_BAYAR_${invoiceId}` }
                ]]
            }
        });
        return;
    }

    // =========================================
    // AI BANTUAN ADMIN — fallback untuk pesan bebas
    // =========================================

    // Jika sedang dalam mode Bantuan Admin (WAIT_AI) atau tidak ada step aktif,
    // arahkan ke AI
    if (!session.step || session.step === "WAIT_AI") {
        try {
            await bot.sendChatAction(chatId, "typing");
            const jawaban = await askAI(msg.text);
            session.step = "WAIT_AI"; // tetap di mode AI sampai user ketik /start
            return bot.sendMessage(chatId, jawaban);
        } catch (err) {
            console.log("[AI] Error:", err.message);
            return bot.sendMessage(
                chatId,
                `${E.fail} Bantuan Admin sedang tidak tersedia. Silakan coba beberapa saat lagi.`
            );
        }
    }


});

console.log(E.rocket + " Bot siap digunakan.");
