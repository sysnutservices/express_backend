import DealerSettings, { IDealerSettings, DEALER_SETTINGS_DEFAULTS } from "../models/DealerSettings";

// Same short cache as the ambassador settings. PUT /admin/dealer-settings
// calls clearDealerSettingsCache().
let cache: { at: number; value: IDealerSettings } | null = null;
const TTL_MS = 30_000;

export async function getDealerSettings(): Promise<IDealerSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const doc = await DealerSettings.findOneAndUpdate(
    { key: "default" },
    { $setOnInsert: { key: "default", ...DEALER_SETTINGS_DEFAULTS } },
    { upsert: true, new: true }
  ).lean<IDealerSettings>();
  const value = { ...DEALER_SETTINGS_DEFAULTS, ...doc! } as IDealerSettings;
  cache = { at: Date.now(), value };
  return value;
}

export function clearDealerSettingsCache() {
  cache = null;
}
