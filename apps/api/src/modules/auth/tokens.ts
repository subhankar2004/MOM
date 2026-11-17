import { createHash, randomBytes } from 'node:crypto';
import { errors as joseErrors, jwtVerify, SignJWT } from 'jose';

export type Role = 'student' | 'vendor_owner' | 'vendor_staff' | 'super_admin';
const ROLES: readonly Role[] = ['student', 'vendor_owner', 'vendor_staff', 'super_admin'];

const ISSUER = 'mom-api';
const AUDIENCE = 'mom';
const ALG = 'HS256';

export interface AccessClaims {
  userId: string;
  role: Role;
}

const key = (secret: string) => new TextEncoder().encode(secret);

/** Short-lived (15 min) signed access token. Stateless: checked without a database call. */
export async function signAccessToken(
  secret: string,
  claims: AccessClaims,
  ttlSeconds: number,
): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const token = await new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(key(secret));
  return { token, expiresAt };
}

export type VerifyResult = { ok: true; claims: AccessClaims } | { ok: false; reason: 'expired' | 'invalid' };

export async function verifyAccessToken(secret: string, token: string): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALG], // pin the algorithm: never accept "none" or a different one
    });
    const role = payload.role as Role;
    if (typeof payload.sub !== 'string' || !ROLES.includes(role)) return { ok: false, reason: 'invalid' };
    return { ok: true, claims: { userId: payload.sub, role } };
  } catch (err) {
    return { ok: false, reason: err instanceof joseErrors.JWTExpired ? 'expired' : 'invalid' };
  }
}

/** Opaque 256-bit refresh token. Only its SHA-256 is stored, so a DB leak can't be replayed. */
export function newRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashRefreshToken(raw) };
}

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
