// =========================================
// DATABASE — PostgreSQL (pg)
// Menyimpan data saldo reseller secara permanen
// =========================================

const { Pool } = require("pg");
const { DATABASE_URL } = require("./config");

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false
});

// =========================================
// INIT — Buat tabel jika belum ada
// Tambahkan kolom baru jika belum ada (tidak mengubah tabel lama)
// =========================================

async function initDB() {
    // Tabel utama (tidak diubah)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS resellers (
            id         SERIAL PRIMARY KEY,
            nama       VARCHAR(100) NOT NULL,
            password   VARCHAR(100) UNIQUE NOT NULL,
            saldo      BIGINT NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    `);

    // Kolom baru untuk data Telegram (ditambahkan jika belum ada)
    const newCols = [
        `ALTER TABLE resellers ADD COLUMN IF NOT EXISTS telegram_id     BIGINT`,
        `ALTER TABLE resellers ADD COLUMN IF NOT EXISTS chat_id         BIGINT`,
        `ALTER TABLE resellers ADD COLUMN IF NOT EXISTS username        VARCHAR(100)`,
        `ALTER TABLE resellers ADD COLUMN IF NOT EXISTS first_name      VARCHAR(100)`,
        `ALTER TABLE resellers ADD COLUMN IF NOT EXISTS last_name       VARCHAR(100)`,
        `ALTER TABLE resellers ADD COLUMN IF NOT EXISTS registered_at   TIMESTAMPTZ`,
        // ID spreadsheet manual yang dipakai untuk rekap reseller
        `ALTER TABLE resellers ADD COLUMN IF NOT EXISTS spreadsheet_id  VARCHAR(200)`
    ];
    for (const sql of newCols) {
        await pool.query(sql).catch(() => {}); // abaikan jika sudah ada
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS rekap_users (
            username VARCHAR(100) PRIMARY KEY,
            chat_id BIGINT NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
    `);

    // Katalog produk dikelola dari dashboard, bukan dari file source.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS catalog_products (
            id           SERIAL PRIMARY KEY,
            kode         VARCHAR(120) UNIQUE NOT NULL,
            kategori_id  VARCHAR(100) NOT NULL,
            label        VARCHAR(200) NOT NULL,
            nominal      BIGINT NOT NULL CHECK (nominal >= 0),
            harga_jual   BIGINT CHECK (harga_jual IS NULL OR harga_jual >= 0),
            metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
            active       BOOLEAN NOT NULL DEFAULT TRUE,
            created_at   TIMESTAMPTZ DEFAULT NOW(),
            updated_at   TIMESTAMPTZ DEFAULT NOW()
        );
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS catalog_products_category_idx
        ON catalog_products (kategori_id, active);
    `);
    console.log("[DB] Tabel resellers + rekap_users + catalog_products siap.");
}

// =========================================
// TAMBAH RESELLER BARU (versi lama — tetap ada)
// =========================================

async function tambahReseller(nama, password, saldo = 0) {
    // Cari ID terkecil yang belum terpakai (isi gap setelah penghapusan)
    const gapResult = await pool.query(`
        SELECT COALESCE(
            (SELECT MIN(gs) FROM generate_series(
                1,
                (SELECT COALESCE(MAX(id), 0) + 1 FROM resellers)
            ) gs
            WHERE NOT EXISTS (SELECT 1 FROM resellers WHERE id = gs)),
            1
        ) AS next_id
    `);
    const nextId = gapResult.rows[0].next_id;

    const result = await pool.query(
        `INSERT INTO resellers (id, nama, password, saldo)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [nextId, nama, password, saldo]
    );

    // Sesuaikan sequence agar tidak bentrok di masa depan
    await pool.query(`SELECT setval('resellers_id_seq', (SELECT MAX(id) FROM resellers))`);

    return result.rows[0];
}

