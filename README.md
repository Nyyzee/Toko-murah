# Browser Digital Store

Service ini sekarang berjalan sebagai aplikasi browser. Customer tidak lagi
memesan lewat Telegram atau command bot.

## Alur customer

1. Customer membuka URL hasil deploy.
2. Customer mendaftar atau login dengan username dan password.
3. Customer memilih grup, kategori, operator, jenis produk, dan varian.
4. Customer mengisi data tujuan lalu mengirim order.
5. Harga dipotong dari saldo customer. Status transaksi diperbarui dari
   response/webhook provider.
6. Customer membuat deposit dari halaman browser. QRIS dinamis tampil di layar.

## Alur admin

- Buka URL yang sama lalu pilih **Masuk sebagai admin**.
- Masukkan `DASHBOARD_KEY`.
- Lihat customer, saldo, deposit, transaksi, dan jumlah produk aktif.
- Setujui atau tolak deposit dari dashboard.
- Bot Telegram hanya mengirim notifikasi deposit ke grup admin dan menyediakan
  tombol setujui/tolak. Tidak ada handler order atau command Telegram.
- Tombol **Sinkronkan produk API** menghapus status aktif katalog lama lalu
  memasukkan katalog terbaru ke PostgreSQL. Produk tidak disimpan hardcoded di
  source.

## Variables saat deploy

Wajib:

- `BOT_TOKEN`
- `OWNER_CHAT_ID` — Telegram user ID admin utama yang boleh menekan tombol deposit
- `REKAP_GROUP_ID` — grup Telegram tujuan notifikasi deposit
- `DATABASE_URL`
- `SESSION_SECRET` — nilai acak panjang untuk cookie login browser
- `DASHBOARD_KEY`
- `DANA_QR_STRING`

Untuk provider transaksi dan katalog TokoVoucher:

- `MEMBER_CODE`
- `SECRET_KEY`
- `API_BASE_URL` (opsional, default `https://api.tokovoucher.net`)

Jika katalog akan diambil dari API lain, isi:

- `PRODUCT_API_URL`
- `PRODUCT_API_KEY` (opsional)

Jika response API tidak memberikan harga jual, service memakai:

- `DEFAULT_PRODUCT_MARKUP` (opsional, default `2500`)

Isi semua contoh variable pada `.env.example` melalui Variables service.
Tidak perlu menjalankan command Telegram, membuat produk manual, atau mengedit
file setelah deploy.

## Provider webhook

Arahkan callback status transaksi provider ke:

```text
https://URL-DEPLOY-ANDA/webhook
```

Webhook menggunakan signature `md5(MEMBER_CODE:SECRET_KEY:ref_id)`, sama dengan
signature transaksi provider. Transaksi yang gagal otomatis mengembalikan saldo
customer.

## Menjalankan service

Script deploy menggunakan:

```text
pnpm start
```

Service membaca `PORT` dari environment Replit dan bind ke `0.0.0.0`.
