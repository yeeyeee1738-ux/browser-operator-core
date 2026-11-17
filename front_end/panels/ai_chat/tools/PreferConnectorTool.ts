// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type { Tool } from './Tools.js';
import { rankConnectors } from '../runtime/connectorRank.js';
import { MCPMetaSearchTool } from '../mcp/MCPMetaTools.js';

export class PreferConnectorTool implements Tool<{ query: string }, { useConnector: boolean; tool?: { name: string; description: string; serverId?: string }; reason: string }> {
  name = 'prefer_connector';
  description = 'Before browsing, check whether a connected MCP tool can answer the task. If useConnector is true, call that tool and skip the browser.';
  schema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What the user wants done' },
    },
    required: ['query'],
  };

  private readonly search = new MCPMetaSearchTool();

  async execute(args: { query: string }): Promise<{ useConnector: boolean; tool?: { name: string; description: string; serverId?: string }; reason: string }> {
    try {
      const found = await this.search.execute({ query: args.query, k: 5, strategy: 'heuristic' });
      const ranked = rankConnectors(args.query, found.tools.map(tool => ({
        name: tool.name,
        description: `${tool.description} ${tool.serverId}`,
      })));
      const best = found.tools.find(tool => tool.name === ranked[0]?.name) || found.tools[0];
      if (!best || ranked.length === 0) {
        return { useConnector: false, reason: 'No connected tool matches this task.' };
      }
      return {
        useConnector: true,
        tool: { name: best.name, description: best.description, serverId: best.serverId },
        reason: `Use mcp.invoke on ${best.serverId} ${best.name} before opening a tab.`,
      };
    } catch {
      return { useConnector: false, reason: 'Connector search is unavailable.' };
    }
  }
}
