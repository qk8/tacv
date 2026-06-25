import type { ILibraryDocsProvider, DetectedDependency, ResolvedDocs, LibraryDoc } from '@tacv/core/interfaces';

const HIGH_CHURN = new Set(['react','next','nuxt','vite','astro','spring-boot','spring-security','fastify','hono','@anthropic-ai/sdk']);

export class Context7DocsProvider implements ILibraryDocsProvider {
  isEnabled(): boolean { return Boolean(process.env['UPSTASH_CONTEXT7_API_KEY']); }

  async resolve(dependencies: DetectedDependency[]): Promise<ResolvedDocs> {
    const relevant = dependencies.filter(d => HIGH_CHURN.has(d.name) || d.version.startsWith('^')).slice(0, 6);
    if (relevant.length === 0) return { libraries: [], tokenEstimate: 0 };

    let Context7Client: new () => { getLibraryDocs: (name: string, version: string) => Promise<Record<string, string>> };
    try {
      const mod = await import('@upstash/context7');
      Context7Client = mod.Context7Client ?? mod.default;
    } catch { return { libraries: [], tokenEstimate: 0 }; }

    const client = new Context7Client();
    const results = await Promise.allSettled(relevant.map(d => client.getLibraryDocs(d.name, d.version)));
    const libraries: LibraryDoc[] = results
      .filter((r): r is PromiseFulfilledResult<Record<string, string>> => r.status === 'fulfilled')
      .map(r => ({
        library:  r.value['library'] ?? '',
        version:  r.value['version'] ?? '',
        summary:  (r.value['summary'] ?? '').slice(0, 800),
        apiNotes: (r.value['apiNotes'] ?? r.value['changelog'] ?? '').slice(0, 400),
      }));
    return { libraries, tokenEstimate: libraries.reduce((a, l) => a + Math.ceil((l.summary.length + l.apiNotes.length) / 4), 0) };
  }
}

export class DisabledDocsProvider implements ILibraryDocsProvider {
  isEnabled(): boolean { return false; }
  async resolve(): Promise<ResolvedDocs> { return { libraries: [], tokenEstimate: 0 }; }
}
