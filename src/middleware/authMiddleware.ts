import { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
dotenv.config();
import jwt from 'jsonwebtoken';
import User from '../models/User';

interface AuthRequest extends Request {
  user?: any;
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction) => {
  let token;

  if ((req as any).headers.authorization && (req as any).headers.authorization.startsWith('Bearer')) {
    try {
      token = (req as any).headers.authorization.split(' ')[1];
      const decoded: any = jwt.verify(token, process.env.JWT_SECRET as string);
      req.user = await User.findById(decoded.id).select('-password');

      if (!req.user) {
        res.status(401).json({ message: 'Not authorized, user not found' });
        return;
      }
      // tokenVersion mismatch: an admin force-logout bumped it after this
      // token was issued (decoded.tokenVersion is undefined/0 for tokens
      // signed before this field existed — treated the same as 0 on the
      // user record, so pre-existing sessions aren't broken by this change).
      if ((decoded.tokenVersion || 0) !== (req.user.tokenVersion || 0)) {
        res.status(401).json({ message: 'Session expired, please log in again' });
        return;
      }
      // blockUser toggles this, but nothing previously enforced it here —
      // a blocked account's existing token kept working on every request.
      if (req.user.status === 'blocked') {
        res.status(401).json({ message: 'This account has been blocked' });
        return;
      }
      next();
    } catch (error) {
      res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    res.status(401).json({ message: 'Not authorized, no token' });
  }
};

export const admin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role === "admin") {
    return next();
  }
  return res.status(401).json({ message: "Not authorized as admin" });
};

// For endpoints called server-to-server by the abandoned-cart automation
// (wamigo_backend's cron + flow executor) rather than a logged-in Lapshark
// user — protect/admin don't apply since there's no user session at all.
export const internalOnly = (req: Request, res: Response, next: NextFunction) => {
  const key = req.headers["x-internal-key"];
  if (key && key === process.env.INTERNAL_API_KEY) {
    return next();
  }
  return res.status(401).json({ message: "Not authorized" });
};
