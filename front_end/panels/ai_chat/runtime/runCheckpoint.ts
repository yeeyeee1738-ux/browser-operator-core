// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type { WorkItem } from './workQueue.js';

export interface RunCheckpoint {
  conversationId: string;
  status: 'running' | 'complete';
  iteration: number;
  url: string;
  summary: string;
  queue: WorkItem[];
  updatedAt: number;
}

const MEMORY = new Map<string, RunCheckpoint>();
const STORAGE_KEY = 'bo-run-checkpoints';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function readAll(): Record<string, RunCheckpoint> {
  try {
    if (typeof localStorage === 'undefined') {
      return {};
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, RunCheckpoint>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(value: Record<string, RunCheckpoint>): void {
  try {
    if (typeof localStorage === 'undefined') {
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Persistence is best-effort.
  }
}

export const RunCheckpointStore = {
  save(checkpoint: RunCheckpoint): void {
    MEMORY.set(checkpoint.conversationId, checkpoint);
    const all = readAll();
    all[checkpoint.conversationId] = checkpoint;
    writeAll(all);
  },

  load(conversationId: string): RunCheckpoint | null {
    const cached = MEMORY.get(conversationId) ?? readAll()[conversationId] ?? null;
    if (!cached) {
      return null;
    }
    if (Date.now() - cached.updatedAt > MAX_AGE_MS) {
      this.clear(conversationId);
      return null;
    }
    MEMORY.set(conversationId, cached);
    return cached;
  },

  clear(conversationId: string): void {
    MEMORY.delete(conversationId);
    const all = readAll();
    delete all[conversationId];
    writeAll(all);
  },
};
