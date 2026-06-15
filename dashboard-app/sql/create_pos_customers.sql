-- ============================================================
-- pos_customers: Restaurant guest/customer profiles
-- Primary identifier: phone (WhatsApp culture in MX)
-- NOT the same as `clients` table (multi-tenant config)
-- ============================================================

CREATE TABLE IF NOT EXISTS pos_customers (
  id           bigserial    PRIMARY KEY,
  client_id    text         NOT NULL DEFAULT 'amalay',
  name         text         NOT NULL,
  phone        text,
  email        text,
  notes        text,
  total_visits integer      NOT NULL DEFAULT 0,
  total_spent  numeric      NOT NULL DEFAULT 0,
  avg_ticket   numeric      NOT NULL DEFAULT 0,
  last_visit   timestamptz,
  first_visit  timestamptz  NOT NULL DEFAULT now(),
  tags         text[]       DEFAULT '{}',
  birthday     date,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  UNIQUE(client_id, phone)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_pos_customers_client_id ON pos_customers(client_id);
CREATE INDEX IF NOT EXISTS idx_pos_customers_phone ON pos_customers(client_id, phone);
CREATE INDEX IF NOT EXISTS idx_pos_customers_last_visit ON pos_customers(client_id, last_visit DESC);

-- RLS: anon can SELECT, INSERT, UPDATE (no DELETE — Eduardo's rule)
ALTER TABLE pos_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pos_customers_select" ON pos_customers
  FOR SELECT TO anon USING (true);

CREATE POLICY "pos_customers_insert" ON pos_customers
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "pos_customers_update" ON pos_customers
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ============================================================
-- pos_customer_visits: Audit trail of every visit/order
-- Links customer to pos_orders. No UPDATE, no DELETE.
-- ============================================================

CREATE TABLE IF NOT EXISTS pos_customer_visits (
  id           bigserial    PRIMARY KEY,
  client_id    text         NOT NULL DEFAULT 'amalay',
  customer_id  bigint       NOT NULL REFERENCES pos_customers(id),
  order_id     uuid,
  amount       numeric      NOT NULL DEFAULT 0,
  items_count  integer      NOT NULL DEFAULT 0,
  visited_at   timestamptz  NOT NULL DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_pos_customer_visits_customer ON pos_customer_visits(customer_id);
CREATE INDEX IF NOT EXISTS idx_pos_customer_visits_client ON pos_customer_visits(client_id);
CREATE INDEX IF NOT EXISTS idx_pos_customer_visits_date ON pos_customer_visits(visited_at DESC);

-- RLS: anon can SELECT and INSERT only (audit trail — no edits, no deletes)
ALTER TABLE pos_customer_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pos_customer_visits_select" ON pos_customer_visits
  FOR SELECT TO anon USING (true);

CREATE POLICY "pos_customer_visits_insert" ON pos_customer_visits
  FOR INSERT TO anon WITH CHECK (true);
