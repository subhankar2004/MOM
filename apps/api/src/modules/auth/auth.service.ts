import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { authOtps, refreshTokens, users } from '../../db/schema/index.js';
import { AppError } from '../../lib/errors.js';
import type { SmsProvider } from '../../sms/index.js';
import { generateOtp, hashOtp, otpMatches, otpMessage } from './otp.js';
import { hashRefreshToken, newRefreshToken, signAccessToken, type Role } from './tokens.js';

/** Login rules (spec §7.4). */
export const AUTH_RULES = {
  otpValidMinutes: 5,
  otpMaxAttempts: 5,
  resendCooldownSeconds: 30,
  maxOtpsPerPhonePerHour: 5,
  maxOtpsPerIpPerHour: 30,
  accessTokenSeconds: 15 * 60,
  refreshTokenDays: 30,
  /** Two tabs refreshing at the same moment: the loser is not treated as token theft. */
  refreshRaceGraceSeconds: 10,
} as const;

export interface AuthConfig {
  jwtSecret: string;
  otpPepper: string;
  /** Phones that receive `testCode` instead of an SMS (never in production — enforced by env.ts). */
  testPhones: string[];
  testCode?: string;
}

export interface ClientMeta {
  ip: string;
  userAgent?: string;
}

export interface PublicUser {
  id: string;
  phone: string;
  name: string | null;
  role: Role;
}

export interface Session {
  user: PublicUser;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  /** Internal: id of the stored refresh-token row. */
  refreshTokenId: string;
}

const otpExpired = () =>
  new AppError(400, 'OTP_EXPIRED', 'This code has expired or was already used. Request a new code.');
const sessionExpired = () =>
  new AppError(401, 'SESSION_EXPIRED', 'Your session has ended. Please sign in again.');
const suspended = () =>
  new AppError(
    403,
    'ACCOUNT_SUSPENDED',
    'This account is suspended. Contact MOM support if this is a mistake.',
  );

