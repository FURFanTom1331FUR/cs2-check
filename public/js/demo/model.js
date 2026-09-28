// Сырые события парсера -> нормализованная модель матча.
// Модель общая для этапов: статистика (этап 2) и 2D-реплей (этап 3) используют одни и те же
// раунды, убийства, урон, гранаты и события бомбы (с координатами).
import { TICKRATE } from "./config.js";

export const MODEL_VERSION = 1;

const SIDE = { 2: "T", 3: "CT" };
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pos = (e, p) => (num(e[`${p}_X`]) !== null ? [round1(e[`${p}_X`]), round1(e[`${p}_Y`]), round1(e[`${p}_Z`])] : null);
const round1 = (v) => Math.round(v * 10) / 10;

const REASON_KEYS = {
  bomb_exploded: "bomb", bomb_defused: "defuse", t_killed: "elimination", ct_killed: "elimination",
  time_ran_out: "time", target_saved: "time", t_surrender: "surrender", ct_surrender: "surrender",
  terrorists_surrender: "surrender", cts_surrender: "surrender", hostages_rescued: "hostages",
};
// Числовые коды RoundEndReason (на случай, если парсер отдаст число).
const REASON_BY_CODE = { 1: "bomb_exploded", 7: "bomb_defused", 8: "t_killed", 9: "ct_killed", 12: "time_ran_out", 17: "t_surrender", 18: "ct_surrender" };

