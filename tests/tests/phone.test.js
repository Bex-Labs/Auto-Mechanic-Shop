import { describe, it, expect } from 'vitest';

function normalisePhone(raw) {
  let phone = raw.replace(/[\s\-().+]/g, '');
  if (phone.startsWith('0'))         phone = '234' + phone.slice(1);
  else if (phone.startsWith('+234')) phone = phone.slice(1);
  return phone;
}

describe('normalisePhone — Nigerian number formatting', () => {
  it('converts 0801... to 2348...', () => {
    expect(normalisePhone('08012345678')).toBe('2348012345678');
  });

  it('strips the + from +234...', () => {
    expect(normalisePhone('+2348012345678')).toBe('2348012345678');
  });

  it('strips spaces', () => {
    expect(normalisePhone('0801 234 5678')).toBe('2348012345678');
  });

  it('strips dashes', () => {
    expect(normalisePhone('0801-234-5678')).toBe('2348012345678');
  });

  it('leaves already-normalised number unchanged', () => {
    expect(normalisePhone('2348012345678')).toBe('2348012345678');
  });
});