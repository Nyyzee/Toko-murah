// =========================================
// KATALOG DINAMIS
// PostgreSQL adalah sumber katalog yang dipakai web dan transaksi.
// Markup keuntungan bisa pakai persen (dari DB) atau flat (dari config).
// =========================================

const { DEFAULT_PRODUCT_MARKUP } = require("./config");
const { getCatalogProducts, getCatalogProductByCode, getMarkupPersen } = require("./db");

let catalog = [];
let catalogByCode = new Map();
let markupPersen = 0; // 0 = pakai flat markup

const GROUP_LABELS = {
    ewallet:       "E-Wallet",
    pulsa:         "Pulsa",
    paket_data:    "Paket Data",
    token_listrik: "Token Listrik",
    game:          "Game",
    sosmed:        "Sosial Media",
    lainnya:       "Lainnya"
};

const GROUP_ORDER = ["ewallet", "pulsa", "paket_data", "token_listrik", "game", "sosmed", "lainnya"];

function groupLabel(id) {
    return GROUP_LABELS[id] || id;
}

function calcHargaJualEfektif(nominal, hargaJual) {
    if (hargaJual !== null && hargaJual !== undefined) {
        return Number(hargaJual);
    }
    if (markupPersen > 0) {
        return Math.ceil(Number(nominal) * (1 + markupPersen / 100));
    }
    return Number(nominal) + DEFAULT_PRODUCT_MARKUP;
}

function normalizeProduct(row) {
    const nominal = Number(row.nominal || 0);
    const hargaJual = row.harga_jual === null || row.harga_jual === undefined
        ? null
        : Number(row.harga_jual);
    return {
        id: Number(row.id),
        kode: row.kode,
        label: row.label,
        nominal,
        hargaJual,
        hargaJualEfektif: calcHargaJualEfektif(nominal, hargaJual),
        groupId: row.group_id || "lainnya",
        groupLabel: groupLabel(row.group_id || "lainnya"),
        kategoriId: row.kategori_id,
        kategoriLabel: row.kategori_label || row.kategori_id,
        operator: row.operator || "",
        jenisProduk: row.jenis_produk || "",
        metadata: row.metadata || {},
        active: row.active !== false
    };
}

function applyDatabaseCatalog(rows) {
    // Urutkan nominal A-Z (ascending)
    const sorted = [...rows].sort((a, b) => {
        const groupA = GROUP_ORDER.indexOf(a.group_id || "lainnya");
        const groupB = GROUP_ORDER.indexOf(b.group_id || "lainnya");
        if (groupA !== groupB) return groupA - groupB;
        if ((a.kategori_label || "") !== (b.kategori_label || "")) {
            return (a.kategori_label || "").localeCompare(b.kategori_label || "");
        }
        if ((a.operator || "") !== (b.operator || "")) {
            return (a.operator || "").localeCompare(b.operator || "");
        }
        return Number(a.nominal || 0) - Number(b.nominal || 0);
    });
    catalog = sorted.map(normalizeProduct);
    catalogByCode = new Map(catalog.map(product => [product.kode, product]));
    return catalog;
}

async function loadProductsFromDB() {
    markupPersen = await getMarkupPersen();
    return applyDatabaseCatalog(await getCatalogProducts(false));
}

async function reloadMarkup() {
    markupPersen = await getMarkupPersen();
    // Recalculate prices in-memory
    catalog = catalog.map(p => ({
        ...p,
        hargaJualEfektif: calcHargaJualEfektif(p.nominal, p.hargaJual)
    }));
}

async function getProductByKode(kode) {
    const cached = catalogByCode.get(kode);
    if (cached) return cached;
    const row = await getCatalogProductByCode(kode);
    return row ? normalizeProduct(row) : null;
}

function getSellingPrice(product) {
    if (!product) return 0;
    return Number(product.hargaJualEfektif ?? product.hargaJual ?? product.nominal ?? 0);
}

function getCatalogGroups(rows = catalog) {
    const groups = new Map();
    for (const product of rows) {
        const gid = product.groupId || "lainnya";
        if (!groups.has(gid)) {
            groups.set(gid, {
                id: gid,
                label: product.groupLabel,
                categories: []
            });
        }
        const group = groups.get(gid);
        let category = group.categories.find(item => item.id === product.kategoriId);
        if (!category) {
            category = {
                id: product.kategoriId,
                label: product.kategoriLabel,
                operators: [],
                types: []
            };
            group.categories.push(category);
        }
        if (product.operator && !category.operators.includes(product.operator)) {
            category.operators.push(product.operator);
        }
        if (product.jenisProduk && !category.types.includes(product.jenisProduk)) {
            category.types.push(product.jenisProduk);
        }
    }
    // Urutkan sesuai GROUP_ORDER
    const ordered = GROUP_ORDER
        .filter(id => groups.has(id))
        .map(id => groups.get(id));
    // Tambahkan grup yang tidak ada di GROUP_ORDER
    for (const [id, group] of groups) {
        if (!GROUP_ORDER.includes(id)) ordered.push(group);
    }
    return ordered;
}

function getCurrentMarkupPersen() {
    return markupPersen;
}

module.exports = {
    get catalog() { return catalog; },
    loadProductsFromDB,
    applyDatabaseCatalog,
    getProductByKode,
    getSellingPrice,
    getCatalogGroups,
    normalizeProduct,
    reloadMarkup,
    getCurrentMarkupPersen
};
