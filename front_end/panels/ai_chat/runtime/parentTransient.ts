// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { peekSteer } from './steerBuffer.js';
import { RunCheckpointStore } from './runCheckpoint.js';

export interface ParentTransientInput {
  fileNames?: string[];
  queueSummary?: string;
  checkpointSummary?: string;
}

/** Context that changes every turn. It is not part of the cached system prompt. */
export function renderParentTransient(input: ParentTransientInput = {}): string {
  const files = input.fileNames && input.fileNames.length > 0 ? input.fileNames.join(', ') : 'none';
  const queue = input.queueSummary || 'empty';
  const steer = peekSteer();
  const steerLine = steer.length > 0 ? steer.join(' | ') : 'none';
  const checkpoint = input.checkpointSummary || 'none';
  return `<runtime_context>
Files: ${files}
Work queue:
${queue}
Steered follow-ups waiting: ${steerLine}
Checkpoint: ${checkpoint}
The system prompt is stable. This block is the only fresh context for this step.
</runtime_context>`;
}

export async function loadParentTransient(conversationId?: string): Promise<string> {
  const checkpoint = conversationId ? RunCheckpointStore.load(conversationId) : null;
  let fileNames: string[] = [];
  if (typeof window !== 'undefined') {
    try {
      // Browser-only IndexedDB. A top-level import pulls DevTools into the node test bundle.
      const module = await import('../tools/FileStorageManager.js');
      const files = await module.FileStorageManager.getInstance().listFiles();
      fileNames = files.map(file => file.fileName);
    } catch {
      fileNames = [];
    }
  }
  return renderParentTransient({
    fileNames,
    queueSummary: checkpoint?.queue?.map(item => `- [${item.status}] ${item.title}`).join('\n'),
    checkpointSummary: checkpoint ? `${checkpoint.status} at ${checkpoint.url}` : undefined,
  });
}
