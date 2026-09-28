// Бэкенд «bot»: отдельный Steam-аккаунт (НЕ ваш основной) входит в Steam через steam-user,
// «запускает» CS2 (без самой игры) и спрашивает у координатора информацию о матче по коду.
// Нужны переменные окружения: BOT_STEAM_LOGIN, BOT_STEAM_PASSWORD и желательно BOT_STEAM_SHARED_SECRET.
// После первого входа сохраняется refresh-токен (файл в BOT_DATA_DIR), пароль больше не нужен.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { summarizeMatch } from "./matchinfo.js";
import { HelperError } from "./errors.js";

const GC_TIMEOUT_MS = 20_000;
const MIN_INTERVAL_MS = 3_000; // не чаще одного запроса к координатору раз в 3 с

export function botConfig(env = process.env) {
  return {
    login: env.BOT_STEAM_LOGIN || "",
    password: env.BOT_STEAM_PASSWORD || "",
    sharedSecret: env.BOT_STEAM_SHARED_SECRET || "",
    dataDir: path.resolve(env.BOT_DATA_DIR || ".bot-data"),
  };
}

export function createBotBackend({ env = process.env, log = console.log, libs = null } = {}) {
  const cfg = botConfig(env);
  let state = "idle"; // idle | connecting | ready | error
  let detail = "";
  let client = null, csgo = null, lastCall = 0;
  let readyWaiters = [];

  const setState = (s, d = "") => {
    state = s; detail = d;
    if (s === "ready" || s === "error") { readyWaiters.forEach((w) => w()); readyWaiters = []; }
  };
  const tokenFile = () => path.join(cfg.dataDir, "refresh-token.txt");

  async function loadLibs() {
    if (libs) return libs;
    try {
      const [{ default: SteamUser }, { default: GlobalOffensive }, totp] = await Promise.all([
        import("steam-user"), import("globaloffensive"), import("steam-totp").catch(() => null),
      ]);
      return { SteamUser, GlobalOffensive, SteamTotp: totp?.default || totp };
    } catch {
      throw new HelperError("backend_missing", "Не установлены steam-user/globaloffensive. Выполните npm install в папке helper.", 500);
    }
  }

  async function start() {
    if (state === "connecting" || state === "ready") return;
    let token = "";
    try { token = (await readFile(tokenFile(), "utf8")).trim(); } catch {}
    if (!token && (!cfg.login || !cfg.password)) {
      setState("error", "Не заданы BOT_STEAM_LOGIN и BOT_STEAM_PASSWORD (см. helper/.env.example).");
      throw new HelperError("not_configured", detail, 500);
    }
    const { SteamUser, GlobalOffensive, SteamTotp } = await loadLibs();
    setState("connecting", "Вход в Steam…");
    client = new SteamUser({ autoRelogin: true, renewRefreshTokens: true });
    csgo = new GlobalOffensive(client);
    client.on("refreshToken", async (t) => {
      try {
        await mkdir(cfg.dataDir, { recursive: true });
        await writeFile(tokenFile(), t, { mode: 0o600 });
      } catch {}
    });
    client.on("loggedOn", () => {
      setState("connecting", "Вход выполнен, подключаемся к координатору CS2…");
      log("[bot] вошли в Steam, запускаем CS2 (без игры) для связи с координатором");
      client.setPersona(SteamUser.EPersonaState.Invisible);
      client.gamesPlayed([730]);
    });
    client.on("error", (e) => {
      const r = e?.eresult;
      const E = SteamUser.EResult;
      let msg = `Ошибка входа в Steam: ${e?.message || r}`;
      if (r === E.InvalidPassword) msg = "Неверный логин или пароль бота (или устарел сохранённый токен — удалите папку .bot-data).";
      else if (r === E.RateLimitExceeded || r === E.AccountLoginDeniedThrottle) msg = "Steam временно ограничил входы для этого аккаунта/IP. Подождите 30–60 минут.";
      else if (r === E.LoggedInElsewhere) msg = "С этого аккаунта запущена игра в другом месте. Бот должен быть отдельным аккаунтом.";
      if (token && r === E.InvalidPassword) writeFile(tokenFile(), "").catch(() => {});
      setState("error", msg);
      log(`[bot] ${msg}`);
    });
    client.on("steamGuard", (domain, callback, lastCodeWrong) => {
      if (cfg.sharedSecret && SteamTotp) return callback(SteamTotp.generateAuthCode(cfg.sharedSecret));
      setState("error", "Steam просит код Steam Guard. Задайте BOT_STEAM_SHARED_SECRET или запустите помощника в консоли и введите код.");
      log(`[bot] Steam Guard: введите код ${domain ? "из письма на " + domain : "из мобильного приложения"}${lastCodeWrong ? " (прошлый код неверный)" : ""}:`);
      process.stdin.once("data", (d) => callback(String(d).trim()));
    });
    csgo.on("connectedToGC", () => { setState("ready", "Бот подключён к координатору CS2."); log("[bot] координатор CS2 на связи"); });
    csgo.on("disconnectedFromGC", () => setState("connecting", "Связь с координатором потеряна, переподключаемся…"));

    const logOnDetails = token
      ? { refreshToken: token }
      : { accountName: cfg.login, password: cfg.password, twoFactorCode: cfg.sharedSecret && SteamTotp ? SteamTotp.generateAuthCode(cfg.sharedSecret) : undefined };
    client.logOn(logOnDetails);
  }

  async function waitReady(ms = 45_000) {
    if (state === "ready") return;
    if (state === "idle") await start();
    if (state !== "ready") {
      await new Promise((resolve) => { readyWaiters.push(resolve); setTimeout(resolve, ms); });
    }
    if (state !== "ready") throw new HelperError(state === "error" ? "bot_error" : "gc_unavailable", detail || "Бот не подключился к координатору CS2.");
  }

  return {
    name: "bot",
    start: () => start().catch(() => {}),
    status: () => ({ ready: state === "ready", state, detail: detail || (cfg.login ? "Бот ещё не запущен." : "Не задан BOT_STEAM_LOGIN.") }),
    async match({ matchId, outcomeId, token }) {
      await waitReady();
      const wait = lastCall + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCall = Date.now();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { csgo.removeListener("matchList", onList); reject(new HelperError("gc_timeout", "Координатор CS2 не ответил за 20 с. Так бывает при частых запросах — попробуйте позже.", 504)); }, GC_TIMEOUT_MS);
        function onList(matches) {
          const m = (matches || []).find((x) => String(x.matchid) === String(matchId));
          if (!m) return; // чужой ответ — ждём дальше
          clearTimeout(timer);
          csgo.removeListener("matchList", onList);
          resolve(summarizeMatch(m));
        }
        csgo.on("matchList", onList);
        csgo.requestGame({ matchId: String(matchId), outcomeId: String(outcomeId), token: Number(token) });
      });
    },
    async recent() {
      throw new HelperError("unsupported", "Для бота список «последних матчей» не имеет смысла (это были бы матчи бота). Используйте коды матчей.", 400);
    },
    stop() { try { client?.logOff(); } catch {} },
  };
}
