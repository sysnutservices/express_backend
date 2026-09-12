// Pure helpers for the order-item serial number workflow (admin dispatch UI
// -> orderController.ts's setItemSerialNumber). Kept DB-free so they can be
// unit-tested the same way as pricing.ts/pricing.selftest.ts, with the
// actual Mongo lookup left to the controller.

export function normalizeSerialNumber(raw: string): string {
  return (raw ?? "").trim();
}

export interface SerialOwnerLookup {
  orderId: string;
  items: Array<{ _id: string; serialNumber?: string | null }>;
}

// Scans candidate orders (already narrowed by the controller's DB query to
// "contains an item with this exact serial") for one assigned to a
// DIFFERENT item than (currentOrderId, currentItemId). Returns that order's
// orderId, or null if the serial is free — including the case where it's
// simply already on the same item (an unchanged re-save, not a conflict).
export function findSerialConflict(
  candidates: SerialOwnerLookup[],
  serial: string,
  currentOrderId: string,
  currentItemId: string
): string | null {
  for (const order of candidates) {
    for (const item of order.items) {
      if (item.serialNumber === serial) {
        const isSameItem = order.orderId === currentOrderId && item._id === currentItemId;
        if (!isSameItem) return order.orderId;
      }
    }
  }
  return null;
}
