-- Demo stalls & menus so the app has something to show on day one.
-- Replace with the real stalls around VSSUT before launch.
-- Prices are in paise (₹40 = 4000).

insert into public.stalls (id, name, description, cuisine, location, avg_prep_mins, image_url) values
  ('11111111-0000-0000-0000-000000000001', 'Dosa Corner',      'Crispy dosas, idli & filter coffee',   'South Indian', 'Near Main Gate',   12, null),
  ('11111111-0000-0000-0000-000000000002', 'Chowmein Junction', 'Indo-Chinese street favourites',        'Chinese',      'Opposite Library', 15, null),
  ('11111111-0000-0000-0000-000000000003', 'Odia Thali Ghar',  'Homestyle Odia meals — dalma, santula', 'Odia',         'Hostel Road',      20, null),
  ('11111111-0000-0000-0000-000000000004', 'Chai & Rolls',     'Tea, coffee, kathi rolls & snacks',     'Snacks',       'Near Workshop',     8, null);

insert into public.menu_items (stall_id, name, category, price_paise, is_veg, sort_order) values
  ('11111111-0000-0000-0000-000000000001', 'Plain Dosa',          'Dosa',      4000, true, 1),
  ('11111111-0000-0000-0000-000000000001', 'Masala Dosa',         'Dosa',      5500, true, 2),
  ('11111111-0000-0000-0000-000000000001', 'Paneer Dosa',         'Dosa',      7000, true, 3),
  ('11111111-0000-0000-0000-000000000001', 'Idli (2 pcs)',        'Idli & Vada', 3000, true, 4),
  ('11111111-0000-0000-0000-000000000001', 'Medu Vada (2 pcs)',   'Idli & Vada', 3500, true, 5),
  ('11111111-0000-0000-0000-000000000001', 'Filter Coffee',       'Beverages', 2000, true, 6),

  ('11111111-0000-0000-0000-000000000002', 'Veg Chowmein',        'Noodles',   6000, true,  1),
  ('11111111-0000-0000-0000-000000000002', 'Egg Chowmein',        'Noodles',   7000, false, 2),
  ('11111111-0000-0000-0000-000000000002', 'Chicken Chowmein',    'Noodles',   9000, false, 3),
  ('11111111-0000-0000-0000-000000000002', 'Veg Fried Rice',      'Rice',      7000, true,  4),
  ('11111111-0000-0000-0000-000000000002', 'Chilli Chicken (6 pcs)', 'Starters', 12000, false, 5),
  ('11111111-0000-0000-0000-000000000002', 'Veg Momos (8 pcs)',   'Starters',  5000, true,  6),

  ('11111111-0000-0000-0000-000000000003', 'Veg Thali',           'Thali',     8000, true,  1),
  ('11111111-0000-0000-0000-000000000003', 'Fish Thali',          'Thali',    13000, false, 2),
  ('11111111-0000-0000-0000-000000000003', 'Chicken Thali',       'Thali',    14000, false, 3),
  ('11111111-0000-0000-0000-000000000003', 'Pakhala Combo',       'Specials',  9000, true,  4),
  ('11111111-0000-0000-0000-000000000003', 'Extra Dalma',         'Add-ons',   2500, true,  5),

  ('11111111-0000-0000-0000-000000000004', 'Masala Chai',         'Beverages', 1500, true,  1),
  ('11111111-0000-0000-0000-000000000004', 'Cold Coffee',         'Beverages', 4000, true,  2),
  ('11111111-0000-0000-0000-000000000004', 'Paneer Roll',         'Rolls',     6000, true,  3),
  ('11111111-0000-0000-0000-000000000004', 'Egg Roll',            'Rolls',     5000, false, 4),
  ('11111111-0000-0000-0000-000000000004', 'Chicken Roll',        'Rolls',     7000, false, 5),
  ('11111111-0000-0000-0000-000000000004', 'Samosa (2 pcs)',      'Snacks',    2000, true,  6);
