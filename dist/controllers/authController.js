"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateProfile = exports.getAddresses = exports.setDefaultAddress = exports.deleteAddress = exports.updateAddress = exports.addAddress = exports.blockUser = exports.getUsers = exports.adminLogin = exports.customerLogin = exports.sendOTP = void 0;
const User_1 = __importDefault(require("../models/User"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const wa_1 = require("../services/wa");
const generateToken = (user) => {
    return jsonwebtoken_1.default.sign({
        id: user.id,
        name: user.name,
        role: user.role,
    }, process.env.JWT_SECRET, { expiresIn: "30d" });
};
const otpStore = new Map();
const sendOTP = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { mobile } = req.body;
    if (!mobile || !/^\d{10}$/.test(mobile)) {
        return res.status(400).json({ message: 'Invalid mobile number' });
    }
    // Generate 6-digit OTP
    const otp = crypto_1.default.randomInt(100000, 999999).toString();
    // Store OTP with 5-minute expiry
    otpStore.set(mobile, {
        otp,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    });
    yield (0, wa_1.sendOtp)(mobile, otp);
    console.log(`OTP for ${mobile}: ${otp}`);
    res.json({
        message: 'OTP sent successfully',
        mobile
    });
});
exports.sendOTP = sendOTP;
const customerLogin = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
    let user = yield User_1.default.findOne({ mobile });
    if (!user) {
        // User doesn't exist - create new account automatically
        user = yield User_1.default.create({
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
});
exports.customerLogin = customerLogin;
const adminLogin = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required' });
    }
    const user = yield User_1.default.findOne({ email });
    if (!user) {
        return res.status(404).json({ message: 'User not found' });
    }
    const passwordMatch = yield bcryptjs_1.default.compare(password, user.password);
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
});
exports.adminLogin = adminLogin;
const getUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const users = yield User_1.default.find({});
    res.json(users);
});
exports.getUsers = getUsers;
const blockUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const user = yield User_1.default.findById(req.params.id);
    if (user) {
        user.status = user.status === 'blocked' ? 'active' : 'blocked';
        yield user.save();
        res.json(user);
    }
    else {
        res.status(404).json({ message: 'User not found' });
    }
});
exports.blockUser = blockUser;
// =========================================================
// 1️⃣ ADD NEW ADDRESS
// =========================================================
const addAddress = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
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
        const user = yield User_1.default.findByIdAndUpdate((_a = req.user) === null || _a === void 0 ? void 0 : _a.id, {
            $push: { addressBook: newAddress },
            isProfileComplete: true,
            defaultAddressId: newAddress.id
        }, { new: true });
        res.json({ success: true, user });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.addAddress = addAddress;
// =========================================================
// 2️⃣ UPDATE A SPECIFIC ADDRESS
// =========================================================
const updateAddress = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { addressId } = req.params;
        const updatedData = req.body;
        const user = yield User_1.default.findOneAndUpdate({ _id: (_a = req.user) === null || _a === void 0 ? void 0 : _a.id, "addressBook.id": addressId }, {
            $set: {
                "addressBook.$.name": updatedData.name,
                "addressBook.$.street": updatedData.street,
                "addressBook.$.city": updatedData.city,
                "addressBook.$.state": updatedData.state,
                "addressBook.$.zip": updatedData.zip,
                "addressBook.$.phone": updatedData.phone,
                "addressBook.$.type": updatedData.type
            }
        }, { new: true });
        res.json({ success: true, user });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.updateAddress = updateAddress;
// =========================================================
// 3️⃣ DELETE ADDRESS
// =========================================================
const deleteAddress = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { addressId } = req.params;
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id; // adapt to your auth middleware
        if (!userId)
            return res.status(401).json({ message: "Unauthorized" });
        const user = yield User_1.default.findById(userId);
        if (!user)
            return res.status(404).json({ message: "User not found" });
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
            user.defaultAddressId = (_c = (_b = user.addressBook[0]) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : null;
        }
        yield user.save();
        res.json({ success: true, user });
    }
    catch (err) {
        console.error("deleteAddress error:", err);
        res.status(500).json({ error: err.message || "Server error" });
    }
});
exports.deleteAddress = deleteAddress;
// =========================================================
// 4️⃣ SET DEFAULT ADDRESS
// =========================================================
const setDefaultAddress = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { addressId } = req.params;
        const user = yield User_1.default.findByIdAndUpdate((_a = req.user) === null || _a === void 0 ? void 0 : _a.id, { defaultAddressId: addressId }, { new: true });
        res.json({ success: true, user });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.setDefaultAddress = setDefaultAddress;
// =========================================================
// 5️⃣ GET ALL ADDRESSES
// =========================================================
const getAddresses = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const user = yield User_1.default.findById((_a = req.user) === null || _a === void 0 ? void 0 : _a.id);
        res.json({
            success: true,
            addresses: (user === null || user === void 0 ? void 0 : user.addressBook) || [],
            defaultAddressId: (user === null || user === void 0 ? void 0 : user.defaultAddressId) || null
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getAddresses = getAddresses;
const updateProfile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { name, mobile, email } = req.body;
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
        const user = yield User_1.default.findByIdAndUpdate(userId, { name, mobile, email }, { new: true });
        res.json({ success: true, user });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.updateProfile = updateProfile;
