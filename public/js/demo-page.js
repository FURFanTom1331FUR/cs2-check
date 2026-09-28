// Страница «Разбор демки»: выбор файла, Web Worker с wasm-парсером, прогресс, история.
import { h } from "./dom.js";
import { renderMatch, mapTitle } from "./demo/view.js";
import { saveMatch, listMatches, deleteMatch } from "./demo/store.js";

const $ = (id) => document.getElementById(id);
const drop = $("drop"), input = $("file"), progress = $("progress"), status = $("status"), result = $("result");
const pgTitle = $("pg-title"), pgBar = $("pg-bar"), pgSub = $("pg-sub"), pgTime = $("pg-time");

const ERRORS = {
  csgo: ["Это демка CS:GO", "Поддерживаются только демки Counter-Strike 2 (формат PBDEMS2). Демки CS:GO (HL2DEMO) этот парсер не читает."],
  archive: ["Это архив, а не демка", "Архивы .rar/.zip/.gz/.7z сначала распакуйте и выберите файл .dem из него. Файлы .dem.bz2 (демки матчмейкинга) можно выбирать сразу."],
  too_large: ["Слишком большой файл", "Архив больше 700 МБ или демка больше 1,5 ГБ — такой файл браузер не осилит."],
  bad_archive: ["Архив .bz2 повреждён", "Не удалось распаковать .dem.bz2: файл испорчен. Скачайте демку заново."],
  truncated: ["Архив скачан не полностью", "Файл .dem.bz2 обрезан. Скачайте демку заново и дождитесь окончания загрузки."],
  download: ["Не удалось скачать демку", "Сервер повторов Valve или помощник не ответил. Проверьте, что помощник запущен, и попробуйте ещё раз."],
  bad_src: ["Недопустимый источник демки", "Ссылка на разбор ведёт на неразрешённый адрес. Откройте демку со страницы «Мои матчи» или выберите файл вручную."],
  expired: ["Демка больше недоступна", "Valve хранит записи матчей около месяца — эта демка уже удалена с серверов повторов (или ссылка неверная)."],
  not_demo: ["Это не демка CS2", "Файл не похож на демку Counter-Strike 2. Выберите файл с расширением .dem."],
  empty: ["Пустой файл", "Выбранный файл пустой."],
  corrupted: ["Демка повреждена", "Не удалось разобрать файл: он повреждён, обрезан (не докачан) или записан неподдерживаемой версией игры."],
  memory: ["Не хватает памяти", "Браузеру не хватило памяти для этой демки. Закройте лишние вкладки или откройте демку на ПК."],
  no_rounds: ["Раунды не найдены", "В демке нет сыгранных раундов (например, только разминка или режим без раундов)."],
  wasm_load: ["Не удалось загрузить парсер", "Проверьте подключение к интернету и обновите страницу."],
  worker: ["Ошибка браузера", "Не удалось запустить фоновый разбор. Обновите страницу или попробуйте другой браузер."],
};

let worker = null, timer = null, startedAt = 0, estimateMs = 0;

function showError(code, detail) {
  const [title, text] = ERRORS[code] || ERRORS.corrupted;
  status.replaceChildren(h("div", { class: "alert error", role: "alert" }, h("span", { class: "ico" }, "⚠️"),
    h("div", {}, h("h3", {}, title), h("p", {}, text), detail && code === "corrupted" ? h("p", { class: "tech" }, `Техническая причина: ${detail}`) : null)));
}

function setProgress(title, pct, sub) {
  pgTitle.textContent = title;
  if (pct === null) pgBar.parentElement.classList.add("indet");
  else { pgBar.parentElement.classList.remove("indet"); pgBar.style.width = `${Math.max(2, Math.min(100, pct))}%`; }
  if (sub !== undefined) pgSub.textContent = sub;
}

function stop() {
  worker?.terminate(); // освобождает всю память wasm
  worker = null;
  clearInterval(timer);
  progress.hidden = true;
  drop.classList.remove("busy");
}

