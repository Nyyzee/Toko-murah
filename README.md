# Browser Digital Store

Service ini berjalan sebagai aplikasi browser. Customer mendaftar, login,
memilih produk, melakukan order, dan mengajukan deposit dari halaman web.

## Alur customer

1. Customer membuka URL hasil deploy.
2. Customer mendaftar atau login dengan username dan password.
3. Customer memilih kategori, operator, jenis produk, dan nominal.
4. Customer mengisi data tujuan lalu mengirim order.
5. Harga dipotong dari saldo customer. Status transaksi diperbarui dari
   response/webhook provider.
6. Customer membuat deposit dari halaman browser. QRIS dinamis tampil di layar.

## Alur admin

- Buka URL yang sama lalu pilih **Login Admin**.
- Akses admin melalui URL khusus: `https://URL-DEPLOY-ANDA/admin`.
- Tombol login admin tidak ditampilkan di halaman customer utama (`/`).
- Masukkan `DASHBOARD_KEY`.
- Kelola customer, saldo, deposit, transaksi, dan produk dari dashboard.
- Setujui atau tolak deposit dari dashboard atau tombol notifikasi Telegram.
- Notifikasi deposit dikirim langsung ke `OWNER_CHAT_ID`.
- Atur filter sinkronisasi melalui alur **Kategori → Operator → Jenis Produk**.
- Konfigurasi sinkronisasi dan markup keuntungan disimpan di PostgreSQL.
- Profil toko dapat diubah dari **Admin → Pengaturan**. Login admin tetap memakai
  `DASHBOARD_KEY`.
- Customer dapat mengubah username, nama tampilan, dan password dari tombol
  **Profil** setelah login.
- Sistem tidak melakukan sinkronisasi otomatis sebelum admin menyimpan pilihan.
- Saat sinkronisasi dijalankan, hanya produk yang sesuai pilihan yang disimpan
  sebagai produk aktif.

## Command Telegram

Command hanya merespons `OWNER_CHAT_ID`:

- `/start` atau `/help` — menampilkan bantuan bot.
- `/status` — menampilkan jumlah customer, produk aktif, transaksi, dan deposit
  yang masih pending.

Notifikasi deposit juga tetap memiliki tombol `SETUJUI` dan `TOLAK`. Label teks
ditampilkan bersama emoji agar tetap terbaca pada client Telegram yang tidak
merender emoji.

## Variables saat deploy

Wajib:

- `BOT_TOKEN`
- `OWNER_CHAT_ID` — Telegram user/chat ID admin untuk notifikasi deposit
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

Jika response API tidak memberikan harga jual, service memakai markup flat:

- `DEFAULT_PRODUCT_MARKUP` (opsional, default `2500`)

Markup persentase produk dapat diatur dari menu **Pengaturan** di dashboard
admin dan disimpan di database.

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