// =========================================
// TAMBAH RESELLER LENGKAP (versi baru — dengan data Telegram)
// Digunakan oleh fitur Join Reseller
// telegramData: { telegram_id, chat_id, username, first_name, last_name }
// =========================================

async function tambahResellerLengkap(nama, password, saldo = 0, telegramData = {}) {
    // Cari ID terkecil yang belum terpakai
    const gapResult = await pool.query(`
        SELECT COALESCE(
            (SELECT MIN(gs) FROM generate_series(
                1,
                (SELECT COALESCE(MAX(id), 0) + 1 FROM resellers)
            ) gs
            WHERE NOT EXISTS (SELECT 1 FROM resellers WHERE id = gs)),
            1
        ) AS next_id
    `);
    const nextId = gapResult.rows[0].next_id;

    const {
        telegram_id  = null,
        chat_id      = null,
        username     = null,
        first_name   = null,
        last_name    = null
    } = telegramData;

    const result = await pool.query(
        `INSERT INTO resellers
            (id, nama, password, saldo, telegram_id, chat_id, username, first_name, last_name, registered_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         RETURNING *`,
        [nextId, nama, password, saldo, telegram_id, chat_id, username, first_name, last_name]
    );

    await pool.query(`SELECT setval('resellers_id_seq', (SELECT MAX(id) FROM resellers))`);

    return result.rows[0];
}

// =========================================
// SIMPAN SPREADSHEET ID KE RESELLER
// Dipanggil setelah spreadsheet otomatis berhasil dibuat
// =========================================

async function simpanSpreadsheetId(resellerId, spreadsheetId) {
    const result = await pool.query(
        `UPDATE resellers SET spreadsheet_id = $1 WHERE id = $2 RETURNING *`,
        [spreadsheetId, resellerId]
    );
    return result.rows[0] || null;
}

// =========================================
// AMBIL SEMUA RESELLER YANG PUNYA SPREADSHEET
// Digunakan saat startup untuk memuat konfigurasi rekap dinamis
// =========================================

async function getAllResellersWithSpreadsheet() {
    const result = await pool.query(
        `SELECT id, nama, spreadsheet_id FROM resellers WHERE spreadsheet_id IS NOT NULL ORDER BY id ASC`
    );
    return result.rows;
}

// =========================================
// CARI RESELLER BERDASARKAN PASSWORD
// =========================================

async function getResellerByPassword(password) {
    const result = await pool.query(
        `SELECT * FROM resellers WHERE password = $1`,
        [password]
    );
    return result.rows[0] || null;
}

async function getResellerByUsername(username) {
    if (!username) return null;
    const normalized = String(username).replace(/^@/, "").trim().toLowerCase();
    const result = await pool.query(
        `SELECT * FROM resellers WHERE LOWER(username) = $1 LIMIT 1`,
        [normalized]
    );
    return result.rows[0] || null;
}

// =========================================
// UBAH PASSWORD RESELLER
// =========================================

async function ubahPasswordReseller(id, passwordBaru) {
    const result = await pool.query(
        `UPDATE resellers SET password = $1
         WHERE id = $2
         RETURNING *`,
        [passwordBaru, id]
    );
    return result.rows[0] || null;
}

// =========================================
// CARI RESELLER BERDASARKAN ID
// =========================================

async function getResellerById(id) {
    const result = await pool.query(
        `SELECT * FROM resellers WHERE id = $1`,
        [id]
    );
    return result.rows[0] || null;
}

// =========================================
// DAFTAR SEMUA RESELLER
// =========================================

async function getAllResellers() {
    const result = await pool.query(
        `SELECT * FROM resellers ORDER BY id ASC`
    );
    return result.rows;
}

// =========================================
// TOPUP SALDO RESELLER
// =========================================

async function topupSaldo(id, jumlah) {
    const result = await pool.query(
        `UPDATE resellers SET saldo = saldo + $1
         WHERE id = $2
         RETURNING *`,
        [jumlah, id]
    );
    return result.rows[0] || null;
}

