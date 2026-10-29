/**
 * PropertyPro - Settings Search Engine
 * Advanced search and filtering for settings
 */

// Search result interface
export interface SettingsSearchResult {
  id: string;
  title: string;
  description: string;
  category: string;
  path: string;
  keywords: string[];
  icon: string;
  relevanceScore: number;
  matchedTerms: string[];
}

// Search filters interface
export interface SettingsSearchFilters {
  categories?: string[];
  userRole?: string;
  includeAdminOnly?: boolean;
}

// Settings index for search
const settingsIndex = [
  // Profile Settings
  {
    id: "profile-basic-info",
    title: "Basic Information",
    description: "Update your name, email, phone number, and contact details",
    category: "Profile",
    path: "/dashboard/settings/profile",
    keywords: [
      "name",
      "email",
      "phone",
      "contact",
      "personal",
      "first",
      "last",
      "bio",
      "location",
    ],
    icon: "User",
    adminOnly: false,
  },
  {
    id: "profile-emergency-contact",
    title: "Emergency Contact",
    description: "Set up emergency contact information for safety purposes",
    category: "Profile",
    path: "/dashboard/settings/profile#emergency",
    keywords: [
      "emergency",
      "contact",
      "family",
      "relationship",
      "safety",
      "urgent",
    ],
    icon: "User",
    adminOnly: false,
  },
  {
    id: "profile-social-links",
    title: "Social Media Links",
    description: "Connect your social media profiles and professional networks",
    category: "Profile",
    path: "/dashboard/settings/profile#social",
    keywords: [
      "social",
      "linkedin",
      "twitter",
      "facebook",
      "instagram",
      "professional",
      "network",
    ],
    icon: "User",
    adminOnly: false,
  },
  {
    id: "profile-job-info",
    title: "Professional Information",
    description: "Add your job title, company, and professional details",
    category: "Profile",
    path: "/dashboard/settings/profile#professional",
    keywords: [
      "job",
      "title",
      "company",
      "work",
      "professional",
      "career",
      "employment",
    ],
    icon: "User",
    adminOnly: false,
  },

  // Notification Settings
  {
    id: "notifications-email",
    title: "Email Notifications",
    description: "Configure email notification preferences and frequency",
    category: "Notifications",
    path: "/dashboard/settings/notifications#email",
    keywords: [
      "email",
      "notifications",
      "alerts",
      "reminders",
      "frequency",
      "digest",
      "inbox",
    ],
    icon: "Bell",
    adminOnly: false,
  },
  {
    id: "notifications-sms",
    title: "SMS Notifications",
    description: "Set up text message notifications for urgent alerts",
    category: "Notifications",
    path: "/dashboard/settings/notifications#sms",
    keywords: [
      "sms",
      "text",
      "phone",
      "mobile",
      "alerts",
      "urgent",
      "emergency",
    ],
    icon: "Bell",
    adminOnly: false,
  },
  {
    id: "notifications-push",
    title: "Push Notifications",
    description: "Manage browser and app push notifications",
    category: "Notifications",
    path: "/dashboard/settings/notifications#push",
    keywords: [
      "push",
      "browser",
      "app",
      "desktop",
      "mobile",
      "instant",
      "real-time",
    ],
    icon: "Bell",
    adminOnly: false,
  },
  {
    id: "notifications-quiet-hours",
    title: "Quiet Hours",
    description: "Set quiet hours to pause notifications during specific times",
    category: "Notifications",
    path: "/dashboard/settings/notifications#quiet",
    keywords: [
      "quiet",
      "hours",
      "sleep",
      "do not disturb",
      "schedule",
      "pause",
      "silence",
    ],
    icon: "Bell",
    adminOnly: false,
  },

  // Security Settings
  {
    id: "security-password",
    title: "Password & Authentication",
    description: "Change your password and manage authentication settings",
    category: "Security",
    path: "/dashboard/settings/security#password",
    keywords: [
      "password",
      "authentication",
      "login",
      "security",
      "credentials",
      "access",
    ],
    icon: "Shield",
    adminOnly: false,
  },
  {
    id: "security-2fa",
    title: "Two-Factor Authentication",
    description: "Enable two-factor authentication for enhanced security",
    category: "Security",
    path: "/dashboard/settings/security#2fa",
    keywords: [
      "2fa",
      "two factor",
      "authentication",
      "security",
      "totp",
      "authenticator",
      "code",
    ],
    icon: "Shield",
    adminOnly: false,
  },
  {
    id: "security-devices",
    title: "Device Management",
    description: "Manage devices that have access to your account",
    category: "Security",
    path: "/dashboard/settings/security#devices",
    keywords: [
      "devices",
      "sessions",
      "login",
      "access",
      "security",
      "trusted",
      "revoke",
    ],
    icon: "Shield",
    adminOnly: false,
  },
  {
    id: "security-audit",
    title: "Security Audit",
    description: "Review your account security status and recommendations",
    category: "Security",
    path: "/dashboard/settings/security#audit",
    keywords: [
      "audit",
      "security",
      "review",
      "status",
      "report",
      "recommendations",
      "check",
    ],
    icon: "Shield",
    adminOnly: false,
  },

  // Display Settings
  {
    id: "display-theme",
    title: "Theme & Appearance",
    description: "Choose between light, dark, or system theme",
    category: "Display",
    path: "/dashboard/settings/appearance#theme",
    keywords: [
      "theme",
      "dark",
      "light",
      "appearance",
      "mode",
      "visual",
      "style",
    ],
    icon: "Palette",
    adminOnly: false,
  },
  {
    id: "display-language",
    title: "Language & Region",
    description: "Set your language, timezone, and regional preferences",
    category: "Display",
    path: "/dashboard/settings/appearance#language",
    keywords: [
      "language",
      "timezone",
      "region",
      "locale",
      "international",
      "translation",
    ],
    icon: "Palette",
    adminOnly: false,
  },
  {
    id: "display-layout",
    title: "Layout & Typography",
    description: "Customize interface layout, font size, and density",
    category: "Display",
    path: "/dashboard/settings/appearance#layout",
    keywords: [
      "layout",
      "typography",
      "font",
      "size",
      "density",
      "spacing",
      "interface",
    ],
    icon: "Palette",
    adminOnly: false,
  },
  {
    id: "display-colors",
    title: "Color Scheme",
    description: "Customize the color palette and branding colors",
    category: "Display",
    path: "/dashboard/settings/appearance#colors",
    keywords: [
      "colors",
      "palette",
      "primary",
      "secondary",
      "accent",
      "branding",
      "custom",
    ],
    icon: "Palette",
    adminOnly: false,
  },

  // Privacy Settings
  {
    id: "privacy-profile",
    title: "Profile Visibility",
    description: "Control who can see your profile information",
    category: "Privacy",
    path: "/dashboard/settings/privacy#profile",
    keywords: [
      "privacy",
      "profile",
      "visibility",
      "public",
      "private",
      "contacts",
      "sharing",
    ],
    icon: "Eye",
    adminOnly: false,
  },
  {
    id: "privacy-data",
    title: "Data & Analytics",
    description: "Manage data collection and sharing preferences",
    category: "Privacy",
    path: "/dashboard/settings/privacy#data",
    keywords: [
      "data",
      "analytics",
      "collection",
      "sharing",
      "usage",
      "tracking",
      "statistics",
    ],
    icon: "Eye",
    adminOnly: false,
  },
  {
    id: "privacy-cookies",
    title: "Cookie Preferences",
    description: "Manage cookie and tracking preferences",
    category: "Privacy",
    path: "/dashboard/settings/privacy#cookies",
    keywords: [
      "cookies",
      "tracking",
      "analytics",
      "marketing",
      "essential",
      "preferences",
    ],
    icon: "Eye",
    adminOnly: false,
  },

  // System Settings (Admin Only)
  {
    id: "system-branding",
    title: "System Branding",
    description: "Configure system-wide branding and logos",
    category: "System",
    path: "/dashboard/settings/system#branding",
    keywords: [
      "branding",
      "logo",
      "company",
      "colors",
      "favicon",
      "system",
      "global",
    ],
    icon: "Database",
    adminOnly: true,
  },
  {
    id: "system-email",
    title: "Email Configuration",
    description: "Configure SMTP settings for system emails",
    category: "System",
    path: "/dashboard/settings/system#email",
    keywords: [
      "smtp",
      "email",
      "configuration",
      "server",
      "mail",
      "system",
      "outgoing",
    ],
    icon: "Database",
    adminOnly: true,
  },
  {
    id: "system-payment",
    title: "Payment Settings",
    description: "Configure payment gateways and billing settings",
    category: "System",
    path: "/dashboard/settings/system#payment",
    keywords: [
      "payment",
      "stripe",
      "paypal",
      "billing",
      "gateway",
      "transactions",
      "money",
    ],
    icon: "Database",
    adminOnly: true,
  },

  // Import/Export
  {
    id: "import-export",
    title: "Import/Export Settings",
    description: "Backup and restore your settings and configurations",
    category: "Tools",
    path: "/dashboard/settings/import-export",
    keywords: [
      "import",
      "export",
      "backup",
      "restore",
      "settings",
      "configuration",
      "transfer",
    ],
    icon: "FileText",
    adminOnly: false,
  },

  // History
  {
    id: "settings-history",
    title: "Settings History",
    description: "View audit logs and change history for settings",
    category: "Tools",
    path: "/dashboard/settings/history",
    keywords: [
      "history",
      "audit",
      "logs",
      "changes",
      "tracking",
      "timeline",
      "activity",
    ],
    icon: "History",
    adminOnly: false,
  },
];

