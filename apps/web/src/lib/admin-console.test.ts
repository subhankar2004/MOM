import { describe, expect, it } from 'vitest';
import { queryString } from './admin-console';

describe('queryString', () => {
  it('keeps only filled-in values, trimmed and encoded', () => {
    expect(queryString({ q: ' #12 ', role: '', status: undefined, stallId: 'abc' })).toBe(
      '?q=%2312&stallId=abc',
    );
    expect(queryString({ q: '  ' })).toBe('');
  });
});
