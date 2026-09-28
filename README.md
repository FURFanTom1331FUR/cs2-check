# CS2 Check

Сайт для быстрой проверки игрока CS2 по профилю Steam и разбора демок — в духе Leetify / CSStats / Faceit Finder.
Работает на **Cloudflare Pages** + **Pages Functions**; ключ Steam Web API хранится только на сервере,
а демки разбираются прямо в браузере (WebAssembly) и никуда не загружаются.

**Сайт:** https://cs2-check.pages.dev

## Проверка игрока (этап 1)

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

## Демо и матчи (этап 2) — `/demo`

Выберите или перетащите файл `.dem` (демки CS2, обычно 100–500 МБ). Разбор идёт **в браузере**: в Web Worker
работает парсер [demoparser2](https://github.com/LaihoE/demoparser) (Rust → WebAssembly), файл читается кусками
прямо в память wasm. На сервер ничего не отправляется.

Показывается:

- карта, итоговый счёт, названия команд (из демки; если их нет — «Команда A/B»), длительность, число раундов;
- лента и список раундов: кто выиграл (команда и сторона), как (взрыв, разминирование, все убиты, время), счёт, бомба (сайт A/B), первое убийство;
- таблица каждой команды: K, D, A (флеш-ассисты), +/−, K/D, ADR, HS%, KAST, entry (первые убийства–смерти), клатчи (выиграно/сыграно),
  мультикиллы 2k/3k/4k/5k, урон гранатами, точность (ориентировочно). Ник игрока ведёт на проверку профиля (`/?q=SteamID64`).
- последние 5 матчей сохраняются в IndexedDB и открываются без повторного разбора.

Ошибки на русском: демка CS:GO, архив вместо `.dem`, не демка, повреждённый/обрезанный файл, нехватка памяти.

Проверено на демках HLTV (SINNERS vs GamerLegion, 1win Private Club S1): K, D, HS, ADR, entry, мультикиллы и счёт совпали с
HLTV; KAST и флеш-ассисты расходятся максимум на 1. Разбор демки 359 МБ — ~5 с, 521 МБ — ~7,5 с в Chrome на ПК.

**Память:** браузеру нужно примерно размер демки + 150–300 МБ; на телефоне большие демки могут не открыться — лучше ПК.

## План развития

| Этап | Что | Статус |
|---|---|---|
| 1 | Проверка игрока по Steam-профилю | ✅ готово |
| 2 | Разбор демок (`.dem`) в браузере, статистика матча: счёт, раунды, K/D, ADR, HS%, KAST, клатчи | ✅ готово |
| 3 | 2D-реплей матча на радаре карты (позиции уже извлекаются: `parseTicks` в wasm) | планируется |
| 4 | Упрощённый 3D-просмотр | возможно |

## Структура

```
public/                 статика (отдаётся как есть)
  index.html            проверка игрока (этап 1)
  demo.html             демо и матчи (этап 2), доступна как /demo
  css/style.css
  js/app.js             точка входа проверки игрока: форма, ?q=, загрузка/ошибки
  js/api.js             клиент к /api/*
  js/dom.js, format.js  безопасный DOM-хелпер, форматирование (ru-RU)
  js/views/player.js    отрисовка отчёта игрока
  js/demo-page.js       страница демок: выбор файла, прогресс, история
  js/demo/config.js     какие события/свойства просим у парсера, определение формата файла
  js/demo/worker.js     Web Worker: чтение файла в память wasm, разбор, статистика
  js/demo/model.js      нормализованная модель матча (раунды, убийства, урон, гранаты, бомба + координаты)
  js/demo/stats.js      статистика игроков (K/D, ADR, KAST, entry, клатчи, мультикиллы…)
  js/demo/view.js       отрисовка матча
  js/demo/store.js      история матчей в IndexedDB
  vendor/cs2demo/       собранный wasm-парсер (≈3 МБ, ≈0,8 МБ в gzip) + лицензия demoparser2
  _headers              CSP (с 'wasm-unsafe-eval') и заголовки безопасности
wasm/                   исходники wasm-обёртки (Rust) и build.sh
  src/lib.rs            DemoBytes, parseHeader, parseEvents, parseTicks
  patches/              патч demoparser2 для wasm32 (Instant, новые protobuf)
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

Этап 3 (2D-реплей) добавится рядом: `public/replay.html`, `public/js/replay/*`. Он использует ту же модель матча
(`model.js`: убийства, гранаты и бомба уже с координатами) и функцию wasm `parseTicks` для позиций игроков по тикам
(проверено: X/Y/Z, yaw, здоровье каждые 16 тиков для демки 359 МБ — ~4,5 с, ~130 тыс. строк).

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

## Сборка wasm-парсера

Готовый бандл лежит в `public/vendor/cs2demo/` и закоммичен, пересобирать нужно только при обновлении парсера.

Нужны: Rust через rustup с таргетом `wasm32-unknown-unknown`, `protoc`, `wasm-bindgen-cli 0.2.100`, git.

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.100 --locked
./wasm/build.sh      # клонирует demoparser2 (закреплённый коммит), применяет патч, собирает
```

После обновления поменяйте `WASM_VERSION` в `public/js/demo/config.js`, чтобы браузеры не взяли старый файл из кэша.

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
- Нет Faceit и Premier-рейтинга.
- Демки: только CS2 (не CS:GO); архивы нужно распаковать; прогресс разбора примерный (парсер не сообщает процент).
- KAST, размены и флеш-ассисты считаются по событиям демки и могут отличаться от HLTV на 1; рейтинга HLTV нет.
- Точность — ориентировочная (выстрелы/попадания по событиям, без дробовиков).
- Нужна поддержка WebAssembly и module-воркеров (актуальные Chrome, Edge, Firefox, Safari).
