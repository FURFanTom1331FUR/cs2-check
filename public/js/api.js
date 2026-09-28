// Клиент к нашему API. Ключ Steam сюда не попадает — всё идёт через /api/*.
export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function fetchProfile(q, { signal } = {}) {
  let res;
  try {
    res = await fetch(`/api/profile?q=${encodeURIComponent(q)}`, { signal, headers: { accept: "application/json" } });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new ApiError("network", "Не удалось связаться с сервером. Проверьте подключение к интернету.", 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* не JSON */
  }
  if (!res.ok || !data || data.ok !== true) {
    const err = data && data.error;
    throw new ApiError(err?.code || "unknown", err?.message || `Ошибка сервера (${res.status}).`, res.status);
  }
  return data;
}
