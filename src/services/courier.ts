import * as ekart from "./ekart";
import * as delhivery from "./delhivery";
import type { CreateShipmentInput, ServiceabilityResult, ShipmentResult } from "./ekart";

// Which courier books new shipments. Delhivery replaced Ekart on 2026-11-05;
// it becomes active as soon as DELHIVERY_API_TOKEN is set, so the code can
// be deployed before the Delhivery account is ready without breaking
// bookings. Shipments already booked keep their own courier (Order
// shipment.courier; unset on older orders = Ekart) for cancel and tracking.
export type CourierName = "delhivery" | "ekart";

export const activeCourier = (): CourierName => (delhivery.delhiveryConfigured() ? "delhivery" : "ekart");

export const checkServiceability = (pincode: string): Promise<ServiceabilityResult> =>
  activeCourier() === "delhivery" ? delhivery.checkServiceability(pincode) : ekart.checkServiceability(pincode);

// Bangalore pincodes are 560xxx. COD was Bangalore-only from 2026-11-03
// until it went pan-India on Delhivery (2026-11-10); this is now only the
// fallback when Delhivery isn't active or its pincode API is down.
export const isBangalorePincode = (zip: unknown) => /^560\d{3}$/.test(String(zip ?? "").trim());

// Whether a COD order can be placed for this pincode, `codAmount` being the
// cash the courier would collect. COD is offered wherever Delhivery says it
// collects cash (owner decision, 2026-11-10). Falls back to Bangalore-only
// under Ekart or if Delhivery can't be reached, so an API outage never opens
// COD to pincodes the courier won't collect at.
export async function isCodAvailable(pincode: unknown, codAmount: number): Promise<boolean> {
  const pin = String(pincode ?? "").trim();
  if (!/^\d{6}$/.test(pin)) return false;
  if (activeCourier() !== "delhivery") return isBangalorePincode(pin);
  try {
    return await delhivery.checkCod(pin, codAmount);
  } catch (error: any) {
    console.error("Delhivery COD check failed, using Bangalore-only fallback:", error.response?.data || error.message);
    return isBangalorePincode(pin);
  }
}

export async function createShipment(input: CreateShipmentInput): Promise<ShipmentResult & { courier: CourierName }> {
  const courier = activeCourier();
  const result = courier === "delhivery" ? await delhivery.createShipment(input) : await ekart.createShipment(input);
  return { ...result, courier };
}

export const cancelShipment = (awb: string, courier?: string): Promise<void> =>
  courier === "delhivery" ? delhivery.cancelShipment(awb) : ekart.cancelShipment(awb);
