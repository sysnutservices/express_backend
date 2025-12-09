import { Request, Response } from 'express';
import User from '../models/User';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { sendOtp } from '../services/wa';

const generateToken = (user: { id: string; name: string; role: string }) => {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      role: user.role,
    },
    process.env.JWT_SECRET as string,
    { expiresIn: "30d" }
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

  console.log(`OTP for ${mobile}: ${otp}`);

  res.json({
    message: 'OTP sent successfully',
    mobile
  });
};

export const customerLogin = async (req: Request, res: Response) => {
  const { mobile, otp } = req.body;

  // Validate input
  if (!mobile || !otp) {
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
    // User doesn't exist - create new account automatically
    user = await User.create({
      mobile,
      role: 'customer',
      // Optional: set a flag to indicate profile is incomplete
      isProfileComplete: false
    });
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
        role: "customer"
      })

    }
  });
};

export const adminLogin = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  const user = await User.findOne({ email });
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  const passwordMatch = await bcrypt.compare(password, user.password as string);
  if (!passwordMatch) {
    return res.status(401).json({ message: 'Invalid password' });
  }

  return res.json({
    user: {
      _id: user._id,
      name: user.name,
      mobile: user.mobile,
    },
    token: generateToken({
      id: user._id.toString(),
      name: user.name || "",
      role: "admin"
    })

  });
};

export const getUsers = async (req: Request, res: Response) => {
  const users = await User.find({});
  res.json(users);
};

export const blockUser = async (req: Request, res: Response) => {
  const user = await User.findById(req.params.id);
  if (user) {
    user.status = user.status === 'blocked' ? 'active' : 'blocked';
    await user.save();
    res.json(user);
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
