// =========================================
// DAFTAR PRODUK PER KATEGORI
// Kode produk sesuai TokoVoucher
// Harga (nominal) FF & ML otomatis sync dari API —
// lihat fungsi syncHargaDariAPI() di bawah
// =========================================

// =========================================
// KEDAISOSMED CONFIG
// Ubah via Railway Variables, bukan di sini
// =========================================

const KEDAI_SERVICE_ID       = process.env.KEDAI_SERVICE_ID        || "65481";  // Followers TikTok
const KEDAI_VIEW_SERVICE_ID  = process.env.KEDAI_VIEW_SERVICE_ID   || "63704";  // View TikTok
const KEDAI_LIKES_SERVICE_ID = process.env.KEDAI_LIKES_SERVICE_ID  || "69348";  // Likes TikTok
const SOSMED_PROFIT          = 5000; // keuntungan flat per order sosmed
const DATA_PROFIT            = 2500; // keuntungan flat per order paket data

// Harga fallback (dipakai sebelum sync dari API berhasil)
// Bisa diisi di Railway: KEDAI_PRICE_PER_1K — opsional
let currentPricePerK      = parseInt(process.env.KEDAI_PRICE_PER_1K       || "67791", 10);
let currentViewPricePerK  = parseInt(process.env.KEDAI_VIEW_PRICE_PER_1K  || "67791", 10);
let currentLikesPricePerK = parseInt(process.env.KEDAI_LIKES_PRICE_PER_1K || "67791", 10);

const {
    getCatalogProducts,
    seedCatalogProducts
} = require("./db");

// =========================================
// GENERATE PRODUK SOSMED (Followers / View / Likes)
// 100 paket: 100, 200, 300, ..., 10.000
// prefix  : digunakan sebagai kode internal
// label   : nama satuan (mis. "Followers", "View", "Likes")
// =========================================

function generateTiktokSosmed(pricePerK, prefix, unitLabel) {
    const price    = pricePerK;
    const products = [];
    for (let qty = 100; qty <= 10000; qty += 100) {
        const modal = Math.ceil((price / 1000) * qty);
        products.push({
            label:    qty.toLocaleString("id-ID") + " " + unitLabel,
            kode:     `${prefix}-${qty}`,
            nominal:  modal,
            quantity: qty
        });
    }
    return products;
}

// Wrapper per produk (dipakai saat inisialisasi & re-sync)
function generateTiktokFollowers(pricePerK) {
    return generateTiktokSosmed(pricePerK || currentPricePerK, "tiktok-foll", "Foll");
}
function generateTiktokView(pricePerK) {
    return generateTiktokSosmed(pricePerK || currentViewPricePerK, "tiktok-view", "View");
}
function generateTiktokLikes(pricePerK) {
    return generateTiktokSosmed(pricePerK || currentLikesPricePerK, "tiktok-likes", "Like");
}

function makeCatalogProducts(rows) {
    return rows.trim().split("\n").map(row => {
        const [label, kode] = row.split("|");
        return { label: label.trim(), kode: kode.trim(), nominal: 0 };
    });
}

