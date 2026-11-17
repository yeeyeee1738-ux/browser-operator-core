// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type { LLMContext, Tool } from './Tools.js';
import { FetcherTool } from './FetcherTool.js';
import { UltrafastActTool } from './UltrafastActTool.js';
import { MCPMetaInvokeTool } from '../mcp/MCPMetaTools.js';
import { drainWorkQueue, WorkQueue, type WorkItem, type WorkKind } from '../runtime/workQueue.js';
import { RunCheckpointStore } from '../runtime/runCheckpoint.js';
import { capToolResult } from '../runtime/resultCap.js';

interface QueueItemInput {
  id: string;
  title: string;
  kind: WorkKind;
  url?: string;
  goal?: string;
  serverId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
}

export class RunWorkQueueTool implements Tool<{ items: QueueItemInput[]; reasoning?: string }, { summary: string; items: WorkItem[] }> {
  name = 'run_work_queue';
  description = 'Run independent read, browser, and connector tasks. Workers lease items themselves. The parent model is called again only after the queue finishes or blocks.';
  schema = {
    type: 'object',
    properties: {
      reasoning: { type: 'string', description: 'Why this queue was created' },
      items: {
        type: 'array',
        items: { type: 'object' },
        description: 'Items with id, title, kind (read|act|mcp), and url, goal, or serverId/toolName/args',
      },
    },
    required: ['items'],
  };

  private readonly fetcher = new FetcherTool();
  private readonly actor = new UltrafastActTool();
  private readonly mcp = new MCPMetaInvokeTool();

  async execute(args: { items: QueueItemInput[]; reasoning?: string }, ctx?: LLMContext): Promise<{ summary: string; items: WorkItem[] }> {
    const queue = new WorkQueue(args.items.map(item => ({
      ...item,
      status: 'pending' as const,
      goal: item.goal || item.title,
    })));
    await drainWorkQueue(queue, async item => {
      switch (item.kind) {
        case 'read': {
          const url = item.url;
          if (!url) {
            item.result = 'Read item is missing a url';
            return 'blocked';
          }
          const fetched = await this.fetcher.execute({ urls: [url], reasoning: item.title }, ctx);
          const source = fetched.sources[0];
          item.result = capToolResult(source?.success ? `${source.title}\n${source.markdownContent}` : (source?.error || 'fetch failed'));
          return source?.success ? 'done' : 'blocked';
        }
        case 'act': {
          const acted = await this.actor.execute({ goal: item.goal || item.title, url: item.url, reasoning: item.title }, ctx);
          item.result = capToolResult(`${acted.status}: ${acted.summary}`);
          return acted.status === 'done' ? 'done' : 'blocked';
        }
        case 'mcp': {
          if (!item.serverId || !item.toolName) {
            item.result = 'MCP item is missing serverId or toolName';
            return 'blocked';
          }
          const invoked = await this.mcp.execute({ serverId: item.serverId, toolName: item.toolName, args: item.args });
          item.result = capToolResult(typeof invoked === 'string' ? invoked : JSON.stringify(invoked));
          return 'done';
        }
        default: {
          const unknown: never = item.kind;
          item.result = `Unknown work kind ${String(unknown)}`;
          return 'blocked';
        }
      }
    }, 8);
    const items = queue.snapshot();
    RunCheckpointStore.save({
      conversationId: 'work-queue',
      status: items.some(item => item.status === 'blocked') ? 'running' : 'complete',
      iteration: items.length,
      url: '',
      summary: queue.summary(),
      queue: items,
      updatedAt: Date.now(),
    });
    return { summary: queue.summary(), items };
  }
}
