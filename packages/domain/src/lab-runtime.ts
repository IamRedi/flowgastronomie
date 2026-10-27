import { z } from "zod";
import type { LabIntent } from "./lab-traffic";
export const labRuntimeConfigSchema = z.strictObject({
  version: z.literal(1),
  level: z.enum(["LOW", "NORMAL", "BUSY"]),
  seed: z.number().int().min(0).max(2000000000),
  cap: z.number().int().min(18).max(300),
  mode: z.enum(["WALL_CLOCK", "FUNCTIONAL_WINDOW"]),
  windowSeconds: z.number().int().min(60).max(900),
  maxActive: z.number().int().min(2).max(12),
  graceSeconds: z.number().int().min(30).max(3600),
  weekendBusy: z.boolean(),
});
export type LabRuntimeConfig = z.infer<typeof labRuntimeConfigSchema>;
export const labControlModeSchema = z.enum([
  "STOPPED",
  "RUNNING",
  "PAUSED",
  "STOP_AFTER_DAY",
  "NEEDS_REVIEW",
]);
export type LabControlMode = z.infer<typeof labControlModeSchema>;
export function assertLabControlTransition(
  from: LabControlMode,
  to: LabControlMode,
) {
  const edges: Record<LabControlMode, LabControlMode[]> = {
    STOPPED: ["RUNNING"],
    RUNNING: ["PAUSED", "STOP_AFTER_DAY", "NEEDS_REVIEW", "STOPPED"],
    PAUSED: ["RUNNING", "STOP_AFTER_DAY", "NEEDS_REVIEW"],
    STOP_AFTER_DAY: ["STOPPED", "NEEDS_REVIEW", "PAUSED"],
    NEEDS_REVIEW: ["PAUSED"],
  };
  if (!edges[from].includes(to))
    throw new Error("Invalid runtime control transition");
}
export function labWallInstant(date: string, time: string, timezone: string) {
  const [y, m, d] = date.split("-").map(Number),
    [h, min] = time.split(":").map(Number),
    wall = Date.UTC(y!, m! - 1, d!, h!, min!);
  let guess = wall;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 4; i++) {
    const p = Object.fromEntries(
      fmt.formatToParts(new Date(guess)).map((p) => [p.type, p.value]),
    );
    const observed = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
    );
    const delta = wall - observed;
    if (!delta) return new Date(guess);
    guess += delta;
  }
  throw new Error("Ambiguous or nonexistent lab opening time requires review");
}
export function labArrivalDecision(
  now: Date,
  due: Date,
  hasAction: boolean,
  grace: number,
) {
  return hasAction
    ? "RECOVER"
    : now.getTime() - due.getTime() > grace * 1000
      ? "MISSED"
      : "EXECUTE";
}
export function labRuntimePlan(
  intents: LabIntent[],
  start: Date,
  end: Date,
  now: Date,
  c: LabRuntimeConfig,
) {
  const plan = intents.map((i) => ({
    intent: structuredClone(i),
    dueAt: new Date(
      start.getTime() +
        (c.mode === "FUNCTIONAL_WINDOW"
          ? (i.position / Math.max(1, intents.length - 1)) *
            c.windowSeconds *
            1000
          : i.arrivalMinute * 60000),
    ),
  }));
  if (c.mode === "WALL_CLOCK") {
    for (const p of plan)
      if (p.intent.channel === "WEBSITE") p.intent.provenance = "WEBSITE_API";
    const future = plan
      .filter(
        (p) =>
          p.intent.channel === "WEBSITE" &&
          !p.intent.cancel &&
          p.dueAt >= now &&
          p.dueAt < end,
      )
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
      .slice(0, 2);
    for (const p of future) {
      p.intent.provenance = "WEBSITE_BROWSER";
      for (const item of p.intent.items) delete item.notes;
    }
  }
  return plan;
}
