import type { IStackParser, StackParserOptions } from '@tacv/language-plugins-base';
import type { StackFrame } from '@tacv/contracts';

const FRAMEWORK_PREFIXES = [
  'java.', 'javax.', 'jakarta.', 'sun.', 'com.sun.',
  'org.springframework.', 'org.hibernate.', 'org.apache.',
  'io.undertow.', 'com.zaxxer.', 'org.jboss.', 'ch.qos.logback.',
  'io.netty.', 'reactor.', 'com.fasterxml.', 'org.reflections.',
];

// at com.example.service.UserService.findById(UserService.java:45)
const JAVA_FRAME_RE = /^\s+at\s+([\w$.]+)\.([\w$<>]+)\(([^:)]+):(\d+)\)$/;

export class JavaStackParser implements IStackParser {
  private readonly userPackagePrefix: string;

  constructor(options?: StackParserOptions) {
    this.userPackagePrefix = options?.userPackagePrefix ?? '';
  }

  parseAndPrune(rawOutput: string, _moduleType: string): StackFrame[] {
    const frames: StackFrame[] = [];

    for (const line of rawOutput.split('\n')) {
      const m = JAVA_FRAME_RE.exec(line);
      if (!m) continue;
      const [, fqClass = '', method = '', file = '', lineStr = '0'] = m;
      const isUser = this._isUserCode(fqClass);
      frames.push({ file, line: parseInt(lineStr, 10), method: `${fqClass}.${method}`, isUser });
    }

    return frames.filter(f => f.isUser);
  }

  private _isUserCode(fqClass: string): boolean {
    if (FRAMEWORK_PREFIXES.some(p => fqClass.startsWith(p))) return false;
    if (this.userPackagePrefix) return fqClass.startsWith(this.userPackagePrefix);
    return true;
  }
}
