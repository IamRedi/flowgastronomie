import { parseEnv } from "node:util";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function databaseIdentity(value) {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw Error();
  return `${url.hostname.replace(/-pooler\./, ".")}:${url.port || "5432"}${url.pathname}`;
}

export function publicProductionProblems(production, staging) {
  const problems = [];
  if (!staging.DATABASE_URL || !staging.DATABASE_URL_DIRECT)
    problems.push("Staging database baseline is required to prove isolation");
  for (const name of [
    "RELEASE_TAG",
    "DATABASE_URL",
    "DATABASE_URL_DIRECT",
    "BACKUP_DIRECTORY",
    "CREATIVE_STORAGE_DIRECTORY",
    "BREVO_API_KEY",
    "TRANSACTIONAL_EMAIL_FROM_ADDRESS",
    "PLATFORM_OPERATOR_NAME",
    "PLATFORM_OPERATOR_ADDRESS",
    "PLATFORM_OPERATOR_EMAIL",
    "PLATFORM_PRIVACY_NOTICE_DE",
  ]) {
    if (!production[name]?.trim()) problems.push(`${name}: missing`);
  }
  for (const [name, expected] of Object.entries({
    WEB_HOST: "123serve.de",
    API_HOST: "api.123serve.de",
    WEB_ORIGIN: "https://123serve.de",
    NEXT_PUBLIC_API_URL: "https://api.123serve.de",
    TRANSACTIONAL_EMAIL_PROVIDER: "brevo",
  })) {
    if (production[name] !== expected)
      problems.push(`${name}: incorrect production target`);
  }
  if (!/^[a-f0-9]{40}$/.test(production.RELEASE_TAG ?? ""))
    problems.push("RELEASE_TAG: full immutable source revision required");
  try {
    const identity = databaseIdentity(production.DATABASE_URL);
    if (identity !== databaseIdentity(production.DATABASE_URL_DIRECT))
      problems.push("DATABASE_URL_DIRECT: does not match production database");
    if (
      [staging.DATABASE_URL, staging.DATABASE_URL_DIRECT]
        .filter(Boolean)
        .some((value) => databaseIdentity(value) === identity)
    )
      problems.push(
        "DATABASE_URL: production and staging database must be isolated",
      );
    const password = new URL(production.DATABASE_URL).password;
    if (
      !password ||
      [staging.DATABASE_URL, staging.DATABASE_URL_DIRECT]
        .filter(Boolean)
        .some((value) => new URL(value).password === password)
    )
      problems.push(
        "DATABASE_URL: dedicated production database credentials required",
      );
  } catch {
    problems.push("DATABASE_URL: invalid database configuration");
  }
  for (const name of ["BACKUP_DIRECTORY", "CREATIVE_STORAGE_DIRECTORY"]) {
    const value = production[name] ?? "";
    if (!/^\/(var|srv)\//.test(value) || value.includes(".."))
      problems.push(`${name}: protected absolute host path required`);
    const a = value.replace(/\/+$/, ""),
      b = (staging[name] ?? "").replace(/\/+$/, "");
    if (!b || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`))
      problems.push(
        `${name}: production and staging paths must be independent`,
      );
  }
  if (
    production.HARDWARE_SIMULATOR_ENABLED === "true" ||
    production.OPERATIONS_LAB_ENABLED === "true"
  )
    problems.push("Test simulators cannot be activated in public production");
  return problems;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [productionPath, stagingPath] = process.argv.slice(2);
  if (!productionPath || !stagingPath) {
    console.error(
      "Usage: node infra/production/public-preflight.mjs <protected-production-env> <protected-staging-env>",
    );
    process.exitCode = 1;
  } else {
    try {
      const problems = publicProductionProblems(
        parseEnv(readFileSync(productionPath, "utf8")),
        parseEnv(readFileSync(stagingPath, "utf8")),
      );
      console.log(
        JSON.stringify({
          configuration: problems.length ? "BLOCKED" : "PASS",
          problems,
          liveAcceptance: "NOT_VERIFIED",
        }),
      );
      process.exitCode = problems.length ? 1 : 0;
    } catch {
      // File/URL errors can contain secrets. Deliberately return no raw error.
      console.error("Unable to read or validate protected environment files");
      process.exitCode = 1;
    }
  }
}
