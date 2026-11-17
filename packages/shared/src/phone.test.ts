import { describe, expect, it } from 'vitest';
import { isIndianMobileE164, normalizeIndianMobile } from './phone.js';

describe('normalizeIndianMobile', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['098765-43210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['(+91) 6000000000', '+916000000000'],
  ])('%j → %s', (input, expected) => {
    expect(normalizeIndianMobile(input)).toBe(expected);
  });

  it.each([
    '',
    '12345',
    '5876543210', // Indian mobiles start with 6–9
    '+919876543',
    '+9198765432101',
    '+449876543210', // not India
    '98765abc10',
    '++919876543210',
  ])('rejects %j', (input) => {
    expect(normalizeIndianMobile(input)).toBeNull();
  });
});

describe('isIndianMobileE164', () => {
  it('only accepts the stored form', () => {
    expect(isIndianMobileE164('+919876543210')).toBe(true);
    expect(isIndianMobileE164('9876543210')).toBe(false);
    expect(isIndianMobileE164('+91 9876543210')).toBe(false);
  });
});