export function buildMatch(raw, info = {}) {
  const events = raw.events.slice().sort((a, b) => a.tick - b.tick);
  const byName = (n) => events.filter((e) => e.event_name === n);

  // ---- Раунды: берём round_end с победителем; при рестарте матча (счётчик раундов сбросился) начинаем заново.
  let ends = [];
  let lastN = -1;
  for (const e of byName("round_end")) {
    const winner = normSide(e.winner);
    if (!winner || e.is_warmup_period) continue;
    const n = num(e.total_rounds_played) ?? ends.length + 1;
    if (n <= lastN) ends = ends.filter((r) => r._n < n); // рестарт / дубль
    if (ends.length && e.tick - ends[ends.length - 1].tick < TICKRATE) continue; // дубль события
    ends.push({ tick: e.tick, winner, reason: normReason(e.reason), gameTime: num(e.game_time), _n: n, message: e.message ?? null });
    lastN = n;
  }
  const starts = byName("round_start").map((e) => e.tick);
  const freezeEnds = byName("round_freeze_end").map((e) => e.tick);
  const officialEnds = byName("round_officially_ended").map((e) => e.tick);

  const rounds = ends.map((e, i) => {
    const prevEnd = i > 0 ? ends[i - 1].tick : -Infinity;
    const startTick = lastBetween(starts, prevEnd, e.tick) ?? (i > 0 ? prevEnd + 1 : 0);
    return {
      n: i + 1,
      startTick,
      freezeEndTick: lastBetween(freezeEnds, startTick - 1, e.tick),
      endTick: e.tick,
      officialEndTick: firstAfter(officialEnds, e.tick, ends[i + 1]?.tick ?? Infinity),
      winnerSide: e.winner,
      reason: e.reason,
      reasonKey: REASON_KEYS[e.reason] || "other",
      gameTimeEnd: e.gameTime,
      kills: [],
      bomb: { planted: null, defused: null, exploded: null },
    };
  });
  // Окно раунда: [старт раунда, старт следующего) — «выходные» убийства после round_end идут в свой раунд.
  // После финального round_end матч окончен: события «после матча» (например, самоубийства) не считаем.
  const windowEnd = (i) => (i + 1 < rounds.length ? rounds[i + 1].startTick : rounds[i].endTick + 1);
  const roundAt = (tick) => {
    if (!rounds.length || tick < rounds[0].startTick) return null;
    let lo = 0, hi = rounds.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rounds[mid].startTick <= tick) lo = mid; else hi = mid - 1;
    }
    return tick < windowEnd(lo) ? lo : null;
  };

  // ---- Игроки
  const players = new Map();
  const seen = (steamid, name, side, round, clan) => {
    if (!steamid || steamid === "0") return null;
    let p = players.get(steamid);
    if (!p) {
      p = { steamid, name: name || steamid, sides: new Map(), clans: new Map(), firstRound: Infinity, lastRound: -1 };
      players.set(steamid, p);
    }
    if (name) p.name = name;
    if (round !== null) {
      p.firstRound = Math.min(p.firstRound, round);
      p.lastRound = Math.max(p.lastRound, round);
      if (side) p.sides.set(round, side);
    }
    if (clan) p.clans.set(clan, (p.clans.get(clan) || 0) + 1);
    return p;
  };
  const touch = (e, prefix, r) => seen(e[`${prefix}_steamid`], e[`${prefix}_name`], SIDE[e[`${prefix}_team_num`]] || null, r, e[`${prefix}_team_clan_name`] || null);

  const kills = [], damages = [], grenades = [], shots = [];
  for (const e of events) {
    const r = roundAt(e.tick);
    if (r === null) continue;
    switch (e.event_name) {
      case "player_death": {
        const victim = touch(e, "user", r);
        const attacker = touch(e, "attacker", r);
        const assister = touch(e, "assister", r);
        if (!victim) break;
        const k = {
          tick: e.tick, round: r,
          attacker: attacker?.steamid ?? null, victim: victim.steamid, assister: assister?.steamid ?? null,
          attackerSide: SIDE[e.attacker_team_num] || null, victimSide: SIDE[e.user_team_num] || null,
          assisterSide: SIDE[e.assister_team_num] || null,
          weapon: e.weapon || "", headshot: !!e.headshot, flashAssist: !!e.assistedflash,
          wallbang: (e.penetrated || 0) > 0, throughSmoke: !!e.thrusmoke, noscope: !!e.noscope, attackerBlind: !!e.attackerblind,
          attackerPos: pos(e, "attacker"), victimPos: pos(e, "user"), place: e.user_last_place_name || null,
        };
        rounds[r].kills.push(kills.length);
        kills.push(k);
        break;
      }
      case "player_hurt": {
        const victim = touch(e, "user", r);
        const attacker = touch(e, "attacker", r);
        if (!victim) break;
        damages.push({
          tick: e.tick, round: r, attacker: attacker?.steamid ?? null, victim: victim.steamid,
          attackerSide: SIDE[e.attacker_team_num] || null, victimSide: SIDE[e.user_team_num] || null,
          dmg: e.dmg_health || 0, dmgArmor: e.dmg_armor || 0, health: e.health ?? null, weapon: e.weapon || "", hitgroup: e.hitgroup || "",
        });
        break;
      }
      case "weapon_fire": {
        const p = touch(e, "user", r);
        if (p) shots.push({ tick: e.tick, round: r, steamid: p.steamid, weapon: (e.weapon || "").replace(/^weapon_/, "") });
        break;
      }
      case "hegrenade_detonate": case "flashbang_detonate": case "smokegrenade_detonate": case "inferno_startburn": case "decoy_started": {
        const p = touch(e, "user", r);
        grenades.push({
          tick: e.tick, round: r, type: e.event_name.split("_")[0].replace("grenade", "").replace("inferno", "molotov").replace("flashbang", "flash") || "he",
          thrower: p?.steamid ?? null, side: SIDE[e.user_team_num] || null, pos: num(e.x) !== null ? [round1(e.x), round1(e.y), round1(e.z)] : null,
        });
        break;
      }
      case "bomb_planted": case "bomb_defused": case "bomb_exploded": {
        const p = touch(e, "user", r);
        const key = e.event_name.split("_")[1];
        const site = siteLetter(e.user_last_place_name);
        rounds[r].bomb[key] = { tick: e.tick, steamid: key === "exploded" ? null : p?.steamid ?? null, siteId: e.site ?? null, site, pos: pos(e, "user") };
        break;
      }
    }
  }
  for (const g of grenades) if (g.type === "") g.type = "he";

  // Игроки из финального состава считаются игравшими до последнего раунда.
  const finalIds = new Set([...(raw.players || []), ...(raw.roster || [])].map((p) => p.steamid).filter(Boolean));
  for (const p of players.values()) if (finalIds.has(p.steamid) && p.lastRound >= 0) p.lastRound = rounds.length - 1;

  // ---- Команды: команда A — игроки, которые были за CT в первом раунде, где их видно.
  const teams = assignTeams(players, rounds);
  const plist = [...players.values()].filter((p) => p.team);
  for (const r of rounds) {
    r.sideOfTeam = teams.sideByRound[r.n - 1];
    r.winnerTeam = r.sideOfTeam ? (r.sideOfTeam.A === r.winnerSide ? "A" : "B") : null;
  }
  let a = 0, b = 0;
  for (const r of rounds) {
    if (r.winnerTeam === "A") a++; else if (r.winnerTeam === "B") b++;
    r.score = { A: a, B: b };
  }

  const firstTick = rounds[0]?.startTick ?? 0;
  const lastTick = rounds.length ? (rounds[rounds.length - 1].officialEndTick ?? rounds[rounds.length - 1].endTick) : 0;
  const header = raw.header || {};
  return {
    modelVersion: MODEL_VERSION,
    meta: {
      map: header.map_name || "unknown",
      server: header.server_name || null,
      patch: header.patch_version || null,
      client: header.client_name || null,
      tickrate: TICKRATE,
      firstTick, lastTick,
      durationSec: Math.max(0, Math.round((lastTick - firstTick) / TICKRATE)),
      ...info,
    },
    teams: [
      { id: "A", name: teams.names.A, startSide: rounds[0]?.sideOfTeam?.A || "CT", score: a },
      { id: "B", name: teams.names.B, startSide: rounds[0]?.sideOfTeam?.B || "T", score: b },
    ],
    players: plist.map((p) => ({
      steamid: p.steamid, name: p.name, team: p.team, firstRound: p.firstRound, lastRound: p.lastRound,
      sides: rounds.map((_, i) => p.sides.get(i) || null),
    })),
    rounds: rounds.map(({ ...r }) => r),
    kills, damages, grenades, shots,
  };
}

