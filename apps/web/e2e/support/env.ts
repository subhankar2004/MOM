/**
 * Shared settings for the browser tests. The API and web app both run on 127.0.0.1
 * (different ports), so the API's session cookies are sent by the web app's pages.
 */
export const WEB_PORT = 3100;
export const API_PORT = 4100;
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
export const API_URL = `http://127.0.0.1:${API_PORT}`;
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://mom:mom@127.0.0.1:5432/mom_test';

/** Test phones get this fixed code instead of an SMS (API: SMS_TEST_PHONES/SMS_TEST_CODE). */
export const TEST_CODE = '246810';

/** Razorpay key secret used by the fake gateway in browser tests (test-only). */
export const E2E_RAZORPAY_SECRET = 'e2e-razorpay-key-secret';

/** Every phone the tests use: +91 90000 001xx. Wiped before each run. */
export const PHONE_PREFIX = '+91900000';
export const phone = (n: number) => `${PHONE_PREFIX}${String(100 + n).padStart(4, '0')}`;
export const PHONES = {
  admin: phone(1),
  student: phone(2),
  vendor: phone(3),
  // used by individual login-UI tests
  flowNew: phone(10),
  flowHome: phone(11),
  flowWrong: phone(12),
  flowPaste: phone(13),
  flowRefresh: phone(14),
  flowSignOut: phone(15),
  flowChange: phone(16),
  flowAdmin: phone(17),
  // one fresh student per Playwright project for ordering tests (cash-order limits are per student)
  orderPhone360: phone(40),
  orderDesktop: phone(41),
  upiPhone360: phone(42),
  upiDesktop: phone(43),
  qrPhone360: phone(44),
  qrDesktop: phone(45),
  livePhone360: phone(46),
  liveDesktop: phone(47),
  boardPhone360: phone(48),
  boardDesktop: phone(49),
  // stall owners for the order-board tests (one per project, separate from the shared vendor)
  boardVendor360: phone(50),
  boardVendorDesktop: phone(51),
  // stall owners for the menu-editor tests
  menuVendor360: phone(52),
  menuVendorDesktop: phone(53),
  // stall settings tests: a student who checks out, and the stall's owner
  settingsPhone360: phone(54),
  settingsDesktop: phone(55),
  settingsVendor360: phone(56),
  settingsVendorDesktop: phone(57),
  // pickup scanner tests: the stall owner and a student
  scanVendor360: phone(58),
  scanVendorDesktop: phone(59),
  scanPhone360: phone(60),
  scanDesktop: phone(61),
  // sales report tests: the stall owner and a student
  salesVendor360: phone(62),
  salesVendorDesktop: phone(63),
  salesPhone360: phone(64),
  salesDesktop: phone(65),
  // a stall owner registered by the admin in the onboarding test
  onboardOwner360: phone(66),
  onboardOwnerDesktop: phone(67),
  // students handled by the admin in the users & orders tests
  adminTarget360: phone(68),
  adminTargetDesktop: phone(69),
  // revenue tests: a stall owner and a student who orders with cash
  financeVendor360: phone(70),
  financeVendorDesktop: phone(71),
  financeStudent360: phone(72),
  financeStudentDesktop: phone(73),
  // settlements tests: a stall owner and a student
  settleVendor360: phone(74),
  settleVendorDesktop: phone(75),
  settleStudent360: phone(76),
  settleStudentDesktop: phone(77),
  // sign-in pages test: a student and a stall owner
  portalStudent: phone(78),
  portalOwner: phone(79),
} as const;

export const STORAGE = {
  admin: 'e2e/.auth/admin.json',
  student: 'e2e/.auth/student.json',
  vendor: 'e2e/.auth/vendor.json',
} as const;

/** Environment for the API process started by Playwright. */
export function apiEnv(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'warn',
    API_HOST: '127.0.0.1',
    API_PORT: String(API_PORT),
    WEB_ORIGIN: WEB_URL,
    DATABASE_URL: E2E_DATABASE_URL,
    // Local S3 (SeaweedFS from docker-compose.yml; CI starts the same container).
    S3_ENDPOINT: 'http://127.0.0.1:8333',
    S3_BUCKET: 'mom-images',
    S3_ACCESS_KEY_ID: 'mom-dev-access-key',
    S3_SECRET_ACCESS_KEY: 'mom-dev-secret-key',
    S3_FORCE_PATH_STYLE: 'true',
    PUBLIC_IMAGE_BASE_URL: 'http://127.0.0.1:8333/mom-images',
    JWT_SECRET: 'e2e-only-jwt-secret-0123456789-abcdefghij',
    OTP_PEPPER: 'e2e-only-otp-pepper-9876543210-abcdefghij',
    QR_SECRET: 'e2e-only-qr-secret-0011223344-abcdefghij',
    SMS_TEST_PHONES: Object.values(PHONES).join(','),
    SMS_TEST_CODE: TEST_CODE,
    // The admin becomes super admin by signing in (bootstrap rule, #9).
    SUPER_ADMIN_PHONES: PHONES.admin,
    // Offline payment gateway; the browser tests stub Razorpay Checkout and sign with this secret.
    PAYMENTS_PROVIDER: 'fake',
    RAZORPAY_KEY_ID: 'rzp_test_e2efake',
    RAZORPAY_KEY_SECRET: E2E_RAZORPAY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: 'e2e-razorpay-webhook-secret',
    // Always-fresh stall list, so tests see database changes on the next poll.
    PUBLIC_CACHE_TTL_SECONDS: '0',
    // Many sign-ins from one machine in a few seconds.
    AUTH_RATE_LIMIT_PER_MINUTE: '500',
    // Every test user signs in from 127.0.0.1: well over the default 30 codes per IP per hour.
    OTP_MAX_PER_IP_PER_HOUR: '5000',
    RATE_LIMIT_PER_MINUTE: '5000',
  };
}
