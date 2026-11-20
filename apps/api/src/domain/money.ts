import { Prisma } from "@prisma/client";

export function centsToString(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, "0")}`;
}

export function decimalToCents(value: Prisma.Decimal | string | number): number {
  return new Prisma.Decimal(value).mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

export function dollarsToCents(value: number): number {
  return Math.round(value * 100);
}

/** percent is a human percentage: 10 means 10%. */
export function percentOfCents(cents: number, percent: number): number {
  const basisPoints = Math.round(percent * 100);
  return Math.round((cents * basisPoints) / 10000);
}

export function decimalString(value: Prisma.Decimal | string | number | null | undefined): string | null {
  if (value == null) return null;
  return new Prisma.Decimal(value).toFixed(2);
}

export function rateNumber(value: Prisma.Decimal | string | number | null | undefined): number | null {
  if (value == null) return null;
  return new Prisma.Decimal(value).toNumber();
}
