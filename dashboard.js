const express = require("express");
const http = require("http");
const crypto = require("crypto");
const QRCode = require("qrcode");
const path = require("path");

const {
    PORT,
    SESSION_SECRET,
    DASHBOARD_KEY,
    DANA_QR_STRING,
    REKAP_GROUP_ID,
    OWNER_CHAT_ID
} = require("./config");
const {
    authenticateCustomer,
    createCustomer,
    getCustomerById,
    getAllCustomers,
    createDepositRequest,
    getCustomerDeposits,
    getAdminDeposits,
    decideDeposit,
    createWebTransaction,
    finishWebTransaction,
    getCustomerTransactions,
    getAdminTransactions,
    getCatalogProducts,
    getCatalogProductByCode,
    replaceCatalogProducts,
    getAdminSummary
} = require("./db");
const {
    normalizeProduct,
    getSellingPrice,
    getCatalogGroups,
    applyDatabaseCatalog
} = require("./products");
const { fetchCatalogProducts, topup } = require("./tokovoucher");
const { generateDynamicQRIS } = require("./qris");
const { registerWebhookRoutes } = require("./webhook");

const dashboardHtml = require("fs").readFileSync(
    path.join(__dirname, "dashboard.html"),
    "utf8"
);

function parseCookies(req) {
    const raw = req.headers.cookie || "";
    return Object.fromEntries(raw.split(";").filter(Boolean).map(part => {
        const index = part.indexOf("=");
        return [
            part.slice(0, index).trim(),
            decodeURIComponent(part.slice(index + 1).trim())
        ];
    }));
}

