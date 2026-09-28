// Отрисовка разобранного матча: шапка, раунды, таблицы игроков.
import { h } from "../dom.js";

export const REASONS = {
  bomb: { text: "Взрыв бомбы", icon: "💥" },
  defuse: { text: "Разминирование", icon: "✂️" },
  elimination: { text: "Все убиты", icon: "☠️" },
  time: { text: "Время вышло", icon: "⏱️" },
  surrender: { text: "Сдача", icon: "🏳️" },
  hostages: { text: "Заложники", icon: "🧍" },
  other: { text: "Другое", icon: "•" },
};

export function mapTitle(map) {
  const m = String(map || "").replace(/^(de|cs|ar|dz)_/, "");
  return m ? m.charAt(0).toUpperCase() + m.slice(1) : "Неизвестная карта";
}
export function fmtDuration(sec) {
  const h0 = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h0 ? `${h0} ч ${m} мин` : `${m} мин ${String(s).padStart(2, "0")} с`;
}
const fmtMB = (b) => `${(b / 1024 / 1024).toFixed(0)} МБ`;
const fx = (v, d = 1) => (v === null || v === undefined ? "—" : v.toFixed(d).replace(".", ","));
const validId = (id) => /^7656\d{13}$/.test(id || "");

export function renderMatch(root, match, stats, { fromCache = false } = {}) {
  const teamName = (id) => match.teams.find((t) => t.id === id)?.name || id;
  const players = new Map(match.players.map((p) => [p.steamid, p]));
  root.replaceChildren(
    headerCard(match, fromCache),
    ...["A", "B"].map((t) => scoreboardCard(match, stats, t)),
    roundsCard(match, teamName, players),
    notesCard(match),
  );
  root.hidden = false;
}

function headerCard(match, fromCache) {
  const [A, B] = match.teams;
  const m = match.meta;
  const winner = A.score === B.score ? null : A.score > B.score ? "A" : "B";
  const t = m.timings;
  return h("article", { class: "card match-head" },
    h("div", { class: "mh-map" }, h("span", { class: "badge" }, mapTitle(m.map)), h("span", { class: "mh-sub" }, m.map)),
    h("div", { class: "mh-score" },
      h("div", { class: `mh-team ${winner === "A" ? "win" : ""}` }, h("span", { class: "mh-name" }, A.name), h("span", { class: "mh-side" }, `старт: ${A.startSide}`)),
      h("div", { class: "mh-num" }, h("b", { class: winner === "A" ? "win" : "" }, String(A.score)), h("span", {}, ":"), h("b", { class: winner === "B" ? "win" : "" }, String(B.score))),
      h("div", { class: `mh-team right ${winner === "B" ? "win" : ""}` }, h("span", { class: "mh-name" }, B.name), h("span", { class: "mh-side" }, `старт: ${B.startSide}`)),
    ),
    h("div", { class: "stats" },
      stat("Длительность", fmtDuration(m.durationSec)),
      stat("Раундов", String(match.rounds.length)),
      stat("Убийств", String(match.kills.length)),
      stat("Файл", fmtMB(m.fileSize), m.compressedSize ? `${m.fileName} · архив ${fmtMB(m.compressedSize)}` : m.fileName),
    ),
    Math.max(A.score, B.score) < (match.players.length <= 4 ? 9 : 13)
      ? h("p", { class: "note warn-note" }, `⚠️ Счёт не дошёл до ${match.players.length <= 4 ? 9 : 13} побед: возможно, матч не доигран (сдача голосованием), это другой режим или файл демки обрезан.`)
      : null,
    h("p", { class: "note" }, fromCache
      ? `Открыто из истории (разобрано ${new Date(m.parsedAt).toLocaleString("ru-RU")}).`
      : `Разобрано в браузере за ${fx((t?.totalMs || 0) / 1000)} с (чтение ${fx((t?.readMs || 0) / 1000)} с, парсинг ${fx((t?.parseMs || 0) / 1000)} с). Файл никуда не загружался.`),
  );
}

const stat = (k, v, s) => h("div", { class: "stat" }, h("div", { class: "k" }, k), h("div", { class: "v" }, v), s ? h("div", { class: "s" }, s) : null);

const COLS = [
  { key: "kills", label: "K", title: "Убийства" },
  { key: "deaths", label: "D", title: "Смерти" },
  { key: "assists", label: "A", title: "Помощь (в скобках — флешкой)", fmt: (r) => r.flashAssists ? `${r.assists} (${r.flashAssists})` : String(r.assists) },
  { key: "diff", label: "+/−", title: "Разница убийств и смертей", fmt: (r) => { const d = r.kills - r.deaths; return d > 0 ? `+${d}` : String(d); }, cls: (r) => (r.kills - r.deaths > 0 ? "pos" : r.kills - r.deaths < 0 ? "neg" : "") },
  { key: "kd", label: "K/D", title: "Убийства / смерти", fmt: (r) => fx(r.kd, 2) },
  { key: "adr", label: "ADR", title: "Средний урон за раунд", fmt: (r) => fx(r.adr, 1) },
  { key: "hsPct", label: "HS%", title: "Доля убийств в голову", fmt: (r) => `${Math.round(r.hsPct)}%` },
  { key: "kast", label: "KAST", title: "Доля раундов с убийством, помощью, выживанием или разменом", fmt: (r) => `${fx(r.kast, 1)}%` },
  { key: "entry", label: "Entry", title: "Первые убийства – первые смерти в раунде", fmt: (r) => `${r.entryKills}–${r.entryDeaths}` },
  { key: "clutches", label: "Клатчи", title: "Выигранные клатчи (1 против X) / сыгранные", fmt: (r) => `${r.clutchesWon}/${r.clutchesPlayed}` },
  { key: "multi", label: "2k/3k/4k/5k", title: "Раунды с 2, 3, 4 и 5 убийствами", fmt: (r) => `${r.multi[2]}/${r.multi[3]}/${r.multi[4]}/${r.multi[5]}` },
  { key: "utilDamage", label: "Урон гранат", title: "Урон HE-гранатами и молотовами по соперникам", fmt: (r) => String(Math.round(r.utilDamage)) },
  { key: "accuracy", label: "Точность*", title: "Попадания / выстрелы (огнестрел, без дробовиков) — приблизительно", fmt: (r) => (r.accuracy === null ? "—" : `${Math.round(r.accuracy)}%`) },
];

