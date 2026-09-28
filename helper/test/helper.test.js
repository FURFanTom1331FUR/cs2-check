import { test } from "node:test";
import assert from "node:assert/strict";
import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
import { CMsgGCCStrike15_v2_MatchListSchema } from "csgo-protobuf";
import { summarizeList, summarizeMatch } from "../lib/matchinfo.js";
import { createHelperServer } from "../lib/server.js";
import { createBoilerBackend, boilerBinary } from "../lib/boiler.js";
import { createBotBackend } from "../lib/bot.js";
import { HelperError } from "../lib/errors.js";

const DEMO = "http://replay183.valve.net/730/003712345678901234567_1234567890.dem.bz2";

test("ссылка на демку из MatchList (csgo-protobuf)", () => {
  const msg = create(CMsgGCCStrike15_v2_MatchListSchema, {
    matches: [{
      matchid: 3230642215713767580n,
      matchtime: 1790000000,
      roundstatsall: [
        { reservationid: 3230647599455273103n, map: "", teamScores: [0, 1] },
        { reservationid: 3230647599455273103n, map: DEMO, teamScores: [13, 9], reservation: { gameType: 8 } },
      ],
    }],
  });
  const list = summarizeList(fromBinary(CMsgGCCStrike15_v2_MatchListSchema, toBinary(CMsgGCCStrike15_v2_MatchListSchema, msg)));
  assert.equal(list.length, 1);
  assert.equal(list[0].matchId, "3230642215713767580");
  assert.equal(list[0].demoUrl, DEMO);
  assert.deepEqual(list[0].score, [13, 9]);
  assert.equal(list[0].rounds, 2);
  assert.equal(list[0].time, new Date(1790000000 * 1000).toISOString());
});

test("ссылка на демку из ответа globaloffensive (строки, snake_case) и чужие ссылки", () => {
  const m = summarizeMatch({ matchid: "1", matchtime: 0, roundstatsall: [{ map: DEMO, team_scores: [5, 9] }] });
  assert.equal(m.demoUrl, DEMO);
  assert.deepEqual(m.score, [5, 9]);
  assert.equal(summarizeMatch({ matchid: "1", roundstatsall: [{ map: "http://evil.com/730/1_2.dem.bz2" }] }).demoUrl, null);
  assert.equal(summarizeMatch({ matchid: "1", roundstatsall: [] }).demoUrl, null);
});

// --- HTTP-сервер помощника с поддельным бэкендом ---
async function withServer(backend, fn, opts = {}) {
  const server = createHelperServer({ backend, port: 0, log: () => {}, ...opts });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  // Host-проверка использует порт из настроек — пересоздаём с реальным портом.
  server.close();
  const real = createHelperServer({ backend, port, log: () => {}, ...opts });
  await new Promise((r) => real.listen(port, "127.0.0.1", r));
  try { await fn(`http://127.0.0.1:${port}`, port); } finally { real.close(); }
}
const fake = {
  name: "fake",
  status: () => ({ ready: true, detail: "ok" }),
  match: async (d) => ({ matchId: d.matchId, demoUrl: DEMO }),
  recent: async () => [{ matchId: "1", demoUrl: DEMO }],
};
const SITE = "https://cs2-check.pages.dev";
const CODE = "CSGO-GADqf-jjyJ8-cSP2r-smZRo-TO2xK";

test("помощник: health, CORS, Private Network, запрет чужих сайтов", async () => {
  await withServer(fake, async (base) => {
    let r = await fetch(`${base}/health`, { headers: { origin: SITE } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("access-control-allow-origin"), SITE);
    assert.equal((await r.json()).app, "cs2-check-helper");

    r = await fetch(`${base}/match`, { method: "OPTIONS", headers: { origin: SITE, "access-control-request-method": "POST", "access-control-request-private-network": "true" } });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get("access-control-allow-private-network"), "true");
    assert.equal(r.headers.get("access-control-allow-origin"), SITE);

    r = await fetch(`${base}/health`, { headers: { origin: "https://abc123.cs2-check.pages.dev" } });
    assert.equal(r.headers.get("access-control-allow-origin"), "https://abc123.cs2-check.pages.dev");

    for (const evil of ["https://evil.example", "https://cs2-check.pages.dev.evil.com", "null"]) {
      r = await fetch(`${base}/match`, { method: "POST", headers: { origin: evil, "content-type": "application/json" }, body: JSON.stringify({ shareCode: CODE }) });
      assert.equal(r.status, 403, evil);
      assert.equal(r.headers.get("access-control-allow-origin"), null);
    }
  });
});

