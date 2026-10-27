import { it, expect } from "vitest";
import { runVenueLoops } from "./runtime-loops.js";
it("keeps the other venue progressing while one operation is still in flight", async () => {
  let finishHeld!: () => void,
    stopped = false,
    otherTicks = 0;
  const held = new Promise<void>((resolve) => {
    finishHeld = resolve;
  });
  await runVenueLoops(
    async (profile) => {
      if (profile === "DE") await held;
      else if (++otherTicks === 3) {
        stopped = true;
        finishHeld();
      }
    },
    async () => {
      throw new Error("Unexpected loop error");
    },
    () => stopped,
  );
  expect(otherTicks).toBe(3);
});
