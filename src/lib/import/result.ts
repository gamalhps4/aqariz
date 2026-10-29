/**
 * PropertyPro - What an import reports
 *
 * The shape every importer returns, in one place so the importers that live
 * in their own files (contracts, payments) report exactly like the ones in
 * importers.ts. No database.
 */

import type { ScopeActor } from "@/lib/db/scopes";

/**
 * Who is importing: the caller as the API resolved them. Contracts and
 * payments are checked against the buildings this caller may reach, exactly
 * as the contract form and the record dialog check them.
 */
export interface ImportActor extends ScopeActor {
  organizationId?: string | null;
}

export type ImportResource =
  | "properties"
  | "tenants"
  | "units"
  | "leases"
  | "payments";

export interface RowIssue {
  /** 1-based row number as the person sees it in their spreadsheet. */
  row: number;
  /** English, for API clients and anything without a translation. */
  message: string;
  /**
   * What went wrong, for the import screen to say in the reader's language
   * (`import.issue.<code>`), with `values` filled into it. Absent where only
   * the English exists.
   */
  code?: string;
  values?: Record<string, string | number>;
}

export interface ImportResult {
  resource: ImportResource;
  dryRun: boolean;
  totalRows: number;
  valid: number;
  imported: number;
  skipped: number;
  errors: RowIssue[];
  warnings: RowIssue[];
}

/** Spreadsheet row 1 is the header, so data starts at row 2. */
export const rowNumber = (index: number) => index + 2;

export function emptyResult(
  resource: ImportResource,
  dryRun: boolean,
  totalRows: number,
): ImportResult {
  return {
    resource,
    dryRun,
    totalRows,
    valid: 0,
    imported: 0,
    skipped: 0,
    errors: [],
    warnings: [],
  };
}
