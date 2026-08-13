// =========================================
// DATABASE — PostgreSQL
// Customer, saldo, deposit, transaksi, katalog produk, sync config, app settings.
// =========================================

const { Pool } = require("pg");
const { DATABASE_URL } = require("./config");

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false
});

async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS resellers (
            id         SERIAL PRIMARY KEY,
            nama       VARCHAR(100) NOT NULL,
            password   VARCHAR(200) UNIQUE NOT NULL,
            saldo      BIGINT NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    `);

    const resellerColumns = [
        `ALTER TABLE resellers ADD COLUMN IF NOT EXISTS telegram_id   BIGINT`,
        `ALTER TABLE resellers ADD COLUMN IF NOT EXISTS chat_id       BIGINT`,
        `ALTER TABLE resellers ADD COLUMN IF NOT EXISTS username      VARCHAR(100)`,
        `ALTER TABLE resellers ADD COLUMN IF NOT EXISTS first_name    VARCHAR(100)`,
        `ALTER TABLE resellers ADD COLUMN IF NOT EXISTS last_name     VARCHAR(100)`,
        `ALTER TABLE resellers ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ`,
        `ALTER TABLE resellers ADD COLUMN IF NOT EXISTS spreadsheet_id VARCHAR(200)`,
        `ALTER TABLE resellers ADD COLUMN IF NOT EXISTS avatar_url TEXT`
    ];
    for (const sql of resellerColumns) await pool.query(sql);
    await pool.query(`ALTER TABLE resellers DROP CONSTRAINT IF EXISTS resellers_password_key`);

    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS resellers_username_lower_idx
        ON resellers (LOWER(username))
        WHERE username IS NOT NULL;
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS catalog_products (
            id             SERIAL PRIMARY KEY,
            kode           VARCHAR(120) UNIQUE NOT NULL,
            kategori_id    VARCHAR(100) NOT NULL,
            label          VARCHAR(200) NOT NULL,
            nominal        BIGINT NOT NULL DEFAULT 0 CHECK (nominal >= 0),
            harga_jual     BIGINT CHECK (harga_jual IS NULL OR harga_jual >= 0),
            metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
            active         BOOLEAN NOT NULL DEFAULT TRUE,
            created_at     TIMESTAMPTZ DEFAULT NOW(),
            updated_at     TIMESTAMPTZ DEFAULT NOW()
        );
    `);

    const catalogColumns = [
        `ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS group_id VARCHAR(100) NOT NULL DEFAULT 'lainnya'`,
        `ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS kategori_label VARCHAR(160) NOT NULL DEFAULT ''`,
        `ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS operator VARCHAR(160) NOT NULL DEFAULT ''`,
        `ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS jenis_produk VARCHAR(160) NOT NULL DEFAULT ''`
    ];
    for (const sql of catalogColumns) await pool.query(sql);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS catalog_products_browse_idx
        ON catalog_products (group_id, kategori_id, operator, jenis_produk, active);
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS deposit_requests (
            id             SERIAL PRIMARY KEY,
            customer_id    INTEGER NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
            amount         BIGINT NOT NULL CHECK (amount > 0),
            request_ref    VARCHAR(120) UNIQUE NOT NULL,
            status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'rejected')),
            admin_note     VARCHAR(500),
            created_at     TIMESTAMPTZ DEFAULT NOW(),
            decided_at     TIMESTAMPTZ
        );
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS deposit_requests_customer_idx
        ON deposit_requests (customer_id, created_at DESC);
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS web_transactions (
            id             SERIAL PRIMARY KEY,
            customer_id    INTEGER NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
            request_ref    VARCHAR(120) UNIQUE NOT NULL,
            product_code   VARCHAR(120) NOT NULL,
            product_label  VARCHAR(200) NOT NULL,
            kategori_id    VARCHAR(100) NOT NULL,
            kategori_label VARCHAR(160) NOT NULL,
            operator       VARCHAR(160) NOT NULL DEFAULT '',
            jenis_produk   VARCHAR(160) NOT NULL DEFAULT '',
            target_data    JSONB NOT NULL DEFAULT '{}'::jsonb,
            amount         BIGINT NOT NULL CHECK (amount >= 0),
            status         VARCHAR(20) NOT NULL DEFAULT 'processing'
                           CHECK (status IN ('processing', 'success', 'failed')),
            provider_ref   VARCHAR(160),
            provider_data  JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at     TIMESTAMPTZ DEFAULT NOW(),
            updated_at     TIMESTAMPTZ DEFAULT NOW()
        );
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS web_transactions_customer_idx
        ON web_transactions (customer_id, created_at DESC);
    `);

    // Tabel untuk pengaturan aplikasi (markup persen, dll.)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS app_settings (
            key        VARCHAR(100) PRIMARY KEY,
            value      TEXT NOT NULL DEFAULT '',
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
    `);

    // Tabel untuk konfigurasi sinkronisasi produk
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sync_config (
            id           SERIAL PRIMARY KEY,
            kategori_id  VARCHAR(100) NOT NULL,
            kategori_label VARCHAR(160) NOT NULL DEFAULT '',
            operator     VARCHAR(160) NOT NULL DEFAULT '',
            jenis_produk VARCHAR(160) NOT NULL DEFAULT '',
            created_at   TIMESTAMPTZ DEFAULT NOW()
        );
    `);

    console.log("[DB] Customer, saldo, deposit, transaksi, katalog, sinkronisasi, dan pengaturan siap.");
}

function normalizeUsername(username) {
    return String(username || "").replace(/^@/, "").trim().toLowerCase();
}

function safeCustomer(row) {
    if (!row) return null;
    return {
        id: Number(row.id),
        username: row.username || row.nama,
        nama: row.nama,
        saldo: Number(row.saldo || 0),
        avatarUrl: row.avatar_url || "",
        createdAt: row.created_at
    };
}

async function authenticateCustomer(username, password) {
    const normalized = normalizeUsername(username);
    if (!normalized || !password) return null;
    const result = await pool.query(
        `SELECT * FROM resellers
         WHERE (LOWER(username) = $1 OR (username IS NULL AND LOWER(nama) = $1))
           AND password = $2
         LIMIT 1`,
        [normalized, String(password)]
    );
    return safeCustomer(result.rows[0]);
}

async function createCustomer(username, password) {
    const normalized = normalizeUsername(username);
    if (!/^[a-z0-9._-]{3,100}$/.test(normalized)) {
        throw new Error("Username harus 3-100 karakter dan hanya boleh berisi huruf, angka, titik, garis bawah, atau strip.");
    }
    if (String(password || "").length < 6) {
        throw new Error("Password minimal 6 karakter.");
    }
    const result = await pool.query(
        `INSERT INTO resellers (nama, username, password, saldo, registered_at)
         VALUES ($1, $1, $2, 0, NOW())
         RETURNING *`,
        [normalized, String(password)]
    );
    return safeCustomer(result.rows[0]);
}

async function getCustomerById(id) {
    const result = await pool.query(`SELECT * FROM resellers WHERE id = $1`, [id]);
    return safeCustomer(result.rows[0]);
}

async function getAllCustomers() {
    const result = await pool.query(`
        SELECT
            r.id, COALESCE(r.username, r.nama) AS username, r.nama, r.saldo, r.created_at,
            COALESCE(d.total_deposit, 0) AS total_deposit,
            COALESCE(t.total_transaksi, 0) AS total_transaksi
        FROM resellers r
        LEFT JOIN (
            SELECT customer_id, SUM(amount) AS total_deposit
            FROM deposit_requests
            WHERE status = 'approved'
            GROUP BY customer_id
        ) d ON d.customer_id = r.id
        LEFT JOIN (
            SELECT customer_id, COUNT(*) AS total_transaksi
            FROM web_transactions
            GROUP BY customer_id
        ) t ON t.customer_id = r.id
        ORDER BY r.id DESC
    `);
    return result.rows.map(row => ({
        id: Number(row.id),
        username: row.username,
        nama: row.nama,
        saldo: Number(row.saldo || 0),
        totalDeposit: Number(row.total_deposit || 0),
        totalTransaksi: Number(row.total_transaksi || 0),
        createdAt: row.created_at
    }));
}

async function updateCustomer(id, data) {
    const fields = [];
    const values = [];
    let idx = 1;

    if (data.password !== undefined && data.password !== null && data.password !== "") {
        if (String(data.password).length < 6) throw new Error("Password minimal 6 karakter.");
        fields.push(`password = $${idx++}`);
        values.push(String(data.password));
    }
    if (data.avatarUrl !== undefined) {
        const avatarUrl = String(data.avatarUrl || "");
        if (avatarUrl && !/^data:image\/(jpeg|jpg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(avatarUrl)) {
            throw new Error("Format foto profil tidak valid.");
        }
        if (avatarUrl.length > 450000) {
            throw new Error("Ukuran foto profil terlalu besar. Pilih foto yang lebih kecil.");
        }
        fields.push(`avatar_url = $${idx++}`);
        values.push(avatarUrl);
    }
    if (data.username !== undefined && data.username !== null) {
        const username = normalizeUsername(data.username);
        if (!/^[a-z0-9._-]{3,100}$/.test(username)) {
            throw new Error("Username harus 3-100 karakter dan hanya boleh berisi huruf, angka, titik, garis bawah, atau strip.");
        }
        fields.push(`username = $${idx++}`);
        values.push(username);
        fields.push(`nama = $${idx++}`);
        values.push(String(data.nama || username).trim().slice(0, 100));
    } else if (data.nama !== undefined && data.nama !== null) {
        const nama = String(data.nama).trim().slice(0, 100);
        if (!nama) throw new Error("Nama tidak boleh kosong.");
        fields.push(`nama = $${idx++}`);
        values.push(nama);
    }
    if (data.saldo !== undefined && data.saldo !== null) {
        const saldo = Number(data.saldo);
        if (!Number.isSafeInteger(saldo) || saldo < 0) throw new Error("Saldo tidak valid.");
        fields.push(`saldo = $${idx++}`);
        values.push(saldo);
    }

    if (fields.length === 0) throw new Error("Tidak ada data yang diubah.");
    values.push(id);
    const result = await pool.query(
        `UPDATE resellers SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
        values
    );
    return safeCustomer(result.rows[0]);
}

