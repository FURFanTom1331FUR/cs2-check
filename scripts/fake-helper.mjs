// Тестовый помощник для проверки полного пути без Steam: node scripts/fake-helper.mjs <demo.dem.bz2>
// Бэкенд отдаёт выдуманную ссылку replay*.valve.net, а /demo стримит локальный файл вместо сервера Valve.
import { createReadStream, statSync } from "node:fs";
import { createHelperServer } from "../helper/lib/server.js";

const file = process.argv[2];
const size = statSync(file).size;
const DEMO = "http://replay183.valve.net/730/003712345678901234567_1234567890.dem.bz2";
const backend = {
  name: "fake",
  status: () => ({ ready: true, detail: "Тестовый режим: локальный файл вместо сервера Valve." }),
  match: async (d) => { await new Promise((r) => setTimeout(r, 800)); return { matchId: d.matchId, demoUrl: DEMO, time: null }; },
  recent: async () => [],
};
const fetchReplay = (url, res, cors) => new Promise((resolve) => {
  res.writeHead(200, { "content-type": "application/x-bzip2", "content-length": String(size), ...cors });
  createReadStream(file, { highWaterMark: 1 << 20 }).pipe(res).on("finish", resolve);
});
createHelperServer({ backend, port: 27901, fetchReplay }).listen(27901, "127.0.0.1", () => console.log("fake helper on 27901"));
