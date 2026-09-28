// Общие HTTP-хелперы для Pages Functions.

export const ERRORS = {
  bad_input: { status: 400, message: "Не удалось распознать ввод. Вставьте ссылку на профиль Steam, SteamID64 или имя из ссылки steamcommunity.com/id/…" },
  not_found: { status: 404, message: "Профиль Steam не найден. Проверьте ссылку или имя." },
  steam_unavailable: { status: 502, message: "Steam API сейчас недоступен или не отвечает. Попробуйте позже." },
  rate_limited: { status: 429, message: "Слишком много запросов к Steam. Подождите минуту и попробуйте снова." },
  not_configured: { status: 500, message: "Сервер не настроен: не задан ключ Steam API." },
  bad_request: { status: 400, message: "Некорректный запрос." },
  bad_auth_code_format: { status: 400, message: "Код аутентификации выглядит так: XXXX-XXXXX-XXXX (4-5-4 буквы и цифры). Скопируйте его целиком со страницы Steam." },
  bad_share_code_format: { status: 400, message: "Код матча выглядит так: CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx. Проверьте, что он скопирован целиком." },
  bad_auth_code: { status: 403, message: "Steam не принял код аутентификации для этого профиля. Проверьте, что профиль и код от одного аккаунта, и что код не был сброшен (после «Отозвать» нужен новый код)." },
  bad_known_code: { status: 412, message: "Steam не узнал код последнего матча: он неверный или относится к другому аккаунту. Возьмите код любого своего недавнего матча там же, где код аутентификации." },
  bad_replay_url: { status: 400, message: "Разрешены только ссылки на демки серверов повторов Valve: http://replayNNN.valve.net/730/…_….dem.bz2" },
  demo_unavailable: { status: 404, message: "Демка не найдена на сервере повторов Valve: она уже удалена (Valve хранит записи около месяца) или ссылка неверная." },
  replay_unavailable: { status: 502, message: "Сервер повторов Valve не ответил. Попробуйте позже." },
  too_large: { status: 413, message: "Файл демки слишком большой (больше 700 МБ)." },
  proxy_disabled: { status: 503, message: "Скачивание демок через сайт отключено. Используйте локального помощника." },
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
