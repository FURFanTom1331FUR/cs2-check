// Обход цепочки кодов матчей через ICSGOPlayers_730/GetNextMatchSharingCode.
// Код аутентификации игры (steamidkey) передаётся только в Steam и нигде не сохраняется и не логируется.
import { decodeShareCode, normalizeShareCode } from "../../public/js/sharecode.js";

const URL_BASE = "https://api.steampowered.com/ICSGOPlayers_730/GetNextMatchSharingCode/v1/";
export const MAX_PER_REQUEST = 20;
const STEP_TIMEOUT_MS = 8000;
const TOTAL_BUDGET_MS = 22000;

// Код аутентификации из help.steampowered.com: XXXX-XXXXX-XXXX (буквы/цифры).
export const AUTH_CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{4}$/;
export function normalizeAuthCode(input) {
  if (typeof input !== "string") return null;
  const s = input.trim().toUpperCase();
  return AUTH_CODE_RE.test(s) ? s : null;
}

export class ShareCodeError extends Error {
  constructor(kind, status) {
    super(kind);
    this.kind = kind; // bad_auth_code | bad_known_code | server_key | rate_limited | unavailable
    this.status = status;
  }
}

// Один шаг: вернёт следующий код или null, если новых матчей нет.
export async function fetchNextCode({ key, steamid, authCode, knownCode, fetchImpl = fetch }) {
  const url = new URL(URL_BASE);
  url.searchParams.set("key", key);
  url.searchParams.set("steamid", steamid);
  url.searchParams.set("steamidkey", authCode);
  url.searchParams.set("knowncode", knownCode);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STEP_TIMEOUT_MS);
  let res, text;
  try {
    res = await fetchImpl(url.toString(), { signal: ctrl.signal, headers: { accept: "application/json" }, cache: "no-store" });
    text = await res.text();
  } catch {
    throw new ShareCodeError("unavailable", 0);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 403 || res.status === 401) {
    // Неверный ключ Web API Steam отвечает HTML-страницей «verify your key=»,
    // а неверный код аутентификации — пустым JSON «{}».
    throw new ShareCodeError(/key=/.test(text) ? "server_key" : "bad_auth_code", res.status);
  }
  if (res.status === 412) throw new ShareCodeError("bad_known_code", 412);
  if (res.status === 429) throw new ShareCodeError("rate_limited", 429);
  if (res.status !== 200 && res.status !== 202) throw new ShareCodeError("unavailable", res.status);
  let next;
  try {
    next = JSON.parse(text)?.result?.nextcode;
  } catch {
    throw new ShareCodeError("unavailable", res.status);
  }
  if (res.status === 202 || !next || next === "n/a") return null;
  const code = normalizeShareCode(next);
  if (!code) throw new ShareCodeError("unavailable", res.status);
  return code;
}

// Идёт по цепочке от knownCode вперёд (от старых матчей к новым), не больше max шагов.
// Ошибка на середине пути не теряет уже найденные матчи: возвращаем их с предупреждением.
export async function walkShareCodes({ key, steamid, authCode, knownCode, max = MAX_PER_REQUEST, fetchImpl = fetch, now = () => Date.now() }) {
  const limit = Math.max(1, Math.min(MAX_PER_REQUEST, Number(max) || MAX_PER_REQUEST));
  const started = now();
  const codes = [];
  let current = knownCode;
  let finished = false;
  let warning = null;
  while (codes.length < limit) {
    if (now() - started > TOTAL_BUDGET_MS) { warning = "timeout"; break; }
    let next;
    try {
      next = await fetchNextCode({ key, steamid, authCode, knownCode: current, fetchImpl });
    } catch (e) {
      if (!codes.length || !(e instanceof ShareCodeError)) throw e;
      warning = e.kind;
      break;
    }
    if (!next) { finished = true; break; }
    if (next === current || codes.includes(next)) { finished = true; break; } // защита от зацикливания
    codes.push(next);
    current = next;
  }
  return {
    matches: codes.map((c) => decodeShareCode(c)),
    newestCode: current,
    finished, // true — дошли до последнего матча
    hasMore: !finished && !warning && codes.length >= limit,
    warning,
  };
}
