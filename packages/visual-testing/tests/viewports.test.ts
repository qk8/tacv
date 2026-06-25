import { describe, it, expect } from 'vitest';
import { VIEWPORTS, ALL_VIEWPORTS } from '../src/viewports.js';

describe('VIEWPORTS', () => {
  it('defines five standard viewports', () => {
    expect(Object.keys(VIEWPORTS)).toHaveLength(5);
    expect(VIEWPORTS).toHaveProperty('mobile');
    expect(VIEWPORTS).toHaveProperty('tablet');
    expect(VIEWPORTS).toHaveProperty('desktop');
  });

  it('mobile is narrower than desktop', () => {
    expect(VIEWPORTS.mobile.width).toBeLessThan(VIEWPORTS.desktop.width);
  });

  it('ALL_VIEWPORTS has same count as VIEWPORTS', () => {
    expect(ALL_VIEWPORTS).toHaveLength(Object.keys(VIEWPORTS).length);
  });

  it('ALL_VIEWPORTS entries have valid width/height', () => {
    for (const [, vp] of ALL_VIEWPORTS) {
      expect(vp.width).toBeGreaterThan(0);
      expect(vp.height).toBeGreaterThan(0);
    }
  });
});
