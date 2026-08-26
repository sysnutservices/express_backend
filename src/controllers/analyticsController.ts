import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import Visitor from "../models/Visitor";
import Session from "../models/Session";
import BehaviorEvent from "../models/BehaviorEvent";
import { isAllowedEvent } from "../utils/analyticsEvents";
import { calculateIntentScore, scoreToLevel } from "../services/intentScore";
import { sendCapiEvent, parseFbCookies } from "../services/metaCapi";

const UUID_LIKE = /^[0-9a-f-]{20,40}$/i;
const FUNNEL_EVENTS = ["page_view", "view_item", "add_to_cart", "begin_checkout", "purchase"];

// Only these three have a browser-side Meta Pixel counterpart worth
// deduping server-side — purchase/generate_lead are forwarded separately
// from orderController.ts, where the richer order/lead data actually lives.
const CAPI_EVENT_MAP: Record<string, "ViewContent" | "AddToCart" | "InitiateCheckout"> = {
  view_item: "ViewContent",
  add_to_cart: "AddToCart",
  begin_checkout: "InitiateCheckout",
};

// A populated User doc carries the full addressBook — this trims it down to
// what the admin Visitors/Journey pages actually need (name/mobile/email
// plus the pincode off their default address), so the full address book
// (with street, phone-per-address, etc.) never leaves the server for what's
// meant to be an at-a-glance view.
function shapeCustomer(user: any) {
  if (!user) return user;
  const addr =
    (user.addressBook || []).find((a: any) => a.id === user.defaultAddressId) || (user.addressBook || [])[0];
  return {
    _id: user._id,
    name: user.name,
    mobile: user.mobile,
    email: user.email,
    pincode: addr?.zip,
  };
}

