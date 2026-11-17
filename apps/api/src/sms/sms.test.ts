import { describe, expect, it, vi } from 'vitest';
import { createSmsProvider } from './index.js';
import { maskPhone } from './sms-provider.js';

describe('maskPhone', () => {
  it.each([
    ['+919876543210', '+91******3210'],
    ['9876543210', '987***3210'],
    ['12345', '12345'.slice(0, 3) + '2345'],
    ['1234', '****'],
    ['', '****'],
  ])('%s → %s', (input, expected) => {
    expect(maskPhone(input)).toBe(expected);
  });
});

describe('createSmsProvider', () => {
  it('console provider logs the message with a masked phone number', async () => {
    const info = vi.fn();
    const sms = createSmsProvider({ SMS_PROVIDER: 'console' }, { info });

    await sms.send({ to: '+919876543210', body: 'Your MOM login code is 482913' });

    expect(sms.name).toBe('console');
    expect(info).toHaveBeenCalledOnce();
    const [meta, msg] = info.mock.calls[0]!;
    expect(meta).toEqual({ sms: { provider: 'console', to: '+91******3210' } });
    expect(msg).toContain('482913');
    expect(JSON.stringify(meta)).not.toContain('9876543210');
  });

  it('aws provider is not available yet', () => {
    expect(() => createSmsProvider({ SMS_PROVIDER: 'aws' }, { info: vi.fn() })).toThrow(/issue #7/);
  });
});
