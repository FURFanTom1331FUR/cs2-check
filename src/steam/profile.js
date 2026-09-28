// Сборка полной карточки игрока из нескольких методов Steam Web API.
import { SteamError } from "./client.js";
import { buildFlags } from "./flags.js";

export const CS2_APPID = 730;
export const FRIENDS_BAN_CHECK_CAP = 300; // максимум друзей, проверяемых на баны (3 запроса по 100)
const BANS_BATCH = 100;

const VISIBILITY = { 1: "private", 2: "friends_only", 3: "public" };

// Необязательные запросы не должны ронять всю проверку: при сбое — null + пометка.
async function soft(promise, warnings, name) {
  try {
    return await promise;
  } catch (e) {
    if (e instanceof SteamError && e.kind === "forbidden") return null;
    warnings.push(name);
    return undefined;
  }
}

export async function buildPlayerReport(steam, steamid, now = Date.now()) {
  const [players, bansList] = await Promise.all([steam.getSummaries([steamid]), steam.getBans([steamid])]);
  const p = players[0];
  if (!p) return null;

  const warnings = [];
  const isPublic = p.communityvisibilitystate === 3;

  const [level, owned, friendIds] = await Promise.all([
    soft(steam.getLevel(steamid), warnings, "level"),
    soft(steam.getOwnedGames(steamid), warnings, "games"),
    soft(steam.getFriendIds(steamid), warnings, "friends"),
  ]);

  const b = bansList[0] || {};
  const bans = {
    vacBanned: !!b.VACBanned,
    vacBans: b.NumberOfVACBans ?? 0,
    gameBans: b.NumberOfGameBans ?? 0,
    daysSinceLastBan: (b.NumberOfVACBans || b.NumberOfGameBans) ? (b.DaysSinceLastBan ?? null) : null,
    communityBanned: !!b.CommunityBanned,
    economyBan: b.EconomyBan && b.EconomyBan !== "none" ? b.EconomyBan : null,
  };

  const created = typeof p.timecreated === "number" ? p.timecreated : null;
  const ageDays = created ? Math.floor((now / 1000 - created) / 86400) : null;

  let games = { visible: false, count: null, cs2: null };
  if (owned) {
    const g = owned.games.find((x) => x.appid === CS2_APPID);
    games = {
      visible: true,
      count: owned.count,
      cs2: {
        owned: !!g,
        minutesTotal: g ? g.playtime_forever ?? 0 : 0,
        minutes2w: g ? g.playtime_2weeks ?? 0 : 0,
        lastPlayed: g && g.rtime_last_played ? g.rtime_last_played : null,
      },
    };
  } else if (owned === undefined) {
    games.error = true;
  }

  let friends = { visible: false, count: null };
  if (Array.isArray(friendIds)) {
    friends = { visible: true, count: friendIds.length, ...(await checkFriendBans(steam, friendIds, warnings)) };
  } else if (friendIds === undefined) {
    friends.error = true;
  }

  const profile = {
    steamid,
    name: p.personaname ?? "",
    avatar: p.avatarfull || p.avatarmedium || p.avatar || null,
    url: p.profileurl || `https://steamcommunity.com/profiles/${steamid}/`,
    countryCode: p.loccountrycode || null,
    created,
    ageDays,
    visibility: VISIBILITY[p.communityvisibilitystate] || "private",
    configured: p.profilestate === 1,
    level: typeof level === "number" ? level : null,
    lastLogoff: p.lastlogoff || null,
    personaState: p.personastate ?? 0,
  };

  const report = { steamid, profile, bans, games, friends, warnings };
  report.flags = buildFlags(report, { isPublic });
  return report;
}

async function checkFriendBans(steam, ids, warnings) {
  const toCheck = ids.slice(0, FRIENDS_BAN_CHECK_CAP);
  const batches = [];
  for (let i = 0; i < toCheck.length; i += BANS_BATCH) batches.push(toCheck.slice(i, i + BANS_BATCH));
  let results;
  try {
    results = (await Promise.all(batches.map((ids) => steam.getBans(ids)))).flat();
  } catch {
    warnings.push("friends_bans");
    return { checked: 0, capped: ids.length > toCheck.length, vacBanned: null, gameBanned: null, anyBanned: null };
  }
  let vac = 0, game = 0, any = 0;
  for (const r of results) {
    const hasVac = !!r.VACBanned || (r.NumberOfVACBans ?? 0) > 0;
    const hasGame = (r.NumberOfGameBans ?? 0) > 0;
    if (hasVac) vac++;
    if (hasGame) game++;
    if (hasVac || hasGame) any++;
  }
  return { checked: results.length, capped: ids.length > toCheck.length, vacBanned: vac, gameBanned: game, anyBanned: any };
}
