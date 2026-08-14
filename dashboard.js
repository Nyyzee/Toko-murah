const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const QRCode = require("qrcode");

const {
    DASHBOARD_KEY,
    DANA_QR_STRING,
    SESSION_SECRET,
    OWNER_CHAT_ID,
    PORT
} = require("./config");
const {
    authenticateCustomer,
    createCustomer,
    getCustomerById,
    getAllCustomers,
    updateCustomer,
    adjustCustomerSaldo,
    deleteCustomer,
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
    createCatalogProduct,
    updateCatalogProduct,
    deactivateCatalogProduct,
    deleteCatalogProduct,
    bulkUpdateCatalogProducts,
    getNextCatalogNominal,
    getAppSetting,
    setAppSetting,
    getMarkupPersen,
    getStoreProfile,
    saveStoreProfile,
    getSyncConfig,
    saveSyncConfig,
    replaceCatalogProducts
} = require("./db");
const {
    getSellingPrice,
    applyDatabaseCatalog,
    getCatalogGroups,
    getProductByKode,
    loadProductsFromDB,
    reloadMarkup,
    getCurrentMarkupPersen
} = require("./products");
const productStore = require("./products");
const { topup, fetchCatalogOptions, fetchCatalogFiltered } = require("./tokovoucher");
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
        return res.status(503).json({ error: "DASHBOARD_KEY belum diatur." });
    }
    if (!authorized(req)) {
        return res.status(401).json({ error: "Kunci dashboard tidak benar." });
    }
    next();
}

