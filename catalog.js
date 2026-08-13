const { categories, groups, getSellingPrice } = require("../products");

const CATEGORY_ALIASES = {
    dana: ["dana", "e-wallet", "ewallet"],
    gopay: ["gopay", "go pay"],
    shopee: ["shopee", "shopeepay", "shopee pay"],
    pln: ["pln", "token listrik", "token"],
    freefire: ["free fire", "freefire", "ff", "diamond ff"],
    mobilelegend: ["mobile legends", "mobile legend", "ml", "diamond ml"],
    tiktok_followers: ["followers", "follower", "tiktok follower", "tiktok followers"],
    tiktok_view: ["view", "views", "tiktok view", "tiktok views"],
    tiktok_likes: ["like", "likes", "tiktok like", "tiktok likes"],
    data_tri: ["tri", "three", "paket tri", "paket three"],
    data_telkomsel: ["telkomsel", "tsel", "paket telkomsel"],
    data_axis: ["axis", "paket axis"],
    data_xl: ["xl", "paket xl"],
    data_indosat: ["indosat", "im3", "freedom"],
    data_byu: ["by.u", "byu", "by u", "paket by.u"]
};

function rupiah(value) {
    if (!Number.isFinite(value) || value <= 0) return "belum tersedia";
    return `Rp${Math.round(value).toLocaleString("id-ID")}`;
}

function normalize(value) {
    return String(value || "")
        .toLocaleLowerCase("id-ID")
        .replace(/[^\p{L}\p{N}.]+/gu, " ")
        .trim();
}

function categoryMatchesQuestion(category, question) {
    const normalizedQuestion = normalize(question);
    const terms = [
        category.id,
        category.label,
        ...(CATEGORY_ALIASES[category.id] || [])
    ];

    return terms.some(term => normalizedQuestion.includes(normalize(term)))
        || category.products.some(product => {
            const label = normalize(product.label);
            const kode = normalize(product.kode);
            return (label.length > 2 && normalizedQuestion.includes(label))
                || (kode.length > 2 && normalizedQuestion.includes(kode));
        });
}

function formatCategory(category, includeProducts) {
    const lines = [
        `## ${category.label}`,
        `Produk aktif: ${category.products.length}`
    ];

    if (!includeProducts) return lines.join("\n");

    for (const product of category.products) {
        const sellingPrice = getSellingPrice({ ...product, kategori: category });
        const nominal = rupiah(product.nominal);
        const price = product.nominal > 0 ? rupiah(sellingPrice) : "belum tersedia";
        lines.push(`- ${product.label} | kode ${product.kode} | nominal supplier ${nominal} | harga jual ${price}`);
    }

    return lines.join("\n");
}

function buildCatalogContext(question = "") {
    const relevantCategories = categories.filter(category => categoryMatchesQuestion(category, question));
    const asksForAll = /\b(semua|seluruh|daftar lengkap|semua produk|produk apa saja|apa saja yang dijual)\b/i.test(question);

    // For a specific question, only send matching categories so the AI has
    // room to reason over every product in that category. For broad questions,
    // send the complete live catalog.
    const selected = asksForAll || relevantCategories.length === 0
        ? categories
        : relevantCategories;

    const overview = groups
        .map(group => `${group.label}: ${group.categoryIds.map(id => {
            const category = categories.find(item => item.id === id);
            return category ? `${category.label} (${category.products.length} produk)` : id;
        }).join(", ")}`)
        .join("\n");

    return [
        "KATALOG PRODUK LIVE Ã¢ÂÂ SUMBER UTAMA UNTUK NOMINAL DAN HARGA",
        "Data ini dibuat langsung dari products.js saat pertanyaan dijawab.",
        "Jika harga jual tertulis 'belum tersedia', jangan mengarang harga; arahkan pengguna melihat menu bot atau hubungi Admin.",
        "",
        "RINGKASAN KATEGORI:",
        overview,
        "",
        "DETAIL KATALOG YANG RELEVAN:",
        selected.map(category => formatCategory(category, true)).join("\n\n")
    ].join("\n");
}

module.exports = { buildCatalogContext };
