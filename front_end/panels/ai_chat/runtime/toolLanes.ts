// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

export type ToolLane = 'read' | 'act' | 'file' | 'local';

const READ_TOOLS = new Set([
  'fetcher_tool',
  'readability_extractor',
  'extract_data',
  'document_search',
  'search_visit_history',
  'research_agent',
  'search_agent',
]);

const FILE_TOOLS = new Set([
  'create_file',
  'update_file',
  'delete_file',
  'read_file',
  'list_files',
  'save_research_report',
]);

const ACT_TOOLS = new Set([
  'navigate_url',
  'navigate_back',
  'web_task_agent',
  'ultrafast_act',
  'action_agent',
  'action_agent_v1',
  'action_agent_v2',
  'scroll_page',
  'perform_action',
  'take_screenshot',
  'click_action_agent',
  'form_fill_action_agent',
  'hover_action_agent',
  'keyboard_input_action_agent',
  'scroll_action_agent',
]);

export function laneForTool(name: string, explicit?: ToolLane): ToolLane {
  if (explicit) {
    return explicit;
  }
  if (READ_TOOLS.has(name) || name.includes('fetcher') || name.includes('extract')) {
    return 'read';
  }
  if (FILE_TOOLS.has(name)) {
    return 'file';
  }
  if (ACT_TOOLS.has(name) || name.startsWith('navigate_')) {
    return 'act';
  }
  return 'local';
}

export function createSemaphore(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiters: Array<() => void> = [];
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    while (active >= max) {
      await new Promise<void>(resolve => {
        waiters.push(resolve);
      });
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      const next = waiters.shift();
      if (next) {
        next();
      }
    }
  };
}

export const withActSlot = createSemaphore(4);
export const withReadSlot = createSemaphore(8);

/**
 * Run a batch. Act tools share a small slot count. Everything else shares the read slots.
 * Results stay in input order.
 */
export async function scheduleToolBatch<T, R>(
  items: readonly T[],
  laneOf: (item: T) => ToolLane,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  await Promise.all(items.map(async (item, index) => {
    const lane = laneOf(item);
    const gate = lane === 'act' ? withActSlot : withReadSlot;
    results[index] = await gate(() => run(item, index));
  }));
  return results;
}
