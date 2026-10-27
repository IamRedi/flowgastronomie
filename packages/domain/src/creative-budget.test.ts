import { expect, it } from "vitest";
import { assertCreativeDailyBudget } from "./creative-budget";
it("bounds image and planner attempts while leaving exports outside paid quotas", () => {
  expect(() => assertCreativeDailyBudget("IMAGE", 9)).not.toThrow();
  expect(() => assertCreativeDailyBudget("IMAGE", 10)).toThrow(
    "Daily AI limit",
  );
  expect(() => assertCreativeDailyBudget("PLAN", 29)).not.toThrow();
  expect(() => assertCreativeDailyBudget("PATCH", 30)).toThrow(
    "Daily AI limit",
  );
  expect(() => assertCreativeDailyBudget("EXPORT", 100)).not.toThrow();
});
