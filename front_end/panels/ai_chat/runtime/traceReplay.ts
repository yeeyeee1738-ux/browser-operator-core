// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type { ActOperation, Control } from './actLoop.js';

export interface TraceStep {
  operation: ActOperation;
  role: string;
  name: string;
  text?: string;
}

export interface StoredTrace {
  key: string;
  steps: TraceStep[];
}

const MEMORY = new Map<string, StoredTrace>();
const STORAGE_KEY = 'bo-act-traces';

export function traceKey(url: string, goal: string): string {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    host = url;
  }
  const normalized = goal.toLowerCase().replace(/\s+/g, ' ').trim();
  return `${host}::${normalized}`;
}

export function matchControl(step: TraceStep, controls: Control[]): Control | null {
  const name = step.name.trim().toLowerCase();
  const role = step.role.trim().toLowerCase();
  return controls.find(control =>
    control.role.trim().toLowerCase() === role &&
    control.name.trim().toLowerCase() === name) ?? null;
}

function readStorage(): StoredTrace[] {
  try {
    if (typeof localStorage === 'undefined') {
      return [];
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as StoredTrace[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStorage(traces: StoredTrace[]): void {
  try {
    if (typeof localStorage === 'undefined') {
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(traces.slice(-100)));
  } catch {
    // Persistence is best-effort.
  }
}

export class TraceReplayStore {
  load(key: string): StoredTrace | null {
    const cached = MEMORY.get(key);
    if (cached) {
      return cached;
    }
    const found = readStorage().find(trace => trace.key === key) ?? null;
    if (found) {
      MEMORY.set(key, found);
    }
    return found;
  }

  save(trace: StoredTrace): void {
    MEMORY.set(trace.key, trace);
    const rest = readStorage().filter(existing => existing.key !== trace.key);
    writeStorage([...rest, trace]);
  }
}
