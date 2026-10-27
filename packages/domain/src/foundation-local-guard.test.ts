import { describe, expect, it } from "vitest";
import { assertFoundationLocalEnvironment } from "./foundation-local-guard";
const local = {
  NODE_ENV: "development",
  FOUNDATION_LOCAL_ENABLE: "1",
  DATABASE_URL:
    "postgresql://user:password@localhost:5432/restaurantflow?schema=public",
};
describe("foundation command guard", () => {
  it("accepts only explicitly enabled local development", () => {
    expect(() => assertFoundationLocalEnvironment(local)).not.toThrow();
    for (const change of [
      { NODE_ENV: "production" },
      { NODE_ENV: "test" },
      { CI: "true" },
      { FOUNDATION_LOCAL_ENABLE: "0" },
      {
        DATABASE_URL: local.DATABASE_URL.replace("localhost", "db.example.com"),
      },
      {
        DATABASE_URL: local.DATABASE_URL.replace(
          "restaurantflow",
          "production",
        ),
      },
      { DATABASE_URL: local.DATABASE_URL.replace("public", "customer") },
    ])
      expect(() =>
        assertFoundationLocalEnvironment({ ...local, ...change }),
      ).toThrow();
  });
});
