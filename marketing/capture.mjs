// Capture real DocAnchor UI states at 2x by serving the built SPA, mocking the
// API, and injecting crafted demo threads into localStorage (the real React
// components render them). No backend / Groq / Supabase needed → deterministic.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../frontend/dist");
const OUT = path.resolve(__dirname, "../docs/assets/raw");
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
  ".woff2": "font/woff2", ".ico": "image/x-icon",
};

// --- static server for frontend/dist (SPA fallback) ---
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  let fp = path.join(DIST, p);
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) fp = path.join(DIST, "index.html");
  res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
  fs.createReadStream(fp).pipe(res);
});
await new Promise((r) => server.listen(8088, r));
const BASE = "http://localhost:8088";
const SID = "demo";

// --- crafted demo content (real message shape) ---
const heroSources = [
  { id: 1, doc: "leave_policy.md", loc: "§ Leave Entitlements", match: "strong", text: "Casual leave: 12 days per year, accrued at 1 day per month. Part-time employees accrue on a pro-rata basis." },
  { id: 2, doc: "leave_policy.md", loc: "§ Leave Entitlements", match: "strong", text: "Sick leave: 10 days per year. A medical certificate is required for any sick leave of more than 2 consecutive days." },
  { id: 3, doc: "leave_policy.md", loc: "§ Leave Entitlements", match: "strong", text: "Earned (privilege) leave: 18 days per year, available after the 90-day probation period is completed." },
  { id: 4, doc: "leave_policy.md", loc: "§ Carry-Forward and Encashment", match: "strong", text: "Unused casual leave may carry forward up to a maximum of 30 days. Unused earned leave may be encashed up to 45 days at resignation or retirement." },
  { id: 5, doc: "employee_handbook.md", loc: "§ Probation Period", match: "partial", text: "New full-time employees serve a probation period of 90 days from their start date." },
];
const singleThread = [
  { id: "m1", role: "user", content: "How many leaves do I get?" },
  {
    id: "m2", role: "assistant", question: "How many leaves do I get?", streaming: false,
    model: "llama-3.1-8b-instant", grounding: "high", nSources: 5, latencyMs: 1800,
    sources: heroSources,
    suggestions: ["Can I carry unused leave into next year?"],
    content:
      "You're entitled to three types of paid leave per calendar year:\n\n" +
      "• Casual leave — 12 days, accrued at 1 day per month [1]\n" +
      "• Sick leave — 10 days [2]\n" +
      "• Earned leave — 18 days, available after the 90-day probation period [3]\n\n" +
      "Unused casual leave carries forward up to 30 days, and unused earned leave can be encashed up to 45 days [4].",
  },
];

// Fuller two-turn conversation for the hero (more visible content + detail).
const carrySources = [
  { id: 1, doc: "leave_policy.md", loc: "§ Carry-Forward and Encashment", match: "strong", text: "Unused casual leave may carry forward up to a maximum of 30 days. Casual leave is not encashable." },
  { id: 2, doc: "leave_policy.md", loc: "§ Carry-Forward and Encashment", match: "strong", text: "Unused earned leave carries forward without an upper cap, but only up to 45 days may be encashed at the time of resignation or retirement." },
  { id: 3, doc: "leave_policy.md", loc: "§ Carry-Forward and Encashment", match: "strong", text: "Sick leave does not carry forward and lapses at the end of the calendar year." },
  { id: 4, doc: "leave_policy.md", loc: "§ Applying for Leave", match: "partial", text: "Casual and earned leave must be applied for through the HR portal at least 3 working days in advance." },
];
const heroThread = [
  ...singleThread,
  { id: "m3", role: "user", content: "Does unused leave carry over to next year?" },
  {
    id: "m4", role: "assistant", question: "Does unused leave carry over to next year?", streaming: false,
    model: "llama-3.1-8b-instant", grounding: "high", nSources: 4, latencyMs: 1400,
    sources: carrySources,
    suggestions: ["How do I apply for earned leave?"],
    content:
      "It depends on the leave type:\n\n" +
      "• Casual leave carries forward up to 30 days [1]\n" +
      "• Earned leave has no carry-forward cap, but only 45 days can be encashed when you leave [2]\n" +
      "• Sick leave does not carry over — it lapses at the end of the year [3]",
  },
];

const greyThread = [
  { id: "m1", role: "user", content: "What's the work-from-home internet reimbursement?" },
  {
    id: "m2", role: "assistant", question: "wfh internet", streaming: false,
    model: "llama-3.3-70b-versatile", grounding: "partial", nSources: 2, latencyMs: 2100,
    sources: [
      { id: 1, doc: "employee_handbook.md", loc: "§ Compensation and Payroll", match: "partial", text: "Reimbursements (travel, internet, equipment) must be submitted with receipts by the 5th of the month to be included in that month's payroll." },
      { id: 2, doc: "employee_handbook.md", loc: "§ Benefits Overview", match: "partial", text: "Wellness stipend: $50 per month toward gym or wellness memberships." },
    ],
    suggestions: ["What expenses can I claim with receipts?"],
    content:
      "I couldn't find a specific work-from-home internet amount in the documents. The handbook notes that internet reimbursements must be submitted with receipts by the 5th of the month [1], but it doesn't state a fixed sum — you'd need a separate IT or remote-work policy for the exact figure.",
  },
];

const ALL_DOCS = ["employee_handbook.md", "leave_policy.md", "code_of_conduct.md"];

const browser = await chromium.launch();

async function shot(name, { width, height, thread, healthOk = true, action } = {}) {
  const ctx = await browser.newContext({ deviceScaleFactor: 2, colorScheme: "dark", viewport: { width, height } });
  const page = await ctx.newPage();
  await page.route("**/api/health", (r) => (healthOk ? r.fulfill({ json: { status: "ok", db: true } }) : r.abort()));
  await page.route("**/api/session/docs**", (r) => r.fulfill({ json: { docs: [], has_uploads: false, all_docs: ALL_DOCS } }));
  await page.addInitScript(([sid, th]) => {
    localStorage.setItem("docsrag_theme", "dark");
    localStorage.setItem("docsrag_session", sid);
    if (th) localStorage.setItem("docsrag_chat_" + sid, th);
  }, [SID, thread ? JSON.stringify(thread) : null]);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(healthOk ? 1600 : 700); // boot fade / settle
  if (action) { await action(page); await page.waitForTimeout(700); }
  await page.screenshot({ path: path.join(OUT, name + ".png") });
  await ctx.close();
  console.log("captured", name);
}

await shot("hero_ui", { width: 1280, height: 860, thread: heroThread });
await shot("citations", { width: 1200, height: 820, thread: singleThread, action: (p) => p.click('[aria-label="Jump to source 1"]') });
await shot("grounding", { width: 920, height: 560, thread: singleThread });
await shot("honesty", { width: 1040, height: 600, thread: greyThread });
await shot("upload", { width: 1120, height: 760, thread: heroThread, action: (p) => p.click('[title="Upload documents"]') });
await shot("docs", { width: 1120, height: 760, thread: heroThread, action: (p) => p.click('[title="Manage documents"]') });
await shot("empty", { width: 1220, height: 780 });
await shot("boot", { width: 1220, height: 820, healthOk: false });

await browser.close();
server.close();
console.log("done");