const categories = [
    {
        id:           "dana",
        label:        "DANA",
        emoji:        "\uD83D\uDCB5",  // 💵
        tujuanPrompt: "nomor DANA tujuan",
        tujuanLabel:  "Nomor DANA",
        isPLN:        false,
        products: [
            { label: "1.000",   kode: "dana-1000",   nominal: 1000   },
            { label: "2.000",   kode: "dana-2000",   nominal: 2000   },
            { label: "3.000",   kode: "dana-3000",   nominal: 3000   },
            { label: "4.000",   kode: "dana-4000",   nominal: 4000   },
            { label: "5.000",   kode: "dana-5000",   nominal: 5000   },
            { label: "6.000",   kode: "dana-6000",   nominal: 6000   },
            { label: "7.000",   kode: "dana-7000",   nominal: 7000   },
            { label: "8.000",   kode: "dana-8000",   nominal: 8000   },
            { label: "10.000",  kode: "dana-10000",  nominal: 10000  },
            { label: "15.000",  kode: "dana-15000",  nominal: 15000  },
            { label: "20.000",  kode: "dana-20000",  nominal: 20000  },
            { label: "25.000",  kode: "dana-25000",  nominal: 25000  },
            { label: "30.000",  kode: "dana-30000",  nominal: 30000  },
            { label: "50.000",  kode: "dana-50000",  nominal: 50000  },
            { label: "75.000",  kode: "dana-75000",  nominal: 75000  },
            { label: "100.000", kode: "dana-100000", nominal: 100000 },
            { label: "150.000", kode: "dana-150000", nominal: 150000 },
            { label: "175.000", kode: "dana-175000", nominal: 175000 },
            { label: "200.000", kode: "dana-200000", nominal: 200000 },
            { label: "250.000", kode: "dana-250000", nominal: 250000 },
            { label: "300.000", kode: "dana-300000", nominal: 300000 },
            { label: "350.000", kode: "dana-350000", nominal: 350000 },
            { label: "400.000", kode: "dana-400000", nominal: 400000 },
            { label: "500.000", kode: "dana-500000", nominal: 500000 },
            { label: "600.000", kode: "dana-600000", nominal: 600000 },
            { label: "700.000", kode: "dana-700000", nominal: 700000 },
            { label: "9.000", kode: "dana-9000", nominal: 9000 },
            { label: "11.000", kode: "dana-11000", nominal: 11000 },
            { label: "12.000", kode: "dana-12000", nominal: 12000 },
            { label: "13.000", kode: "dana-13000", nominal: 13000 },
            { label: "14.000", kode: "dana-14000", nominal: 14000 },
            { label: "16.000", kode: "dana-16000", nominal: 16000 },
            { label: "17.000", kode: "dana-17000", nominal: 17000 },
            { label: "18.000", kode: "dana-18000", nominal: 18000 },
            { label: "19.000", kode: "dana-19000", nominal: 19000 },
            { label: "35.000", kode: "dana-35000", nominal: 35000 },
            { label: "40.000", kode: "dana-40000", nominal: 40000 },
            { label: "45.000", kode: "dana-45000", nominal: 45000 },
            { label: "55.000", kode: "dana-55000", nominal: 55000 },
            { label: "60.000", kode: "dana-60000", nominal: 60000 },
            { label: "65.000", kode: "dana-65000", nominal: 65000 },
            { label: "70.000", kode: "dana-70000", nominal: 70000 },
            { label: "80.000", kode: "dana-80000", nominal: 80000 },
            { label: "85.000", kode: "dana-85000", nominal: 85000 },
            { label: "90.000", kode: "dana-90000", nominal: 90000 },
            { label: "95.000", kode: "dana-95000", nominal: 95000 },
            { label: "115.000", kode: "dana-115000", nominal: 115000 },
            { label: "125.000", kode: "dana-125000", nominal: 125000 },
            { label: "800.000", kode: "dana-800000", nominal: 800000 },
            { label: "900.000", kode: "dana-900000", nominal: 900000 },
            { label: "1.000.000", kode: "dana-1000000", nominal: 1000000 }

        ]
    },
    {
        id:           "gopay",
        label:        "GoPay",
        emoji:        "\uD83D\uDCB6",  // 💶
        tujuanPrompt: "nomor GoPay tujuan",
        tujuanLabel:  "Nomor GoPay",
        isPLN:        false,
        products: [
            { label: "10.000",    kode: "GOPAY10",   nominal: 10000   },
            { label: "15.000",    kode: "GOPAY15",   nominal: 15000   },
            { label: "20.000",    kode: "GOPAY20",   nominal: 20000   },
            { label: "25.000",    kode: "GOPAY25",   nominal: 25000   },
            { label: "30.000",    kode: "GOPAY30",   nominal: 30000   },
            { label: "35.000",    kode: "GOPAY35",   nominal: 35000   },
            { label: "40.000",    kode: "GOPAY40",   nominal: 40000   },
            { label: "45.000",    kode: "GOPAY45",   nominal: 45000   },
            { label: "50.000",    kode: "GOPAY50",   nominal: 50000   },
            { label: "55.000",    kode: "GOPAY55",   nominal: 55000   },
            { label: "60.000",    kode: "GOPAY60",   nominal: 60000   },
            { label: "65.000",    kode: "GOPAY65",   nominal: 65000   },
            { label: "70.000",    kode: "GOPAY70",   nominal: 70000   },
            { label: "75.000",    kode: "GOPAY75",   nominal: 75000   },
            { label: "80.000",    kode: "GOPAY80",   nominal: 80000   },
            { label: "85.000",    kode: "GOPAY85",   nominal: 85000   },
            { label: "90.000",    kode: "GOPAY90",   nominal: 90000   },
            { label: "95.000",    kode: "GOPAY95",   nominal: 95000   },
            { label: "100.000",   kode: "GOPAY100",  nominal: 100000  },
            { label: "150.000",   kode: "GOPAY150",  nominal: 150000  },
            { label: "200.000",   kode: "GOPAY200",  nominal: 200000  },
            { label: "250.000",   kode: "GOPAY250",  nominal: 250000  },
            { label: "300.000",   kode: "GOPAY300",  nominal: 300000  },
            { label: "350.000",   kode: "GOPAY350",  nominal: 350000  },
            { label: "400.000",   kode: "GOPAY400",  nominal: 400000  },
            { label: "450.000",   kode: "GOPAY450",  nominal: 450000  },
            { label: "500.000",   kode: "GOPAY500",  nominal: 500000  },
            { label: "1.000.000", kode: "GOPAY1000", nominal: 1000000 }
        ]
    },
    {
        id:           "ovo",
        label:        "OVO",
        emoji:        "\uD83D\uDCB5",  // 💵
        tujuanPrompt: "nomor OVO tujuan",
        tujuanLabel:  "Nomor OVO",
        isPLN:        false,
        products: makeCatalogProducts(`
            Ovo 10.000|OVOBA10
            Ovo 15.000|OVOBA15
            Ovo 20.000|OVOBA20
            Ovo 25.000|OVOBA25
            Ovo 30.000|OVOBA30
            Ovo 35.000|OVOBA35
            Ovo 40.000|OVOBA40
            Ovo 45.000|OVOBA45
            Ovo 50.000|OVOBA50
            Ovo 55.000|OVOBA55
            Ovo 60.000|OVOBA60
            Ovo 65.000|OVOBA65
            Ovo 70.000|OVOBA70
            Ovo 75.000|OVOBA75
            Ovo 80.000|OVOBA80
            Ovo 85.000|OVOBA85
            Ovo 90.000|OVOBA90
            Ovo 95.000|OVOBA95
            Ovo 100.000|OVOBA100
            Ovo 150.000|OVOBA150
            Ovo 200.000|OVOBA200
            Ovo 250.000|OVOBA250
            Ovo 300.000|OVOBA300
            Ovo 500.000|OVOBA500
        `)
    },
    {
        id:           "shopee",
        label:        "ShopeePay",
        emoji:        "\uD83D\uDCB7",  // 💷
        tujuanPrompt: "nomor HP ShopeePay tujuan",
        tujuanLabel:  "Nomor HP",
        isPLN:        false,
        products: [
            { label: "10.000",    kode: "SHOPF10",   nominal: 10000   },
            { label: "15.000",    kode: "SHOPF15",   nominal: 15000   },
            { label: "20.000",    kode: "SHOPF20",   nominal: 20000   },
            { label: "25.000",    kode: "SHOPF25",   nominal: 25000   },
            { label: "30.000",    kode: "SHOPF30",   nominal: 30000   },
            { label: "35.000",    kode: "SHOPF35",   nominal: 35000   },
            { label: "40.000",    kode: "SHOPF40",   nominal: 40000   },
            { label: "45.000",    kode: "SHOPF45",   nominal: 45000   },
            { label: "50.000",    kode: "SHOPF50",   nominal: 50000   },
            { label: "55.000",    kode: "SHOPF55",   nominal: 55000   },
            { label: "60.000",    kode: "SHOPF60",   nominal: 60000   },
            { label: "65.000",    kode: "SHOPF65",   nominal: 65000   },
            { label: "70.000",    kode: "SHOPF70",   nominal: 70000   },
            { label: "75.000",    kode: "SHOPF75",   nominal: 75000   },
            { label: "80.000",    kode: "SHOPF80",   nominal: 80000   },
            { label: "85.000",    kode: "SHOPF85",   nominal: 85000   },
            { label: "90.000",    kode: "SHOPF90",   nominal: 90000   },
            { label: "95.000",    kode: "SHOPF95",   nominal: 95000   },
            { label: "100.000",   kode: "SHOPF100",  nominal: 100000  },
            { label: "150.000",   kode: "SHOPF150",  nominal: 150000  },
            { label: "200.000",   kode: "SHOPF200",  nominal: 200000  },
            { label: "250.000",   kode: "SHOPF250",  nominal: 250000  },
            { label: "300.000",   kode: "SHOPF300",  nominal: 300000  },
            { label: "350.000",   kode: "SHOPF350",  nominal: 350000  },
            { label: "400.000",   kode: "SHOPF400",  nominal: 400000  },
            { label: "450.000",   kode: "SHOPF450",  nominal: 450000  },
            { label: "500.000",   kode: "SHOPF500",  nominal: 500000  },
            { label: "600.000",   kode: "HSHOP600",  nominal: 600000  },
            { label: "700.000",   kode: "HSHOP700",  nominal: 700000  },
            { label: "800.000",   kode: "HSHOP800",  nominal: 800000  },
            { label: "900.000",   kode: "HSHOP900",  nominal: 900000  },
            { label: "1.000.000", kode: "HSHOP1000", nominal: 1000000 }
        ]
    },
    {
        id:           "pln",
        label:        "Token Listrik",
        emoji:        "\u26A1\uFE0F",  // ⚡️
        tujuanPrompt: "nomor meter listrik",
        tujuanLabel:  "No. Meter",
        isPLN:        true,
        products: [
            { label: "20.000",    kode: "token-pln-20000",   nominal: 20000   },
            { label: "50.000",    kode: "token-pln-50000",   nominal: 50000   },
            { label: "100.000",   kode: "token-pln-100000",  nominal: 100000  },
            { label: "200.000",   kode: "token-pln-200000",  nominal: 200000  },
            { label: "500.000",   kode: "token-pln-500000",  nominal: 500000  },
            { label: "1.000.000", kode: "token-pln-1000000", nominal: 1000000 }
        ]
    },
    {
        id:           "freefire",
        label:        "Free Fire",
        emoji:        "\uD83D\uDC8E",  // 💎
        tujuanPrompt: "ID Free Fire kamu",
        tujuanLabel:  "ID Free Fire",
        isPLN:        false,
        isGameId:     true,
        products: [
            // nominal = harga fallback (diperbarui otomatis dari API saat bot nyala)
            // Label diamond: 💎 + jumlah diamond | Label spesial: nama asli
            // Kode produk prefix MFF (diperbarui dari PFF)
            { label: "5",    kode: "MFF5",    nominal: 844    },
            { label: "10",   kode: "MFF10",   nominal: 1689   },
            { label: "12",   kode: "MFF12",   nominal: 1720   },
            { label: "15",   kode: "MFF15",   nominal: 2530   },
            { label: "20",   kode: "MFF20",   nominal: 3377   },
            { label: "25",   kode: "MFF25",   nominal: 4219   },
            { label: "30",   kode: "MFF30",   nominal: 5066   },
            { label: "40",   kode: "MFF40",   nominal: 6755   },
            { label: "50",   kode: "MFF50",   nominal: 6783   },
            { label: "55",   kode: "MFF55",   nominal: 7598   },
            { label: "60",   kode: "MFF60",   nominal: 8446   },
            { label: "70",   kode: "MFF70",   nominal: 9202   },
            { label: "75",   kode: "MFF75",   nominal: 10039  },
            { label: "80",   kode: "MFF80",   nominal: 10875  },
            { label: "90",   kode: "MFF90",   nominal: 12548  },
            { label: "95",   kode: "MFF95",   nominal: 13385  },
            { label: "100",  kode: "MFF100",  nominal: 13566  },
            { label: "120",  kode: "MFF120",  nominal: 15894  },
            { label: "130",  kode: "MFF130",  nominal: 17568  },
            { label: "140",  kode: "MFF140",  nominal: 18404  },
            { label: "145",  kode: "MFF145",  nominal: 19241  },
            { label: "150",  kode: "MFF150",  nominal: 20077  },
            { label: "160",  kode: "MFF160",  nominal: 21750  },
            { label: "165",  kode: "MFF165",  nominal: 0      },
            { label: "170",  kode: "MFF170",  nominal: 0      },
            { label: "175",  kode: "MFF175",  nominal: 0      },
            { label: "180",  kode: "MFF180",  nominal: 25062  },
            { label: "185",  kode: "MFF185",  nominal: 0      },
            { label: "190",  kode: "MFF190",  nominal: 25097  },
            { label: "200",  kode: "MFF200",  nominal: 26770  },
            { label: "210",  kode: "MFF210",  nominal: 27606  },
            { label: "215",  kode: "MFF215",  nominal: 0      },
            { label: "220",  kode: "MFF220",  nominal: 0      },
            { label: "235",  kode: "MFF235",  nominal: 0      },
            { label: "240",  kode: "MFF240",  nominal: 0      },
            { label: "250",  kode: "MFF250",  nominal: 34136  },
            { label: "265",  kode: "MFF265",  nominal: 0      },
            { label: "280",  kode: "MFF280",  nominal: 36808  },
            { label: "290",  kode: "MFF290",  nominal: 0      },
            { label: "300",  kode: "MFF300",  nominal: 40154  },
            { label: "Mingguan Promo",    kode: "MFFM",    nominal: 27962  },
            { label: "BP Card",           kode: "MFFBP",   nominal: 41827  },
            { label: "330",  kode: "MFF330",  nominal: 0      },
            { label: "350",  kode: "MFF350",  nominal: 46010  },
            { label: "355",  kode: "MFF355",  nominal: 46010  },
            { label: "360",  kode: "MFF360",  nominal: 0      },
            { label: "365",  kode: "MFF365",  nominal: 0      },
            { label: "370",  kode: "MFF370",  nominal: 0      },
            { label: "375",  kode: "MFF375",  nominal: 49356  },
            { label: "380",  kode: "MFF380",  nominal: 0      },
            { label: "400",  kode: "MFF400",  nominal: 52703  },
            { label: "405",  kode: "MFF405",  nominal: 0      },
            { label: "415",  kode: "MFF415",  nominal: 0      },
            { label: "420",  kode: "MFF420",  nominal: 0      },
            { label: "425",  kode: "MFF425",  nominal: 55212  },
            { label: "430",  kode: "MFF430",  nominal: 0      },
            { label: "440",  kode: "MFF440",  nominal: 0      },
            { label: "455",  kode: "MFF455",  nominal: 0      },
            { label: "465",  kode: "MFF465",  nominal: 0      },
            { label: "475",  kode: "MFF475",  nominal: 61905  },
            { label: "480",  kode: "MFF480",  nominal: 0      },
            { label: "495",  kode: "MFF495",  nominal: 0      },
            { label: "500",  kode: "MFF500",  nominal: 65251  },
            { label: "505",  kode: "MFF505",  nominal: 0      },
            { label: "510",  kode: "MFF510",  nominal: 66924  },
            { label: "512",  kode: "MFF512",  nominal: 67761  },
            { label: "515",  kode: "MFF515",  nominal: 67761  },
            { label: "520",  kode: "MFF520",  nominal: 0      },
            { label: "545",  kode: "MFF545",  nominal: 71107  },
            { label: "565",  kode: "MFF565",  nominal: 73616  },
            { label: "600",  kode: "MFF600",  nominal: 78636  },
            { label: "635",  kode: "MFF635",  nominal: 82818  },
            { label: "Bulanan Promo",     kode: "MFFB",    nominal: 83889  },
            { label: "645",  kode: "MFF645",  nominal: 84492  },
            { label: "655",  kode: "MFF655",  nominal: 86165  },
            { label: "700",  kode: "MFF700",  nominal: 92020  },
            { label: "710",  kode: "MFF710",  nominal: 0      },
            { label: "720",  kode: "MFF720",  nominal: 92020  },
            { label: "725",  kode: "MFF725",  nominal: 0      },
            { label: "740",  kode: "MFF740",  nominal: 0      },
            { label: "770",  kode: "MFF770",  nominal: 98713  },
            { label: "790",  kode: "MFF790",  nominal: 101223 },
            { label: "800",  kode: "MFF800",  nominal: 102896 },
            { label: "860",  kode: "MFF860",  nominal: 110425 },
            { label: "925",  kode: "MFF925",  nominal: 0      },
            { label: "930",  kode: "MFF930",  nominal: 119627 },
            { label: "1000", kode: "MFF1000", nominal: 128829 },
            { label: "1050", kode: "MFF1050", nominal: 135521 },
            { label: "1060", kode: "MFF1060", nominal: 0      },
            { label: "1075", kode: "MFF1075", nominal: 0      },
            { label: "1080", kode: "MFF1080", nominal: 138867 },
            { label: "1200", kode: "MFF1200", nominal: 154762 },
            { label: "1215", kode: "MFF1215", nominal: 156435 },
            { label: "1300", kode: "MFF1300", nominal: 168147 },
            { label: "1440", kode: "MFF1440", nominal: 184041 },
            { label: "1450", kode: "MFF1450", nominal: 185714 },
            { label: "1490", kode: "MFF1490", nominal: 190733 },
            { label: "1510", kode: "MFF1510", nominal: 193243 },
            { label: "1580", kode: "MFF1580", nominal: 202445 },
            { label: "1795", kode: "MFF1795", nominal: 230051 },
            { label: "1800", kode: "MFF1800", nominal: 230888 },
            { label: "2000", kode: "MFF2000", nominal: 257657 },
            { label: "2020", kode: "MFF2020", nominal: 0      },
            { label: "2050", kode: "MFF2050", nominal: 0      },
            { label: "2070", kode: "MFF2070", nominal: 0      },
            { label: "2140", kode: "MFF2140", nominal: 0      },
            { label: "2160", kode: "MFF2160", nominal: 276062 },
            { label: "2190", kode: "MFF2190", nominal: 281081 },
            { label: "2200", kode: "MFF2200", nominal: 0      },
            { label: "2210", kode: "MFF2210", nominal: 282754 },
            { label: "2280", kode: "MFF2280", nominal: 270494 },
            { label: "2350", kode: "MFF2350", nominal: 0      },
            { label: "2355", kode: "MFF2355", nominal: 302831 },
            { label: "2400", kode: "MFF2400", nominal: 0      },
            { label: "2720", kode: "MFF2720", nominal: 349678 },
            { label: "3620", kode: "MFF3620", nominal: 0      },
            { label: "3640", kode: "MFF3640", nominal: 0      },
            { label: "3800", kode: "MFF3800", nominal: 0      },
            { label: "4000", kode: "MFF4000", nominal: 513642 },
            { label: "4720", kode: "MFF4720", nominal: 0      },
            { label: "7290", kode: "MFF7290", nominal: 920205 }
        ]
    },

    {
        id:           "mobilelegend",
        label:        "Mobile Legends",
        emoji:        "\uD83D\uDC8E",  // 💎
        tujuanPrompt: "ID Mobile Legends kamu (format: UserID(ServerID))",
        tujuanLabel:  "ID Mobile Legends",
        isPLN:        false,
        isGameId:     true,
        products: [
            // nominal = harga fallback (diperbarui otomatis dari API saat bot nyala)
            // Label diamond: 💎 + jumlah diamond | Label spesial: nama asli
            { label: "86",    kode: "MLA86",   nominal: 22699   },
            { label: "172",   kode: "MLA172",  nominal: 45172   },
            { label: "257",   kode: "MLA257",  nominal: 67059   },
            { label: "343",   kode: "MLA343",  nominal: 89787   },
            { label: "344",   kode: "MLA344",  nominal: 89787   },
            { label: "429",   kode: "MLA429",  nominal: 110721  },
            { label: "514",   kode: "MLA514",  nominal: 134231  },
            { label: "Twilight Pass",      kode: "MLATP",   nominal: 144923  },
            { label: "600",   kode: "MLA600",  nominal: 153207  },
            { label: "706",   kode: "MLA706",  nominal: 184177  },
            { label: "792",   kode: "MLA792",  nominal: 202271  },
            { label: "878",   kode: "MLA878",  nominal: 220294  },
            { label: "963",   kode: "MLA963",  nominal: 241705  },
            { label: "990",   kode: "MLA990",  nominal: 249708  },
            { label: "1050",  kode: "MLA1050", nominal: 264318  },
            { label: "1220",  kode: "MLA1220", nominal: 308091  },
            { label: "1412",  kode: "MLA1412", nominal: 358135  },
            { label: "2195",  kode: "MLA2195", nominal: 520193  },
            { label: "2901",  kode: "MLA2901", nominal: 695895  },
            { label: "3073",  kode: "MLA3073", nominal: 739668  },
            { label: "3688",  kode: "MLA3688", nominal: 895316  },
            { label: "4394",  kode: "MLA4394", nominal: 1041197 },
            { label: "5532",  kode: "MLA5532", nominal: 1318774 },
            { label: "6238",  kode: "MLA6238", nominal: 1471604 },
            { label: "7727",  kode: "MLA7727", nominal: 1845018 },
            { label: "9288",  kode: "MLA9288", nominal: 2203916 },
            { label: "12976", kode: "MLA12976", nominal: 3048078 },
            { label: "14820", kode: "MLA14820", nominal: 3478018 },
            { label: "18576", kode: "MLA18576", nominal: 4339400 },
            { label: "27864", kode: "MLA27864", nominal: 6509100 },

            // — Bundle & Pass (harga dari API) —
            { label: "Weekly Elite Bundle",    kode: "DMLWEB",  nominal: 0 },
            { label: "Weekly Diamond Pass 1x", kode: "DMLWD1",  nominal: 0 },
            { label: "Weekly Diamond Pass 2x", kode: "DMLWD2",  nominal: 0 },
            { label: "Monthly Epic Bundle",    kode: "DMLMEB",  nominal: 0 },
            { label: "Startlight Member",      kode: "DMLSM",   nominal: 0 },
            { label: "Weekly Diamond Pass 3x", kode: "DMLWD3",  nominal: 0 },
            { label: "Weekly Diamond Pass 4x", kode: "DMLWD4",  nominal: 0 },
            { label: "Weekly Diamond Pass 5x", kode: "DMLWD5",  nominal: 0 },
            { label: "Twilight Pass",          kode: "DMLTP",   nominal: 0 },
            { label: "Startlight Member Plus", kode: "DMLSMP",  nominal: 0 }
        ]
    },
        {
        id:           "tiktok_followers",
        label:        "Followers TikTok",
        emoji:        "\uD83D\uDC65",  // 👥
        tujuanPrompt: "link TikTok target",
        tujuanLabel:  "Link TikTok",
        isPLN:        false,
        isGameId:     false,
        isSosmed:     true,
        serviceId:    KEDAI_SERVICE_ID,
        products:     generateTiktokFollowers()
    },
    {
        id:           "tiktok_view",
        label:        "View TikTok",
        emoji:        "\uD83D\uDC40",  // 👀
        tujuanPrompt: "link video TikTok target",
        tujuanLabel:  "Link Video TikTok",
        isPLN:        false,
        isGameId:     false,
        isSosmed:     true,
        serviceId:    KEDAI_VIEW_SERVICE_ID,
        products:     generateTiktokView()
    },
    {
        id:           "tiktok_likes",
        label:        "Likes TikTok",
        emoji:        "\uD83D\uDC97",  // 💗
        tujuanPrompt: "link video TikTok target",
        tujuanLabel:  "Link Video TikTok",
        isPLN:        false,
        isGameId:     false,
        isSosmed:     true,
        serviceId:    KEDAI_LIKES_SERVICE_ID,
        products:     generateTiktokLikes()
    },

    // =========================================
    // PAKET DATA — SMARTFREN
    // =========================================
    {
        id:           "data_smartfren",
        label:        "Smartfren",
        tujuanPrompt: "nomor HP Smartfren tujuan",
        tujuanLabel:  "No. HP Smartfren",
        isPLN:        false,
        isGameId:     false,
        isSosmed:     false,
        isData:       true,
        products: makeCatalogProducts(`
            Data Harian 1GB 3 Hari|SDMP1
            Data Harian 4GB 3 Hari|SMDV5
            Data Harian 4GB 3 Hari|VOL2GB
            Data Harian 2GB 3 Hari|SDMP2
            Data Harian 2.5GB 3 Hari|SDM1
            Data Harian 1GB 7 Hari|SDM2
            Data Harian 4GB 5 Hari|VOL3GB
            Data Harian 3GB 5 Hari|SDMP3
            Data Harian 3GB 5 Hari|SDH3
            Data Harian 6GB 7Hari|VOL10RB
            Data Harian 1,5GB 7 Hari|SDM3
            Data Harian 4GB + Unlimited Aplikasi 14 Hari|SDMP4
            Data Harian 10GB 6Hari|VOL10GB
            Data Harian 15GB 10Hari|VOL15GB
            Data Bulanan 30GB 28 Hr|SMNS12
            Data Bulanan 40GB 28Hr|SMNS45
            Data Bulanan 50GB 30 Hr|SMF100
            Data Bulanan 100GB 30Hr|SMNS60
            Data Bulanan 100GB 30 Hr|NS60
        `)
    },

    // =========================================
    // PAKET DATA — THREE (TRI)
    // =========================================
    {
        id:           "data_tri",
        label:        "Three (Tri)",
        tujuanPrompt: "nomor HP Three (Tri) tujuan",
        tujuanLabel:  "No. HP Three",
        isPLN:        false,
        isGameId:     false,
        isSosmed:     false,
        isData:       true,
        products: [
            { label: "Tri Data 3GB 3 Hari",    kode: "THM3",       nominal: 0 },
            { label: "Tri Data 8GB 3 Hari",    kode: "DTRH5GB3",   nominal: 0 },
            { label: "Tri Data 5GB 3 Hari",    kode: "THP5B",      nominal: 0 },
            { label: "Tri Data 6GB 3 Hari",    kode: "THM55",      nominal: 0 },
            { label: "Tri Data 5GB 5 Hari",    kode: "THP45",      nominal: 0 },
            { label: "Tri Data 3.5GB 5 Hari",  kode: "THM35",      nominal: 0 },
            { label: "Tri Data 7GB 5 Hari",    kode: "THM20",      nominal: 0 },
            { label: "Tri Data 10GB 5 Hari",   kode: "DTRH4GB5",   nominal: 0 },
            { label: "Tri Data 10GB 5 Hari",   kode: "DTMH65",     nominal: 0 },
            { label: "Tri Data 6GB 5 Hari",    kode: "THM6",       nominal: 0 },
            { label: "Tri Data 11GB 5 Hari",   kode: "DTRH6GB5",   nominal: 0 },
            { label: "Tri Data 10GB 7 Hari",   kode: "THP107",     nominal: 0 },
            { label: "Tri Happy 15GB 7 Hari",  kode: "THP157",     nominal: 0 },
            { label: "Tri Data 10GB 14 Hari",  kode: "DTRH10GB14", nominal: 0 },
            { label: "Tri Data 23GB 14 Hari",  kode: "DTRH23GB14", nominal: 0 },
            { label: "Tri Data 6GB 30 Hari",   kode: "TDP6",       nominal: 0 },
            { label: "Tri Data 7GB 30 Hari",   kode: "TDP7",       nominal: 0 },
            { label: "Tri Data 8GB 30 Hari",   kode: "TDP8",       nominal: 0 },
            { label: "Tri Data 9GB 30 Hari",   kode: "TDP9",       nominal: 0 },
            { label: "Tri Data 10GB 30 Hari",  kode: "DTP10B",     nominal: 0 },
            { label: "Tri Data 10GB 30 Hari",  kode: "TDP10",      nominal: 0 }
        ]
    },

    // =========================================
    // PAKET DATA — TELKOMSEL
    // =========================================
    {
        id:           "data_telkomsel",
        label:        "Telkomsel",
        tujuanPrompt: "nomor HP Telkomsel tujuan",
        tujuanLabel:  "No. HP Telkomsel",
        isPLN:        false,
        isGameId:     false,
        isSosmed:     false,
        isData:       true,
        products: [
            { label: "Telkomsel Data 2GB 7 Hari",   kode: "TMINI2C",   nominal: 0 },
            { label: "Telkomsel Data 3GB 7 Hari",   kode: "TDMI37",    nominal: 0 },
            { label: "Telkomsel Data 2GB 14 Hari",  kode: "TDMD2",     nominal: 0 },
            { label: "Telkomsel Data 5GB 7 Hari",   kode: "TFH5",      nominal: 0 },
            { label: "Telkomsel Data 6GB 7 Hari",   kode: "TDMN8",     nominal: 0 },
            { label: "Telkomsel Data 6GB 7 Hari",   kode: "TDMI67",    nominal: 0 },
            { label: "Telkomsel Data 7GB 7 Hari",   kode: "TFH7",      nominal: 0 },
            { label: "Telkomsel Data 5GB 7 Hari",   kode: "MINI5_7",   nominal: 0 },
            { label: "Telkomsel Data 7GB 7 Hari",   kode: "FLASH7000", nominal: 0 },
            { label: "Telkomsel Data 10GB 7 Hari",  kode: "MINI10_7",  nominal: 0 },
            { label: "Telkomsel Data 15GB 7 Hari",  kode: "TDMN11",    nominal: 0 },
            { label: "Telkomsel Data 15GB 7 Hari",  kode: "TDM157",    nominal: 0 },
            { label: "Data Harian 3GB 3 Hari",      kode: "MINI3_3",   nominal: 0 },
            { label: "Data Harian 3GB 5 Hari",      kode: "TFH3",      nominal: 0 },
            { label: "Data Harian 3GB 3 Hari",      kode: "TDMI33",    nominal: 0 },
            { label: "Data Harian 3GB 5 Hari",      kode: "TDM3",      nominal: 0 },
            { label: "Data Harian 5GB 3 Hari",      kode: "TDMM4",     nominal: 0 },
            { label: "Data Harian 7GB 3 Hari",      kode: "TDM73",     nominal: 0 },
            { label: "Data Harian 10GB 3 Hari",     kode: "TDMINI103", nominal: 0 },
            { label: "Telkomsel 5GB 30 Hari",       kode: "TDE5H30",   nominal: 0 },
            { label: "Telkomsel 5GB 30 Hari",       kode: "TMY5",      nominal: 0 },
            { label: "Telkomsel 15GB 30 Hari",      kode: "TDE15H30",  nominal: 0 },
            { label: "Telkomsel 10GB 30 Hari",      kode: "TMY10",     nominal: 0 },
            { label: "Telkomsel 11GB 30 Hari",      kode: "TMY11",     nominal: 0 },
            { label: "Telkomsel 25GB 30 Hari",      kode: "TMY25",     nominal: 0 },
            { label: "Telkomsel 28GB 30 Hari",      kode: "TMY28",     nominal: 0 },
            { label: "Telkomsel 45GB 30 Hari",      kode: "TMY45",     nominal: 0 },
            { label: "Telkomsel 49GB 30 Hari",      kode: "TMY49",     nominal: 0 }
        ]
    },

    // =========================================
    // PAKET DATA — AXIS
    // =========================================
    {
        id:           "data_axis",
        label:        "Axis",
        tujuanPrompt: "nomor HP Axis tujuan",
        tujuanLabel:  "No. HP Axis",
        isPLN:        false,
        isGameId:     false,
        isSosmed:     false,
        isData:       true,
        products: [
            { label: "Axis Mini 4.5GB 5 Hari",  kode: "AD1",        nominal: 0 },
            { label: "Axis Mini 5.5GB 5 Hari",  kode: "DAPH4GB5H",  nominal: 0 },
            { label: "Axis Mini 6GB 3 Hari",    kode: "AXDM63",     nominal: 0 },
            { label: "Axis Mini 8GB 5 Hari",    kode: "AXD10G5H",   nominal: 0 },
            { label: "Axis Mini 17GB 3 Hari",   kode: "MGB12",      nominal: 0 },
            { label: "Axis Mini 10GB 5 Hari",   kode: "ADM10H5",    nominal: 0 },
            { label: "Axis Mini 16GB 5 Hari",   kode: "MGS3",       nominal: 0 },
            { label: "Axis Mini 17GB 5 Hari",   kode: "DAPH15GB5H", nominal: 0 },
            { label: "Axis Mini 32GB 5 Hari",   kode: "AXD35G5H",   nominal: 0 },
            { label: "Axis 10GB 30 Hari",       kode: "ADB10H30",   nominal: 0 },
            { label: "Axis 10GB 28 Hari",       kode: "DABP6",      nominal: 0 },
            { label: "Axis 8GB 28 Hari",        kode: "BRO8",       nominal: 0 },
            { label: "Axis 16GB 28 Hari",       kode: "ADB15H30",   nominal: 0 },
            { label: "Axis 16GB 28 Hari",       kode: "DABP8",      nominal: 0 },
            { label: "Axis 12GB 28 Hari",       kode: "ADB12H30",   nominal: 0 },
            { label: "Axis 25GB 28 Hari",       kode: "BRO25",      nominal: 0 },
            { label: "Axis 26GB 28 Hari",       kode: "DABP14",     nominal: 0 },
            { label: "Axis 40GB 28 Hari",       kode: "DABP20",     nominal: 0 },
            { label: "Axis 30GB 30 Hari",       kode: "DABP30N",    nominal: 0 },
            { label: "Axis 65GB 28 Hari",       kode: "DABP30",     nominal: 0 },
            { label: "Axis 50GB 60 Hari",       kode: "DABP25",     nominal: 0 },
            { label: "Axis 150GB 28 Hari",      kode: "DABP100",    nominal: 0 },
            { label: "Axis 90GB 60 Hari",       kode: "ADBB75",     nominal: 0 }
        ]
    },

    // =========================================
    // PAKET DATA — XL
    // =========================================
    {
        id:           "data_xl",
        label:        "XL",
        tujuanPrompt: "nomor HP XL tujuan",
        tujuanLabel:  "No. HP XL",
        isPLN:        false,
        isGameId:     false,
        isSosmed:     false,
        isData:       true,
        products: [
            { label: "XL Data Mini 1GB 2 Hari",     kode: "DXB1",      nominal: 0 },
            { label: "XL Data Mini 3GB 2 Hari",     kode: "DXB3",      nominal: 0 },
            { label: "XL Data Mini 1GB 7 Hari",     kode: "XLM1",      nominal: 0 },
            { label: "XL Data Mini 1.5GB 7 Hari",   kode: "XLM2",      nominal: 0 },
            { label: "XL Data Mini 2.5GB 7 Hari",   kode: "XLM3",      nominal: 0 },
            { label: "XL Data 4.5GB 7 Hari",        kode: "XDHM45",    nominal: 0 },
            { label: "XL Data Pure 500MB 30 Hari",  kode: "XDU500",    nominal: 0 },
            { label: "XL Data Pure 800MB 30 Hari",  kode: "XDU800",    nominal: 0 },
            { label: "XL Data Pure 1GB 30 Hari",    kode: "XDP1000",   nominal: 0 },
            { label: "XL Data Pure 2GB 30 Hari",    kode: "XDP2000",   nominal: 0 },
            { label: "XL Data Pure 3GB 30 Hari",    kode: "XDP3000",   nominal: 0 },
            { label: "XL Data Pure 4GB 30 Hari",    kode: "XDP4000",   nominal: 0 },
            { label: "XL Data Pure 5GB 30 Hari",    kode: "XDP5000",   nominal: 0 },
            { label: "XL Data Pure 6GB 30 Hari",    kode: "XDP6000",   nominal: 0 },
            { label: "XL Data Pure 7GB 30 Hari",    kode: "XDP7000",   nominal: 0 },
            { label: "XL Data Pure 8GB 30 Hari",    kode: "XDP8000",   nominal: 0 },
            { label: "XL Data Pure 9GB 30 Hari",    kode: "XDP9000",   nominal: 0 },
            { label: "XL Data Pure 10GB 30 Hari",   kode: "XDP10000",  nominal: 0 }
        ]
    },

    // =========================================
    // PAKET DATA — INDOSAT
    // =========================================
    {
        id:           "data_indosat",
        label:        "Indosat",
        tujuanPrompt: "nomor HP Indosat tujuan",
        tujuanLabel:  "No. HP Indosat",
        isPLN:        false,
        isGameId:     false,
        isSosmed:     false,
        isData:       true,
        products: [
            { label: "Freedom 7GB 7 Hari",           kode: "IFH7",         nominal: 0 },
            { label: "Freedom 7GB 7 Hari",           kode: "IDFF75",       nominal: 0 },
            { label: "Freedom 7GB 7 Hari",           kode: "IDFM7",        nominal: 0 },
            { label: "Freedom 9GB 7 Hari",           kode: "IFH9",         nominal: 0 },
            { label: "Freedom 9GB 7 Hari",           kode: "FI7GBH7",      nominal: 0 },
            { label: "Freedom 15GB 7 Hari",          kode: "IDFF155S",     nominal: 0 },
            { label: "Freedom 17GB 7 Hari",          kode: "IFH15",        nominal: 0 },
            { label: "Freedom 18GB 7 Hari",          kode: "IFH18",        nominal: 0 },
            { label: "Freedom 7GB 14 Hari",          kode: "DIFH3GB20H",   nominal: 0 },
            { label: "Freedom 10GB 14 Hari",         kode: "DIFH10GB14H",  nominal: 0 },
            { label: "Freedom 22GB 14 Hari",         kode: "IFH22",        nominal: 0 }
        ]
    },

    // =========================================
    // PAKET DATA — BY.U
    // =========================================
    {
        id:           "data_byu",
        label:        "By.U",
        tujuanPrompt: "nomor HP By.U tujuan",
        tujuanLabel:  "No. HP By.U",
        isPLN:        false,
        isGameId:     false,
        isSosmed:     false,
        isData:       true,
        products: [
            // 1 HARI
            { label: "Data By.U 1GB 1 Hari",        kode: "DBYU1",       nominal: 0 },
            { label: "Data By.U 2GB 1 Hari",        kode: "DBYU2",       nominal: 0 },
            { label: "Data By.U 3GB 1 Hari",        kode: "DBYU3GB1H",   nominal: 0 },
            { label: "Data By.U 10GB 1 Hari",       kode: "DBYU10",      nominal: 0 },
            // 3 HARI
            { label: "Data By.U 2GB 3 Hari",        kode: "DBYU23",      nominal: 0 },
            { label: "Data By.U 6GB 3 Hari",        kode: "DBYU6GB3H",   nominal: 0 },
            // 5 HARI
            { label: "Data By.U 2.5GB 5 Hari",      kode: "DBYU1007",    nominal: 0 },
            { label: "Data By.U 7.5GB 5 Hari",      kode: "DBYU7GB5H",   nominal: 0 },
            // 7 HARI
            { label: "Data By.U 3GB 7 Hari",        kode: "DBY37",       nominal: 0 },
            { label: "Data By.U 4GB 7 Hari",        kode: "DBYU4GB7H",   nominal: 0 },
            { label: "Data By.U 5GB 7 Hari",        kode: "DBYU37",      nominal: 0 },
            { label: "Data By.U 5GB 7 Hari",        kode: "DBYU5GB7H",   nominal: 0 },
            { label: "Data By.U 6GB 7 Hari",        kode: "DBYU6GB7H",   nominal: 0 },
            { label: "Data By.U 7.5GB 7 Hari",      kode: "DBYU7GB7H",   nominal: 0 },
            { label: "Data By.U 12GB 7 Hari",       kode: "DBYU12GB7H",  nominal: 0 },
            // 14 HARI
            { label: "Data By.U 1GB 14 Hari",       kode: "TDBH1",       nominal: 0 },
            { label: "Data By.U 2GB 14 Hari",       kode: "TDBH2",       nominal: 0 },
            { label: "Data By.U 3GB 14 Hari",       kode: "TDBM314",     nominal: 0 },
            { label: "Data By.U 3GB 14 Hari",       kode: "TDBH3",       nominal: 0 },
            { label: "Data By.U 4GB 14 Hari",       kode: "TDBH4",       nominal: 0 },
            { label: "Data By.U 5GB 14 Hari",       kode: "DBYU514",     nominal: 0 },
            { label: "Data By.U 6GB 14 Hari",       kode: "TDBH6",       nominal: 0 },
            { label: "Data By.U 7GB 14 Hari",       kode: "TYUH7",       nominal: 0 },
            { label: "Data By.U 8GB 14 Hari",       kode: "TDBH8",       nominal: 0 },
            { label: "Data By.U 11GB 14 Hari",      kode: "DBY9",        nominal: 0 }
        ]
    },

    // =========================================
    // PULSA
    // =========================================
    {
        id:           "pulsa_telkomsel",
        label:        "Telkomsel",
        tujuanPrompt: "nomor HP Telkomsel tujuan",
        tujuanLabel:  "No. HP Telkomsel",
        isPLN:        false,
        isPulsa:      true,
        products: makeCatalogProducts(`
            Telkomsel 5.000 Promo|S5
            Telkomsel 5.000 Fast|MOC5
            Telkomsel 5.000|SP5
            Telkomsel 10.000 promo|S10
            Telkomsel 10.000|SP10
            Telkomsel 10.000 Fast|MOC10
            Telkomsel 15.000|S15
            Telkomsel 15.000 Fast|MOC15
            Telkomsel 20.000|S20
            Telkomsel 20.000|tsel20
            Telkomsel 20.000 Fast|MOC20
            Telkomsel 25.000|S25
            Telkomsel 25.000 Mochan|MOC25
            Telkomsel 30.000|S30
            Telkomsel 30.000 Mochan|MOC30
            Telkomsel 35.000|S35
            Telkomsel 40.000|S40
            Telkomsel 40.000 Mochan|MOC40
            Telkomsel 45.000|S45
            Telkomsel 50.000|S50
            Telkomsel 50.000 Mochan|MOC50
            Telkomsel 55.000|S55
            Telkomsel 60.000|S60
            Telkomsel 65.000|S65
            Telkomsel 70.000|S70
            Telkomsel 75.000|S75
            Telkomsel 80.000|S80
            Telkomsel 85.000|S85
            Telkomsel 85.000 Mochan|MOC85
            Telkomsel 90.000|S90
            Telkomsel 90.000 Mochan|MOC90
            Telkomsel 95.000|S95
            Telkomsel 95.000 Mochan|MOC95
            Telkomsel 100.000|TSEL100
            Telkomsel 100.000|S100
            Telkomsel 100.000 Mochan|MOC100
            Telkomsel 105.000|S105
            Telkomsel 110.000|S110
            Telkomsel 115.000|S115
            Telkomsel 120.000|S120
            Telkomsel 125.000|S125
            Telkomsel 130.000|S130
            Telkomsel 135.000|S135
            Telkomsel 140.000|S140
            Telkomsel 145.000|S145
            Telkomsel 150.000|S150
            Telkomsel 150.000 Mochan|MOC150
            Telkomsel 200.000|S200
            Telkomsel 200.000 Mochan|MOC200
            Telkomsel 300.000|S300
            Telkomsel 500.000|S500
            Telkomsel 1.000.000|S1000
        `)
    },
    {
        id:           "pulsa_axis",
        label:        "Axis",
        tujuanPrompt: "nomor HP Axis tujuan",
        tujuanLabel:  "No. HP Axis",
        isPLN:        false,
        isPulsa:      true,
        products: makeCatalogProducts(`
            Axis 5.000|AX5
            Axis 10.000|AX10
            Axis 15.000|AX15
            Axis 25.000|AX25
            Axis 30.000|AX30
            Axis 40.000|AX40
            Axis 50.000|AX50
            Axis 60.000|AX60
            Axis 70.000|AX70
            Axis 80.000|AX80
            Axis 90.000|AX90
            Axis 100.000|AX100
            Axis 200.000|AX200
            Axis 300.000|AX300
            Axis 500.000|AX500
            Axis 1.000.000|AX1000
        `)
    },
    {
        id:           "pulsa_xl_axis",
        label:        "XL/AXIS",
        tujuanPrompt: "nomor HP XL/AXIS tujuan",
        tujuanLabel:  "No. HP XL/AXIS",
        isPLN:        false,
        isPulsa:      true,
        products: makeCatalogProducts(`
            Pulsa XL-AXIS 5.000|XLP5
            Pulsa XL-AXIS 10.000|XLP10
            Pulsa XL/AXIS 15.000|XLP15
            Pulsa XL/AXIS 25.000|XLP25
            Pulsa XL/AXIS 30.000|XLP30
            Pulsa XL/AXIS 40.000|XPP40
            Pulsa XL/AXIS 50.000|XLP50
            Pulsa XL/AXIS 60.000|XPP60
            Pulsa XL/AXIS 70.000|XPP70
            Pulsa XL/AXIS 80.000|XPP80
            Pulsa XL/AXIS 90.000|XPP90
            Pulsa XL/AXIS 100.000|XLP100
        `)
    },
    {
        id:           "pulsa_indosat",
        label:        "Indosat",
        tujuanPrompt: "nomor HP Indosat tujuan",
        tujuanLabel:  "No. HP Indosat",
        isPLN:        false,
        isPulsa:      true,
        products: makeCatalogProducts(`
            Indosat 5.000 Promo|IR5
            Indosat 5.000|IS5
            Indosat 10.000 Promo|IR10
            Indosat 10.000|IS10
            Indosat 12.000|IS12
            Indosat 15.000|IS15
            Indosat 20.000|IS20
            Indosat 25.000|IS25
            Indosat 30.000|IS30
            Indosat 40.000|IS40
            Indosat 50.000|IS50
            Indosat 55.000|IS55
            Indosat 60.000|IS60
            Indosat 65.000|IS65
            Indosat 70.000|IS70
            Indosat 80.000|IS80
            Indosat 85.000|IS85
            Indosat 90.000|IS90
            Indosat 100.000|IS100
            Indosat 105.000|IS105
            Indosat 125.000|IS125
            Indosat 150.000|IS150
            Indosat 175.000|IS175
            Indosat 200.000|IS200
            Indosat 250.000|IS250
            Indosat 300.000|IS300
        `)
    },
    {
        id:           "pulsa_smartfren",
        label:        "Smartfren",
        tujuanPrompt: "nomor HP Smartfren tujuan",
        tujuanLabel:  "No. HP Smartfren",
        isPLN:        false,
        isPulsa:      true,
        products: makeCatalogProducts(`
            Pulsa 5k|SSJ5
            Pulsa 10k|SSJ10
            Pulsa 12k|SSJ12
            Pulsa 15k|SSJ15
            Pulsa 20k|SSJ20
            Pulsa 25k|SSJ25
            Pulsa 25k Promo|SMP25
            Pulsa 30k|SSJ30
            Pulsa 35k|SSJ35
            Pulsa 40k|SSJ40
            Pulsa 45k|SSJ45
            Pulsa 50k|SSJ50
            Pulsa 50k Promo|SMP50
            Pulsa 60k|SSJ60
            Pulsa 65k|SSJ65
            Pulsa 65k Promo|SSJP65
            Pulsa 70k|SSJ70
            Pulsa 75k Promo|SMP75
            Pulsa 80k|SMP80
            Pulsa 85k|SSJ85
            Pulsa 90k|SSJ90
            Pulsa 95k Promo|SSJP95
            Pulsa 95k|SSJ95
            Pulsa 100k|SSJ100
            Pulsa 125k|SSJ125
            Pulsa 150k|SSJ150
            Pulsa 200k|SSJ200
            Pulsa 300k promo|SMP300
            Pulsa 300k|SSJ300
            Pulsa 500k|SSJ500
        `)
    },
    {
        id:           "pulsa_tri",
        label:        "Tri",
        tujuanPrompt: "nomor HP Tri tujuan",
        tujuanLabel:  "No. HP Tri",
        isPLN:        false,
        isPulsa:      true,
        products: makeCatalogProducts(`
            Pulsa 5k|TRK5
            Pulsa 10k|TRK10
            Pulsa 15k|TRK15
            Pulsa 20k|TRK20
            Pulsa 25k|TRK25
            Pulsa 30k|TRK30
            Pulsa 40k|TRK40
            Pulsa 50k|TRK50
            Pulsa 55k|TRK55
            Pulsa 60k|TRK60
            Pulsa 65k|TRK65
            Pulsa 70k|TRK70
            Pulsa 75k|TRK75
            Pulsa 80k|TRK80
            Pulsa 85k|TRK85
            Pulsa 90k|TRK90
            Pulsa 100k|TRK100
            Pulsa 105k|TRK105
            Pulsa 125k|TRK125
            Pulsa 150k|TRK150
            Pulsa 200k|TRK200
            Pulsa 250k|TRK250
            Pulsa 300k|TRK300
            Pulsa 400k|TRK400
            Pulsa 500k|TRK500
        `)
    },
    {
        id:           "pulsa_byu",
        label:        "By.U",
        tujuanPrompt: "nomor HP By.U tujuan",
        tujuanLabel:  "No. HP By.U",
        isPLN:        false,
        isPulsa:      true,
        products: makeCatalogProducts(`
            Pulsa 5k|SBU5
            Pulsa 10k|SBU10
            Pulsa 15k|SBU15
            Pulsa 20k|SBU20
            Pulsa 25k|SBU25
            Pulsa 30k|SBU30
            Pulsa 35k|SBU35
            Pulsa 40k|SBU40
            Pulsa 45k|SBU45
            Pulsa 50k|SBU50
            Pulsa 55k|SBU55
            Pulsa 60k|SBU60
            Pulsa 65k|SBU65
            Pulsa 70k|SBU70
            Pulsa 75k|SBU75
            Pulsa 80k|SBU80
            Pulsa 85k|SBU85
            Pulsa 90k|SBU90
            Pulsa 95k|SBU95
            Pulsa 100k|SBU100
            Pulsa 150k|SBU150
            Pulsa 200k|SBU200
        `)
    }
];

