// Страница «Мои матчи»: поиск новых матчей по цепочке кодов и получение демок через локального помощника.
import { h } from "./dom.js";
import { decodeShareCode, normalizeShareCode } from "./sharecode.js";

const $ = (id) => document.getElementById(id);
const form = $("mform"), qIn = $("q"), authIn = $("auth"), knownIn = $("known"), remember = $("remember"), go = $("go");
const status = $("status"), playerBox = $("player"), listBox = $("list");
const helperState = $("helper-state");

const STORE_KEY = "cs2check.matches.v1";
const HELPER = "http://127.0.0.1:27901";
const MAX_HISTORY = 200;
const AUTH_RE = /^[A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{4}$/;

// ---------- localStorage (только на этом устройстве) ----------
function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function save(state) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
}
let state = load(); // { remember, q, authCode, lastCode, player, history: [{code, matchId, outcomeId, token, foundAt, demoUrl?}] }

function persist() {
  if (state.remember === false) {
    // Не запоминать: храним только в памяти вкладки.
    localStorage.removeItem(STORE_KEY);
    return;
  }
  save(state);
}

// ---------- сообщения ----------
function alertBox(kind, title, text, extra) {
  return h("div", { class: `alert ${kind}`, role: kind === "error" ? "alert" : "status" },
    h("span", { class: "ico" }, kind === "error" ? "⚠️" : kind === "warn" ? "ℹ️" : "✅"),
    h("div", {}, h("h3", {}, title), text ? h("p", {}, text) : null, extra || null));
}
const WARNINGS = {
  rate_limited: "Steam ограничил частоту запросов — остальные матчи подгрузятся при следующем поиске через минуту.",
  unavailable: "Steam перестал отвечать на середине — показаны найденные матчи, остальные подгрузятся при следующем поиске.",
  timeout: "Поиск занял слишком долго — показаны найденные матчи, нажмите «Искать дальше».",
  bad_auth_code: "Steam отклонил код на середине цепочки. Попробуйте ещё раз.",
  bad_known_code: "Steam отклонил один из кодов на середине цепочки. Попробуйте ещё раз.",
  server_key: "Steam API временно недоступен.",
};

// ---------- поиск ----------
async function search({ continueFrom } = {}) {
  const q = qIn.value.trim();
  const authCode = authIn.value.trim().toUpperCase();
  const knownRaw = continueFrom || knownIn.value;
  const knownCode = normalizeShareCode(knownRaw);
  for (const el of [qIn, authIn, knownIn]) el.classList.remove("bad");
  if (!q) { qIn.classList.add("bad"); qIn.focus(); return status.replaceChildren(alertBox("error", "Укажите профиль Steam", "Ссылка на профиль, SteamID64 или имя из ссылки.")); }
  if (!AUTH_RE.test(authCode)) { authIn.classList.add("bad"); authIn.focus(); return status.replaceChildren(alertBox("error", "Проверьте код аутентификации", "Он выглядит так: AAAA-AAAAA-AAAA (4-5-4 латинские буквы и цифры).")); }
  if (!knownCode) { knownIn.classList.add("bad"); knownIn.focus(); return status.replaceChildren(alertBox("error", "Проверьте код матча", "Он выглядит так: CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx.")); }

  go.disabled = true;
  status.replaceChildren(h("div", { class: "loading" }, h("span", { class: "spinner" }), "Ищем новые матчи в Steam… (до 20 за раз)"));
  let res, data = null;
  try {
    res = await fetch("/api/matches", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ q, authCode, knownCode }),
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    data = await res.json().catch(() => null);
  } catch {
    go.disabled = false;
    return status.replaceChildren(alertBox("error", "Нет связи с сервером", "Проверьте подключение к интернету."));
  }
  go.disabled = false;
  if (!res.ok || !data?.ok) {
    const err = data?.error || {};
    const field = { q: qIn, authCode: authIn, knownCode: knownIn }[err.field];
    field?.classList.add("bad");
    return status.replaceChildren(alertBox("error", "Не получилось", err.message || `Ошибка сервера (${res.status}).`));
  }

  // Сохраняем: профиль, код, самый новый код и историю найденных матчей.
  const prevSteamid = state.player?.steamid;
  if (prevSteamid && prevSteamid !== data.player.steamid) state.history = []; // другой игрок — другая история
  state.q = q;
  state.authCode = authCode;
  state.player = data.player;
  const history = state.history || [];
  const known = new Set(history.map((m) => m.code));
  const now = new Date().toISOString();
  const add = (m) => { if (!known.has(m.code)) { history.push({ ...m, foundAt: now }); known.add(m.code); } };
  add(decodeShareCode(data.knownCode)); // исходный код — тоже ваш матч
  const fresh = new Set(data.matches.map((m) => m.code));
  data.matches.forEach(add);
  state.history = history.slice(-MAX_HISTORY);
  state.lastCode = data.newestCode;
  knownIn.value = data.newestCode;
  persist();

  const msgs = [];
  if (data.matches.length) msgs.push(alertBox("ok", `Найдено новых матчей: ${data.matches.length}`, data.finished ? "Это все новые матчи на данный момент." : null));
  else msgs.push(alertBox("warn", "Новых матчей нет", "После указанного кода вы ещё не сыграли официальных матчей (или Steam пока их не выдал — это бывает через несколько минут после игры)."));
  if (data.warning) msgs.push(alertBox("warn", "Найдены не все матчи", WARNINGS[data.warning] || WARNINGS.unavailable));
  if (data.hasMore) msgs.push(alertBox("warn", "Есть ещё матчи", "За один раз ищем не больше 20.", h("p", {}, h("button", { type: "button", class: "btn ghost", onclick: () => search({ continueFrom: data.newestCode }) }, "Искать дальше"))));
  status.replaceChildren(...msgs);
  render(fresh);
}

