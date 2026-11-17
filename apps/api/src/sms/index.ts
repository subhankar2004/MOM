import type { Env } from '../config/env.js';
import { AwsSmsProvider } from './aws-sms-provider.js';
import { ConsoleSmsProvider } from './console-sms-provider.js';
import type { SmsLogger, SmsProvider } from './sms-provider.js';

export type { SmsMessage, SmsProvider } from './sms-provider.js';

type SmsEnv = Pick<
  Env,
  | 'SMS_PROVIDER'
  | 'AWS_REGION'
  | 'AWS_SMS_ORIGINATION_IDENTITY'
  | 'AWS_SMS_DLT_ENTITY_ID'
  | 'AWS_SMS_DLT_TEMPLATE_ID'
>;

export function createSmsProvider(env: SmsEnv, logger: SmsLogger): SmsProvider {
  switch (env.SMS_PROVIDER) {
    case 'console':
      return new ConsoleSmsProvider(logger);
    case 'aws': {
      const { AWS_SMS_ORIGINATION_IDENTITY, AWS_SMS_DLT_ENTITY_ID, AWS_SMS_DLT_TEMPLATE_ID } = env;
      if (!AWS_SMS_ORIGINATION_IDENTITY || !AWS_SMS_DLT_ENTITY_ID || !AWS_SMS_DLT_TEMPLATE_ID) {
        throw new Error(
          'AWS SMS needs AWS_SMS_ORIGINATION_IDENTITY, AWS_SMS_DLT_ENTITY_ID and AWS_SMS_DLT_TEMPLATE_ID',
        );
      }
      return new AwsSmsProvider(
        {
          region: env.AWS_REGION,
          originationIdentity: AWS_SMS_ORIGINATION_IDENTITY,
          dltEntityId: AWS_SMS_DLT_ENTITY_ID,
          dltTemplateId: AWS_SMS_DLT_TEMPLATE_ID,
        },
        logger,
      );
    }
  }
}
