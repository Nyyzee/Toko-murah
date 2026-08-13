// =========================================
// ENTRYPOINT
// Browser menjadi satu-satunya tempat login dan order.
// Telegram dipakai untuk notifikasi deposit ke admin (OWNER_CHAT_ID).
// =========================================

const TelegramBot = require("node-telegram-bot-api");
const {
    BOT_TOKEN,
    OWNER_CHAT_ID
} = require("./config");
const {
    initDB,
    decideDeposit,
    getCustomerById,
    getAdminSummary,
    getAdminDeposits
} = require("./db");
const { startWebApp } = require("./dashboard");
const { loadProductsFromDB } = require("./products");
const { fetchCatalogFiltered } = require("./tokovoucher");
const { replaceCatalogProducts, getSyncConfig } = require("./db");

// Telegram dipakai untuk notifikasi deposit admin.
const bot = BOT_TOKEN ? new TelegramBot(BOT_TOKEN, { polling: true }) : null;

async function handleDepositCallback(query) {
    const data = String(query.data || "");
    const match = data.match(/^DEPOSIT_(APPROVE|REJECT)_(\d+)$/);
    if (!match) return;

    if (String(query.from?.id) !== String(OWNER_CHAT_ID)) {
        await bot.answerCallbackQuery(query.id, {
            text: "Hanya admin utama yang dapat memproses deposit.",
            show_alert: true
        });
        return;
    }

    const status = match[1] === "APPROVE" ? "approved" : "rejected";
    try {
        const result = await decideDeposit(Number(match[2]), status);
        await bot.answerCallbackQuery(query.id, {
            text: result.alreadyDecided ? "Deposit sudah diproses." : "Deposit berhasil diproses."
        });
        if (query.message) {
            await bot.editMessageReplyMarkup(
                { inline_keyboard: [] },
                { chat_id: query.message.chat.id, message_id: query.message.message_id }
            ).catch(() => {});
        }

        // Kirim konfirmasi hasil ke admin
        const chatTarget = query.message?.chat?.id || OWNER_CHAT_ID;
        await bot.sendMessage(
            chatTarget,
            `[DEPOSIT ${result.status === "approved" ? "DITERIMA" : "DITOLAK"}] ${result.status === "approved" ? "✅" : "❌"}\n` +
            `[CUSTOMER] 👤 @${result.username}\n` +
            `[NOMINAL] 💰 Rp${Number(result.amount).toLocaleString("id-ID")}\n` +
            (result.status === "approved"
                ? `[SALDO] 💳 Rp${Number(result.saldo).toLocaleString("id-ID")}`
                : "")
        );
    } catch (error) {
        await bot.answerCallbackQuery(query.id, {
            text: error.message || "Deposit gagal diproses.",
            show_alert: true
        });
    }
}

if (bot) {
    const isOwner = message => String(message?.from?.id || "") === String(OWNER_CHAT_ID);

    bot.onText(/^\/(start|help)$/i, async message => {
        if (!isOwner(message)) return bot.sendMessage(message.chat.id, "Bot aktif. Perintah admin hanya tersedia untuk admin utama.");
        await bot.sendMessage(
            message.chat.id,
            "🛒 TOKO MURAH\n\n" +
            "Perintah admin:\n" +
            "/status - ringkasan toko dan deposit pending\n" +
            "/help - melihat bantuan\n\n" +
            "Deposit baru akan muncul otomatis dengan tombol Setujui/Tolak."
        );
    });

    bot.onText(/^\/status$/i, async message => {
        if (!isOwner(message)) return bot.sendMessage(message.chat.id, "Perintah ini hanya untuk admin utama.");
        try {
            const [summary, deposits] = await Promise.all([
                getAdminSummary(),
                getAdminDeposits()
            ]);
            const pending = deposits.filter(item => item.status === "pending").length;
            await bot.sendMessage(
                message.chat.id,
                "📊 STATUS TOKO MURAH\n\n" +
                `👥 Customer: ${summary.customers}\n` +
                `📦 Produk aktif: ${summary.products}\n` +
                `🧾 Transaksi: ${summary.transactions}\n` +
                `💰 Deposit pending: ${pending}`
            );
        } catch (error) {
            await bot.sendMessage(message.chat.id, `Gagal mengambil status: ${error.message}`);
        }
    });

    bot.on("callback_query", query => {
        handleDepositCallback(query).catch(error =>
            console.error("[DEPOSIT CALLBACK]", error.message)
        );
    });
    bot.on("polling_error", error => {
        console.error("[TELEGRAM]", error.message);
    });
    console.log("[TELEGRAM] Bot aktif, notifikasi deposit akan dikirim ke admin.");
} else {
    console.warn("[TELEGRAM] BOT_TOKEN tidak diisi — notifikasi Telegram dinonaktifkan.");
}

async function syncCatalogAtStartup() {
    try {
        const syncConfig = await getSyncConfig();
        if (syncConfig.length === 0) {
            console.log("[CATALOG] Sinkronisasi otomatis dilewati: belum ada pilihan kategori/operator/jenis produk.");
            await loadProductsFromDB();
            return;
        }
        const products = await fetchCatalogFiltered(syncConfig);
        const result = await replaceCatalogProducts(products);
        console.log(`[CATALOG] ${result.imported} produk tersimpan dari API (filter: ${syncConfig.length} aturan).`);
    } catch (error) {
        console.warn(`[CATALOG] Sinkronisasi dilewati: ${error.message}`);
    }
    await loadProductsFromDB();
}

async function start() {
    await initDB();
    await syncCatalogAtStartup();
    startWebApp(bot);
    console.log("[APP] Login, deposit, dan order tersedia melalui browser.");
}

start().catch(error => {
    console.error("[APP] Gagal memulai service:", error);
    process.exitCode = 1;
});
