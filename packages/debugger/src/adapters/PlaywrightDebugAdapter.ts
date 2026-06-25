import type { DebugObservations } from '@tacv/core/state';
import type { ISandboxProvider, SandboxHandle } from '@tacv/core/interfaces';
import { createLogger } from '@tacv/core/observability';

const log = createLogger('tacv.debugger.playwright');

export interface ReactDebugResult {
  reactDevToolsPresent: boolean;
  componentCount:       number | null;
  storeState:           unknown;
  routerState:          unknown;
  rawEvals:             Record<string, unknown>;
}

export class PlaywrightDebugAdapter {
  async captureReactState(
    obs:    DebugObservations,
    handle: SandboxHandle,
    sandbox: ISandboxProvider,
    baseUrl: string = 'http://localhost:3000',
  ): Promise<DebugObservations> {
    log.info('playwright_debug.start', { url: baseUrl });

    const EVAL_EXPRESSIONS = [
      `window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size`,
      `JSON.stringify(window.__REDUX_STORE__?.getState?.() ?? {})`,
      `window.__NEXT_DATA__ ? JSON.stringify({ page: window.__NEXT_DATA__.page, props: Object.keys(window.__NEXT_DATA__.props ?? {}) }) : null`,
      `document.querySelector('[data-testid]') ? 'data-testid attributes present' : 'none found'`,
    ];

    let result: ReactDebugResult = {
      reactDevToolsPresent: false, componentCount: null,
      storeState: null, routerState: null, rawEvals: {},
    };

    try {
      // Use Playwright via Docker exec
      const script = `
        import { chromium } from 'playwright';
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto('${baseUrl}', { waitUntil: 'networkidle', timeout: 15000 });
        const results = {};
        ${EVAL_EXPRESSIONS.map((expr, i) => `try { results.r${i} = await page.evaluate(() => ${expr}); } catch(e) { results.r${i} = e.message; }`).join('\n')}
        console.log(JSON.stringify(results));
        await browser.close();
      `;

      const execResult = await sandbox.execInContainer(handle,
        `node --input-type=module << 'PLAYEOF'\n${script}\nPLAYEOF`,
        { timeoutMs: 30_000 },
      );

      if (execResult.exitCode === 0) {
        const match = execResult.stdout.match(/\{.*\}/s);
        if (match) {
          const evals = JSON.parse(match[0]) as Record<string, unknown>;
          result = {
            reactDevToolsPresent: Boolean(evals['r0'] && Number(evals['r0']) > 0),
            componentCount: typeof evals['r0'] === 'number' ? evals['r0'] : null,
            storeState:     evals['r1'] ? JSON.parse(String(evals['r1'])) : null,
            routerState:    evals['r2'] ? JSON.parse(String(evals['r2'])) : null,
            rawEvals:       evals,
          };
        }
      }
    } catch (err) {
      log.warn('playwright_debug.failed', { error: String(err) });
    }

    log.info('playwright_debug.complete', {
      reactPresent: result.reactDevToolsPresent,
      hasStore:     result.storeState !== null,
    });

    return { ...obs, minimalPayload: result as unknown as Record<string, unknown> };
  }
}
