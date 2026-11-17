import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const OTP_LENGTH = 6;

/** Uniformly random 6-digit code from the OS CSPRNG (leading zeros allowed). */
export function generateOtp(): string {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, '0');
}

/**
 * Codes are stored only as HMAC-SHA256(pepper, phone:code). A database leak alone does not
 * reveal codes, and the phone binds the hash so a code can't be replayed for another number.
 */
export function hashOtp(pepper: string, phone: string, code: string): string {
  return createHmac('sha256', pepper).update(`${phone}:${code}`).digest('hex');
}

/** Constant-time comparison, so response timing never hints at how close a guess was. */
export function otpMatches(pepper: string, phone: string, code: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashOtp(pepper, phone, code), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

/**
 * SMS text. Must match the DLT-registered template exactly ({#var#} = the code), see #28.
 */
export function otpMessage(code: string, validMinutes: number): string {
  return `${code} is your MOM login code. It is valid for ${validMinutes} minutes. Do not share it with anyone.`;
}
