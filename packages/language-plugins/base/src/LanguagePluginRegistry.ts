import type { ILanguagePlugin } from './ILanguagePlugin.js';

export class PluginNotFoundError extends Error {
  constructor(languageId: string, registered: string[]) {
    super(`No plugin registered for language '${languageId}'. Registered: [${registered.join(', ')}]`);
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
    for (const plugin of this.plugins.values()) {
      if (plugin.metadata.extensions.includes(ext)) return plugin;
    }
    return null;
  }

  getAll(): ILanguagePlugin[] { return [...this.plugins.values()]; }
  has(languageId: string): boolean { return this.plugins.has(languageId); }
}
