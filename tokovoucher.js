// =========================================
// TOKOVOUCHER API
// =========================================

const axios = require("axios");
const md5   = require("md5");

const { API_BASE_URL, MEMBER_CODE, SECRET_KEY } = require("./config");

// =========================================
// BUAT SIGNATURE TRANSAKSI
// Format: md5(MEMBER_CODE:SECRET_KEY:REF_ID)
// =========================================

function createSignature(refId) {
    return md5(`${MEMBER_CODE}:${SECRET_KEY}:${refId}`);
}

// =========================================
// BUAT SIGNATURE PRODUK
// Format: md5(MEMBER_CODE:SECRET_KEY)
// =========================================

function createProductSignature() {
    return md5(`${MEMBER_CODE}:${SECRET_KEY}`);
}

// =========================================
// AMBIL HARGA PRODUK DARI API
// Mengembalikan Map { kode_produk => price }
// =========================================

async function fetchHargaProduk() {

    const signature = createProductSignature();
    const url = `${API_BASE_URL}/member/produk/full?member_code=${MEMBER_CODE}&signature=${signature}`;

    const res  = await axios.get(url, { timeout: 20000 });
    const data = res.data;

    if (!data || data.status !== 1) {
        throw new Error(data?.error_msg || "Gagal mengambil data produk dari TokoVoucher");
    }

    const semuaProduk = data.data.produk || [];

    // Buat Map: kode_produk => price (harga beli)
    const hargaMap = new Map();
    for (const p of semuaProduk) {
        if (p.status === 1) {
            hargaMap.set(p.kode_produk, p.price);
        }
    }

    return hargaMap;
}

// =========================================
// TOPUP ÃÂ¢ÃÂÃÂ GENERIK UNTUK SEMUA PRODUK
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
            {
                headers: { "Content-Type": "application/json" },
                timeout: 30000
            }
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

module.exports = { topup, fetchHargaProduk };
