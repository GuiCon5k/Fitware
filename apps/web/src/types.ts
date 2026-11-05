export type Modules = {
  products: boolean;
  promotions: boolean;
  multi_gym: boolean;
};
export type VoidTarget = { id: string; kind: string; description: string };
export type Role = "owner" | "receptionist" | "trainer";
export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  account_id: string;
  phone: string;
  address: string;
  permissions: string[];
};
export type Gym = {
  id: string;
  account_id: string;
  name: string;
  address: string;
};
export type Subscription = {
  id: string;
  plan_id: string;
  plan_name: string;
  activity: string;
  starts_on: string;
  ends_on: string;
};
export type Member = {
  id: string;
  name: string;
  document: string;
  email: string;
  phone: string;
  notes: string;
  address: string;
  emergency_name: string;
  emergency_phone: string;
  plan_ids: string[];
  subscriptions: Subscription[];
};
export type Plan = {
  id: string;
  name: string;
  activity: string;
  price_cents: number;
  duration_unit: "month" | "days";
  duration_days: number;
  active: boolean;
};
export type Payment = {
  member_id?: string;
  voided_at?: string;
  void_reason?: string;
  id: string;
  member_name: string;
  plan_name: string;
  amount_cents: number;
  discount_cents: number;
  method: "cash" | "transfer";
  created_at: string;
  promotion_name: string;
  order_id: string;
};
export type Product = {
  id: string;
  name: string;
  category: string;
  price_cents: number;
  cost_cents: number;
  stock: number;
  low_stock_threshold?: number;
  active: boolean;
};
export type Promotion = {
  member_ids: string[];
  beneficiaries: { id: string; name: string }[];
  id: string;
  name: string;
  kind: "two_for_one" | "combo" | "discount";
  discount_type: "percent" | "fixed";
  value: number;
  plan_ids: string[];
  starts_on: string | null;
  ends_on: string | null;
  active: boolean;
};
export type Staff = User & { active: boolean; gym_ids: string[] };
export type Billing = {
  enabled: boolean;
  configured: boolean;
  usd_cents: number;
  recipient: {
    alias: string;
    cvu: string;
    currency: string;
    verification: string;
  };
  active: boolean;
  until: string;
  paid: boolean;
  account_name: string;
  receipts: {
    payment_id: string;
    starts_on: string;
    ends_on: string;
    status: string;
  }[];
};
export type ReportRow = {
  name: string;
  kind: string;
  income_cents: number;
  expense_cents: number;
  balance_cents: number;
  cost_of_sales_cents: number;
  transactions: number;
  active_members: number;
};
export type Report = {
  from: string;
  to: string;
  income_cents: number;
  expense_cents: number;
  balance_cents: number;
  cost_of_sales_cents: number;
  rows: ReportRow[];
  movements: {
    id: string;
    type: string;
    description: string;
    amount_cents: number;
    method: "cash" | "transfer";
    created_at: string;
    gym_id?: string;
    voided_at?: string;
    void_reason?: string;
  }[];
  daily: { day: string; income_cents: number; expense_cents: number }[];
  activity_definition: string;
};
export type Dashboard = {
  upcoming?: {
    member_id: string;
    name: string;
    phone: string;
    activity: string;
    plan_name: string;
    ends_on: string;
  }[];
  low_stock?: {
    id: string;
    name: string;
    stock: number;
    low_stock_threshold: number;
  }[];
  day: string;
  members: number;
  active: number;
  month_income: number;
  today_income: number;
};
export type Quote = {
  gross_cents: number;
  discount_cents: number;
  total_cents: number;
  promotion_name: string;
  lines: {
    member_id: string;
    member_name: string;
    plan: Plan;
    starts_on?: string;
    ends_on?: string;
    amount_cents: number;
    discount_cents: number;
  }[];
};

export type ServiceQuote = {
  id: string;
  usd_cents: number;
  ars_cents: number;
  rate: number;
  rate_micro: number;
  source: string;
  rate_as_of: string;
  expires_at: string;
  recipient: {
    alias: string;
    cvu: string;
    currency: string;
    verification: string;
  };
};
