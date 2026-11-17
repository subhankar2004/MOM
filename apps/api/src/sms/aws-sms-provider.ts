import {
  PinpointSMSVoiceV2Client,
  SendTextMessageCommand,
  type SendTextMessageCommandInput,
} from '@aws-sdk/client-pinpoint-sms-voice-v2';
import type { SmsLogger, SmsMessage, SmsProvider } from './sms-provider.js';
import { maskPhone } from './sms-provider.js';

export interface AwsSmsConfig {
  region: string;
  /** DLT-registered sender ID (header). */
  originationIdentity: string;
  /** DLT principal entity ID. */
  dltEntityId: string;
  /** DLT content template ID — the message body must match the registered template exactly. */
  dltTemplateId: string;
}

/** Anything with a `send(command)` — the real client, or a fake in tests. */
export interface SmsClientLike {
  send(command: SendTextMessageCommand): Promise<{ MessageId?: string }>;
}

/**
 * AWS End User Messaging SMS (Pinpoint SMS v2). Credentials come from the ECS task
 * IAM role on AWS; nothing secret is configured here. India requires the DLT entity and
 * template ids on every message (TRAI rules), passed as DestinationCountryParameters.
 */
export class AwsSmsProvider implements SmsProvider {
  readonly name = 'aws';
  private readonly client: SmsClientLike;

  constructor(
    private readonly config: AwsSmsConfig,
    private readonly logger: SmsLogger,
    client?: SmsClientLike,
  ) {
    this.client = client ?? new PinpointSMSVoiceV2Client({ region: config.region });
  }

  async send({ to, body }: SmsMessage): Promise<void> {
    const input: SendTextMessageCommandInput = {
      DestinationPhoneNumber: to,
      OriginationIdentity: this.config.originationIdentity,
      MessageBody: body,
      MessageType: 'TRANSACTIONAL',
      DestinationCountryParameters: {
        IN_ENTITY_ID: this.config.dltEntityId,
        IN_TEMPLATE_ID: this.config.dltTemplateId,
      },
    };
    const result = await this.client.send(new SendTextMessageCommand(input));
    // Never log the body: it contains the OTP.
    this.logger.info(
      { sms: { provider: this.name, to: maskPhone(to), messageId: result.MessageId } },
      'SMS sent',
    );
  }
}
