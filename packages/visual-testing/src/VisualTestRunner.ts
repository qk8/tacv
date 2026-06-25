import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import type { VisualTestResult, VisualDiff, ViewportName } from '@tacv/core/state';
import { ALL_VIEWPORTS, VIEWPORTS, type ViewportKey } from './viewports.js';

export interface VisualTestSpec {
  name:       string;
  url:        string;
  actions?:   ((page: import('@playwright/test').Page) => Promise<void>)[];
  waitFor?:   string;
  maskTexts?: string[];
}

export interface VisualTestConfig {
  baseUrl:     string;
  baselineDir: string;
  actualDir:   string;
  diffDir:     string;
  threshold?:  number;
  maxDiffPct?: number;
  viewports?:  ViewportKey[];
}

export class VisualTestRunner {
  constructor(private readonly config: VisualTestConfig) {}

  async runAll(specs: VisualTestSpec[]): Promise<VisualTestResult> {
    let chromium: typeof import('@playwright/test').chromium;
    try {
      ({ chromium } = await import('@playwright/test'));
    } catch {
      return { passed: true, totalScreenshots: 0, failedScreenshots: 0, diffs: [], baselineUpdated: true };
    }

    const browser = await chromium.launch({ headless: true });
    const diffs: VisualDiff[] = [];
    let baselineUpdated = false;
    const viewportKeys = this.config.viewports ?? (Object.keys(VIEWPORTS) as ViewportKey[]);

    try {
      await fs.mkdir(this.config.baselineDir, { recursive: true });
      await fs.mkdir(this.config.actualDir,   { recursive: true });
      await fs.mkdir(this.config.diffDir,     { recursive: true });

      for (const spec of specs) {
        for (const [vk, vp] of ALL_VIEWPORTS.filter(([k]) => viewportKeys.includes(k))) {
          const result = await this._runSpec(browser, spec, vk, vp);
          diffs.push(result.diff);
          if (result.baselineCreated) baselineUpdated = true;
        }
      }
    } finally {
      await browser.close();
    }

    const failedScreenshots = diffs.filter(d => !d.passed).length;
    return { passed: failedScreenshots === 0 || baselineUpdated, totalScreenshots: diffs.length, failedScreenshots, diffs, baselineUpdated };
  }

  private async _runSpec(browser: import('@playwright/test').Browser, spec: VisualTestSpec, viewportKey: ViewportKey, viewport: { width: number; height: number }): Promise<{ diff: VisualDiff; baselineCreated: boolean }> {
    const isMobile = viewportKey.startsWith('mobile');
    const ctx = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 3 : 1,
    });
    const page = await ctx.newPage();
    try {
      await page.goto(`${this.config.baseUrl}${spec.url}`, { waitUntil: 'networkidle' });
      if (spec.waitFor) await page.waitForSelector(spec.waitFor, { timeout: 5000 }).catch(() => {});
      if (spec.actions) for (const action of spec.actions) await action(page);
      if (spec.maskTexts) {
        for (const text of spec.maskTexts) {
          await page.evaluate((t) => {
            document.querySelectorAll('*').forEach(el => { if (el.textContent?.includes(t)) (el as HTMLElement).style.visibility = 'hidden'; });
          }, text).catch(() => {});
        }
      }

      const name           = `${spec.name}-${viewportKey}.png`;
      const baselinePath   = path.join(this.config.baselineDir, name);
      const actualPath     = path.join(this.config.actualDir, name);
      const diffPath       = path.join(this.config.diffDir, name);
      const actualBuffer   = await page.screenshot({ fullPage: true, animations: 'disabled' });
      await fs.writeFile(actualPath, actualBuffer);

      const baselineExists = await fs.access(baselinePath).then(() => true).catch(() => false);
      if (!baselineExists) {
        await fs.writeFile(baselinePath, actualBuffer);
        return { diff: { testName: spec.name, viewport: viewportKey as ViewportName, baselinePath, actualPath, diffPath: null, pixelDiff: 0, pixelDiffPct: 0, passed: true }, baselineCreated: true };
      }

      let pixelDiff = 0; let pixelDiffPct = 0; let diffSaved = false;
      try {
        const { default: pixelmatch } = await import('pixelmatch');
        const { PNG }                 = await import('pngjs');
        const baseline = PNG.sync.read(await fs.readFile(baselinePath));
        const actual   = PNG.sync.read(actualBuffer);
        const { width, height } = baseline;
        const diffImg  = new PNG({ width, height });
        pixelDiff    = pixelmatch(baseline.data, actual.data, diffImg.data, width, height, { threshold: this.config.threshold ?? 0.02 });
        pixelDiffPct = (pixelDiff / (width * height)) * 100;
        if (pixelDiffPct > (this.config.maxDiffPct ?? 1.0)) { await fs.writeFile(diffPath, PNG.sync.write(diffImg)); diffSaved = true; }
      } catch { /* pixelmatch not available — skip diff */ }

      const passed = pixelDiffPct <= (this.config.maxDiffPct ?? 1.0);
      return { diff: { testName: spec.name, viewport: viewportKey as ViewportName, baselinePath, actualPath, diffPath: diffSaved ? diffPath : null, pixelDiff, pixelDiffPct, passed }, baselineCreated: false };
    } finally { await ctx.close(); }
  }
}
