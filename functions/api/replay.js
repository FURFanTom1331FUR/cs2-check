// GET /api/replay?url=http://replayNNN.valve.net/730/<matchid>_<reservation>.dem.bz2
// Узкий прокси к серверам повторов Valve: они отдают демки только по HTTP и без CORS,
// поэтому HTTPS-страница не может скачать .bz2 напрямую. Разрешены ТОЛЬКО адреса replay*.valve.net,
// ответ стримится как есть (распаковка — в браузере, в wasm), ничего не кэшируется и не сохраняется.
// Отключается переменной окружения REPLAY_PROXY=off.
import { apiError } from "../../src/http.js";
import { isReplayUrl, MAX_REPLAY_BYTES as MAX_BYTES } from "../../src/replay.js";

export async function onRequest({ request, env }) {
  if (request.method !== "GET") return apiError("method_not_allowed");
  if (String(env.REPLAY_PROXY || "").toLowerCase() === "off") return apiError("proxy_disabled");
  const target = new URL(request.url).searchParams.get("url") || "";
  if (!isReplayUrl(target)) return apiError("bad_replay_url");

  let up;
  try {
    up = await fetch(target, { redirect: "manual", headers: { "user-agent": "cs2-check replay proxy" }, cf: { cacheTtl: 0 } });
  } catch {
    return apiError("replay_unavailable");
  }
  // Несуществующая или удалённая (старше ~30 дней) демка: 404, а у Google Edge Cache бывает и 403/502.
  if ([403, 404, 410, 502].includes(up.status)) return apiError("demo_unavailable", { upstream: up.status });
  if (up.status !== 200 || !up.body) return apiError("replay_unavailable", { upstream: up.status });
  const len = Number(up.headers.get("content-length")) || 0;
  if (len > MAX_BYTES) {
    up.body.cancel().catch(() => {});
    return apiError("too_large");
  }

  let body = up.body;
  if (!len) {
    // Без Content-Length считаем байты сами и обрываем поток после предела.
    let seen = 0;
    body = up.body.pipeThrough(new TransformStream({
      transform(chunk, ctrl) {
        seen += chunk.byteLength;
        if (seen > MAX_BYTES) ctrl.error(new Error("too large"));
        else ctrl.enqueue(chunk);
      },
    }));
  }
  const headers = {
    "content-type": "application/x-bzip2",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-disposition": `attachment; filename="${target.split("/").pop()}"`,
  };
  if (len) headers["content-length"] = String(len);
  return new Response(body, { status: 200, headers });
}

