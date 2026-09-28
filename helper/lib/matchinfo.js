// Разбор ответа координатора CS2 (CMsgGCCStrike15_v2_MatchList) в простой вид для сайта.
// Поля приходят либо из csgo-protobuf (bigint, camelCase), либо из globaloffensive (строки/Long, snake_case).
import { isReplayUrl } from "../../src/replay.js";

const str = (v) => (v === undefined || v === null ? null : typeof v === "object" && typeof v.toString === "function" ? v.toString() : String(v));

// Тип игры из резервации сервера: младшие биты — режим, старшие — карта.
// Точные значения Valve не документирует; используем только для подсказки.
function modeFromGameType(gt) {
  if (!gt) return null;
  const low = gt & 0xff;
  if (low === 8) return "competitive"; // соревновательный / Premier
  if (low === 10) return "wingman";
  return null;
}

export function summarizeMatch(m) {
  if (!m) return null;
  const rounds = m.roundstatsall || [];
  const legacy = m.roundstatsLegacy || m.roundstats_legacy || null;
  const all = legacy ? [...rounds, legacy] : rounds;
  // Ссылка на демку лежит в поле map последней записи статистики раунда.
  let demoUrl = null;
  for (let i = all.length - 1; i >= 0 && !demoUrl; i--) {
    const u = all[i]?.map;
    if (typeof u === "string" && isReplayUrl(u)) demoUrl = u;
  }
  const last = all[all.length - 1] || {};
  const reservation = last.reservation || all.find((r) => r?.reservation)?.reservation || {};
  const scores = last.teamScores || last.team_scores || [];
  const wmi = m.watchablematchinfo || {};
  const time = Number(m.matchtime) || 0;
  return {
    matchId: str(m.matchid),
    time: time ? new Date(time * 1000).toISOString() : null,
    demoUrl,
    reservationId: str(last.reservationid) || null,
    score: scores.length === 2 ? scores.map(Number) : null,
    rounds: all.length || null,
    mode: modeFromGameType(Number(reservation.gameType ?? reservation.game_type ?? wmi.gameType ?? wmi.game_type) || 0),
    map: wmi.gameMap || wmi.game_map || null,
  };
}

export function summarizeList(list) {
  return (list?.matches || []).map(summarizeMatch).filter(Boolean);
}
