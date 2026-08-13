const fs = require("fs");
const path = require("path");

const { DASHBOARD_KEY } = require("./config");
const {
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
    applyDatabaseCatalog
} = require("./products");

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

module.exports = { registerDashboardRoutes };
