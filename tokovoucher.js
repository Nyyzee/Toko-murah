// =========================================
// TOKOVOUCHER API
// =========================================

const axios = require("axios");
const md5   = require("md5");

const {
    API_BASE_URL,
    MEMBER_CODE,
    SECRET_KEY,
    PRODUCT_API_URL,
    PRODUCT_API_KEY
} = require("./config");

function createSignature(refId) {
    return md5(`${MEMBER_CODE}:${SECRET_KEY}:${refId}`);
}

function createProductSignature() {
    return md5(`${MEMBER_CODE}:${SECRET_KEY}`);
}

async function fetchHargaProduk() {
    const semuaProduk = await fetchCatalogProducts();
    const hargaMap = new Map();
    for (const p of semuaProduk) {
        if (p.status !== 0 && p.kode) {
            hargaMap.set(p.kode, p.nominal);
        }
    }
    return hargaMap;
}

function textValue(value, fallback = "") {
    return value === undefined || value === null ? fallback : String(value).trim();
}

function relationMap(rows, idKeys, labelKeys) {
    const map = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
        const id = idKeys.map(key => row?.[key]).find(value =>
            value !== undefined && value !== null && String(value) !== ""
        );
        const label = labelKeys.map(key => row?.[key]).find(value =>
            value !== undefined && value !== null && String(value).trim() !== ""
        );
        if (id !== undefined && label !== undefined) {
            map.set(String(id), String(label).trim());
        }
    }
    return map;
}

function normalizedGroup(value, category, type) {
    const text = `${value || ""} ${category || ""} ${type || ""}`.toLowerCase();
    if (/ewallet|e-wallet|dana|ovo|gopay|shopeepay|linkaja/.test(text)) return "ewallet";
    if (/pulsa/.test(text)) return "pulsa";
    if (/data|internet|kuota/.test(text)) return "paket_data";
    if (/listrik|pln|token/.test(text)) return "token_listrik";
    if (/game|voucher/.test(text)) return "game";
    if (/sosmed|sosial|instagram|tiktok|facebook/.test(text)) return "sosmed";
    return "lainnya";
}

/**
 * Mengambil katalog lengkap dari provider.
 */
async function fetchCatalogProducts() {
    let response;
    if (PRODUCT_API_URL) {
        response = await axios.get(PRODUCT_API_URL, {
            timeout: 30000,
            headers: PRODUCT_API_KEY
                ? { Authorization: `Bearer ${PRODUCT_API_KEY}`, "x-api-key": PRODUCT_API_KEY }
                : {}
        });
    } else {
        if (!MEMBER_CODE || !SECRET_KEY) {
            throw new Error("Isi PRODUCT_API_URL atau MEMBER_CODE + SECRET_KEY untuk sinkronisasi katalog.");
        }
        const signature = createProductSignature();
        response = await axios.get(
            `${API_BASE_URL}/member/produk/full?member_code=${MEMBER_CODE}&signature=${signature}`,
            { timeout: 30000 }
        );
    }

    const payload = response.data;
    if (payload?.status === 0 || payload?.status === "0") {
        throw new Error(payload.error_msg || payload.message || "API TokoVoucher menolak permintaan.");
    }

    const data = payload?.data || payload;
    const categoryRows = data?.category || data?.categories || [];
    const operatorRows = data?.operator || data?.operators || [];
    const typeRows = data?.jenis || data?.types || [];
    const categoryNames = relationMap(categoryRows, ["id", "category_id"], ["nama", "name", "category_name"]);
    const operatorNames = relationMap(operatorRows, ["id", "operator_id"], ["nama", "name", "operator_produk", "operator_name"]);
    const typeNames = relationMap(typeRows, ["id", "jenis_id"], ["nama", "name", "jenis_name", "product_type"]);
    const rawProducts = Array.isArray(payload)
        ? payload
        : data?.produk || data?.products || payload?.products || [];
    if (!Array.isArray(rawProducts)) {
        throw new Error("Response API produk tidak memiliki daftar produk.");
    }

    return rawProducts
        .filter(item => item.status !== 0 && item.active !== false)
        .map((item, index) => {
            const kode = textValue(item.kode_produk || item.kode || item.code);
            const rawCategoryId = item.kategori_id || item.category_id || item.categoryId;
            const categoryId = textValue(
                rawCategoryId || item.kategori || item.category,
                "lainnya"
            ).toLowerCase().replace(/\s+/g, "_");
            const categoryLabel = textValue(
                item.kategori_label || item.category_label || item.category_name ||
                categoryNames.get(String(rawCategoryId)) || item.kategori || item.category,
                categoryNames.get(String(rawCategoryId)) || categoryId
            );
            const type = textValue(
                item.jenis_produk || item.product_type || item.type || item.jenis_name ||
                typeNames.get(String(item.jenis_id || item.type_id || item.jenisId)) || item.jenis,
                typeNames.get(String(item.jenis_id || item.type_id || item.jenisId))
            );
            const operator = textValue(
                item.operator || item.operator_name || item.operator_produk ||
                operatorNames.get(String(item.operator_id || item.operatorId)) || item.provider
            );
            const nominal = Number(
                item.nominal || item.price || item.harga || item.cost || 0
            );
            const selling = item.harga_jual ?? item.selling_price ?? item.sell_price ?? null;
            const hargaJual = selling === null || selling === ""
                ? null
                : Number(selling);
            if (!kode || !Number.isSafeInteger(nominal) || nominal < 0) return null;
            if (hargaJual !== null && (!Number.isSafeInteger(hargaJual) || hargaJual < 0)) {
                return null;
            }
            return {
                kode,
                kategoriId: categoryId,
                kategoriLabel: categoryLabel,
                groupId: normalizedGroup(
                    item.group_id || item.group || item.grup,
                    categoryLabel,
                    type
                ),
                operator,
                jenisProduk: type,
                label: textValue(
                    item.label || item.nama_produk || item.product_name || item.nama,
                    kode || `Produk ${index + 1}`
                ),
                nominal,
                hargaJual,
                metadata: {
                    ...item,
                    category: categoryRows.find(row => String(row.id) === String(rawCategoryId)) || null,
                    operator: operatorRows.find(row => String(row.id) === String(item.operator_id || item.operatorId)) || null,
                    jenis: typeRows.find(row => String(row.id) === String(item.jenis_id || item.type_id || item.jenisId)) || null
                }
            };
        })
        .filter(Boolean);
}

