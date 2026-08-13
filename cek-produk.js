// =========================================
// SCRIPT CEK PRODUK TOKOVOUCHER
// Jalankan: node cek-produk.js
// Akan menampilkan semua produk Free Fire
// dan Mobile Legends beserta kode & harganya
// =========================================

require("dotenv").config();

const axios = require("axios");
const md5   = require("md5");

const MEMBER_CODE = process.env.MEMBER_CODE;
const SECRET_KEY  = process.env.SECRET_KEY;
const API_BASE    = process.env.API_BASE_URL || "https://api.tokovoucher.net";

if (!MEMBER_CODE || !SECRET_KEY) {
    console.error("❌ MEMBER_CODE dan SECRET_KEY belum diisi di .env");
    process.exit(1);
}

// Signature default = md5(MEMBER_CODE:SECRET_KEY)
const signature = md5(`${MEMBER_CODE}:${SECRET_KEY}`);

async function fetchProduk() {

    console.log("⏳ Mengambil data produk dari TokoVoucher...\n");

    const url = `${API_BASE}/member/produk/full?member_code=${MEMBER_CODE}&signature=${signature}`;

    const res  = await axios.get(url, { timeout: 15000 });
    const data = res.data;

    if (!data || data.status !== 1) {
        console.error("❌ Gagal ambil produk:", data?.error_msg || "Unknown error");
        process.exit(1);
    }

    const semuaProduk  = data.data.produk   || [];
    const semuaOp      = data.data.operator || [];

    // Cari operator ID untuk Free Fire dan Mobile Legends
    const opFF = semuaOp.find(o => o.nama.toLowerCase().includes("free fire"));
    const opML = semuaOp.find(o => o.nama.toLowerCase().includes("mobile legend"));

    console.log("=".repeat(60));
    console.log("🔥 FREE FIRE — operator:", opFF ? opFF.nama : "TIDAK DITEMUKAN");
    console.log("=".repeat(60));

    if (opFF) {
        const produkFF = semuaProduk.filter(p => p.operator_id === opFF.id && p.status === 1);
        if (produkFF.length === 0) {
            console.log("   Tidak ada produk aktif.\n");
        } else {
            produkFF.forEach(p => {
                console.log(`   kode: "${p.kode_produk}"`);
                console.log(`   nama: ${p.nama}`);
                console.log(`   harga (price): Rp${p.price.toLocaleString("id-ID")}`);
                console.log(`   ---`);
            });
        }
    }

    console.log("\n" + "=".repeat(60));
    console.log("⚔️  MOBILE LEGENDS — operator:", opML ? opML.nama : "TIDAK DITEMUKAN");
    console.log("=".repeat(60));

    if (opML) {
        const produkML = semuaProduk.filter(p => p.operator_id === opML.id && p.status === 1);
        if (produkML.length === 0) {
            console.log("   Tidak ada produk aktif.\n");
        } else {
            produkML.forEach(p => {
                console.log(`   kode: "${p.kode_produk}"`);
                console.log(`   nama: ${p.nama}`);
                console.log(`   harga (price): Rp${p.price.toLocaleString("id-ID")}`);
                console.log(`   ---`);
            });
        }
    }

    console.log("\n✅ Selesai. Salin kode dan harga di atas ke products.js");
}

fetchProduk().catch(err => {
    console.error("❌ Error:", err.message);
});
