import { expect, it } from "vitest";
import {
  businessProvisionSchema,
  suggestedBusinessRegion,
} from "./business-provision";

const input = {
  requestKey: "regional-business-registration",
  organizationName: "Tirana Restaurant",
  venueName: "Tirana Restaurant",
  ownerDisplayName: "Restaurant Owner",
  email: "owner@example.test",
  password: "registration-password",
  locale: "sq",
  timezone: "Europe/Tirane",
  currency: "ALL",
  plan: "WEBSITE",
  profileId: "RESTAURANT",
  applyCategories: true,
};

it.each([
  ["Europe/Tirane", "ALL"],
  ["Europe/Berlin", "EUR"],
  ["America/New_York", "USD"],
  ["Asia/Tokyo", "JPY"],
  ["UTC", "GBP"],
])(
  "accepts explicit timezone %s and currency %s independent of interface locale",
  (timezone, currency) => {
    expect(
      businessProvisionSchema.parse({ ...input, timezone, currency }),
    ).toMatchObject({ timezone, currency, locale: "sq" });
  },
);

it.each([
  undefined,
  null,
  "",
  " ",
  "Europe/Unknown",
  "Europe/Tirana",
  "+02:00",
  " Europe/Tirane",
])("rejects missing or invalid timezone %s without a default", (timezone) => {
  expect(
    businessProvisionSchema.safeParse({ ...input, timezone }).success,
  ).toBe(false);
});

it.each([undefined, null, "", " ", "ZZZ", "EURO", "eur", " EUR"])(
  "rejects missing or invalid currency %s without a default",
  (currency) => {
    expect(
      businessProvisionSchema.safeParse({ ...input, currency }).success,
    ).toBe(false);
  },
);

it("keeps country explicit, validates it, and never derives financial settings", () => {
  expect(suggestedBusinessRegion("DE")).toEqual({
    currency: "EUR",
    timezone: "Europe/Berlin",
  });
  expect(suggestedBusinessRegion("AL")).toEqual({
    currency: "ALL",
    timezone: "Europe/Tirane",
  });
  expect(suggestedBusinessRegion("US")).toBeNull();
  expect(
    businessProvisionSchema.parse({ ...input, countryCode: "DE" }),
  ).toMatchObject({
    countryCode: "DE",
    currency: "ALL",
    timezone: "Europe/Tirane",
  });
  expect(
    businessProvisionSchema.safeParse({ ...input, countryCode: "ZZ" }).success,
  ).toBe(false);
  expect(businessProvisionSchema.parse(input).countryCode).toBeUndefined();
});
