/**
 * PropertyPro - A compound, building or unit statement, in the reader's words
 *
 * "Statements clearly identify the selected owner/property/compound/unit and
 * the period" — so each opens as the owner's statement does: its title, then
 * the details (what it is for, whose it is, where, over which dates, on what
 * terms). The screen and the exports (entity-sheet.ts) word the title, the
 * details and the breakdown's rows from here, each with its own translator —
 * the screen's `t`, or the report's language — so the two cannot say
 * different things.
 *
 * The screen imports this, so it imports nothing but types from the export
 * module: that one reaches the letterhead, which is server-only.
 */

import type { LineTranslate } from "@/lib/statements/line-text";
import { feeDetailText } from "@/lib/statements/document";
import type {
  EntityStatement,
  EntityStatementBreakdownRow,
  StatementSubjectKind,
} from "@/types/entity-statement";

const words = (value: string) => value.replace(/_/g, " ");

/** "Compound statement", "Property statement", "Unit statement". */
export function entityStatementTitle(
  kind: StatementSubjectKind,
  tr: LineTranslate,
): string {
  if (kind === "compound") {
    return tr("statements.compound.title", "Compound statement");
  }
  if (kind === "property") {
    return tr("statements.property.title", "Property statement");
  }
  return tr("statements.unit.title", "Unit statement");
}

export interface EntityDetailsOptions {
  /** The period, as the reader reads a period. */
  period: string;
  /** A sum: the export writes the number, the screen its currency. */
  money: (amount: number) => string | number;
}

/**
 * Whose statement, for what, for which period, on what terms — label and
 * value, in the order the details print.
 */
export function entityStatementDetails(
  statement: EntityStatement,
  tr: LineTranslate,
  options: EntityDetailsOptions,
): Array<[string, string | number]> {
  const { subject, totals } = statement;
  const details: Array<[string, string | number]> = [];

  if (subject.kind === "compound") {
    details.push([
      tr("statements.details.compound", "Compound"),
      subject.code ? `${subject.name} (${subject.code})` : subject.name,
    ]);
  } else if (subject.kind === "property") {
    details.push([tr("statements.details.building", "Building"), subject.name]);
    if (subject.parentName) {
      details.push([tr("statements.details.compound", "Compound"), subject.parentName]);
    }
  } else {
    details.push([tr("statements.details.unit", "Unit"), subject.name]);
    if (subject.parentName) {
      details.push([tr("statements.details.building", "Building"), subject.parentName]);
    }
  }
  if (subject.ownerName) {
    details.push([tr("clients.statement.details.owner", "Owner"), subject.ownerName]);
  }
  if (subject.address) {
    details.push([tr("statements.details.address", "Address"), subject.address]);
  }
  details.push([tr("clients.statement.details.period", "Period"), options.period]);

  // The terms the commission was charged on — each agreement's fee in full,
  // on a line of its own, as the agreement's own statement states it. The
  // summary's label repeats only the rate.
  for (const agreement of statement.agreements) {
    const number =
      agreement.number ?? tr("agreements.table.unnumbered", "(no number)");
    details.push([
      agreement.kind === "investment"
        ? tr("agreements.kind.investment", "Investment agreement")
        : tr("clients.statement.details.agreement", "Agreement"),
      `${number} — ${feeDetailText(agreement.fee, agreement.commissionBasis, tr)}`,
    ]);
  }
  // A unit carries an equal share of its building's flat fee; say of how
  // many, so the figure can be checked.
  if (statement.sharedBetweenUnits) {
    details.push([
      tr("statements.details.sharedFee", "Share of the building's flat fee"),
      tr("statements.details.sharedFeeValue", "Equal share, units sharing: {count}", {
        count: statement.sharedBetweenUnits,
      }),
    ]);
  }

  if (subject.kind !== "unit") {
    details.push([
      tr("statements.details.units", "Units"),
      tr("statements.details.unitsValue", "{total} — occupied {occupied}, vacant {vacant}", {
        total: statement.unitCount,
        occupied: statement.occupiedUnits,
        vacant: statement.vacantUnits,
      }),
    ]);
  }
  details.push([tr("statements.details.billed", "Rent billed"), options.money(totals.rentBilled)]);
  details.push([
    tr("statements.details.outstanding", "Outstanding at the close"),
    options.money(totals.outstanding),
  ]);
  // What the commission was charged on, when that is not simply everything
  // collected — so the rate can be checked against it.
  if (
    statement.commissionSource === "agreements" &&
    Math.abs(totals.commissionBase - totals.rentCollected) >= 0.005
  ) {
    details.push([
      tr("clients.statement.details.commissionBase", "Commission charged on"),
      options.money(totals.commissionBase),
    ]);
  }

  return details;
}

/** A breakdown row's name: the building, the unit, or the building's own row. */
export function breakdownLabel(
  row: EntityStatementBreakdownRow,
  tr: LineTranslate,
): string {
  return row.level === "building"
    ? tr("statements.breakdown.buildingWide", "Building-wide")
    : row.label;
}

/** A unit's stored status in the reader's language. */
export function breakdownStatus(
  row: EntityStatementBreakdownRow,
  tr: LineTranslate,
): string {
  return row.status ? tr(`units.status.${row.status}`, words(row.status)) : "";
}

/** The heading over the breakdown. */
export function breakdownTitle(
  statement: EntityStatement,
  tr: LineTranslate,
): string {
  return statement.breakdownKind === "property"
    ? tr("statements.breakdown.byBuilding", "By building")
    : tr("statements.breakdown.byUnit", "By unit");
}
