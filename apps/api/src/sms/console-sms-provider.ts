import type { SmsLogger, SmsMessage, SmsProvider } from './sms-provider.js';
import { maskPhone } from './sms-provider.js';

/**
 * Local-development provider: the "SMS" (with the OTP) appears in the API terminal.
 * Config validation (env.ts) forbids this provider in production.
 */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';

  constructor(private readonly logger: SmsLogger) {}

  async send({ to, body }: SmsMessage): Promise<void> {
    this.logger.info(
      { sms: { provider: this.name, to: maskPhone(to) } },
      `📱 SMS (not really sent): ${body}`,
    );
  }
}
