// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LLMResponseParser } from '../LLM/LLMResponseParser.js';
import { type UnifiedLLMResponse, type LLMMessage } from '../LLM/LLMTypes.js';
import {
  runActLoop,
  type ActDecider,
  type ActDriver,
  type Control,
  type PageObservation,
} from './actLoop.js';
import { pushAssistantToolCall } from './messageCoalesce.js';
import { capToolResult } from './resultCap.js';
import { scheduleToolBatch } from './toolLanes.js';
import { matchControl, traceKey } from './traceReplay.js';
import { WorkQueue, drainWorkQueue, type WorkItem } from './workQueue.js';

function control(id: string): Control {
  return { id, role: 'button', name: `Item ${id}`, value: '', kind: 'click', disabled: false };
}

function observation(ids: string[], fingerprint = ids.join(',')): PageObservation {
  return {
    fingerprint,
    url: 'https://example.com',
    title: 'Example',
    controls: ids.map(control),
  };
}

function item(id: string, kind: WorkItem['kind']): WorkItem {
  return { id, title: id, kind, status: 'pending' };
}

describe('fast agent runtime', () => {
  it('keeps one tool call on the existing parser path', () => {
    const response: UnifiedLLMResponse = {
      functionCall: { name: 'navigate_url', arguments: { url: 'https://example.com' } },
    };
    const parsed = LLMResponseParser.parseResponse(response);
    assert.equal(parsed.type, 'tool_call');
  });

  it('returns every tool call when the model emits more than one', () => {
    const response: UnifiedLLMResponse = {
      functionCall: { name: 'fetcher_tool', arguments: { urls: ['https://a.example'] } },
      functionCalls: [
        { name: 'fetcher_tool', arguments: { urls: ['https://a.example'] } },
        { name: 'research_agent', arguments: { task: 'prices' } },
      ],
    };
    const parsed = LLMResponseParser.parseResponse(response);
    assert.equal(parsed.type, 'tool_calls');
    if (parsed.type === 'tool_calls') {
      assert.deepEqual(parsed.calls.map(call => call.name), ['fetcher_tool', 'research_agent']);
    }
  });

  it('runs read tools together and keeps act tools within four slots', async () => {
    let activeActs = 0;
    let maxActs = 0;
    const calls = Array.from({ length: 6 }, (_, index) => ({
      id: String(index),
      name: index < 2 ? 'fetcher_tool' : 'web_task_agent',
    }));
    await scheduleToolBatch(calls, call => call.name === 'fetcher_tool' ? 'read' : 'act', async call => {
      if (call.name === 'web_task_agent') {
        activeActs += 1;
        maxActs = Math.max(maxActs, activeActs);
        await new Promise(resolve => setTimeout(resolve, 30));
        activeActs -= 1;
      }
      return call.id;
    });
    assert.ok(maxActs <= 4);
    assert.ok(maxActs >= 2);
  });

  it('leases a work queue and blocks a failing item', async () => {
    const queue = new WorkQueue([
      item('read-1', 'read'),
      item('act-1', 'act'),
    ]);
    await drainWorkQueue(queue, async work => {
      if (work.kind === 'act') {
        throw new Error('blocked');
      }
      return 'done';
    }, 4);
    const snapshot = queue.snapshot();
    assert.equal(snapshot.find(work => work.id === 'read-1')?.status, 'done');
    assert.equal(snapshot.find(work => work.id === 'act-1')?.status, 'blocked');
    assert.match(queue.summary(), /blocked/);
  });

  it('stops an act loop after three actions that do not change the page', async () => {
    const page = observation(['1']);
    const driver: ActDriver = {
      async observe() {
        return page;
      },
      async act() {
        return undefined;
      },
    };
    const decider: ActDecider = {
      async choose() {
        return { operation: 'CLICK', targetId: '1' };
      },
      async typeText() {
        return null;
      },
      async goalSatisfied() {
        return false;
      },
    };
    const result = await runActLoop('click the button', driver, decider);
    assert.equal(result.status, 'blocked');
    assert.equal(result.history.length, 3);
  });

  it('replays a trace until the control is gone', async () => {
    const pages = [observation(['1'], 'first'), observation(['2'], 'second'), observation(['2'], 'second')];
    const driver: ActDriver = {
      async observe() {
        return pages.shift() || observation(['2'], 'second');
      },
      async act() {
        return undefined;
      },
    };
    let choices = 0;
    const decider: ActDecider = {
      async choose() {
        choices += 1;
        return { operation: 'DONE' };
      },
      async typeText() {
        return null;
      },
      async goalSatisfied() {
        return true;
      },
    };
    const result = await runActLoop('continue', driver, decider, [
      { operation: 'CLICK', role: 'button', name: 'Item 1' },
      { operation: 'CLICK', role: 'button', name: 'Item 1' },
    ]);
    assert.equal(result.status, 'done');
    assert.equal(result.history[0]?.name, 'Item 1');
    assert.equal(choices, 1);
  });

  it('asks for type text once when the replay did not supply it', async () => {
    const pages = [observation(['1'], 'a'), observation(['1'], 'b')];
    const driver: ActDriver = {
      async observe() {
        return pages.shift() || observation(['1'], 'b');
      },
      async act() {
        return undefined;
      },
    };
    let typed = 0;
    let choices = 0;
    const decider: ActDecider = {
      async choose() {
        choices += 1;
        if (choices > 1) {
          return { operation: 'DONE' };
        }
        return { operation: 'TYPE_TEXT', targetId: '1' };
      },
      async typeText() {
        typed += 1;
        return 'hello';
      },
      async goalSatisfied() {
        return true;
      },
    };
    const result = await runActLoop('fill the field', driver, decider);
    assert.equal(typed, 1);
    assert.equal(result.history[0]?.text, 'hello');
  });

  it('matches a control by role and name', () => {
    const found = matchControl(
      { operation: 'CLICK', role: 'button', name: 'item 4' },
      [control('4')],
    );
    assert.equal(found?.id, '4');
    assert.equal(traceKey('https://shop.example/cart?x=1', '  Buy   the item '), 'shop.example::buy the item');
  });

  it('caps a tool result and joins parallel tool calls into one assistant message', () => {
    const capped = capToolResult('x'.repeat(5000));
    assert.ok(capped.startsWith('x'.repeat(4000)));
    assert.match(capped, /truncated/);
    const messages: LLMMessage[] = [];
    pushAssistantToolCall(messages, { id: 'a', name: 'fetcher_tool', arguments: '{}' }, 'batch-1');
    pushAssistantToolCall(messages, { id: 'b', name: 'research_agent', arguments: '{}' }, 'batch-1');
    assert.equal(messages.length, 1);
    const assistant = messages[0];
    assert.equal(assistant?.role, 'assistant');
    if (assistant?.role === 'assistant') {
      assert.equal(assistant.tool_calls?.length, 2);
    }
  });
});