function sign(value) {
    return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function issueSession(res, payload) {
    const body = Buffer.from(JSON.stringify({
        ...payload,
        exp: Date.now() + 1000 * 60 * 60 * 24 * 7
    })).toString("base64url");
    const token = `${body}.${sign(body)}`;
    res.setHeader(
        "Set-Cookie",
        `web_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`
    );
}

function clearSession(res) {
    res.setHeader("Set-Cookie", "web_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

function readSession(req) {
    const token = parseCookies(req).web_session;
    if (!token) return null;
    const [body, signature] = token.split(".");
    const expected = body ? sign(body) : "";
    if (!body || !signature ||
        signature.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
        return payload.exp > Date.now() ? payload : null;
    } catch {
        return null;
    }
}

function requireCustomer(req, res, next) {
    const session = readSession(req);
    if (!session || session.role !== "customer" || !session.id) {
        return res.status(401).json({ error: "Silakan login sebagai customer." });
    }
    req.customerSession = session;
    next();
}

function requireAdmin(req, res, next) {
    const session = readSession(req);
    if (!session || session.role !== "admin") {
        return res.status(401).json({ error: "Silakan login sebagai admin." });
    }
    req.adminSession = session;
    next();
}

function sendError(res, error) {
    const message = error?.message || "Terjadi kesalahan server.";
    const status = /tidak cukup|tidak ditemukan|harus|invalid|belum diisi|minimal/i.test(message)
        ? 400
        : 500;
    res.status(status).json({ error: message });
}

function publicCatalog(rows) {
    const products = rows.map(normalizeProduct);
    return {
        groups: getCatalogGroups(products),
        products: products.map(product => ({
            id: product.id,
            kode: product.kode,
            label: product.label,
            nominal: product.nominal,
            hargaJual: product.hargaJualEfektif,
            groupId: product.groupId,
            groupLabel: product.groupLabel,
            kategoriId: product.kategoriId,
            kategoriLabel: product.kategoriLabel,
            operator: product.operator,
            jenisProduk: product.jenisProduk
        }))
    };
}

function providerResultStatus(response) {
    const status = String(response?.status || response?.data?.status || "").toLowerCase();
    if (["sukses", "success", "berhasil", "selesai", "1"].includes(status)) return "success";
    if (["gagal", "failed", "error", "0"].includes(status)) return "failed";
    return "processing";
}

function amountValue(value) {
    const amount = Number(String(value).replace(/[^\d]/g, ""));
    if (!Number.isSafeInteger(amount)) return null;
    return amount;
}

async function notifyDeposit(bot, deposit, customer) {
    if (!bot) return;
    const target = REKAP_GROUP_ID || OWNER_CHAT_ID;
    if (!target) return;
    const text = [
        "DEPOSIT BARU",
        `Username: ${customer.username}`,
        `Nominal: Rp${Number(deposit.amount).toLocaleString("id-ID")}`,
        `Referensi: ${deposit.request_ref}`,
        "Pilih tindakan:"
    ].join("\n");
    try {
        await bot.sendMessage(target, text, {
            reply_markup: {
                inline_keyboard: [[
                    { text: "Setujui", callback_data: `DEPOSIT_APPROVE_${deposit.id}` },
                    { text: "Tolak", callback_data: `DEPOSIT_REJECT_${deposit.id}` }
                ]]
            }
        });
    } catch (error) {
        console.error("[DEPOSIT NOTIFICATION]", error.message);
    }
}

function registerDashboardRoutes(app, bot) {
    app.get(["/", "/dashboard", "/dashboard/"], (req, res) => {
        res.type("html").send(dashboardHtml);
    });

    app.get("/api/health", (req, res) => res.json({ ok: true }));

    app.post("/api/auth/register", async (req, res) => {
        try {
            const customer = await createCustomer(req.body?.username, req.body?.password);
            issueSession(res, { role: "customer", id: customer.id, username: customer.username });
            res.status(201).json({ customer });
        } catch (error) {
            if (error.code === "23505") return res.status(409).json({ error: "Username sudah digunakan." });
            sendError(res, error);
        }
    });

    app.post("/api/auth/login", async (req, res) => {
        try {
            const customer = await authenticateCustomer(req.body?.username, req.body?.password);
            if (!customer) return res.status(401).json({ error: "Username atau password salah." });
            issueSession(res, { role: "customer", id: customer.id, username: customer.username });
            res.json({ customer });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.post("/api/auth/logout", (req, res) => {
        clearSession(res);
        res.json({ ok: true });
    });

    app.get("/api/auth/me", async (req, res) => {
        const session = readSession(req);
        if (!session) return res.json({ authenticated: false });
        if (session.role === "admin") return res.json({ authenticated: true, role: "admin" });
        const customer = await getCustomerById(session.id);
        if (!customer) return res.json({ authenticated: false });
        res.json({ authenticated: true, role: "customer", customer });
    });

    app.get("/api/catalog", async (req, res) => {
        try {
            const rows = await getCatalogProducts(false);
            applyDatabaseCatalog(rows);
            res.json(publicCatalog(rows));
        } catch (error) {
            sendError(res, error);
        }
    });

    app.get("/api/customer/deposits", requireCustomer, async (req, res) => {
        try {
            res.json({ deposits: await getCustomerDeposits(req.customerSession.id) });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.post("/api/customer/deposits", requireCustomer, async (req, res) => {
        try {
            const amount = amountValue(req.body?.amount);
            if (!amount || amount < 10000) {
                throw new Error("Minimal deposit adalah Rp10.000.");
            }
            const requestRef = `DEP-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
            const deposit = await createDepositRequest(req.customerSession.id, amount, requestRef);
            const qris = generateDynamicQRIS(DANA_QR_STRING, amount);
            const qrDataUrl = await QRCode.toDataURL(qris, { width: 360, margin: 2 });
            const customer = await getCustomerById(req.customerSession.id);
            await notifyDeposit(bot, deposit, customer);
            res.status(201).json({
                deposit: {
                    id: Number(deposit.id),
                    amount,
                    requestRef,
                    status: deposit.status,
                    qrDataUrl
                }
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.get("/api/customer/transactions", requireCustomer, async (req, res) => {
        try {
            res.json({ transactions: await getCustomerTransactions(req.customerSession.id) });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.post("/api/customer/orders", requireCustomer, async (req, res) => {
        let order;
        try {
            const code = String(req.body?.kode || "").trim();
            const targetData = req.body?.targetData;
            if (!code || !targetData || typeof targetData !== "object") {
                throw new Error("Produk dan data tujuan wajib diisi.");
            }
            const targetText = Object.values(targetData).join(" ").trim();
            if (!targetText || targetText.length > 300) {
                throw new Error("Data tujuan tidak valid.");
            }
            const rawProduct = await getCatalogProductByCode(code);
            if (!rawProduct) throw new Error("Produk tidak tersedia.");
            const product = normalizeProduct(rawProduct);
            const requestRef = `WEB-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
            order = await createWebTransaction({
                customerId: req.customerSession.id,
                requestRef,
                productCode: product.kode,
                productLabel: product.label,
                kategoriId: product.kategoriId,
                kategoriLabel: product.kategoriLabel,
                operator: product.operator,
                jenisProduk: product.jenisProduk,
                targetData,
                amount: getSellingPrice(product)
            });

            const response = await topup({
                refId: requestRef,
                tujuan: targetText,
                kode: product.kode
            });
            const status = providerResultStatus(response);
            if (status !== "processing") {
                await finishWebTransaction(
                    requestRef,
                    status,
                    response?.ref_id || response?.data?.ref_id || null,
                    response
                );
            }
            const transactions = await getCustomerTransactions(req.customerSession.id);
            const current = transactions.find(item => item.requestRef === requestRef);
            const customer = await getCustomerById(req.customerSession.id);
            res.status(201).json({ transaction: current, customer });
        } catch (error) {
            if (order && order.request_ref) {
                await finishWebTransaction(order.request_ref, "failed", null, {
                    error: error.message
                }).catch(() => {});
            }
            sendError(res, error);
        }
    });

    app.post("/api/admin/login", (req, res) => {
        if (!DASHBOARD_KEY || req.body?.key !== DASHBOARD_KEY) {
            return res.status(401).json({ error: "Kunci admin salah." });
        }
        issueSession(res, { role: "admin" });
        res.json({ ok: true });
    });

    app.get("/api/admin/summary", requireAdmin, async (req, res) => {
        try {
            res.json(await getAdminSummary());
        } catch (error) {
            sendError(res, error);
        }
    });

    app.get("/api/admin/customers", requireAdmin, async (req, res) => {
        try {
            res.json({ customers: await getAllCustomers() });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.get("/api/admin/deposits", requireAdmin, async (req, res) => {
        try {
            res.json({ deposits: await getAdminDeposits() });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.post("/api/admin/deposits/:id/decision", requireAdmin, async (req, res) => {
        try {
            const result = await decideDeposit(
                Number(req.params.id),
                req.body?.status,
                req.body?.note
            );
            res.json({
                deposit: {
                    id: Number(result.id),
                    amount: Number(result.amount),
                    status: result.status,
                    username: result.username,
                    saldo: result.saldo
                }
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.get("/api/admin/transactions", requireAdmin, async (req, res) => {
        try {
            res.json({ transactions: await getAdminTransactions() });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.post("/api/admin/products/sync", requireAdmin, async (req, res) => {
        try {
            const products = await fetchCatalogProducts();
            const result = await replaceCatalogProducts(products);
            res.json({ ...result, products: products.length });
        } catch (error) {
            sendError(res, error);
        }
    });

    registerWebhookRoutes(app, bot);
}

function startWebApp(bot) {
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "1mb" }));
    app.use(express.urlencoded({ extended: false }));
    registerDashboardRoutes(app, bot);
    const server = http.createServer(app);
    server.listen(PORT, "0.0.0.0", () => {
        console.log(`[WEB] Browser app berjalan di port ${PORT}.`);
    });
    return { app, server };
}

module.exports = {
    registerDashboardRoutes,
    startWebApp,
    readSession
};
