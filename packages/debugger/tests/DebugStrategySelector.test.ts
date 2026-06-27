import { describe, it, expect } from 'vitest';
import { classifyError, classifyErrorWithPlugin, selectStrategy } from '../src/DebugStrategySelector.js';
import type { ILanguagePlugin } from '@tacv/language-plugins-base';
import type { ErrorType } from '@tacv/contracts';

// ── Minimal plugin stub for plugin-delegated classifyError tests ──────────────
function makePlugin(patterns: Array<[RegExp[], ErrorType]>): Pick<ILanguagePlugin, 'getErrorPatterns'> {
  return { getErrorPatterns: () => patterns };
}

describe('classifyError (legacy string-ID API — backward compat)', () => {
  it('classifies Java NPE', () =>
    expect(classifyError('NullPointerException at line 45', 'java')).toBe('NULL_REFERENCE'));
  it('classifies BeanCreationException', () =>
    expect(classifyError('BeanCreationException: No bean of type...', 'java')).toBe('BEAN_CREATION_ERROR'));
  it('classifies TS TypeError', () =>
    expect(classifyError("TypeError: Cannot read properties of undefined (reading 'id')", 'typescript')).toBe('NULL_REFERENCE'));
  it('classifies React state mismatch', () =>
    expect(classifyError("Can't perform a React state update on an unmounted component", 'typescript')).toBe('REACT_STATE_MISMATCH'));
  it('classifies HTTP 400', () =>
    expect(classifyError('Request failed with status code 400 Bad Request', 'java')).toBe('HTTP_400'));
  it('returns UNKNOWN for unrecognised error', () =>
    expect(classifyError('Something went completely wrong', 'typescript')).toBe('UNKNOWN'));
});

describe('classifyErrorWithPlugin (new plugin-delegated API)', () => {
  it('delegates to plugin.getErrorPatterns()', () => {
    const plugin = makePlugin([[[/DatabaseError/], 'DATABASE_ERROR']]);
    expect(classifyErrorWithPlugin('DatabaseError: connection refused', plugin)).toBe('DATABASE_ERROR');
  });

  it('still applies HTTP prefix checks before plugin patterns', () => {
    const plugin = makePlugin([[[/NullPointerException/], 'NULL_REFERENCE']]);
    expect(classifyErrorWithPlugin('HTTP 400 Bad Request', plugin)).toBe('HTTP_400');
  });

  it('returns UNKNOWN when no plugin pattern matches', () => {
    const plugin = makePlugin([]);
    expect(classifyErrorWithPlugin('an unusual error message', plugin)).toBe('UNKNOWN');
  });

  it('first matching pattern wins', () => {
    const plugin = makePlugin([
      [[/NPE/],   'NULL_REFERENCE'],
      [[/Error/], 'LOGIC_ERROR'],
    ]);
    expect(classifyErrorWithPlugin('NPE Error occurred', plugin)).toBe('NULL_REFERENCE');
  });
});

describe('selectStrategy', () => {
  it('NULL_REFERENCE → breakpoint tool', () =>
    expect(selectStrategy('NULL_REFERENCE', 'java').tool).toBe('breakpoint'));
  it('BEAN_CREATION_ERROR → actuator tool', () =>
    expect(selectStrategy('BEAN_CREATION_ERROR', 'java').tool).toBe('actuator'));
  it('VALIDATION_ERROR → delta_debug tool', () =>
    expect(selectStrategy('VALIDATION_ERROR', 'java').tool).toBe('delta_debug'));
  it('REACT_STATE_MISMATCH → playwright tool', () =>
    expect(selectStrategy('REACT_STATE_MISMATCH', 'typescript').tool).toBe('playwright'));
  it('all strategies have a focusHint', () => {
    const types = ['NULL_REFERENCE', 'BEAN_CREATION_ERROR', 'VALIDATION_ERROR', 'REACT_STATE_MISMATCH', 'UNKNOWN'] as const;
    for (const t of types) expect(selectStrategy(t, 'java').focusHint.length).toBeGreaterThan(0);
  });
  it('UNKNOWN → breakpoint with maxSteps=5', () => {
    const s = selectStrategy('UNKNOWN', 'java');
    expect(s.tool).toBe('breakpoint');
    expect(s.maxSteps).toBe(5);
  });
});