/**
 * Search settings based on query and filters
 */
export function searchSettings(
  query: string,
  filters: SettingsSearchFilters = {}
): SettingsSearchResult[] {
  const { categories, userRole, includeAdminOnly = false } = filters;

  // Filter by admin permissions
  let filteredIndex = settingsIndex.filter((item) => {
    if (item.adminOnly && !includeAdminOnly && userRole !== "SUPER_ADMIN") {
      return false;
    }
    return true;
  });

  // Filter by categories
  if (categories && categories.length > 0) {
    filteredIndex = filteredIndex.filter((item) =>
      categories.includes(item.category)
    );
  }

  // If no query, return all filtered items
  if (!query.trim()) {
    return filteredIndex.map((item) => ({
      ...item,
      relevanceScore: 1,
      matchedTerms: [],
    }));
  }

  const searchTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  const results: SettingsSearchResult[] = [];

  for (const item of filteredIndex) {
    const matchedTerms: string[] = [];
    let relevanceScore = 0;

    // Search in title (highest weight)
    for (const term of searchTerms) {
      if (item.title.toLowerCase().includes(term)) {
        relevanceScore += 10;
        matchedTerms.push(term);
      }
    }

    // Search in description (medium weight)
    for (const term of searchTerms) {
      if (item.description.toLowerCase().includes(term)) {
        relevanceScore += 5;
        if (!matchedTerms.includes(term)) {
          matchedTerms.push(term);
        }
      }
    }

    // Search in keywords (lower weight)
    for (const term of searchTerms) {
      for (const keyword of item.keywords) {
        if (keyword.toLowerCase().includes(term)) {
          relevanceScore += 2;
          if (!matchedTerms.includes(term)) {
            matchedTerms.push(term);
          }
          break; // Only count once per term
        }
      }
    }

    // Search in category (lowest weight)
    for (const term of searchTerms) {
      if (item.category.toLowerCase().includes(term)) {
        relevanceScore += 1;
        if (!matchedTerms.includes(term)) {
          matchedTerms.push(term);
        }
      }
    }

    // Only include items with matches
    if (relevanceScore > 0) {
      results.push({
        ...item,
        relevanceScore,
        matchedTerms,
      });
    }
  }

  // Sort by relevance score (descending)
  return results.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Get search suggestions based on partial query
 */
export function getSearchSuggestions(
  partialQuery: string,
  limit = 5
): string[] {
  const query = partialQuery.toLowerCase().trim();

  if (query.length < 2) {
    return [];
  }

  const suggestions = new Set<string>();

  // Collect suggestions from titles, keywords, and categories
  for (const item of settingsIndex) {
    // From title
    if (item.title.toLowerCase().includes(query)) {
      suggestions.add(item.title);
    }

    // From keywords
    for (const keyword of item.keywords) {
      if (keyword.toLowerCase().includes(query)) {
        suggestions.add(keyword);
      }
    }

    // From category
    if (item.category.toLowerCase().includes(query)) {
      suggestions.add(item.category);
    }
  }

  return Array.from(suggestions).slice(0, limit);
}

/**
 * Get popular search terms
 */
export function getPopularSearchTerms(): string[] {
  return [
    "password",
    "notifications",
    "theme",
    "privacy",
    "email",
    "security",
    "profile",
    "colors",
    "backup",
    "history",
  ];
}

/**
 * Get settings by category
 */
export function getSettingsByCategory(
  category: string,
  userRole?: string
): SettingsSearchResult[] {
  return searchSettings("", {
    categories: [category],
    userRole,
    includeAdminOnly: userRole === "SUPER_ADMIN",
  });
}