async function adjustCustomerSaldo(id, amount, operation = "add") {
    const num = Number(amount);
    if (!Number.isSafeInteger(num) || num <= 0) throw new Error("Jumlah harus lebih dari 0.");
    const sql = operation === "subtract"
        ? `UPDATE resellers SET saldo = GREATEST(0, saldo - $1) WHERE id = $2 RETURNING *`
        : `UPDATE resellers SET saldo = saldo + $1 WHERE id = $2 RETURNING *`;
    const result = await pool.query(sql, [num, id]);
    if (!result.rows[0]) throw new Error("Customer tidak ditemukan.");
    return safeCustomer(result.rows[0]);
}

async function deleteCustomer(id) {
    const result = await pool.query(
        `DELETE FROM resellers WHERE id = $1 RETURNING id`,
        [id]
    );
    return result.rows[0] ? true : false;
}

async function topupSaldo(id, amount) {
    const result = await pool.query(
        `UPDATE resellers SET saldo = saldo + $1 WHERE id = $2 RETURNING *`,
        [amount, id]
    );
    return safeCustomer(result.rows[0]);
}

async function createDepositRequest(customerId, amount, requestRef) {
    const result = await pool.query(
        `INSERT INTO deposit_requests (customer_id, amount, request_ref)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [customerId, amount, requestRef]
    );
    return result.rows[0];
}

async function getCustomerDeposits(customerId) {
    const result = await pool.query(
        `SELECT id, amount, request_ref, status, admin_note, created_at, decided_at
         FROM deposit_requests
         WHERE customer_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [customerId]
    );
    return result.rows.map(row => ({
        id: Number(row.id),
        amount: Number(row.amount),
        requestRef: row.request_ref,
        status: row.status,
        adminNote: row.admin_note,
        createdAt: row.created_at,
        decidedAt: row.decided_at
    }));
}

