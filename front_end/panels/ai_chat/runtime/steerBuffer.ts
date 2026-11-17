// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

const pending: string[] = [];

export function pushSteer(text: string): void {
  const trimmed = text.trim();
  if (trimmed) {
    pending.push(trimmed);
  }
}

/** Take every steered message waiting for the next agent step. */
export function drainSteer(): string[] {
  const copy = pending.slice();
  pending.length = 0;
  return copy;
}

export function peekSteer(): readonly string[] {
  return pending.slice();
}
