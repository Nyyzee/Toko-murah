const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const QRCode = require("qrcode");

const {
    DASHBOARD_KEY,
    DANA_QR_STRING,
    SESSION_SECRET,
    PORT,
    REKAP_GROUP_ID
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
    getAdminSummary,
    getCatalogProducts,
    getNextCatalogNominal,
    createCatalogProduct,
    updateCatalogProduct,
    deactivateCatalogProduct,
    bulkUpdateCatalogProducts
} = require("./db");
const {
    categories,
    getSellingPrice,
    applyDatabaseCatalog,
    getCatalogGroups,
    getProductByKode,
    loadProductsFromDB
} = require("./products");
const productStore = require("./products");
const { topup, fetchCatalogProducts } = require("./tokovoucher");
const { generateDynamicQRIS } = require("./qris");
const { generateRefId } = require("./utils");
const { registerWebhookRoutes } = require("./webhook");

const dashboardHtml = fs.readFileSync(
    path.join(__dirname, "dashboard.html"),
    "utf8"
);

function authorized(req) {
    const headerKey = req.get("x-dashboard-key");
    const bearer = req.get("authorization");
    const bearerKey = bearer && bearer.startsWith("Bearer ")
        ? bearer.slice(7)
        : "";
    return Boolean(DASHBOARD_KEY && (headerKey === DASHBOARD_KEY || bearerKey === DASHBOARD_KEY));
}

function requireDashboardKey(req, res, next) {
    if (!DASHBOARD_KEY) {
        return res.status(503).json({
            error: "DASHBOARD_KEY belum diatur di Variables service."
        });
    }
    if (!authorized(req)) {
        return res.status(401).json({ error: "Kunci dashboard tidak benar." });
    }
    next();
}

function categoryExists(id) {
    return categories.some(category => category.id === id);
}

function parseProductPayload(body, allowAutoNominal = false) {
    const label = String(body.label || "").trim();
    const kode = String(body.kode || "").trim();
    const kategoriId = String(body.kategoriId || "").trim();
    const autoNominal = allowAutoNominal && body.autoNominal === true;
    const nominal = autoNominal ? null : Number(body.nominal);
    const hargaJual = body.hargaJual === "" || body.hargaJual === null ||
        body.hargaJual === undefined
        ? null
        : Number(body.hargaJual);

    if (label.length < 2 || label.length > 200) {
        throw new Error("Nama produk harus 2 sampai 200 karakter.");
    }
    if (!/^[a-zA-Z0-9._-]{2,120}$/.test(kode)) {
        throw new Error("Kode produk hanya boleh berisi huruf, angka, titik, garis bawah, dan strip.");
    }
    if (!categoryExists(kategoriId)) {
        throw new Error("Kategori produk tidak ditemukan.");
    }
    if (!autoNominal && (!Number.isSafeInteger(nominal) || nominal < 0)) {
        throw new Error("Harga modal harus berupa angka bulat 0 atau lebih.");
    }
    if (hargaJual !== null && (!Number.isSafeInteger(hargaJual) || hargaJual < 0)) {
        throw new Error("Harga jual harus berupa angka bulat 0 atau lebih.");
    }

    return {
        label,
        kode,
        kategoriId,
        nominal,
        hargaJual,
        metadata: {},
        autoNominal,
        nominalStep: Number(body.nominalStep || 1000)
    };
}

function publicProduct(row) {
    const category = categories.find(item => item.id === row.kategori_id);
    const product = {
        label: row.label,
        kode: row.kode,
        nominal: Number(row.nominal),
        ...(row.harga_jual === null || row.harga_jual === undefined
            ? {}
            : { hargaJual: Number(row.harga_jual) }),
        kategori: category
    };
    return {
        id: row.id,
        kode: row.kode,
        label: row.label,
        kategoriId: row.kategori_id,
        kategoriLabel: category ? category.label : row.kategori_id,
        nominal: Number(row.nominal),
        hargaJual: row.harga_jual === null ? null : Number(row.harga_jual),
        hargaJualEfektif: getSellingPrice(product),
        active: row.active,
        updatedAt: row.updated_at
    };
}