async function getAdminDeposits() {
    const result = await pool.query(`
        SELECT d.id, d.amount, d.request_ref, d.status, d.admin_note, d.created_at, d.decided_at,
               r.id AS customer_id, COALESCE(r.username, r.nama) AS username
        FROM deposit_requests d
        JOIN resellers r ON r.id = d.customer_id
        ORDER BY d.created_at DESC
        LIMIT 200
    `);
    return result.rows.map(row => ({
        id: Number(row.id),
        amount: Number(row.amount),
        requestRef: row.request_ref,
        status: row.status,
        adminNote: row.admin_note,
        customerId: Number(row.customer_id),
        username: row.username,
        createdAt: row.created_at,
        decidedAt: row.decided_at
    }));
}

async function decideDeposit(id, status, adminNote = "") {
    if (!["approved", "rejected"].includes(status)) {
        throw new Error("Status deposit tidak valid.");
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const locked = await client.query(
            `SELECT d.*, COALESCE(r.username, r.nama) AS username
             FROM deposit_requests d
             JOIN resellers r ON r.id = d.customer_id
             WHERE d.id = $1
             FOR UPDATE`,
            [id]
        );
        const deposit = locked.rows[0];
        if (!deposit) throw new Error("Deposit tidak ditemukan.");
        if (deposit.status !== "pending") {
            await client.query("COMMIT");
            return { ...deposit, alreadyDecided: true };
        }

        if (status === "approved") {
            await client.query(
                `UPDATE resellers SET saldo = saldo + $1 WHERE id = $2`,
                [deposit.amount, deposit.customer_id]
            );
        }
        const updated = await client.query(
            `UPDATE deposit_requests
             SET status = $1, admin_note = $2, decided_at = NOW()
             WHERE id = $3
             RETURNING *`,
            [status, String(adminNote || "").slice(0, 500), id]
        );
        const customer = await client.query(
            `SELECT id, COALESCE(username, nama) AS username, saldo
             FROM resellers WHERE id = $1`,
            [deposit.customer_id]
        );
        await client.query("COMMIT");
        return {
            ...updated.rows[0],
            username: deposit.username,
            saldo: Number(customer.rows[0]?.saldo || 0),
            alreadyDecided: false
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

async function createWebTransaction(order) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const customerResult = await client.query(
            `SELECT * FROM resellers WHERE id = $1 FOR UPDATE`,
            [order.customerId]
        );
        const customer = customerResult.rows[0];
        if (!customer) throw new Error("Customer tidak ditemukan.");
        if (Number(customer.saldo) < Number(order.amount)) {
            throw new Error(`Saldo tidak cukup. Saldo kamu Rp${Number(customer.saldo).toLocaleString("id-ID")}.`);
        }

        await client.query(
            `UPDATE resellers SET saldo = saldo - $1 WHERE id = $2`,
            [order.amount, order.customerId]
        );
        const result = await client.query(
            `INSERT INTO web_transactions
                (customer_id, request_ref, product_code, product_label, kategori_id,
                 kategori_label, operator, jenis_produk, target_data, amount, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, 'processing')
             RETURNING *`,
            [
                order.customerId,
                order.requestRef,
                order.productCode,
                order.productLabel,
                order.kategoriId,
                order.kategoriLabel,
                order.operator || "",
                order.jenisProduk || "",
                JSON.stringify(order.targetData || {}),
                order.amount
            ]
        );
        await client.query("COMMIT");
        return result.rows[0];
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

async function finishWebTransaction(requestRef, status, providerRef = null, providerData = {}) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const locked = await client.query(
            `SELECT * FROM web_transactions WHERE request_ref = $1 FOR UPDATE`,
            [requestRef]
        );
        const transaction = locked.rows[0];
        if (!transaction) throw new Error("Transaksi tidak ditemukan.");
        if (["success", "failed"].includes(transaction.status)) {
            await client.query("COMMIT");
            return transaction;
        }
        if (status === "failed") {
            await client.query(
                `UPDATE resellers SET saldo = saldo + $1 WHERE id = $2`,
                [transaction.amount, transaction.customer_id]
            );
        }
        const result = await client.query(
            `UPDATE web_transactions
             SET status = $1, provider_ref = $2, provider_data = $3::jsonb, updated_at = NOW()
             WHERE request_ref = $4
             RETURNING *`,
            [status, providerRef, JSON.stringify(providerData || {}), requestRef]
        );
        await client.query("COMMIT");
        return result.rows[0];
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

function publicTransaction(row) {
    return {
        id: Number(row.id),
        requestRef: row.request_ref,
        username: row.username,
        productCode: row.product_code,
        productLabel: row.product_label,
        kategoriId: row.kategori_id,
        kategoriLabel: row.kategori_label,
        operator: row.operator,
        jenisProduk: row.jenis_produk,
        targetData: row.target_data || {},
        amount: Number(row.amount),
        status: row.status,
        providerRef: row.provider_ref,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

async function getCustomerTransactions(customerId) {
    const result = await pool.query(
        `SELECT t.*, COALESCE(r.username, r.nama) AS username
         FROM web_transactions t
         JOIN resellers r ON r.id = t.customer_id
         WHERE t.customer_id = $1
         ORDER BY t.created_at DESC
         LIMIT 100`,
        [customerId]
    );
    return result.rows.map(publicTransaction);
}

async function getAdminTransactions() {
    const result = await pool.query(`
        SELECT t.*, COALESCE(r.username, r.nama) AS username
        FROM web_transactions t
        JOIN resellers r ON r.id = t.customer_id
        ORDER BY t.created_at DESC
        LIMIT 300
    `);
    return result.rows.map(publicTransaction);
}

async function getCatalogProducts(includeInactive = false) {
    const result = await pool.query(`
        SELECT id, kode, kategori_id, kategori_label, group_id, operator, jenis_produk,
               label, nominal, harga_jual, metadata, active, created_at, updated_at
        FROM catalog_products
        ${includeInactive ? "" : "WHERE active = TRUE"}
        ORDER BY group_id, kategori_label, operator, jenis_produk, nominal ASC, id
    `);
    return result.rows;
}

async function getCatalogProductByCode(code) {
    const result = await pool.query(
        `SELECT * FROM catalog_products WHERE kode = $1 AND active = TRUE LIMIT 1`,
        [code]
    );
    return result.rows[0] || null;
}

async function replaceCatalogProducts(products) {
    if (!Array.isArray(products) || products.length === 0) {
        throw new Error("API tidak mengembalikan produk aktif. Katalog lama tidak diubah.");
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        // Katalog aktif harus mencerminkan hasil filter sinkronisasi saat ini.
        // Produk di luar pilihan admin dinonaktifkan, bukan ikut tampil di customer.
        await client.query(
            `UPDATE catalog_products SET active = FALSE, updated_at = NOW()`
        );
        for (const product of products) {
            await client.query(
                `INSERT INTO catalog_products
                    (kode, kategori_id, kategori_label, group_id, operator, jenis_produk,
                     label, nominal, harga_jual, metadata, active, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, TRUE, NOW())
                 ON CONFLICT (kode) DO UPDATE SET
                    kategori_id = EXCLUDED.kategori_id,
                    kategori_label = EXCLUDED.kategori_label,
                    group_id = EXCLUDED.group_id,
                    operator = EXCLUDED.operator,
                    jenis_produk = EXCLUDED.jenis_produk,
                    label = EXCLUDED.label,
                    nominal = EXCLUDED.nominal,
                    metadata = EXCLUDED.metadata,
                    active = TRUE,
                    updated_at = NOW()`,
                [
                    product.kode,
                    product.kategoriId,
                    product.kategoriLabel,
                    product.groupId,
                    product.operator,
                    product.jenisProduk,
                    product.label,
                    product.nominal,
                    product.hargaJual ?? null,
                    JSON.stringify(product.metadata || {})
                ]
            );
        }
        await client.query("COMMIT");
        return { imported: products.length };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

// =========================================
// CRUD PRODUK MANUAL
// =========================================

async function createCatalogProduct(product) {
    const result = await pool.query(
        `INSERT INTO catalog_products
            (kode, kategori_id, kategori_label, group_id, operator, jenis_produk,
             label, nominal, harga_jual, metadata, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb, TRUE)
         RETURNING *`,
        [
            product.kode,
            product.kategoriId || "lainnya",
            product.kategoriLabel || product.kategoriId || "Lainnya",
            product.groupId || "lainnya",
            product.operator || "",
            product.jenisProduk || "",
            product.label,
            product.nominal,
            product.hargaJual ?? null
        ]
    );
    return result.rows[0];
}

async function updateCatalogProduct(id, product) {
    const result = await pool.query(
        `UPDATE catalog_products SET
            kode = $1, kategori_id = $2, kategori_label = $3, group_id = $4,
            operator = $5, jenis_produk = $6, label = $7,
            nominal = $8, harga_jual = $9, active = $10, updated_at = NOW()
         WHERE id = $11
         RETURNING *`,
        [
            product.kode,
            product.kategoriId || "lainnya",
            product.kategoriLabel || product.kategoriId || "Lainnya",
            product.groupId || "lainnya",
            product.operator || "",
            product.jenisProduk || "",
            product.label,
            product.nominal,
            product.hargaJual ?? null,
            product.active !== false,
            id
        ]
    );
    return result.rows[0] || null;
}

async function deactivateCatalogProduct(id) {
    const result = await pool.query(
        `UPDATE catalog_products SET active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id]
    );
    return result.rows[0] || null;
}

async function deleteCatalogProduct(id) {
    const result = await pool.query(
        `DELETE FROM catalog_products WHERE id = $1 RETURNING id`,
        [id]
    );
    return result.rows[0] ? true : false;
}

async function bulkUpdateCatalogProducts(bulk) {
    const conditions = [];
    const values = [];
    let idx = 1;

    if (bulk.kategoriId) {
        conditions.push(`kategori_id = $${idx++}`);
        values.push(bulk.kategoriId);
    }
    if (bulk.namaContains) {
        conditions.push(`label ILIKE $${idx++}`);
        values.push(`%${bulk.namaContains}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const setClauses = [];
    if (bulk.hargaJualMode === "set") {
        setClauses.push(`harga_jual = $${idx++}`);
        values.push(bulk.hargaJual);
    } else if (bulk.hargaJualMode === "clear") {
        setClauses.push(`harga_jual = NULL`);
    }
    setClauses.push("updated_at = NOW()");

    const result = await pool.query(
        `UPDATE catalog_products SET ${setClauses.join(", ")} ${where} RETURNING id`,
        values
    );
    return { updatedCount: result.rowCount };
}

async function getNextCatalogNominal(kategoriId, step) {
    const result = await pool.query(
        `SELECT COALESCE(MAX(nominal), 0) AS max_nominal
         FROM catalog_products WHERE kategori_id = $1`,
        [kategoriId]
    );
    return Number(result.rows[0].max_nominal || 0) + step;
}

// =========================================
// APP SETTINGS (markup persen, dll.)
// =========================================

async function getAppSetting(key) {
    const result = await pool.query(
        `SELECT value FROM app_settings WHERE key = $1`,
        [key]
    );
    return result.rows[0]?.value ?? null;
}

async function setAppSetting(key, value) {
    await pool.query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, String(value)]
    );
}

async function getMarkupPersen() {
    const val = await getAppSetting("markup_persen");
    return val !== null ? Number(val) : 0;
}

const PROFILE_SETTING_KEYS = ["store_name", "store_tagline", "store_contact"];

async function getStoreProfile() {
    const values = await Promise.all(
        PROFILE_SETTING_KEYS.map(key => getAppSetting(key))
    );
    return {
        name: values[0] || "Toko Murah",
        tagline: values[1] || "Beli pulsa, paket data, e-wallet & produk digital",
        contact: values[2] || ""
    };
}

async function saveStoreProfile(profile = {}) {
    const name = String(profile.name || "").trim().slice(0, 80);
    const tagline = String(profile.tagline || "").trim().slice(0, 160);
    const contact = String(profile.contact || "").trim().slice(0, 160);
    if (!name) throw new Error("Nama toko tidak boleh kosong.");
    await Promise.all([
        setAppSetting("store_name", name),
        setAppSetting("store_tagline", tagline),
        setAppSetting("store_contact", contact)
    ]);
    return { name, tagline, contact };
}

// =========================================
// SYNC CONFIG
// =========================================

async function getSyncConfig() {
    const result = await pool.query(
        `SELECT id, kategori_id, kategori_label, operator, jenis_produk
         FROM sync_config ORDER BY id`
    );
    return result.rows.map(row => ({
        id: Number(row.id),
        kategoriId: row.kategori_id,
        kategoriLabel: row.kategori_label,
        operator: row.operator,
        jenisProduk: row.jenis_produk
    }));
}

async function saveSyncConfig(rules) {
    // rules = [{ kategoriId, kategoriLabel, operator, jenisProduk }, ...]
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query(`DELETE FROM sync_config`);
        for (const rule of rules) {
            await client.query(
                `INSERT INTO sync_config (kategori_id, kategori_label, operator, jenis_produk)
                 VALUES ($1, $2, $3, $4)`,
                [
                    rule.kategoriId || "",
                    rule.kategoriLabel || "",
                    rule.operator || "",
                    rule.jenisProduk || ""
                ]
            );
        }
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

async function getAdminSummary() {
    const result = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM resellers) AS customers,
          (SELECT COALESCE(SUM(saldo), 0) FROM resellers) AS balance,
          (SELECT COUNT(*) FROM web_transactions) AS transactions,
          (SELECT COUNT(*) FROM deposit_requests WHERE status = 'pending') AS pending_deposits,
          (SELECT COUNT(*) FROM catalog_products WHERE active = TRUE) AS products
    `);
    const row = result.rows[0];
    return {
        customers: Number(row.customers || 0),
        balance: Number(row.balance || 0),
        transactions: Number(row.transactions || 0),
        pendingDeposits: Number(row.pending_deposits || 0),
        products: Number(row.products || 0)
    };
}

module.exports = {
    initDB,
    authenticateCustomer,
    createCustomer,
    getCustomerById,
    getAllCustomers,
    updateCustomer,
    adjustCustomerSaldo,
    deleteCustomer,
    topupSaldo,
    createDepositRequest,
    getCustomerDeposits,
    getAdminDeposits,
    decideDeposit,
    createWebTransaction,
    finishWebTransaction,
    getCustomerTransactions,
    getAdminTransactions,
    getCatalogProducts,
    getCatalogProductByCode,
    replaceCatalogProducts,
    createCatalogProduct,
    updateCatalogProduct,
    deactivateCatalogProduct,
    deleteCatalogProduct,
    bulkUpdateCatalogProducts,
    getNextCatalogNominal,
    getAppSetting,
    setAppSetting,
    getMarkupPersen,
    getStoreProfile,
    saveStoreProfile,
    getSyncConfig,
    saveSyncConfig,
    getAdminSummary
};
