import { Request, Response } from 'express';
import mongoose from 'mongoose';
import User from '../models/User';
import Order from '../models/Order';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { sendOtp, getContactName } from '../services/wa';
import { logAdminAction } from '../models/AuditLog';

// expiresIn defaults to the customer session length so customerLogin's call
// site needs no changes — adminLogin passes a much shorter one below, since
// a leaked admin token is a higher-value target than a leaked customer one.
const generateToken = (
  user: { id: string; name: string; role: string; tokenVersion: number },
  expiresIn: jwt.SignOptions["expiresIn"] = "30d"
) => {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      role: user.role,
      tokenVersion: user.tokenVersion,
    },
    process.env.JWT_SECRET as string,
    { expiresIn, algorithm: "HS256" }
  );
};

const otpStore = new Map<string, { otp: string; expiresAt: Date }>();

export const sendOTP = async (req: Request, res: Response) => {
  const { mobile } = req.body;

  if (!mobile || !/^\d{10}$/.test(mobile)) {
    return res.status(400).json({ message: 'Invalid mobile number' });
  }

  // Generate 6-digit OTP
  const otp = crypto.randomInt(100000, 999999).toString();

  // Store OTP with 5-minute expiry
  otpStore.set(mobile, {
    otp,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000)
  });

  await sendOtp(mobile, otp);

  res.json({
    message: 'OTP sent successfully',
    mobile
  });
};

export const customerLogin = async (req: Request, res: Response) => {
  const { mobile, otp } = req.body;

  // Validate input (also guards against a non-string body field being
  // passed straight into a Mongo query further down — see User.findOne
  // below and adminLogin's matching guard).
  if (typeof mobile !== 'string' || typeof otp !== 'string' || !mobile || !otp) {
    return res.status(400).json({ message: 'Mobile and OTP are required' });
  }

  // Check if OTP exists
  const otpData = otpStore.get(mobile);
  if (!otpData) {
    return res.status(400).json({ message: 'OTP not found or expired' });
  }

  // Check if OTP is expired
  if (new Date() > otpData.expiresAt) {
    otpStore.delete(mobile);
    return res.status(400).json({ message: 'OTP expired' });
  }

  // Verify OTP
  if (otpData.otp !== otp) {
    return res.status(400).json({ message: 'Invalid OTP' });
  }

  // OTP is valid, delete it
  otpStore.delete(mobile);

  // Check if user exists
  let user = await User.findOne({ mobile });

  if (!user) {
    // User doesn't exist - create new account automatically. Try to seed
    // the name from their WhatsApp profile (chat.lapshark.com's Contacts
    // CRM) instead of leaving it blank forever — our own signup never asks.
    user = await User.create({
      mobile,
      name: (await getContactName(mobile)) || undefined,
      role: 'customer',
      // Optional: set a flag to indicate profile is incomplete
      isProfileComplete: false
    });
  } else if (!user.name) {
    // Existing account that still has no name (e.g. signed up before they'd
    // ever messaged the business) — retry the same backfill on login.
    const name = await getContactName(mobile);
    if (name) {
      user.name = name;
      await user.save();
    }
  }

  // Separate update (not user.save()) so a stale/invalid field elsewhere on
  // an old document can never make login fail over a bookkeeping write.
  try {
    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  } catch (err: any) {
    console.error('lastLoginAt update failed:', err.message);
  }

  // Return user data and token
  return res.json({
    success: true,
    isNewUser: !user.name, // or use isProfileComplete flag
    user: {
      _id: user._id,
      name: user.name || '',
      mobile: user.mobile,
      email: user.email || '',
      isProfileComplete: user.isProfileComplete || false,
      token: generateToken({
        id: user._id.toString(),
        name: user.name || "",
        role: "customer",
        tokenVersion: user.tokenVersion || 0
      })

    }
  });
};

// Fixed bcrypt hash of a string nobody will ever type. Compared against on
// every "no such user" attempt so bcrypt.compare always runs and always
// takes real bcrypt time — response time (and, below, response shape) no
// longer lets an attacker tell "no such email" apart from "wrong password",
// which is what made this endpoint an account-enumeration oracle before.
const DUMMY_PASSWORD_HASH = "$2b$10$G1gC4w6oyCdJJr8bN5UKue5Wo6dl1nNXpQO5XUidmF3rwDQ6iDa2u";

