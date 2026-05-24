-- ============================================================
-- Migration 002: Menu Categories + Items + Modifiers to Database
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS pos_menu_categories (
  id TEXT PRIMARY KEY,
  client_id TEXT DEFAULT 'amalay',
  name TEXT NOT NULL,
  color TEXT DEFAULT 'bg-slate-500',
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_menu_cat_client ON pos_menu_categories(client_id);

CREATE TABLE IF NOT EXISTS pos_menu_items (
  id TEXT PRIMARY KEY,
  client_id TEXT DEFAULT 'amalay',
  category_id TEXT NOT NULL REFERENCES pos_menu_categories(id),
  name TEXT NOT NULL,
  price NUMERIC DEFAULT 0,
  barcode TEXT,
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_menu_items_client ON pos_menu_items(client_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_cat ON pos_menu_items(category_id);

CREATE TABLE IF NOT EXISTS pos_modifier_groups (
  id TEXT PRIMARY KEY,
  client_id TEXT DEFAULT 'amalay',
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pos_modifiers (
  id TEXT PRIMARY KEY,
  client_id TEXT DEFAULT 'amalay',
  group_id TEXT NOT NULL REFERENCES pos_modifier_groups(id),
  name TEXT NOT NULL,
  price NUMERIC DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_modifiers_group ON pos_modifiers(group_id);

CREATE TABLE IF NOT EXISTS pos_category_modifiers (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT DEFAULT 'amalay',
  category_id TEXT NOT NULL,
  modifier_group_id TEXT NOT NULL,
  UNIQUE(client_id, category_id, modifier_group_id)
);

CREATE TABLE IF NOT EXISTS pos_payment_methods (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  client_id TEXT DEFAULT 'amalay',
  name TEXT NOT NULL,
  type TEXT DEFAULT 'cash',
  commission_pct NUMERIC DEFAULT 0,
  fiscal_code TEXT DEFAULT '',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. SEED: CATEGORIES
-- ============================================================

INSERT INTO pos_menu_categories (id, client_id, name, color, sort_order) VALUES
('promos','amalay','Especiales','bg-red-600',0),
('chilaquiles','amalay','Chilaquiles','bg-rose-700',1),
('eggs','amalay','Huevos','bg-yellow-500',2),
('coffee','amalay','Cafe','bg-amber-700',3),
('toast','amalay','Pan & Toast','bg-orange-500',4),
('signature','amalay','Signature','bg-purple-600',5),
('croissants','amalay','Croissants','bg-yellow-600',6),
('jugos','amalay','Jugos','bg-green-500',7),
('fresh','amalay','Frescos','bg-cyan-500',8),
('smoothies','amalay','Smoothies','bg-pink-500',9),
('frappes','amalay','Frappes','bg-indigo-500',10),
('pancakes','amalay','Pancakes','bg-yellow-400',11),
('paninis','amalay','Paninis','bg-lime-600',12),
('pizzas','amalay','Pizzas & Pastas','bg-rose-600',13),
('bowls','amalay','Bowls','bg-emerald-600',14),
('postres','amalay','Postres','bg-fuchsia-500',15),
('ceviche','amalay','Ceviche','bg-sky-600',16),
('bakery','amalay','Panaderia','bg-amber-500',17),
('sodas','amalay','Sodas','bg-blue-500',18),
('tea','amalay','Te','bg-green-700',19),
('alcohol','amalay','Bebidas OH','bg-violet-700',20),
('mkt-cafe','amalay','Mkt: Cafe','bg-slate-500',21),
('mkt-galletas','amalay','Mkt: Galletas','bg-slate-500',22),
('mkt-snacks','amalay','Mkt: Snacks','bg-slate-500',23),
('mkt-amaranth','amalay','Mkt: Amaranth','bg-slate-500',24),
('mkt-smarty','amalay','Mkt: Smarty Chips','bg-slate-500',25),
('mkt-sanutri','amalay','Mkt: Sanutri','bg-slate-500',26),
('mkt-dulces','amalay','Mkt: Dulces','bg-slate-500',27),
('mkt-proteina','amalay','Mkt: Proteina','bg-slate-500',28),
('mkt-suplementos','amalay','Mkt: Suplementos','bg-slate-500',29),
('mkt-te','amalay','Mkt: Te & Infusiones','bg-slate-500',30),
('mkt-lanona','amalay','Mkt: La Nona','bg-slate-500',31),
('mkt-rojamaica','amalay','Mkt: Rojamaica','bg-slate-500',32),
('mkt-belleza','amalay','Mkt: Belleza','bg-slate-500',33),
('mkt-accesorios','amalay','Mkt: Accesorios','bg-slate-500',34),
('mkt-libros','amalay','Mkt: Libros','bg-slate-500',35)
ON CONFLICT (id) DO NOTHING;

-- 3. SEED: MENU ITEMS
-- ============================================================

INSERT INTO pos_menu_items (id, client_id, category_id, name, price, sort_order) VALUES
-- Especiales
('promo1','amalay','promos','Combo Amalay',360,0),
('promo2','amalay','promos','Half & Half Combo',287,1),
('promo3','amalay','promos','Egg and Pancake Combo',277,2),
('promo4','amalay','promos','French Toast',220,3),
-- Chilaquiles
('c1a','amalay','chilaquiles','Chilaquiles Verdes',292,0),
('c1b','amalay','chilaquiles','Chilaquiles Rojos',292,1),
('c2','amalay','chilaquiles','Chilaquiles Light',304,2),
('c3','amalay','chilaquiles','Enchiladas Suizas',261,3),
('c4','amalay','chilaquiles','Taquitos Amalay',279,4),
-- Huevos
('e1','amalay','eggs','Machacado con Huevo',274,0),
('e2','amalay','eggs','Half & Half Combo',287,1),
('e3','amalay','eggs','Garden Omelet',264,2),
('e4','amalay','eggs','Combo Fit',264,3),
('e5','amalay','eggs','Egg and Pancake Combo',277,4),
('e6','amalay','eggs','Miss Benedict',310,5),
('e7','amalay','eggs','Miss Benedict Keto-Panela Wallander',389,6),
('e8','amalay','eggs','Mr. Benedict',351,7),
('e9','amalay','eggs','Benedict Omelet',283,8),
-- Cafe
('cf1','amalay','coffee','Cafe Americano',48,0),
('cf2','amalay','coffee','Capuchino Caliente',89,1),
('cf3','amalay','coffee','Cafe Latte Caliente',94,2),
('cf4','amalay','coffee','Latte Frio',102,3),
('cf5','amalay','coffee','Matcha Latte Frio',127,4),
('cf6','amalay','coffee','Chai Latte Frio',122,5),
('cf7','amalay','coffee','Mocca Latte Caliente',100,6),
('cf8','amalay','coffee','Chai Latte Caliente',122,7),
('cf9','amalay','coffee','Mocca Latte Frio',108,8),
-- Pan & Toast
('t1','amalay','toast','Avocado Toast',252,0),
('t2','amalay','toast','Amalay Salmon Special Toast',402,1),
('t3','amalay','toast','El Mexicano Toast',183,2),
('t4','amalay','toast','Salmon Bagel',350,3),
-- Signature
('sg1','amalay','signature','Mimosa Clasica',160,0),
('sg2','amalay','signature','Chamoyada de Mango',120,1),
-- Croissants
('cr1','amalay','croissants','Croque Madame Amalay',308,0),
('cr2','amalay','croissants','Croissant Nutella',99,1),
('cr3','amalay','croissants','Turkey & Swiss Croissant',285,2),
('cr4','amalay','croissants','Croissant Almendra',99,3),
('cr5','amalay','croissants','Mummas Breakfast Croissant',268,4),
-- Jugos
('j1','amalay','jugos','Jugo de Naranja Natural',78,0),
('j2','amalay','jugos','Jugo Verde de la Casa',98,1),
('j3','amalay','jugos','Jugo Be Inmune',115,2),
('j4','amalay','jugos','Jugo Dr Detox',115,3),
('j5','amalay','jugos','Jugo U Glow',115,4),
-- Frescos
('f1','amalay','fresh','Limonada Natural',63,0),
('f2','amalay','fresh','Limonada de Frutos Rojos',62,1),
('f3','amalay','fresh','Limonada de Pepino',62,2),
('f4','amalay','fresh','Jamaica Natural',49,3),
('f5','amalay','fresh','Horchata Natural',49,4),
-- Smoothies
('sm1','amalay','smoothies','Smoothie Mango-Matcha',221,0),
('sm2','amalay','smoothies','Smoothie Pink Flamingo',152,1),
('sm3','amalay','smoothies','Smoothie Tropical Coconut',139,2),
('sm4','amalay','smoothies','Smoothie Morning Blast',207,3),
('sm5','amalay','smoothies','Smoothie Choco-Peanut Butter',175,4),
-- Frappes
('fr1','amalay','frappes','Frappe Matcha',124,0),
('fr2','amalay','frappes','Frappe Mango-Maracuya',120,1),
('fr3','amalay','frappes','Frapuccino',135,2),
('fr4','amalay','frappes','Frappe Oreo',132,3),
-- Pancakes
('pw1','amalay','pancakes','Classic Pancakes',215,0),
('pw2','amalay','pancakes','Paradise Buttermilk Blueberry Pancakes',265,1),
('pw3','amalay','pancakes','Red Velvet Pancakes',250,2),
-- Paninis
('pn1','amalay','paninis','Chicken Panini',296,0),
('pn2','amalay','paninis','Caprese Panini',275,1),
-- Pizzas & Pastas
('pz1','amalay','pizzas','Pasta Mamarosa',287,0),
('pz2','amalay','pizzas','Pizza Pepperoni',245,1),
('pz3','amalay','pizzas','Pizza Margarita',220,2),
('pz4','amalay','pizzas','Pasta Bolognese',232,3),
('pz5','amalay','pizzas','Ribeye Smash Burger',252,4),
-- Bowls
('bw1','amalay','bowls','Acai Love Bowl',232,0),
('bw2','amalay','bowls','Fruit Bowl',150,1),
-- Postres
('ds1','amalay','postres','New York Cheesecake',130,0),
('ds2','amalay','postres','Carrot Cake',135,1),
('ds3','amalay','postres','Dark Chocolate Brownie',130,2),
('ds4','amalay','postres','Tiramisu',145,3),
('ds5','amalay','postres','Pastel de Chocolate',130,4),
-- Ceviche
('cv1','amalay','ceviche','Ceviche de Salmon',395,0),
('cv2','amalay','ceviche','Ceviche Clasico',320,1),
-- Panaderia
('bk1','amalay','bakery','Concha de Mantequilla',37,0),
('bk2','amalay','bakery','Healthy Crunchy Mix',170,1),
-- Sodas
('sd1','amalay','sodas','Coca Cola Regular 355ml',34,0),
('sd2','amalay','sodas','Coca Cola Sin Azucar 355ml',60,1),
('sd3','amalay','sodas','Coca Cola Light 355ml',60,2),
('sd4','amalay','sodas','Agua Amalay 500ml',44,3),
('sd5','amalay','sodas','Agua de Piedra Mineral',57,4),
('sd6','amalay','sodas','Agua de Piedra Natural',57,5),
-- Te
('te1','amalay','tea','Te Chai',75,0),
('te2','amalay','tea','Te Verde',65,1),
-- Bebidas OH
('al1','amalay','alcohol','Cerveza Artesanal',95,0),
('al2','amalay','alcohol','Vino Copa Tinto',150,1),
-- Market items (price 0 = lookup at register)
('mk1','amalay','mkt-cafe','Cafe Grano 300g',0,0),('mk2','amalay','mkt-cafe','Cafe Grano 500g',0,1),('mk3','amalay','mkt-cafe','Cafe Molido 300g',0,2),('mk4','amalay','mkt-cafe','Cafe Molido 500g',0,3),('mk5','amalay','mkt-cafe','Vaso Cafe Refill',0,4),('mk6','amalay','mkt-cafe','Termo Chico Cafe',0,5),
('mk10','amalay','mkt-galletas','Galletas Bote Chico 20pz',0,0),('mk11','amalay','mkt-galletas','Galletas Bote 420g',0,1),('mk12','amalay','mkt-galletas','Galletas Bote Mediano 180g',0,2),('mk13','amalay','mkt-galletas','Galletas Paq 3pzs',0,3),('mk14','amalay','mkt-galletas','Galleta Sin Gluten',0,4),('mk15','amalay','mkt-galletas','Nucelli Brownie Vegan',0,5),('mk16','amalay','mkt-galletas','Nucelli Galleta Chocochips',0,6),('mk17','amalay','mkt-galletas','Brule Brownie Brittle',0,7),('mk18','amalay','mkt-galletas','Brule Galleta GF Chocolate',0,8),('mk19','amalay','mkt-galletas','Keto Cookie 120g',0,9),
('mk20','amalay','mkt-snacks','Healthy Crunch Mix 300g',0,0),('mk21','amalay','mkt-snacks','Healthy Crunch Mix 60g',0,1),('mk22','amalay','mkt-snacks','Mix Enchilado Chico',0,2),('mk23','amalay','mkt-snacks','Mix Enchilado Grande',0,3),('mk24','amalay','mkt-snacks','Mix Salud Omega 3 100g',0,4),('mk25','amalay','mkt-snacks','Pasa Chocolate Amargo 170g',0,5),('mk26','amalay','mkt-snacks','Manglo Mango Enchilado 120g',0,6),('mk27','amalay','mkt-snacks','Manglo Mango Enchilado 300g',0,7),('mk28','amalay','mkt-snacks','Mango Seco Natural 120g',0,8),('mk29','amalay','mkt-snacks','Mango Seco Natural 300g',0,9),('mk30','amalay','mkt-snacks','Chips Pepino Limon 200g',0,10),('mk31','amalay','mkt-snacks','Chips Pepino Salsa 200g',0,11),('mk32','amalay','mkt-snacks','Chips Jamaica 40g',0,12),('mk33','amalay','mkt-snacks','Granola Keto 125g',0,13),('mk34','amalay','mkt-snacks','Granola 250g',0,14),
('mk40','amalay','mkt-amaranth','Cacahuate Chipotle 142g',0,0),('mk41','amalay','mkt-amaranth','Cacahuate Habanero 142g',0,1),('mk42','amalay','mkt-amaranth','Cacahuate Limon 142g',0,2),('mk43','amalay','mkt-amaranth','Cacahuate Sal Himalaya 142g',0,3),('mk44','amalay','mkt-amaranth','Charris Chipotle 142g',0,4),('mk45','amalay','mkt-amaranth','Charris Habanero 142g',0,5),('mk46','amalay','mkt-amaranth','Charris Limon 142g',0,6),('mk47','amalay','mkt-amaranth','Papas Desh Chipotle 100g',0,7),('mk48','amalay','mkt-amaranth','Papas Desh Jalapeno 100g',0,8),('mk49','amalay','mkt-amaranth','Obleas Dif Sabores 58g',0,9),
('mk50','amalay','mkt-smarty','Jicama Adobada 170g',0,0),('mk51','amalay','mkt-smarty','Jicama Adobada 50g',0,1),('mk52','amalay','mkt-smarty','Jicama Habanero 170g',0,2),('mk53','amalay','mkt-smarty','Jicama Limon 170g',0,3),('mk54','amalay','mkt-smarty','Jicama Limon 50g',0,4),('mk55','amalay','mkt-smarty','Jicama Natural 170g',0,5),('mk56','amalay','mkt-smarty','Jicama Natural 50g',0,6),('mk57','amalay','mkt-smarty','Jicama Torito 170g',0,7),('mk58','amalay','mkt-smarty','Jicama Torito 50g',0,8),
('mk60','amalay','mkt-sanutri','Churritos Chipotle 300g',0,0),('mk61','amalay','mkt-sanutri','Churritos Fuego 300g',0,1),('mk62','amalay','mkt-sanutri','Churritos Mix Crunch 300g',0,2),('mk63','amalay','mkt-sanutri','Churritos Nopal 300g',0,3),('mk64','amalay','mkt-sanutri','Churritos Sal y Limon 300g',0,4),('mk65','amalay','mkt-sanutri','Churritos Chile Limon 300g',0,5),('mk66','amalay','mkt-sanutri','Churritos Habanero 300g',0,6),
('mk70','amalay','mkt-dulces','Guayabate Guayaba 100g',0,0),('mk71','amalay','mkt-dulces','Guayabate Tabletas 100g',0,1),('mk72','amalay','mkt-dulces','Guayabate Tejocote 100g',0,2),('mk73','amalay','mkt-dulces','Nubits Tamarindo 30g',0,3),('mk74','amalay','mkt-dulces','Vamara Ciruela Enchilada 250g',0,4),('mk75','amalay','mkt-dulces','Vamara Datil Enchilado 220g',0,5),('mk76','amalay','mkt-dulces','Vamara Mix Enchilado 220g',0,6),('mk77','amalay','mkt-dulces','Vamara Manzana Enchilada 180g',0,7),('mk78','amalay','mkt-dulces','Duraznero Durazno/Chile 250g',0,8),('mk79','amalay','mkt-dulces','Duraznero Fresa/Chile 250g',0,9),('mk80','amalay','mkt-dulces','Duraznero Mango/Chile 250g',0,10),
('mk90','amalay','mkt-proteina','Habits Cacao 488g',0,0),('mk91','amalay','mkt-proteina','Habits Vainilla 488g',0,1),('mk92','amalay','mkt-proteina','Habits Matcha-Vainilla 488g',0,2),('mk93','amalay','mkt-proteina','Habits Maca-Cacao 488g',0,3),('mk94','amalay','mkt-proteina','Habits Natural 488g',0,4),('mk95','amalay','mkt-proteina','Habits High Perf Cacao 578g',0,5),('mk96','amalay','mkt-proteina','Habits High Perf Vainilla 578g',0,6),('mk97','amalay','mkt-proteina','Habits Creatina 300g',0,7),('mk98','amalay','mkt-proteina','Habits Colageno 250g',0,8),('mk99','amalay','mkt-proteina','Birdman Falcon Chocolate 510g',0,9),('mk100','amalay','mkt-proteina','Birdman Falcon Vainilla 510g',0,10),('mk101','amalay','mkt-proteina','Birdman Fitmingo Moka 510g',0,11),('mk102','amalay','mkt-proteina','Birdman Creatina 450g',0,12),('mk103','amalay','mkt-proteina','Vital Proteins Collagen 567g',0,13),
('mk110','amalay','mkt-suplementos','Olly Sleep 50 Gummies',0,0),('mk111','amalay','mkt-suplementos','Olly Sleep Extra 70 Gummies',0,1),('mk112','amalay','mkt-suplementos','Olly Kids Sleep 50 Gummies',0,2),('mk113','amalay','mkt-suplementos','Olly Womens Multi 90pz',0,3),('mk114','amalay','mkt-suplementos','Olly Glowing Skin 50 Gummies',0,4),('mk115','amalay','mkt-suplementos','Olly Beauty 60 Gummies',0,5),('mk116','amalay','mkt-suplementos','Calm Magnesium Raspberry 60pz',0,6),('mk117','amalay','mkt-suplementos','Calm Magnesium Orange 453g',0,7),('mk118','amalay','mkt-suplementos','Calm Sleep Gummies 240',0,8),('mk119','amalay','mkt-suplementos','Force Factor Mushrooms 60pz',0,9),('mk120','amalay','mkt-suplementos','Natrol Melatonine 150 Tab',0,10),
('mk130','amalay','mkt-te','Te Jengibre Limon 100g',0,0),('mk131','amalay','mkt-te','Te Mora de la Selva 220g',0,1),('mk132','amalay','mkt-te','Te Petalo Mio 100g',0,2),('mk133','amalay','mkt-te','Te Ponche Guayaba 150g',0,3),('mk134','amalay','mkt-te','Raices Matcha Mix 125g',0,4),('mk135','amalay','mkt-te','Raices Golden Mane 250g',0,5),('mk136','amalay','mkt-te','Raices Reishi Cacao 250g',0,6),
('mk140','amalay','mkt-lanona','Doraditas Keto/Almendras 120g',0,0),('mk141','amalay','mkt-lanona','Doraditas Vegana/Platano 130g',0,1),('mk142','amalay','mkt-lanona','Doraditas Avena/Stevia 130g',0,2),('mk143','amalay','mkt-lanona','Doraditas Chocolate/Avena 130g',0,3),('mk144','amalay','mkt-lanona','Gorditas Avena/Stevia 270g',0,4),('mk145','amalay','mkt-lanona','Gorditas Chocolate/Avena 270g',0,5),
('mk150','amalay','mkt-rojamaica','Chips de Rojamaica 40g',0,0),('mk151','amalay','mkt-rojamaica','Dip de Rojamaica 320g',0,1),('mk152','amalay','mkt-rojamaica','Jamaica Enchilada 50g',0,2),('mk153','amalay','mkt-rojamaica','Salsa Rojamaica 250g',0,3),('mk154','amalay','mkt-rojamaica','Salsa Rojamaica 520g',0,4),
('mk160','amalay','mkt-belleza','Hand & Body Lotion 500ml',0,0),('mk161','amalay','mkt-belleza','Hand Wash 500ml',0,1),('mk162','amalay','mkt-belleza','Mali Bronceador Cacao 100ml',0,2),('mk163','amalay','mkt-belleza','Mali Bronceador Carrot 100ml',0,3),('mk164','amalay','mkt-belleza','Mali Bronceador Sun 100ml',0,4),('mk165','amalay','mkt-belleza','Mali Tanning Foam 200ml',0,5),('mk166','amalay','mkt-belleza','Renew Jabon Corporal 355ml',0,6),('mk167','amalay','mkt-belleza','Renew Locion 237ml',0,7),('mk168','amalay','mkt-belleza','Melaleuca Gel',0,8),('mk169','amalay','mkt-belleza','Aceite Melaleuca 15ml',0,9),
('mk170','amalay','mkt-accesorios','Taza Ceramica Blanca',0,0),('mk171','amalay','mkt-accesorios','Taza Ceramica Verde',0,1),('mk172','amalay','mkt-accesorios','Taza Termica',0,2),('mk173','amalay','mkt-accesorios','Termo Grande 1.2L',0,3),('mk174','amalay','mkt-accesorios','Totebag',0,4),('mk175','amalay','mkt-accesorios','Libreta c/ Pluma',0,5),('mk176','amalay','mkt-accesorios','Velita Decoracion',0,6),('mk177','amalay','mkt-accesorios','Gift Card',0,7),('mk178','amalay','mkt-accesorios','Tarjeta de Regalo',0,8),('mk179','amalay','mkt-accesorios','Ramekin Corazon',0,9),('mk180','amalay','mkt-accesorios','Jarra Infusora',0,10),('mk181','amalay','mkt-accesorios','Planta Chica',0,11),('mk182','amalay','mkt-accesorios','Planta Grande',0,12),
('mk190','amalay','mkt-libros','Como Hacer Que Te Pasen Cosas Buenas',0,0),('mk191','amalay','mkt-libros','Encuentra Tu Persona Vitamina',0,1),('mk192','amalay','mkt-libros','Human Kind',0,2),('mk193','amalay','mkt-libros','Kidness',0,3),('mk194','amalay','mkt-libros','Las Cosas Que No Nos Dijeron',0,4),('mk195','amalay','mkt-libros','Recupera Tu Mente',0,5),('mk196','amalay','mkt-libros','The Hidden Power',0,6),('mk197','amalay','mkt-libros','The War For Kidness',0,7)
ON CONFLICT (id) DO NOTHING;

-- 4. SEED: MODIFIER GROUPS
-- ============================================================

INSERT INTO pos_modifier_groups (id, client_id, name, sort_order) VALUES
('quitar','amalay','Quitar',0),
('food','amalay','Extras Comida',1),
('coffee','amalay','Extras Cafe',2),
('drinks','amalay','Extras Bebidas',3)
ON CONFLICT (id) DO NOTHING;

-- 5. SEED: MODIFIERS
-- ============================================================

INSERT INTO pos_modifiers (id, client_id, group_id, name, price, sort_order) VALUES
-- Quitar (price 0)
('mq1','amalay','quitar','Sin cebolla',0,0),
('mq2','amalay','quitar','Sin chile',0,1),
('mq3','amalay','quitar','Sin crema',0,2),
('mq4','amalay','quitar','Sin queso',0,3),
('mq5','amalay','quitar','Sin pan',0,4),
('mq6','amalay','quitar','Sin salsa',0,5),
('mq7','amalay','quitar','Sin jitomate',0,6),
('mq8','amalay','quitar','Sin aguacate',0,7),
-- Extras Comida
('mf1','amalay','food','Extra queso',25,0),
('mf2','amalay','food','Extra aguacate',35,1),
('mf3','amalay','food','Extra proteina',45,2),
('mf4','amalay','food','Extra huevo',20,3),
('mf5','amalay','food','Extra salsa',0,4),
-- Extras Cafe
('mc1','amalay','coffee','Shot extra',20,0),
('mc2','amalay','coffee','Leche de almendra',15,1),
('mc3','amalay','coffee','Leche de avena',15,2),
('mc4','amalay','coffee','Leche deslactosada',10,3),
('mc5','amalay','coffee','Jarabe de vainilla',15,4),
('mc6','amalay','coffee','Crema batida',10,5),
-- Extras Bebidas
('md1','amalay','drinks','Leche de almendra',15,0),
('md2','amalay','drinks','Leche de avena',15,1),
('md3','amalay','drinks','Extra fruta',20,2),
('md4','amalay','drinks','Proteina whey',25,3)
ON CONFLICT (id) DO NOTHING;

-- 6. SEED: CATEGORY-MODIFIER ASSIGNMENTS
-- ============================================================
-- Food categories get quitar + food extras
-- Coffee/tea get coffee extras (no quitar)
-- Beverage categories get drinks extras (no quitar)
-- Sodas get nothing

INSERT INTO pos_category_modifiers (client_id, category_id, modifier_group_id) VALUES
-- Food categories: quitar + food
('amalay','promos','quitar'),('amalay','promos','food'),
('amalay','chilaquiles','quitar'),('amalay','chilaquiles','food'),
('amalay','eggs','quitar'),('amalay','eggs','food'),
('amalay','toast','quitar'),('amalay','toast','food'),
('amalay','croissants','quitar'),('amalay','croissants','food'),
('amalay','pancakes','quitar'),('amalay','pancakes','food'),
('amalay','paninis','quitar'),('amalay','paninis','food'),
('amalay','pizzas','quitar'),('amalay','pizzas','food'),
('amalay','bowls','quitar'),('amalay','bowls','food'),
('amalay','postres','quitar'),('amalay','postres','food'),
('amalay','ceviche','quitar'),('amalay','ceviche','food'),
('amalay','bakery','quitar'),('amalay','bakery','food'),
-- Coffee/tea: coffee extras only
('amalay','coffee','coffee'),
('amalay','tea','coffee'),
-- Beverage categories: drinks extras only
('amalay','fresh','drinks'),
('amalay','smoothies','drinks'),
('amalay','frappes','drinks'),
('amalay','jugos','drinks'),
('amalay','signature','drinks'),
('amalay','alcohol','drinks')
-- sodas: no modifiers (intentionally excluded)
ON CONFLICT (client_id, category_id, modifier_group_id) DO NOTHING;

-- 7. SEED: PAYMENT METHODS
-- ============================================================

INSERT INTO pos_payment_methods (id, client_id, name, type, commission_pct) VALUES
('pm-cash','amalay','Efectivo','cash',0),
('pm-credit','amalay','Tarjeta de credito','card',2.5),
('pm-debit','amalay','Tarjeta de debito','card',1.5),
('pm-transfer','amalay','Transferencia','transfer',0),
('pm-ubereats','amalay','Ubereats','platform',30),
('pm-rappi','amalay','Rappi','platform',25),
('pm-didi','amalay','DiDi Food','platform',25)
ON CONFLICT (id) DO NOTHING;
