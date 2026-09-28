// HTTP-сервер помощника. Слушает только 127.0.0.1 — снаружи компьютера недоступен.
import http from "node:http";
import { decodeShareCode, normalizeShareCode } from "../../public/js/sharecode.js";
import { isReplayUrl, MAX_REPLAY_BYTES } from "../../src/replay.js";
import { HelperError } from "./errors.js";

export const VERSION = "0.1.0";
export const DEFAULT_ORIGINS = [
  "https://cs2-check.pages.dev",
  "http://127.0.0.1:8788",
  "http://localhost:8788",
];
const PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.cs2-check\.pages\.dev$/;

export function createHelperServer({ backend, port = 27901, origins = [], fetchReplay = defaultFetchReplay, log = console.log }) {
  const allowed = new Set([...DEFAULT_ORIGINS, ...origins]);
  const originOk = (o) => allowed.has(o) || PREVIEW_RE.test(o);
  const hostOk = (h) => h === `127.0.0.1:${port}` || h === `localhost:${port}`;
  let queue = Promise.resolve();
  const serial = (fn) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || "";
    const cors = {};
    if (origin && originOk(origin)) {
      cors["access-control-allow-origin"] = origin;
      cors["vary"] = "Origin";
      cors["access-control-expose-headers"] = "content-length";
    }
    const send = (status, body, extra = {}) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors, ...extra });
      res.end(JSON.stringify(body));
    };
    const fail = (e) => {
      const he = e instanceof HelperError ? e : new HelperError("internal", "Внутренняя ошибка помощника.", 500);
      if (!(e instanceof HelperError)) log(`[helper] ошибка: ${e?.message || e}`);
      send(he.status, { ok: false, error: { code: he.kind, message: he.message } });
    };

    // Защита от DNS-rebinding и от чужих сайтов: принимаем только наш Host и разрешённые Origin.
    if (!hostOk(req.headers.host || "")) return send(403, { ok: false, error: { code: "bad_host", message: "Неверный Host." } });
    if (origin && !originOk(origin)) return send(403, { ok: false, error: { code: "bad_origin", message: "Этот сайт не может обращаться к помощнику." } });

    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...cors,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
        // Chrome: доступ публичного сайта к localhost (Private/Local Network Access).
        ...(req.headers["access-control-request-private-network"] ? { "access-control-allow-private-network": "true" } : {}),
      });
      return res.end();
    }

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return send(200, { ok: true, app: "cs2-check-helper", version: VERSION, backend: backend.name, ...backend.status() });
      }
      if (req.method === "POST" && url.pathname === "/match") {
        const body = await readJson(req);
        const code = normalizeShareCode(body?.shareCode);
        if (!code) throw new HelperError("bad_share_code", "Нужен код матча вида CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx.", 400);
        const d = decodeShareCode(code);
        const match = await serial(() => backend.match(d));
        if (!match?.demoUrl) {
          return send(200, { ok: true, match, warning: "no_demo", message: "Координатор не дал ссылку на демку: запись матча уже удалена (старше ~30 дней) или ещё не готова." });
        }
        return send(200, { ok: true, shareCode: code, match });
      }
      if (req.method === "POST" && url.pathname === "/recent") {
        await readJson(req);
        const matches = await serial(() => backend.recent());
        return send(200, { ok: true, matches });
      }
      if (req.method === "GET" && url.pathname === "/demo") {
        const target = url.searchParams.get("url") || "";
        if (!isReplayUrl(target)) throw new HelperError("bad_replay_url", "Разрешены только ссылки replayNNN.valve.net/730/…dem.bz2.", 400);
        return await fetchReplay(target, res, cors);
      }
      send(404, { ok: false, error: { code: "not_found", message: "Нет такого адреса." } });
    } catch (e) {
      if (res.headersSent) return res.destroy();
      fail(e);
    }
  });
  return server;
}

async function readJson(req) {
  if (!/application\/json/i.test(req.headers["content-type"] || "")) throw new HelperError("bad_request", "Нужен JSON (content-type: application/json).", 415);
  let size = 0; const parts = [];
  for await (const c of req) { size += c.length; if (size > 4096) throw new HelperError("bad_request", "Слишком большой запрос.", 413); parts.push(c); }
  try { return JSON.parse(Buffer.concat(parts).toString("utf8") || "{}"); } catch { throw new HelperError("bad_request", "Некорректный JSON.", 400); }
}

// Стримит .dem.bz2 с сервера повторов Valve в браузер как есть (распаковывает сам сайт).
function defaultFetchReplay(target, res, cors) {
  return new Promise((resolve, reject) => {
    const up = http.get(target, { timeout: 30_000, headers: { "user-agent": "cs2-check-helper" } }, (r) => {
      if ([403, 404, 410, 502].includes(r.statusCode)) { r.resume(); return reject(new HelperError("demo_expired", "Демка не найдена на сервере повторов: удалена (старше ~30 дней) или ссылка неверная.", 404)); }
      if (r.statusCode !== 200) { r.resume(); return reject(new HelperError("replay_unavailable", `Сервер повторов ответил ${r.statusCode}.`, 502)); }
      const len = Number(r.headers["content-length"]) || 0;
      if (len > MAX_REPLAY_BYTES) { r.resume(); return reject(new HelperError("too_large", "Демка больше 700 МБ.", 413)); }
      res.writeHead(200, { "content-type": "application/x-bzip2", "cache-control": "no-store", ...(len ? { "content-length": String(len) } : {}), ...cors });
      let seen = 0;
      r.on("data", (c) => { seen += c.length; if (seen > MAX_REPLAY_BYTES) { r.destroy(); res.destroy(); } });
      r.pipe(res);
      r.on("end", resolve);
      r.on("error", () => { res.destroy(); resolve(); });
    });
    up.on("timeout", () => up.destroy(new Error("timeout")));
    up.on("error", () => reject(new HelperError("replay_unavailable", "Сервер повторов Valve не отвечает.", 502)));
  });
}
