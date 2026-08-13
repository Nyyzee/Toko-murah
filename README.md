# Telegram DANA Bot — DANA + Rekap + Dashboard Produk

Project ini sudah menggabungkan bot top-up, fungsi rekap, dan dashboard produk ke
**satu service Node.js**.
Bot rekap Python terpisah tidak diperlukan. PostgreSQL dipakai untuk saldo reseller,
data reseller, mapping username Telegram, serta katalog produk.

## Dashboard produk

Buka alamat berikut setelah service aktif:

```text
https://DOMAIN_HELIPOD/dashboard
```

Dashboard dibuat untuk penggunaan HP dan dapat digunakan untuk:

- menambah produk baru;
- mengubah nama, kode provider, kategori, harga modal, dan harga jual;
- menonaktifkan produk tanpa menghapus data dari database;
- mencari produk berdasarkan nama, kode, atau kategori.

Setiap perubahan langsung disimpan ke tabel `catalog_products` PostgreSQL dan
langsung dipakai bot. Jika kolom **Harga jual** dikosongkan, bot memakai aturan
markup bawaan berdasarkan kategorinya. Untuk produk baru, **Kode produk provider**
harus sama persis dengan kode yang diterima TokoVoucher atau provider terkait.

## Notifikasi grup admin

Isi `REKAP_GROUP_ID`. Informasi pendaftaran reseller dan transaksi sukses dikirim
ke grup tersebut:

- Pendaftaran Join Reseller baru
- Tombol Terima/Tolak pendaftaran
- Transaksi top-up sukses
- Transaksi sosial media sukses

Notifikasi transaksi pending dan gagal tidak dikirim ke grup. Pesan status pending,
gagal, dan pengembalian saldo tetap dikirim langsung ke customer melalui private chat.

Bot harus sudah masuk ke grup dan boleh mengirim pesan. `REKAP_GROUP_ID` biasanya
berbentuk `-100xxxxxxxxxx`. Tidak ada fallback notifikasi ke chat owner, sehingga
konfigurasi grup wajib benar.

## Command owner/admin

Semua command berikut dapat dijalankan di grup oleh akun dengan `OWNER_CHAT_ID`.
Gunakan `@username_bot` jika Telegram menampilkan command dengan nama bot.

```text
/tambah_reseller [password] [nama] [saldo_awal]
/ubah_password_reseller [id] [password_baru]
/topup_saldo [id] [jumlah]
/kurang_saldo [id] [jumlah]
/lihat_reseller
/info_reseller [id]
/hapus_reseller [id]
/rekap
/rekap [nama]
/list
/hapus [nama]
/kirimrekap
```

Contoh:

```text
/tambah_reseller Dodi12345 Dodi 100000
/topup_saldo 1 50000
/rekap Dodi
/hapus Dodi
```

`/kirimrekap` meminta username target, lalu owner memilih nama reseller dari
tombol yang muncul. Target harus sudah pernah mengirim `/start` ke bot.

Tombol `Terima` dan `Tolak` Join Reseller juga hanya dapat diproses oleh owner,
meskipun tombol tersebut berada di grup.

## Bantuan customer

Customer hanya melihat panduan customer saat menekan `/help`. Daftar perintah
administrator tidak ditampilkan di `/help` customer.

## Environment variables

### Wajib

```env
BOT_TOKEN=
OWNER_CHAT_ID=
REKAP_GROUP_ID=
MEMBER_CODE=
SECRET_KEY=
DATABASE_URL=
GOOGLE_SERVICE_ACCOUNT_JSON=
DASHBOARD_KEY=
```

`GOOGLE_SERVICE_ACCOUNT_JSON` dapat diganti dengan upload file service account:

```env
GOOGLE_SERVICE_ACCOUNT_FILE=google-service-account.json
```

Service account Google harus diberi akses **Editor** ke spreadsheet rekap.

### Dibutuhkan sesuai fitur

```env
# Join Reseller
DANA_QR_STRING=

# Bantuan Admin AI
OPENROUTER_API_KEY=
# AI_MODEL=google/gemini-2.5-flash

# Booster Sosial Media
KEDAI_API_ID=
KEDAI_API_KEY=
KEDAI_SERVICE_ID=65481
KEDAI_VIEW_SERVICE_ID=63704
KEDAI_LIKES_SERVICE_ID=69348
```

### Opsional

```env
# Default sudah benar untuk endpoint TokoVoucher resmi
# API_BASE_URL=https://api.tokovoucher.net

# Harga fallback sosial media sebelum sinkronisasi API
# KEDAI_PRICE_PER_1K=67791
# KEDAI_VIEW_PRICE_PER_1K=67791
# KEDAI_LIKES_PRICE_PER_1K=67791
```

Tidak perlu menambahkan `PASSWORDS`, `SESSION_SECRET`, atau variable untuk bot
rekap kedua. `DASHBOARD_KEY` adalah kunci baru untuk dashboard produk; buat nilai
acak yang panjang dan jangan dibagikan. `PORT` akan memakai variable dari platform
dan default `3000`.

## Google Sheets

Transaksi sukses tetap disimpan langsung ke Google Sheets melalui `rekap.js`.
Mapping spreadsheet reseller yang tersedia berada di source `rekap.js`. Jika nama
reseller tidak ada di mapping tersebut, transaksi tetap bisa diproses tetapi tidak
memiliki spreadsheet tujuan sampai mapping ditambahkan.

## Integrasi helipod.io tanpa terminal

1. Buat satu service Node.js dari isi folder project ini.
2. Hubungkan service tersebut ke PostgreSQL helipod.io. Pastikan variable
   `DATABASE_URL` otomatis tersedia dari koneksi Database.
3. Di bagian **Variables**, isi variable lama sesuai konfigurasi bot, lalu tambahkan
   `DASHBOARD_KEY` dengan kunci rahasia buatan Anda.
4. Di bagian **Service**, gunakan file `package.json` project ini. Service memakai
   script `npm start`; tidak perlu membuat service dashboard terpisah.
5. Jalankan atau restart service dari tombol layanan. Saat bot menyala, tabel
   `catalog_products` dibuat otomatis dan produk bawaan disalin ke database.
6. Buka `https://DOMAIN_HELIPOD/dashboard`, masukkan `DASHBOARD_KEY`, lalu coba
   ubah satu produk. Perubahan dapat dicek di Database pada tabel
   `catalog_products`.
7. Untuk webhook TokoVoucher, tetap gunakan:
   `https://DOMAIN_HELIPOD/webhook`.

## Deployment Helipod

- Service: satu service Node.js ini saja, termasuk dashboard
- Database: PostgreSQL Helipod
- Start command: `npm start`
- Port aplikasi: `3000` atau `$PORT`
- CPU awal yang disarankan: **0.25 vCPU**
- RAM awal yang disarankan: **256 MB**
- Naikkan ke **0.5 vCPU / 512 MB** jika traffic tinggi, banyak transaksi bersamaan,
  atau request AI sering berjalan bersamaan
- Tidak perlu service rekap kedua dan tidak perlu TCP publik; yang perlu dapat
  diakses publik hanya endpoint HTTP `/webhook`

Untuk mengurangi risiko biaya, mulai dari 0.25 vCPU dan 256 MB. Pemakaian terbesar
berasal dari proses Node, koneksi API, dan AI; PostgreSQL dikelola sebagai service
database terpisah.

## Webhook TokoVoucher

Set URL callback TokoVoucher ke:

```text
https://DOMAIN_HELIPOD/webhook
```

Server juga menyediakan `GET /` yang mengembalikan `Bot aktif.` untuk pengecekan
dasar service.
