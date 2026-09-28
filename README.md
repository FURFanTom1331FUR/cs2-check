# CS2 Check

Сайт для быстрой проверки игрока CS2 по профилю Steam — в духе Leetify / CSStats / Faceit Finder.
Работает на **Cloudflare Pages** + **Pages Functions**; ключ Steam Web API хранится только на сервере.

**Сайт:** https://cs2-check.pages.dev

## Что умеет (этап 1)

Вставьте в поле любое из:

- `https://steamcommunity.com/id/ИМЯ`
- `https://steamcommunity.com/profiles/7656119…`
- SteamID64 (`76561197960435530`), SteamID3 (`[U:1:169802]`) или SteamID2 (`STEAM_0:0:84901`)
- просто имя из ссылки (`robinwalker`)

Страница покажет:

- **Профиль:** аватар, ник, ссылка, страна (если указана), дата создания и возраст аккаунта, видимость профиля, уровень Steam.
- **Баны** (`ISteamUser/GetPlayerBans`): VAC-баны, игровые баны, дней с последнего бана, бан в сообществе, торговый бан.
- **CS2** (appid 730, `IPlayerService/GetOwnedGames`): часы всего и за 2 недели, число игр в библиотеке. Скрытая библиотека обрабатывается отдельно.
- **Друзья** (`ISteamUser/GetFriendList`): количество и сколько из них с VAC- или игровыми банами (проверяются пачками по 100, не больше 300 друзей).
- **Красные флаги:** недавний бан, скрытый профиль или игры, новый аккаунт, низкий уровень, мало часов в CS2 на старом аккаунте, много друзей с банами.

> ⚠️ Сайт **не определяет читы**. Красные флаги — только косвенные подсказки, а не доказательство нечестной игры.

Ссылка на результат сохраняется в адресе (`/?q=…`), её можно отправить другу.

## План развития

| Этап | Что | Статус |
|---|---|---|
| 1 | Проверка игрока по Steam-профилю | ✅ готово |
| 2 | Загрузка демок (`.dem`), статистика матча: K/D, ADR, HS%, раунды | планируется |
| 3 | 2D-реплей матча на радаре карты | планируется |
| 4 | Упрощённый 3D-просмотр | возможно |

## Структура

```
public/                 статика (отдаётся как есть)
  index.html
  css/style.css
  js/app.js             точка входа: форма, ?q=, загрузка/ошибки
  js/api.js             клиент к /api/*
  js/dom.js, format.js  безопасный DOM-хелпер, форматирование (ru-RU)
  js/views/player.js    отрисовка отчёта игрока (этап 1)
  _headers              CSP и заголовки безопасности
functions/api/          Pages Functions (серверная часть)
  profile.js            GET /api/profile?q=…
  health.js             GET /api/health
src/                    общий серверный код (импортируется функциями, наружу не отдаётся)
  steam/input.js        разбор ссылок / SteamID / vanity
  steam/client.js       обёртка над Steam Web API (таймауты, ошибки)
  steam/profile.js      сборка отчёта
  steam/flags.js        красные флаги
  http.js               JSON-ответы и тексты ошибок
tests/                  юнит-тесты (node --test)
scripts/shots.mjs       скриншоты страницы в headless Chrome
```

Новые этапы добавляются рядом: `functions/api/demo/*`, `src/demo/*` (парсер демок), `public/js/views/demo.js`, `public/js/replay/*` (2D-радар).

## API

`GET /api/profile?q=<ввод>` → один JSON:

```json
{
  "ok": true,
  "steamid": "76561197960435530",
  "profile": { "name": "…", "avatar": "…", "url": "…", "countryCode": "US", "created": 1063407589, "ageDays": 8416, "visibility": "public", "level": 32 },
  "bans": { "vacBanned": false, "vacBans": 0, "gameBans": 0, "daysSinceLastBan": null, "communityBanned": false, "economyBan": null },
  "games": { "visible": true, "count": 517, "cs2": { "owned": true, "minutesTotal": 10720, "minutes2w": 0 } },
  "friends": { "visible": true, "count": 149, "checked": 149, "capped": false, "vacBanned": 3, "gameBanned": 0, "anyBanned": 3 },
  "flags": [ { "severity": "medium", "code": "hidden_games", "title": "…", "text": "…" } ],
  "fetchedAt": "…", "cached": false
}
```

Ошибки: `{ "ok": false, "error": { "code": "...", "message": "..." } }`, коды `bad_input` (400), `not_found` (404), `rate_limited` (429), `steam_unavailable` (502), `not_configured` (500).
Ответы кэшируются на краю на 2 минуты.

## Локальный запуск

Нужны Node.js 22+ и ключ Steam Web API (https://steamcommunity.com/dev/apikey).

```bash
npm install
cp .dev.vars.example .dev.vars   # впишите STEAM_API_KEY=ваш_ключ
npm run dev                      # http://127.0.0.1:8788
npm test                         # юнит-тесты
```

`.dev.vars` в `.gitignore` — не коммитьте его.

## Деплой (Cloudflare Pages)

```bash
npx wrangler login                                        # один раз
npx wrangler pages project create cs2-check --production-branch main   # один раз
npx wrangler pages deploy --project-name cs2-check        # или npm run deploy
```

### Секрет STEAM_API_KEY

Ключ хранится только как секрет проекта Pages и никогда не попадает в код или в браузер:

```bash
npx wrangler pages secret put STEAM_API_KEY --project-name cs2-check
```

(или в панели Cloudflare: Workers & Pages → cs2-check → Settings → Variables and Secrets).
После изменения секрета сделайте повторный деплой. Проверка: `GET /api/health` → `"steamKeyConfigured": true`.

## Ограничения

- Данные только из открытого Steam Web API: закрытый профиль скрывает дату создания, игры и друзей (баны видны всегда).
- VAC/игровые баны Steam не указывают игру — бан мог быть не в CS2.
- Часы CS2 включают время в CS:GO (одна и та же appid 730).
- Друзья на баны проверяются максимум первые 300.
- Нет статистики матчей, Faceit и Premier-рейтинга — это следующие этапы.
