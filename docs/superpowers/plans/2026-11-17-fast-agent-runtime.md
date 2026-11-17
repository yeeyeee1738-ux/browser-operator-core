# Fast Agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the parent agent fan out long tasks the way Polar does, and make each click loop a Jev-style indexed decision instead of a stack of text-model agents.

**Architecture:** A small runtime under `front_end/panels/ai_chat/runtime/` owns scheduling, the act loop, the work queue, trace replay, steering, and checkpoints. The existing graph and `AgentRunner` call into it. Browser tabs are opened per read or act worker, with focus emulation so background targets keep rendering. The system prompt stays stable; page state is a transient turn for actors only.

**Tech Stack:** TypeScript in the DevTools `ai_chat` module, Chrome DevTools Protocol via `SDK.Target`, TypeSafe Jev when `TYPESAFE_API_KEY` is set, the configured nano model otherwise.

## Global Constraints

- New files go in both `sources` lists in `front_end/panels/ai_chat/BUILD.gn`.
- Imports stay at the top of the file. Browser-only SDK imports stay inside a documented lazy loader, matching `PageInfoManager`.
- A single tool call keeps today's path. Multiple tool calls are the new path.
- Act decisions may only target an index from the current snapshot. Text models write field text only.
- Child tool results that go back to a parent are capped.

---

### Task 1: Scheduling, queue, replay, steer, checkpoint

**Files:** `runtime/toolLanes.ts`, `runtime/workQueue.ts`, `runtime/traceReplay.ts`, `runtime/steerBuffer.ts`, `runtime/runCheckpoint.ts`, `runtime/urlContentCache.ts`, `runtime/resultCap.ts`, `runtime/messageCoalesce.ts`, `runtime/connectorRank.ts`

- [x] Classify tools into read, act, file, and local lanes and run a batch with separate concurrency limits.
- [x] Lease work items until the queue is empty or every leftover item is blocked.
- [x] Replay a saved action trace until a step's control is gone, then stop using the trace.
- [x] Hold steered user text until the next agent step.
- [x] Persist a run checkpoint for 24 hours.

### Task 2: Jev act loop

**Files:** `runtime/actLoop.ts`, `runtime/snapshotScript.ts`, `runtime/jevDecision.ts`, `runtime/backgroundPage.ts`, `tools/UltrafastActTool.ts`

- [x] One snapshot of visible controls, including open shadow roots and same-origin frames.
- [x] One decision picks the operation and the target index. `TYPE_TEXT` is the only step that calls a text model.
- [x] Use TypeSafe `https://api.typesafe.ai/v1/systemone` when a key is present. Otherwise ask the nano model for the same JSON choice.
- [x] Stop after three actions that do not change the page. Confirm `DONE` with a separate yes/no check.
- [x] Open an isolated background target when the action has its own URL. Lock the current page when it does not.
- [x] Enable `Emulation.setFocusEmulationEnabled` on background targets.
- [x] If the snapshot has no controls, ask a vision-capable model once, then return `blocked`.

### Task 3: Parent loop

**Files:** `LLM/functionCalls.ts`, `LLM/LLMTypes.ts`, `LLM/LLMResponseParser.ts`, every provider's response parser, `OpenAIProvider.ts` outbound conversion, `core/AgentNodes.ts`, `agent_framework/AgentRunner.ts`, `core/GraphHelpers.ts`, `core/AgentService.ts`

- [x] Keep every function call from a model response, not only the first.
- [x] Send those calls as one assistant message on the next turn.
- [x] Run the batch through the lane scheduler. A handoff still runs alone after the other calls finish.
- [x] Leave the system prompt unchanged across iterations. Put page context only on browser actors, as a transient user turn.
- [x] Cap child results. Prune `get_page_content_v1` the same way as `get_page_content`.
- [x] While a run is active, a new user message steers at the next agent step instead of aborting.
- [x] Save a checkpoint each parent step. Reloading that conversation continues a running task.

### Task 4: Read lane, queue tool, connectors

**Files:** `tools/FetcherTool.ts`, `tools/RunWorkQueueTool.ts`, `tools/PreferConnectorTool.ts`, `agent_framework/implementation/ConfiguredAgents.ts`, `agent_framework/implementation/agents/WebTaskAgent.ts`, `agent_framework/implementation/agents/ResearchAgent.ts`, `core/BaseOrchestratorAgent.ts`

- [x] Fetch many URLs at once through background targets, and reuse a session cache.
- [x] `run_work_queue` leases read, act, and MCP items without a parent model call between them.
- [x] `prefer_connector` ranks MCP tools for the query before a browser task.
- [x] `web_task_agent` uses `ultrafast_act` and does not require the thinking tool first.
- [x] `research_agent` reads with `fetcher_tool`.

### Task 5: Tests

**Files:** `runtime/runtime.test.ts`

- [x] Run the runtime tests in Node. The checkout's esbuild package has no linux-x64 binary, so the tests are typechecked with tsc and executed from that emit.
- [x] Cover parallel scheduling limits, queue drain, trace replay, the act loop's no-op stop, multi-call parsing, and result capping.
