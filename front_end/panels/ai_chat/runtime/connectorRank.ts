// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

export interface ConnectorCandidate {
  name: string;
  description: string;
}

export interface RankedConnector extends ConnectorCandidate {
  score: number;
}

export function rankConnectors(query: string, tools: ConnectorCandidate[]): RankedConnector[] {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(term => term.length > 2);
  return tools.map(tool => {
    const haystack = `${tool.name} ${tool.description}`.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
    return {...tool, score};
  }).filter(tool => tool.score > 0).sort((left, right) => right.score - left.score);
}
