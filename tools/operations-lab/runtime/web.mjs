import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
const c = JSON.parse(await readFile(process.env.LAB_RUNTIME_CONFIG, "utf8"));
const require = createRequire(join(c.code, "package.json"));
const next = require("next");
const app = next({
  dir: join(c.code, "apps/web"),
  dev: false,
  hostname: "127.0.0.1",
  port: 3400,
});
await app.prepare();
const server = createServer(app.getRequestHandler());
await new Promise((resolve) => server.listen(3400, "127.0.0.1", resolve));
async function close() {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await app.close();
  process.exit(0);
}
process.on("message", (m) => {
  if (m === "shutdown") void close();
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => void close());
