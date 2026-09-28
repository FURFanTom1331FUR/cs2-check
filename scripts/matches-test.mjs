// Проверка страницы «Мои матчи» и загрузки демки по ссылке в headless Chrome.
// node scripts/matches-test.mjs <baseUrl> [shotPrefix] [demo.dem.bz2]
// Реальных кодов нет: успешный ответ /api/matches подменяется, ошибки — настоящие (фейковые коды).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright-core"); } catch { pw = require("/usr/local/lib/node_modules/playwright-core"); }
const [base = "http://127.0.0.1:8788", prefix = "", bz2 = ""] = process.argv.slice(2);
const browser = await pw.chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "ru-RU" });
// Chrome 142+ (Local Network Access): публичный сайт → 127.0.0.1 только с разрешения пользователя.
// В headless запрос разрешения автоматически отклоняется, поэтому выдаём разрешение явно (как нажатие «Разрешить»).
if (base.startsWith("https:")) await ctx.grantPermissions(["local-network-access"], { origin: new URL(base).origin }).catch((e) => console.log("grant failed:", e.message));
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
const shot = async (name, full = true) => { if (prefix) await p.screenshot({ path: `shots/${prefix}-${name}.png`, fullPage: full }); };
const CODES = ["CSGO-GADqf-jjyJ8-cSP2r-smZRo-TO2xK", "CSGO-bPQEz-PrYTq-u5w8E-ZbUy7-ZeQ3A", "CSGO-wBrm6-7fkM6-AzBC5-u6GmR-iHLHA", "CSGO-L9spZ-ihuov-cyhtE-kxbqa-FkBAA"];

// 1. Настоящий запрос с фейковым кодом аутентификации → понятная ошибка.
await p.goto(base + "/matches", { waitUntil: "networkidle" });
await p.fill("#q", "76561197960435530");
await p.fill("#auth", "AAAA-AAAAA-AAAA");
await p.fill("#known", `steam://rungame/730/76561202255233023/+csgo_download_match%20${CODES[0]}`);
await p.click("#go");
await p.waitForSelector(".alert.error", { timeout: 30000 });
console.log("1. fake auth:", (await p.$eval(".alert.error", (e) => e.innerText)).replace(/\s+/g, " "));
console.log("   known normalized:", await p.inputValue("#known"), "| bad field:", await p.$eval("#auth", (e) => e.classList.contains("bad")));
await shot("error");

// 2. Неверный формат — проверка до запроса.
await p.fill("#auth", "AAAA-AAAA-AAAA");
await p.click("#go");
console.log("2. format:", (await p.$eval(".alert.error h3", (e) => e.innerText)));

// 3. Успешный ответ (подмена) → список, localStorage.
let body = null;
await p.route("**/api/matches", async (route) => {
  body = JSON.parse(route.request().postData());
  const { decodeShareCode } = await import("../public/js/sharecode.js");
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    ok: true, knownCode: body.knownCode,
    player: { steamid: "76561197960435530", name: "Robin Walker", avatar: "", profileUrl: "" },
    matches: CODES.slice(1).map(decodeShareCode), newestCode: CODES[3], finished: false, hasMore: true, warning: null,
  }) });
});
await p.fill("#auth", "bbbb-22222-cccc");
await p.click("#go");
await p.waitForSelector(".mitem");
console.log("3. request body keys:", Object.keys(body), "auth upper:", body.authCode);
console.log("   items:", await p.$$eval(".mitem", (e) => e.length), "new:", await p.$$eval(".mitem.new", (e) => e.length), "alerts:", await p.$$eval("#status .alert h3", (e) => e.map((x) => x.innerText)));
console.log("   known now:", await p.inputValue("#known"));
const ls = await p.evaluate(() => JSON.parse(localStorage.getItem("cs2check.matches.v1")));
console.log("   localStorage:", { q: ls.q, auth: ls.authCode, lastCode: ls.lastCode, history: ls.history.length });
await p.evaluate(() => scrollTo(0, 0));
await shot("list");

// 4. Помощник (настоящий, на этом компьютере, режим boiler без Steam) → понятная ошибка.
await p.click("#helper-check");
await p.waitForFunction(() => !/Проверяем/.test(document.querySelector("#helper-state").textContent));
console.log("4. helper:", await p.$eval("#helper-state", (e) => e.textContent));
await p.click(".mitem .btn.ghost");
await p.waitForSelector(".mitem-msg.err, .mitem-msg .ok-text", { timeout: 120000 });
console.log("   demo:", await p.$eval(".mitem-msg", (e) => e.textContent));
await p.evaluate(() => document.querySelector(".mitem").scrollIntoView());
await shot("helper", false);