function publicProduct(row) {
    return {
        id: Number(row.id),
        kode: row.kode,
        label: row.label,
        kategoriId: row.kategori_id,
        kategoriLabel: row.kategori_label || row.kategori_id,
        groupId: row.group_id || "lainnya",
        operator: row.operator || "",
        jenisProduk: row.jenis_produk || "",
        nominal: Number(row.nominal || 0),
        hargaJual: row.harga_jual === null ? null : Number(row.harga_jual),
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
        avatarUrl: customer.avatarUrl || "",
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
    if (["sukses", "success", "berhasil", "selesai", "1"].includes(value)) return "success";
    if (["gagal", "failed", "error"].includes(value)) return "failed";
    if (value === "0" || response?.error_msg || response?.data?.error_msg) return "processing";
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

// Notifikasi deposit ke OWNER_CHAT_ID dengan tombol approve/reject
function sendDepositNotification(bot, deposit, amount, username) {
    if (!bot || !OWNER_CHAT_ID) {
        console.warn("[TELEGRAM DEPOSIT] Bot atau OWNER_CHAT_ID tidak diisi, notifikasi dilewati.");
        return;
    }
    const text =
        "[DEPOSIT BARU] 💰 DEPOSIT BARU MASUK\n" +
        `[CUSTOMER] 👤 @${username || deposit.customer_id}\n` +
        `[NOMINAL] 💵 Rp${Number(amount).toLocaleString("id-ID")}\n` +
        `[REF] 🔖 ${deposit.request_ref}\n\n` +
        `Setujui atau tolak deposit ini:`;
    bot.sendMessage(OWNER_CHAT_ID, text, {
        reply_markup: {
            inline_keyboard: [[
                { text: "SETUJUI ✅", callback_data: `DEPOSIT_APPROVE_${deposit.id}` },
                { text: "TOLAK ❌", callback_data: `DEPOSIT_REJECT_${deposit.id}` }
            ]]
        }
    }).catch(error => console.error("[TELEGRAM DEPOSIT]", error.message));
}

function startWebApp(bot) {
    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json({ limit: "64kb" }));
    app.use(express.urlencoded({ extended: false, limit: "32kb" }));
    app.use((req, res, next) => {
        req.webSession = readWebSession(req);
        next();
    });

    app.get("/healthz", (req, res) => res.json({ ok: true }));
    app.get("/", (req, res) => res.type("html").send(dashboardHtml));
    app.get("/dashboard", (req, res) => res.type("html").send(dashboardHtml));
    app.get("/admin", (req, res) => res.type("html").send(dashboardHtml));

    // =========================================
    // AUTH
    // =========================================

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

    app.get("/api/public/profile", async (req, res) => {
        try {
            res.json({ profile: await getStoreProfile() });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    app.get("/api/customer/profile", requireCustomer, async (req, res) => {
        const customer = await getCustomerById(req.webSession.customerId);
        res.json({ customer: customerPayload(customer) });
    });

    app.put("/api/customer/profile", requireCustomer, async (req, res) => {
        try {
            const data = {};
            if (req.body?.username !== undefined) data.username = req.body.username;
            if (req.body?.nama !== undefined) data.nama = req.body.nama;
            if (req.body?.password) data.password = req.body.password;
            if (req.body?.avatarUrl !== undefined) data.avatarUrl = req.body.avatarUrl;
            const customer = await updateCustomer(req.webSession.customerId, data);
            res.json({ customer: customerPayload(customer) });
        } catch (error) {
            const duplicate = /duplicate key|unique constraint/i.test(error.message || "");
            res.status(duplicate ? 409 : 400).json({
                error: duplicate ? "Username sudah digunakan." : error.message
            });
        }
    });

    // =========================================
    // KATALOG (customer)
    // =========================================

    app.get("/api/catalog", requireCustomer, (req, res) => {
        const products = productStore.catalog.map(publicCatalogProduct);
        res.json({ groups: getCatalogGroups(productStore.catalog), products });
    });

    // =========================================
    // DEPOSIT (customer)
    // =========================================

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
            // Kirim notifikasi ke admin dengan tombol approve/reject
            const customer = await getCustomerById(req.webSession.customerId);
            sendDepositNotification(bot, deposit, amount, customer?.username);

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

    // =========================================
    // TRANSAKSI (customer)
    // =========================================

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
            const customerUpdated = await getCustomerById(req.webSession.customerId);
            res.status(201).json({
                customer: customerPayload(customerUpdated),
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

    // =========================================
    // ADMIN — Ringkasan & Data
    // =========================================

    app.get("/api/admin/summary", requireAdmin, async (req, res) => {
        const summary = await getAdminSummary();
        summary.markupPersen = getCurrentMarkupPersen();
        res.json(summary);
    });

    app.get("/api/admin/customers", requireAdmin, async (req, res) => {
        res.json({ customers: await getAllCustomers() });
    });

    app.put("/api/admin/customers/:id", requireAdmin, async (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isSafeInteger(id) || id < 1) throw new Error("ID tidak valid.");
            const updated = await updateCustomer(id, req.body || {});
            if (!updated) return res.status(404).json({ error: "Customer tidak ditemukan." });
            res.json({ customer: updated });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.post("/api/admin/customers/:id/adjust-saldo", requireAdmin, async (req, res) => {
        try {
            const id = Number(req.params.id);
            const amount = Number(req.body?.amount);
            const operation = String(req.body?.operation || "add");
            if (!Number.isSafeInteger(id) || id < 1) throw new Error("ID tidak valid.");
            const updated = await adjustCustomerSaldo(id, amount, operation);
            res.json({ customer: updated });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.delete("/api/admin/customers/:id", requireAdmin, async (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isSafeInteger(id) || id < 1) throw new Error("ID tidak valid.");
            const removed = await deleteCustomer(id);
            if (!removed) return res.status(404).json({ error: "Customer tidak ditemukan." });
            res.json({ ok: true });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.get("/api/admin/deposits", requireAdmin, async (req, res) => {
        res.json({ deposits: await getAdminDeposits() });
    });

    app.post("/api/admin/deposits/:id/decision", requireAdmin, async (req, res) => {
        try {
            const result = await decideDeposit(
                Number(req.params.id),
                String(req.body?.status || ""),
                String(req.body?.adminNote || "")
            );
            // Kirim notifikasi Telegram ke admin setelah memproses dari dashboard
            if (bot && OWNER_CHAT_ID) {
                const statusText = result.status === "approved" ? "DITERIMA ✅" : "DITOLAK ❌";
                bot.sendMessage(
                    OWNER_CHAT_ID,
                    `Deposit ${statusText}\n` +
                    `👤 @${result.username}\n` +
                    `💰 Rp${Number(result.amount).toLocaleString("id-ID")}`
                ).catch(() => {});
            }
            res.json({ deposit: depositPayload(result) });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    app.get("/api/admin/transactions", requireAdmin, async (req, res) => {
        res.json({ transactions: await getAdminTransactions() });
    });

    // =========================================
    // ADMIN — Produk CRUD
    // =========================================

    app.get("/api/admin/products", requireAdmin, async (req, res) => {
        try {
            const rows = await getCatalogProducts(true);
            res.json({ products: rows.map(publicProduct) });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.post("/api/admin/products", requireAdmin, async (req, res) => {
        try {
            const body = req.body || {};
            if (!body.label || String(body.label).trim().length < 2) throw new Error("Nama produk minimal 2 karakter.");
            if (!body.kode || !/^[a-zA-Z0-9._-]{2,120}$/.test(String(body.kode).trim())) throw new Error("Kode produk tidak valid.");
            const nominal = Number(body.nominal);
            if (!Number.isSafeInteger(nominal) || nominal < 0) throw new Error("Nominal tidak valid.");

            const created = await createCatalogProduct({
                kode: String(body.kode).trim(),
                label: String(body.label).trim(),
                kategoriId: String(body.kategoriId || "lainnya").trim(),
                kategoriLabel: String(body.kategoriLabel || body.kategoriId || "Lainnya").trim(),
                groupId: String(body.groupId || "lainnya").trim(),
                operator: String(body.operator || "").trim(),
                jenisProduk: String(body.jenisProduk || "").trim(),
                nominal,
                hargaJual: body.hargaJual !== "" && body.hargaJual != null ? Number(body.hargaJual) : null
            });
            await refreshInMemoryCatalog();
            res.status(201).json({ product: publicProduct(created) });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.put("/api/admin/products/:id", requireAdmin, async (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isSafeInteger(id) || id < 1) throw new Error("ID tidak valid.");
            const body = req.body || {};
            const nominal = Number(body.nominal);
            if (!Number.isSafeInteger(nominal) || nominal < 0) throw new Error("Nominal tidak valid.");

            const updated = await updateCatalogProduct(id, {
                kode: String(body.kode || "").trim(),
                label: String(body.label || "").trim(),
                kategoriId: String(body.kategoriId || "lainnya").trim(),
                kategoriLabel: String(body.kategoriLabel || body.kategoriId || "Lainnya").trim(),
                groupId: String(body.groupId || "lainnya").trim(),
                operator: String(body.operator || "").trim(),
                jenisProduk: String(body.jenisProduk || "").trim(),
                nominal,
                hargaJual: body.hargaJual !== "" && body.hargaJual != null ? Number(body.hargaJual) : null,
                active: body.active !== false
            });
            if (!updated) return res.status(404).json({ error: "Produk tidak ditemukan." });
            await refreshInMemoryCatalog();
            res.json({ product: publicProduct(updated) });
        } catch (error) {
            sendError(res, error);
        }
    });

    app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isSafeInteger(id) || id < 1) throw new Error("ID tidak valid.");
            const removed = await deleteCatalogProduct(id);
            if (!removed) return res.status(404).json({ error: "Produk tidak ditemukan." });
            await refreshInMemoryCatalog();
            res.json({ ok: true });
        } catch (error) {
            sendError(res, error);
        }
    });

    // =========================================
    // ADMIN — Sinkronisasi Produk
    // =========================================

    // Ambil opsi dari API (untuk UI konfigurasi sync)
    app.get("/api/admin/sync/options", requireAdmin, async (req, res) => {
        try {
            const options = await fetchCatalogOptions();
            res.json(options);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    // GET konfigurasi sinkronisasi yang tersimpan di DB
    app.get("/api/admin/sync/config", requireAdmin, async (req, res) => {
        try {
            const config = await getSyncConfig();
            res.json({ config });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    // Simpan konfigurasi sinkronisasi ke DB
    app.post("/api/admin/sync/config", requireAdmin, async (req, res) => {
        try {
            const rules = req.body?.rules;
            if (!Array.isArray(rules)) throw new Error("Format konfigurasi tidak valid.");
            await saveSyncConfig(rules);
            res.json({ ok: true, count: rules.length });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    // Jalankan sinkronisasi sesuai konfigurasi yang tersimpan
    app.post("/api/admin/products/sync", requireAdmin, async (req, res) => {
        try {
            const syncConfig = await getSyncConfig();
            if (syncConfig.length === 0) {
                throw new Error("Belum ada konfigurasi sinkronisasi. Pilih kategori, operator, atau jenis produk terlebih dahulu.");
            }
            const products = await fetchCatalogFiltered(syncConfig);
            const result = await replaceCatalogProducts(products);
            await loadProductsFromDB();
            res.json({
                ...result,
                rulesUsed: syncConfig.length,
                message: `${result.imported} produk berhasil disinkronkan.`
            });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    // =========================================
    // ADMIN — Pengaturan (markup persen, dll.)
    // =========================================

    app.get("/api/admin/settings", requireAdmin, async (req, res) => {
        try {
            const markupPersen = await getMarkupPersen();
            res.json({ markupPersen, profile: await getStoreProfile() });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    app.post("/api/admin/settings", requireAdmin, async (req, res) => {
        try {
            const markupPersen = Number(req.body?.markupPersen);
            if (isNaN(markupPersen) || markupPersen < 0 || markupPersen > 100) {
                throw new Error("Markup persen harus antara 0 dan 100.");
            }
            await setAppSetting("markup_persen", markupPersen);
            await reloadMarkup();
            const profile = await saveStoreProfile(req.body?.profile || {});
            res.json({ ok: true, markupPersen, profile });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    registerWebhookRoutes(app);

    app.listen(PORT, "0.0.0.0", () => {
        console.log(`[APP] Web service berjalan di port ${PORT}.`);
    });
    return app;
}

module.exports = { startWebApp };
