import { describe, expect, it } from "vitest";

import { locales } from "./i18n";
import {
  deliveryZoneCopy,
  ONLINE_FULFILLMENT_TYPES,
  ONLINE_ORDER_STATUSES,
  onlineFulfillmentLabels,
  onlineOrderSettingsCopy,
  onlineOrderStatusLabels,
} from "./online-order-copy";

describe("critical online-order locale copy", () => {
  it.each(locales)("has complete non-empty copy for %s", (locale) => {
    expect(Object.keys(onlineOrderStatusLabels[locale]).sort()).toEqual(
      [...ONLINE_ORDER_STATUSES].sort(),
    );
    expect(Object.keys(onlineFulfillmentLabels[locale]).sort()).toEqual(
      [...ONLINE_FULFILLMENT_TYPES].sort(),
    );
    expect(Object.values(onlineOrderStatusLabels[locale])).not.toContain("");
    expect(Object.values(onlineFulfillmentLabels[locale])).not.toContain("");
    expect(Object.values(deliveryZoneCopy[locale])).not.toContain("");
    expect(Object.values(onlineOrderSettingsCopy[locale])).not.toContain("");
  });
});
