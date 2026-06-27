import type { IStackParser, StackParserOptions } from '@tacv/language-plugins-base';
import type { StackFrame } from '@tacv/contracts';

const FRAMEWORK_DIRS = [
  'node_modules', 'internal/bootstrap', 'node:internal',
];

const AT_FRAME_RE = /^\s+at\s+(.+?)\s+\((.+):(\d+):\d+\)$/;
const AT_ANON_RE  = /^\s+at\s+(.+):(\d+):\d+$/;

export class TypeScriptStackParser implements IStackParser {
  private readonly userRoot: string;

  constructor(options?: StackParserOptions) {
    this.userRoot = options?.userRoot ?? 'src';
  }

  parseAndPrune(rawOutput: string, _moduleType: string): StackFrame[] {
    const frames: StackFrame[] = [];

    for (const line of rawOutput.split('\n')) {
      const named = AT_FRAME_RE.exec(line);
      if (named) {
        const [, method = '', file = '', lineStr = '0'] = named;
        const frame = this._toFrame(method.trim(), file.trim(), parseInt(lineStr, 10));
        if (frame) frames.push(frame);
        continue;
      }
      const anon = AT_ANON_RE.exec(line);
      if (anon) {
        const [, file = '', lineStr = '0'] = anon;
        const frame = this._toFrame('<anonymous>', file.trim(), parseInt(lineStr, 10));
        if (frame) frames.push(frame);
      }
    }

    // Return only user frames (prune framework noise)
    return frames.filter(f => f.isUser);
  }

  private _toFrame(method: string, file: string, line: number): StackFrame | null {
    if (!file) return null;
    const isUser = this._isUserCode(file);
    return { file, line, method, isUser };
  }

  private _isUserCode(file: string): boolean {
    if (FRAMEWORK_DIRS.some(d => file.includes(d))) return false;
    // If we have a userRoot set, require the file to start with it
    if (this.userRoot && !file.startsWith('/')) {
      return file.startsWith(this.userRoot);
    }
    return true;
  }
}