// =========================================
// KELOMPOK MENU UTAMA
// Dipakai untuk navigasi 2 level:
// Menu Utama → Grup → Kategori → Produk
// Token Listrik bersifat direct (langsung ke produk)
// =========================================

const groups = [
    {
        id:          "ewallet",
        label:       "E-Wallet",
        emoji:       "\uD83D\uDCB3",  // 💳
        categoryIds: ["dana", "gopay", "shopee", "ovo"],
        direct:      false
    },
    {
        id:          "pln",
        label:       "Token Listrik",
        emoji:       "\u26A1\uFE0F",  // ⚡️
        categoryIds: ["pln"],
        direct:      true
    },
    {
        id:          "game",
        label:       "Game",
        emoji:       "\uD83C\uDFAE",  // 🎮
        categoryIds: ["freefire", "mobilelegend"],
        direct:      false
    },
    {
        id:          "sosmed",
        label:       "Booster Sosial Media",
        emoji:       "\uD83D\uDCF1",  // 📱
        categoryIds: ["tiktok_followers", "tiktok_view", "tiktok_likes"],
        direct:      false
    },
    {
        id:          "data",
        label:       "Paket Data",
        emoji:       "\uD83D\uDCF6",  // 📶
        categoryIds: ["data_smartfren", "data_tri", "data_telkomsel", "data_axis", "data_xl", "data_indosat", "data_byu"],
        direct:      false
    },
    {
        id:          "pulsa",
        label:       "Pulsa",
        emoji:       "\uD83D\uDCF1",  // 📱
        categoryIds: ["pulsa_telkomsel", "pulsa_axis", "pulsa_xl_axis", "pulsa_indosat", "pulsa_smartfren", "pulsa_tri", "pulsa_byu"],
        direct:      false
    }
];

