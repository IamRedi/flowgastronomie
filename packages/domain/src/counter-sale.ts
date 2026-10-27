export class CounterSaleError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "CounterSaleError";
  }
}

export function assertOnlinePickupPayable(
  fulfillmentType: string,
  status: string,
) {
  if (fulfillmentType !== "PICKUP" || status !== "READY")
    throw new CounterSaleError(
      "ORDER_NOT_READY",
      "Only ready pickup orders can be paid at the counter",
    );
}

export function assertOnlinePickupHandoffPaid(
  fulfillmentType: string,
  nextStatus: string,
  paid: boolean,
) {
  if (fulfillmentType === "PICKUP" && nextStatus === "COMPLETED" && !paid)
    throw new CounterSaleError(
      "PICKUP_PAYMENT_REQUIRED",
      "Record the pickup payment before handing over the order",
    );
}

export function minorAmount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new CounterSaleError(
      "INVALID_AMOUNT",
      "Money must be a nonnegative integer in minor units",
    );
  }
  return value;
}

export type TaxLineSnapshot = {
  taxCode: string;
  rateBasisPoints: number;
  quantity: number;
  grossUnitMinor: number;
  grossMinor: number;
  netMinor: number;
  taxMinor: number;
};

// Gross prices include tax. Round net once per line, half up, using exact
// integer arithmetic; tax is the residual. No jurisdictional rates live here.
export function snapshotTax(
  code: string,
  rateBasisPoints: number,
  unit: number,
  quantity: number,
): TaxLineSnapshot {
  if (
    !code.trim() ||
    !Number.isInteger(rateBasisPoints) ||
    rateBasisPoints < 0 ||
    rateBasisPoints > 10_000 ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1
  ) {
    throw new CounterSaleError(
      "INVALID_TAX",
      "A configured tax code, rate and positive quantity are required",
    );
  }
  minorAmount(unit);
  const grossMinor = minorAmount(unit * quantity);
  const denominator = BigInt(10_000 + rateBasisPoints);
  const netMinor = Number(
    (BigInt(grossMinor) * 10_000n + denominator / 2n) / denominator,
  );
  return {
    taxCode: code,
    rateBasisPoints,
    quantity,
    grossUnitMinor: unit,
    grossMinor,
    netMinor,
    taxMinor: grossMinor - netMinor,
  };
}

export function taxTotals(lines: TaxLineSnapshot[]) {
  const breakdown = new Map<
    string,
    {
      taxCode: string;
      rateBasisPoints: number;
      grossMinor: number;
      netMinor: number;
      taxMinor: number;
    }
  >();
  for (const line of lines) {
    const verified = snapshotTax(
      line.taxCode,
      line.rateBasisPoints,
      line.grossUnitMinor,
      line.quantity,
    );
    if (
      verified.grossMinor !== line.grossMinor ||
      verified.netMinor !== line.netMinor ||
      verified.taxMinor !== line.taxMinor
    )
      throw new CounterSaleError("INVALID_TAX", "Invalid tax snapshot");
    const key = `${line.taxCode}:${line.rateBasisPoints}`;
    const group = breakdown.get(key) ?? {
      taxCode: line.taxCode,
      rateBasisPoints: line.rateBasisPoints,
      grossMinor: 0,
      netMinor: 0,
      taxMinor: 0,
    };
    group.grossMinor = minorAmount(group.grossMinor + line.grossMinor);
    group.netMinor = minorAmount(group.netMinor + line.netMinor);
    group.taxMinor = minorAmount(group.taxMinor + line.taxMinor);
    breakdown.set(key, group);
  }
  const groups = [...breakdown.values()].sort(
    (a, b) =>
      a.taxCode.localeCompare(b.taxCode) ||
      a.rateBasisPoints - b.rateBasisPoints,
  );
  return {
    grossMinor: minorAmount(groups.reduce((n, g) => n + g.grossMinor, 0)),
    netMinor: minorAmount(groups.reduce((n, g) => n + g.netMinor, 0)),
    taxMinor: minorAmount(groups.reduce((n, g) => n + g.taxMinor, 0)),
    breakdown: groups,
  };
}

export function cashChange(total: number, received: number): number {
  minorAmount(total);
  minorAmount(received);
  if (received < total)
    throw new CounterSaleError(
      "INSUFFICIENT_CASH",
      "Amount received is less than the total",
    );
  return received - total;
}

export function cashClosing(
  opening: number,
  cashPayments: number,
  counted: number,
) {
  const expectedCashMinor = minorAmount(
    minorAmount(opening) + minorAmount(cashPayments),
  );
  return {
    expectedCashMinor,
    countedCashMinor: minorAmount(counted),
    differenceMinor: counted - expectedCashMinor,
  };
}

export type FinalReceipt = {
  id: string;
  number: string;
  orderId: string | null;
  onlineOrderId?: string | null;
  paymentId: string;
  issuedAt: string;
  finalizedAt: string;
  status: "FINALIZED";
  currency: string;
  grossMinor: number;
  netMinor: number;
  taxMinor: number;
  method: "CASH" | "CARD_AT_COUNTER";
  receivedMinor: number | null;
  changeMinor: number | null;
  business: {
    legalName: string;
    addressLine1: string;
    postalCode: string;
    city: string;
    countryCode: string;
    vatId: string | null;
    venueId: string;
    venueName: string;
  };
  cashier: { membershipId: string; displayName: string };
  items: Array<
    TaxLineSnapshot & {
      productId: string;
      productName: string;
      variantName: string | null;
      modifiers: Array<{ optionName: string; priceDeltaMinor: number }>;
    }
  >;
  breakdown: ReturnType<typeof taxTotals>["breakdown"];
};

export function parseMinorInput(input: string): number | null {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(input.trim())) return null;
  const [whole, fraction = ""] = input.trim().replace(",", ".").split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount <= 2_147_483_647
    ? amount
    : null;
}
