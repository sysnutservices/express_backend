// Response shapes. Ciphertext never leaves the server: GSTIN/PAN appear only
// as "last 4" here and in full only through the audited admin reveal.
export function dealerProfileView(p: any) {
  if (!p) return null;
  return {
    id: String(p._id),
    dealerCode: p.dealerCode,
    status: p.status,
    businessName: p.businessName,
    contactName: p.contactName,
    phone: p.phone,
    email: p.email || null,
    address: p.address,
    gstinMasked: p.gstin?.last4 ? "XXXXXXXXXXX" + p.gstin.last4 : null,
    panMasked: p.pan?.last4 ? "XXXXXX" + p.pan.last4 : null,
    agreementVersion: p.agreement?.version,
    createdAt: p.createdAt,
  };
}

export function adminDealerView(p: any) {
  return {
    ...dealerProfileView(p)!,
    userId: String(p.userId),
    statusHistory: p.statusHistory || [],
    flags: p.flags || [],
    notes: p.notes || "",
    agreement: p.agreement,
    vetting: p.vetting || null,
  };
}

export function dealerEnquiryView(e: any) {
  return {
    id: String(e._id),
    phone: e.phone,
    businessName: e.businessName,
    contactName: e.contactName,
    city: e.city,
    businessType: e.businessType,
    monthlyVolume: e.monthlyVolume,
    message: e.message || "",
    source: e.source || {},
    status: e.status,
    statusAt: e.statusAt || null,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

export function dealerOrderView(o: any, opts: { admin?: boolean } = {}) {
  const base = {
    id: String(o._id),
    orderNumber: o.orderNumber,
    dealerCode: o.dealerCode,
    businessName: o.businessName,
    status: o.status,
    lines: (o.lines || []).map((l: any) => ({
      id: String(l._id),
      productId: String(l.productId),
      title: l.title,
      condition: l.condition,
      image: l.image,
      quantity: l.quantity,
      unitPricePaise: l.unitPricePaise,
      warrantyMonths: l.warrantyMonths,
      warrantyPricePaise: l.warrantyPricePaise,
      lineTotalPaise: l.lineTotalPaise,
      serials: l.serials || [],
    })),
    totalPaise: o.totalPaise,
    paidPaise: o.paidPaise,
    duePaise: Math.max(0, o.totalPaise - o.paidPaise),
    paymentMethod: o.paymentMethod,
    payments: (o.payments || []).map((p: any) => ({
      id: String(p._id),
      method: p.method,
      amountPaise: p.amountPaise,
      reference: p.reference,
      receivedAt: p.receivedAt,
      ...(opts.admin ? { recordedBy: p.recordedBy ? String(p.recordedBy) : null, recordedAt: p.recordedAt, note: p.note } : {}),
    })),
    fulfilment: o.fulfilment,
    statusHistory: (o.statusHistory || []).map((h: any) => ({ status: h.status, at: h.at, note: h.note })),
    invoiceRef: o.invoiceRef ? { number: o.invoiceRef.number, note: o.invoiceRef.note } : null,
    dealerNote: o.dealerNote || null,
    cancelReason: o.cancelReason || null,
    paidAt: o.paidAt,
    packedAt: o.packedAt,
    dispatchedAt: o.dispatchedAt,
    deliveredAt: o.deliveredAt,
    cancelledAt: o.cancelledAt,
    claims: (o.claims || []).map((c: any) => ({
      id: String(c._id),
      type: c.type,
      serial: c.serial,
      description: c.description,
      evidenceUrl: c.evidenceUrl,
      status: c.status,
      resolutionNote: c.resolutionNote,
      decidedAt: c.decidedAt,
      createdAt: c.createdAt,
    })),
    createdAt: o.createdAt,
  };
  if (opts.admin) return { ...base, dealerId: String(o.dealerId), refundNote: o.refundNote || null, stockReserved: o.stockReserved };
  return base;
}