async function refreshInMemoryCatalog() {
    const rows = await getCatalogProducts(false);
    applyDatabaseCatalog(rows);
}

function sendError(res, error) {
    const message = error && error.message ? error.message : "Terjadi kesalahan.";
    const duplicate = /duplicate key|unique constraint/i.test(message);
    return res.status(duplicate ? 409 : 400).json({
        error: duplicate ? "Kode produk sudah digunakan." : message
    });
}

function parseBulkPayload(body) {
    const kategoriId = String(body.kategoriId || "").trim();
    const namaContains = String(body.namaContains || "").trim();
    const nominalStart = body.nominalStart === "" || body.nominalStart === null ||
        body.nominalStart === undefined ? null : Number(body.nominalStart);
    const nominalStep = body.nominalStep === "" || body.nominalStep === null ||
        body.nominalStep === undefined ? null : Number(body.nominalStep);
    const hargaJualMode = String(body.hargaJualMode || "keep");
    const hargaJual = body.hargaJual === "" || body.hargaJual === null ||
        body.hargaJual === undefined ? null : Number(body.hargaJual);

    if (!kategoriId && !namaContains) {
        throw new Error("Pilih kategori atau isi nama produk sebagai sasaran edit massal.");
    }
    if (kategoriId && !categoryExists(kategoriId)) {
        throw new Error("Kategori produk tidak ditemukan.");
    }
    if (namaContains.length > 200) {
        throw new Error("Pencarian nama terlalu panjang.");
    }
    if (nominalStart !== null && (!Number.isSafeInteger(nominalStart) || nominalStart < 0)) {
        throw new Error("Nominal awal harus berupa angka bulat 0 atau lebih.");
    }
    if (nominalStep !== null && (!Number.isSafeInteger(nominalStep) || nominalStep < 1)) {
        throw new Error("Jarak nominal minimal 1.");
    }
    if ((nominalStart === null) !== (nominalStep === null)) {
        throw new Error("Nominal awal dan jarak nominal harus diisi bersama.");
    }
    if (!["keep", "set", "clear"].includes(hargaJualMode)) {
        throw new Error("Mode harga jual tidak valid.");
    }
    if (hargaJualMode === "set" &&
        (!Number.isSafeInteger(hargaJual) || hargaJual < 0)) {
        throw new Error("Harga jual massal harus berupa angka bulat 0 atau lebih.");
    }

    if (nominalStart === null && hargaJualMode === "keep") {
        throw new Error("Isi perubahan nominal atau harga jual terlebih dahulu.");
    }

    return {
        kategoriId,
        namaContains,
        nominalStart,
        nominalStep,
        hargaJualMode,
        hargaJual
    };
}

