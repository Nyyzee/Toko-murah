// =========================================
// KEDAISOSMED API
// Digunakan untuk order produk sosial media
// (Followers TikTok, dll)
// =========================================

const axios = require("axios");

const KEDAI_API_URL = "https://kedaisosmed.id/api";

function getCredentials() {
    const api_id  = process.env.KEDAI_API_ID;
    const api_key = process.env.KEDAI_API_KEY;

    if (!api_id || !api_key) {
        throw new Error("KEDAI_API_ID atau KEDAI_API_KEY belum diisi di environment variable.");
    }

    return { api_id, api_key };
}

// =========================================
// ORDER SOSMED
// Kirim order ke kedaisosmed
// Returns: { status: true/false, data: { id, price } / "pesan error" }
// =========================================

async function orderSosmed({ target, quantity, serviceId }) {

    try {

        const { api_id, api_key } = getCredentials();

        const params = new URLSearchParams({
            api_id,
            api_key,
            service:  String(serviceId),
            target:   String(target),
            quantity: String(quantity)
        });

        console.log(`[KEDAI ORDER] service=${serviceId} target=${target} qty=${quantity}`);

        const res = await axios.post(
            `${KEDAI_API_URL}/order`,
            params.toString(),
            {
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                timeout: 30000
            }
        );

        console.log("[KEDAI ORDER] Response:", JSON.stringify(res.data));

        return res.data;

    } catch (err) {

        if (err.response) {
            console.log("[KEDAI ORDER] Error response:", JSON.stringify(err.response.data));
            return { status: false, data: err.response.data?.message || "Terjadi kesalahan." };
        }

        console.log("[KEDAI ORDER] Network error:", err.message);
        return { status: false, data: err.message || "Tidak dapat terhubung ke server." };

    }

}

// =========================================
// CEK STATUS ORDER
// Returns: { status: true/false, data: { status, start_count, remains } }
// =========================================

async function cekStatusSosmed(orderId) {

    try {

        const { api_id, api_key } = getCredentials();

        const params = new URLSearchParams({
            api_id,
            api_key,
            id: String(orderId)
        });

        const res = await axios.post(
            `${KEDAI_API_URL}/status`,
            params.toString(),
            {
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                timeout: 15000
            }
        );

        return res.data;

    } catch (err) {

        console.log("[KEDAI STATUS] Error:", err.message);
        return { status: false, data: err.message };

    }

}

// =========================================
// AMBIL HARGA SERVICE DARI API
// Mengembalikan harga per 1000 (integer)
// API KedaiSosmed mengembalikan field "price" (bukan "rate")
// Kode ini mendukung kedua format: price dan rate
// =========================================

async function fetchServicePrice(serviceId) {

    const { api_id, api_key } = getCredentials();

    const params = new URLSearchParams({ api_id, api_key });

    const res = await axios.post(
        `${KEDAI_API_URL}/services`,
        params.toString(),
        {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            timeout: 20000
        }
    );

    const raw = res.data;

    // Handle berbagai format response SMM panel:
    // 1. Array langsung        â [{service, rate/price, ...}]
    // 2. Object { data: [] }   â {status, data: [...]}
    // 3. Object { services: [] }
    let services;
    if (Array.isArray(raw)) {
        services = raw;
    } else if (raw && Array.isArray(raw.data)) {
        services = raw.data;
    } else if (raw && Array.isArray(raw.services)) {
        services = raw.services;
    } else {
        throw new Error(
            `Format response tidak dikenal: ${JSON.stringify(raw).slice(0, 200)}`
        );
    }

    const service = services.find(
        s => String(s.service) === String(serviceId) || String(s.id) === String(serviceId)
    );

    if (!service) {
        throw new Error(`Service ID ${serviceId} tidak ditemukan di daftar layanan`);
    }

    // Dukung field "rate" (format lama) dan "price" (format KedaiSosmed)
    const rawRate = service.rate ?? service.price;
    const ratePerK = parseFloat(rawRate);

    if (isNaN(ratePerK) || ratePerK <= 0) {
        throw new Error(`Harga tidak valid untuk service ${serviceId}: ${rawRate}`);
    }

    return Math.ceil(ratePerK);
}

module.exports = { orderSosmed, cekStatusSosmed, fetchServicePrice };
