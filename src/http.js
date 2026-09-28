// Общие HTTP-хелперы для Pages Functions.

export const ERRORS = {
  bad_input: { status: 400, message: "Не удалось распознать ввод. Вставьте ссылку на профиль Steam, SteamID64 или имя из ссылки steamcommunity.com/id/…" },
  not_found: { status: 404, message: "Профиль Steam не найден. Проверьте ссылку или имя." },
  steam_unavailable: { status: 502, message: "Steam API сейчас недоступен или не отвечает. Попробуйте позже." },
  rate_limited: { status: 429, message: "Слишком много запросов к Steam. Подождите минуту и попробуйте снова." },
  not_configured: { status: 500, message: "Сервер не настроен: не задан ключ Steam API." },
  method_not_allowed: { status: 405, message: "Метод не поддерживается." },
  internal: { status: 500, message: "Внутренняя ошибка сервера." },
};

const BASE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

export function json(data, { status = 200, maxAge = 0, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...BASE_HEADERS,
      "cache-control": maxAge > 0 ? `public, max-age=${maxAge}, s-maxage=${maxAge}` : "no-store",
      ...headers,
    },
  });
}

export function apiError(code, extra = {}) {
  const e = ERRORS[code] || ERRORS.internal;
  return json({ ok: false, error: { code, message: e.message, ...extra } }, { status: e.status, maxAge: code === "not_found" ? 60 : 0 });
}