// ---------- отрисовка ----------
function render(fresh = new Set()) {
  const p = state.player;
  playerBox.hidden = !p;
  if (p) {
    playerBox.replaceChildren(...[
      p.avatar ? h("img", { src: p.avatar, alt: "", width: 48, height: 48, referrerpolicy: "no-referrer" }) : null,
      h("div", { class: "grow" }, h("b", {}, p.name || p.steamid), h("small", {}, `SteamID64 ${p.steamid}`)),
      h("button", { type: "button", class: "btn ghost", onclick: forget, title: "Удалить коды и историю из этого браузера" }, "Забыть данные"),
    ].filter(Boolean));
  }
  const items = [...(state.history || [])].reverse(); // новые сверху
  listBox.hidden = !items.length;
  if (!items.length) return listBox.replaceChildren();
  listBox.replaceChildren(
    h("h2", {}, h("span", {}, `Матчи (${items.length})`), h("span", { class: "muted" }, "новые сверху")),
    ...items.map((m, i) => matchItem(m, items.length - i, fresh.has(m.code))),
  );
}

function matchItem(m, num, isNew) {
  const msg = h("div", { class: "mitem-msg" });
  const btnDemo = h("button", { type: "button", class: "btn ghost", onclick: () => getDemo(m, msg, btnDemo) }, "Получить демку");
  const copy = h("button", { type: "button", class: "chip", onclick: async () => { try { await navigator.clipboard.writeText(m.code); copy.textContent = "Скопировано"; setTimeout(() => (copy.textContent = "Копировать код"), 1500); } catch {} } }, "Копировать код");
  const ageDays = m.foundAt ? (Date.now() - Date.parse(m.foundAt)) / 864e5 : 0;
  if (m.demoUrl) showDemoLink(m, msg);
  return h("article", { class: `mitem${isNew ? " new" : ""}` },
    h("div", { class: "mitem-top" },
      h("span", { class: "num" }, `#${num}`),
      h("code", {}, m.code),
      isNew ? h("span", { class: "badge" }, "новый") : null,
      ageDays > 28 ? h("span", { class: "badge muted", title: "Valve хранит демки около месяца" }, "демка, скорее всего, удалена") : null),
    h("div", { class: "mitem-ids" },
      h("span", {}, "matchId ", h("b", {}, m.matchId)),
      h("span", {}, "outcomeId ", h("b", {}, m.outcomeId)),
      h("span", {}, "token ", h("b", {}, String(m.token)))),
    h("div", { class: "mitem-actions" }, btnDemo, copy),
    msg,
  );
}

// Демку качает либо локальный помощник, либо (если его нет) узкий прокси сайта /api/replay.
function demoPageUrl(demoUrl) {
  const src = helperInfo ? `${HELPER}/demo?url=${encodeURIComponent(demoUrl)}` : `/api/replay?url=${encodeURIComponent(demoUrl)}`;
  return `/demo?src=${encodeURIComponent(src)}&name=${encodeURIComponent(demoUrl.split("/").pop())}`;
}

function showDemoLink(m, msg) {
  msg.className = "mitem-msg";
  msg.replaceChildren(
    h("span", { class: "ok-text" }, "Демка найдена. "),
    h("a", { href: demoPageUrl(m.demoUrl), onclick: (e) => { e.preventDefault(); location.href = demoPageUrl(m.demoUrl); } }, "Разобрать на сайте →"),
    " · ",
    h("a", { href: m.demoUrl, rel: "noopener noreferrer" }, "скачать .dem.bz2"),
  );
}

