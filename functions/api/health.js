// GET /api/health — простая проверка, что функции работают (без обращения к Steam).
import { json } from "../../src/http.js";

export function onRequestGet({ env }) {
  return json({ ok: true, service: "cs2-check", stage: "2.5", features: ["profile", "demo", "matches", "replay-proxy"], replayProxy: String(env.REPLAY_PROXY || "").toLowerCase() !== "off", steamKeyConfigured: Boolean(env.STEAM_API_KEY) });
}