// =========================================
// KURANGI SALDO RESELLER
// =========================================

async function kurangSaldo(id, jumlah) {
    const result = await pool.query(
        `UPDATE resellers SET saldo = saldo - $1
         WHERE id = $2
         RETURNING *`,
        [jumlah, id]
    );
    return result.rows[0] || null;
}

// =========================================
// POTONG SALDO (cek dulu apakah cukup)
// Mengembalikan { ok, reseller }
// =========================================

async function potongSaldo(resellerId, jumlah) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const res = await client.query(
            `SELECT saldo FROM resellers WHERE id = $1 FOR UPDATE`,
            [resellerId]
        );

        if (!res.rows[0]) {
            await client.query("ROLLBACK");
            return { ok: false, alasan: "Reseller tidak ditemukan." };
        }

        const saldoSekarang = Number(res.rows[0].saldo);

        if (saldoSekarang < jumlah) {
            await client.query("ROLLBACK");
            return {
                ok:    false,
                alasan: `Saldo tidak cukup. Saldo kamu: Rp${saldoSekarang.toLocaleString("id-ID")}`
            };
        }

        const updated = await client.query(
            `UPDATE resellers SET saldo = saldo - $1
             WHERE id = $2
             RETURNING *`,
            [jumlah, resellerId]
        );

        await client.query("COMMIT");
        return { ok: true, reseller: updated.rows[0] };
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}

// =========================================
// KEMBALIKAN SALDO (jika transaksi gagal)
// =========================================

async function kembalikanSaldo(resellerId, jumlah) {
    const result = await pool.query(
        `UPDATE resellers SET saldo = saldo + $1
         WHERE id = $2
         RETURNING *`,
        [jumlah, resellerId]
    );
    return result.rows[0] || null;
}

// =========================================
// HAPUS RESELLER
// =========================================

async function hapusReseller(id) {
    const result = await pool.query(
        `DELETE FROM resellers WHERE id = $1 RETURNING *`,
        [id]
    );
    return result.rows[0] || null;
}

// =========================================
// REKAP — simpan mapping username Telegram → chat_id
// =========================================
async function saveRekapUser(username, chatId) {
    if (!username) return;
    await pool.query(`
        INSERT INTO rekap_users (username, chat_id, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (username)
        DO UPDATE SET chat_id = EXCLUDED.chat_id, updated_at = NOW()
    `, [String(username).replace(/^@/, '').toLowerCase(), chatId]);
}

async function getRekapChatId(username) {
    if (!username) return null;
    const result = await pool.query(
        `SELECT chat_id FROM rekap_users WHERE username = $1`,
        [String(username).replace(/^@/, '').toLowerCase()]
    );
    return result.rows[0]?.chat_id || null;
}

// =========================================
// KATALOG PRODUK — Dashboard admin
// =========================================

async function getCatalogProducts(includeInactive = true) {
    const result = await pool.query(
        `SELECT id, kode, kategori_id, label, nominal, harga_jual, metadata, active,
                created_at, updated_at
         FROM catalog_products
         ${includeInactive ? "" : "WHERE active = TRUE"}
         ORDER BY kategori_id ASC, nominal ASC, id ASC`
    );
    return result.rows;
}

async function seedCatalogProducts(products) {
    for (const product of products) {
        await pool.query(
            `INSERT INTO catalog_products
                (kode, kategori_id, label, nominal, harga_jual, metadata, active)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, TRUE)
             ON CONFLICT (kode) DO NOTHING`,
            [
                product.kode,
                product.kategoriId,
                product.label,
                product.nominal,
                product.hargaJual ?? null,
                JSON.stringify(product.metadata || {})
            ]
        );
    }
}

async function createCatalogProduct(product) {
    const result = await pool.query(
        `INSERT INTO catalog_products
            (kode, kategori_id, label, nominal, harga_jual, metadata, active)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, TRUE)
         RETURNING *`,
        [
            product.kode,
            product.kategoriId,
            product.label,
            product.nominal,
            product.hargaJual ?? null,
            JSON.stringify(product.metadata || {})
        ]
    );
    return result.rows[0];
}

