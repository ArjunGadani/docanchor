// Render the HTML poster + feature templates to crisp 2x PNGs.
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../docs/assets");
const posterURL = pathToFileURL(path.join(__dirname, "poster.html")).href;
const featureURL = pathToFileURL(path.join(__dirname, "feature.html")).href;

const FEATURES = [
  { file: "feature-citations", img: "citations.png", w: 1180,
    title: "Inline citations, cross-highlighted", sub: "Click any [n] to highlight the exact passage it came from." },
  { file: "feature-grounding", img: "grounding.png", w: 1000,
    title: "Grounding score + answer stats", sub: "High/partial grounding, model, source count and latency on every answer." },
  { file: "feature-honesty", img: "honesty.png", w: 1140,
    title: "Honest about gaps", sub: "When the docs don't fully answer, it hedges and cites — never invents." },
  { file: "feature-upload", img: "upload.png", w: 1100,
    title: "Upload files or a URL", sub: "Drag in PDF/DOCX/TXT/MD, or paste a web page to ingest." },
  { file: "feature-docs", img: "docs.png", w: 1100,
    title: "Manage & scope documents", sub: "Choose which documents an answer may draw from." },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2 });
const page = await ctx.newPage();

async function renderEl(url, selector, out) {
  await page.setViewportSize({ width: 1680, height: 1080 });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(700); // fonts + images settle
  await page.locator(selector).screenshot({ path: path.join(OUT, out) });
  console.log("rendered", out);
}

// Hero poster
await renderEl(posterURL, "#poster", "hero.png");

// Feature images
for (const f of FEATURES) {
  const u = `${featureURL}?img=${f.img}&w=${f.w}&title=${encodeURIComponent(f.title)}&sub=${encodeURIComponent(f.sub)}`;
  await renderEl(u, "#card", f.file + ".png");
}

await browser.close();
console.log("all rendered");
