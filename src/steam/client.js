// Тонкая обёртка над Steam Web API. Ключ передаётся только сюда (на сервере)
// и никогда не попадает в ответы, логи или сообщения об ошибках.

const API = "https://api.steampowered.com";
const TIMEOUT_MS = 8000;

export class SteamError extends Error {
  constructor(kind, status) {
    super(kind);
    this.kind = kind; // "unavailable" | "forbidden" | "rate_limited"
    this.status = status;
  }
}

export function createSteamClient(key, { cacheTtl = 120 } = {}) {
  async function call(path, params) {
    const url = new URL(API + path);
    url.searchParams.set("key", key);
    url.searchParams.set("format", "json");
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url.toString(), {
        signal: ctrl.signal,
        headers: { accept: "application/json" },
        // Короткий edge-кэш ответов Steam (ключ в URL, но кэш серверный, наружу не отдаётся).
        cf: { cacheTtl, cacheEverything: true },
      });
    } catch {
      throw new SteamError("unavailable", 0);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) throw new SteamError("forbidden", res.status);
    if (res.status === 429) throw new SteamError("rate_limited", 429);
    if (!res.ok) throw new SteamError("unavailable", res.status);
    try {
      return await res.json();
    } catch {
      throw new SteamError("unavailable", res.status);
    }
  }

  return {
    async resolveVanity(vanity) {
      const d = await call("/ISteamUser/ResolveVanityURL/v1/", { vanityurl: vanity, url_type: 1 });
      const r = d?.response;
      return r?.success === 1 && r.steamid ? r.steamid : null;
    },

    async getSummaries(steamids) {
      const d = await call("/ISteamUser/GetPlayerSummaries/v2/", { steamids: steamids.join(",") });
      return d?.response?.players ?? [];
    },

    async getBans(steamids) {
      const d = await call("/ISteamUser/GetPlayerBans/v1/", { steamids: steamids.join(",") });
      return d?.players ?? [];
    },

    async getLevel(steamid) {
      const d = await call("/IPlayerService/GetSteamLevel/v1/", { steamid });
      const lvl = d?.response?.player_level;
      return typeof lvl === "number" ? lvl : null;
    },

    // null, если библиотека скрыта (Steam отдаёт пустой response).
    async getOwnedGames(steamid) {
      const d = await call("/IPlayerService/GetOwnedGames/v1/", {
        steamid,
        include_played_free_games: 1,
        include_appinfo: 0,
      });
      const r = d?.response;
      if (!r || typeof r.game_count !== "number") return null;
      return { count: r.game_count, games: Array.isArray(r.games) ? r.games : [] };
    },

    // null, если список друзей закрыт (Steam отвечает 401).
    async getFriendIds(steamid) {
      try {
        const d = await call("/ISteamUser/GetFriendList/v1/", { steamid, relationship: "friend" });
        return (d?.friendslist?.friends ?? []).map((f) => f.steamid);
      } catch (e) {
        if (e instanceof SteamError && e.kind === "forbidden") return null;
        throw e;
      }
    },
  };
}
