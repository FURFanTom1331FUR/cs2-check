// Статистика матча по нормализованной модели (model.js). Чистые функции — тестируются в Node.
import { TICKRATE } from "./config.js";

export const TRADE_WINDOW_SEC = 5;
const UTILITY = new Set(["hegrenade", "inferno", "molotov", "incgrenade"]);
const NOT_GUNS = new Set(["knife", "knife_t", "bayonet", "hegrenade", "flashbang", "smokegrenade", "molotov", "incgrenade", "inferno", "decoy", "c4", "planted_c4", "taser", "world", ""]);
const SHOTGUNS = new Set(["nova", "xm1014", "mag7", "sawedoff"]);
const isGun = (w) => {
  const x = (w || "").replace(/^weapon_/, "");
  return !NOT_GUNS.has(x) && !x.startsWith("knife") && !SHOTGUNS.has(x);
};

export function computeStats(match) {
  const { rounds, players, kills, damages, shots } = match;
  const team = new Map(players.map((p) => [p.steamid, p.team]));
  const S = new Map(players.map((p) => [p.steamid, {
    steamid: p.steamid, name: p.name, team: p.team,
    kills: 0, deaths: 0, assists: 0, flashAssists: 0, hsKills: 0, teamkills: 0, suicides: 0,
    damage: 0, utilDamage: 0, entryKills: 0, entryDeaths: 0, tradeKills: 0, tradedDeaths: 0,
    kastRounds: 0, multi: { 2: 0, 3: 0, 4: 0, 5: 0 }, clutchesWon: 0, clutchesPlayed: 0, clutchDetails: {},
    roundsPlayed: 0, shots: 0, hits: 0,
  }]));
  const st = (id) => (id ? S.get(id) : null);
  const tradeTicks = TRADE_WINDOW_SEC * TICKRATE;
  const clutches = [];

  rounds.forEach((round, ri) => {
    const rk = round.kills.map((i) => kills[i]).sort((a, b) => a.tick - b.tick);
    const active = players.filter((p) => ri >= p.firstRound && ri <= p.lastRound);
    for (const p of active) S.get(p.steamid).roundsPlayed++;
    const got = new Map(active.map((p) => [p.steamid, { k: 0, a: false, died: false, traded: false }]));
    let entryDone = false;

    // ---- Убийства
    for (const k of rk) {
      const v = st(k.victim), a = st(k.attacker);
      if (v) v.deaths++;
      const enemyKill = a && v && a.team !== v.team;
      if (a && v && a === v) v.suicides++;
      else if (a && v && a.team === v.team) a.teamkills++;
      if (enemyKill) {
        a.kills++;
        if (k.headshot) a.hsKills++;
        const g = got.get(a.steamid); if (g) g.k++;
        if (!entryDone) { a.entryKills++; v.entryDeaths++; entryDone = true; }
      }
      const gv = got.get(k.victim); if (gv) gv.died = true;
      const as = st(k.assister);
      if (as && v && as.team !== v.team) {
        as.assists++;
        if (k.flashAssist) as.flashAssists++;
        const g = got.get(as.steamid); if (g) g.a = true;
      }
    }
    // ---- Размены: убийцу игрока X в течение 5 с убивает тиммейт X.
    for (const k of rk) {
      const v = st(k.victim), killer = st(k.attacker);
      if (!v || !killer || killer.team === v.team) continue;
      const revenge = rk.find((k2) => k2.victim === k.attacker && k2.tick > k.tick && k2.tick - k.tick <= tradeTicks && st(k2.attacker)?.team === v.team);
      if (revenge) {
        v.tradedDeaths++;
        st(revenge.attacker).tradeKills++;
        const gv = got.get(v.steamid); if (gv) gv.traded = true;
      }
    }
    // ---- KAST и мультикиллы
    for (const [id, g] of got) {
      const s = S.get(id);
      if (g.k > 0 || g.a || !g.died || g.traded) s.kastRounds++;
      if (g.k >= 2) s.multi[Math.min(5, g.k)]++;
    }
    // ---- Клатчи: игрок остался последним живым в команде против X соперников.
    const alive = { A: new Set(active.filter((p) => p.team === "A").map((p) => p.steamid)), B: new Set(active.filter((p) => p.team === "B").map((p) => p.steamid)) };
    const started = { A: null, B: null };
    for (const k of rk) {
      const t = team.get(k.victim);
      if (t) alive[t].delete(k.victim);
      for (const side of ["A", "B"]) {
        const other = side === "A" ? "B" : "A";
        if (!started[side] && alive[side].size === 1 && alive[other].size >= 1) {
          started[side] = { steamid: [...alive[side]][0], vs: alive[other].size, round: ri + 1, team: side };
        }
      }
    }
    for (const side of ["A", "B"]) {
      const c = started[side];
      if (!c) continue;
      c.won = round.winnerTeam === side;
      clutches.push(c);
      const s = S.get(c.steamid);
      s.clutchesPlayed++;
      if (c.won) { s.clutchesWon++; s.clutchDetails[`1v${c.vs}`] = (s.clutchDetails[`1v${c.vs}`] || 0) + 1; }
    }

    // ---- Урон (с учётом оставшегося здоровья, только по соперникам)
    const hp = new Map();
    for (const d of damages) {
      if (d.round !== ri) continue;
      const cur = hp.has(d.victim) ? hp.get(d.victim) : 100;
      const real = Math.max(0, Math.min(d.dmg, cur));
      hp.set(d.victim, typeof d.health === "number" ? d.health : cur - real);
      const a = st(d.attacker), v = st(d.victim);
      if (!a || !v || a === v || a.team === v.team) continue;
      a.damage += real;
      if (UTILITY.has(d.weapon)) a.utilDamage += real;
      if (isGun(d.weapon)) a.hits++;
    }
  });
  for (const s of shots) {
    const p = st(s.steamid);
    if (p && isGun(s.weapon)) p.shots++;
  }

  const rows = [...S.values()].map((s) => ({
    ...s,
    kd: s.deaths ? s.kills / s.deaths : s.kills,
    adr: s.roundsPlayed ? s.damage / s.roundsPlayed : 0,
    hsPct: s.kills ? (s.hsKills / s.kills) * 100 : 0,
    kast: s.roundsPlayed ? (s.kastRounds / s.roundsPlayed) * 100 : 0,
    accuracy: s.shots >= 20 ? Math.min(100, (s.hits / s.shots) * 100) : null,
    multiKills: s.multi[2] + s.multi[3] + s.multi[4] + s.multi[5],
  }));
  rows.sort((a, b) => b.kills - a.kills || b.adr - a.adr);
  return {
    players: rows,
    byTeam: { A: rows.filter((r) => r.team === "A"), B: rows.filter((r) => r.team === "B") },
    clutches,
  };
}