function assignTeams(players, rounds) {
  const ps = [...players.values()].filter((p) => p.sides.size > 0);
  const sideByRound = new Array(rounds.length).fill(null);
  if (!ps.length || !rounds.length) return { sideByRound, names: { A: "Команда A", B: "Команда B" } };
  // Опорный игрок: самый «активный»; команда A — те, кто чаще всего на одной стороне с ним.
  const anchor = ps.reduce((best, p) => (p.sides.size > best.sides.size ? p : best), ps[0]);
  for (const p of ps) {
    let same = 0, diff = 0;
    for (const [r, s] of p.sides) {
      const as = anchor.sides.get(r);
      if (!as) continue;
      if (as === s) same++; else diff++;
    }
    p.team = same >= diff ? "X" : "Y";
  }
  // Сторона каждой команды в каждом раунде — по большинству игроков.
  const sideX = rounds.map((_, r) => {
    let ct = 0, t = 0;
    for (const p of ps) {
      const s = p.sides.get(r);
      if (!s) continue;
      const own = p.team === "X" ? s : s === "CT" ? "T" : "CT";
      if (own === "CT") ct++; else t++;
    }
    return ct === t ? null : ct > t ? "CT" : "T";
  });
  // Заполняем пропуски соседними значениями.
  for (let i = 0; i < sideX.length; i++) if (!sideX[i]) sideX[i] = sideX[i - 1] || sideX.find(Boolean) || "CT";
  // Команда A = стартовала за CT.
  const xIsA = sideX[0] === "CT";
  for (const p of ps) p.team = (p.team === "X") === xIsA ? "A" : "B";
  sideX.forEach((s, i) => {
    const a = xIsA ? s : s === "CT" ? "T" : "CT";
    sideByRound[i] = { A: a, B: a === "CT" ? "T" : "CT" };
  });
  const clanName = (team) => {
    const c = new Map();
    for (const p of ps) if (p.team === team) for (const [k, v] of p.clans) c.set(k, (c.get(k) || 0) + v);
    const best = [...c.entries()].sort((x, y) => y[1] - x[1])[0];
    return best ? best[0] : null;
  };
  let A = clanName("A"), B = clanName("B");
  if (!A || !B || A === B) { A = "Команда A"; B = "Команда B"; }
  return { sideByRound, names: { A, B } };
}

function normSide(w) {
  if (w === 2 || w === "T" || w === "t" || w === "TERRORIST") return "T";
  if (w === 3 || w === "CT" || w === "ct") return "CT";
  return null;
}
function normReason(r) {
  if (typeof r === "number") return REASON_BY_CODE[r] || `reason_${r}`;
  return r || "unknown";
}
function siteLetter(place) {
  if (!place) return null;
  const m = String(place).match(/Bombsite\s*([AB])/i);
  return m ? m[1].toUpperCase() : null;
}
function lastBetween(arr, lo, hi) {
  let res = null;
  for (const t of arr) if (t > lo && t < hi) res = t;
  return res;
}
function firstAfter(arr, lo, hi) {
  for (const t of arr) if (t >= lo && t < hi) return t;
  return null;
}
