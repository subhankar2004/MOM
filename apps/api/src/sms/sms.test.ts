import type { SendTextMessageCommand } from '@aws-sdk/client-pinpoint-sms-voice-v2';
import { describe, expect, it, vi } from 'vitest';
import { AwsSmsProvider } from './aws-sms-provider.js';
import { createSmsProvider } from './index.js';
import { maskPhone } from './sms-provider.js';

const consoleEnv = { SMS_PROVIDER: 'console', AWS_REGION: 'ap-south-1' } as const;

describe('maskPhone', () => {
  it.each([
    ['+919876543210', '+91******3210'],
    ['9876543210', '987***3210'],
    ['12345', '1232345'],
    ['1234', '****'],
    ['', '****'],
  ])('%s → %s', (input, expected) => {
    expect(maskPhone(input)).toBe(expected);
  });
});

describe('console provider', () => {
  it('logs the message with a masked phone number', async () => {
    const info = vi.fn();
    const sms = createSmsProvider(consoleEnv, { info });

    await sms.send({ to: '+919876543210', body: '482913 is your MOM login code.' });

    expect(sms.name).toBe('console');
    expect(info).toHaveBeenCalledOnce();
    const [meta, msg] = info.mock.calls[0]!;
    expect(meta).toEqual({ sms: { provider: 'console', to: '+91******3210' } });
    expect(msg).toContain('482913');
    expect(JSON.stringify(meta)).not.toContain('9876543210');
  });
});

describe('AWS provider', () => {
  const config = {
    region: 'ap-south-1',
    originationIdentity: 'MOMVST',
    dltEntityId: '1101000000000000001',
    dltTemplateId: '1107000000000000002',
  };

  it('sends a transactional SMS with the India DLT ids and never logs the code', async () => {
    const send = vi.fn(async (_cmd: SendTextMessageCommand) => ({ MessageId: 'msg-1' }));
    const info = vi.fn();
    const sms = new AwsSmsProvider(config, { info }, { send });

    await sms.send({ to: '+919876543210', body: '482913 is your MOM login code.' });

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0].input).toEqual({
      DestinationPhoneNumber: '+919876543210',
      OriginationIdentity: 'MOMVST',
      MessageBody: '482913 is your MOM login code.',
      MessageType: 'TRANSACTIONAL',
      DestinationCountryParameters: {
        IN_ENTITY_ID: '1101000000000000001',
        IN_TEMPLATE_ID: '1107000000000000002',
      },
    });
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain('msg-1');
    expect(logged).not.toContain('482913');
    expect(logged).not.toContain('9876543210');
  });

  it('surfaces AWS errors to the caller', async () => {
    const sms = new AwsSmsProvider(
      config,
      { info: vi.fn() },
      { send: vi.fn().mockRejectedValue(new Error('throttled')) },
    );
    await expect(sms.send({ to: '+919876543210', body: 'x' })).rejects.toThrow('throttled');
  });

  it('factory refuses to build without the DLT settings', () => {
    expect(() =>
      createSmsProvider({ SMS_PROVIDER: 'aws', AWS_REGION: 'ap-south-1' }, { info: vi.fn() }),
    ).toThrow(/AWS_SMS_ORIGINATION_IDENTITY/);
  });

  it('factory builds the AWS provider when configured', () => {
    const sms = createSmsProvider(
      {
        SMS_PROVIDER: 'aws',
        AWS_REGION: 'ap-south-1',
        AWS_SMS_ORIGINATION_IDENTITY: 'MOMVST',
        AWS_SMS_DLT_ENTITY_ID: '1',
        AWS_SMS_DLT_TEMPLATE_ID: '2',
      },
      { info: vi.fn() },
    );
    expect(sms.name).toBe('aws');
  });
});
