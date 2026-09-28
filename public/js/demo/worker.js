// Web Worker: читает .dem (или распаковывает .dem.bz2) прямо в память wasm, разбирает demoparser2 и считает статистику.
// Демка никуда не отправляется — всё происходит в браузере пользователя.
import { WASM_JS, WASM_BIN, EVENTS, PLAYER_PROPS, OTHER_PROPS, sniffFormat, MAX_BZ2_BYTES, MAX_DEMO_BYTES, BZ2_RATIO_HINT } from "./config.js";
import { buildMatch } from "./model.js";
import { computeStats } from "./stats.js";

const CHUNK = 8 * 1024 * 1024;
const post = (msg) => self.postMessage(msg);
class Fail extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail; } }
const fail = (code, detail) => post({ type: "error", code, detail: detail ? String(detail).slice(0, 300) : null });

self.onmessage = async ({ data }) => {
  try {
    if (data?.type === "parse") await parseFile(data.file);
    else if (data?.type === "parseUrl") await parseUrl(data.url, data.name);
  } catch (e) {
    if (e instanceof Fail) fail(e.code, e.detail);
    else fail(classify(e), e?.message || e);
  }
};

let wasmCache = null;
async function loadWasm() {
  post({ type: "progress", stage: "wasm" });
  if (!wasmCache) {
    const mod = await import(WASM_JS);
    const wasm = await mod.default({ module_or_path: WASM_BIN });
    wasmCache = { mod, wasm };
  }
  return wasmCache;
}

function checkFormat(magic, size) {
  const fmt = sniffFormat(magic);
  if (fmt === "cs2" || fmt === "bzip2") return fmt;
  throw new Fail(fmt === "csgo" ? "csgo" : ["rar", "zip", "gzip", "7z", "zstd"].includes(fmt) ? "archive" : size === 0 ? "empty" : "not_demo", fmt);
}

async function parseFile(file) {
  const t0 = performance.now();
  if (!file || !file.size) throw new Fail("empty");
  const fmt = checkFormat(new Uint8Array(await file.slice(0, 16).arrayBuffer()), file.size);
  if (file.size < 64 * 1024) throw new Fail("corrupted", "too small");
  const { mod, wasm } = await loadWasm();
  let demo;
  if (fmt === "bzip2") {
    if (file.size > MAX_BZ2_BYTES) throw new Fail("too_large", `${file.size}`);
    const bz = newBz2(mod, file.size);
    for (let off = 0; off < file.size; off += CHUNK) {
      pushBz2(bz, new Uint8Array(await file.slice(off, off + CHUNK).arrayBuffer()));
      post({ type: "progress", stage: "unpack", done: Math.min(file.size, off + CHUNK), total: file.size, out: bz.len() });
    }
    demo = finishBz2(bz);
  } else {
    try {
      demo = new mod.DemoBytes(file.size);
    } catch (e) {
      throw new Fail("memory", e?.message || e);
    }
    for (let off = 0; off < file.size; off += CHUNK) {
      const buf = new Uint8Array(await file.slice(off, off + CHUNK).arrayBuffer());
      new Uint8Array(wasm.memory.buffer, demo.ptr() + off, buf.length).set(buf);
      post({ type: "progress", stage: "read", done: Math.min(file.size, off + CHUNK), total: file.size });
    }
  }
  await analyze(mod, wasm, demo, { fileName: file.name, fileSize: file.size, compressed: fmt === "bzip2", t0 });
}

