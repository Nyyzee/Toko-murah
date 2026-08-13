// =========================================
// WEBHOOK PROVIDER
// Mengubah status transaksi browser yang masih processing.
// Tidak mengirim order ke Telegram.
// =========================================

const md5 = require("md5");
const {
    MEMBER_CODE,
    SECRET_KEY
} = require("./config");
const { finishWebTransaction } = require("./db");

function validSignature(body) {
    if (!body?.ref_id || !body?.signature || !MEMBER_CODE || !SECRET_KEY) return false;
    const expected = md5(`${MEMBER_CODE}:${SECRET_KEY}:${body.ref_id}`);
    return expected === String(body.signature);
}

function providerStatus(body) {
    const text = String(body?.status || body?.data?.status || "").toLowerCase();
    if (["sukses", "success", "berhasil", "selesai", "1"].includes(text)) return "success";
    if (["gagal", "failed", "error", "0"].includes(text)) return "failed";
    return "processing";
}

function registerWebhookRoutes(app) {
    app.post("/webhook", async (req, res) => {
        try {
            if (!validSignature(req.body)) {
                return res.status(401).json({ error: "Signature webhook tidak valid." });
            }
            const status = providerStatus(req.body);
            if (status === "processing") return res.json({ ok: true, ignored: true });
            const updated = await finishWebTransaction(
                req.body.ref_id,
                status,
                req.body.sn || req.body.provider_ref || req.body.ref_id,
                req.body
            );
            res.json({
                ok: true,
                status: updated.status,
                ref_id: updated.request_ref
            });
        } catch (error) {
            console.error("[WEBHOOK]", error.message);
            res.status(400).json({ error: error.message });
        }
    });
}

module.exports = {
    registerWebhookRoutes,
    validSignature
};
