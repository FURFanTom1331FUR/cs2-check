import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMatch } from "../public/js/demo/model.js";
import { computeStats } from "../public/js/demo/stats.js";
import { sniffFormat } from "../public/js/demo/config.js";

// Синтетический матч: 2 раунда, 2 на 2. A (CT): a1, a2; B (T): b1, b2.
const P = { a1: "76561198000000001", a2: "76561198000000002", b1: "76561198000000003", b2: "76561198000000004" };
const who = (prefix, id, team) => ({ [`${prefix}_steamid`]: P[id], [`${prefix}_name`]: id, [`${prefix}_team_num`]: team, [`${prefix}_team_clan_name`]: team === 3 ? "Alpha" : "Bravo" });
const T = 2, CT = 3;
const ev = (tick, event_name, extra = {}) => ({ tick, event_name, is_warmup_period: false, ...extra });
const raw = {
  header: { map_name: "de_test" },
  players: Object.values(P).map((steamid) => ({ steamid })),
  events: [
    ev(1, "round_start"), ev(100, "round_freeze_end"),
    // Раунд 1: b1 убивает a1 (entry), a2 разменивает b1 через 2 с, потом a2 убивает b2 — клатч 1v1 выигран.
    ev(200, "player_hurt", { ...who("user", "a1", CT), ...who("attacker", "b1", T), dmg_health: 150, health: 0, weapon: "awp" }),
    ev(200, "player_death", { ...who("user", "a1", CT), ...who("attacker", "b1", T), weapon: "awp", headshot: true }),
    ev(328, "player_death", { ...who("user", "b1", T), ...who("attacker", "a2", CT), ...who("assister", "a1", CT), weapon: "ak47" }),
    ev(329, "player_hurt", { ...who("user", "b1", T), ...who("attacker", "a2", CT), dmg_health: 100, health: 0, weapon: "ak47" }),
    ev(900, "player_hurt", { ...who("user", "b2", T), ...who("attacker", "a2", CT), dmg_health: 30, health: 70, weapon: "hegrenade" }),
    ev(1000, "player_death", { ...who("user", "b2", T), ...who("attacker", "a2", CT), weapon: "ak47", headshot: true }),
    ev(1001, "round_end", { winner: "CT", reason: "t_killed", total_rounds_played: 1 }),
    // Раунд 2: T взрывают бомбу, никто не умирает.
    ev(1400, "round_start"), ev(1500, "round_freeze_end"),
    ev(2000, "bomb_planted", { ...who("user", "b2", T), user_last_place_name: "BombsiteB", site: 5 }),
    ev(2100, "weapon_fire", { ...who("user", "a1", CT), weapon: "weapon_m4a1" }),
    ev(2200, "bomb_exploded", { ...who("user", "b2", T), site: 5 }),
    ev(2201, "round_end", { winner: "T", reason: "bomb_exploded", total_rounds_played: 2 }),
    // После финала — не считается.
    ev(2300, "player_death", { ...who("user", "b1", T), ...who("attacker", "b1", T), weapon: "world" }),
  ],
};

test("модель: раунды, команды, счёт, бомба", () => {
  const m = buildMatch(raw);
  assert.equal(m.rounds.length, 2);
  assert.deepEqual(m.teams.map((t) => [t.name, t.score, t.startSide]), [["Alpha", 1, "CT"], ["Bravo", 1, "T"]]);
  assert.equal(m.rounds[0].reasonKey, "elimination");
  assert.equal(m.rounds[1].reasonKey, "bomb");
  assert.equal(m.rounds[1].bomb.planted.site, "B");
  assert.equal(m.kills.length, 3);
});

test("статистика: K/D/A, урон с учётом здоровья, размен, клатч, KAST", () => {
  const s = computeStats(buildMatch(raw));
  const r = Object.fromEntries(s.players.map((p) => [p.name, p]));
  assert.equal(r.a2.kills, 2);
  assert.equal(r.a2.multi[2], 1);
  assert.equal(r.b1.deaths, 1); // самоубийство после матча не считается
  assert.equal(r.a1.assists, 1);
  assert.equal(r.b1.damage, 100); // 150 урона по 100 HP = 100
  assert.equal(r.a2.damage, 100 + 30);
  assert.equal(r.a2.utilDamage, 30);
  assert.equal(r.a1.tradedDeaths, 1);
  assert.equal(r.b1.entryKills, 1);
  assert.equal(r.a1.entryDeaths, 1);
  assert.equal(r.a2.clutchesWon, 1);
  assert.equal(r.a1.kast, 100); // раунд 1 — помощь и размен, раунд 2 — выжил
  assert.equal(r.a2.adr, 65);
});

test("определение формата файла", () => {
  const b = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
  assert.equal(sniffFormat(b("PBDEMS2\0")), "cs2");
  assert.equal(sniffFormat(b("HL2DEMO\0")), "csgo");
  assert.equal(sniffFormat(b("Rar!\x1a\x07\0\0")), "rar");
  assert.equal(sniffFormat(Uint8Array.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0])), "zip");
  assert.equal(sniffFormat(b("hello wo")), "unknown");
});