// =========================================
// HITUNG HARGA JUAL (category-aware)
//
// DANA / GoPay / ShopeePay — flat fee:
//   nominal   1.000 –  29.000 → +2.000
//   nominal  30.000 –  49.000 → +4.000
//   nominal  50.000 ke atas   → +5.000
//
// Token Listrik (PLN) — flat fee:
//   nominal   1 –  50.000 → +3.000
//   nominal  51 – 100.000 → +4.000
//   nominal 101.000 ke atas → +5.000
//
// Free Fire & Mobile Legends — markup 5%
//
// Followers / View / Likes TikTok — flat Rp5.000
// =========================================

function getSellingPrice(product) {
    const nominal = product.nominal;
    const catId   = product.kategori ? product.kategori.id : null;

    // Harga jual manual dari dashboard memiliki prioritas atas aturan markup lama.
    if (product.hargaJual !== undefined && product.hargaJual !== null) {
        return Number(product.hargaJual);
    }

    if (catId === "dana" || catId === "gopay" || catId === "shopee" || catId === "ovo"
        || product.kategori?.isPulsa) {
        if (nominal <= 29000) return nominal + 2000;
        if (nominal <= 49000) return nominal + 4000;
        return nominal + 5000;
    }

    if (catId === "pln") {
        if (nominal <= 50000)  return nominal + 3000;
        if (nominal <= 100000) return nominal + 4000;
        return nominal + 5000;
    }

    // Followers / View / Likes TikTok — keuntungan flat per order
    if (catId === "tiktok_followers" || catId === "tiktok_view" || catId === "tiktok_likes") {
        return nominal + SOSMED_PROFIT;
    }

    // Paket Data (Three, Telkomsel, Axis, XL, Indosat, By.U) — flat Rp2.500
    if (catId === "data_smartfren" || catId === "data_tri" || catId === "data_telkomsel"
        || catId === "data_axis" || catId === "data_xl" || catId === "data_indosat" || catId === "data_byu") {
        return nominal + DATA_PROFIT;
    }

    // Free Fire & Mobile Legends
    return Math.ceil(nominal * 1.05);
}

