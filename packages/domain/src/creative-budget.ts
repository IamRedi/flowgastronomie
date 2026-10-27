import { CreativeError } from "./creative";

// Attempts, including failed/uncertain ones, consume the budget. A replay of
// an existing request is resolved before this guard in the repository.
export function assertCreativeDailyBudget(category: string, attempts: number) {
  if (category !== "EXPORT" && attempts >= (category === "IMAGE" ? 10 : 30))
    throw new CreativeError(
      "RATE_LIMIT",
      "Daily AI limit reached. Try again tomorrow.",
    );
}
