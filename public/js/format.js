// Форматирование чисел, дат и русских склонений.
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
export const pl = (n, one, few, many) => `${fmtInt(n)} ${plural(n, one, few, many)}`;

export function fmtInt(n) {
  return new Intl.NumberFormat("ru-RU").format(n);
}

export function fmtDate(unix) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(unix * 1000));
}

export function fmtAge(days) {
  if (days < 31) return pl(days, "день", "дня", "дней");
  const years = Math.floor(days / 365.25);
  const months = Math.floor((days - years * 365.25) / 30.44);
  if (years === 0) return pl(months, "месяц", "месяца", "месяцев");
  return months > 0 ? `${pl(years, "год", "года", "лет")} ${pl(months, "месяц", "месяца", "месяцев")}` : pl(years, "год", "года", "лет");
}

export function fmtHours(minutes) {
  const h = minutes / 60;
  if (h === 0) return "0 ч";
  if (h < 10) return `${h.toFixed(1).replace(".", ",")} ч`;
  return `${fmtInt(Math.round(h))} ч`;
}

export function countryName(code) {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["ru"], { type: "region" }).of(code.toUpperCase()) || code;
  } catch {
    return code;
  }
}

export function flagEmoji(code) {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}
