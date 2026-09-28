import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeShareCode, encodeShareCode, normalizeShareCode } from "../public/js/sharecode.js";
import { walkShareCodes, normalizeAuthCode, ShareCodeError } from "../src/steam/sharecodes.js";

// Эталоны из akiver/csgo-sharecode (src/index.test.ts).
const SAMPLES = [
  ["CSGO-L9spZ-ihuov-cyhtE-kxbqa-FkBAA", "3400360672356205056", "3400367402569957763", 9725],
  ["CSGO-GADqf-jjyJ8-cSP2r-smZRo-TO2xK", "3230642215713767580", "3230647599455273103", 55788],
  ["CSGO-bPQEz-PrYTq-u5w8E-ZbUy7-ZeQ3A", "3325408798641750542", "3325410334092558852", 240],
  ["CSGO-wBrm6-7fkM6-AzBC5-u6GmR-iHLHA", "3302232779302895618", "3302241568953467250", 3085],
  ["CSGO-TKDTJ-YrAXs-sDNfL-HOuKO-i84VH", "3402250361329680757", "3402250801563828781", 61630],
  ["CSGO-p4X9o-3Mfut-tpe5y-J8K6f-mj5ZJ", "3402249502336221574", "3402252092201501292", 14119],
];

test("декодирование кодов матчей (эталоны csgo-sharecode)", () => {
  for (const [code, matchId, outcomeId, token] of SAMPLES) {
    assert.deepEqual(decodeShareCode(code), { code, matchId, outcomeId, token });
  }
});

test("кодирование и обратное преобразование", () => {
  for (const [code, matchId, outcomeId, token] of SAMPLES) {
    assert.equal(encodeShareCode({ matchId, outcomeId, token }), code);
  }
  for (let i = 0; i < 200; i++) {
    const r = () => BigInt(Math.floor(Math.random() * 2 ** 32)) << 32n | BigInt(Math.floor(Math.random() * 2 ** 32));
    const m = { matchId: r().toString(), outcomeId: r().toString(), token: Math.floor(Math.random() * 65536) };
    const code = encodeShareCode(m);
    assert.deepEqual(decodeShareCode(code), { code, ...m });
  }
});

test("нормализация и отклонение плохих кодов", () => {
  const c = SAMPLES[1][0];
  assert.equal(normalizeShareCode(`  ${c}  `), c);
  assert.equal(normalizeShareCode(`steam://rungame/730/76561202255233023/+csgo_download_match%20${c}`), c);
  for (const bad of ["", "CSGO-12345-12345-12345-12345-1234", "CSGO-GADqf-jjyJ8-cSP2r-smZRo-TO2x0", "CSGO-GADqf-jjyJ8-cSP2r-smZRo-TO2xl",
    "csgo-GADqf-jjyJ8-cSP2r-smZRo-TO2xK", "GADqf-jjyJ8-cSP2r-smZRo-TO2xK", null, 42]) {
    assert.equal(normalizeShareCode(bad), null, String(bad));
    assert.throws(() => decodeShareCode(bad), TypeError);
  }
  // 25 символов «9» — больше 18 байт.
  assert.throws(() => decodeShareCode("CSGO-99999-99999-99999-99999-99999"), TypeError);
});

test("формат кода аутентификации", () => {
  assert.equal(normalizeAuthCode(" abcd-12345-ef9z "), "ABCD-12345-EF9Z");
  for (const bad of ["", "ABCD12345EF9Z", "ABCD-1234-EF9Z", "ABCD-12345-EF9Z-", "АБВГ-12345-EF9Z", null]) assert.equal(normalizeAuthCode(bad), null);
});

// --- обход цепочки с подменённым fetch ---
const chain = SAMPLES.map((s) => s[0]);
function fakeSteam(handler) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    calls.push(u.searchParams.get("knowncode"));
    const [status, body] = handler(u.searchParams.get("knowncode"), calls.length, u);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return { fetchImpl, calls };
}
const base = { key: "k", steamid: "76561197960435530", authCode: "AAAA-AAAAA-AAAA" };

test("цепочка: новые матчи до «n/a»", async () => {
  const { fetchImpl, calls } = fakeSteam((known) => {
    const i = chain.indexOf(known);
    return i < 3 ? [200, { result: { nextcode: chain[i + 1] } }] : [202, { result: { nextcode: "n/a" } }];
  });
  const r = await walkShareCodes({ ...base, knownCode: chain[0], fetchImpl });
  assert.deepEqual(r.matches.map((m) => m.code), chain.slice(1, 4));
  assert.equal(r.newestCode, chain[3]);
  assert.equal(r.finished, true);
  assert.equal(r.hasMore, false);
  assert.equal(r.warning, null);
  assert.equal(calls.length, 4);
});

test("цепочка: нет новых матчей", async () => {
  const { fetchImpl } = fakeSteam(() => [202, { result: { nextcode: "n/a" } }]);
  const r = await walkShareCodes({ ...base, knownCode: chain[0], fetchImpl });
  assert.equal(r.matches.length, 0);
  assert.equal(r.newestCode, chain[0]);
  assert.equal(r.finished, true);
});

test("цепочка: лимит шагов", async () => {
  const { fetchImpl, calls } = fakeSteam((known) => [200, { result: { nextcode: chain[(chain.indexOf(known) + 1) % chain.length] } }]);
  const r = await walkShareCodes({ ...base, knownCode: chain[0], max: 3, fetchImpl });
  assert.equal(r.matches.length, 3);
  assert.equal(r.hasMore, true);
  assert.equal(calls.length, 3);
});

test("цепочка: ошибки Steam", async () => {
  const cases = [
    [[403, "{\n\n}"], "bad_auth_code"],
    [[403, "<html><body>Access is denied. Please verify your <pre>key=</pre> parameter.</body></html>"], "server_key"],
    [[412, ""], "bad_known_code"],
    [[429, ""], "rate_limited"],
    [[500, ""], "unavailable"],
    [[200, "not json"], "unavailable"],
    [[200, { result: { nextcode: "garbage" } }], "unavailable"],
  ];
  for (const [resp, kind] of cases) {
    const { fetchImpl } = fakeSteam(() => resp);
    await assert.rejects(walkShareCodes({ ...base, knownCode: chain[0], fetchImpl }), (e) => e instanceof ShareCodeError && e.kind === kind, kind);
  }
});

test("цепочка: ошибка на середине — возвращаем найденное", async () => {
  const { fetchImpl } = fakeSteam((known, n) => (n <= 2 ? [200, { result: { nextcode: chain[chain.indexOf(known) + 1] } }] : [429, ""]));
  const r = await walkShareCodes({ ...base, knownCode: chain[0], fetchImpl });
  assert.equal(r.matches.length, 2);
  assert.equal(r.warning, "rate_limited");
  assert.equal(r.newestCode, chain[2]);
  assert.equal(r.finished, false);
  assert.equal(r.hasMore, false);
});

test("цепочка: защита от зацикливания", async () => {
  const { fetchImpl, calls } = fakeSteam(() => [200, { result: { nextcode: chain[1] } }]);
  const r = await walkShareCodes({ ...base, knownCode: chain[0], fetchImpl });
  assert.equal(r.matches.length, 1);
  assert.equal(calls.length, 2);
});
