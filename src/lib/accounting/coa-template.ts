/**
 * PropertyPro - The standard Saudi chart of accounts for a property office
 *
 * What a new office's books start from: the usual Saudi layout of four
 * levels — class (1 digit), group (2), account (4), sub-account (6) — with the
 * accounts a property management office needs, in Arabic and English. Every
 * account here can be renamed, moved, deactivated or deleted by the office;
 * the ones carrying a `systemKey` are the ones the posting rules use, and
 * those can be renamed and moved but not deleted (lib/accounting/coa-rules.ts).
 *
 * Only the sub-accounts (and nothing above them) take postings. A code is a
 * label, not a structure: an account keeps its place under its parent if the
 * office renumbers it.
 *
 * Adding a system key later means adding its account here; running "set up
 * accounting" again adds the missing account to offices that are already set
 * up, and changes nothing else (lib/accounting/seed-plan.ts).
 */

import type { AccountType, NormalSide } from "./types";
import type { GroupKey, SystemKey } from "./system-keys";

export interface TemplateAccount {
  code: string;
  parentCode: string | null;
  nameAr: string;
  nameEn: string;
  type: AccountType;
  normalSide: NormalSide;
  postable: boolean;
  systemKey?: SystemKey | GroupKey;
}

/** Bumped whenever the template changes; stored on the settings it seeded. */
export const COA_TEMPLATE_VERSION = "sa-property-office-1";

type Row = [
  code: string,
  parentCode: string | null,
  nameAr: string,
  nameEn: string,
  type: AccountType,
  postable: boolean,
  systemKey?: SystemKey | GroupKey,
  normalSide?: NormalSide,
];

