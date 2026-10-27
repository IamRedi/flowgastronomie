export function assertFoundationLocalEnvironment(
  env: Record<string, string | undefined>,
) {
  if (
    env.NODE_ENV !== "development" ||
    env.CI ||
    env.FOUNDATION_LOCAL_ENABLE !== "1"
  )
    throw new Error(
      "Foundation bootstrap requires explicit local development mode; CI and production are forbidden.",
    );
  const url = new URL(env.DATABASE_URL ?? "");
  if (
    !/^postgres(ql)?:$/.test(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    (url.port && url.port !== "5432") ||
    ![
      "/restaurantflow",
      "/restaurantflow_p3a",
      "/restaurantflow_pos_redesign",
    ].includes(url.pathname)
  )
    throw new Error(
      "Foundation bootstrap requires an allowlisted local database.",
    );
  const schema = url.searchParams.get("schema") ?? "public";
  if (schema !== "public" && !/^foundation_gate_\d+$/.test(schema))
    throw new Error("Unexpected foundation database schema.");
}
