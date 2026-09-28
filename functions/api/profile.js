// GET /api/profile?q=<ссылка | SteamID64 | vanity>
// Вся работа с ключом Steam — только здесь, на сервере (секрет Pages STEAM_API_KEY).
import { parseSteamInput } from "../../src/steam/input.js";
import { createSteamClient, SteamError } from "../../src/steam/client.js";
import { buildPlayerReport } from "../../src/steam/profile.js";
import { json, apiError } from "../../src/http.js";

const CACHE_SECONDS = 120; // короткий edge-кэш готового ответа

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return apiError("method_not_allowed");
  }
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";

  const parsed = parseSteamInput(q);
  if (parsed.type === "invalid") return apiError("bad_input", { reason: parsed.reason });

  const key = env.STEAM_API_KEY;
  if (!key) return apiError("not_configured");

  const steam = createSteamClient(key);
  try {
    let steamid = parsed.value;
    if (parsed.type === "vanity") {
      steamid = await steam.resolveVanity(parsed.value);
      if (!steamid) return apiError("not_found");
    }

    // Кэш по нормализованному SteamID64, чтобы ссылка и ID делили одну запись.
    const cache = typeof caches !== "undefined" ? caches.default : null;
    const cacheKey = new Request(`${url.origin}/__cache/profile/${steamid}`, { method: "GET" });
    if (cache) {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const body = await hit.json();
        return json({ ...body, input: { type: parsed.type, value: parsed.value }, cached: true }, { maxAge: CACHE_SECONDS });
      }
    }

    const report = await buildPlayerReport(steam, steamid);
    if (!report) return apiError("not_found");

    const body = { ok: true, ...report, fetchedAt: new Date().toISOString() };
    if (cache) {
      context.waitUntil(cache.put(cacheKey, json(body, { maxAge: CACHE_SECONDS })).catch(() => {}));
    }
    return json({ ...body, input: { type: parsed.type, value: parsed.value }, cached: false }, { maxAge: CACHE_SECONDS });
  } catch (e) {
    if (e instanceof SteamError) {
      if (e.kind === "rate_limited") return apiError("rate_limited");
      if (e.kind === "forbidden") return apiError("steam_unavailable"); // неверный ключ — не раскрываем детали
      return apiError("steam_unavailable");
    }
    console.error("profile handler error:", e && e.name);
    return apiError("internal");
  }
}