export const adminLogin = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  const user = await User.findOne({ email }).select("+password"); // password is select:false on the schema
  const passwordMatch = await bcrypt.compare(password, user?.password || DUMMY_PASSWORD_HASH);

  if (!user || !passwordMatch) {
    logAdminAction({ actor: email, action: "admin.login.failure" });
    return res.status(401).json({ message: "Invalid email or password" });
  }

  // This issues a role: "admin" token below unconditionally — without this
  // check, any user record with a matching email+password (not just real
  // admins) would get one, regardless of their actual role in the DB. Left
  // as its own distinct response (not folded into the generic 401 above):
  // it only fires after a real password match against a real hash, so it
  // doesn't hand an attacker the same enumeration signal the 404/401 split
  // used to.
  if (user.role !== "admin") {
    return res.status(403).json({ message: "Not authorized as admin" });
  }

  logAdminAction({ actorId: user._id.toString(), actor: user.name || email, action: "admin.login.success" });

  return res.json({
    user: {
      _id: user._id,
      name: user.name,
      mobile: user.mobile,
    },
    token: generateToken(
      {
        id: user._id.toString(),
        name: user.name || "",
        role: "admin",
        tokenVersion: user.tokenVersion || 0
      },
      "12h" // shorter than the 30d customer default — see generateToken's comment
    )

  });
};

// Orders that count towards a customer's order count / total spent: paid,
// and not since cancelled, returned to origin, or refunded. Unpaid orders
// are just abandoned checkouts (createOrder saves one per Pay click).
const COUNTED_ORDER_MATCH = {
  paymentStatus: "Paid",
  status: { $nin: ["Cancelled", "RTO"] },
};

export const getUsers = async (req: Request, res: Response) => {
  try {
    // User.ordersCount/totalSpent are schema fields nothing ever updates,
    // so they were always 0 — derive both from the orders themselves.
    const [users, stats] = await Promise.all([
      User.find({}).lean(),
      Order.aggregate<{ _id: mongoose.Types.ObjectId; ordersCount: number; totalSpent: number }>([
        { $match: { ...COUNTED_ORDER_MATCH, userId: { $ne: null } } },
        { $group: { _id: "$userId", ordersCount: { $sum: 1 }, totalSpent: { $sum: "$total" } } },
      ]),
    ]);

    const statsByUser = new Map(stats.map((s) => [s._id.toString(), s]));

    res.json(
      users.map((u) => {
        const s = statsByUser.get(u._id.toString());
        return { ...u, ordersCount: s?.ordersCount ?? 0, totalSpent: s?.totalSpent ?? 0 };
      })
    );
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// Customers who logged in after `since` (ISO string), for the admin panel's
// login popup. `since` is clamped to the last hour so a stale or missing
// value can't return a backlog. serverTime is returned so the client can
// use it as the next `since` without depending on its own clock.
const RECENT_LOGINS_MAX_WINDOW_MS = 60 * 60 * 1000;

export const getRecentLogins = async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const floor = now.getTime() - RECENT_LOGINS_MAX_WINDOW_MS;
    const sinceParam = typeof req.query.since === 'string' ? Date.parse(req.query.since) : NaN;

    // No `since` = first poll: just hand back the server clock.
    if (Number.isNaN(sinceParam)) {
      return res.json({ serverTime: now.toISOString(), logins: [] });
    }

    const since = new Date(Math.max(sinceParam, floor));
    const logins = await User.find(
      { role: 'customer', lastLoginAt: { $gt: since, $lte: now } },
      { name: 1, mobile: 1, email: 1, lastLoginAt: 1, createdAt: 1 }
    )
      .sort({ lastLoginAt: 1 })
      .limit(20)
      .lean();

    res.json({ serverTime: now.toISOString(), logins });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const blockUser = async (req: Request, res: Response) => {
  const user = await User.findById(req.params.id);
  if (user) {
    user.status = user.status === 'blocked' ? 'active' : 'blocked';
    await user.save();
    const actor = (req as any).user;
    logAdminAction({
      actorId: actor?.id,
      actor: actor?.name || 'admin',
      action: user.status === 'blocked' ? 'user.block' : 'user.unblock',
      targetType: 'User',
      targetId: user._id.toString(),
    });
    res.json(user);
  } else {
    res.status(404).json({ message: 'User not found' });
  }
};

// Invalidates every existing token for this user (see tokenVersion comment
// on the User model + the check in authMiddleware.protect) — the account
// stays active and they can log back in immediately with a fresh OTP, this
// just ends whatever session(s) are currently active on any device.
export const forceLogoutUser = async (req: Request, res: Response) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { $inc: { tokenVersion: 1 } },
    { new: true }
  );
  if (user) {
    const actor = (req as any).user;
    logAdminAction({
      actorId: actor?.id,
      actor: actor?.name || 'admin',
      action: 'user.force_logout',
      targetType: 'User',
      targetId: user._id.toString(),
    });
    res.json({ success: true, tokenVersion: user.tokenVersion });
  } else {
    res.status(404).json({ message: 'User not found' });
  }
};

