import { paise } from '@mom/shared';

/** Demo content for local development and staging. Not used in production. */

export interface DemoItem {
  name: string;
  description?: string;
  price: string; // rupees, converted with paise()
  veg: boolean;
  available?: boolean;
}

export interface DemoStall {
  slug: string;
  name: string;
  description: string;
  location: string;
  cuisineTags: string[];
  isVegOnly: boolean;
  avgPrepMinutes: number;
  parallelCapacity: number;
  upiEnabled: boolean;
  cashEnabled: boolean;
  /** [weekday 1–7 (Mon–Sun), opens "HH:MM", closes "HH:MM"] */
  hours: [number, string, string][];
  menu: { category: string; items: DemoItem[] }[];
}

const everyDay = (opens: string, closes: string): [number, string, string][] =>
  [1, 2, 3, 4, 5, 6, 7].map((d) => [d, opens, closes]);

export const DEFAULT_SETTINGS = {
  platformFeeBps: 100, // 1 %
  cashFeeBps: 500, // 5 %
  maxOpenCashOrders: 2,
  cashStrikeLimit: 3,
  orderExpiryMinutes: 15,
  congestionLowMaxMinutes: 10,
  congestionModerateMaxMinutes: 20,
  cashEnabledGlobally: true,
  orderingPaused: false,
} as const;

/**
 * Demo accounts for trying the whole app locally (never in production: the seed refuses to run
 * there, and the fixed sign-in code they use is rejected in production by env validation).
 * Numbers in the 70000 000xx range, put in SMS_TEST_PHONES with SMS_TEST_CODE in apps/api/.env.
 */
export const DEMO_ACCOUNTS: Array<{
  phone: string;
  name: string;
  role: 'student' | 'vendor_owner' | 'vendor_staff' | 'super_admin';
  stall?: { slug: string; role: 'owner' | 'staff' };
}> = [
  { phone: '+917000000001', name: 'Demo Student', role: 'student' },
  { phone: '+917000000002', name: 'Second Student', role: 'student' },
  {
    phone: '+917000000011',
    name: 'Dosa Corner Owner',
    role: 'vendor_owner',
    stall: { slug: 'dosa-corner', role: 'owner' },
  },
  {
    phone: '+917000000012',
    name: 'Dosa Corner Staff',
    role: 'vendor_staff',
    stall: { slug: 'dosa-corner', role: 'staff' },
  },
  {
    phone: '+917000000013',
    name: 'Chowmein Owner',
    role: 'vendor_owner',
    stall: { slug: 'chowmein-junction', role: 'owner' },
  },
  {
    phone: '+917000000014',
    name: 'Chai and Rolls Owner',
    role: 'vendor_owner',
    stall: { slug: 'chai-and-rolls', role: 'owner' },
  },
  {
    phone: '+917000000015',
    name: 'Odia Thali Owner',
    role: 'vendor_owner',
    stall: { slug: 'odia-thali-ghar', role: 'owner' },
  },
  { phone: '+917000000021', name: 'Demo Admin', role: 'super_admin' },
];

/** A demo number left out of the seed, to try signing up as a brand-new student. */
export const DEMO_NEW_STUDENT_PHONE = '+917000000009';

