// Отрисовка отчёта по игроку (этап 1). Следующие этапы добавят свои views/*.js.
import { h } from "../dom.js";
import { pl, fmtInt, fmtDate, fmtAge, fmtHours, countryName, flagEmoji } from "../format.js";

const VIS = {
  public: { text: "Профиль открыт", cls: "ok" },
  friends_only: { text: "Только для друзей", cls: "warn" },
  private: { text: "Профиль скрыт", cls: "warn" },
};
const SEVERITY = { high: "Высокий", medium: "Средний", low: "Низкий" };

const stat = (k, v, s, cls) => h("div", { class: `stat ${cls || ""}` }, h("div", { class: "k" }, k), h("div", { class: "v" }, v), s ? h("div", { class: "s" }, s) : null);

export function renderPlayer(root, d) {
  root.replaceChildren(
    profileCard(d),
    flagsCard(d),
    bansCard(d),
    cs2Card(d),
    friendsCard(d),
    h("p", { class: "meta" }, `SteamID64: ${d.steamid} · данные на ${new Date(d.fetchedAt).toLocaleString("ru-RU")}${d.cached ? " (из кэша)" : ""}`),
  );
  root.hidden = false;
}

function profileCard(d) {
  const p = d.profile;
  const vis = VIS[p.visibility] || VIS.private;
  const country = p.countryCode ? `${flagEmoji(p.countryCode)} ${countryName(p.countryCode)}` : null;
  const badges = [
    h("span", { class: `badge ${vis.cls}` }, vis.text),
    p.level !== null ? h("span", { class: "badge" }, `Уровень ${p.level}`) : null,
    country ? h("span", { class: "badge" }, country) : null,
    (d.bans.vacBans || d.bans.gameBans) ? h("span", { class: "badge bad" }, "Есть баны") : h("span", { class: "badge ok" }, "Банов нет"),
  ];
  return h("article", { class: "card" },
    h("div", { class: "profile" },
      p.avatar ? h("img", { class: "avatar", src: p.avatar, alt: `Аватар ${p.name}`, width: 96, height: 96, referrerpolicy: "no-referrer", decoding: "async" }) : h("div", { class: "avatar" }),
      h("div", { style: { minWidth: 0 } },
        h("p", { class: "pname" }, p.name || "Без имени"),
        h("a", { class: "plink", href: p.url, target: "_blank", rel: "noopener noreferrer" }, p.url),
        h("div", { class: "badges" }, badges),
      ),
    ),
    h("div", { class: "stats" },
      stat("Аккаунт создан", p.created ? fmtDate(p.created) : "скрыто", p.created ? null : "видно только в открытом профиле"),
      stat("Возраст аккаунта", p.ageDays !== null ? fmtAge(p.ageDays) : "—", null, p.ageDays !== null && p.ageDays < 365 ? "warn" : ""),
      stat("Уровень Steam", p.level !== null ? String(p.level) : "скрыт", null, p.level !== null && p.level < 5 ? "warn" : ""),
      stat("Страна", country || "не указана"),
    ),
    p.visibility !== "public"
      ? h("p", { class: "note" }, "Профиль закрыт: дата создания, игры и друзья недоступны. Баны видны всегда.")
      : null,
  );
}

function bansCard(d) {
  const b = d.bans;
  const any = b.vacBans + b.gameBans > 0;
  return h("article", { class: "card half" },
    h("h2", {}, "Баны"),
    h("div", { class: `verdict ${any || b.communityBanned || b.economyBan ? "bad" : "ok"}` },
      any ? `Найдено банов: ${b.vacBans + b.gameBans}` : (b.communityBanned || b.economyBan) ? "Есть ограничения в Steam" : "VAC- и игровых банов нет"),
    h("div", { class: "stats" },
      stat("VAC-баны", String(b.vacBans), null, b.vacBans ? "bad" : "ok"),
      stat("Игровые баны", String(b.gameBans), null, b.gameBans ? "bad" : "ok"),
      stat("С последнего бана", b.daysSinceLastBan !== null ? pl(b.daysSinceLastBan, "день", "дня", "дней") : "—", null, b.daysSinceLastBan !== null && b.daysSinceLastBan <= 365 ? "bad" : ""),
      stat("Бан в сообществе", b.communityBanned ? "да" : "нет", null, b.communityBanned ? "bad" : "ok"),
      stat("Торговый бан", b.economyBan ? b.economyBan : "нет", null, b.economyBan ? "bad" : "ok"),
    ),
    h("p", { class: "note" }, "VAC- и игровые баны Steam не указывают игру — бан мог быть выдан не в CS2."),
  );
}

