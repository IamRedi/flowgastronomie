import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const forbiddenTrackedFiles = tracked.filter(
  (file) => /(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith(".env.example"),
);
const publicEnvironmentReferences = execFileSync(
  "git",
  ["grep", "-n", "NEXT_PUBLIC_", "--", "apps", ".env.example"],
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);
const unsafePublicReferences = publicEnvironmentReferences.filter(
  (line) => !line.includes("NEXT_PUBLIC_API_URL"),
);

if (forbiddenTrackedFiles.length || unsafePublicReferences.length) {
  console.error(
    JSON.stringify({ forbiddenTrackedFiles, unsafePublicReferences }, null, 2),
  );
  process.exit(1);
}

console.log(
  JSON.stringify({
    status: "passed",
    checked: ["tracked-env-files", "public-environment-references"],
  }),
);