test("помощник: DNS-rebinding (чужой Host) отклоняется", async () => {
  await withServer(fake, async (_base, port) => {
    const http = await import("node:http");
    const status = await new Promise((resolve) => {
      http.get({ host: "127.0.0.1", port, path: "/health", headers: { host: `evil.example:${port}` } }, (res) => { res.resume(); resolve(res.statusCode); });
    });
    assert.equal(status, 403);
  });
});

test("помощник: /match проверяет код и отдаёт ссылку", async () => {
  await withServer(fake, async (base) => {
    let r = await fetch(`${base}/match`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify({ shareCode: CODE }) });
    let j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.match.matchId, "3230642215713767580");
    assert.equal(j.match.demoUrl, DEMO);

    r = await fetch(`${base}/match`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify({ shareCode: "CSGO-bad" }) });
    assert.equal(r.status, 400);
    r = await fetch(`${base}/match`, { method: "POST", headers: { origin: SITE, "content-type": "text/plain" }, body: "{}" });
    assert.equal(r.status, 415);
  });
});

test("помощник: /demo пропускает только серверы повторов Valve", async () => {
  let fetched = null;
  const fetchReplay = async (url, res, cors) => { fetched = url; res.writeHead(200, { "content-type": "application/x-bzip2", ...cors }); res.end("BZh9"); };
  await withServer(fake, async (base) => {
    for (const bad of ["http://evil.com/730/1_2.dem.bz2", "https://replay1.valve.net/730/1_2.dem.bz2", "http://replay1.valve.net.evil.com/730/1_2.dem.bz2", "http://replay1.valve.net/730/../../etc", "file:///etc/passwd"]) {
      const r = await fetch(`${base}/demo?url=${encodeURIComponent(bad)}`, { headers: { origin: SITE } });
      assert.equal(r.status, 400, bad);
    }
    assert.equal(fetched, null);
    const r = await fetch(`${base}/demo?url=${encodeURIComponent(DEMO)}`, { headers: { origin: SITE } });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "BZh9");
    assert.equal(fetched, DEMO);
  }, { fetchReplay });
});

test("помощник: ошибки бэкенда доходят до сайта понятным текстом", async () => {
  const broken = { ...fake, match: async () => { throw new HelperError("steam_not_running", "Steam не запущен", 502); } };
  await withServer(broken, async (base) => {
    const r = await fetch(`${base}/match`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify({ shareCode: CODE }) });
    assert.equal(r.status, 502);
    assert.deepEqual((await r.json()).error, { code: "steam_not_running", message: "Steam не запущен" });
  });
});

test("boiler: коды выхода переводятся в понятные ошибки", async () => {
  for (const [code, kind] of [[6, "steam_not_running"], [4, "cs2_running"], [8, "no_matches"], [3, "gc_unavailable"]]) {
    const run = (_bin, _args, _opts, cb) => { setImmediate(() => cb(Object.assign(new Error("x"), { code }))); return {}; };
    const b = createBoilerBackend({ binary: "/fake/boiler", run });
    await assert.rejects(b.match({ matchId: "1", outcomeId: "2", token: 3 }), (e) => e.kind === kind, String(code));
  }
  assert.equal(createBoilerBackend({ binary: null }).status().ready, false);
});

test("boiler: настоящий бинарник без запущенного Steam (если есть для этой ОС)", { skip: !boilerBinary() }, async () => {
  const b = createBoilerBackend();
  await assert.rejects(b.recent(), (e) => e instanceof HelperError && ["steam_not_running", "steam_not_logged_in", "boiler_error"].includes(e.kind));
});

test("bot: без учётных данных — понятная ошибка, без попытки входа", async () => {
  let constructed = false;
  const libs = { SteamUser: function () { constructed = true; }, GlobalOffensive: function () {} };
  const b = createBotBackend({ env: { BOT_DATA_DIR: "/tmp/cs2check-bot-test-none" }, libs, log: () => {} });
  await assert.rejects(b.match({ matchId: "1", outcomeId: "2", token: 3 }), (e) => e.kind === "bot_error" || e.kind === "not_configured");
  assert.equal(constructed, false);
  assert.equal(b.status().ready, false);
  assert.match(b.status().detail, /BOT_STEAM_LOGIN/);
});
