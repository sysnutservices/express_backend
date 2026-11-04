// One-line item list for the WhatsApp order confirmation, e.g.
// "Dell Latitude 5490 (16GB RAM, 512GB SSD) x1; HP EliteBook 840 G5 (8GB RAM, 256GB SSD) x2".
// RAM/SSD come from the item's specs snapshot, which createOrder writes with
// the customer's chosen upgrade, falling back to selectedConfig on older
// orders. Mirrors the frontend's Lapshark lib/orderItemConfig.ts.
//
// WhatsApp template params reject newlines, tabs and runs of 4+ spaces, and
// cap length, so the result is flattened to one line and truncated.
export const MAX_ITEMS_PARAM_LENGTH = 900;

type SummaryItem = {
  title?: string;
  quantity?: number;
  specs?: { ram?: string; storage?: string } | null;
  selectedConfig?: { ram?: string; storage?: string } | null;
};

const tidy = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim()
    ? v.trim().replace(/(\d)\s*gb\b/gi, "$1GB").replace(/(\d)\s*tb\b/gi, "$1TB")
    : undefined;

export function itemConfigText(item: SummaryItem): string {
  const ram = tidy(item.specs?.ram) || tidy(item.selectedConfig?.ram);
  const ssd = tidy(item.specs?.storage) || tidy(item.selectedConfig?.storage);
  return [
    ram && (/ram/i.test(ram) ? ram : `${ram} RAM`),
    ssd && (/ssd|hdd/i.test(ssd) ? ssd : `${ssd} SSD`),
  ]
    .filter(Boolean)
    .join(", ");
}

export function orderItemsSummary(items: SummaryItem[]): string {
  const text = (items || [])
    .map((i) => {
      const cfg = itemConfigText(i);
      return `${(i.title || "Laptop").trim()}${cfg ? ` (${cfg})` : ""} x${i.quantity || 1}`;
    })
    .join("; ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ");
  return text.length > MAX_ITEMS_PARAM_LENGTH ? `${text.slice(0, MAX_ITEMS_PARAM_LENGTH - 1)}…` : text;
}
