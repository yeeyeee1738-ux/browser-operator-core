// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

export const TOOL_RESULT_CHAR_CAP = 4000;

export function capToolResult(text: string, cap: number = TOOL_RESULT_CHAR_CAP): string {
  if (text.length <= cap) {
    return text;
  }
  const omitted = text.length - cap;
  return `${text.slice(0, cap)}\n…[truncated ${omitted} chars; full output belongs in the session files]`;
}
