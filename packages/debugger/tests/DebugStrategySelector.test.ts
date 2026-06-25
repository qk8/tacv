import { describe, it, expect } from 'vitest';
import { classifyError, selectStrategy } from '../src/DebugStrategySelector.js';

describe('classifyError', () => {
  it('classifies Java NPE', () => expect(classifyError('NullPointerException at line 45', 'java')).toBe('NULL_REFERENCE'));
  it('classifies BeanCreationException', () => expect(classifyError('BeanCreationException: No bean of type...', 'java')).toBe('BEAN_CREATION_ERROR'));
  it('classifies TS TypeError', () => expect(classifyError("TypeError: Cannot read properties of undefined (reading 'id')", 'typescript')).toBe('NULL_REFERENCE'));
  it('classifies React state mismatch', () => expect(classifyError("Can't perform a React state update on an unmounted component", 'typescript')).toBe('REACT_STATE_MISMATCH'));
  it('classifies HTTP 400', () => expect(classifyError('Request failed with status code 400 Bad Request', 'java')).toBe('HTTP_400'));
  it('returns UNKNOWN for unrecognised error', () => expect(classifyError('Something went completely wrong', 'typescript')).toBe('UNKNOWN'));
});

describe('selectStrategy', () => {
  it('NULL_REFERENCE → breakpoint tool', () => expect(selectStrategy('NULL_REFERENCE', 'java').tool).toBe('breakpoint'));
  it('BEAN_CREATION_ERROR → actuator tool', () => expect(selectStrategy('BEAN_CREATION_ERROR', 'java').tool).toBe('actuator'));
  it('VALIDATION_ERROR → delta_debug tool', () => expect(selectStrategy('VALIDATION_ERROR', 'java').tool).toBe('delta_debug'));
  it('REACT_STATE_MISMATCH → playwright tool', () => expect(selectStrategy('REACT_STATE_MISMATCH', 'typescript').tool).toBe('playwright'));
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