// =========================================
// SYNC HARGA SOSMED DARI KEDAISOSMED API
// Update harga Followers / View / Likes TikTok otomatis
// =========================================

async function syncHargaSosmed() {
    const { fetchServicePrice } = require("./kedaisosmed");

    const hasil = { sukses: true, followers: null, view: null, likes: null };

    // ── Followers TikTok ──
    try {
        const pricePerK = await fetchServicePrice(KEDAI_SERVICE_ID);
        if (pricePerK && pricePerK > 0) {
            currentPricePerK = pricePerK;
            const cat = categories.find(c => c.id === "tiktok_followers");
            if (cat) cat.products.splice(0, cat.products.length, ...generateTiktokFollowers(pricePerK));
            console.log(`[SYNC SOSMED] \u2705 Followers — Rp${pricePerK.toLocaleString("id-ID")}/1k (service ${KEDAI_SERVICE_ID})`);
            hasil.followers = pricePerK;
        }
    } catch (err) {
        console.log(`[SYNC SOSMED] \u26A0\uFE0F Followers gagal sync: ${err.message} — pakai fallback Rp${currentPricePerK.toLocaleString("id-ID")}`);
        hasil.sukses = false;
    }

    // ── View TikTok ──
    try {
        const pricePerK = await fetchServicePrice(KEDAI_VIEW_SERVICE_ID);
        if (pricePerK && pricePerK > 0) {
            currentViewPricePerK = pricePerK;
            const cat = categories.find(c => c.id === "tiktok_view");
            if (cat) cat.products.splice(0, cat.products.length, ...generateTiktokView(pricePerK));
            console.log(`[SYNC SOSMED] \u2705 View     — Rp${pricePerK.toLocaleString("id-ID")}/1k (service ${KEDAI_VIEW_SERVICE_ID})`);
            hasil.view = pricePerK;
        }
    } catch (err) {
        console.log(`[SYNC SOSMED] \u26A0\uFE0F View gagal sync: ${err.message} — pakai fallback Rp${currentViewPricePerK.toLocaleString("id-ID")}`);
        hasil.sukses = false;
    }

    // ── Likes TikTok ──
    try {
        const pricePerK = await fetchServicePrice(KEDAI_LIKES_SERVICE_ID);
        if (pricePerK && pricePerK > 0) {
            currentLikesPricePerK = pricePerK;
            const cat = categories.find(c => c.id === "tiktok_likes");
            if (cat) cat.products.splice(0, cat.products.length, ...generateTiktokLikes(pricePerK));
            console.log(`[SYNC SOSMED] \u2705 Likes    — Rp${pricePerK.toLocaleString("id-ID")}/1k (service ${KEDAI_LIKES_SERVICE_ID})`);
            hasil.likes = pricePerK;
        }
    } catch (err) {
        console.log(`[SYNC SOSMED] \u26A0\uFE0F Likes gagal sync: ${err.message} — pakai fallback Rp${currentLikesPricePerK.toLocaleString("id-ID")}`);
        hasil.sukses = false;
    }

    return hasil;
}

