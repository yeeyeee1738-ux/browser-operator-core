// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

export type WorkKind = 'read' | 'act' | 'mcp';
export type WorkStatus = 'pending' | 'leased' | 'done' | 'blocked';

export interface WorkItem {
  id: string;
  title: string;
  kind: WorkKind;
  status: WorkStatus;
  url?: string;
  goal?: string;
  serverId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: string;
  leaseOwner?: string;
}

export class WorkQueue {
  private readonly items: WorkItem[];

  constructor(items: WorkItem[]) {
    this.items = items.map(item => ({...item}));
  }

  snapshot(): WorkItem[] {
    return this.items.map(item => ({...item}));
  }

  pendingCount(): number {
    return this.items.filter(item => item.status === 'pending').length;
  }

  lease(owner: string): WorkItem | null {
    const next = this.items.find(item => item.status === 'pending');
    if (!next) {
      return null;
    }
    next.status = 'leased';
    next.leaseOwner = owner;
    return {...next};
  }

  complete(id: string, owner: string, result?: string): void {
    const item = this.requireLease(id, owner);
    item.status = 'done';
    item.result = result;
    item.leaseOwner = undefined;
  }

  block(id: string, owner: string, result: string): void {
    const item = this.requireLease(id, owner);
    item.status = 'blocked';
    item.result = result;
    item.leaseOwner = undefined;
  }

  summary(): string {
    return this.items.map(item => `- [${item.status}] ${item.kind} ${item.id}: ${item.title}`).join('\n');
  }

  private requireLease(id: string, owner: string): WorkItem {
    const item = this.items.find(candidate => candidate.id === id);
    if (!item || item.status !== 'leased' || item.leaseOwner !== owner) {
      throw new Error(`Work item ${id} is not leased by ${owner}`);
    }
    return item;
  }
}

export async function drainWorkQueue(
  queue: WorkQueue,
  run: (item: WorkItem) => Promise<'done' | 'blocked'>,
  concurrency: number,
): Promise<void> {
  while (queue.pendingCount() > 0) {
    const batch: WorkItem[] = [];
    for (let index = 0; index < concurrency; index++) {
      const item = queue.lease('worker');
      if (!item) {
        break;
      }
      batch.push(item);
    }
    if (batch.length === 0) {
      return;
    }
    await Promise.all(batch.map(async item => {
      try {
        const status = await run(item);
        if (status === 'blocked') {
          queue.block(item.id, 'worker', item.result || 'blocked');
        } else {
          queue.complete(item.id, 'worker', item.result);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        queue.block(item.id, 'worker', message);
      }
    }));
  }
}
