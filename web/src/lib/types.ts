export type UserRole = "student" | "vendor" | "admin";
export type PaymentMode = "online" | "offline";
export type PaymentStatus = "pending" | "paid" | "pay_at_counter" | "failed" | "refunded";
export type OrderStatus =
  | "pending_payment"
  | "placed"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled";

export interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  role: UserRole;
}

export interface Stall {
  id: string;
  owner_id: string | null;
  name: string;
  description: string | null;
  cuisine: string | null;
  location: string | null;
  image_url: string | null;
  is_open: boolean;
  avg_prep_mins: number;
}

export interface MenuItem {
  id: string;
  stall_id: string;
  name: string;
  description: string | null;
  category: string;
  price_paise: number;
  is_veg: boolean;
  is_available: boolean;
  image_url: string | null;
  sort_order: number;
}

export interface OrderItem {
  id: string;
  name: string;
  unit_price_paise: number;
  quantity: number;
  line_total_paise: number;
}

export interface Order {
  id: string;
  user_id: string;
  stall_id: string;
  token_no: number | null;
  token_day: string | null;
  status: OrderStatus;
  payment_mode: PaymentMode;
  payment_status: PaymentStatus;
  subtotal_paise: number;
  fee_percent: number;
  fee_paise: number;
  total_paise: number;
  note: string | null;
  created_at: string;
  updated_at: string;
  stalls?: Pick<Stall, "name" | "location"> | null;
  order_items?: OrderItem[];
}

export interface PlatformSettings {
  online_fee_percent: number;
  offline_fee_percent: number;
}
