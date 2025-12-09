import mongoose, { Document, Schema } from 'mongoose';
export interface Address {
  id: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  type: 'Home' | 'Work' | 'Other';
}

export interface IUser extends Document {
  name: string;
  email?: string;
  password?: string;
  mobile: string;
  role: 'admin' | 'customer';
  phone?: string;
  addressBook?: Address[];
  defaultAddressId?: string;
  isProfileComplete: boolean;
  totalSpent: number;
  ordersCount: number;
  status: 'active' | 'blocked';
}
export const AddressSchema = new Schema<Address>(
  {
    id: { type: String },
    name: { type: String },
    street: { type: String },
    city: { type: String },
    state: { type: String },
    zip: { type: String },
    phone: { type: String },
    type: { type: String, enum: ['Home', 'Work', 'Other'], default: 'Home' }
  },
  { _id: false }
);

const UserSchema: Schema = new Schema({
  name: { type: String },
  email: { type: String, unique: true, sparse: true },
  password: { type: String },
  role: { type: String, enum: ['admin', 'customer'], default: 'customer' },
  phone: { type: String },
  mobile: { type: String, required: true, unique: true },
  addressBook: { type: [AddressSchema], default: [] },
  defaultAddressId: { type: String, default: null },
  isProfileComplete: { type: Boolean, default: false },
  totalSpent: { type: Number, default: 0 },
  ordersCount: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'blocked'], default: 'active' }
}, {
  timestamps: true
});

export default mongoose.model<IUser>('User', UserSchema);