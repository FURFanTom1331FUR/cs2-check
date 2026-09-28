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

## Разбор демки (этап 2) — `/demo`

Выберите или перетащите файл `.dem` или `.dem.bz2` (демки CS2, обычно 100–500 МБ; `.bz2` из матчмейкинга распаковывается в браузере, ~10–15 МБ/с). Разбор идёт **в браузере**: в Web Worker
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

## Мои матчи (автопоиск) — `/matches`

Вместо ручной загрузки можно ввести **профиль Steam**, **код аутентификации игры** (`AAAA-AAAAA-AAAA`) и **код последнего матча**
(`CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx`). Оба кода выдаёт Steam на странице
[«Доступ к истории матчей CS2»](https://help.steampowered.com/ru/wizard/HelpWithGameIssue/?appid=730&issueid=128);
код матча есть и в CS2: «Смотреть» → «Ваши матчи» → «Поделиться».

- Сервер (`POST /api/matches`) идёт по цепочке `ICSGOPlayers_730/GetNextMatchSharingCode` от известного кода к новым —
  не больше 20 кодов за запрос (кнопка «Искать дальше» продолжает). Находятся официальные матчи Valve: Premier, соревновательный, напарники.
- Коды хранятся **только в браузере** (localStorage, можно отключить галочкой или стереть кнопкой «Забыть данные»).
  Код аутентификации приходит на сервер в теле POST, уходит только в Steam и **не сохраняется и не логируется**; ключ Steam остаётся на сервере.
- Для каждого матча показываются код, matchId, outcomeId (reservation) и token — они декодируются из кода прямо в браузере (`public/js/sharecode.js`).
- Ошибки на русском: неверный формат кодов, Steam не принял код аутентификации (403), код матча чужой/неверный (412), новых матчей нет (202 / `n/a`),
  лимит Steam (429) — при ошибке на середине цепочки уже найденные матчи не теряются.

### Откуда берётся демка

Код матча **не содержит** ссылки на демку. Ссылку (`http://replayNNN.valve.net/730/<matchid>_<reservation>.dem.bz2`) выдаёт только
игровой координатор CS2 (Game Coordinator) авторизованному клиенту Steam — ни Steam Web API, ни Cloudflare Functions этого не умеют
(нужно постоянное Steam-соединение). Поэтому есть **локальный помощник** `helper/` (Node.js, слушает только `127.0.0.1:27901`):

| Режим | Как работает | Что нужно |
|---|---|---|
| `boiler` (по умолчанию) | [boiler-writter](https://github.com/akiver/boiler-writter) (как в CS Demo Manager) спрашивает координатор через **ваш уже запущенный Steam** | Steam запущен и вы вошли; CS2 закрыта. Паролей не нужно |
| `bot` | отдельный Steam-аккаунт через `steam-user` + `globaloffensive` | логин/пароль бота (+ shared_secret) в `helper/.env` |

Сервера повторов Valve отдают демки **только по HTTP** (HTTPS не работает) и **без CORS**, поэтому страница на HTTPS не может скачать их напрямую.
Демку стримит помощник (`GET /demo?url=…`) или, если ссылка уже известна, узкий прокси сайта `GET /api/replay?url=…` (только `replay*.valve.net`,
до 700 МБ, без кэша; отключается переменной `REPLAY_PROXY=off`). Браузер распаковывает `.bz2` потоково прямо в память wasm
(`Bz2Stream`, чистый Rust `libbz2-rs-sys`) и разбирает тем же парсером этапа 2. Демки Valve хранятся **около месяца**.

Запуск помощника — см. [`helper/README.md`](helper/README.md).

## План развития

| Этап | Что | Статус |
|---|---|---|
| 1 | Проверка игрока по Steam-профилю | ✅ готово |
| 2 | Разбор демок (`.dem`) в браузере, статистика матча: счёт, раунды, K/D, ADR, HS%, KAST, клатчи | ✅ готово |
| 2.5 | Автопоиск своих матчей по кодам Steam, `.dem.bz2`, помощник для ссылок на демки | ✅ готово (скачивание демок — через помощника) |
| 3 | 2D-реплей матча на радаре карты (позиции уже извлекаются: `parseTicks` в wasm) | планируется |
| 4 | Упрощённый 3D-просмотр | возможно |

## Структура

```
public/                 статика (отдаётся как есть)
  index.html            проверка игрока (этап 1)
  demo.html             разбор демки (этап 2), /demo; /demo?src=… — автозапуск по ссылке помощника/прокси
  matches.html          мои матчи (автопоиск по кодам), /matches
  css/style.css
  js/app.js             точка входа проверки игрока: форма, ?q=, загрузка/ошибки
  js/api.js             клиент к /api/*
  js/dom.js, format.js  безопасный DOM-хелпер, форматирование (ru-RU)
  js/views/player.js    отрисовка отчёта игрока
  js/demo-page.js       страница демок: выбор файла, прогресс, история
  js/matches-page.js    мои матчи: форма, localStorage, список, помощник
  js/sharecode.js       декодирование/кодирование кодов матчей CSGO-… (общий для браузера, сервера и помощника)
  js/demo/config.js     какие события/свойства просим у парсера, определение формата файла
  js/demo/worker.js     Web Worker: чтение файла в память wasm, разбор, статистика
  js/demo/model.js      нормализованная модель матча (раунды, убийства, урон, гранаты, бомба + координаты)
  js/demo/stats.js      статистика игроков (K/D, ADR, KAST, entry, клатчи, мультикиллы…)
  js/demo/view.js       отрисовка матча
  js/demo/store.js      история матчей в IndexedDB
  vendor/cs2demo/       собранный wasm-парсер (≈3 МБ, ≈0,8 МБ в gzip) + лицензия demoparser2
  _headers              CSP (с 'wasm-unsafe-eval') и заголовки безопасности
wasm/                   исходники wasm-обёртки (Rust) и build.sh
  src/lib.rs            DemoBytes, Bz2Stream, parseHeader, parseEvents, parseTicks
  patches/              патч demoparser2 для wasm32 (Instant, новые protobuf)
functions/api/          Pages Functions (серверная часть)
  profile.js            GET /api/profile?q=…
  health.js             GET /api/health
  matches.js            POST /api/matches (цепочка кодов матчей)
  replay.js             GET /api/replay?url=… (узкий прокси к replay*.valve.net)
src/                    общий серверный код (импортируется функциями, наружу не отдаётся)
  steam/input.js        разбор ссылок / SteamID / vanity
  steam/client.js       обёртка над Steam Web API (таймауты, ошибки)
  steam/profile.js      сборка отчёта
  steam/flags.js        красные флаги
  steam/sharecodes.js   обход GetNextMatchSharingCode, разбор ошибок Steam
  replay.js             правило для ссылок на демки Valve
  http.js               JSON-ответы и тексты ошибок
helper/                 локальный помощник (Node.js): ссылки на демки от координатора CS2 и их загрузка
tests/                  юнит-тесты (node --test)
scripts/shots.mjs       скриншоты страницы в headless Chrome
scripts/demo-test.mjs   разбор демки в headless Chrome (время, память, скриншоты)
scripts/matches-test.mjs, fake-helper.mjs   проверка «Моих матчей» и полного пути помощник → .bz2 → разбор
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

`POST /api/matches` (JSON `{ "q": "<профиль>", "authCode": "AAAA-AAAAA-AAAA", "knownCode": "CSGO-…", "max": 20 }`) →

```json
{
  "ok": true,
  "player": { "steamid": "7656…", "name": "…", "avatar": "…" },
  "knownCode": "CSGO-…",
  "matches": [ { "code": "CSGO-…", "matchId": "3230642215713767580", "outcomeId": "3230647599455273103", "token": 55788 } ],
  "newestCode": "CSGO-…", "finished": true, "hasMore": false, "warning": null
}
```

Ошибки: `bad_auth_code_format` / `bad_share_code_format` (400), `bad_auth_code` (403), `bad_known_code` (412), `rate_limited` (429), `steam_unavailable` (502). Ответ не кэшируется.

`GET /api/replay?url=http://replayNNN.valve.net/730/…_….dem.bz2` → поток `.dem.bz2`; ошибки `bad_replay_url` (400), `demo_unavailable` (404), `too_large` (413).

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
- Демки: только CS2 (не CS:GO); `.rar/.zip/.gz` нужно распаковать (`.dem.bz2` — нет); прогресс разбора примерный (парсер не сообщает процент).
- KAST, размены и флеш-ассисты считаются по событиям демки и могут отличаться от HLTV на 1; рейтинга HLTV нет.
- Точность — ориентировочная (выстрелы/попадания по событиям, без дробовиков).
- «Мои матчи»: без помощника сайт показывает только коды матчей; ссылку на демку выдаёт лишь координатор CS2. Демки старше ~30 дней Valve удаляет.
- Помощник обращается к `http://127.0.0.1:27901` со страницы HTTPS: Chrome/Edge/Firefox это разрешают (новый Chrome может спросить разрешение
  на доступ к локальной сети), Safari может блокировать.
- Нужна поддержка WebAssembly и module-воркеров (актуальные Chrome, Edge, Firefox, Safari).