async function getNextCatalogNominal(kategoriId, step = 1000) {
    const result = await pool.query(
        `SELECT COALESCE(MAX(nominal), 0) + $2 AS next_nominal
         FROM catalog_products
         WHERE kategori_id = $1 AND active = TRUE`,
        [kategoriId, step]
    );
    return Number(result.rows[0]?.next_nominal || step);
}

async function updateCatalogProduct(id, product) {
    const result = await pool.query(
        `UPDATE catalog_products
         SET kode = $1,
             kategori_id = $2,
             label = $3,
             nominal = $4,
             harga_jual = $5,
             metadata = $6::jsonb,
             active = $7,
             updated_at = NOW()
         WHERE id = $8
         RETURNING *`,
        [
            product.kode,
            product.kategoriId,
            product.label,
            product.nominal,
            product.hargaJual ?? null,
            JSON.stringify(product.metadata || {}),
            product.active !== false,
            id
        ]
    );
    return result.rows[0] || null;
}

async function deactivateCatalogProduct(id) {
    const result = await pool.query(
        `UPDATE catalog_products
         SET active = FALSE, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id]
    );
    return result.rows[0] || null;
}

async function bulkUpdateCatalogProducts({
    kategoriId,
    namaContains,
    nominalStart = null,
    nominalStep = null,
    hargaJualMode = "keep",
    hargaJual = null
}) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const filters = ["active = TRUE"];
        const params = [];
        if (kategoriId) {
            params.push(kategoriId);
            filters.push(`kategori_id = $${params.length}`);
        }
        if (namaContains) {
            params.push(`%${namaContains}%`);
            filters.push(`label ILIKE $${params.length}`);
        }

        const selected = await client.query(
            `SELECT id, nominal
             FROM catalog_products
             WHERE ${filters.join(" AND ")}
             ORDER BY nominal ASC, id ASC`,
            params
        );

        const hasNominalUpdate = nominalStart !== null && nominalStep !== null;
        const hasSellingUpdate = hargaJualMode === "set" || hargaJualMode === "clear";
        let updatedCount = 0;

        for (let index = 0; index < selected.rows.length; index++) {
            const row = selected.rows[index];
            const nextNominal = hasNominalUpdate
                ? nominalStart + (index * nominalStep)
                : Number(row.nominal);
            const nextHargaJual = hargaJualMode === "set"
                ? hargaJual
                : hargaJualMode === "clear"
                    ? null
                    : undefined;

            if (hasSellingUpdate) {
                await client.query(
                    `UPDATE catalog_products
                     SET nominal = $1, harga_jual = $2, updated_at = NOW()
                     WHERE id = $3`,
                    [nextNominal, nextHargaJual, row.id]
                );
            } else if (hasNominalUpdate) {
                await client.query(
                    `UPDATE catalog_products
                     SET nominal = $1, updated_at = NOW()
                     WHERE id = $2`,
                    [nextNominal, row.id]
                );
            }
            updatedCount++;
        }

        await client.query("COMMIT");
        return { updatedCount };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    initDB,
    tambahReseller,
    tambahResellerLengkap,
    simpanSpreadsheetId,
    getAllResellersWithSpreadsheet,
    getResellerByPassword,
    getResellerByUsername,
    ubahPasswordReseller,
    getResellerById,
    getAllResellers,
    topupSaldo,
    kurangSaldo,
    potongSaldo,
    kembalikanSaldo,
    hapusReseller,
    saveRekapUser,
    getRekapChatId,
    getCatalogProducts,
    seedCatalogProducts,
    getNextCatalogNominal,
    createCatalogProduct,
    updateCatalogProduct,
    deactivateCatalogProduct,
    bulkUpdateCatalogProducts
};
