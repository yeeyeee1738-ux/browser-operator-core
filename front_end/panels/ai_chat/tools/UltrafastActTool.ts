// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../core/Logger.js';
import { getAdapter } from '../cdp/getAdapter.js';
import { LLMClient } from '../LLM/LLMClient.js';
import type { LLMContext, Tool } from './Tools.js';
import type { ActDriver, PageObservation } from '../runtime/actLoop.js';
import { runActLoop } from '../runtime/actLoop.js';
import { actExpression, OBSERVE_EXPRESSION } from '../runtime/snapshotScript.js';
import { createActDecider, type TextCompleter } from '../runtime/jevDecision.js';
import { openIsolatedPage, type PageEvaluate } from '../runtime/backgroundPage.js';
import { TraceReplayStore, traceKey } from '../runtime/traceReplay.js';

const logger = createLogger('UltrafastAct');
const traces = new TraceReplayStore();

let sharedPage: Promise<void> = Promise.resolve();

function withSharedPage<T>(fn: () => Promise<T>): Promise<T> {
  const run = sharedPage.then(fn, fn);
  sharedPage = run.then(() => undefined, () => undefined);
  return run;
}

export interface UltrafastActArgs {
  goal: string;
  reasoning?: string;
  url?: string;
}

async function evaluateWithAdapter(expression: string, ctx?: LLMContext): Promise<unknown> {
  const adapter = await getAdapter(ctx);
  if (!adapter) {
    throw new Error('No browser connection available');
  }
  const response = await adapter.getAgent('Runtime').invoke<{ result?: { value?: unknown } }>('evaluate', {
    expression,
    returnByValue: true,
  });
  return response.result?.value;
}

function completerFor(ctx: LLMContext | undefined): TextCompleter {
  return {
    async complete(systemPrompt: string, userPrompt: string): Promise<string> {
      if (!ctx?.provider) {
        return '';
      }
      const response = await LLMClient.getInstance().call({
        provider: ctx.provider,
        model: ctx.nanoModel || ctx.model,
        systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0,
      });
      return response.text || '';
    },
  };
}

function driverFor(evaluate: PageEvaluate, prepare: (() => Promise<void>) | undefined, ctx?: LLMContext): ActDriver {
  return {
    prepare,
    async observe(): Promise<PageObservation> {
      const value = await evaluate(OBSERVE_EXPRESSION) as PageObservation | undefined;
      if (!value || !Array.isArray(value.controls)) {
        return { fingerprint: '', url: '', title: '', controls: [] };
      }
      return value;
    },
    async act(control, operation, text): Promise<void> {
      const index = control ? Number(control.id) - 1 : -1;
      await evaluate(actExpression(index, operation, text));
    },
    async visionDecide(goal: string) {
      if (!ctx?.getVisionCapability || !ctx.provider) {
        return null;
      }
      const capable = await ctx.getVisionCapability(ctx.model);
      if (!capable) {
        return null;
      }
      const adapter = await getAdapter(ctx);
      if (!adapter) {
        return null;
      }
      try {
        const shot = await adapter.getAgent('Page').invoke<{ data?: string }>('captureScreenshot', { format: 'jpeg' });
        if (!shot.data) {
          return null;
        }
        const response = await LLMClient.getInstance().call({
          provider: ctx.provider,
          model: ctx.model,
          systemPrompt: 'The DOM snapshot has no controls. Return JSON {"operation":"SCROLL_DOWN"} or {"operation":"BLOCKED"}.',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: goal },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${shot.data}` } },
            ],
          }],
          temperature: 0,
        });
        if (response.text?.includes('SCROLL_DOWN')) {
          return { operation: 'SCROLL_DOWN' as const };
        }
        return { operation: 'BLOCKED' as const };
      } catch (error) {
        logger.warn('Vision fallback failed', error);
        return null;
      }
    },
  };
}

export class UltrafastActTool implements Tool<UltrafastActArgs, { status: string; summary: string; history: unknown[] }> {
  name = 'ultrafast_act';
  description = 'Complete a browser goal by choosing a click, type, or select on a numbered control. A text model writes field text only. Pass url to run on a background tab.';
  schema = {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'The full outcome to achieve on the page' },
      reasoning: { type: 'string', description: 'Why this action is needed' },
      url: { type: 'string', description: 'Optional URL to open in a background tab. Omit to use the current page.' },
    },
    required: ['goal'],
  };

  async execute(args: UltrafastActArgs, ctx?: LLMContext): Promise<{ status: string; summary: string; history: unknown[] }> {
    const run = async () => {
      let evaluate: PageEvaluate;
      let prepare: (() => Promise<void>) | undefined;
      let close: (() => Promise<void>) | undefined;
      if (args.url) {
        const page = await openIsolatedPage(args.url);
        if (!page) {
          return { status: 'blocked', summary: 'Could not open a background tab.', history: [] };
        }
        evaluate = page.evaluate;
        prepare = page.prepare;
        close = page.close;
      } else {
        evaluate = expression => evaluateWithAdapter(expression, ctx);
      }
      try {
        const decider = createActDecider(completerFor(ctx));
        const replayKey = traceKey(args.url || 'current', args.goal);
        const replay = traces.load(replayKey);
        const result = await runActLoop(args.goal, driverFor(evaluate, prepare, ctx), decider, replay?.steps || []);
        if (result.status === 'done' && result.history.length > 0) {
          traces.save({
            key: replayKey,
            steps: result.history.map(item => ({
              operation: item.operation,
              role: item.role,
              name: item.name,
              text: item.text,
            })),
          });
        }
        return result;
      } finally {
        if (close) {
          await close();
        }
      }
    };
    return args.url ? run() : withSharedPage(run);
  }
}
