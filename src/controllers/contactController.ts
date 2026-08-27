import { Request, Response } from "express";
import { ContactMessage } from "../models/ContactMessage";
import { sendAdminContactAlert } from "../services/wa";

export const createContactMessage = async (req: Request, res: Response) => {
  try {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ success: false, message: "Name, email, and message are required" });
    }

    const doc = await ContactMessage.create({ name, email, subject, message });

    // Best-effort: a missing/failing WhatsApp alert must not make the
    // customer think their message wasn't received — it was, it's already
    // saved above. See sendAdminContactAlert's own no-op-until-configured
    // comment in services/wa.ts.
    try {
      await sendAdminContactAlert(name, email, message);
    } catch (err: any) {
      console.error("Contact form WhatsApp alert failed (message still saved):", err.message);
    }

    res.status(201).json({ success: true, id: doc._id });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Admin inbox — newest first, capped like the other admin list endpoints.
export const getContactMessages = async (req: Request, res: Response) => {
  try {
    const messages = await ContactMessage.find({}).sort({ createdAt: -1 }).limit(500);
    res.json(messages);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateContactMessageStatus = async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (!["new", "read", "replied"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }
    const doc = await ContactMessage.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: "Message not found" });
    res.json({ success: true, message: doc });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};
