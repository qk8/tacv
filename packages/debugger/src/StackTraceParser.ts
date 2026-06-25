export interface StackFrame {
  file:    string;
  line:    number;
  method:  string;
  isUser:  boolean;
}

export class StackTraceParser {
  constructor(
    private readonly languageId:   string,
    private readonly userPackage?: string,
    private readonly userSrcRoot?: string,
  ) {}

  parseAndPrune(rawOutput: string, moduleType: string): StackFrame[] {
    const frames = this.languageId === 'java'
      ? this._parseJavaStack(rawOutput)
      : this._parseTsStack(rawOutput);

    const userFrames = frames.filter(f => f.isUser);
    // For brownfield: keep a few framework frames for context
    if (moduleType.includes('backend') && userFrames.length === 0) {
      return frames.slice(0, 5);
    }
    return userFrames.slice(0, 10);
  }

  private _parseJavaStack(output: string): StackFrame[] {
    const frames: StackFrame[] = [];
    for (const line of output.split('\n')) {
      const m = line.match(/\s+at\s+([\w.$]+)\.([\w$<>]+)\(([^:)]+):(\d+)\)/);
      if (!m) continue;
      const pkg = m[1] ?? '';
      frames.push({
        file:   m[3] ?? 'Unknown.java',
        line:   parseInt(m[4] ?? '0'),
        method: `${pkg}.${m[2]}`,
        isUser: this.userPackage ? pkg.startsWith(this.userPackage) : !this._isJavaFramework(pkg),
      });
    }
    return frames;
  }

  private _parseTsStack(output: string): StackFrame[] {
    const frames: StackFrame[] = [];
    for (const line of output.split('\n')) {
      // Node.js: "    at functionName (file.ts:10:5)"
      const m1 = line.match(/\s+at\s+(\S+)\s+\(([^:)]+):(\d+):\d+\)/);
      if (m1) {
        const file = m1[2] ?? '';
        frames.push({ file, line: parseInt(m1[3] ?? '0'), method: m1[1] ?? '<anonymous>', isUser: this._isTsUserCode(file) });
        continue;
      }
      // Anonymous: "    at file.ts:10:5"
      const m2 = line.match(/\s+at\s+([^(]+):(\d+):\d+/);
      if (m2) {
        const file = m2[1]?.trim() ?? '';
        frames.push({ file, line: parseInt(m2[2] ?? '0'), method: '<anonymous>', isUser: this._isTsUserCode(file) });
      }
    }
    return frames;
  }

  private _isJavaFramework(pkg: string): boolean {
    return ['java.', 'javax.', 'sun.', 'com.sun.', 'org.springframework.', 'org.hibernate.',
      'org.junit.', 'org.mockito.', 'ch.qos.'].some(p => pkg.startsWith(p));
  }

  private _isTsUserCode(file: string): boolean {
    if (file.includes('node_modules')) return false;
    if (file.includes('<anonymous>') || file.includes('internal/')) return false;
    const root = this.userSrcRoot ?? 'src';
    return file.includes(root) || file.includes('/app/') || file.startsWith('./');
  }
}
