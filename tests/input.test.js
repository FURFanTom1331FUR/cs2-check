import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSteamInput } from "../src/steam/input.js";
import { buildFlags } from "../src/steam/flags.js";

const ID = "76561197960435530";

test("разбор ссылок и идентификаторов", () => {
  assert.deepEqual(parseSteamInput(ID), { type: "steamid64", value: ID });
  assert.deepEqual(parseSteamInput(`https://steamcommunity.com/profiles/${ID}/`), { type: "steamid64", value: ID });
  assert.deepEqual(parseSteamInput(`steamcommunity.com/profiles/${ID}`), { type: "steamid64", value: ID });
  assert.deepEqual(parseSteamInput("https://steamcommunity.com/id/robinwalker/?l=russian"), { type: "vanity", value: "robinwalker" });
  assert.deepEqual(parseSteamInput("  robinwalker  "), { type: "vanity", value: "robinwalker" });
  assert.deepEqual(parseSteamInput("[U:1:169802]"), { type: "steamid64", value: ID });
  assert.deepEqual(parseSteamInput("STEAM_0:0:84901"), { type: "steamid64", value: ID });
});

test("отклонение плохого ввода", () => {
  for (const bad of ["", "   ", "a", "123", "76561197960435530123", "https://evil.com/id/x", "https://steamcommunity.com/groups/x",
    "https://steamcommunity.com/id/", "имя", "<script>", "x".repeat(300), "https://steamcommunity.com.evil.com/id/x"]) {
    assert.equal(parseSteamInput(bad).type, "invalid", bad);
  }
});

test("флаги: чистый старый аккаунт без флагов", () => {
  const r = {
    profile: { ageDays: 4000, level: 30 },
    bans: { vacBans: 0, gameBans: 0, daysSinceLastBan: null, communityBanned: false, economyBan: null },
    games: { visible: true, count: 100, cs2: { owned: true, minutesTotal: 60000, minutes2w: 600 } },
    friends: { visible: true, count: 50, checked: 50, anyBanned: 1, vacBanned: 1, gameBanned: 0 },
  };
  assert.deepEqual(buildFlags(r, { isPublic: true }), []);
});

test("флаги: недавний бан, новый аккаунт, друзья с банами", () => {
  const r = {
    profile: { ageDays: 40, level: 0 },
    bans: { vacBans: 0, gameBans: 1, daysSinceLastBan: 10, communityBanned: false, economyBan: null },
    games: { visible: false, count: null, cs2: null },
    friends: { visible: true, count: 20, checked: 20, anyBanned: 8, vacBanned: 6, gameBanned: 3 },
  };
  const codes = buildFlags(r, { isPublic: true }).map((f) => f.code);
  for (const c of ["recent_ban", "new_account", "low_level", "hidden_games", "banned_friends"]) assert.ok(codes.includes(c), c);
});
