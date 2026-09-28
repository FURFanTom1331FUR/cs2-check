// Коды «Поделиться матчем» CS2/CS:GO (CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx).
// Код — это 18 байт (matchId, outcomeId/reservationId, tvPort/token) в системе счисления с основанием 57.
// Модуль без зависимостей: работает в браузере, в Node (тесты) и в Cloudflare Functions.

const DICT = "ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789";
const BASE = BigInt(DICT.length); // 57
export const SHARE_CODE_RE = /^CSGO(-[ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789]{5}){5}$/;

// Приводит ввод к виду CSGO-xxxxx-…; возвращает null, если это не код матча.
export function normalizeShareCode(input) {
  if (typeof input !== "string") return null;
  let s = input.trim();
  // Код часто копируют вместе с командой консоли или ссылкой steam://rungame/…/+csgo_download_match%20CSGO-…
  const m = s.match(/CSGO(?:-[A-Za-z0-9]{5}){5}/);
  if (m) s = m[0];
  return SHARE_CODE_RE.test(s) ? s : null;
}

function bytesToBigIntLE(bytes) {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}

// Декодирует код: { matchId, outcomeId, token } — строки (uint64 не помещается в Number).
export function decodeShareCode(input) {
  const code = normalizeShareCode(input);
  if (!code) throw new TypeError("invalid share code");
  const chars = code.slice(5).replace(/-/g, "").split("").reverse();
  let n = 0n;
  for (const c of chars) n = n * BASE + BigInt(DICT.indexOf(c));
  if (n >> 144n) throw new TypeError("invalid share code"); // больше 18 байт
  const bytes = new Uint8Array(18);
  for (let i = 17; i >= 0; i--) { bytes[i] = Number(n & 0xffn); n >>= 8n; }
  return {
    code,
    matchId: bytesToBigIntLE(bytes.subarray(0, 8)).toString(),
    outcomeId: bytesToBigIntLE(bytes.subarray(8, 16)).toString(),
    token: Number(bytesToBigIntLE(bytes.subarray(16, 18))),
  };
}

// Обратная операция (для тестов и для кодов, полученных из matchId/outcomeId/token).
export function encodeShareCode({ matchId, outcomeId, token }) {
  const le = (v, len) => { let x = BigInt(v); const b = []; for (let i = 0; i < len; i++) { b.push(Number(x & 0xffn)); x >>= 8n; } return b; };
  const bytes = [...le(matchId, 8), ...le(outcomeId, 8), ...le(token, 2)];
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = "";
  for (let i = 0; i < 25; i++) { s += DICT[Number(n % BASE)]; n /= BASE; }
  return `CSGO-${s.slice(0, 5)}-${s.slice(5, 10)}-${s.slice(10, 15)}-${s.slice(15, 20)}-${s.slice(20)}`;
}
