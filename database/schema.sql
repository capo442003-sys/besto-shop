-- ============================================================
-- BESTO SHOP — Schéma PostgreSQL complet
-- Devise : GNF | Aucune suppression automatique des données
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------
-- Rôles et utilisateurs
-- ------------------------------------------------------------
CREATE TYPE user_role AS ENUM (
  'administrateur',
  'vendeur',
  'caissier',
  'controleur',
  'gestionnaire',
  'comptable',
  'assistant'
);

CREATE TABLE roles (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  label VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE role_permissions (
  id SERIAL PRIMARY KEY,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  module_code VARCHAR(50) NOT NULL,
  can_view BOOLEAN DEFAULT TRUE,
  can_create BOOLEAN DEFAULT FALSE,
  can_edit BOOLEAN DEFAULT FALSE,
  can_delete BOOLEAN DEFAULT FALSE,
  can_print BOOLEAN DEFAULT TRUE,
  UNIQUE(role_id, module_code)
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(80) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  role user_role NOT NULL DEFAULT 'vendeur',
  employee_id INTEGER,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_roles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, role)
);

CREATE INDEX idx_user_roles_user ON user_roles(user_id);

-- ------------------------------------------------------------
-- Paramètres magasin
-- ------------------------------------------------------------
CREATE TABLE store_settings (
  id SERIAL PRIMARY KEY,
  store_name VARCHAR(200) DEFAULT 'BESTO SHOP',
  logo_url TEXT,
  login_image_1_url TEXT,
  login_image_2_url TEXT,
  login_image_3_url TEXT,
  address TEXT,
  phone VARCHAR(20),
  phone_2 VARCHAR(20),
  phone_3 VARCHAR(20),
  email VARCHAR(100),
  currency VARCHAR(10) DEFAULT 'GNF',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE delivery_points (
  id SERIAL PRIMARY KEY,
  code VARCHAR(10) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Catégories et produits
-- ------------------------------------------------------------
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  reference VARCHAR(50) UNIQUE NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  purchase_price DECIMAL(18,2) DEFAULT 0,
  wholesale_price DECIMAL(18,2) DEFAULT 0,
  retail_price DECIMAL(18,2) DEFAULT 0,
  min_stock DECIMAL(18,3) DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE product_stock (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  delivery_point_id INTEGER NOT NULL REFERENCES delivery_points(id),
  quantity DECIMAL(18,3) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, delivery_point_id)
);

CREATE TABLE stock_movements (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  delivery_point_id INTEGER REFERENCES delivery_points(id),
  movement_type VARCHAR(30) NOT NULL,
  quantity DECIMAL(18,3) NOT NULL,
  quantity_before DECIMAL(18,3),
  quantity_after DECIMAL(18,3),
  reference_type VARCHAR(50),
  reference_id INTEGER,
  notes TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Clients
-- ------------------------------------------------------------
CREATE TYPE client_type AS ENUM ('particulier', 'entreprise', 'etat');

CREATE TABLE clients (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  code VARCHAR(50) NOT NULL,
  contact VARCHAR(20),
  address TEXT,
  client_type client_type NOT NULL DEFAULT 'particulier',
  delivery_point_id INTEGER REFERENCES delivery_points(id),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(code, delivery_point_id)
);

-- ------------------------------------------------------------
-- Fournisseurs
-- ------------------------------------------------------------
CREATE TYPE supplier_status AS ENUM ('entreprise', 'particulier', 'cooperative', 'groupement');

CREATE TABLE supplier_product_types (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE suppliers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  code VARCHAR(60) UNIQUE NOT NULL,
  status supplier_status NOT NULL DEFAULT 'entreprise',
  product_type_id INTEGER REFERENCES supplier_product_types(id),
  address TEXT,
  country VARCHAR(100),
  city VARCHAR(100),
  contact VARCHAR(20),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Employés
-- ------------------------------------------------------------
CREATE TYPE employee_function AS ENUM (
  'vendeur',
  'caissier',
  'vendeur_caissier',
  'controleur',
  'gestionnaire',
  'comptable',
  'assistant',
  'dg'
);

CREATE TABLE employees (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  matricule VARCHAR(60) UNIQUE NOT NULL,
  function employee_function NOT NULL DEFAULT 'vendeur',
  delivery_point_id INTEGER REFERENCES delivery_points(id),
  monthly_salary DECIMAL(18,2) DEFAULT 0,
  address TEXT,
  contact VARCHAR(20),
  hire_date DATE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_employees_delivery_point ON employees(delivery_point_id);

ALTER TABLE users ADD CONSTRAINT fk_users_employee
  FOREIGN KEY (employee_id) REFERENCES employees(id);

CREATE TABLE salary_payments (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, month, year)
);

CREATE TABLE work_schedules (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  schedule_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Ventes — Paniers
-- ------------------------------------------------------------
CREATE TYPE sale_type AS ENUM ('gros', 'detail');
CREATE TYPE cart_status AS ENUM ('en_cours', 'finalise', 'annule');
CREATE TYPE payment_mode AS ENUM ('especes', 'paiement_mobile', 'virement', 'cheque');

CREATE TABLE sales_carts (
  id SERIAL PRIMARY KEY,
  cart_number VARCHAR(50) UNIQUE NOT NULL,
  sale_type sale_type NOT NULL DEFAULT 'detail',
  client_id INTEGER REFERENCES clients(id),
  seller_id INTEGER REFERENCES employees(id),
  delivery_point_id INTEGER REFERENCES delivery_points(id),
  status cart_status DEFAULT 'en_cours',
  total_amount DECIMAL(18,2) DEFAULT 0,
  amount_paid DECIMAL(18,2) DEFAULT 0,
  change_amount DECIMAL(18,2) DEFAULT 0,
  payment_mode payment_mode,
  validated_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cart_payments (
  id SERIAL PRIMARY KEY,
  cart_id INTEGER NOT NULL REFERENCES sales_carts(id) ON DELETE CASCADE,
  amount DECIMAL(18,2) NOT NULL,
  payment_mode payment_mode NOT NULL DEFAULT 'especes',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sale_lines (
  id SERIAL PRIMARY KEY,
  cart_id INTEGER NOT NULL REFERENCES sales_carts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  unit_price DECIMAL(18,2) NOT NULL,
  discount DECIMAL(18,2) DEFAULT 0,
  quantity DECIMAL(18,3) NOT NULL,
  line_total DECIMAL(18,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE proforma_invoices (
  id SERIAL PRIMARY KEY,
  invoice_number VARCHAR(50) UNIQUE NOT NULL,
  cart_id INTEGER NOT NULL REFERENCES sales_carts(id),
  client_id INTEGER REFERENCES clients(id),
  total_amount DECIMAL(18,2) NOT NULL,
  issued_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Bons de commande
-- ------------------------------------------------------------
CREATE TYPE order_status AS ENUM ('en_cours', 'finalise');

CREATE TABLE purchase_orders (
  id SERIAL PRIMARY KEY,
  order_number VARCHAR(50) UNIQUE NOT NULL,
  client_id INTEGER REFERENCES clients(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  status order_status DEFAULT 'en_cours',
  total_amount DECIMAL(18,2) DEFAULT 0,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  finalized_at TIMESTAMPTZ
);

CREATE TABLE purchase_order_lines (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  description TEXT,
  quantity DECIMAL(18,3) NOT NULL,
  unit_price DECIMAL(18,2) NOT NULL,
  line_total DECIMAL(18,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Règlements, dettes et créances
-- ------------------------------------------------------------
CREATE TYPE settlement_type AS ENUM (
  'vente_panier',
  'bon_commande',
  'creance_commerciale',
  'dette_commerciale',
  'dette_externe',
  'creance_externe'
);

CREATE TABLE settlements (
  id SERIAL PRIMARY KEY,
  settlement_number VARCHAR(50) UNIQUE,
  settlement_type settlement_type NOT NULL,
  reference_id INTEGER,
  client_id INTEGER REFERENCES clients(id),
  amount DECIMAL(18,2) NOT NULL,
  amount_paid DECIMAL(18,2) DEFAULT 0,
  balance DECIMAL(18,2) DEFAULT 0,
  due_date DATE,
  status VARCHAR(30) DEFAULT 'en_cours',
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE settlement_payments (
  id SERIAL PRIMARY KEY,
  settlement_id INTEGER NOT NULL REFERENCES settlements(id),
  amount DECIMAL(18,2) NOT NULL,
  payment_mode payment_mode,
  paid_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  created_by INTEGER REFERENCES users(id)
);

-- ------------------------------------------------------------
-- Finances
-- ------------------------------------------------------------
CREATE TABLE charge_types (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE daily_cash (
  id SERIAL PRIMARY KEY,
  cash_date DATE UNIQUE NOT NULL,
  opening_balance DECIMAL(18,2) DEFAULT 0,
  total_income DECIMAL(18,2) DEFAULT 0,
  total_expense DECIMAL(18,2) DEFAULT 0,
  closing_balance DECIMAL(18,2) DEFAULT 0,
  notes TEXT,
  sales_collected DECIMAL(18,2) DEFAULT 0,
  settlement_collected DECIMAL(18,2) DEFAULT 0,
  expected_balance DECIMAL(18,2),
  counted_balance DECIMAL(18,2),
  variance DECIMAL(18,2),
  signature_name VARCHAR(150),
  closed_at TIMESTAMPTZ,
  closed_by INTEGER REFERENCES users(id),
  reopened_at TIMESTAMPTZ,
  reopened_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE VIEW cash_closure AS
SELECT
  id, cash_date, opening_balance, total_income, total_expense, closing_balance,
  sales_collected, settlement_collected, expected_balance, counted_balance, variance,
  signature_name, closed_at, closed_by, reopened_at, reopened_by, notes, created_at, updated_at
FROM daily_cash;

CREATE TABLE cash_transactions (
  id SERIAL PRIMARY KEY,
  cash_date DATE NOT NULL,
  transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('recette', 'depense')),
  amount DECIMAL(18,2) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  reference_type VARCHAR(50),
  reference_id INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE charges (
  id SERIAL PRIMARY KEY,
  charge_type_id INTEGER REFERENCES charge_types(id),
  amount DECIMAL(18,2) NOT NULL,
  charge_date DATE NOT NULL,
  period_month INTEGER,
  period_year INTEGER,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Audit et sauvegardes
-- ------------------------------------------------------------
CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50),
  entity_id INTEGER,
  details JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE backups (
  id SERIAL PRIMARY KEY,
  backup_type VARCHAR(20) NOT NULL,
  file_path TEXT,
  google_drive_file_id VARCHAR(100),
  status VARCHAR(30) DEFAULT 'success',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Index
-- ------------------------------------------------------------
CREATE INDEX idx_sales_carts_status ON sales_carts(status);
CREATE INDEX idx_sales_carts_created ON sales_carts(created_at);
CREATE INDEX idx_sale_lines_cart ON sale_lines(cart_id);
CREATE INDEX idx_sale_lines_product ON sale_lines(product_id);
CREATE INDEX idx_products_reference ON products(reference);
CREATE INDEX idx_clients_code ON clients(code);
CREATE INDEX idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX idx_product_stock_product ON product_stock(product_id);
