const { simpan } = require("./rekap");
async function kirimKeRekapBot(data) {
    try {
        const ok = await simpan(data);
        if (ok) console.log("[REKAP] ✅ Transaksi tersimpan ke Google Sheets:", data.reseller, data.produk);
        else console.log("[REKAP] ⚠️ Reseller tidak ditemukan di konfigurasi Sheets:", data.reseller);
        return ok;
    } catch (err) {
        console.log("[REKAP] ❌ Gagal menyimpan ke Google Sheets:", err.message);
        throw err;
    }
}
module.exports = { kirimKeRekapBot };
