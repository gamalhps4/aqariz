export type CurrencyFormatterOptions = Omit<
  Intl.NumberFormatOptions,
  "style" | "currency"
> & {
  locale?: string;
  currency?: string;
};
export { formatCurrency } from "@/lib/utils/formatting";

// export function formatCurrency(
//   amount: number | null | undefined,
//   options: CurrencyFormatterOptions = {}
// ): string {
//   const { locale = "en-US", currency = "USD", ...intlOptions } = options;
//   const value = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;

//   return new Intl.NumberFormat(locale, {
//     style: "currency",
//     currency,
//     ...intlOptions,
//   }).format(value);
// }

export function formatPercentage(
  value: number | null | undefined,
  decimals = 1
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "0%";
  }

  return `${value.toFixed(decimals)}%`;
}

export function formatNumber(
  value: number | null | undefined,
  options: Omit<Intl.NumberFormatOptions, "style"> & { locale?: string } = {}
): string {
  const { locale = "en-US", ...intlOptions } = options;
  const safeValue =
    typeof value === "number" && Number.isFinite(value) ? value : 0;

  return new Intl.NumberFormat(locale, intlOptions).format(safeValue);
}
