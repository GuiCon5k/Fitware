import { spawn } from "node:child_process";
import { resolve } from "node:path";
const executable = process.execPath;
const api = spawn(
  executable,
  [
    "--watch",
    "--env-file-if-exists=../../.env",
    "--import",
    "tsx",
    "src/server.ts",
  ],
  { cwd: resolve("apps/api"), stdio: "inherit" },
);
const web = spawn(
  executable,
  [
    resolve("node_modules/vite/bin/vite.js"),
    "--host",
    "127.0.0.1",
    ...process.argv.slice(2),
  ],
  { cwd: resolve("apps/web"), stdio: "inherit" },
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  api.kill("SIGTERM");
  web.kill("SIGTERM");
  process.exitCode = code;
}
api.on("error", (e) => {
  console.error(e);
  stop(1);
});
web.on("error", (e) => {
  console.error(e);
  stop(1);
});
api.on("exit", (code) => stop(code || 0));
web.on("exit", (code) => stop(code || 0));
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
