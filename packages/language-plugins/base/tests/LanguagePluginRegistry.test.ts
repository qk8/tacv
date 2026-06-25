import { describe, it, expect } from 'vitest';
import { LanguagePluginRegistry, PluginNotFoundError } from '../src/LanguagePluginRegistry.js';
import type { ILanguagePlugin } from '../src/ILanguagePlugin.js';

function makePlugin(languageId: string, extensions: string[]): ILanguagePlugin {
  return { metadata: { languageId, displayName: languageId, extensions, testFramework: '', buildTool: '' } } as unknown as ILanguagePlugin;
}

describe('LanguagePluginRegistry', () => {
  it('registers and retrieves a plugin', () => {
    const registry = new LanguagePluginRegistry();
    registry.register(makePlugin('typescript', ['.ts', '.tsx']));
    expect(registry.get('typescript').metadata.languageId).toBe('typescript');
  });

  it('throws PluginNotFoundError for unknown language', () => {
    const registry = new LanguagePluginRegistry();
    expect(() => registry.get('rust')).toThrow(PluginNotFoundError);
    expect(() => registry.get('rust')).toThrow(/rust/);
  });

  it('getForFile returns null for unknown extension', () => {
    const registry = new LanguagePluginRegistry();
    registry.register(makePlugin('typescript', ['.ts']));
    expect(registry.getForFile('Main.java')).toBeNull();
  });

  it('getForFile returns correct plugin by extension', () => {
    const registry = new LanguagePluginRegistry();
    registry.register(makePlugin('typescript', ['.ts', '.tsx']));
    registry.register(makePlugin('java', ['.java']));
    expect(registry.getForFile('App.tsx')?.metadata.languageId).toBe('typescript');
    expect(registry.getForFile('Main.java')?.metadata.languageId).toBe('java');
  });

  it('getAll returns all registered plugins', () => {
    const registry = new LanguagePluginRegistry();
    registry.register(makePlugin('typescript', ['.ts']));
    registry.register(makePlugin('java', ['.java']));
    expect(registry.getAll()).toHaveLength(2);
  });
});
