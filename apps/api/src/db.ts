import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
// DATE has no time zone: preserve the literal calendar date on external PostgreSQL.
pg.types.setTypeParser(1082, (value) => value);
import { mkdir } from "node:fs/promises";
export type Row = Record<string, any>;
export interface Database {
  query<T extends Row = Row>(
    sql: string,
    params?: any[],
  ): Promise<{ rows: T[] }>;
  transaction<T>(fn: (db: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function connectDatabase(
  url = process.env.DATABASE_URL,
  memory = false,
): Promise<Database> {
  if (url) {
    const pool = new pg.Pool({ connectionString: url });
    const wrap = (client: pg.Pool | pg.PoolClient): Database => ({
      query: async (sql, params) => await client.query(sql, params),
      transaction: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const result = await fn(wrap(c));
          await c.query("COMMIT");
          return result;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
      close: () => pool.end(),
    });
    return wrap(pool);
  }
  const dataDirectory = process.env.DATA_DIRECTORY || ".data/postgres";
  if (!memory) await mkdir(dataDirectory, { recursive: true });
  const engine = new PGlite(memory ? undefined : dataDirectory);
  const wrap = (client: any): Database => ({
    query: (sql, params = []) => client.query(sql, params),
    transaction: (fn) => engine.transaction((tx) => fn(wrap(tx))),
    close: () => engine.close(),
  });
  return wrap(engine);
}
export async function migrateV1(db: Database) {
  await db.query(
    `CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('owner','receptionist')))`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TIMESTAMPTZ NOT NULL)`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY,name TEXT NOT NULL,document TEXT UNIQUE NOT NULL,email TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',archived BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY,name TEXT NOT NULL,activity TEXT NOT NULL,price_cents INTEGER NOT NULL CHECK(price_cents>0),duration_days INTEGER NOT NULL CHECK(duration_days BETWEEN 1 AND 730),active BOOLEAN NOT NULL DEFAULT true)`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),plan_id TEXT NOT NULL REFERENCES plans(id),starts_on DATE NOT NULL,ends_on DATE NOT NULL CHECK(ends_on>starts_on))`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),subscription_id TEXT NOT NULL REFERENCES subscriptions(id),amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),discount_cents INTEGER NOT NULL CHECK(discount_cents>=0),method TEXT NOT NULL CHECK(method IN ('cash','transfer')),created_by TEXT NOT NULL REFERENCES users(id),request_key TEXT UNIQUE NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS expenses(id TEXT PRIMARY KEY,description TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>0),method TEXT NOT NULL CHECK(method IN ('cash','transfer')),created_by TEXT NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  );
  await db.query(
    "CREATE INDEX IF NOT EXISTS subscription_member ON subscriptions(member_id,ends_on)",
  );
}

export async function migrateV2(db: Database) {
  await migrateV1(db);
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_versions(version INTEGER PRIMARY KEY)",
  );
  if (
    (await db.query("SELECT version FROM schema_versions WHERE version=2")).rows
      .length
  )
    return;
  await db.transaction(async (tx) => {
    const statements = [
      `CREATE TABLE accounts(id TEXT PRIMARY KEY,name TEXT NOT NULL,trial_until DATE NOT NULL,paid_until DATE,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
      `CREATE TABLE gyms(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),name TEXT NOT NULL,address TEXT NOT NULL DEFAULT '')`,
      `INSERT INTO accounts(id,name,trial_until) VALUES('legacy-account','Mi organización',CURRENT_DATE+14)`,
      `INSERT INTO gyms(id,account_id,name) VALUES('legacy-gym','legacy-account','Mi gimnasio')`,
      `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`,
      `ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('owner','receptionist','trainer'))`,
      `ALTER TABLE users ADD COLUMN account_id TEXT REFERENCES accounts(id)`,
      `ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE users ADD COLUMN address TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE users ADD COLUMN active BOOLEAN NOT NULL DEFAULT true`,
      `ALTER TABLE users ADD COLUMN permissions JSONB NOT NULL DEFAULT '[]'::jsonb`,
      `UPDATE users SET account_id='legacy-account' WHERE account_id IS NULL`,
      `CREATE TABLE staff_gyms(user_id TEXT REFERENCES users(id),gym_id TEXT REFERENCES gyms(id),PRIMARY KEY(user_id,gym_id))`,
      `INSERT INTO staff_gyms SELECT id,'legacy-gym' FROM users WHERE role<>'owner'`,
      `UPDATE users SET permissions='["members.read","members.write","payments.write","plans.read","products.read","sales.write"]'::jsonb WHERE role='receptionist'`,
      ...["members", "plans", "subscriptions", "payments", "expenses"].flatMap(
        (t) => [
          `ALTER TABLE ${t} ADD COLUMN gym_id TEXT REFERENCES gyms(id)`,
          `UPDATE ${t} SET gym_id='legacy-gym' WHERE gym_id IS NULL`,
        ],
      ),
      `ALTER TABLE members DROP CONSTRAINT IF EXISTS members_document_key`,
      `CREATE UNIQUE INDEX members_gym_document ON members(gym_id,document)`,
      `ALTER TABLE members ADD COLUMN address TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE members ADD COLUMN emergency_name TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE members ADD COLUMN emergency_phone TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE plans ADD COLUMN duration_unit TEXT NOT NULL DEFAULT 'month' CHECK(duration_unit IN ('month','days'))`,
      `UPDATE plans SET duration_unit='days' WHERE duration_days<>30`,
      `ALTER TABLE subscriptions ADD COLUMN anchor_day INTEGER NOT NULL DEFAULT 1 CHECK(anchor_day BETWEEN 1 AND 31)`,
      `UPDATE subscriptions SET anchor_day=EXTRACT(DAY FROM starts_on)::integer`,
      `CREATE TABLE member_activities(member_id TEXT REFERENCES members(id),plan_id TEXT REFERENCES plans(id),PRIMARY KEY(member_id,plan_id))`,
      `INSERT INTO member_activities SELECT DISTINCT member_id,plan_id FROM subscriptions`,
      `CREATE TABLE promotions(id TEXT PRIMARY KEY,gym_id TEXT NOT NULL REFERENCES gyms(id),name TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('two_for_one','combo','discount')),discount_type TEXT NOT NULL CHECK(discount_type IN ('percent','fixed')),value INTEGER NOT NULL CHECK(value>=0),plan_ids JSONB NOT NULL DEFAULT '[]'::jsonb,starts_on DATE,ends_on DATE,active BOOLEAN NOT NULL DEFAULT true)`,
      `CREATE TABLE orders(id TEXT PRIMARY KEY,gym_id TEXT NOT NULL REFERENCES gyms(id),request_key TEXT UNIQUE NOT NULL,fingerprint TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),promotion_name TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
      `ALTER TABLE payments ADD COLUMN order_id TEXT REFERENCES orders(id)`,
      `ALTER TABLE payments ADD COLUMN activity_snapshot TEXT`,
      `ALTER TABLE payments ADD COLUMN plan_snapshot TEXT`,
      `UPDATE payments SET activity_snapshot=p.activity,plan_snapshot=p.name FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE payments.subscription_id=s.id`,
      `CREATE TABLE products(id TEXT PRIMARY KEY,gym_id TEXT NOT NULL REFERENCES gyms(id),name TEXT NOT NULL,category TEXT NOT NULL,price_cents INTEGER NOT NULL CHECK(price_cents>0),cost_cents INTEGER NOT NULL CHECK(cost_cents>=0),stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),active BOOLEAN NOT NULL DEFAULT true)`,
      `CREATE TABLE sales(id TEXT PRIMARY KEY,gym_id TEXT NOT NULL REFERENCES gyms(id),product_id TEXT NOT NULL REFERENCES products(id),product_snapshot TEXT NOT NULL,category_snapshot TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),amount_cents INTEGER NOT NULL CHECK(amount_cents>0),cost_cents INTEGER NOT NULL CHECK(cost_cents>=0),method TEXT NOT NULL CHECK(method IN ('cash','transfer')),created_by TEXT NOT NULL REFERENCES users(id),request_key TEXT UNIQUE NOT NULL,fingerprint TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
      `CREATE TABLE inventory_movements(id TEXT PRIMARY KEY,gym_id TEXT NOT NULL REFERENCES gyms(id),product_id TEXT NOT NULL REFERENCES products(id),quantity INTEGER NOT NULL,reason TEXT NOT NULL,request_key TEXT UNIQUE,fingerprint TEXT,created_by TEXT NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
      `ALTER TABLE expenses ADD COLUMN category TEXT NOT NULL DEFAULT 'General'`,
      `CREATE TABLE billing_orders(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),amount_cents INTEGER NOT NULL CHECK(amount_cents>0),preference_id TEXT,status TEXT NOT NULL DEFAULT 'pending',provider_payment_id TEXT UNIQUE,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
      `CREATE TABLE billing_receipts(payment_id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),order_id TEXT NOT NULL REFERENCES billing_orders(id),starts_on DATE NOT NULL,ends_on DATE NOT NULL,anchor_day INTEGER NOT NULL CHECK(anchor_day BETWEEN 1 AND 31),status TEXT NOT NULL DEFAULT 'approved')`,
      `CREATE INDEX payments_gym_date ON payments(gym_id,created_at)`,
      `CREATE INDEX sales_gym_date ON sales(gym_id,created_at)`,
      `CREATE INDEX expenses_gym_date ON expenses(gym_id,created_at)`,
      `INSERT INTO schema_versions VALUES(2)`,
    ];
    for (const sql of statements) await tx.query(sql);
  });
}