const ROWS: Row[] = [
  // 1 — Assets
  ["1", null, "الأصول", "Assets", "asset", false],
  ["11", "1", "الأصول المتداولة", "Current assets", "asset", false],
  ["1101", "11", "النقد وما في حكمه", "Cash and cash equivalents", "asset", false, "group_cash"],
  ["110101", "1101", "الصندوق", "Cash on hand", "asset", true, "cash_on_hand"],
  ["110102", "1101", "البنك - الحساب الجاري", "Bank - current account", "asset", true, "bank"],
  ["110103", "1101", "حساب وسيط نقاط البيع (مدى)", "POS (mada) clearing", "asset", true, "pos_clearing"],
  ["110104", "1101", "حساب وسيط بوابات الدفع الإلكتروني", "Payment gateway clearing", "asset", true, "gateway_clearing"],
  ["1102", "11", "الذمم المدينة", "Receivables", "asset", false],
  ["110201", "1102", "ذمم المستأجرين", "Tenant receivables", "asset", true, "tenant_receivables"],
  ["110202", "1102", "ذمم العملاء", "Customer receivables", "asset", true, "customer_receivables"],
  ["110203", "1102", "ذمم مدينة أخرى", "Other receivables", "asset", true],
  ["1103", "11", "ضريبة القيمة المضافة المدفوعة", "VAT recoverable", "asset", false],
  ["110301", "1103", "ضريبة القيمة المضافة على المشتريات", "Input VAT", "asset", true, "input_vat"],
  ["1104", "11", "المصروفات المدفوعة مقدماً والسلف", "Prepayments and advances", "asset", false],
  ["110401", "1104", "مصروفات مدفوعة مقدماً", "Prepaid expenses", "asset", true],
  ["110402", "1104", "سلف وعهد الموظفين", "Employee advances", "asset", true],
  ["12", "1", "الأصول غير المتداولة", "Non-current assets", "asset", false],
  ["1201", "12", "الممتلكات والمعدات", "Property and equipment", "asset", false],
  ["120101", "1201", "الأثاث والمفروشات", "Furniture and fixtures", "asset", true],
  ["120102", "1201", "الأجهزة المكتبية والحاسب الآلي", "Office equipment and computers", "asset", true],
  ["120103", "1201", "السيارات", "Vehicles", "asset", true],
  ["120104", "1201", "التحسينات على المباني", "Building improvements", "asset", true, "expense_capital_improvement"],
  ["1202", "12", "مجمع الإهلاك", "Accumulated depreciation", "asset", false, undefined, "credit"],
  ["120201", "1202", "مجمع إهلاك الأثاث والمفروشات", "Accumulated depreciation - furniture", "asset", true, undefined, "credit"],
  ["120202", "1202", "مجمع إهلاك الأجهزة المكتبية", "Accumulated depreciation - office equipment", "asset", true, undefined, "credit"],
  ["120203", "1202", "مجمع إهلاك السيارات", "Accumulated depreciation - vehicles", "asset", true, undefined, "credit"],

  // 2 — Liabilities
  ["2", null, "الخصوم", "Liabilities", "liability", false],
  ["21", "2", "الخصوم المتداولة", "Current liabilities", "liability", false],
  ["2101", "21", "الذمم الدائنة", "Payables", "liability", false],
  ["210101", "2101", "ذمم الموردين", "Supplier payables", "liability", true, "supplier_payables"],
  ["210102", "2101", "مصروفات مستحقة", "Accrued expenses", "liability", true, "accrued_expenses"],
  ["2102", "21", "أرصدة الملاك", "Owners' balances", "liability", false],
  ["210201", "2102", "مستحقات الملاك", "Owners' payable", "liability", true, "owner_payable"],
  ["210202", "2102", "إيجارات ومستحقات الملاك غير المحصلة", "Owners' uncollected rent", "liability", true, "owner_uncollected_rent"],
  ["2103", "21", "التأمينات المستلمة", "Deposits received", "liability", false],
  ["210301", "2103", "تأمينات المستأجرين المحتفظ بها", "Tenant security deposits held", "liability", true, "security_deposits"],
  ["2104", "21", "ضريبة القيمة المضافة", "Value added tax", "liability", false],
  ["210401", "2104", "ضريبة القيمة المضافة على المبيعات", "Output VAT", "liability", true, "output_vat"],
  ["210402", "2104", "صافي ضريبة القيمة المضافة المستحقة", "Net VAT payable", "liability", true],
  ["2105", "21", "مستحقات الموظفين", "Employee liabilities", "liability", false],
  ["210501", "2105", "رواتب مستحقة", "Salaries payable", "liability", true],
  ["210502", "2105", "التأمينات الاجتماعية المستحقة", "GOSI payable", "liability", true],
  ["22", "2", "الخصوم غير المتداولة", "Non-current liabilities", "liability", false],
  ["2201", "22", "المخصصات طويلة الأجل", "Long-term provisions", "liability", false],
  ["220101", "2201", "مخصص مكافأة نهاية الخدمة", "End-of-service benefits provision", "liability", true],

  // 3 — Equity
  ["3", null, "حقوق الملكية", "Equity", "equity", false],
  ["31", "3", "رأس المال", "Capital", "equity", false],
  ["3101", "31", "رأس المال المدفوع", "Paid-up capital", "equity", false],
  ["310101", "3101", "رأس المال", "Share capital", "equity", true],
  ["32", "3", "الاحتياطيات والأرباح", "Reserves and earnings", "equity", false],
  ["3201", "32", "الأرباح المبقاة", "Retained earnings", "equity", false],
  ["320101", "3201", "الأرباح المبقاة (الخسائر المتراكمة)", "Retained earnings (accumulated losses)", "equity", true, "retained_earnings"],
  ["3202", "32", "الاحتياطي النظامي", "Statutory reserve", "equity", false],
  ["320201", "3202", "الاحتياطي النظامي", "Statutory reserve", "equity", true],
  ["33", "3", "الأرصدة الافتتاحية", "Opening balances", "equity", false],
  ["3301", "33", "الأرصدة الافتتاحية", "Opening balances", "equity", false],
  ["330101", "3301", "حساب الأرصدة الافتتاحية", "Opening balance equity", "equity", true, "opening_balance_equity"],
  ["34", "3", "جاري الشركاء", "Partners' current accounts", "equity", false],
  ["3401", "34", "جاري الشركاء", "Partners' current accounts", "equity", false],
  ["340101", "3401", "جاري المالك", "Owner's current account", "equity", true],

  // 4 — Revenue
  ["4", null, "الإيرادات", "Revenue", "income", false],
  ["41", "4", "إيرادات النشاط الرئيسي", "Operating revenue", "income", false],
  ["4101", "41", "إيرادات إدارة الأملاك", "Property management revenue", "income", false],
  ["410101", "4101", "عمولات إدارة الأملاك", "Management commission income", "income", true, "commission_income"],
  ["410102", "4101", "أتعاب الإدارة الثابتة", "Fixed management fee income", "income", true, "management_fee_income"],
  ["410103", "4101", "عمولات السعي والتأجير", "Brokerage and leasing commission income", "income", true],
  ["4102", "41", "إيرادات الإيجار", "Rental revenue", "income", false],
  ["410201", "4102", "إيرادات إيجار العقارات المملوكة", "Rent income - own properties", "income", true, "rent_income"],
  ["410202", "4102", "إيرادات إيجار عقود الاستثمار", "Rent income - investment agreements", "income", true, "investment_rent_income"],
  ["42", "4", "إيرادات أخرى", "Other revenue", "income", false],
  ["4201", "42", "إيرادات متنوعة", "Miscellaneous revenue", "income", false],
  ["420101", "4201", "إيرادات أخرى", "Other income", "income", true, "other_income"],

  // 5 — Expenses
  ["5", null, "المصروفات", "Expenses", "expense", false],
  ["51", "5", "تكلفة الإيرادات", "Cost of revenue", "expense", false],
  ["5101", "51", "تكاليف عقود الاستثمار", "Investment agreement costs", "expense", false],
  ["510101", "5101", "إيجارات عقود الاستثمار المستحقة للملاك", "Investment rent owed to owners", "expense", true, "investment_rent_expense"],
  ["52", "5", "المصروفات العمومية والإدارية", "General and administrative expenses", "expense", false],
  ["5201", "52", "مصروفات التشغيل والصيانة", "Operating and maintenance expenses", "expense", false],
  ["520101", "5201", "الصيانة", "Maintenance", "expense", true, "expense_maintenance"],
  ["520102", "5201", "الإصلاحات", "Repairs", "expense", true, "expense_repair"],
  ["520103", "5201", "الكهرباء والمياه والخدمات", "Utilities", "expense", true, "expense_utilities"],
  ["520104", "5201", "النظافة", "Cleaning", "expense", true, "expense_cleaning"],
  ["520105", "5201", "تنسيق الحدائق", "Landscaping", "expense", true, "expense_landscaping"],
  ["5202", "52", "المصروفات الإدارية", "Administrative expenses", "expense", false],
  ["520201", "5202", "الرواتب والأجور", "Salaries and wages", "expense", true],
  ["520202", "5202", "إيجار المكتب", "Office rent", "expense", true],
  ["520203", "5202", "التأمين", "Insurance", "expense", true, "expense_insurance"],
  ["520204", "5202", "الرسوم الحكومية والضرائب", "Government fees and taxes", "expense", true, "expense_taxes"],
  ["520205", "5202", "الأتعاب المهنية والقانونية", "Legal and professional fees", "expense", true, "expense_legal"],
  ["520206", "5202", "القرطاسية والمستلزمات", "Stationery and supplies", "expense", true, "expense_supplies"],
  ["520207", "5202", "أتعاب الإدارة", "Management fees", "expense", true, "expense_management_fee"],
  ["520208", "5202", "العمولات والرسوم البنكية", "Bank charges and commissions", "expense", true],
  ["520209", "5202", "مصروفات أخرى", "Other expenses", "expense", true, "expense_other"],
  ["5203", "52", "مصروفات التسويق", "Marketing expenses", "expense", false],
  ["520301", "5203", "الدعاية والإعلان", "Advertising", "expense", true, "expense_advertising"],
  ["5204", "52", "الإهلاك", "Depreciation", "expense", false],
  ["520401", "5204", "مصروف الإهلاك", "Depreciation expense", "expense", true],
];

/** The ordinary side of an account of each type. */
export function defaultNormalSide(type: AccountType): NormalSide {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}

export const COA_TEMPLATE: readonly TemplateAccount[] = ROWS.map(
  ([code, parentCode, nameAr, nameEn, type, postable, systemKey, normalSide]) => ({
    code,
    parentCode,
    nameAr,
    nameEn,
    type,
    normalSide: normalSide ?? defaultNormalSide(type),
    postable,
    ...(systemKey ? { systemKey } : {}),
  }),
);
