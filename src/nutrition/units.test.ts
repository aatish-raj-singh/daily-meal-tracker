import { describe, expect, it } from 'vitest';
import { conversionFactor, unitKind } from './units';

describe('unit conversion', () => {
  it('converts grams proportionally', () => {
    const r = conversionFactor(200, 'g', 100, 'g');
    expect(r.ok).toBe(true);
    expect(r.factor).toBeCloseTo(2);
  });

  it('converts oz to grams', () => {
    const r = conversionFactor(1, 'oz', 100, 'g');
    expect(r.ok).toBe(true);
    expect(r.factor).toBeCloseTo(28.349523125 / 100);
  });

  it('rejects incompatible mass/volume', () => {
    const r = conversionFactor(200, 'g', 100, 'ml');
    expect(r.ok).toBe(false);
  });

  it('detects unit kinds', () => {
    expect(unitKind('g')).toBe('mass');
    expect(unitKind('ml')).toBe('volume');
    expect(unitKind('serving')).toBe('count');
  });
});
