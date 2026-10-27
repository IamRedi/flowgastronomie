import { expect, it } from "vitest";
import { smartSetupTransition } from "./smart-setup";
const input = {
  expectedVersion: 0,
  profileId: "PIZZERIA" as const,
  applyCategories: true,
  step: 2,
  skipped: [],
  complete: false,
};
it("keeps setup resumable without activating business modules", () => {
  expect(smartSetupTransition(input, false)).toEqual({
    profileId: "PIZZERIA",
    profileVersion: 3,
    step: 2,
    skipped: [],
    status: "IN_PROGRESS",
  });
  expect(
    smartSetupTransition(
      { ...input, step: 4, complete: true, skipped: ["MENU"] },
      false,
    ).status,
  ).toBe("READY");
  expect(
    smartSetupTransition({ ...input, step: 4, complete: true }, true).status,
  ).toBe("READY");
});
it("requires an explicit menu skip or an imported menu and a final review", () => {
  expect(() =>
    smartSetupTransition({ ...input, complete: true }, false),
  ).toThrow("reviewed menu");
  expect(() =>
    smartSetupTransition({ ...input, step: 4, complete: true }, false),
  ).toThrow("reviewed menu");
  expect(() =>
    smartSetupTransition({ ...input, skipped: ["MEDIA", "MEDIA"] }, false),
  ).toThrow();
});
