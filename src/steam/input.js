// Разбор пользовательского ввода: ссылка на профиль, SteamID64, SteamID2/3 или vanity-имя.
// Возвращает { type: "steamid64", value } | { type: "vanity", value } | { type: "invalid", reason }.

const STEAMID64_BASE = 76561197960265728n;
const STEAMID64_RE = /^7656\d{13}$/;
const VANITY_RE = /^[A-Za-z0-9_-]{2,32}$/;
const MAX_INPUT = 200;

export function isSteamId64(s) {
  if (!STEAMID64_RE.test(s)) return false;
  const n = BigInt(s);
  // Диапазон индивидуальных аккаунтов (universe 1, type 1, instance 1).
  return n > STEAMID64_BASE && n < 76561202255233024n;
}

export function parseSteamInput(raw) {
  if (typeof raw !== "string") return { type: "invalid", reason: "empty" };
  let s = raw.trim();
  if (!s) return { type: "invalid", reason: "empty" };
  if (s.length > MAX_INPUT) return { type: "invalid", reason: "too_long" };

  // SteamID3: [U:1:22202]
  let m = s.match(/^\[?U:1:(\d{1,10})\]?$/i);
  if (m) return fromBig(STEAMID64_BASE + BigInt(m[1]));

  // SteamID2: STEAM_0:0:11101
  m = s.match(/^STEAM_[0-5]:([01]):(\d{1,10})$/i);
  if (m) return fromBig(STEAMID64_BASE + BigInt(m[2]) * 2n + BigInt(m[1]));

  // Ссылка на профиль (со схемой или без).
  if (/steamcommunity\.com/i.test(s)) {
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s);
    } catch {
      return { type: "invalid", reason: "bad_url" };
    }
    const host = url.hostname.toLowerCase();
    if (host !== "steamcommunity.com" && host !== "www.steamcommunity.com") {
      return { type: "invalid", reason: "bad_url" };
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return { type: "invalid", reason: "bad_url" };
    const kind = parts[0].toLowerCase();
    let value;
    try {
      value = decodeURIComponent(parts[1]);
    } catch {
      return { type: "invalid", reason: "bad_url" };
    }
    if (kind === "profiles") {
      return isSteamId64(value) ? { type: "steamid64", value } : { type: "invalid", reason: "bad_id" };
    }
    if (kind === "id") {
      return VANITY_RE.test(value) ? { type: "vanity", value } : { type: "invalid", reason: "bad_vanity" };
    }
    return { type: "invalid", reason: "bad_url" };
  }

  if (/^\d+$/.test(s)) {
    return isSteamId64(s) ? { type: "steamid64", value: s } : { type: "invalid", reason: "bad_id" };
  }

  if (VANITY_RE.test(s)) return { type: "vanity", value: s };
  return { type: "invalid", reason: "bad_format" };
}

function fromBig(n) {
  const v = n.toString();
  return isSteamId64(v) ? { type: "steamid64", value: v } : { type: "invalid", reason: "bad_id" };
}
