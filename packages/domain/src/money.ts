export type Money = Readonly<{
  amount: number;
  currency: string;
}>;

export function money(amount: number, currency: string): Money {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(
      "Money amount must be a non-negative integer in minor units",
    );
  }

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Currency must be a three-letter ISO code");
  }

  return { amount, currency };
}
