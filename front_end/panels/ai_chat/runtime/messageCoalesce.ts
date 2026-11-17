// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { ChatMessageEntity, type ChatMessage, type ModelChatMessage } from '../models/ChatTypes.js';
import type { LLMMessage } from '../LLM/LLMTypes.js';

type BatchedLLMMessage = LLMMessage & { batchId?: string };

export function trailingToolCalls(messages: ChatMessage[]): ModelChatMessage[] {
  const pending: ModelChatMessage[] = [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.entity === ChatMessageEntity.MODEL && message.action === 'tool' && message.toolName) {
      pending.push(message);
      continue;
    }
    break;
  }
  return pending.reverse();
}

export function pushAssistantToolCall(
  out: LLMMessage[],
  call: { id: string; name: string; arguments: string },
  batchId?: string,
): void {
  const last = out[out.length - 1] as BatchedLLMMessage | undefined;
  if (batchId && last?.role === 'assistant' && last.tool_calls && last.batchId === batchId) {
    last.tool_calls.push({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    });
    return;
  }
  const message: BatchedLLMMessage = {
    role: 'assistant',
    content: undefined,
    tool_calls: [{
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    }],
  };
  if (batchId) {
    message.batchId = batchId;
  }
  out.push(message);
}

export function stripBatchIds(messages: LLMMessage[]): LLMMessage[] {
  return messages.map(message => {
    if (!('batchId' in message)) {
      return message;
    }
    const { batchId: _batchId, ...rest } = message as BatchedLLMMessage;
    return rest;
  });
}