// ---------- помощник ----------
let helperInfo = null;
async function checkHelper({ quiet = false } = {}) {
  if (!quiet) helperState.textContent = "Проверяем…";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(`${HELPER}/health`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    const j = await r.json();
    if (j?.app !== "cs2-check-helper") throw new Error("not helper");
    helperInfo = j;
    state.helperSeen = true; persist();
    helperState.className = j.ready ? "ok-text" : "muted";
    helperState.textContent = `Помощник ${j.version} найден (режим ${j.backend === "bot" ? "бот-аккаунт" : "через ваш Steam"}). ${j.detail || ""}`;
    return j;
  } catch {
    helperInfo = null;
    helperState.className = "muted";
    helperState.textContent = "Помощник не найден на 127.0.0.1:27901. Запустите его (инструкция ниже). Chrome/Edge спросят «Разрешить доступ к устройствам в локальной сети» — нажмите «Разрешить» (если отказали: значок слева от адреса → Настройки сайта → Локальная сеть).";
    return null;
  }
}

async function getDemo(m, msg, btn) {
  btn.disabled = true;
  msg.className = "mitem-msg";
  msg.replaceChildren(h("span", { class: "spinner" }), " Ищем помощника…");
  const hi = helperInfo || (await checkHelper());
  if (!hi) {
    btn.disabled = false;
    msg.className = "mitem-msg err";
    msg.replaceChildren("Нужен локальный помощник (см. блок «Демки матчей» ниже) — ссылку на демку выдаёт только координатор CS2. Или скачайте демку в самой CS2 и загрузите файл на странице ", h("a", { href: "/demo" }, "«Разбор демки»"), ".");
    return;
  }
  msg.replaceChildren(h("span", { class: "spinner" }), hi.backend === "bot" ? " Спрашиваем координатор CS2 через бота…" : " Спрашиваем координатор CS2 через ваш Steam (в фоне кратко запустится CS2-клиент, до ~1 мин)…");
  try {
    const r = await fetch(`${HELPER}/match`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shareCode: m.code }), cache: "no-store" });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j?.error?.message || `Ошибка помощника (${r.status})`);
    if (!j.match?.demoUrl) throw new Error(j.message || "Координатор не выдал ссылку на демку.");
    m.demoUrl = j.match.demoUrl;
    const h0 = (state.history || []).find((x) => x.code === m.code);
    if (h0) { h0.demoUrl = m.demoUrl; persist(); }
    showDemoLink(m, msg);
  } catch (e) {
    msg.className = "mitem-msg err";
    msg.textContent = e.message || "Помощник не ответил.";
  } finally {
    btn.disabled = false;
  }
}

$("helper-check").addEventListener("click", () => checkHelper());

// Ссылка на демку вручную (если уже известна): через помощника, а без него — через узкий прокси сайта.
$("urlform").addEventListener("submit", async (e) => {
  e.preventDefault();
  const raw = $("demo-url").value.trim();
  if (!/^http:\/\/replay\d{1,4}\.valve\.net\/730\/\d{1,24}_\d{1,24}\.dem\.bz2$/.test(raw)) {
    return status.replaceChildren(alertBox("error", "Это не ссылка на демку Valve", "Нужна ссылка вида http://replay123.valve.net/730/…_….dem.bz2"));
  }
  location.href = demoPageUrl(raw);
});

// ---------- форма и хранилище ----------
function forget() {
  if (!confirm("Удалить профиль, коды и историю матчей из этого браузера?")) return;
  localStorage.removeItem(STORE_KEY);
  state = {};
  qIn.value = authIn.value = knownIn.value = "";
  status.replaceChildren(alertBox("ok", "Данные удалены", "В этом браузере больше ничего не хранится."));
  render();
}
$("auth-toggle").addEventListener("click", () => { authIn.type = authIn.type === "password" ? "text" : "password"; });
remember.addEventListener("change", () => { state.remember = remember.checked; if (remember.checked) save(state); else localStorage.removeItem(STORE_KEY); });
form.addEventListener("submit", (e) => { e.preventDefault(); search(); });
// Код матча можно вставить вместе с ссылкой steam://… — чистим сразу.
knownIn.addEventListener("change", () => { const c = normalizeShareCode(knownIn.value); if (c) knownIn.value = c; });

remember.checked = state.remember !== false;
qIn.value = state.q || "";
authIn.value = state.authCode || "";
knownIn.value = state.lastCode || "";
render();
if (state.helperSeen) checkHelper({ quiet: true });
