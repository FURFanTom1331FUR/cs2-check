// Любой неизвестный /api/* — JSON 404 вместо HTML.
import { json } from "../../src/http.js";

export function onRequest() {
  return json({ ok: false, error: { code: "no_route", message: "Такого метода API нет." } }, { status: 404 });
}