// 5. Мобильная вёрстка после перезагрузки (данные из localStorage).
await p.unroute("**/api/matches");
await p.setViewportSize({ width: 390, height: 844 });
await p.reload({ waitUntil: "networkidle" });
console.log("5. restored:", await p.inputValue("#q"), (await p.inputValue("#auth")).length, "chars auth,", await p.$$eval(".mitem", (e) => e.length), "items; overflowX:", await p.evaluate(() => document.documentElement.scrollWidth > innerWidth));
await shot("mobile", true);

// 6. Забыть данные.
p.once("dialog", (d) => d.accept());
await p.click("#player .btn.ghost");
console.log("6. after forget:", await p.evaluate(() => localStorage.getItem("cs2check.matches.v1")), await p.$$eval(".mitem", (e) => e.length));
await p.setViewportSize({ width: 1360, height: 900 });

// 7. Демка по ссылке через прокси /api/replay (ответ Valve подменён локальным .dem.bz2).
const DEMO = "http://replay183.valve.net/730/003712345678901234567_1234567890.dem.bz2";
await p.goto(base + "/matches", { waitUntil: "networkidle" });
await p.fill("#demo-url", "http://evil.com/x.dem.bz2");
await p.click("#urlform button");
console.log("7. bad url:", await p.$eval(".alert.error h3", (e) => e.innerText));
if (bz2) {
  // Полный путь: «Получить демку» у помощника (scripts/fake-helper.mjs со стримом локального .bz2) → разбор.
  await p.route("**/api/matches", async (route) => {
    const b = JSON.parse(route.request().postData());
    const { decodeShareCode } = await import("../public/js/sharecode.js");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, knownCode: b.knownCode, player: { steamid: "76561197960435530", name: "Robin Walker", avatar: "" }, matches: [decodeShareCode(CODES[1])], newestCode: CODES[1], finished: true, hasMore: false, warning: null }) });
  });
  await p.fill("#q", "76561197960435530"); await p.fill("#auth", "AAAA-AAAAA-AAAA"); await p.fill("#known", CODES[0]);
  await p.click("#go");
  await p.waitForSelector(".mitem");
  await p.click("#helper-check");
  await p.waitForFunction(() => /найден/.test(document.querySelector("#helper-state").textContent));
  await p.click(".mitem .btn.ghost");
  await p.waitForSelector(".mitem-msg .ok-text", { timeout: 30000 });
  console.log("   demo link:", await p.$eval(".mitem-msg", (e) => e.textContent));
  await p.evaluate(() => document.querySelector(".mitem").scrollIntoView());
  await shot("demo-found", false);
  const t0 = Date.now();
  await Promise.all([p.waitForURL(/\/demo\?src=/), p.click(".mitem-msg a")]);
  console.log("   url:", decodeURIComponent(p.url().replace(base, "")));
  await p.waitForSelector("#progress:not([hidden])");
  await p.waitForTimeout(2500);
  await shot("download-progress", false);
  await p.waitForFunction(() => !document.querySelector("#result").hidden || document.querySelector(".alert.error"), null, { timeout: 600000 });
  const err = await p.$eval(".alert.error", (e) => e.innerText).catch(() => null);
  console.log("   result:", err ? "ERROR " + err : (await p.$eval(".mh-score", (e) => e.innerText.replace(/\s+/g, " "))), "in", Date.now() - t0, "ms");
  if (!err) {
    console.log("   stats:", await p.$$eval(".stats > *", (e) => e.map((x) => x.innerText.replace(/\s+/g, " ")).join(" | ")));
    console.log("   top row:", await p.$eval("table.sb tbody tr", (tr) => tr.innerText.replace(/\s+/g, " ")));
    await p.evaluate(() => scrollTo(0, 0));
    await shot("demo-result", true);
  }
  await p.unroute("**/api/matches");
}

// 8. Запрещённый источник в /demo?src=
await p.goto(base + "/demo?src=" + encodeURIComponent("https://evil.example/x.dem.bz2"), { waitUntil: "networkidle" });
console.log("8. evil src:", await p.$eval(".alert.error h3", (e) => e.innerText));
// 9. Настоящий прокси с несуществующей демкой → «удалена».
await p.goto(base + "/demo?src=" + encodeURIComponent("/api/replay?url=" + encodeURIComponent("http://replay181.valve.net/730/003700000000000000000_0000000000.dem.bz2")), { waitUntil: "networkidle" });
await p.waitForSelector(".alert.error", { timeout: 60000 });
console.log("9. expired:", (await p.$eval(".alert.error", (e) => e.innerText)).replace(/\s+/g, " "));
await shot("expired", false);

console.log("errors:", errors.length ? errors : "none");
await browser.close();
