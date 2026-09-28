// Бэкенд «boiler»: спрашивает координатор CS2 через ВАШ запущенный клиент Steam (Steamworks API),
// без логина и паролей. Используется boiler-writter от AkiVer (как в CS Demo Manager).
// На время запроса в фоне кратко запускается CS2-клиент Steamworks; сама игра должна быть закрыта.
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { summarizeList } from "./matchinfo.js";
import { HelperError } from "./errors.js";

const require = createRequire(import.meta.url);
const TIMEOUT_MS = 90_000;

const EXIT = {
  1: ["boiler_error", "boiler-writter завершился с ошибкой."],
  2: ["boiler_error", "Неверные параметры запроса к координатору."],
  3: ["gc_unavailable", "Не удалось связаться с координатором CS2. Попробуйте через минуту."],
  4: ["cs2_running", "CS2 уже запущена. Закройте игру и повторите запрос."],
  5: ["steam_restart", "Steam просит перезапуска. Перезапустите Steam и повторите."],
  6: ["steam_not_running", "Steam не запущен или вы не вошли в аккаунт. Запустите Steam и войдите."],
  7: ["steam_not_logged_in", "В Steam не выполнен вход. Войдите в свой аккаунт в клиенте Steam."],
  8: ["no_matches", "Координатор не вернул матчей: матч не найден или слишком старый."],
  9: ["boiler_error", "boiler-writter не смог записать файл результата."],
};

export function boilerBinary() {
  let pkgDir;
  try {
    pkgDir = path.dirname(require.resolve("@akiver/boiler-writter/package.json"));
  } catch {
    return null;
  }
  const plat = `${process.platform}-${process.arch}`;
  const exe = process.platform === "win32" ? "boiler-writter.exe" : "boiler-writter";
  const p = path.join(pkgDir, "dist", "bin", plat, exe);
  return existsSync(p) ? p : null;
}

export function createBoilerBackend({ binary = boilerBinary(), run = execFile } = {}) {
  async function call(args) {
    if (!binary) throw new HelperError("backend_missing", "Не найден boiler-writter для этой системы. Выполните npm install в папке helper.");
    const dir = await mkdtemp(path.join(tmpdir(), "cs2check-"));
    const out = path.join(dir, "matches.info");
    try {
      const code = await new Promise((resolve, reject) => {
        const child = run(binary, [out, ...args], { timeout: TIMEOUT_MS, windowsHide: true, cwd: path.dirname(binary) }, (err) => {
          if (err && err.killed) return reject(new HelperError("timeout", "Координатор CS2 не ответил вовремя."));
          if (err && typeof err.code !== "number") return reject(new HelperError("boiler_error", `Не удалось запустить boiler-writter: ${err.code || err.message}`));
          resolve(err ? err.code : 0);
        });
        child.stdout?.on?.("data", () => {}); // вывод (там SteamID) не пишем в лог
      });
      if (code !== 0) {
        const [kind, msg] = EXIT[code] || ["boiler_error", `boiler-writter: код выхода ${code}`];
        throw new HelperError(kind, msg);
      }
      const bytes = new Uint8Array(await readFile(out));
      const { fromBinary } = await import("@bufbuild/protobuf");
      const { CMsgGCCStrike15_v2_MatchListSchema } = await import("csgo-protobuf");
      return summarizeList(fromBinary(CMsgGCCStrike15_v2_MatchListSchema, bytes));
    } finally {
      rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  return {
    name: "boiler",
    status: () => ({ ready: !!binary, detail: binary ? "Нужен запущенный Steam с вашим аккаунтом; CS2 должна быть закрыта." : "boiler-writter не установлен" }),
    async match({ matchId, outcomeId, token }) {
      const list = await call([String(matchId), String(outcomeId), String(token)]);
      const m = list.find((x) => x.matchId === String(matchId)) || list[0];
      if (!m) throw new HelperError("no_matches", EXIT[8][1]);
      return m;
    },
    async recent() {
      return call([]);
    },
  };
}
