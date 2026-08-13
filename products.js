// =========================================
// KATALOG DINAMIS
// Tidak ada daftar produk hardcoded di source.
// PostgreSQL adalah sumber katalog yang dipakai web dan transaksi.
// =========================================

const { DEFAULT_PRODUCT_MARKUP } = require("./config");
const { getCatalogProducts, getCatalogProductByCode } = require("./db");

let catalog = [];
let catalogByCode = new Map();

function groupLabel(id) {
    const labels = {
        ewallet: "E-Wallet",
        pulsa: "Pulsa",
        paket_data: "Paket Data",
        token_listrik: "Token Listrik",
        game: "Game",
        sosmed: "Sosial Media",
        lainnya: "Lainnya"
    };
    return labels[id] || id;
}

function normalizeProduct(row) {
    return {
        id: Number(row.id),
        kode: row.kode,
        label: row.label,
        nominal: Number(row.nominal || 0),
        hargaJual: row.harga_jual === null || row.harga_jual === undefined
            ? null
            : Number(row.harga_jual),
        hargaJualEfektif: row.harga_jual === null || row.harga_jual === undefined
            ? Number(row.nominal || 0) + DEFAULT_PRODUCT_MARKUP
            : Number(row.harga_jual),
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
    catalog = rows.map(normalizeProduct);
    catalogByCode = new Map(catalog.map(product => [product.kode, product]));
    return catalog;
}

async function loadProductsFromDB() {
    return applyDatabaseCatalog(await getCatalogProducts(false));
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
        if (!groups.has(product.groupId)) {
            groups.set(product.groupId, {
                id: product.groupId,
                label: product.groupLabel,
                categories: []
            });
        }
        const group = groups.get(product.groupId);
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
    return [...groups.values()];
}

module.exports = {
    get catalog() {
        return catalog;
    },
    loadProductsFromDB,
    applyDatabaseCatalog,
    getProductByKode,
    getSellingPrice,
    getCatalogGroups,
    normalizeProduct
};
