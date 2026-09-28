#!/usr/bin/env node
// Локальный помощник CS2 Check. Запуск: npm start (в папке helper).
// Настройки — переменные окружения или файл helper/.env (см. .env.example).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHelperServer, VERSION } from "./lib/server.js";
import { createBoilerBackend } from "./lib/boiler.js";
import { createBotBackend } from "./lib/bot.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Мини-загрузчик .env (без зависимостей). Значения не печатаются.
try {
  for (const line of readFileSync(path.join(here, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
} catch {}

const port = Number(process.env.HELPER_PORT) || 27901;
const mode = (process.env.HELPER_BACKEND || (process.env.BOT_STEAM_LOGIN ? "bot" : "boiler")).toLowerCase();
const backend = mode === "bot" ? createBotBackend({ env: { ...process.env, BOT_DATA_DIR: process.env.BOT_DATA_DIR || path.join(here, ".bot-data") } }) : createBoilerBackend();
const origins = (process.env.HELPER_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);

const server = createHelperServer({ backend, port, origins });
server.listen(port, "127.0.0.1", () => {
  console.log(`CS2 Check помощник ${VERSION} слушает http://127.0.0.1:${port} (режим: ${backend.name})`);
  console.log(backend.status().detail);
  console.log("Откройте https://cs2-check.pages.dev/matches — сайт найдёт помощника сам. Остановить: Ctrl+C.");
  if (backend.start) backend.start();
});
server.on("error", (e) => {
  console.error(e.code === "EADDRINUSE" ? `Порт ${port} занят — помощник уже запущен? Или задайте HELPER_PORT (тогда сайт его не найдёт).` : `Ошибка: ${e.message}`);
  process.exit(1);
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { backend.stop?.(); process.exit(0); });