// =========================================================
// INGEST — POST /analytics/events
// =========================================================
// Deliberately public (no `protect`) — `protect` 401s outright on a missing
// token, which would break tracking for every anonymous (not-logged-in)
// visitor. Auth here is best-effort only (see below); the real security
// boundary is the eventName allowlist, not who's calling.
export const ingestEvent = async (req: Request, res: Response) => {
  try {
    const { eventName, visitorId, sessionId, eventId, userId: bodyUserId, properties, page, utm, referrer } = req.body;

    if (!isAllowedEvent(eventName)) {
      return res.status(400).json({ message: "Unknown event" });
    }
    if (visitorId !== undefined && (typeof visitorId !== "string" || !UUID_LIKE.test(visitorId))) {
      return res.status(400).json({ message: "Invalid visitorId" });
    }
    if (sessionId !== undefined && (typeof sessionId !== "string" || !UUID_LIKE.test(sessionId))) {
      return res.status(400).json({ message: "Invalid sessionId" });
    }
    if (eventId !== undefined && (typeof eventId !== "string" || !UUID_LIKE.test(eventId))) {
      return res.status(400).json({ message: "Invalid eventId" });
    }

    let cleanProperties: Record<string, unknown> = {};
    if (properties !== undefined) {
      if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
        return res.status(400).json({ message: "Invalid properties" });
      }
      const keys = Object.keys(properties);
      if (keys.length > 20) {
        return res.status(400).json({ message: "Too many properties" });
      }
      for (const key of keys) {
        const value = properties[key];
        if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
          return res.status(400).json({ message: "Invalid property value" });
        }
      }
      if (JSON.stringify(properties).length > 2048) {
        return res.status(400).json({ message: "Properties too large" });
      }
      cleanProperties = properties;
    }

    let cleanPage: { url?: string; path?: string; title?: string } = {};
    if (page !== undefined) {
      if (typeof page !== "object" || page === null || Array.isArray(page)) {
        return res.status(400).json({ message: "Invalid page" });
      }
      cleanPage = {
        url: typeof page.url === "string" ? page.url.slice(0, 500) : undefined,
        path: typeof page.path === "string" ? page.path.slice(0, 500) : undefined,
        title: typeof page.title === "string" ? page.title.slice(0, 200) : undefined,
      };
    }

    const cleanReferrer = typeof referrer === "string" ? referrer.slice(0, 500) : undefined;
    const cleanUtm =
      utm && typeof utm === "object" && !Array.isArray(utm)
        ? {
            source: typeof utm.source === "string" ? utm.source.slice(0, 100) : undefined,
            medium: typeof utm.medium === "string" ? utm.medium.slice(0, 100) : undefined,
            campaign: typeof utm.campaign === "string" ? utm.campaign.slice(0, 100) : undefined,
            term: typeof utm.term === "string" ? utm.term.slice(0, 100) : undefined,
            content: typeof utm.content === "string" ? utm.content.slice(0, 100) : undefined,
          }
        : undefined;

    // Best-effort auth: unlike `protect`, a missing/invalid token never
    // rejects the request — it just falls back to whatever userId the body
    // carries (the client reads it from localStorage["user"] itself).
    let userId: any = typeof bodyUserId === "string" ? bodyUserId : undefined;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const decoded: any = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET as string);
        if (decoded?.id) userId = decoded.id;
      } catch {
        // Swallowed on purpose — analytics isn't a security boundary.
      }
    }

    const now = new Date();

    if (visitorId) {
      const touch = { ...cleanUtm, referrer: cleanReferrer, landingPage: cleanPage.path };
      // A single atomic upsert, not findOne-then-create/update: a browser
      // firing several events almost simultaneously on first page load
      // (page_view + view_item, say) sent two concurrent requests through
      // the old find-then-create version, both saw "not found," and the
      // second's create() threw a duplicate-key error on the unique
      // visitorId index — seen for real once real traffic started hitting
      // this. findOneAndUpdate+upsert lets Mongo handle the race, not us.
      const visitorUpdate: Record<string, unknown> = { $set: { lastSeenAt: now, lastTouch: touch }, $inc: { totalEvents: 1 } };
      if (userId) (visitorUpdate.$set as Record<string, unknown>).userId = userId;
      await Visitor.findOneAndUpdate(
        { visitorId },
        {
          ...visitorUpdate,
          $setOnInsert: { firstSeenAt: now, firstTouch: touch },
        },
        { upsert: true }
      );
    }

    if (sessionId && visitorId) {
      // Same race, same fix as Visitor above.
      await Session.findOneAndUpdate(
        { sessionId },
        {
          $set: { lastEventAt: now },
          $setOnInsert: {
            visitorId,
            startedAt: now,
            utm: cleanUtm,
            referrer: cleanReferrer,
            landingPage: cleanPage.path,
            userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
          },
        },
        { upsert: true }
      );
    }

    await BehaviorEvent.create({
      eventName,
      visitorId: visitorId || null,
      sessionId: sessionId || null,
      userId,
      properties: cleanProperties,
      page: cleanPage,
      source: "client",
    });

    if (visitorId) {
      const score = await calculateIntentScore(visitorId);
      await Visitor.updateOne({ visitorId }, { $set: { intentScore: score, intentLevel: scoreToLevel(score) } });
    }

    // Meta CAPI echo for the 3 commerce events that have a browser Pixel
    // counterpart (see CAPI_EVENT_MAP) — same eventId the client's fbq()
    // call used, so Meta dedupes rather than double-counting. No-ops if
    // Meta isn't configured; never blocks the response either way.
    const capiEventName = CAPI_EVENT_MAP[eventName as string];
    if (capiEventName) {
      try {
        await sendCapiEvent({
          eventName: capiEventName,
          eventId,
          eventSourceUrl: cleanPage.url,
          userData: {
            ip: req.ip,
            userAgent: req.headers["user-agent"] as string | undefined,
            ...parseFbCookies(req.headers.cookie),
          },
          customData: {
            content_ids: cleanProperties.productId ? [cleanProperties.productId] : undefined,
            value: (cleanProperties.finalPrice ?? cleanProperties.price ?? cleanProperties.finalTotal) as
              | number
              | undefined,
            currency: "INR",
          },
        });
      } catch (err: any) {
        console.error("Meta CAPI event failed:", err.response?.data || err.message);
      }
    }

    // sendBeacon callers can't read a response body anyway — 202 with no
    // meaningful payload.
    res.status(202).json({ received: true });
  } catch (error) {
    // A tracking write must never surface as a client-visible error — still
    // 202 even on failure (logged for us to notice, not the customer).
    console.error("ingestEvent error:", error);
    res.status(202).json({ received: true });
  }
};

