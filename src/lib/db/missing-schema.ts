/**
 * PropertyPro - "That column or table is not there yet"
 *
 * Code that ships with a migration can run against a database that has not
 * had the migration applied (another environment, a session sharing the
 * database). Reads of the new column or table catch this and answer with the
 * value that means "nothing set up" instead of failing the request.
 *
 * Postgres reports an unknown column as 42703 and an unknown table as 42P01;
 * Prisma wraps them (raw queries as P2010, model queries as P2021/P2022) and
 * the driver adapter nests the original under `cause`.
 */

export function isMissingSchemaError(error: unknown): boolean {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      parts.push(String(record.message ?? ""), String(record.code ?? ""));
      const meta = record.meta as Record<string, unknown> | undefined;
      if (meta) parts.push(JSON.stringify(meta));
      current = record.cause;
    } else {
      parts.push(String(current));
      current = null;
    }
  }
  const text = parts.join(" ");
  return (
    /\b(42703|42P01|P2021|P2022)\b/.test(text) ||
    /(column|relation|table)\s+\S+\s+does not exist/i.test(text)
  );
}
