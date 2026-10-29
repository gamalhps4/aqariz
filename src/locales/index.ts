import enCommon from "./en/common.json";
import enSettings from "./en/settings.json";
import enDashboard from "./en/dashboard.json";
import enProperties from "./en/properties.json";
import enTenants from "./en/tenants.json";
import enLeases from "./en/leases.json";
import enMaintenance from "./en/maintenance.json";
import enPayments from "./en/payments.json";
import enMessages from "./en/messages.json";
import enCalendar from "./en/calendar.json";
import enAdmin from "./en/admin.json";
import enAnnouncements from "./en/announcements.json";
import enReports from "./en/reports.json";
import enInspections from "./en/inspections.json";
import enAccounting from "./en/accounting.json";
import enPlatform from "./en/platform.json";
import enMarketing from "./en/marketing.json";
import arCommon from "./ar/common.json";
import arSettings from "./ar/settings.json";
import arDashboard from "./ar/dashboard.json";
import arProperties from "./ar/properties.json";
import arTenants from "./ar/tenants.json";
import arLeases from "./ar/leases.json";
import arMaintenance from "./ar/maintenance.json";
import arPayments from "./ar/payments.json";
import arMessages from "./ar/messages.json";
import arCalendar from "./ar/calendar.json";
import arAdmin from "./ar/admin.json";
import arAnnouncements from "./ar/announcements.json";
import arReports from "./ar/reports.json";
import arInspections from "./ar/inspections.json";
import arAccounting from "./ar/accounting.json";
import arPlatform from "./ar/platform.json";
import arMarketing from "./ar/marketing.json";

type LanguageCatalog = Record<string, string>;

const mergeCatalogs = (...sources: LanguageCatalog[]): LanguageCatalog => {
  return Object.assign({}, ...sources);
};

const catalogsByLanguage: Record<string, LanguageCatalog> = {
  en: mergeCatalogs(
    enCommon,
    enSettings,
    enDashboard,
    enProperties,
    enTenants,
    enLeases,
    enMaintenance,
    enPayments,
    enMessages,
    enCalendar,
    enAdmin,
    enAnnouncements,
    enReports,
    enInspections,
    enAccounting,
    enPlatform,
    enMarketing
  ),
  ar: mergeCatalogs(
    arCommon,
    arSettings,
    arDashboard,
    arProperties,
    arTenants,
    arLeases,
    arMaintenance,
    arPayments,
    arMessages,
    arCalendar,
    arAdmin,
    arAnnouncements,
    arReports,
    arInspections,
    arAccounting,
    arPlatform,
    arMarketing
  ),
};

export const translations: Record<string, Record<string, string>> = {};

for (const [language, catalog] of Object.entries(catalogsByLanguage)) {
  for (const [key, value] of Object.entries(catalog)) {
    if (!translations[key]) {
      translations[key] = {};
    }
    translations[key][language] = value;
  }
}