function scoreboardCard(match, stats, teamId) {
  const team = match.teams.find((t) => t.id === teamId);
  const other = match.teams.find((t) => t.id !== teamId);
  const rows = stats.byTeam[teamId];
  const win = team.score > other.score;
  return h("article", { class: "card" },
    h("h2", {}, h("span", { class: `dot ${win ? "win" : ""}` }), `${team.name} — ${team.score}`),
    h("div", { class: "table-wrap" },
      h("table", { class: "sb" },
        h("thead", {}, h("tr", {}, h("th", { class: "pl" }, "Игрок"), COLS.map((c) => h("th", { title: c.title }, c.label)))),
        h("tbody", {}, rows.map((r) => h("tr", {},
          h("td", { class: "pl" }, validId(r.steamid)
            ? h("a", { href: `/?q=${r.steamid}`, target: "_blank", rel: "noopener", title: "Проверить профиль Steam" }, r.name)
            : h("span", {}, r.name)),
          COLS.map((c) => h("td", { class: c.cls ? c.cls(r) : "" }, c.fmt ? c.fmt(r) : String(r[c.key]))),
        ))),
      ),
    ),
  );
}

function roundsCard(match, teamName, players) {
  const name = (id) => players.get(id)?.name || "?";
  const strip = h("div", { class: "rstrip", role: "list" }, match.rounds.map((r) =>
    h("span", { class: `rchip ${r.winnerTeam === "A" ? "ta" : "tb"} ${r.winnerSide === "CT" ? "ct" : "t"}`, role: "listitem",
      title: `Раунд ${r.n}: ${teamName(r.winnerTeam)} (${r.winnerSide}) — ${REASONS[r.reasonKey].text}` },
      h("small", {}, String(r.n)), REASONS[r.reasonKey].icon)));
  const list = h("ol", { class: "rlist" }, match.rounds.map((r) => {
    const first = r.kills.map((i) => match.kills[i]).filter((k) => k.attacker && k.attacker !== k.victim).sort((a, b) => a.tick - b.tick)[0];
    const bomb = r.bomb.planted ? `бомба ${r.bomb.planted.site ? "на " + r.bomb.planted.site : "заложена"}${r.bomb.defused ? ", разминирована" : r.bomb.exploded ? ", взорвалась" : ""}` : null;
    return h("li", { class: `rrow ${r.winnerTeam === "A" ? "ta" : "tb"}` },
      h("span", { class: "rn" }, String(r.n)),
      h("span", { class: "rw" }, h("b", {}, teamName(r.winnerTeam)), h("span", { class: `side ${r.winnerSide === "CT" ? "ct" : "t"}` }, r.winnerSide)),
      h("span", { class: "rr" }, `${REASONS[r.reasonKey].icon} ${REASONS[r.reasonKey].text}`),
      h("span", { class: "rs" }, `${r.score.A}:${r.score.B}`),
      h("span", { class: "rx" }, [first ? `первое убийство: ${name(first.attacker)} → ${name(first.victim)}` : null, bomb].filter(Boolean).join(" · ")),
    );
  }));
  return h("article", { class: "card" },
    h("h2", {}, "Раунды"),
    h("div", { class: "legend" }, h("span", { class: "rchip ta" }, " "), teamName("A"), h("span", { class: "rchip tb" }, " "), teamName("B")),
    strip,
    list,
  );
}

function notesCard(match) {
  return h("article", { class: "card" },
    h("h2", {}, "Как считается"),
    h("ul", { class: "notes" },
      h("li", {}, "K — убийства соперников (тимкиллы не засчитываются), D — все смерти в раундах матча, события после финального раунда не учитываются."),
      h("li", {}, "ADR — урон по соперникам с учётом оставшегося здоровья, делённый на число сыгранных раундов."),
      h("li", {}, "KAST — раунды с убийством, помощью, выживанием или разменом (размен — убийцу добили в течение 5 секунд)."),
      h("li", {}, "Клатч — игрок остался последним живым в команде против одного или нескольких соперников; засчитывается победа команды в раунде."),
      h("li", {}, "Помощь флешкой видна, только если игра записала её в событие убийства, поэтому может немного расходиться с HLTV."),
      h("li", {}, "* Точность — попадания/выстрелы огнестрельным оружием без дробовиков по событиям демки; ориентировочно."),
    ),
  );
}
