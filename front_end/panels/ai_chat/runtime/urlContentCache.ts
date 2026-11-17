// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

export interface CachedPage {
  url: string;
  title: string;
  text: string;
  storedAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 200;
const entries = new Map<string, CachedPage>();

export const UrlContentCache = {
  get(url: string): CachedPage | null {
    const found = entries.get(url);
    if (!found) {
      return null;
    }
    if (Date.now() - found.storedAt > TTL_MS) {
      entries.delete(url);
      return null;
    }
    return found;
  },

  set(page: CachedPage): void {
    if (entries.size >= MAX_ENTRIES) {
      const oldest = entries.keys().next().value;
      if (oldest) {
        entries.delete(oldest);
      }
    }
    entries.set(page.url, page);
  },

  clear(): void {
    entries.clear();
  },
};
