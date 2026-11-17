import type { Env } from '../config/env.js';
import { ConsoleSmsProvider } from './console-sms-provider.js';
import type { SmsLogger, SmsProvider } from './sms-provider.js';

export type { SmsMessage, SmsProvider } from './sms-provider.js';

export function createSmsProvider(env: Pick<Env, 'SMS_PROVIDER'>, logger: SmsLogger): SmsProvider {
  switch (env.SMS_PROVIDER) {
    case 'console':
      return new ConsoleSmsProvider(logger);
    case 'aws':
      throw new Error('The AWS SMS provider is implemented in issue #7');
  }
}
