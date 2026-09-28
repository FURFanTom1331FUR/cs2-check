// Проверка разбора демки в headless Chrome: node scripts/demo-test.mjs <baseUrl> <demo.dem> [shotPrefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright-core"); } catch { pw = require("/usr/local/lib/node_modules/playwright-core"); }
const [base = "http://127.0.0.1:8788", demo, prefix = ""] = process.argv.slice(2);
const browser = await pw.chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--cs2check-test-marker"] });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "ru-RU" });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await p.goto(base + "/demo", { waitUntil: "networkidle" });

// Пиковая память процессов Chrome во время разбора (RSS, МБ).
let peak = 0;
const rssTree = () => {
  const rows = execSync("ps -eo pid=,ppid=,rss=,args=").toString().trim().split("\n").map((l) => l.trim().split(/\s+/));
  const root = rows.find((r) => r.slice(3).join(" ").includes("--cs2check-test-marker") && !r.slice(3).join(" ").includes("--type="));
  if (!root) return 0;
  const ids = new Set([root[0]]);
  let grew = true;
  while (grew) { grew = false; for (const r of rows) if (ids.has(r[1]) && !ids.has(r[0])) { ids.add(r[0]); grew = true; } }
  return rows.filter((r) => ids.has(r[0])).reduce((a, r) => a + +r[2], 0) / 1024;
};
const sampler = setInterval(() => { try { peak = Math.max(peak, rssTree()); } catch {} }, 300);

const t0 = Date.now();
await p.setInputFiles("#file", demo);
await p.waitForFunction(() => !document.querySelector("#result").hidden || document.querySelector(".alert.error"), null, { timeout: 600000 });
const wall = Date.now() - t0;
clearInterval(sampler);
const err = await p.$eval(".alert.error", (e) => e.innerText).catch(() => null);
if (err) console.log("ERROR:", err);
else {
  console.log("wall", wall, "ms; note:", await p.$eval(".match-head .note", (e) => e.textContent));
  console.log("score:", await p.$eval(".mh-score", (e) => e.innerText.replace(/\s+/g, " ")));
  const rows = await p.$$eval("table.sb tbody tr", (trs) => trs.map((tr) => [...tr.children].map((td) => td.innerText.trim()).join(" | ")));
  console.log(rows.join("\n"));
  console.log("rounds:", await p.$$eval(".rchip[role=listitem]", (e) => e.length), "links:", await p.$$eval("td.pl a", (as) => as.slice(0, 2).map((a) => a.getAttribute("href"))));
  console.log("recent:", await p.$$eval(".recent-item", (e) => e.length));
  if (prefix) {
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(300);
    await p.screenshot({ path: `shots/${prefix}-desktop.png`, fullPage: true });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.reload({ waitUntil: "networkidle" });
    await p.click(".recent-open");
    await p.waitForSelector("#result:not([hidden])");
    await p.screenshot({ path: `shots/${prefix}-mobile.png`, fullPage: false });
    console.log("mobile overflowX:", await p.evaluate(() => document.documentElement.scrollWidth > innerWidth));
    await p.evaluate(() => document.querySelector("table.sb").closest(".card").scrollIntoView());
    await p.waitForTimeout(300);
    await p.screenshot({ path: `shots/${prefix}-mobile-table.png`, fullPage: false });
  }
}
console.log("chrome peak RSS ~", peak.toFixed(0), "MB");
console.log("errors:", errors.length ? errors : "none");
await browser.close();
