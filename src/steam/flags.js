// «Красные флаги» — только косвенные признаки. Ни один из них не доказывает читерство.
// severity: "high" | "medium" | "low"

const YEAR = 365;

export function buildFlags(r, { isPublic }) {
  const flags = [];
  const add = (severity, code, title, text) => flags.push({ severity, code, title, text });
  const { profile, bans, games, friends } = r;

  const banCount = bans.vacBans + bans.gameBans;
  if (banCount > 0) {
    const d = bans.daysSinceLastBan;
    const kinds = [bans.vacBans ? `VAC: ${bans.vacBans}` : null, bans.gameBans ? `игровых: ${bans.gameBans}` : null]
      .filter(Boolean).join(", ");
    if (d !== null && d <= YEAR) {
      add("high", "recent_ban", "Недавний бан", `Последний бан был ${plural(d, "день", "дня", "дней")} назад (${kinds}).`);
    } else {
      add("medium", "old_ban", "На аккаунте есть бан",
        `${kinds}${d !== null ? `, последний — ${plural(d, "день", "дня", "дней")} назад` : ""}. Бан может относиться к другой игре.`);
    }
  }
  if (bans.communityBanned) add("medium", "community_ban", "Бан в сообществе Steam", "Аккаунт заблокирован в сообществе Steam.");
  if (bans.economyBan) add("medium", "economy_ban", "Торговые ограничения", `Статус торговой блокировки: ${bans.economyBan}.`);

  if (!isPublic) {
    add("medium", "private_profile", "Профиль скрыт",
      "Закрытый профиль не даёт проверить часы, друзей и дату создания. Многие закрывают профиль просто из-за приватности.");
  } else if (!games.visible && !games.error) {
    add("medium", "hidden_games", "Библиотека игр скрыта", "Часы в CS2 и список игр недоступны — проверить опыт игрока нельзя.");
  }

  if (profile.ageDays !== null) {
    if (profile.ageDays < 90) {
      add("high", "new_account", "Очень новый аккаунт", `Аккаунту ${plural(profile.ageDays, "день", "дня", "дней")}.`);
    } else if (profile.ageDays < YEAR) {
      add("medium", "new_account", "Новый аккаунт", `Аккаунту меньше года (${plural(profile.ageDays, "день", "дня", "дней")}).`);
    }
  }

  if (profile.level !== null && profile.level < 5) {
    add(profile.level <= 1 ? "medium" : "low", "low_level", "Низкий уровень Steam", `Уровень ${profile.level}.`);
  }

  const cs2 = games.cs2;
  if (games.visible && cs2) {
    const hours = cs2.minutesTotal / 60;
    if (profile.ageDays !== null && profile.ageDays >= 3 * YEAR && cs2.owned && hours < 50) {
      add("medium", "few_hours_old_account", "Мало часов в CS2 на старом аккаунте",
        `Аккаунту ${plural(Math.floor(profile.ageDays / YEAR), "год", "года", "лет")}, а в CS2 всего ${formatHours(cs2.minutesTotal)}. Такое бывает у купленных или «запасных» аккаунтов, но и у обычных игроков, вернувшихся в игру.`);
    }
    if (!cs2.owned) add("low", "no_cs2", "CS2 не найден в библиотеке", "Возможно, игра не запускалась с этого аккаунта или данные скрыты.");
  }

  if (friends.visible && friends.checked > 0 && friends.anyBanned !== null) {
    const share = friends.anyBanned / friends.checked;
    const pct = Math.round(share * 100);
    const text = `${friends.anyBanned} из ${friends.checked} проверенных друзей имеют VAC- или игровые баны (${pct}%).`;
    if (friends.anyBanned >= 5 && share >= 0.25) add("high", "banned_friends", "Много друзей с банами", text);
    else if (friends.anyBanned >= 3 && share >= 0.1) add("medium", "banned_friends", "Заметная доля друзей с банами", text);
  } else if (isPublic && !friends.visible && !friends.error) {
    add("low", "hidden_friends", "Список друзей скрыт", "Проверить друзей на баны нельзя.");
  }

  const order = { high: 0, medium: 1, low: 2 };
  flags.sort((a, b) => order[a.severity] - order[b.severity]);
  return flags;
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  const w = a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many;
  return `${n} ${w}`;
}

function formatHours(min) {
  const h = min / 60;
  return h < 10 ? `${h.toFixed(1).replace(".", ",")} ч` : `${Math.round(h)} ч`;
}
