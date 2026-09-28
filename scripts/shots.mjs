// Скриншоты страницы в headless Chrome: node scripts/shots.mjs <baseUrl> <outDir> <prefix>
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright-core"); } catch { pw = require("/usr/local/lib/node_modules/playwright-core"); }

const base = process.argv[2] || "http://127.0.0.1:8788";
const out = process.argv[3] || "shots";
const prefix = process.argv[4] || "local";
const browser = await pw.chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const errors = [];

async function page(viewport, mobile = false) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, locale: "ru-RU" });
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error") errors.push(`${viewport.width}: ${m.text()}`); });
  p.on("pageerror", (e) => errors.push(`${viewport.width}: ${e.message}`));
  return p;
}

// 1) Десктоп: ввод VAC-профиля через форму
const d = await page({ width: 1280, height: 900 });
await d.goto(base + "/", { waitUntil: "networkidle" });
await d.fill("#q", "https://steamcommunity.com/profiles/76561197999345297");
await d.click("#go");
await d.waitForSelector("#result:not([hidden]) .card", { timeout: 20000 });
await d.waitForLoadState("networkidle");
await d.waitForFunction(() => { const i = document.querySelector("img.avatar"); return !i || i.complete; }, null, { timeout: 10000 }).catch(() => {});
console.log("avatar loaded:", await d.evaluate(() => document.querySelector("img.avatar")?.naturalWidth > 0));
console.log("desktop name:", await d.textContent(".pname"), "| flags:", await d.$$eval(".flag h3", (e) => e.map((x) => x.textContent)));
console.log("url:", d.url());
await d.screenshot({ path: `${out}/${prefix}-desktop-vac.png`, fullPage: true });

// 2) Мобильный: открытие по ?q= (vanity)
const m = await page({ width: 390, height: 844 }, true);
await m.goto(base + "/?q=robinwalker", { waitUntil: "networkidle" });
await m.waitForSelector("#result:not([hidden]) .card", { timeout: 20000 });
await m.waitForLoadState("networkidle");
await m.waitForFunction(() => { const i = document.querySelector("img.avatar"); return !i || i.complete; }, null, { timeout: 10000 }).catch(() => {});
console.log("mobile name:", await m.textContent(".pname"), "| overflowX:", await m.evaluate(() => document.documentElement.scrollWidth > innerWidth));
await m.screenshot({ path: `${out}/${prefix}-mobile.png`, fullPage: true });

// 3) Ошибки: неверный ввод и несуществующий профиль
await m.fill("#q", "hello world"); await m.click("#go");
await m.waitForSelector(".alert.error", { timeout: 15000 });
console.log("bad input:", (await m.textContent(".alert.error")).trim());
await m.fill("#q", "zzqqxx_nonexist_998877"); await m.click("#go");
await m.waitForFunction(() => document.querySelector(".alert.error h3")?.textContent === "Профиль не найден", null, { timeout: 15000 });
console.log("not found:", (await m.textContent(".alert.error")).trim());
await m.screenshot({ path: `${out}/${prefix}-mobile-error.png` });

// 4) Скрытый профиль
await m.fill("#q", "gabelogannewell"); await m.click("#go");
await m.waitForSelector("#result:not([hidden]) .card", { timeout: 20000 });
console.log("private:", await m.$$eval(".badge", (e) => e.map((x) => x.textContent)), await m.$$eval(".flag h3", (e) => e.map((x) => x.textContent)));

console.log("console errors:", errors.length ? errors : "none");
await browser.close();
