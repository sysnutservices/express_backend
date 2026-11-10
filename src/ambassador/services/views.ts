// The only place profile/commission documents are shaped for responses.
// Ciphertext and hashes never leave the server; only masked values do.
import { paiseToRupees } from "../money";

export function toPartnerProfileView(p: any) {
  if (!p) return null;
  return {
    _id: p._id,
    partnerCode: p.partnerCode,
    partnerType: p.partnerType,
    status: p.status,
    fullName: p.fullName,
    email: p.email,
    emailVerified: !!p.emailVerifiedAt,
    phone: p.phone,
    city: p.city,
    state: p.state,
    address: p.address,
    business: p.business,
    occupation: p.occupation,
    pan: p.pan ? { masked: "XXXXXX" + p.pan.last4 } : null,
    payout: p.payout ? { method: p.payout.method, masked: p.payout.masked } : null,
    agreement: p.agreement ? { version: p.agreement.version, acceptedAt: p.agreement.acceptedAt } : null,
    orientationCompletedAt: p.orientationCompletedAt,
    rejectionReason: p.status === "rejected" ? p.rejectionReason : undefined,
    suspensionReason: p.status === "suspended" ? p.suspensionReason : undefined,
    createdAt: p.createdAt,
  };
}

export function toAdminProfileView(p: any) {
  if (!p) return null;
  return {
    ...toPartnerProfileView(p),
    userId: p.userId,
    dateOfBirth: p.dateOfBirth,
    heardFrom: p.heardFrom,
    statusHistory: p.statusHistory,
    agreementHistory: p.agreementHistory,
    reviewedBy: p.reviewedBy,
    reviewedAt: p.reviewedAt,
    rejectionReason: p.rejectionReason,
    suspensionReason: p.suspensionReason,
    flags: p.flags,
    updatedAt: p.updatedAt,
  };
}

export function toCommissionView(c: any, opts: { staff: boolean }) {
  const view: any = {
    _id: c._id,
    orderNumber: c.orderNumber,
    productTitle: c.productTitle,
    quantity: c.quantity,
    unitSellingPrice: paiseToRupees(c.unitSellingPricePaise),
    commission: paiseToRupees(c.commissionPaise),
    currency: c.currency,
    status: c.status,
    onHold: !!c.hold,
    attributionType: c.attribution?.type,
    ruleVersion: c.ruleSnapshot?.version ?? null,
    calcReason: c.calc?.reason,
    deliveredAt: c.deliveredAt,
    eligibleAt: c.eligibleAt,
    approvedAt: c.approvedAt,
    paidAt: c.paidAt,
    payoutId: c.payoutId,
    reversedAt: c.reversedAt,
    reversalReason: c.reversalReason,
    createdAt: c.createdAt,
  };
  if (opts.staff) {
    Object.assign(view, {
      ambassadorId: c.ambassadorId,
      orderId: c.orderId,
      orderItemId: c.orderItemId,
      productId: c.productId,
      hold: c.hold,
      holdHistory: c.holdHistory,
      attribution: c.attribution,
      ruleId: c.ruleId,
      ruleSnapshot: c.ruleSnapshot,
      statusHistory: c.statusHistory,
      commissionPaise: c.commissionPaise,
      unitSellingPricePaise: c.unitSellingPricePaise,
    });
  } else if (c.hold) {
    // Partners see that a line is under review, not the internal reason code
    // (e.g. "self_referral" is a fraud signal — no need to coach around it).
    view.holdNote = "Under review by Lapshark";
  }
  return view;
}

export function toRuleView(r: any) {
  return {
    _id: r._id,
    partnerType: r.partnerType,
    productId: r.productId,
    kind: r.kind,
    slabs: (r.slabs || []).map((s: any) => ({
      minPrice: paiseToRupees(s.minPricePaise),
      maxPrice: s.maxPricePaise === null || s.maxPricePaise === undefined ? null : paiseToRupees(s.maxPricePaise),
      commission: paiseToRupees(s.commissionPaise),
    })),
    minimumPrice: r.minimumPricePaise === null || r.minimumPricePaise === undefined ? null : paiseToRupees(r.minimumPricePaise),
    baseCommission: r.baseCommissionPaise === null || r.baseCommissionPaise === undefined ? null : paiseToRupees(r.baseCommissionPaise),
    marginSharePercent: r.marginSharePercent,
    version: r.version,
    status: r.status,
    validFrom: r.validFrom,
    validUntil: r.validUntil,
    notes: r.notes,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    retiredAt: r.retiredAt,
  };
}