// =========================================================
// 1️⃣ ADD NEW ADDRESS
// =========================================================
export const addAddress = async (req: Request, res: Response) => {
  try {
    const { name, street, city, state, zip, phone, type } = req.body;

    const newAddress = {
      id: `addr_${Date.now()}`,
      name,
      street,
      city,
      state,
      zip,
      phone,
      type
    };

    const user = await User.findByIdAndUpdate(
      (req as any).user?.id,
      {
        $push: { addressBook: newAddress },
        isProfileComplete: true,
        defaultAddressId: newAddress.id
      },
      { new: true }
    );

    res.json({ success: true, user });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};


// =========================================================
// 2️⃣ UPDATE A SPECIFIC ADDRESS
// =========================================================
export const updateAddress = async (req: Request, res: Response) => {
  try {
    const { addressId } = req.params;
    const updatedData = req.body;

    const user = await User.findOneAndUpdate(
      { _id: (req as any).user?.id, "addressBook.id": addressId },
      {
        $set: {
          "addressBook.$.name": updatedData.name,
          "addressBook.$.street": updatedData.street,
          "addressBook.$.city": updatedData.city,
          "addressBook.$.state": updatedData.state,
          "addressBook.$.zip": updatedData.zip,
          "addressBook.$.phone": updatedData.phone,
          "addressBook.$.type": updatedData.type
        }
      },
      { new: true }
    );

    res.json({ success: true, user });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};


// =========================================================
// 3️⃣ DELETE ADDRESS
// =========================================================
export const deleteAddress = async (req: Request, res: Response) => {
  try {
    const { addressId } = req.params;
    const userId = (req as any).user?.id; // adapt to your auth middleware

    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Defensive: ensure addressBook is an array
    user.addressBook = Array.isArray(user.addressBook) ? user.addressBook : [];

    // Remove address
    const beforeCount = user.addressBook.length;
    user.addressBook = user.addressBook.filter(a => a.id !== addressId);

    if (user.addressBook.length === beforeCount) {
      // No address removed
      return res.status(404).json({ message: "Address not found" });
    }

    // If the removed address was the default, pick a new default (or null)
    if (user.defaultAddressId === addressId) {
      user.defaultAddressId = user.addressBook[0]?.id ?? null;
    }

    await user.save();

    res.json({ success: true, user });
  } catch (err: any) {
    console.error("deleteAddress error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
};


// =========================================================
// 4️⃣ SET DEFAULT ADDRESS
// =========================================================
export const setDefaultAddress = async (req: Request, res: Response) => {
  try {
    const { addressId } = req.params;

    const user = await User.findByIdAndUpdate(
      (req as any).user?.id,
      { defaultAddressId: addressId },
      { new: true }
    );

    res.json({ success: true, user });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};


// =========================================================
// 5️⃣ GET ALL ADDRESSES
// =========================================================
export const getAddresses = async (req: Request, res: Response) => {
  try {
    const user = await User.findById((req as any).user?.id);

    res.json({
      success: true,
      addresses: user?.addressBook || [],
      defaultAddressId: user?.defaultAddressId || null
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};


export const updateProfile = async (req: Request, res: Response) => {
  try {
    const { name, mobile, email } = req.body;
    const userId = (req as any).user?.id;

    const user = await User.findByIdAndUpdate(
      userId,
      { name, mobile, email },
      { new: true }
    );

    res.json({ success: true, user });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
