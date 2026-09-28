// Точка входа: форма поиска, синхронизация с ?q= в адресе, состояния загрузки/ошибок.
import { h } from "./dom.js";
import { fetchProfile, ApiError } from "./api.js";
import { renderPlayer } from "./views/player.js";

const form = document.getElementById("search");
const input = document.getElementById("q");
const button = document.getElementById("go");
const status = document.getElementById("status");
const result = document.getElementById("result");

let inflight = null;

function showError(title, text) {
  status.replaceChildren(h("div", { class: "alert error", role: "alert" }, h("span", { class: "ico" }, "⚠️"), h("div", {}, h("h3", {}, title), h("p", {}, text))));
}

const ERROR_TITLES = {
  bad_input: "Неверный ввод",
  not_found: "Профиль не найден",
  steam_unavailable: "Steam API недоступен",
  rate_limited: "Слишком много запросов",
  network: "Нет связи",
  not_configured: "Сервер не настроен",
};

async function check(q, { push = true } = {}) {
  q = q.trim();
  if (!q) {
    showError(ERROR_TITLES.bad_input, "Вставьте ссылку на профиль Steam, SteamID64 или имя из ссылки.");
    input.focus();
    return;
  }
  if (push) {
    const url = new URL(location.href);
    url.searchParams.set("q", q);
    history.pushState({ q }, "", url);
  }
  inflight?.abort();
  const ctrl = new AbortController();
  inflight = ctrl;

  button.disabled = true;
  result.hidden = true;
  status.replaceChildren(h("div", { class: "loading" }, h("span", { class: "spinner" }), "Запрашиваем данные Steam…"));
  try {
    const data = await fetchProfile(q, { signal: ctrl.signal });
    if (ctrl.signal.aborted) return;
    status.replaceChildren();
    renderPlayer(result, data);
    document.title = `${data.profile.name || data.steamid} — CS2 Check`;
  } catch (e) {
    if (e.name === "AbortError") return;
    const code = e instanceof ApiError ? e.code : "unknown";
    showError(ERROR_TITLES[code] || "Ошибка", e.message || "Что-то пошло не так.");
    document.title = "CS2 Check — проверка игрока по Steam-профилю";
  } finally {
    if (inflight === ctrl) {
      button.disabled = false;
      inflight = null;
    }
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  check(input.value);
});

document.querySelectorAll(".chip[data-q]").forEach((b) =>
  b.addEventListener("click", () => {
    input.value = b.dataset.q;
    check(b.dataset.q);
  }),
);

window.addEventListener("popstate", () => {
  const q = new URL(location.href).searchParams.get("q");
  if (q) {
    input.value = q;
    check(q, { push: false });
  } else {
    status.replaceChildren();
    result.hidden = true;
    input.value = "";
  }
});

const initial = new URL(location.href).searchParams.get("q");
if (initial) {
  input.value = initial;
  check(initial, { push: false });
}
