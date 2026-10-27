import { describe, expect, it } from "vitest";
import {
  assertImageAllowance,
  defaultMonthlyImageLimits,
  imageMonthStart,
  nextImageMonthStart,
  estimateImageCostUsd,
} from "./ai-image-usage";

describe("monthly image attempts", () => {
  it("uses UTC calendar boundaries, including year rollover", () => {
    const at = new Date("2026-12-31T23:59:59Z");
    expect(imageMonthStart(at).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(nextImageMonthStart(at).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("enforces provider defaults, zero, disable and emergency stop", () => {
    expect(defaultMonthlyImageLimits).toEqual({
      meta: 100,
      openai: 30,
      ideogram: 30,
    });
    for (const provider of ["meta", "openai", "ideogram"] as const) {
      const base = {
        provider,
        enabled: true,
        emergencyDisabled: false,
        limit: defaultMonthlyImageLimits[provider],
      };
      expect(() =>
        assertImageAllowance({ ...base, attempts: base.limit - 1 }),
      ).not.toThrow();
      expect(() =>
        assertImageAllowance({ ...base, attempts: base.limit }),
      ).toThrow("Monthly");
      expect(() =>
        assertImageAllowance({ ...base, attempts: 0, limit: 0 }),
      ).toThrow("Monthly");
      expect(() =>
        assertImageAllowance({ ...base, attempts: 0, enabled: false }),
      ).toThrow("disabled");
      expect(() =>
        assertImageAllowance({ ...base, attempts: 0, emergencyDisabled: true }),
      ).toThrow("temporarily disabled");
    }
  });

  it("estimates completed provider output without inventing unknown OpenAI charges", () => {
    expect(estimateImageCostUsd("meta", "muse-image-1.0", { images: 1 })).toBe(
      0.01,
    );
    expect(
      estimateImageCostUsd("ideogram", "ideogram-4-5", { images: 1 }),
    ).toBe(0.06);
    expect(
      estimateImageCostUsd("openai", "gpt-image-2.5-flare", { images: 1 }),
    ).toBeNull();
    expect(
      estimateImageCostUsd("openai", "gpt-image-2.5-flare", {
        images: 1,
        outputTokens: 1000,
        providerUsage: {
          input_tokens_details: { text_tokens: 100, image_tokens: 200 },
        },
      }),
    ).toBeCloseTo(0.0321);
  });
});