export async function migrateV3(db: Database) {
  await migrateV2(db);
  if (
    (await db.query("SELECT version FROM schema_versions WHERE version=3")).rows
      .length
  )
    return;
  await db.transaction(async (tx) => {
    for (const sql of [
      `ALTER TABLE promotions ADD COLUMN member_ids JSONB NOT NULL DEFAULT '[]'::jsonb`,
      `CREATE TABLE product_operations(request_key TEXT PRIMARY KEY,gym_id TEXT NOT NULL REFERENCES gyms(id),fingerprint TEXT NOT NULL,product_id TEXT NOT NULL REFERENCES products(id))`,
      `CREATE TABLE service_quotes(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),usd_cents INTEGER NOT NULL CHECK(usd_cents>0),ars_cents INTEGER NOT NULL CHECK(ars_cents>0),rate_micro BIGINT NOT NULL CHECK(rate_micro>0),source TEXT NOT NULL,rate_as_of TIMESTAMPTZ NOT NULL,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
      `ALTER TABLE billing_orders ADD COLUMN quote_id TEXT UNIQUE REFERENCES service_quotes(id)`,
      `ALTER TABLE billing_orders ADD COLUMN usd_cents INTEGER`,
      `ALTER TABLE billing_orders ADD COLUMN rate_micro BIGINT`,
      `ALTER TABLE billing_orders ADD COLUMN fx_source TEXT`,
      `ALTER TABLE billing_orders ADD COLUMN fx_as_of TIMESTAMPTZ`,
      `ALTER TABLE billing_orders ADD COLUMN init_point TEXT`,
      `ALTER TABLE billing_orders ADD COLUMN recipient_alias TEXT`,
      `ALTER TABLE billing_orders ADD COLUMN recipient_cvu TEXT`,
      `INSERT INTO schema_versions VALUES(3)`,
    ])
      await tx.query(sql);
  });
}

async function migrateV4(db: Database) {
  await migrateV3(db);
  if (
    (await db.query("SELECT version FROM schema_versions WHERE version=4")).rows
      .length
  )
    return;
  await db.transaction(async (tx) => {
    for (const sql of [
      `CREATE TABLE account_settings(account_id TEXT PRIMARY KEY REFERENCES accounts(id),modules JSONB NOT NULL DEFAULT '{"products":false,"promotions":false,"multi_gym":false}'::jsonb)`,
      `INSERT INTO account_settings(account_id,modules) SELECT id,'{"products":true,"promotions":true,"multi_gym":true}'::jsonb FROM accounts`,
      `ALTER TABLE products ADD COLUMN low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK(low_stock_threshold>=0)`,
      ...["payments", "sales", "expenses", "orders"].flatMap((t) => [
        `ALTER TABLE ${t} ADD COLUMN voided_at TIMESTAMPTZ`,
        `ALTER TABLE ${t} ADD COLUMN void_reason TEXT NOT NULL DEFAULT ''`,
        `ALTER TABLE ${t} ADD COLUMN voided_by TEXT REFERENCES users(id)`,
      ]),
      `ALTER TABLE subscriptions ADD COLUMN cancelled_at TIMESTAMPTZ`,
      `CREATE TABLE void_events(id TEXT PRIMARY KEY,gym_id TEXT NOT NULL REFERENCES gyms(id),kind TEXT NOT NULL CHECK(kind IN ('payment','sale','expense')),target_id TEXT NOT NULL,reason TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(gym_id,kind,target_id))`,
      `CREATE TABLE audit_logs(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),gym_id TEXT REFERENCES gyms(id),actor_id TEXT REFERENCES users(id),action TEXT NOT NULL,details JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
      `CREATE TABLE member_registrations(request_key TEXT PRIMARY KEY,gym_id TEXT NOT NULL REFERENCES gyms(id),fingerprint TEXT NOT NULL,response JSONB NOT NULL)`,
      `CREATE TABLE import_batches(id TEXT PRIMARY KEY,gym_id TEXT NOT NULL REFERENCES gyms(id),created_by TEXT NOT NULL REFERENCES users(id),rows JSONB NOT NULL,status TEXT NOT NULL DEFAULT 'pending',result JSONB,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
      `CREATE TABLE password_resets(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
      `CREATE TABLE backup_runs(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),file_name TEXT NOT NULL,sha256 TEXT NOT NULL,size_bytes INTEGER NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
      `INSERT INTO schema_versions VALUES(4)`,
    ])
      await tx.query(sql);
  });
}

export async function migrate(db: Database) {
  await migrateV4(db);
  if (
    (await db.query("SELECT version FROM schema_versions WHERE version=5")).rows
      .length
  )
    return;
  await db.transaction(async (tx) => {
    for (const sql of [
      `CREATE TABLE payment_methods(id TEXT PRIMARY KEY,gym_id TEXT NOT NULL REFERENCES gyms(id),name TEXT NOT NULL,method TEXT NOT NULL CHECK(method IN ('cash','transfer')),active BOOLEAN NOT NULL DEFAULT true,UNIQUE(gym_id,name))`,
      ...["payments", "sales", "expenses"].flatMap((t) => [
        `ALTER TABLE ${t} ADD COLUMN method_name TEXT NOT NULL DEFAULT ''`,
        `ALTER TABLE ${t} ADD COLUMN reference TEXT NOT NULL DEFAULT ''`,
      ]),
      `ALTER TABLE expenses ADD COLUMN request_key TEXT UNIQUE`,
      `ALTER TABLE expenses ADD COLUMN fingerprint TEXT`,
      `CREATE TABLE pending_payments(id TEXT PRIMARY KEY,gym_id TEXT NOT NULL REFERENCES gyms(id),member_id TEXT NOT NULL REFERENCES members(id),request_key TEXT UNIQUE NOT NULL,fingerprint TEXT NOT NULL,payload JSONB NOT NULL,amount_cents INTEGER NOT NULL,method_name TEXT NOT NULL,reference TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected')),order_id TEXT REFERENCES orders(id),verification TEXT,provider_payment_id TEXT UNIQUE,reason TEXT NOT NULL DEFAULT '',created_by TEXT NOT NULL REFERENCES users(id),reviewed_by TEXT REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),reviewed_at TIMESTAMPTZ)`,
      `CREATE TABLE member_photos(member_id TEXT PRIMARY KEY REFERENCES members(id),gym_id TEXT NOT NULL REFERENCES gyms(id),image_base64 TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
      `CREATE TABLE access_credentials(member_id TEXT PRIMARY KEY REFERENCES members(id),gym_id TEXT NOT NULL REFERENCES gyms(id),token_hash TEXT UNIQUE NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
      `CREATE TABLE checkins(id TEXT PRIMARY KEY,gym_id TEXT NOT NULL REFERENCES gyms(id),member_id TEXT REFERENCES members(id),activity TEXT NOT NULL DEFAULT '',allowed BOOLEAN NOT NULL,reason TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),request_key TEXT UNIQUE NOT NULL,fingerprint TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
      `CREATE TABLE cash_counts(id TEXT PRIMARY KEY,gym_id TEXT NOT NULL REFERENCES gyms(id),day DATE NOT NULL,opening_cents INTEGER NOT NULL,rows JSONB NOT NULL,movements_hash TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',created_by TEXT NOT NULL REFERENCES users(id),request_key TEXT UNIQUE NOT NULL,fingerprint TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
      `CREATE INDEX subscriptions_member_period ON subscriptions(member_id,plan_id,ends_on) WHERE cancelled_at IS NULL`,
      `CREATE INDEX checkins_gym_date ON checkins(gym_id,created_at DESC)`,
      `CREATE INDEX pending_payments_gym_status ON pending_payments(gym_id,status,created_at DESC)`,
      `INSERT INTO schema_versions VALUES(5)`,
    ])
      await tx.query(sql);
  });
}
