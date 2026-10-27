import { z } from "zod";
import { premiumStyleSelectionSchema } from "./premium-showcase";
import { businessProfileIds } from "./business-profile";

// Use the runtime's maintained IANA/ISO data, not a country-specific allowlist.
const supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));
const timezoneSchema = z
  .string()
  .max(100)
  .regex(/^[A-Za-z][A-Za-z0-9_+\/-]*$/)
  .refine((timezone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  }, "Use a valid IANA timezone");
const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .refine(
    (currency) => supportedCurrencies.has(currency),
    "Use a supported ISO 4217 currency code",
  );

// Explicit venue location, separate from legal/billing addresses. No locale inference.
export const businessCountries =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  );
export const businessCountrySchema = z
  .string()
  .refine(
    (value) => businessCountries.includes(value),
    "Choose an ISO country",
  );
export function suggestedBusinessRegion(country: string) {
  if (country === "DE") return { currency: "EUR", timezone: "Europe/Berlin" };
  if (country === "AL") return { currency: "ALL", timezone: "Europe/Tirane" };
  return null;
}

export const businessProvisionSchema = z.strictObject({
  requestKey: z.string().min(16).max(200),
  organizationName: z.string().trim().min(2).max(120),
  venueName: z.string().trim().min(2).max(120),
  ownerDisplayName: z.string().trim().min(2).max(100),
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  locale: z.enum(["en", "de", "it", "sq"]),
  countryCode: businessCountrySchema.optional(),
  timezone: timezoneSchema,
  currency: currencySchema,
  plan: z.enum(["WEBSITE", "SMART_SERVICE", "RESTAURANT_PRO"]),
  profileId: z.enum(businessProfileIds),
  applyCategories: z.boolean(),
  premiumTemplate: premiumStyleSelectionSchema.optional(),
});
export type BusinessProvisionInput = z.infer<typeof businessProvisionSchema>;
export class BusinessProvisionConflict extends Error {
  constructor() {
    super(
      "This creation request is already assigned to different business details or credentials.",
    );
  }
}