// Загрузка по ссылке (локальный помощник или прокси /api/replay) с потоковой распаковкой bz2.
async function parseUrl(url, name) {
  const t0 = performance.now();
  post({ type: "progress", stage: "download", done: 0, total: 0 });
  let res;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (e) {
    throw new Fail("download", e?.message || e);
  }
  if (!res.ok) {
    let msg = "";
    try { msg = (await res.json())?.error?.code || ""; } catch {}
    throw new Fail(res.status === 404 || res.status === 410 || msg === "demo_expired" ? "expired" : "download", `HTTP ${res.status} ${msg}`);
  }
  const total = Number(res.headers.get("content-length")) || 0;
  if (total > MAX_BZ2_BYTES) throw new Fail("too_large", `${total}`);
  const { mod, wasm } = await loadWasm();
  const reader = res.body.getReader();
  let got = 0, bz = null, fmt = null, rawParts = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!fmt) {
      fmt = checkFormat(value.subarray(0, 16), value.length);
      if (fmt === "bzip2") bz = newBz2(mod, total || 200 * 1024 * 1024);
    }
    got += value.length;
    if (got > (fmt === "bzip2" ? MAX_BZ2_BYTES : MAX_DEMO_BYTES)) { reader.cancel().catch(() => {}); throw new Fail("too_large", `${got}`); }
    if (bz) pushBz2(bz, value);
    else rawParts.push(value);
    post({ type: "progress", stage: "download", done: got, total, out: bz ? bz.len() : got });
  }
  if (!fmt) throw new Fail("empty");
  if (total && got < total) throw new Fail("download", `обрыв: ${got} из ${total}`);
  let demo;
  if (bz) demo = finishBz2(bz);
  else {
    const blob = new Blob(rawParts); rawParts = null;
    demo = new mod.DemoBytes(blob.size);
    for (let off = 0; off < blob.size; off += CHUNK) {
      const buf = new Uint8Array(await blob.slice(off, off + CHUNK).arrayBuffer());
      new Uint8Array(wasm.memory.buffer, demo.ptr() + off, buf.length).set(buf);
    }
  }
  await analyze(mod, wasm, demo, { fileName: name || url.split("/").pop().split("?")[0] || "demo.dem", fileSize: got, compressed: !!bz, t0 });
}

function newBz2(mod, compressedSize) {
  try {
    return new mod.Bz2Stream(Math.min(MAX_DEMO_BYTES, Math.ceil(compressedSize * BZ2_RATIO_HINT)), MAX_DEMO_BYTES);
  } catch (e) {
    throw new Fail("memory", e?.message || e);
  }
}
function pushBz2(bz, chunk) {
  try {
    bz.push(chunk);
  } catch (e) {
    const m = String(e?.message || e);
    throw new Fail(/TOO_LARGE/.test(m) ? "too_large" : /OOM/.test(m) ? "memory" : "bad_archive", m);
  }
}
function finishBz2(bz) {
  try {
    return bz.finish();
  } catch (e) {
    throw new Fail("truncated", e?.message || e);
  }
}

async function analyze(mod, wasm, demo, { fileName, fileSize, compressed, t0 }) {
  const demoSize = demo.len();
  const tRead = performance.now();
  // Распакованное содержимое тоже проверяем: внутри .bz2 может оказаться не демка CS2.
  const head = new Uint8Array(wasm.memory.buffer, demo.ptr(), Math.min(16, demoSize)).slice();
  const inner = sniffFormat(head);
  if (inner !== "cs2") { demo.free(); throw new Fail(inner === "csgo" ? "csgo" : "not_demo", `внутри архива: ${inner}`); }

  let header = {};
  try {
    header = JSON.parse(mod.parseHeader(demo)) || {};
  } catch (e) {
    demo.free();
    throw new Fail("corrupted", e?.message || e);
  }
  post({ type: "progress", stage: "parse", map: header.map_name || null, total: demoSize });

  const json = mod.parseEvents(demo, EVENTS, PLAYER_PROPS, OTHER_PROPS);
  const wasmMemory = wasm.memory.buffer.byteLength;
  demo.free();
  const tParse = performance.now();

  post({ type: "progress", stage: "stats" });
  const raw = JSON.parse(json);
  const match = buildMatch(raw, {
    fileName,
    fileSize: demoSize,
    compressedSize: compressed ? fileSize : null,
    parsedAt: new Date().toISOString(),
    timings: { readMs: Math.round(tRead - t0), parseMs: Math.round(tParse - tRead), totalMs: 0 },
    wasmMemory,
  });
  if (!match.rounds.length) throw new Fail("no_rounds");
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
