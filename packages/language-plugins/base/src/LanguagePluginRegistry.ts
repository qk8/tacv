import type { ILanguagePlugin } from './ILanguagePlugin.js';

export class PluginNotFoundError extends Error {
  constructor(languageId: string, registered: string[]) {
    super(
      `No plugin registered for language '${languageId}'. ` +
      `Available: [${registered.join(', ')}]. ` +
      `Install @tacv/plugin-${languageId} and register it in worker.ts.`,
    );
    this.name = 'PluginNotFoundError';
  }
}

export class LanguagePluginRegistry {
  private readonly plugins = new Map<string, ILanguagePlugin>();

  register(plugin: ILanguagePlugin): void {
    this.plugins.set(plugin.metadata.languageId, plugin);
  }

  get(languageId: string): ILanguagePlugin {
    const plugin = this.plugins.get(languageId);
    if (!plugin) throw new PluginNotFoundError(languageId, [...this.plugins.keys()]);
    return plugin;
  }

  getForFile(filePath: string): ILanguagePlugin | null {
    const ext = '.' + (filePath.split('.').pop()?.toLowerCase() ?? '');
    return this.getForExtension(ext);
  }

  /**
   * Finds a plugin by file extension string (must include the leading dot).
   * Used by AstDiffAnalyzer and other consumers that work with file paths.
   */
  getForExtension(ext: string): ILanguagePlugin | null {
    const normalised = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
    for (const plugin of this.plugins.values()) {
      if (plugin.metadata.extensions.includes(normalised)) return plugin;
    }
    return null;
  }

  getAll(): ILanguagePlugin[] { return [...this.plugins.values()]; }
  has(languageId: string): boolean { return this.plugins.has(languageId); }
}
