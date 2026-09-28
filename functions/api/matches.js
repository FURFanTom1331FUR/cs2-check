// POST /api/matches  { q, authCode, knownCode, max? }
// Находит новые официальные матчи игрока (Premier, соревновательный, напарники) по цепочке кодов.
// Код аутентификации игры приходит в теле POST (не в URL), уходит только в Steam API
// и нигде не сохраняется: ни в логах, ни в кэше, ни в ответе.
import { parseSteamInput } from "../../src/steam/input.js";
import { createSteamClient, SteamError } from "../../src/steam/client.js";
import { walkShareCodes, normalizeAuthCode, ShareCodeError, MAX_PER_REQUEST } from "../../src/steam/sharecodes.js";
import { normalizeShareCode } from "../../public/js/sharecode.js";
import { json, apiError } from "../../src/http.js";

const MAX_BODY = 4096;

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return apiError("method_not_allowed");
  if (!/application\/json/i.test(request.headers.get("content-type") || "")) return apiError("bad_request");

  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return apiError("bad_request");
    body = JSON.parse(text);
  } catch {
    return apiError("bad_request");
  }
  if (!body || typeof body !== "object") return apiError("bad_request");

  const parsed = parseSteamInput(typeof body.q === "string" ? body.q : "");
  if (parsed.type === "invalid") return apiError("bad_input", { field: "q" });
  const authCode = normalizeAuthCode(body.authCode);
  if (!authCode) return apiError("bad_auth_code_format", { field: "authCode" });
  const knownCode = normalizeShareCode(body.knownCode);
  if (!knownCode) return apiError("bad_share_code_format", { field: "knownCode" });
  const max = Math.min(MAX_PER_REQUEST, Math.max(1, parseInt(body.max, 10) || MAX_PER_REQUEST));

  const key = env.STEAM_API_KEY;
  if (!key) return apiError("not_configured");

  const steam = createSteamClient(key);
  let steamid = parsed.value;
  let player = null;
  try {
    if (parsed.type === "vanity") {
      steamid = await steam.resolveVanity(parsed.value);
      if (!steamid) return apiError("not_found", { field: "q" });
    }
    const [p] = await steam.getSummaries([steamid]);
    if (!p) return apiError("not_found", { field: "q" });
    player = { steamid, name: p.personaname || "", avatar: p.avatarfull || p.avatarmedium || "", profileUrl: p.profileurl || "" };
  } catch (e) {
    if (e instanceof SteamError && e.kind === "rate_limited") return apiError("rate_limited");
    return apiError("steam_unavailable");
  }

  try {
    const r = await walkShareCodes({ key, steamid, authCode, knownCode, max });
    return json({ ok: true, player, knownCode, ...r, fetchedAt: new Date().toISOString() });
  } catch (e) {
    if (e instanceof ShareCodeError) {
      if (e.kind === "bad_auth_code") return apiError("bad_auth_code", { field: "authCode" });
      if (e.kind === "bad_known_code") return apiError("bad_known_code", { field: "knownCode" });
      if (e.kind === "rate_limited") return apiError("rate_limited");
      if (e.kind === "server_key") return apiError("steam_unavailable");
      return apiError("steam_unavailable");
    }
    console.error("matches handler error:", e && e.name); // без данных запроса
    return apiError("internal");
  }
}
