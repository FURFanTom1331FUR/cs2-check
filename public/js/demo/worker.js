// Web Worker: читает .dem по кускам прямо в память wasm, разбирает demoparser2 и считает статистику.
// Демка никуда не отправляется — всё происходит в браузере пользователя.
import { WASM_JS, WASM_BIN, EVENTS, PLAYER_PROPS, OTHER_PROPS, sniffFormat } from "./config.js";
import { buildMatch } from "./model.js";
import { computeStats } from "./stats.js";

const CHUNK = 8 * 1024 * 1024;
const post = (msg) => self.postMessage(msg);
const fail = (code, detail) => post({ type: "error", code, detail: detail ? String(detail).slice(0, 300) : null });

self.onmessage = async ({ data }) => {
  if (data?.type !== "parse") return;
  try {
    await parse(data.file);
  } catch (e) {
    fail(classify(e), e?.message || e);
  }
};

async function parse(file) {
  const t0 = performance.now();
  if (!file || !file.size) return fail("empty");
  const magic = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const fmt = sniffFormat(magic);
  if (fmt !== "cs2") return fail(fmt === "csgo" ? "csgo" : ["rar", "zip", "gzip", "bzip2", "7z", "zstd"].includes(fmt) ? "archive" : "not_demo", fmt);
  if (file.size < 64 * 1024) return fail("corrupted", "too small");

  post({ type: "progress", stage: "wasm" });
  const mod = await import(WASM_JS);
  const wasm = await mod.default({ module_or_path: WASM_BIN });

  let demo;
  try {
    demo = new mod.DemoBytes(file.size);
  } catch (e) {
    return fail("memory", e?.message || e);
  }
  for (let off = 0; off < file.size; off += CHUNK) {
    const buf = new Uint8Array(await file.slice(off, off + CHUNK).arrayBuffer());
    new Uint8Array(wasm.memory.buffer, demo.ptr() + off, buf.length).set(buf);
    post({ type: "progress", stage: "read", done: Math.min(file.size, off + CHUNK), total: file.size });
  }
  const tRead = performance.now();

  let header = {};
  try {
    header = JSON.parse(mod.parseHeader(demo)) || {};
  } catch (e) {
    demo.free();
    return fail("corrupted", e?.message || e);
  }
  post({ type: "progress", stage: "parse", map: header.map_name || null, total: file.size });

  const json = mod.parseEvents(demo, EVENTS, PLAYER_PROPS, OTHER_PROPS);
  const wasmMemory = wasm.memory.buffer.byteLength;
  demo.free();
  const tParse = performance.now();

  post({ type: "progress", stage: "stats" });
  const raw = JSON.parse(json);
  const match = buildMatch(raw, {
    fileName: file.name,
    fileSize: file.size,
    parsedAt: new Date().toISOString(),
    timings: { readMs: Math.round(tRead - t0), parseMs: Math.round(tParse - tRead), totalMs: 0 },
    wasmMemory,
  });
  if (!match.rounds.length) return fail("no_rounds");
  const stats = computeStats(match);
  match.meta.timings.totalMs = Math.round(performance.now() - t0);
  post({ type: "done", match, stats });
}

function classify(e) {
  const m = String(e?.message || e || "");
  if (/memory|OOM|allocation|Array buffer allocation|Out of memory|grow/i.test(m)) return "memory";
  if (/unreachable|panic|index out of bounds|overflow/i.test(m)) return "corrupted";
  if (/Failed to fetch|NetworkError|import|WebAssembly\.instantiate|CompileError/i.test(m)) return "wasm_load";
  return "corrupted";
}
