// =========================================
// ENTRYPOINT
// Browser menjadi satu-satunya tempat login dan order.
// Telegram hanya dipakai untuk notifikasi deposit admin.
// =========================================

const TelegramBot = require("node-telegram-bot-api");
const {
    BOT_TOKEN,
    OWNER_CHAT_ID
} = require("./config");
const {
    initDB,
    decideDeposit,
    getCustomerById
} = require("./db");
const { startWebApp } = require("./dashboard");
const { loadProductsFromDB } = require("./products");
const { fetchCatalogProducts } = require("./tokovoucher");
const { replaceCatalogProducts } = require("./db");

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

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
        await bot.sendMessage(
            query.message?.chat?.id || OWNER_CHAT_ID,
            `Deposit ${result.status === "approved" ? "DITERIMA" : "DITOLAK"}\n` +
            `Username: ${result.username}\n` +
            `Nominal: Rp${Number(result.amount).toLocaleString("id-ID")}\n` +
            (result.status === "approved"
                ? `Saldo sekarang: Rp${Number(result.saldo).toLocaleString("id-ID")}`
                : "")
        );
    } catch (error) {
        await bot.answerCallbackQuery(query.id, {
            text: error.message || "Deposit gagal diproses.",
            show_alert: true
        });
    }
}

bot.on("callback_query", query => {
    handleDepositCallback(query).catch(error =>
        console.error("[DEPOSIT CALLBACK]", error.message)
    );
});

async function syncCatalogAtStartup() {
    try {
        const products = await fetchCatalogProducts();
        const result = await replaceCatalogProducts(products);
        console.log(`[CATALOG] ${result.imported} produk tersimpan dari API.`);
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
