// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../core/Logger.js';

const logger = createLogger('BackgroundPage');

export type PageEvaluate = (expression: string) => Promise<unknown>;

interface IsolatedPage {
  evaluate: PageEvaluate;
  prepare: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * SDK is loaded lazily so the eval runner and unit tests can import this module
 * without the DevTools browser bundle.
 */
async function loadSdk(): Promise<typeof import('../../../core/sdk/sdk.js') | null> {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return await import('../../../core/sdk/sdk.js');
  } catch (error) {
    logger.warn('SDK unavailable for background pages', error);
    return null;
  }
}

async function waitForTarget(
  manager: { targetById: (id: string) => import('../../../core/sdk/sdk.js').Target.Target | null },
  targetId: string,
): Promise<import('../../../core/sdk/sdk.js').Target.Target | null> {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    const target = manager.targetById(targetId);
    if (target) {
      return target;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return null;
}

export async function openIsolatedPage(url: string): Promise<IsolatedPage | null> {
  const SDK = await loadSdk();
  if (!SDK) {
    return null;
  }
  const manager = SDK.TargetManager.TargetManager.instance();
  const primary = manager.primaryPageTarget();
  if (!primary) {
    return null;
  }
  const created = await primary.targetAgent().invoke_createTarget({ url, background: true });
  const targetId = created.targetId;
  const child = await waitForTarget(manager, targetId);
  if (!child) {
    return null;
  }
  const evaluate: PageEvaluate = async expression => {
    const response = await child.runtimeAgent().invoke_evaluate({
      expression,
      returnByValue: true,
    });
    return response.result?.value;
  };
  return {
    evaluate,
    prepare: async () => {
      await child.emulationAgent().invoke_setFocusEmulationEnabled({ enabled: true });
      const started = Date.now();
      while (Date.now() - started < 8000) {
        const state = await evaluate('document.readyState');
        if (state === 'interactive' || state === 'complete') {
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    },
    close: async () => {
      await primary.targetAgent().invoke_closeTarget({ targetId });
    },
  };
}

export async function withIsolatedPage<T>(url: string, fn: (evaluate: PageEvaluate) => Promise<T>): Promise<T | null> {
  const page = await openIsolatedPage(url);
  if (!page) {
    return null;
  }
  try {
    await page.prepare();
    return await fn(page.evaluate);
  } finally {
    await page.close();
  }
}