export const DEMO_STALLS: DemoStall[] = [
  {
    slug: 'dosa-corner',
    name: 'Dosa Corner',
    description: 'Crispy dosas, idli and vada with fresh chutneys.',
    location: 'Near Main Gate',
    cuisineTags: ['South Indian', 'Breakfast'],
    isVegOnly: true,
    avgPrepMinutes: 8,
    parallelCapacity: 3,
    upiEnabled: true,
    cashEnabled: true,
    hours: everyDay('07:30', '21:30'),
    menu: [
      {
        category: 'Dosa',
        items: [
          { name: 'Plain Dosa', price: '40', veg: true },
          { name: 'Masala Dosa', description: 'Spiced potato filling', price: '60', veg: true },
          { name: 'Onion Rava Dosa', price: '70', veg: true },
          { name: 'Paneer Dosa', price: '80', veg: true, available: false },
        ],
      },
      {
        category: 'Idli & Vada',
        items: [
          { name: 'Idli (2 pcs)', price: '30', veg: true },
          { name: 'Medu Vada (2 pcs)', price: '35', veg: true },
          { name: 'Idli Vada Combo', price: '45', veg: true },
        ],
      },
      {
        category: 'Drinks',
        items: [{ name: 'Filter Coffee', price: '20', veg: true }],
      },
    ],
  },
  {
    slug: 'chowmein-junction',
    name: 'Chowmein Junction',
    description: 'Indo-Chinese street favourites, made to order.',
    location: 'Hostel Road',
    cuisineTags: ['Chinese', 'Fast Food'],
    isVegOnly: false,
    avgPrepMinutes: 12,
    parallelCapacity: 2,
    upiEnabled: false, // cash only until its Razorpay Route account is active
    cashEnabled: true,
    hours: everyDay('12:00', '22:30'),
    menu: [
      {
        category: 'Noodles',
        items: [
          { name: 'Veg Chowmein', price: '50', veg: true },
          { name: 'Egg Chowmein', price: '60', veg: false },
          { name: 'Chicken Chowmein', price: '80', veg: false },
        ],
      },
      {
        category: 'Starters',
        items: [
          { name: 'Veg Manchurian', price: '60', veg: true },
          { name: 'Chilli Chicken', price: '110', veg: false },
          { name: 'Chicken Momos (6 pcs)', price: '70', veg: false },
        ],
      },
      {
        category: 'Rice',
        items: [
          { name: 'Veg Fried Rice', price: '60', veg: true },
          { name: 'Egg Fried Rice', price: '70', veg: false },
        ],
      },
    ],
  },
  {
    slug: 'odia-thali-ghar',
    name: 'Odia Thali Ghar',
    description: 'Home-style Odia meals: dalma, santula, pakhala in summer.',
    location: 'Opposite Library',
    cuisineTags: ['Odia', 'Meals'],
    isVegOnly: false,
    avgPrepMinutes: 5,
    parallelCapacity: 4,
    upiEnabled: true,
    cashEnabled: true,
    // Lunch and dinner, closed on Sunday
    hours: [1, 2, 3, 4, 5, 6].flatMap((d): [number, string, string][] => [
      [d, '11:30', '15:30'],
      [d, '19:00', '22:00'],
    ]),
    menu: [
      {
        category: 'Thali',
        items: [
          { name: 'Veg Thali', description: 'Rice, dalma, santula, bhaja, chutney', price: '90', veg: true },
          { name: 'Fish Thali', description: 'Veg thali with fish curry', price: '140', veg: false },
          { name: 'Chicken Thali', price: '150', veg: false },
        ],
      },
      {
        category: 'Extras',
        items: [
          { name: 'Extra Rice', price: '20', veg: true },
          { name: 'Chhena Poda', price: '40', veg: true },
        ],
      },
    ],
  },
  {
    slug: 'chai-and-rolls',
    name: 'Chai & Rolls',
    description: 'Late-night chai, rolls and maggi.',
    location: 'Behind Academic Block',
    cuisineTags: ['Snacks', 'Beverages'],
    isVegOnly: false,
    avgPrepMinutes: 6,
    parallelCapacity: 2,
    upiEnabled: true,
    cashEnabled: true,
    // Morning slot plus an evening slot that runs past midnight
    hours: [...everyDay('07:00', '10:00'), ...everyDay('17:00', '01:00')],
    menu: [
      {
        category: 'Chai & Coffee',
        items: [
          { name: 'Masala Chai', price: '15', veg: true },
          { name: 'Lemon Tea', price: '15', veg: true },
          { name: 'Cold Coffee', price: '50', veg: true },
        ],
      },
      {
        category: 'Rolls',
        items: [
          { name: 'Paneer Roll', price: '70', veg: true },
          { name: 'Egg Roll', price: '50', veg: false },
          { name: 'Chicken Roll', price: '80', veg: false },
        ],
      },
      {
        category: 'Maggi',
        items: [
          { name: 'Masala Maggi', price: '40', veg: true },
          { name: 'Cheese Maggi', price: '55', veg: true },
        ],
      },
    ],
  },
];

/** Validates prices once at import time so a typo fails loudly instead of seeding bad data. */
for (const stall of DEMO_STALLS) {
  for (const { items } of stall.menu) for (const item of items) paise(item.price);
}
