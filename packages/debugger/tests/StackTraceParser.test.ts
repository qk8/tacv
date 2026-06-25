import { describe, it, expect } from 'vitest';
import { StackTraceParser } from '../src/StackTraceParser.js';

describe('StackTraceParser — Java', () => {
  const parser = new StackTraceParser('java', 'com.example');

  it('parses Java stack trace and flags user frames', () => {
    const raw = `java.lang.NullPointerException
  at com.example.service.UserService.findById(UserService.java:45)
  at com.example.controller.UserController.getUser(UserController.java:23)
  at org.springframework.web.servlet.FrameworkServlet.service(FrameworkServlet.java:897)
  at javax.servlet.http.HttpServlet.service(HttpServlet.java:764)`;
    const frames = parser.parseAndPrune(raw, 'backend');
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every(f => f.isUser)).toBe(true);
    expect(frames[0]?.file).toContain('UserService.java');
  });

  it('excludes Spring framework frames', () => {
    const raw = `  at org.springframework.web.servlet.DispatcherServlet.doDispatch(DispatcherServlet.java:1072)`;
    const frames = parser.parseAndPrune(raw, 'backend');
    expect(frames.filter(f => f.isUser)).toHaveLength(0);
  });
});

describe('StackTraceParser — TypeScript', () => {
  const parser = new StackTraceParser('typescript', undefined, 'src');

  it('parses Node.js stack trace', () => {
    const raw = `TypeError: Cannot read properties of undefined (reading 'id')
    at UserService.findById (src/services/UserService.ts:45:18)
    at /app/node_modules/express/lib/router/layer.js:95:5`;
    const frames = parser.parseAndPrune(raw, 'backend');
    expect(frames.some(f => f.file.includes('UserService'))).toBe(true);
    expect(frames.some(f => f.file.includes('node_modules'))).toBe(false);
  });

  it('returns empty for output with no recognizable stack', () => {
    const frames = parser.parseAndPrune('Build failed: syntax error', 'backend');
    expect(frames).toHaveLength(0);
  });
});