// src: File (ручная загрузка) или { url, name } (демка с серверов повторов через помощник/прокси).
function start(src) {
  if (!src) return;
  const isUrl = !(src instanceof Blob);
  stop();
  status.replaceChildren();
  result.hidden = true;
  if (!isUrl && !/\.dem(\.bz2)?$/i.test(src.name) && !confirm("У файла нет расширения .dem. Всё равно попробовать?")) return;
  progress.hidden = false;
  drop.classList.add("busy");
  startedAt = performance.now();
  parseStart = 0;
  const bz = isUrl || /\.bz2$/i.test(src.name);
  // оценка ~70 МБ/с для .dem; для .bz2 размер демки ~в 1.4 раза больше архива
  estimateMs = isUrl ? 8000 : ((src.size * (bz ? 1.4 : 1)) / (70 * 1024 * 1024)) * 1000 + 1500;
  setProgress(isUrl ? "Подключаемся…" : "Проверяем файл…", 1, isUrl ? src.name || "" : `${src.name} · ${(src.size / 1048576).toFixed(0)} МБ`);
  timer = setInterval(tick, 250);
  try {
    worker = new Worker(new URL("./demo/worker.js", import.meta.url), { type: "module" });
  } catch {
    stop();
    return showError("worker");
  }
  let stage = "check";
  worker.onmessage = async ({ data }) => {
    if (data.type === "progress") {
      stage = data.stage;
      if (data.stage === "wasm") setProgress("Загружаем парсер…", 3);
      else if (data.stage === "read") setProgress("Читаем файл…", 3 + (data.done / data.total) * 17);
      else if (data.stage === "unpack") setProgress("Распаковываем .bz2…", 3 + (data.done / data.total) * 27, `${mb(data.done)} из ${mb(data.total)} МБ → ${mb(data.out)} МБ демки`);
      else if (data.stage === "download") setProgress("Скачиваем демку…", data.total ? 3 + (data.done / data.total) * 37 : null, `${mb(data.done)}${data.total ? " из " + mb(data.total) : ""} МБ · распаковано ${mb(data.out || 0)} МБ`);
      else if (data.stage === "parse") { parseStart = performance.now(); estimateMs = (data.total / (70 * 1024 * 1024)) * 1000 + 1500; setProgress(`Разбираем демку${data.map ? " · " + mapTitle(data.map) : ""}…`, 20); }
      else if (data.stage === "stats") setProgress("Считаем статистику…", 97);
    } else if (data.type === "done") {
      const { match, stats } = data;
      stop();
      renderMatch(result, match, stats);
      result.scrollIntoView({ behavior: "smooth", block: "start" });
      await saveMatch(match, stats);
      refreshRecent();
    } else if (data.type === "error") {
      stop();
      showError(data.code, data.detail);
    }
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    stop();
    showError(stage === "check" || stage === "wasm" ? "wasm_load" : /memory/i.test(e.message || "") ? "memory" : "corrupted", e.message);
  };
  worker.postMessage(isUrl ? { type: "parseUrl", url: src.url, name: src.name } : { type: "parse", file: src });
}

let parseStart = 0;
const mb = (b) => (b / 1048576).toFixed(0);
function tick() {
  const el = performance.now() - startedAt;
  pgTime.textContent = `${(el / 1000).toFixed(0)} с`;
  if (parseStart && pgTitle.textContent.startsWith("Разбираем")) {
    // Точного прогресса парсер не сообщает — показываем оценку по размеру файла.
    const f = Math.min(0.97, (performance.now() - parseStart) / estimateMs);
    const from = parseFloat(pgBar.style.width) > 20 ? Math.max(20, parseFloat(pgBar.style.width)) : 20;
    pgBar.style.width = `${Math.max(from, 20 + f * 75)}%`;
    pgSub.textContent = "Прогресс примерный: парсер не сообщает точный процент.";
  }
}

$("pg-cancel").addEventListener("click", () => { stop(); status.replaceChildren(h("div", { class: "alert warn" }, h("span", { class: "ico" }, "⏹"), h("div", {}, h("h3", {}, "Разбор отменён"), h("p", {}, "Можно выбрать другой файл.")))); });
input.addEventListener("change", () => { start(input.files[0]); input.value = ""; });
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); });
drop.addEventListener("drop", (e) => start(e.dataTransfer?.files?.[0]));
// Файл, брошенный мимо зоны, не должен открываться браузером.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer?.files?.[0]) start(e.dataTransfer.files[0]); });

async function refreshRecent() {
  const items = await listMatches();
  const box = $("recent"), list = $("recent-list");
  box.hidden = !items.length;
  list.replaceChildren(...items.map((it) => {
    const m = it.data;
    const [A, B] = m.teams;
    return h("li", { class: "recent-item" },
      h("button", { type: "button", class: "recent-open", onclick: () => { status.replaceChildren(); renderMatch(result, m, m.stats, { fromCache: true }); result.scrollIntoView({ behavior: "smooth" }); } },
        h("b", {}, mapTitle(m.meta.map)), ` ${A.name} ${A.score}:${B.score} ${B.name}`,
        h("small", {}, `${m.meta.fileName} · ${new Date(it.savedAt).toLocaleString("ru-RU")}`)),
      h("button", { type: "button", class: "chip", title: "Удалить из истории", "aria-label": "Удалить", onclick: async () => { await deleteMatch(it.id); refreshRecent(); } }, "✕"),
    );
  }));
}

// /demo?src=… — автозапуск разбора демки, найденной на странице «Мои матчи».
// Разрешены только наш прокси и локальный помощник (CSP connect-src всё равно не пустит другие адреса).
function allowedSrc(raw) {
  try {
    const u = new URL(raw, location.origin);
    if (u.origin === location.origin && u.pathname === "/api/replay") return u.href;
    if ((u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.port === "27901" && u.protocol === "http:") return u.href;
  } catch {}
  return null;
}
const qs = new URLSearchParams(location.search);
if (qs.get("src")) {
  const url = allowedSrc(qs.get("src"));
  if (url) start({ url, name: qs.get("name") || "" });
  else showError("bad_src", null);
}

const small = matchMedia("(max-width: 760px)").matches || (navigator.deviceMemory && navigator.deviceMemory < 4);
$("mobile-note").hidden = !small;
refreshRecent();