/**
 * Mengambil opsi unik dari katalog API (untuk UI konfigurasi sinkronisasi).
 * Mengembalikan { categories, operators, types } dari produk yang tersedia.
 */
async function fetchCatalogOptions() {
    const products = await fetchCatalogProducts();
    const categoryMap = new Map();
    const operatorSet = new Set();
    const typeSet = new Set();

    for (const p of products) {
        if (!categoryMap.has(p.kategoriId)) {
            categoryMap.set(p.kategoriId, {
                id: p.kategoriId,
                label: p.kategoriLabel,
                groupId: p.groupId,
                sampleProduct: p.label,
                sampleOperator: p.operator,
                sampleType: p.jenisProduk
            });
        }
        if (p.operator) operatorSet.add(p.operator);
        if (p.jenisProduk) typeSet.add(p.jenisProduk);
    }

    return {
        categories: [...categoryMap.values()].map(category => {
            const rawLabel = String(category.label || "").trim();
            const isOnlyId = !rawLabel || rawLabel.toLowerCase().replace(/[\s_-]/g, "") === category.id.toLowerCase().replace(/[\s_-]/g, "");
            return {
                ...category,
                displayLabel: isOnlyId
                    ? `Kategori ${category.id}${category.sampleProduct ? ` — contoh: ${category.sampleProduct}` : ""}`
                    : rawLabel
            };
        }).sort((a, b) => a.displayLabel.localeCompare(b.displayLabel)),
        operators: [...operatorSet].sort(),
        types: [...typeSet].sort(),
        totalProducts: products.length
    };
}

/**
 * Mengambil katalog lalu filter sesuai syncConfig.
 * syncConfig = [{ kategoriId, operator, jenisProduk }, ...]
 * Jika kosong → tolak agar sistem tidak mengambil seluruh katalog.
 */
async function fetchCatalogFiltered(syncConfig) {
    const all = await fetchCatalogProducts();
    if (!Array.isArray(syncConfig) || syncConfig.length === 0) {
        throw new Error("Belum ada konfigurasi sinkronisasi. Pilih kategori, operator, atau jenis produk terlebih dahulu.");
    }
    return all.filter(p => {
        return syncConfig.some(rule => {
            const matchKat = !rule.kategoriId || p.kategoriId === rule.kategoriId;
            const matchOp  = !rule.operator   || p.operator   === rule.operator;
            const matchJenis = !rule.jenisProduk || p.jenisProduk === rule.jenisProduk;
            return matchKat && matchOp && matchJenis;
        });
    });
}

// =========================================
// TOPUP — Generik untuk semua produk
// =========================================

async function topup({ refId, tujuan, kode }) {
    try {
        const signature = createSignature(refId);
        const payload = {
            member_code: MEMBER_CODE,
            ref_id:      refId,
            produk:      kode,
            tujuan:      tujuan,
            server_id:   "",
            signature:   signature
        };
        console.log("[TOPUP] Request payload:", JSON.stringify(payload));
        const response = await axios.post(
            `${API_BASE_URL}/v1/transaksi`,
            payload,
            { headers: { "Content-Type": "application/json" }, timeout: 30000 }
        );
        console.log("[TOPUP] Response:", JSON.stringify(response.data));
        return response.data;
    } catch (error) {
        if (error.response) {
            console.log("[TOPUP] Error response:", JSON.stringify(error.response.data));
            return {
                status:  "pending",
                message: error.response.data.message ||
                         error.response.data.error_msg ||
                         "Provider belum memberi status final.",
                pending: true
            };
        }
        console.log("[TOPUP] Network error:", error.message);
        return {
            status:  "pending",
            message: error.message || "Provider belum memberi status final.",
            pending: true
        };
    }
}

async function checkTransactionStatus(refId) {
    if (!MEMBER_CODE || !SECRET_KEY) {
        throw new Error("MEMBER_CODE dan SECRET_KEY belum diatur.");
    }
    const signature = createSignature(refId);
    try {
        const response = await axios.get(
            `${API_BASE_URL}/v1/transaksi/status`,
            {
                params: {
                    ref_id: refId,
                    member_code: MEMBER_CODE,
                    signature
                },
                timeout: 30000
            }
        );
        return response.data;
    } catch (error) {
        if (error.response) return error.response.data;
        throw error;
    }
}

module.exports = {
    topup,
    checkTransactionStatus,
    fetchHargaProduk,
    fetchCatalogProducts,
    fetchCatalogOptions,
    fetchCatalogFiltered
};
