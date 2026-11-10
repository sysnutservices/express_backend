import AmbassadorSettings, { IAmbassadorSettings, SETTINGS_DEFAULTS } from "../models/AmbassadorSettings";

// Short in-process cache: settings are read on every partner request but
// change rarely. PUT /admin/partner-settings calls clearSettingsCache().
let cache: { at: number; value: IAmbassadorSettings } | null = null;
const TTL_MS = 30_000;

export async function getSettings(): Promise<IAmbassadorSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const doc = await AmbassadorSettings.findOneAndUpdate(
    { key: "default" },
    { $setOnInsert: { key: "default", ...SETTINGS_DEFAULTS } },
    { upsert: true, new: true }
  ).lean<IAmbassadorSettings>();
  // Merge defaults: .lean() skips schema defaults, so a settings document
  // created before a field existed would otherwise return it as undefined.
  const value = { ...SETTINGS_DEFAULTS, ...doc! } as IAmbassadorSettings;
  cache = { at: Date.now(), value };
  return value;
}

export function clearSettingsCache() {
  cache = null;
}

export const EDITABLE_SETTINGS: (keyof typeof SETTINGS_DEFAULTS)[] = [
  "programmeEnabled",
  "registrationOpen",
  "pilotAllowlist",
  "leadOwnershipDays",
  "eligibilityHoldDays",
  "quotationValidityHours",
  "minimumAge",
  "agreementVersion",
  "referralBaseUrl",
  "foundingCohortSize",
  "tdsPercent",
];
