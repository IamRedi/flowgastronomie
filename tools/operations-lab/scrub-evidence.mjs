// Defense in depth for local test failures; normal artifact allowlist excludes these.
import { readFile, readdir, writeFile } from "node:fs/promises";
const secrets = [];
for (const file of await readdir(".operations-lab")) {
  if (!/^browser-.*\.json$/.test(file)) continue;
  const state = JSON.parse(await readFile(".operations-lab/" + file, "utf8"));
  if (state.trackingToken) secrets.push(state.trackingToken);
}
for (const profile of ["DE", "AL"]) {
  try {
    const state = JSON.parse(
      await readFile(".operations-lab/" + profile + ".json", "utf8"),
    );
    for (const actor of Object.values(state.actors))
      secrets.push(
        actor.password,
        encodeURIComponent(actor.password),
        new URLSearchParams({ p: actor.password }).toString().slice(2),
      );
    if (state.guestSession?.guestToken)
      secrets.push(state.guestSession.guestToken);
    if (state.qrToken) secrets.push(state.qrToken);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
async function scrub(dir) {
  for (const file of await readdir(dir, { withFileTypes: true })) {
    const path = dir + "/" + file.name;
    if (file.isDirectory()) await scrub(path);
    else if (/\.(json|md|txt|log)$/.test(file.name)) {
      const input = await readFile(path, "utf8");
      let output = input;
      for (const secret of secrets)
        output = output.replaceAll(secret, "[REDACTED LAB SECRET]");
      if (output !== input) await writeFile(path, output);
    }
  }
}
await scrub("artifacts/operations-lab");
