import type { IStackParser } from '@tacv/language-plugins-base';
import type { StackFrame } from '@tacv/contracts';

const MAX_FRAMES = 10;

/**
 * Thin coordinator that delegates all language-specific stack parsing to the
 * `IStackParser` returned by `plugin.createStackParser()`.
 *
 * Previously this class contained private `_parseJavaStack` / `_parseTsStack`
 * methods and dispatched by string comparison (`languageId === 'java'`).
 * That logic now lives in `JavaStackParser` and `TypeScriptStackParser`
 * inside their respective plugin packages.
 */
export class StackTraceParser {
  constructor(private readonly pluginParser: IStackParser) {}

  parseAndPrune(rawOutput: string, moduleType: string): StackFrame[] {
    const frames = this.pluginParser.parseAndPrune(rawOutput, moduleType);
    return frames.slice(0, MAX_FRAMES);
  }
}

// Re-export StackFrame from @tacv/contracts for callers that import from here
export type { StackFrame };