function cs2Card(d) {
  const g = d.games;
  const body = [];
  if (!g.visible) {
    body.push(h("div", { class: "alert warn" }, h("span", { class: "ico" }, "🔒"),
      h("div", {}, h("h3", {}, g.error ? "Не удалось получить игры" : "Библиотека игр скрыта"),
        h("p", {}, g.error ? "Steam не ответил на запрос списка игр. Попробуйте позже." : "Игрок скрыл список игр или весь профиль, поэтому часы в CS2 неизвестны."))));
  } else {
    const c = g.cs2;
    body.push(h("div", { class: "stats" },
      stat("Всего в CS2", c.owned ? fmtHours(c.minutesTotal) : "нет игры", c.owned ? null : "CS2 не найден в библиотеке"),
      stat("За 2 недели", c.owned ? fmtHours(c.minutes2w) : "—"),
      stat("Игр в библиотеке", fmtInt(g.count)),
    ));
    if (c.lastPlayed) body.push(h("p", { class: "note" }, `Последний запуск CS2: ${fmtDate(c.lastPlayed)}.`));
    body.push(h("p", { class: "note" }, "Часы учитывают и CS:GO — у Steam это одна игра (appid 730)."));
  }
  return h("article", { class: "card half" }, h("h2", {}, "Counter-Strike 2"), body);
}

function friendsCard(d) {
  const f = d.friends;
  const body = [];
  if (!f.visible) {
    body.push(h("div", { class: "alert warn" }, h("span", { class: "ico" }, "🔒"),
      h("div", {}, h("h3", {}, f.error ? "Не удалось получить друзей" : "Список друзей скрыт"),
        h("p", {}, f.error ? "Steam не ответил на запрос. Попробуйте позже." : "Проверить друзей на баны нельзя."))));
  } else {
    const pct = f.checked ? Math.round((f.anyBanned / f.checked) * 100) : 0;
    body.push(h("div", { class: "stats" },
      stat("Друзей", fmtInt(f.count)),
      stat("С VAC-банами", f.vacBanned !== null ? fmtInt(f.vacBanned) : "—", null, f.vacBanned ? "warn" : ""),
      stat("С игровыми банами", f.gameBanned !== null ? fmtInt(f.gameBanned) : "—", null, f.gameBanned ? "warn" : ""),
      stat("Доля с банами", f.checked ? `${pct}%` : "—", f.checked ? `${fmtInt(f.anyBanned)} из ${fmtInt(f.checked)}` : null, pct >= 25 ? "bad" : pct >= 10 ? "warn" : ""),
    ));
    if (f.checked) body.push(h("div", { class: "bar", title: `${pct}% друзей с банами` }, h("i", { style: { width: `${Math.min(100, pct)}%` } })));
    if (f.capped) body.push(h("p", { class: "note" }, `На баны проверены первые ${fmtInt(f.checked)} друзей из ${fmtInt(f.count)}.`));
  }
  return h("article", { class: "card" }, h("h2", {}, "Друзья"), body);
}

function flagsCard(d) {
  const list = d.flags.length
    ? h("ul", { class: "flags" }, d.flags.map((f) =>
        h("li", { class: `flag ${f.severity}` },
          h("span", { class: "lvl" }, SEVERITY[f.severity] || f.severity),
          h("div", {}, h("h3", {}, f.title), h("p", {}, f.text)))))
    : h("div", { class: "noflags" }, "Явных тревожных признаков не найдено. Это тоже не гарантия честной игры.");
  return h("article", { class: "card" },
    h("h2", {}, "Красные флаги"),
    list,
    h("div", { class: "disclaimer" },
      "Это подсказки, а не доказательство читерства. Сайт не определяет читы: он лишь показывает открытые данные Steam, " +
      "которые иногда встречаются у нечестных игроков — и так же часто у обычных. Делайте выводы сами, лучше — по демкам матчей."),
  );
}