// =========================================
// SYNC HARGA OTOMATIS DARI API TOKOVOUCHER
// Hanya kategori freefire & mobilelegend
// =========================================

const KATEGORI_SYNC = new Set([
    "mobilelegend",
    "ovo",
    "data_smartfren",
    "data_tri",
    "data_telkomsel",
    "data_axis",
    "data_xl",
    "data_indosat",
    "data_byu",
    "pulsa_telkomsel",
    "pulsa_axis",
    "pulsa_xl_axis",
    "pulsa_indosat",
    "pulsa_smartfren",
    "pulsa_tri",
    "pulsa_byu"
]);

async function syncHargaDariAPI() {
    const { fetchHargaProduk } = require("./tokovoucher");

    let hargaMap;
    try {
        hargaMap = await fetchHargaProduk();
    } catch (err) {
        console.log("[SYNC HARGA] Gagal ambil harga dari API:", err.message);
        console.log("[SYNC HARGA] Menggunakan harga fallback (hardcoded).");
        return { sukses: false, diperbarui: 0, tidakDitemukan: [] };
    }

    let diperbarui       = 0;
    const tidakDitemukan = [];

    for (const cat of categories) {
        if (!KATEGORI_SYNC.has(cat.id)) continue;

        for (const prod of cat.products) {
            const hargaAPI = hargaMap.get(prod.kode);
            if (hargaAPI !== undefined) {
                prod.nominal = hargaAPI;
                diperbarui++;
            } else {
                tidakDitemukan.push(prod.kode);
            }
        }
    }

    if (tidakDitemukan.length > 0) {
        console.log("[SYNC HARGA] Kode tidak ditemukan di API (pakai fallback):", tidakDitemukan.join(", "));
    }

    console.log(`[SYNC HARGA] \u2705 Berhasil memperbarui ${diperbarui} produk dari API TokoVoucher.`);
    return { sukses: true, diperbarui, tidakDitemukan };
}

