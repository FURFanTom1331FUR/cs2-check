// Общие правила для ссылок на демки серверов повторов Valve (сайт, прокси и помощник).
export const REPLAY_URL_RE = /^http:\/\/replay\d{1,4}\.valve\.net\/730\/\d{1,24}_\d{1,24}\.dem\.bz2$/;
export const MAX_REPLAY_BYTES = 700 * 1024 * 1024;
export const isReplayUrl = (s) => typeof s === "string" && REPLAY_URL_RE.test(s);