function registerDashboardRoutes(app) {
    app.get(["/dashboard", "/dashboard/"], (req, res) => {
        res.type("html").send(dashboardHtml);
    });

    app.get("/api/dashboard/categories", requireDashboardKey, (req, res) => {
        res.json(categories.map(category => ({
            id: category.id,
            label: category.label
        })));
    });

    app.get("/api/dashboard/products", requireDashboardKey, async (req, res) => {
        try {
            const rows = await getCatalogProducts(true);
            res.json(rows.map(publicProduct));
        } catch (error) {
            sendError(res, error);
        }
    });

    app.post("/api/dashboard/products", requireDashboardKey, async (req, res) => {
        try {
            const product = parseProductPayload(req.body || {}, true);
            if (product.autoNominal) {
                if (!Number.isSafeInteger(product.nominalStep) || product.nominalStep < 1) {
                    throw new Error("Jarak nominal minimal 1.");
                }
                product.nominal = await getNextCatalogNominal(
                    product.kategoriId,
                    product.nominalStep
                );
            }
            const created = await createCatalogProduct(product);
            await refreshInMemoryCatalog();
            res.status(201).json(publicProduct(created));
        } catch (error) {
            sendError(res, error);
        }
    });

    app.put("/api/dashboard/products/bulk", requireDashboardKey, async (req, res) => {
        try {
            const bulk = parseBulkPayload(req.body || {});
            const result = await bulkUpdateCatalogProducts(bulk);
            await refreshInMemoryCatalog();
            res.json({
                ok: true,
                updatedCount: result.updatedCount,
                message: `${result.updatedCount} produk berhasil diperbarui.`
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.put("/api/dashboard/products/:id", requireDashboardKey, async (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isSafeInteger(id) || id < 1) {
                throw new Error("ID produk tidak valid.");
            }
            const product = parseProductPayload(req.body || {});
            product.active = req.body.active !== false;
            const updated = await updateCatalogProduct(id, product);
            if (!updated) return res.status(404).json({ error: "Produk tidak ditemukan." });
            await refreshInMemoryCatalog();
            res.json(publicProduct(updated));
        } catch (error) {
            sendError(res, error);
        }
    });

    app.delete("/api/dashboard/products/:id", requireDashboardKey, async (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isSafeInteger(id) || id < 1) {
                throw new Error("ID produk tidak valid.");
            }
            const removed = await deactivateCatalogProduct(id);
            if (!removed) return res.status(404).json({ error: "Produk tidak ditemukan." });
            await refreshInMemoryCatalog();
            res.json({ ok: true });
        } catch (error) {
            sendError(res, error);
        }
    });
}

const WEB_COOKIE = "toko_session";
const WEB_SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const webSessions = new Map();

function sign(value) {
    return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function createWebSession(role, customerId = null) {
    const id = crypto.randomBytes(32).toString("hex");
    webSessions.set(id, {
        role,
        customerId: customerId ? Number(customerId) : null,
        expiresAt: Date.now() + WEB_SESSION_TTL
    });
    return `${id}.${sign(id)}`;
}

function parseCookies(header = "") {
    return Object.fromEntries(
        header.split(";").map(item => item.trim().split("="))
            .filter(item => item.length === 2)
            .map(([key, value]) => [key, decodeURIComponent(value)])
    );
}

function readWebSession(req) {
    const raw = parseCookies(req.get("cookie") || "")[WEB_COOKIE] || "";
    const [id, signature] = raw.split(".");
    const expected = id ? sign(id) : "";
    if (!id || !signature || signature.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return null;
    }
    const session = webSessions.get(id);
    if (!session || session.expiresAt < Date.now()) {
        webSessions.delete(id);
        return null;
    }
    return { id, ...session };
}

function setWebCookie(req, res, value, maxAge = WEB_SESSION_TTL) {
    const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0];
    const secure = forwardedProto === "https" || req.secure;
    const parts = [
        `${WEB_COOKIE}=${encodeURIComponent(value)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${Math.max(0, Math.floor(maxAge / 1000))}`
    ];
    if (secure) parts.push("Secure");
    res.setHeader("Set-Cookie", parts.join("; "));
}

function clearWebCookie(req, res) {
    setWebCookie(req, res, "", 0);
}

function requireCustomer(req, res, next) {
    if (req.webSession?.role !== "customer" || !req.webSession.customerId) {
        return res.status(401).json({ error: "Silakan login sebagai customer." });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (req.webSession?.role !== "admin") {
        return res.status(401).json({ error: "Akses admin diperlukan." });
    }
    next();
}

function customerPayload(customer) {
    return customer ? {
        id: Number(customer.id),
        username: customer.username,
        nama: customer.nama,
        saldo: Number(customer.saldo || 0),
        createdAt: customer.createdAt
    } : null;
}

function depositPayload(row) {
    return {
        id: Number(row.id),
        amount: Number(row.amount),
        requestRef: row.request_ref || row.requestRef,
        status: row.status,
        adminNote: row.admin_note || row.adminNote || null,
        createdAt: row.created_at || row.createdAt,
        decidedAt: row.decided_at || row.decidedAt || null
    };
}

function normalizeProviderStatus(response) {
    const value = String(
        response?.status ??
        response?.data?.status ??
        response?.data?.data?.status ??
        ""
    ).toLowerCase();
    if (["sukses", "success", "berhasil", "selesai", "1"].includes(value)) {
        return "success";
    }
    if (["gagal", "failed", "error", "0"].includes(value)) {
        return "failed";
    }
    return "processing";
}

function providerReference(response, fallback) {
    return response?.trx_id || response?.transaction_id ||
        response?.data?.trx_id || response?.data?.transaction_id || fallback;
}

function publicCatalogProduct(product) {
    return {
        id: Number(product.id),
        kode: product.kode,
        label: product.label,
        nominal: Number(product.nominal || 0),
        hargaJual: product.hargaJual === null ? null : Number(product.hargaJual),
        hargaJualEfektif: getSellingPrice(product),
        groupId: product.groupId,
        groupLabel: product.groupLabel,
        kategoriId: product.kategoriId,
        kategoriLabel: product.kategoriLabel,
        operator: product.operator,
        jenisProduk: product.jenisProduk,
        active: product.active !== false
    };
}

function sendDepositNotification(bot, deposit, amount) {
    if (!bot || !REKAP_GROUP_ID) return;
    const text =
        "DEPOSIT BARU\n" +
        `Ref: ${deposit.request_ref}\n` +
        `Customer ID: ${deposit.customer_id}\n` +
        `Nominal: Rp${Number(amount).toLocaleString("id-ID")}`;
    bot.sendMessage(REKAP_GROUP_ID, text, {
        reply_markup: {
            inline_keyboard: [[
                { text: "Setujui", callback_data: `DEPOSIT_APPROVE_${deposit.id}` },
                { text: "Tolak", callback_data: `DEPOSIT_REJECT_${deposit.id}` }
            ]]
        }
    }).catch(error => console.error("[TELEGRAM DEPOSIT]", error.message));
}

function startWebApp(bot) {
    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json({ limit: "32kb" }));
    app.use(express.urlencoded({ extended: false, limit: "32kb" }));
    app.use((req, res, next) => {
        req.webSession = readWebSession(req);
        next();
    });

    app.get("/healthz", (req, res) => res.json({ ok: true }));
    app.get("/", (req, res) => res.type("html").send(dashboardHtml));

    app.post("/api/auth/register", async (req, res) => {
        try {
            const customer = await createCustomer(req.body?.username, req.body?.password);
            setWebCookie(req, res, createWebSession("customer", customer.id));
            res.status(201).json({ customer: customerPayload(customer) });
        } catch (error) {
            const duplicate = /duplicate key|unique constraint/i.test(error.message || "");
            res.status(duplicate ? 409 : 400).json({
                error: duplicate ? "Username sudah digunakan." : error.message
            });
        }
    });

    app.post("/api/auth/login", async (req, res) => {
        try {
            const customer = await authenticateCustomer(req.body?.username, req.body?.password);
            if (!customer) return res.status(401).json({ error: "Username atau password salah." });
            setWebCookie(req, res, createWebSession("customer", customer.id));
            res.json({ customer: customerPayload(customer) });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    app.post("/api/admin/login", (req, res) => {
        const submitted = String(req.body?.key || "");
        if (!submitted || submitted.length !== DASHBOARD_KEY.length ||
            !crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(DASHBOARD_KEY))) {
            return res.status(401).json({ error: "Kunci dashboard tidak benar." });
        }
        setWebCookie(req, res, createWebSession("admin"));
        res.json({ ok: true, role: "admin" });
    });

    app.get("/api/auth/me", async (req, res) => {
        if (!req.webSession) return res.json({ authenticated: false });
        if (req.webSession.role === "admin") {
            return res.json({ authenticated: true, role: "admin" });
        }
        const customer = await getCustomerById(req.webSession.customerId);
        if (!customer) {
            clearWebCookie(req, res);
            return res.json({ authenticated: false });
        }
        res.json({
            authenticated: true,
            role: "customer",
            customer: customerPayload(customer)
        });
    });

    app.post("/api/auth/logout", (req, res) => {
        if (req.webSession?.id) webSessions.delete(req.webSession.id);
        clearWebCookie(req, res);
        res.json({ ok: true });
    });

    app.get("/api/catalog", requireCustomer, (req, res) => {
        const products = productStore.catalog.map(publicCatalogProduct);
        res.json({ groups: getCatalogGroups(productStore.catalog), products });
    });

    app.get("/api/customer/deposits", requireCustomer, async (req, res) => {
        const deposits = await getCustomerDeposits(req.webSession.customerId);
        res.json({ deposits });
    });

    app.post("/api/customer/deposits", requireCustomer, async (req, res) => {
        try {
            const amount = Number(req.body?.amount);
            if (!Number.isSafeInteger(amount) || amount < 10000) {
                throw new Error("Nominal deposit minimal Rp10.000.");
            }
            const requestRef = generateRefId();
            const deposit = await createDepositRequest(
                req.webSession.customerId,
                amount,
                requestRef
            );
            const dynamicQR = generateDynamicQRIS(DANA_QR_STRING, amount);
            const qrImage = await QRCode.toDataURL(dynamicQR, {
                errorCorrectionLevel: "M",
                margin: 1,
                width: 420
            });
            sendDepositNotification(bot, deposit, amount);
            res.status(201).json({
                deposit: {
                    ...depositPayload(deposit),
                    qrDataUrl: qrImage
                }
            });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    app.get("/api/customer/transactions", requireCustomer, async (req, res) => {
        res.json({
            transactions: await getCustomerTransactions(req.webSession.customerId)
        });
    });

    app.post("/api/customer/orders", requireCustomer, async (req, res) => {
        try {
            const kode = String(req.body?.kode || "").trim();
            const tujuan = String(req.body?.targetData?.tujuan || "").trim();
            if (!kode) throw new Error("Produk belum dipilih.");
            if (!tujuan || tujuan.length > 300) throw new Error("Data tujuan tidak valid.");

            const product = await getProductByKode(kode);
            if (!product) throw new Error("Produk tidak ditemukan atau sedang tidak aktif.");
            const amount = getSellingPrice(product);
            if (!Number.isSafeInteger(amount) || amount <= 0) {
                throw new Error("Harga produk tidak valid.");
            }

            const requestRef = generateRefId();
            const transaction = await createWebTransaction({
                customerId: req.webSession.customerId,
                requestRef,
                productCode: product.kode,
                productLabel: product.label,
                kategoriId: product.kategoriId,
                kategoriLabel: product.kategoriLabel,
                operator: product.operator,
                jenisProduk: product.jenisProduk,
                targetData: { tujuan },
                amount
            });

            const providerResponse = await topup({
                refId: requestRef,
                tujuan,
                kode: product.kode
            });
            const status = normalizeProviderStatus(providerResponse);
            const updated = status === "processing"
                ? transaction
                : await finishWebTransaction(
                    requestRef,
                    status,
                    providerReference(providerResponse, requestRef),
                    providerResponse
                );
            const customer = await getCustomerById(req.webSession.customerId);
            res.status(201).json({
                customer: customerPayload(customer),
                transaction: {
                    requestRef: updated.request_ref,
                    productLabel: updated.product_label,
                    amount: Number(updated.amount),
                    status: updated.status
                }
            });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    app.get("/api/admin/summary", requireAdmin, async (req, res) => {
        res.json(await getAdminSummary());
    });
    app.get("/api/admin/customers", requireAdmin, async (req, res) => {
        res.json({ customers: await getAllCustomers() });
    });
    app.get("/api/admin/deposits", requireAdmin, async (req, res) => {
        res.json({ deposits: await getAdminDeposits() });
    });
    app.get("/api/admin/transactions", requireAdmin, async (req, res) => {
        res.json({ transactions: await getAdminTransactions() });
    });
    app.post("/api/admin/deposits/:id/decision", requireAdmin, async (req, res) => {
        try {
            const result = await decideDeposit(
                Number(req.params.id),
                String(req.body?.status || "")
            );
            res.json({ deposit: depositPayload(result) });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });
    app.post("/api/admin/products/sync", requireAdmin, async (req, res) => {
        try {
            const products = await fetchCatalogProducts();
            const result = await require("./db").replaceCatalogProducts(products);
            await loadProductsFromDB();
            res.json(result);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    registerDashboardRoutes(app);
    registerWebhookRoutes(app);

    app.listen(PORT, "0.0.0.0", () => {
        console.log(`[APP] Web service berjalan di port ${PORT}.`);
    });
    return app;
}

module.exports = { registerDashboardRoutes, startWebApp };
