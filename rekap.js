// =========================================
// REKAP TRANSAKSI — integrated into the main DANA bot
// Google Sheets storage + owner commands.
// =========================================
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { getNowWIB } = require("./utils");

const RESELLERS = {
    Dodi: { spreadsheet_id: "1-YAnZji549F-G3uzn4w-JUXfygwwdIpLGysdZL4pPc8", worksheet: "Sheet1" },
    Mamak: { spreadsheet_id: "1-vDqNc1ZiiwEBTC_37iLghja8as4whOV0W6XZpLWIvE", worksheet: "Sheet1" },
    Juraidah: { spreadsheet_id: "1-vDqNc1ZiiwEBTC_37iLghja8as4whOV0W6XZpLWIvE", worksheet: "Sheet1" },
    Nurjannah: { spreadsheet_id: "10QKtgBstCc6siMmxW-BeKpM5xgNRReRUQ368q_8z6EQ", worksheet: "Sheet1" }
};

const SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets"
];

let sheetsClientPromise = null;

function getCredentials() {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (raw) {
        try { return JSON.parse(raw); }
        catch (e) { throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON bukan JSON yang valid"); }
    }

    const file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || path.join(__dirname, "google-service-account.json");
    if (!fs.existsSync(file)) {
        throw new Error(
            "Kredensial Google belum dikonfigurasi. Isi GOOGLE_SERVICE_ACCOUNT_JSON atau upload google-service-account.json."
        );
    }
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function getSheetsClient() {
    if (!sheetsClientPromise) {
        sheetsClientPromise = (async () => {
            const auth = new google.auth.GoogleAuth({ credentials: getCredentials(), scopes: SCOPES });
            return google.sheets({ version: "v4", auth });
        })();
    }
    return sheetsClientPromise;
}

function toNumber(value) {
    value = String(value ?? "").toLowerCase().replace(/,/g, "").trim();
    if (!value) return 0;
    if (value.endsWith("k")) return Math.round(parseFloat(value.slice(0, -1)) * 1000);
    if (value.endsWith("jt")) return Math.round(parseFloat(value.slice(0, -2)) * 1000000);
    return Math.round(parseFloat(value) || 0);
}

function toK(value) {
    value = Number(value) || 0;
    if (value % 1000 === 0) return `${value / 1000}k`;
    return `${value / 1000}k`;
}

function toRupiah(value) {
    return "Rp " + Number(value || 0).toLocaleString("id-ID");
}

const BULAN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

function parseDate(s) {
    const normalized = String(s || "").trim().replace(/\s*[/\-.]\s*/g, "/");
    for (const parts of [normalized]) {
        const m = parts.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
        if (m) {
            let y = Number(m[3]); if (y < 100) y += 2000;
            const d = new Date(y, Number(m[2])-1, Number(m[1]));
            if (d.getFullYear() === y && d.getMonth() === Number(m[2])-1 && d.getDate() === Number(m[1])) return d;
        }
    }
    return null;
}

function formatTanggalPanjang(d) {
    return `${String(d.getDate()).padStart(2,"0")} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
}

function resolveReseller(name) {
    const n = String(name || "").trim().toLowerCase();
    return Object.keys(RESELLERS).find(k => k.toLowerCase() === n) || null;
}

// =========================================
// TAMBAH RESELLER KE KONFIGURASI (dinamis)
// Dipanggil saat reseller baru diterima atau saat startup dari DB
// =========================================
function addResellerToConfig(nama, spreadsheetId, worksheet = "Sheet1") {
    const key = String(nama || "").trim();
    if (!key || !spreadsheetId) return;
    RESELLERS[key] = { spreadsheet_id: spreadsheetId, worksheet };
}

async function getSheetInfo(spreadsheetId, title) {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title))" });
    const sheet = (res.data.sheets || []).find(s => s.properties.title === title);
    if (!sheet) throw new Error(`Worksheet ${title} tidak ditemukan`);
    return sheet.properties;
}

function extractSpreadsheetId(value) {
    const raw = String(value || "").trim();
    const fromUrl = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (fromUrl) return fromUrl[1];
    if (/^[a-zA-Z0-9_-]{20,}$/.test(raw)) return raw;
    return null;
}

// =========================================
// VALIDASI SPREADSHEET MANUAL RESELLER
// Spreadsheet dibuat manual oleh owner dan dibagikan ke service account.
// =========================================
async function validateSpreadsheet(spreadsheetId, worksheet = "Sheet1") {
    await getSheetInfo(spreadsheetId, worksheet);
    return true;
}

// =========================================
// SIMPAN TRANSAKSI KE SPREADSHEET
// Menggunakan RAW agar tanggal tidak dikonversi ke serial number
// =========================================
async function simpan(data) {
    const reseller = resolveReseller(data.reseller);
    if (!reseller) return false;
    const cfg = RESELLERS[reseller];
    const sheets = await getSheetsClient();
    const keuntungan = toNumber(data.keuntungan);
    const bagian = Math.floor(keuntungan / 2);
    await sheets.spreadsheets.values.append({
        spreadsheetId: cfg.spreadsheet_id,
        range: `${cfg.worksheet}!A:E`,
        valueInputOption: "RAW",          // RAW = tanggal disimpan sebagai teks, bukan serial number
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [[data.tanggal, data.produk, data.harga, data.keuntungan, toK(bagian)]] }
    });
    return true;
}

async function getRows(reseller) {
    const cfg = RESELLERS[reseller];
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: cfg.spreadsheet_id, range: `${cfg.worksheet}!A:E` });
    return res.data.values || [];
}

async function getRekap(reseller = null) {
    const configs = reseller ? [[reseller, RESELLERS[reseller]]] : Object.entries(RESELLERS);
    if (reseller && !RESELLERS[reseller]) return null;
    let trx=0, omzet=0, profit=0, bagian=0, dates=[];
    for (const [name] of configs) {
        const rows = await getRows(name);
        for (const row of rows.slice(1)) {
            if (row.length < 4) continue;
            const harga = toNumber(row[2]);
            const p = toNumber(row[3]);
            trx++; omzet += harga; profit += p; bagian += Math.floor(p/2);
            const d = parseDate(row[0]); if (d) dates.push(d);
        }
    }
    dates.sort((a,b)=>a-b);
    return {
        trx, omzet, profit, reseller: bagian,
        tanggal_mulai: dates[0] || null,
        tanggal_selesai: dates[dates.length-1] || null
    };
}

async function getListReseller(reseller, limit=10) {
    if (!RESELLERS[reseller]) return null;
    const rows = (await getRows(reseller)).slice(1);
    const result=[];
    for (const row of rows) {
        if (row.length < 4) continue;
        result.push({ reseller, tanggal: row[0], produk: row[1], harga: row[2], profit: row[3] });
    }
    return result.reverse().slice(0, limit);
}

async function hapusTerakhir(reseller) {
    if (!RESELLERS[reseller]) return false;
    const cfg = RESELLERS[reseller];
    const rows = await getRows(reseller);
    if (rows.length <= 1) return false;
    const props = await getSheetInfo(cfg.spreadsheet_id, cfg.worksheet);
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: cfg.spreadsheet_id,
        requestBody: { requests: [{ deleteDimension: { range: { sheetId: props.sheetId, dimension: "ROWS", startIndex: rows.length-1, endIndex: rows.length } } }] }
    });
    return true;
}

// =========================================
// FORMAT REKAP — dengan timestamp realtime
// =========================================
function formatRekapText(label, data) {
    let range = "Belum ada data";
    if (data.tanggal_mulai && data.tanggal_selesai) {
        range = data.tanggal_mulai.getTime() === data.tanggal_selesai.getTime()
            ? formatTanggalPanjang(data.tanggal_mulai)
            : `${formatTanggalPanjang(data.tanggal_mulai)} – ${formatTanggalPanjang(data.tanggal_selesai)}`;
    }

    // Timestamp realtime saat rekap diambil (dalam WIB / Asia:Jakarta)
    const now  = getNowWIB();
    const dd   = String(now.getUTCDate()).padStart(2, "0");
    const mm   = String(now.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = now.getUTCFullYear();
    const hh   = String(now.getUTCHours()).padStart(2, "0");
    const mi   = String(now.getUTCMinutes()).padStart(2, "0");
    const ss   = String(now.getUTCSeconds()).padStart(2, "0");
    const waktuSekarang = `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss} WIB`;

    return (
        `📊 ${label}\n` +
        `📅 Periode       : ${range}\n\n` +
        `Total TRX        : ${data.trx}\n` +
        `Omzet            : ${toRupiah(data.omzet)}\n` +
        `Profit           : ${toRupiah(data.profit)}\n` +
        `Bagian Reseller  : ${toRupiah(data.reseller)}\n\n` +
        `🕒 Diperbarui    : ${waktuSekarang}`
    );
}

module.exports = {
    RESELLERS,
    simpan,
    getRekap,
    getListReseller,
    hapusTerakhir,
    formatRekapText,
    resolveReseller,
    addResellerToConfig,
    extractSpreadsheetId,
    validateSpreadsheet
};
