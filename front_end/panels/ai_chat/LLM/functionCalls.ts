// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type { LLMResponse } from './LLMTypes.js';

export interface IncomingFunctionCall {
  id?: string;
  name: string;
  arguments: unknown;
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value ?? {};
  }
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}

/** Record every tool call. The first call also stays on functionCall for single-call callers. */
export function setFunctionCalls(result: LLMResponse, calls: IncomingFunctionCall[]): void {
  if (calls.length === 0) {
    return;
  }
  result.functionCalls = calls.map(call => ({
    id: call.id,
    name: call.name,
    arguments: parseArguments(call.arguments),
  }));
  const first = result.functionCalls[0];
  result.functionCall = {
    name: first.name,
    arguments: first.arguments,
  };
}
