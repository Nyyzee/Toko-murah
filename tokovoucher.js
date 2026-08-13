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

    const data = response.data;
    const rawProducts = Array.isArray(data)
        ? data
        : data?.data?.produk || data?.data?.products || data?.products || [];
    if (!Array.isArray(rawProducts)) {
        throw new Error("Response API produk tidak memiliki daftar produk.");
    }

    return rawProducts
        .filter(item => item.status !== 0 && item.active !== false)
        .map((item, index) => {
            const kode = textValue(item.kode_produk || item.kode || item.code);
            const categoryId = textValue(
                item.kategori_id || item.category_id || item.kategori || item.category,
                "lainnya"
            ).toLowerCase().replace(/\s+/g, "_");
            const categoryLabel = textValue(
                item.kategori_label || item.category_label || item.kategori || item.category,
                categoryId
            );
            const type = textValue(
                item.jenis_produk || item.product_type || item.type || item.jenis
            );
            const operator = textValue(
                item.operator || item.operator_name || item.provider
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
                metadata: item
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
                groupId: p.groupId
            });
        }
        if (p.operator) operatorSet.add(p.operator);
        if (p.jenisProduk) typeSet.add(p.jenisProduk);
    }

    return {
        categories: [...categoryMap.values()].sort((a, b) => a.label.localeCompare(b.label)),
        operators: [...operatorSet].sort(),
        types: [...typeSet].sort(),
        totalProducts: products.length
    };
}

/**
 * Mengambil katalog lalu filter sesuai syncConfig.
 * syncConfig = [{ kategoriId, operator, jenisProduk }, ...]
 * Jika kosong â tolak agar sistem tidak mengambil seluruh katalog.
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
// TOPUP â Generik untuk semua produk
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
                status:  "gagal",
                message: error.response.data.message ||
                         error.response.data.error_msg ||
                         "Terjadi kesalahan."
            };
        }
        console.log("[TOPUP] Network error:", error.message);
        return {
            status:  "gagal",
            message: error.message || "Tidak dapat terhubung ke server."
        };
    }
}

module.exports = {
    topup,
    fetchHargaProduk,
    fetchCatalogProducts,
    fetchCatalogOptions,
    fetchCatalogFiltered
};
