import type { Logger } from 'pino';
import type { WorkflowConfig } from '../config/index.js';
import type { IAgentProvider }       from '../interfaces/IAgentProvider.js';
import type { IStructuredExtractor } from '../interfaces/IStructuredExtractor.js';
import type { IMemoryProvider }      from '../interfaces/IMemoryProvider.js';
import type { ISandboxProvider }     from '../interfaces/ISandboxProvider.js';
import type { ICodeGraphProvider }   from '../interfaces/ICodeGraphProvider.js';
import type { ILibraryDocsProvider } from '../interfaces/ILibraryDocsProvider.js';

/**
 * Re-export ILanguagePlugin from @tacv/language-plugins-base.
 *
 * Previously ActivityDeps.ts defined a hand-rolled copy called
 * ILanguagePluginMinimal to work around a circular package dependency
 * (core → language-plugins-base → core/state).
 *
 * That cycle is broken by @tacv/contracts: both core and language-plugins-base
 * now depend on @tacv/contracts for shared types, so core can safely import
 * the real ILanguagePlugin interface without creating a circular dep.
 */
export type {
  ILanguagePlugin,
  IFrameworkProfile,
  LanguageSyntaxInfo,
  IStackParser,
  DebugAdapterSpec,
} from '@tacv/language-plugins-base';

import type { ILanguagePlugin, IFrameworkProfile } from '@tacv/language-plugins-base';

/**
 * Minimal registry interface used by activities.
 * Concrete implementation lives in @tacv/language-plugins-base (LanguagePluginRegistry).
 */
export interface LanguagePluginRegistry {
  get(languageId: string): ILanguagePlugin;
  getForFile(filePath: string): ILanguagePlugin | null;
  getForExtension(ext: string): ILanguagePlugin | null;
  getAll(): ILanguagePlugin[];
  has(languageId: string): boolean;
}

export interface ActivityDeps {
  readonly config:         WorkflowConfig;
  readonly agent:          IAgentProvider;
  readonly extractor:      IStructuredExtractor;
  readonly memory:         IMemoryProvider;
  readonly sandbox:        ISandboxProvider;
  readonly codeGraph:      ICodeGraphProvider;
  readonly libraryDocs:    ILibraryDocsProvider;
  readonly pluginRegistry: LanguagePluginRegistry;
  readonly log:            Logger;
  readonly repoPath:       string;
  readonly taskId:         string;
  readonly sessionId:      string;
  /** Optional heartbeat callback for long-running activities. */
  readonly heartbeat?:     (data?: unknown) => void;
}
