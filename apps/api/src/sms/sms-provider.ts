/**
 * Sending SMS (login OTPs) behind one small interface, so the rest of the API
 * never cares which provider is used:
 *
 *   - `console` (local dev): prints the message to the API logs — no SMS is sent.
 *   - `aws`     (staging/prod): AWS End User Messaging SMS with India DLT IDs (#7, switched on in #28).
 */
export interface SmsMessage {
  /** E.164 phone number, e.g. +919876543210 */
  to: string;
  body: string;
}

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<void>;
}

/** The subset of a logger (pino-compatible) that providers need. */
export interface SmsLogger {
  info(obj: object, msg: string): void;
}

/** Shows only the last 4 digits: +91******3210 */
export function maskPhone(phone: string): string {
  return phone.length <= 4
    ? '****'
    : `${phone.slice(0, 3)}${'*'.repeat(Math.max(phone.length - 7, 0))}${phone.slice(-4)}`;
}
