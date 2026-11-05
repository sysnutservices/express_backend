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

export async function createShipment(input: CreateShipmentInput): Promise<ShipmentResult & { courier: CourierName }> {
  const courier = activeCourier();
  const result = courier === "delhivery" ? await delhivery.createShipment(input) : await ekart.createShipment(input);
  return { ...result, courier };
}

export const cancelShipment = (awb: string, courier?: string): Promise<void> =>
  courier === "delhivery" ? delhivery.cancelShipment(awb) : ekart.cancelShipment(awb);
