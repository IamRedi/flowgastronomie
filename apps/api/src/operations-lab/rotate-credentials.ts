import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { assertLabInstance } from "./guard.js";
import { prisma } from "@flowgastronomie/database";
import { LabClient } from "./client.js";
import { saveLocal, type LocalState } from "./provision.js";
await assertLabInstance();
try {
  for (const profile of ["DE", "AL"] as const) {
    const state = JSON.parse(
        await readFile(`.operations-lab/${profile}.json`, "utf8"),
      ) as LocalState,
      a = state.actors.manager!,
      s = a.staff!,
      old = a.password,
      next = randomBytes(32).toString("base64url") + "Lab!",
      client = new LabClient(profile);
    await client.request("POST", "/v1/auth/login", {
      tenantSlug: s.tenantSlug,
      venueSlug: s.venueSlug,
      email: a.email,
      password: old,
    });
    await client.request("POST", "/v1/auth/password", {
      currentPassword: old,
      newPassword: next,
    });
    a.password = next;
    await saveLocal(profile, state);
    let revoked = false;
    try {
      await new LabClient(profile).request("POST", "/v1/auth/login", {
        tenantSlug: s.tenantSlug,
        venueSlug: s.venueSlug,
        email: a.email,
        password: old,
      });
    } catch {
      revoked = true;
    }
    if (!revoked) throw new Error("OLD_LAB_CREDENTIAL_STILL_VALID");
    for (const file of [
      ".operations-lab/browser-debug.json",
      "artifacts/operations-lab/runtime-supervisor.log",
    ]) {
      try {
        let text = await readFile(file, "utf8");
        for (const value of [
          old,
          encodeURIComponent(old),
          new URLSearchParams({ p: old }).toString().slice(2),
        ])
          text = text.replaceAll(value, "[REDACTED REVOKED LAB SECRET]");
        await writeFile(file, text);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    console.log(
      profile +
        " synthetic manager credential rotated; previous password and sessions revoked",
    );
  }
} finally {
  await prisma.$disconnect();
}
