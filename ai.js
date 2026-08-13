const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const prompt = require("./prompt");
const { buildCatalogContext } = require("./catalog");
const knowledge = fs.readFileSync(
    path.join(__dirname, "knowledge.md"),
    "utf8"
);
const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY || "missing",
    baseURL: "https://openrouter.ai/api/v1"
});
// Fallback models — semua berbayar tapi murah (~$1-2/bulan untuk bot kecil)
// Urutan: dari yang terbaik ke yang paling ringan
const FALLBACK_MODELS = [
    "google/gemini-2.5-flash",          // utama — terbaik, murah, paham Indonesia
    "google/gemini-2.5-flash-lite",     // fallback 1 — lebih hemat
    "openai/gpt-4o-mini",               // fallback 2 — OpenAI, konsisten
    "meta-llama/llama-3.1-8b-instruct", // fallback 3 — open source
];
async function tryModel(model, messages) {
    const completion = await client.chat.completions.create({
        model,
        temperature: 0.3,
        max_tokens: 500,
        messages
    });
    const content = completion?.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty response");
    return content.trim();
}
async function askAI(question) {
    if (!process.env.OPENROUTER_API_KEY) {
        console.error("[AI] ERROR: OPENROUTER_API_KEY tidak di-set di env vars!");
        return "Maaf, Bantuan Admin sedang mengalami gangguan. Silakan coba beberapa saat lagi atau hubungi Admin.";
    }
    const systemContent = [
        prompt,
        "---",
        "# KNOWLEDGE BASE BOT",
        knowledge,
        "---",
        buildCatalogContext(question)
    ].join("\n\n");
    const messages = [
        { role: "system", content: systemContent },
        { role: "user", content: question }
    ];
    // Jika AI_MODEL di-set manual, pakai itu saja
    if (process.env.AI_MODEL) {
        const model = process.env.AI_MODEL;
        console.log(`[AI] Menggunakan model (manual): ${model}`);
        try {
            const result = await tryModel(model, messages);
            console.log("[AI] Berhasil:", model);
            return result;
        } catch (error) {
            console.error(`[AI] ERROR (${model}):`, error?.message, "| status:", error?.status);
            return "Maaf, Bantuan Admin sedang mengalami gangguan. Silakan coba beberapa saat lagi atau hubungi Admin.";
        }
    }
    // Auto-fallback: coba satu per satu sampai berhasil
    for (const model of FALLBACK_MODELS) {
        console.log(`[AI] Mencoba model: ${model}`);
        try {
            const result = await tryModel(model, messages);
            console.log(`[AI] Berhasil dengan model: ${model}`);
            return result;
        } catch (error) {
            const status = error?.status || error?.code;
            console.error(`[AI] Gagal (${model}): ${error?.message} | status: ${status}`);
            if (status !== 404 && status !== 429) break;
        }
    }
    return "Maaf, Bantuan Admin sedang mengalami gangguan. Silakan coba beberapa saat lagi atau hubungi Admin.";
}
module.exports = askAI;
