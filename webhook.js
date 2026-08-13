// =========================================
// WEBHOOK SERVER
// Terima callback dari TokoVoucher
// =========================================

const express = require("express");
const md5     = require("md5");

const { getPending, deletePending }              = require("./pending");
const {
    formatRupiah,
    formatDate,
    formatK,
    formatTokenListrikSN
} = require("./utils");
const { kembalikanSaldo }                        = require("./db");
const { MEMBER_CODE, SECRET_KEY } = require("./config");
const { sendAdminNotification } = require("./notifications");
const { kirimKeRekapBot }                        = require("./rekap-client");
const { registerDashboardRoutes }                = require("./dashboard");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const E = {
    ok:      "\u2705",         // ✅
    fail:    "\u274C",         // ❌
    person:  "\uD83D\uDC64",   // 👤
    box:     "\uD83D\uDCE6",   // 📦
    phone:   "\uD83D\uDCF1",   // 📱
    card:    "\uD83D\uDCB3",   // 💳
    money:   "\uD83D\uDCB0",   // 💰
    chart:   "\uD83D\uDCC8",   // 📈
    id:      "\uD83C\uDD94",   // 🆔
    receipt: "\uD83E\uDDFE",   // 🧾
    clock:   "\uD83D\uDD52",   // 🕒
    reload:  "\uD83D\uDD04",   // 🔄
    key:     "\uD83D\uDD11",   // 🔑
};

function isValidHeader(req, refId) {
    const received = req.headers["x-tokovoucher-authorization"];
    if (!received) return false;
    const expected = md5(`${MEMBER_CODE}:${SECRET_KEY}:${refId}`);
    return received === expected;
}

async function handleWebhook(bot, req, res) {
    const data   = { ...req.body, ...req.query };
    const refId  = data.ref_id;
    const status = data.status;

    console.log("[WEBHOOK] Received:", JSON.stringify(data));

    res.sendStatus(200);

    if (!refId || !status) {
        console.log("[WEBHOOK] Data tidak lengkap.");
        return;
    }

    const trx = getPending(refId);

    if (!trx) {
        console.log("[WEBHOOK] Transaksi tidak ditemukan untuk ref_id:", refId);
        return;
    }

    if (status === "sukses") {
        deletePending(refId);

        const snLine = (data.sn && trx.isPLN)
            ? formatTokenListrikSN(data.sn)
            : "";

        if (trx.chatId) {
            bot.sendMessage(
                trx.chatId,
                `${E.ok} TOP UP BERHASIL\n\n${E.phone} ${trx.tujuanLabel} : ${trx.tujuan}\n${E.card} Nominal  : Rp${trx.label}\n${E.money} Harga    : ${formatRupiah(trx.harga)}\n${E.id} Ref ID   : ${refId}\n${E.receipt} Trx ID   : ${data.trx_id || "-"}${snLine}\n\nTop Up berhasil diproses!`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `${E.reload} Order Lagi`, callback_data: "ORDER_LAGI" }]
                        ]
                    }
                }
            ).catch(err => console.log("[WEBHOOK] Gagal kirim notif sukses:", err.message));
        }

        const keuntungan = trx.harga - trx.nominal;
        sendAdminNotification(
            bot,
            `${E.receipt} *TRANSAKSI TOP UP BERHASIL*\n━━━━━━━━━━━━━━━━━━━\n${E.person} Reseller : ${trx.nama}\n${E.box} Produk   : ${trx.kategoriLabel}\n${E.phone} Tujuan   : ${trx.tujuan}\n${E.card} Nominal  : ${formatRupiah(trx.nominal)}\n${E.money} Harga    : ${formatRupiah(trx.harga)}\n${E.chart} Untung   : ${formatRupiah(keuntungan)}\n${E.id} Ref ID   : ${refId}\n${E.receipt} Trx ID   : ${data.trx_id || "-"}${snLine}\n${E.clock} Waktu    : ${formatDate()}`,
            { parse_mode: "Markdown" }
        ).catch(err => console.log("[WEBHOOK] Gagal kirim rekap:", err.message));

        const tanggalSaja = formatDate().split(" ")[0]; // "DD/MM/YYYY"
        kirimKeRekapBot({
            tanggal:    tanggalSaja,
            reseller:   trx.nama,
            produk:     trx.kategoriLabel,
            harga:      formatK(trx.nominal),
            keuntungan: formatK(keuntungan)
        }).catch(() => {});

        console.log("[WEBHOOK] Transaksi sukses untuk ref_id:", refId);
        return;
    }

    if (status === "gagal") {
        deletePending(refId);

        if (trx.resellerId && trx.harga) {
            try {
                await kembalikanSaldo(trx.resellerId, trx.harga);
                console.log(`[WEBHOOK] Saldo dikembalikan ke reseller ${trx.resellerId}: ${trx.harga}`);
            } catch (err) {
                console.log("[WEBHOOK] Gagal kembalikan saldo:", err.message);
            }
        }

        const tujuanLabel = trx.tujuanLabel || "Nomor";

        if (trx.chatId) {
            bot.sendMessage(
                trx.chatId,
                `${E.fail} TOP UP GAGAL\n\n${E.phone} ${tujuanLabel} : ${trx.tujuan}\n${E.card} Nominal : Rp${trx.label}\n${E.money} Harga   : ${formatRupiah(trx.harga)}\n${E.id} Ref ID  : ${refId}\n\nSaldo kamu telah dikembalikan.\nPesan: ${data.message || "Transaksi gagal."}`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `${E.reload} Order Lagi`, callback_data: "ORDER_LAGI" }]
                        ]
                    }
                }
            ).catch(err => console.log("[WEBHOOK] Gagal kirim notif gagal:", err.message));
        }

        console.log("[WEBHOOK] Transaksi gagal untuk ref_id:", refId);
    }
}

function startWebhookServer(bot) {
    app.post("/webhook", (req, res) => handleWebhook(bot, req, res));
    app.get("/webhook",  (req, res) => handleWebhook(bot, req, res));
    app.get("/",         (req, res) => res.send("Bot aktif."));
    registerDashboardRoutes(app);

    app.listen(PORT, () => {
        console.log("[SERVER] Webhook server berjalan di port " + PORT);
    });
}

module.exports = { startWebhookServer };