interface Logger {
  warn(obj: object, msg: string): void;
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly sms: SmsProvider,
    private readonly config: AuthConfig,
    private readonly log: Logger,
  ) {}

  /** Step 1: send a 6-digit code to the phone, subject to cooldown and hourly limits. */
  async requestOtp(
    phone: string,
    meta: ClientMeta,
  ): Promise<{ expiresInSeconds: number; resendAfterSeconds: number }> {
    const rules = AUTH_RULES;
    const [stats] = await this.db
      .select({
        lastAgeSeconds: sql<number | null>`extract(epoch from now() - max(${authOtps.createdAt}))::float8`,
        sentLastHour: sql<number>`count(*)::int`,
      })
      .from(authOtps)
      .where(and(eq(authOtps.phone, phone), gt(authOtps.createdAt, sql`now() - interval '1 hour'`)));

    if (typeof stats?.lastAgeSeconds === 'number' && stats.lastAgeSeconds < rules.resendCooldownSeconds) {
      const wait = Math.ceil(rules.resendCooldownSeconds - stats.lastAgeSeconds);
      throw new AppError(429, 'RATE_LIMITED', `Please wait ${wait} seconds before asking for another code.`, {
        retryAfterSeconds: wait,
      });
    }
    if ((stats?.sentLastHour ?? 0) >= rules.maxOtpsPerPhonePerHour) {
      throw new AppError(
        429,
        'RATE_LIMITED',
        'Too many codes requested for this number. Try again in an hour.',
        {
          retryAfterSeconds: 3600,
        },
      );
    }
    const [ipStats] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(authOtps)
      .where(and(eq(authOtps.ip, meta.ip), gt(authOtps.createdAt, sql`now() - interval '1 hour'`)));
    if ((ipStats?.n ?? 0) >= rules.maxOtpsPerIpPerHour) {
      this.log.warn({ ip: meta.ip }, 'OTP requests per IP limit reached');
      throw new AppError(
        429,
        'RATE_LIMITED',
        'Too many sign-in attempts from this network. Try again later.',
        {
          retryAfterSeconds: 3600,
        },
      );
    }

    const isTestPhone = this.config.testCode !== undefined && this.config.testPhones.includes(phone);
    const code = isTestPhone ? this.config.testCode! : generateOtp();

    const [otpRow] = await this.db
      .insert(authOtps)
      .values({
        phone,
        codeHash: hashOtp(this.config.otpPepper, phone, code),
        expiresAt: sql`now() + make_interval(mins => ${rules.otpValidMinutes})`,
        ip: meta.ip,
      })
      .returning({ id: authOtps.id });

    if (isTestPhone) {
      this.log.info({ phone: 'test-number' }, 'OTP for a test phone: fixed code, no SMS sent');
    } else {
      try {
        await this.sms.send({ to: phone, body: otpMessage(code, rules.otpValidMinutes) });
      } catch (err) {
        // The code never reached the phone: forget it so it doesn't count toward cooldown/limits.
        await this.db.delete(authOtps).where(eq(authOtps.id, otpRow!.id));
        this.log.error({ err }, 'SMS provider failed to send an OTP');
        throw new AppError(
          503,
          'SERVICE_UNAVAILABLE',
          "We couldn't send the code right now. Please try again.",
        );
      }
    }
    return { expiresInSeconds: rules.otpValidMinutes * 60, resendAfterSeconds: rules.resendCooldownSeconds };
  }

  /** Step 2: check the code; on success create the account if new and start a session. */
  async verifyOtp(
    phone: string,
    code: string,
    meta: ClientMeta,
  ): Promise<{ session: Session; isNewUser: boolean }> {
    const max = AUTH_RULES.otpMaxAttempts;
    const [otp] = await this.db
      .select({
        id: authOtps.id,
        codeHash: authOtps.codeHash,
        attempts: authOtps.attempts,
        expired: sql<boolean>`${authOtps.expiresAt} <= now()`,
      })
      .from(authOtps)
      .where(and(eq(authOtps.phone, phone), isNull(authOtps.consumedAt)))
      .orderBy(desc(authOtps.createdAt), desc(authOtps.id))
      .limit(1);

    if (!otp || otp.expired) throw otpExpired();
    if (otp.attempts >= max) throw tooManyAttempts();

    if (!otpMatches(this.config.otpPepper, phone, code, otp.codeHash)) {
      // Atomic increment, so parallel guesses can't exceed the attempt limit.
      const [row] = await this.db
        .update(authOtps)
        .set({ attempts: sql`${authOtps.attempts} + 1` })
        .where(and(eq(authOtps.id, otp.id), lt(authOtps.attempts, max)))
        .returning({ attempts: authOtps.attempts });
      const left = max - (row?.attempts ?? max);
      if (left <= 0) throw tooManyAttempts();
      throw new AppError(
        400,
        'OTP_INVALID',
        `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`,
        { attemptsLeft: left },
      );
    }

    return this.db.transaction(async (tx) => {
      // Single use: only one request can consume the code.
      const consumed = await tx
        .update(authOtps)
        .set({ consumedAt: sql`now()` })
        .where(and(eq(authOtps.id, otp.id), isNull(authOtps.consumedAt), lt(authOtps.attempts, max)))
        .returning({ id: authOtps.id });
      if (consumed.length === 0) throw otpExpired();

      let [user] = await tx.select().from(users).where(eq(users.phone, phone)).limit(1);
      const isNewUser = !user;
      if (!user) {
        [user] = await tx.insert(users).values({ phone }).returning();
        this.log.info({ userId: user!.id }, 'new account created');
      }
      if (user!.status === 'suspended') throw suspended();

      const session = await this.startSession(tx, toPublicUser(user!), randomUUID(), meta);
      return { session, isNewUser: isNewUser || !user!.name };
    });
  }

  /**
   * Swap a refresh token for a new pair (rotation). Presenting an already-rotated token again
   * means it was stolen or replayed: the whole session family is revoked.
   */
  async refresh(rawToken: string, meta: ClientMeta): Promise<Session> {
    const hash = hashRefreshToken(rawToken);
    const [found] = await this.db
      .select({
        token: refreshTokens,
        user: users,
        expired: sql<boolean>`${refreshTokens.expiresAt} <= now()`,
        revokedSecondsAgo: sql<number | null>`extract(epoch from now() - ${refreshTokens.revokedAt})::float8`,
      })
      .from(refreshTokens)
      .innerJoin(users, eq(users.id, refreshTokens.userId))
      .where(eq(refreshTokens.tokenHash, hash))
      .limit(1);

    if (!found) throw sessionExpired();
    const { token, user } = found;

    if (token.revokedAt) {
      const recentRotation =
        token.replacedBy !== null &&
        found.revokedSecondsAgo !== null &&
        found.revokedSecondsAgo < AUTH_RULES.refreshRaceGraceSeconds;
      if (!recentRotation) {
        await this.revokeFamily(token.familyId);
        this.log.warn(
          { userId: user.id, familyId: token.familyId },
          'refresh token reuse detected: session revoked',
        );
      }
      throw sessionExpired();
    }
    if (found.expired || user.deletedAt) throw sessionExpired();
    if (user.status === 'suspended') {
      await this.revokeFamily(token.familyId);
      throw suspended();
    }

    return this.db.transaction(async (tx) => {
      const session = await this.startSession(tx, toPublicUser(user), token.familyId, meta);
      const rotated = await tx
        .update(refreshTokens)
        .set({ revokedAt: sql`now()`, replacedBy: session.refreshTokenId })
        .where(and(eq(refreshTokens.id, token.id), isNull(refreshTokens.revokedAt)))
        .returning({ id: refreshTokens.id });
      if (rotated.length === 0) throw sessionExpired(); // lost a race with a parallel refresh
      return session;
    });
  }

  /** Ends this device's session (its whole refresh-token family). Unknown tokens are ignored. */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const [token] = await this.db
      .select({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashRefreshToken(rawToken)));
    if (token) await this.revokeFamily(token.familyId);
  }

  async getUser(userId: string): Promise<PublicUser> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user || user.deletedAt || !user.phone) throw sessionExpired();
    if (user.status === 'suspended') throw suspended();
    return toPublicUser(user);
  }

  async updateName(userId: string, name: string): Promise<PublicUser> {
    const [user] = await this.db
      .update(users)
      .set({ name })
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .returning();
    if (!user) throw sessionExpired();
    return toPublicUser(user);
  }

  /**
   * Account deletion (DPDP Act): personal data is erased, sessions are revoked. Orders stay
   * (stall accounting needs them) but no longer point to a phone or name.
   */
  async deleteAccount(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ phone: null, name: null, deletedAt: sql`now()` })
        .where(and(eq(users.id, userId), isNull(users.deletedAt)));
      await tx
        .update(refreshTokens)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    });
    this.log.info({ userId }, 'account deleted by its owner');
  }

  private async startSession(db: Db, user: PublicUser, familyId: string, meta: ClientMeta): Promise<Session> {
    const access = await signAccessToken(
      this.config.jwtSecret,
      { userId: user.id, role: user.role },
      AUTH_RULES.accessTokenSeconds,
    );
    const refresh = newRefreshToken();
    const [row] = await db
      .insert(refreshTokens)
      .values({
        userId: user.id,
        tokenHash: refresh.hash,
        familyId,
        expiresAt: sql`now() + make_interval(days => ${AUTH_RULES.refreshTokenDays})`,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300),
      })
      .returning({ id: refreshTokens.id, expiresAt: refreshTokens.expiresAt });
    return {
      user,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: refresh.raw,
      refreshTokenExpiresAt: row!.expiresAt,
      refreshTokenId: row!.id,
    };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }
}

function tooManyAttempts() {
  return new AppError(429, 'OTP_TOO_MANY_ATTEMPTS', 'Too many wrong codes. Request a new code.');
}

function toPublicUser(u: typeof users.$inferSelect): PublicUser {
  return { id: u.id, phone: u.phone ?? '', name: u.name, role: u.role };
}
