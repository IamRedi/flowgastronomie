import { describe, expect, it } from "vitest";
import {
  businessEvidenceSchema,
  businessHoursSchema,
  businessReviewSchema,
  validateBusinessReview,
  validateBusinessField,
  assertBusinessImportRevert,
  assertBusinessImportVersion,
  type BusinessReview,
  type BusinessImportState,
} from "./business-import";
const evidence = {
  sourceId: "source",
  sourceUrl: "https://example.com",
  sourceHash: "a".repeat(64),
  excerpt: "Garden Bistro",
  method: "HTML" as const,
  status: "SOURCE_OBSERVED" as const,
  confidence: null,
};
const state: BusinessImportState = {
  schemaVersion: 2,
  authorized: true,
  url: "https://example.com",
  phase: "REVIEW",
  fields: [
    { id: "name", field: "venueName", value: "Garden Bistro", evidence },
  ],
  images: [],
  warnings: [],
  review: null,
  requestKey: null,
  attempts: 1,
};
const review = (): BusinessReview => ({
  expectedVersion: 1,
  canonicalRevision: "a".repeat(64),
  confirm: true,
  premiumStyleId: "restaurant-1",
  media: [],
  fields: [
    {
      field: "venueName",
      proposalId: "name",
      value: "Corrected Bistro",
      decision: "APPROVE",
    },
  ],
  items: [
    {
      id: "item",
      action: "ADD",
      targetProductId: null,
      approvePrice: true,
      approveConfiguration: true,
      item: {
        name: "Soup",
        categoryName: "Lunch",
        categoryId: null,
        description: "",
        priceMinor: 650,
        currency: "EUR",
        station: "KITCHEN",
        variants: [],
        modifierGroups: [],
        approvedAllergens: [],
        duplicateAcknowledged: false,
      },
    },
  ],
});
describe("Unified reviewed business import policy", () => {
  it("preserves only observed weekdays and rejects duplicate days or invalid times", () => {
    const monday = {
      day: "MONDAY",
      closed: false,
      opensAt: "12:00",
      closesAt: "22:00",
    };
    expect(businessHoursSchema.parse([monday])).toEqual([monday]);
    expect(() => businessHoursSchema.parse([monday, monday])).toThrow();
    expect(() =>
      businessHoursSchema.parse([{ ...monday, opensAt: "25:00" }]),
    ).toThrow();
  });
  it("allows explicit correction and approved canonical draft input", () =>
    expect(() =>
      validateBusinessReview(review(), state, "EUR", ["item"]),
    ).not.toThrow());
  it.each(["approvePrice", "approveConfiguration"] as const)(
    "requires %s",
    (key) => {
      const input = review();
      input.items[0]![key] = false;
      expect(() =>
        validateBusinessReview(input, state, "EUR", ["item"]),
      ).toThrow();
    },
  );
  it("rejects unknown fields and fake tax input", () => {
    expect(() =>
      businessReviewSchema.parse({ ...review(), taxRate: 19 }),
    ).toThrow();
    expect(() =>
      businessReviewSchema.parse({
        ...review(),
        fields: [
          {
            field: "taxRate",
            value: "19",
            proposalId: null,
            decision: "APPROVE",
          },
        ],
      }),
    ).toThrow();
  });
  it("requires a decision on every proposed field and product", () => {
    const input = review();
    input.fields = [];
    expect(() =>
      validateBusinessReview(input, state, "EUR", ["item"]),
    ).toThrow();
    input.fields = review().fields;
    input.items[0]!.action = "PENDING";
    expect(() =>
      validateBusinessReview(input, state, "EUR", ["item"]),
    ).toThrow();
  });
  it("allows incomplete saved progress but not incomplete approval", () => {
    const input = review();
    input.confirm = false;
    input.items[0]!.item.priceMinor = null;
    expect(() =>
      validateBusinessReview(input, state, "EUR", ["item"]),
    ).not.toThrow();
    input.confirm = true;
    expect(() =>
      validateBusinessReview(input, state, "EUR", ["item"]),
    ).toThrow();
  });
  it("does not convert venue currency or accept an unselected update target", () => {
    const input = review();
    expect(() =>
      validateBusinessReview(input, state, "ALL", ["item"]),
    ).toThrow();
    input.items[0]!.action = "UPDATE";
    expect(() =>
      validateBusinessReview(input, state, "EUR", ["item"]),
    ).toThrow();
  });
  it("requires source evidence inside the session", () => {
    const input = review();
    input.fields[0]!.proposalId = "foreign";
    expect(() =>
      validateBusinessReview(input, state, "EUR", ["item"]),
    ).toThrow();
  });
  it("never labels AI evidence source-verified", () => {
    expect(() =>
      businessEvidenceSchema.parse({ ...evidence, method: "AI" }),
    ).toThrow();
    expect(() =>
      businessEvidenceSchema.parse({
        ...evidence,
        method: "AI",
        status: "UNVERIFIED",
      }),
    ).not.toThrow();
  });
  it("validates hours and rejects duplicate days, impossible times and unsafe contact URLs", () => {
    expect(() =>
      validateBusinessField(
        "openingHours",
        '[{"day":"MONDAY","closed":false,"opensAt":"29:00","closesAt":"22:00"}]',
      ),
    ).toThrow();
    expect(() =>
      validateBusinessField("instagramUrl", "javascript:alert(1)"),
    ).toThrow();
    expect(() => validateBusinessField("openingHours", "[]")).not.toThrow();
  });
  it("requires rights and a canonical scoped candidate association", () => {
    const input = review();
    input.media = [
      {
        candidateId: "fake",
        assetId: "foreign",
        role: "HERO",
        targetItemId: null,
        rightsConfirmed: true,
      },
    ];
    expect(() =>
      validateBusinessReview(input, state, "EUR", ["item"]),
    ).toThrow();
  });
  it("rejects concurrent review and unsafe restore while allowing exact private restore", () => {
    expect(() => assertBusinessImportVersion(2, 1)).toThrow();
    expect(() =>
      assertBusinessImportRevert({
        currentHash: "a",
        importedHash: "a",
        published: false,
        usedByOrders: false,
      }),
    ).not.toThrow();
    for (const patch of [
      { currentHash: "b" },
      { published: true },
      { usedByOrders: true },
    ])
      expect(() =>
        assertBusinessImportRevert({
          currentHash: "a",
          importedHash: "a",
          published: false,
          usedByOrders: false,
          ...patch,
        }),
      ).toThrow();
  });
});