// =========================================
// HELPER FUNCTIONS
// =========================================

function getCategoryById(id) {
    return categories.find(c => c.id === id) || null;
}

function getProductByKode(kode) {
    for (const cat of categories) {
        const found = cat.products.find(p => p.kode === kode);
        if (found) return { ...found, kategori: cat };
    }
    return null;
}

function productForStorage(category, product) {
    return {
        kode: product.kode,
        kategoriId: category.id,
        label: product.label,
        nominal: Number(product.nominal || 0),
        hargaJual: product.hargaJual ?? null,
        metadata: product.quantity === undefined ? {} : { quantity: product.quantity }
    };
}

function applyDatabaseCatalog(rows) {
    for (const category of categories) {
        category.products = rows
            .filter(row => row.kategori_id === category.id && row.active)
            .map(row => ({
                label: row.label,
                kode: row.kode,
                nominal: Number(row.nominal),
                ...(row.harga_jual === null || row.harga_jual === undefined
                    ? {}
                    : { hargaJual: Number(row.harga_jual) }),
                ...(row.metadata && typeof row.metadata === "object" ? row.metadata : {})
            }));
    }
}

async function loadProductsFromDB() {
    const hardcodedProducts = categories.flatMap(category =>
        category.products.map(product => productForStorage(category, product))
    );
    await seedCatalogProducts(hardcodedProducts);
    const rows = await getCatalogProducts(false);
    applyDatabaseCatalog(rows);
    console.log(`[KATALOG] ${rows.length} produk aktif dimuat dari database.`);
    return rows;
}

// =========================================
// EXPORT
// =========================================

module.exports = {
    categories,
    groups,
    syncHargaSosmed,
    getCategoryById,
    getProductByKode,
    getSellingPrice,
    syncHargaDariAPI,
    loadProductsFromDB,
    applyDatabaseCatalog
};
