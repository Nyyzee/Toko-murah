// =========================================
// WEBHOOK STATUS TRANSAKSI TOKOVOUCHER
// =========================================

const crypto = require("crypto");
const md5 = require("md5");
const { MEMBER_CODE, SECRET_KEY } = require("./config");
const { finishWebTransaction } = require("./db");

function sameSignature(actual, expected) {
    const a = Buffer.from(String(actual || ""));
    const b = Buffer.from(String(expected || ""));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizeStatus(value) {
    const status = String(value || "").toLowerCase();
    if (["sukses", "success", "berhasil", "selesai", "1"].includes(status)) return "success";
    if (["gagal", "failed", "fail", "error", "0"].includes(status)) return "failed";
    return "processing";
}

function registerWebhookRoutes(app) {
    const handler = async (req, res) => {
        const payload = {
            ...(req.query || {}),
            ...(req.body && typeof req.body === "object" ? req.body : {})
        };
        const refId = String(payload.ref_id || payload.refId || "").trim();
        if (!refId) return res.status(400).json({ ok: false, error: "ref_id wajib diisi." });

        const expected = md5(`${MEMBER_CODE}:${SECRET_KEY}:${refId}`);
        const provided = req.get("X-TokoVoucher-Authorization") || payload.signature;
        if (!sameSignature(provided, expected)) {
            console.warn(`[WEBHOOK] Signature tidak valid untuk ref_id ${refId}.`);
            return res.status(401).json({ ok: false, error: "Signature webhook tidak valid." });
        }

        try {
            const status = normalizeStatus(payload.status);
            if (status === "processing") {
                console.log(`[WEBHOOK] ${refId} masih pending.`);
                return res.status(200).json({ ok: true, status: "processing" });
            }

            const result = await finishWebTransaction(
                refId,
                status,
                payload.trx_id || payload.transaction_id || null,
                payload
            );
            console.log(`[WEBHOOK] ${refId} diperbarui menjadi ${result.status}.`);
            return res.status(200).json({ ok: true, status: result.status });
        } catch (error) {
            console.error(`[WEBHOOK] Gagal memproses ${refId}:`, error.message);
            return res.status(500).json({ ok: false, error: "Webhook belum dapat diproses." });
        }
    };

    app.post("/webhook", handler);
    app.get("/webhook", handler);
}

module.exports = { registerWebhookRoutes };