// =========================================================
// ADMIN: OVERVIEW — GET /admin/analytics/overview?days=N
// =========================================================
export const getOverviewStats = async (req: Request, res: Response) => {
  try {
    const days = Math.min(Math.max(parseInt(String(req.query.days || "7"), 10) || 7, 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [funnelCounts, distinctVisitors, dailyPurchases] = await Promise.all([
      BehaviorEvent.aggregate([
        { $match: { createdAt: { $gte: since }, eventName: { $in: FUNNEL_EVENTS } } },
        { $group: { _id: "$eventName", count: { $sum: 1 } } },
      ]),
      BehaviorEvent.distinct("visitorId", { createdAt: { $gte: since }, visitorId: { $ne: null } }),
      BehaviorEvent.aggregate([
        { $match: { createdAt: { $gte: since }, eventName: "purchase" } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const counts: Record<string, number> = {};
    for (const row of funnelCounts) counts[row._id] = row.count;
    const visitors = distinctVisitors.length;
    const purchases = counts.purchase || 0;

    res.json({
      visitors,
      pageViews: counts.page_view || 0,
      productViews: counts.view_item || 0,
      addToCart: counts.add_to_cart || 0,
      checkoutsStarted: counts.begin_checkout || 0,
      purchases,
      conversionRate: visitors > 0 ? Number(((purchases / visitors) * 100).toFixed(2)) : 0,
      dailyPurchases: dailyPurchases.map((d) => ({ date: d._id, count: d.count })),
    });
  } catch (error) {
    console.error("getOverviewStats error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

// =========================================================
// ADMIN: PRODUCT VIEWS BREAKDOWN — GET /admin/analytics/products?days=N
// =========================================================
// "Which products get looked at but don't convert" — the one insight this
// exists for. Views/add-to-cart come straight off BehaviorEvent's
// properties.productId (client events already carry it). Purchases come
// from the server-side purchase event's properties.items array
// (orderController.ts's markOrderPaid) — that's per-order, not per-product,
// by default, which is why that write includes an items list instead of
// just an item count.
export const getProductAnalytics = async (req: Request, res: Response) => {
  try {
    const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [viewsAndCarts, purchaseRows] = await Promise.all([
      BehaviorEvent.aggregate([
        {
          $match: {
            createdAt: { $gte: since },
            eventName: { $in: ["view_item", "add_to_cart"] },
            "properties.productId": { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: { productId: "$properties.productId", eventName: "$eventName" },
            count: { $sum: 1 },
            title: { $last: "$properties.title" },
          },
        },
      ]),
      BehaviorEvent.aggregate([
        { $match: { createdAt: { $gte: since }, eventName: "purchase" } },
        { $unwind: "$properties.items" },
        {
          $group: {
            _id: "$properties.items.productId",
            purchases: { $sum: { $ifNull: ["$properties.items.quantity", 1] } },
          },
        },
      ]),
    ]);

    const products: Record<
      string,
      { productId: string; title: string; views: number; addToCart: number; purchases: number }
    > = {};

    for (const row of viewsAndCarts) {
      const pid = row._id.productId;
      if (!products[pid]) products[pid] = { productId: pid, title: row.title || pid, views: 0, addToCart: 0, purchases: 0 };
      if (row.title) products[pid].title = row.title;
      if (row._id.eventName === "view_item") products[pid].views = row.count;
      if (row._id.eventName === "add_to_cart") products[pid].addToCart = row.count;
    }

    for (const row of purchaseRows) {
      const pid = row._id;
      if (!pid) continue;
      if (!products[pid]) products[pid] = { productId: pid, title: pid, views: 0, addToCart: 0, purchases: 0 };
      products[pid].purchases = row.purchases;
    }

    const list = Object.values(products)
      .map((p) => ({
        ...p,
        cartConversionRate: p.views > 0 ? Number(((p.addToCart / p.views) * 100).toFixed(1)) : 0,
        purchaseConversionRate: p.views > 0 ? Number(((p.purchases / p.views) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.views - a.views);

    res.json({ products: list });
  } catch (error) {
    console.error("getProductAnalytics error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

// =========================================================
// ADMIN: VISITOR LIST — GET /admin/analytics/visitors?page=N
// =========================================================
export const getVisitors = async (req: Request, res: Response) => {
  try {
    const page = Math.max(parseInt(String(req.query.page || "1"), 10) || 1, 1);
    const limit = 50;

    const [visitors, total] = await Promise.all([
      Visitor.find()
        .sort({ intentScore: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("userId", "name mobile email addressBook defaultAddressId")
        .lean(),
      Visitor.countDocuments(),
    ]);

    const shaped = visitors.map((v: any) => ({ ...v, userId: shapeCustomer(v.userId) }));

    res.json({ visitors: shaped, total, page, limit });
  } catch (error) {
    console.error("getVisitors error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

// =========================================================
// ADMIN: VISITOR JOURNEY — GET /admin/analytics/visitors/:visitorId
// =========================================================
export const getVisitorJourney = async (req: Request, res: Response) => {
  try {
    const { visitorId } = req.params;
    const visitor = await Visitor.findOne({ visitorId }).populate(
      "userId",
      "name mobile email addressBook defaultAddressId"
    );
    if (!visitor) {
      return res.status(404).json({ message: "Visitor not found" });
    }

    const clientEvents = await BehaviorEvent.find({ visitorId }).sort({ createdAt: 1 }).lean();

    // Server-side events (purchase, generate_lead) carry no visitorId — once
    // this visitor is identified, pull those in by userId so a converted
    // customer's journey reads as one continuous timeline, not two. Uses
    // the still-populated visitor.userId here (before shapeCustomer below
    // replaces it with a trimmed plain object) — Mongoose casts a populated
    // doc back to its ObjectId for the query correctly either way.
    let serverEvents: any[] = [];
    if (visitor.userId) {
      serverEvents = await BehaviorEvent.find({ userId: visitor.userId, visitorId: null })
        .sort({ createdAt: 1 })
        .lean();
    }

    const events = [...clientEvents, ...serverEvents].sort(
      (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    const visitorObj: any = visitor.toObject();
    visitorObj.userId = shapeCustomer(visitorObj.userId);

    res.json({ visitor: visitorObj, events });
  } catch (error) {
    console.error("getVisitorJourney error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};
