// Что просим у парсера. Один проход по демке: события + свойства игроков на тике события.
// Позиции (X/Y/Z, место на карте) сохраняются в модели — пригодятся для 2D-реплея (этап 3).
export const WASM_VERSION = "2";
export const WASM_JS = `/vendor/cs2demo/cs2_demo_wasm.js?v=${WASM_VERSION}`;
export const WASM_BIN = `/vendor/cs2demo/cs2_demo_wasm_bg.wasm?v=${WASM_VERSION}`;

export const EVENTS = [
  "round_start", "round_freeze_end", "round_end", "round_officially_ended",
  "round_announce_match_start", "begin_new_match", "cs_win_panel_match",
  "player_death", "player_hurt", "weapon_fire",
  "bomb_planted", "bomb_defused", "bomb_exploded",
  "hegrenade_detonate", "flashbang_detonate", "smokegrenade_detonate", "inferno_startburn", "decoy_started",
];
export const PLAYER_PROPS = ["team_num", "X", "Y", "Z", "team_clan_name", "last_place_name"];
export const OTHER_PROPS = ["total_rounds_played", "is_warmup_period", "game_time"];

// Пределы для .dem.bz2 (файл или загрузка с серверов повторов Valve через помощник/прокси).
export const MAX_BZ2_BYTES = 700 * 1024 * 1024;     // сжатый архив
export const MAX_DEMO_BYTES = 1500 * 1024 * 1024;   // распакованная демка
export const BZ2_RATIO_HINT = 2.2;                  // ожидаемое отношение .dem / .dem.bz2 (демки жмутся в 1.4–2 раза)

export const TICKRATE = 64; // CS2: 64 тика/с

// Определение формата по первым байтам файла.
export function sniffFormat(bytes) {
  const ascii = String.fromCharCode(...bytes.slice(0, 8));
  if (ascii.startsWith("PBDEMS2")) return "cs2";
  if (ascii.startsWith("HL2DEMO")) return "csgo";
  if (ascii.startsWith("Rar!")) return "rar";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "zip";
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return "gzip";
  if (ascii.startsWith("BZh")) return "bzip2";
  if (bytes[0] === 0x37 && bytes[1] === 0x7a && bytes[2] === 0xbc) return "7z";
  if (bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd) return "zstd";
  return "unknown";
}
