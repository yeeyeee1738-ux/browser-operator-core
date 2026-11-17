// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

export type ActOperation =
  | 'CLICK'
  | 'TYPE_TEXT'
  | 'SELECT'
  | 'SCROLL_UP'
  | 'SCROLL_DOWN'
  | 'WAIT'
  | 'DONE'
  | 'BLOCKED';

export interface Control {
  id: string;
  role: string;
  name: string;
  value: string;
  kind: 'click' | 'fill' | 'select';
  disabled: boolean;
}

export interface PageObservation {
  fingerprint: string;
  url: string;
  title: string;
  controls: Control[];
}

export interface ActDecision {
  operation: ActOperation;
  targetId?: string;
}

export interface ActHistoryItem {
  operation: ActOperation;
  role: string;
  name: string;
  text?: string;
  pageChanged: boolean;
}

export interface ActDriver {
  prepare?(): Promise<void>;
  observe(): Promise<PageObservation>;
  act(control: Control | null, operation: ActOperation, text?: string): Promise<void>;
  visionDecide?(goal: string): Promise<ActDecision | null>;
}

export interface ActDecider {
  choose(input: { goal: string; observation: PageObservation; history: ActHistoryItem[] }): Promise<ActDecision>;
  typeText(input: { goal: string; control: Control; history: ActHistoryItem[] }): Promise<string | null>;
  goalSatisfied(input: { goal: string; observation: PageObservation }): Promise<boolean>;
}

export interface ActLoopResult {
  status: 'done' | 'blocked';
  summary: string;
  history: ActHistoryItem[];
}

const MAX_STEPS = 30;
const NO_OP_LIMIT = 3;

function controlById(observation: PageObservation, targetId?: string): Control | null {
  if (!targetId) {
    return null;
  }
  return observation.controls.find(control => control.id === targetId) ?? null;
}

export async function runActLoop(
  goal: string,
  driver: ActDriver,
  decider: ActDecider,
  replaySteps: Array<{ operation: ActOperation; role: string; name: string; text?: string }> = [],
): Promise<ActLoopResult> {
  if (driver.prepare) {
    await driver.prepare();
  }
  const history: ActHistoryItem[] = [];
  let replayIndex = 0;
  let rejectedDone = 0;
  let observation = await driver.observe();

  for (let step = 0; step < MAX_STEPS; step++) {
    const replay = replaySteps[replayIndex];
    const replayControl = replay
      ? observation.controls.find(control =>
        control.role.trim().toLowerCase() === replay.role.trim().toLowerCase() &&
        control.name.trim().toLowerCase() === replay.name.trim().toLowerCase())
      : undefined;
    let decision: ActDecision;
    let typed: string | undefined;
    if (replay && replayControl && replay.operation !== 'DONE' && replay.operation !== 'BLOCKED') {
      decision = { operation: replay.operation, targetId: replayControl.id };
      typed = replay.text;
      replayIndex++;
    } else if (observation.controls.length === 0) {
      replayIndex = replaySteps.length;
      const visual = driver.visionDecide ? await driver.visionDecide(goal) : null;
      if (!visual || visual.operation === 'BLOCKED') {
        return { status: 'blocked', summary: 'No actionable controls on the page.', history };
      }
      decision = visual;
    } else {
      replayIndex = replaySteps.length;
      decision = await decider.choose({ goal, observation, history });
    }

    if (decision.operation === 'BLOCKED') {
      return { status: 'blocked', summary: 'The decision model reported the task blocked.', history };
    }
    if (decision.operation === 'DONE') {
      const satisfied = await decider.goalSatisfied({ goal, observation });
      if (satisfied) {
        return { status: 'done', summary: 'The goal is visible on the page.', history };
      }
      rejectedDone++;
      if (rejectedDone >= 2) {
        return { status: 'blocked', summary: 'DONE was rejected twice.', history };
      }
      continue;
    }

    const control = controlById(observation, decision.targetId);
    if ((decision.operation === 'CLICK' || decision.operation === 'TYPE_TEXT' || decision.operation === 'SELECT') && !control) {
      return { status: 'blocked', summary: `Missing target for ${decision.operation}.`, history };
    }
    let text = typed;
    if (decision.operation === 'TYPE_TEXT' && control && text === undefined) {
      const generated = await decider.typeText({ goal, control, history });
      if (!generated) {
        return { status: 'blocked', summary: `No text for ${control.name}.`, history };
      }
      text = generated;
    }

    const before = observation.fingerprint;
    await driver.act(control, decision.operation, text);
    observation = await driver.observe();
    const pageChanged = observation.fingerprint !== before;
    history.push({
      operation: decision.operation,
      role: control?.role || '',
      name: control?.name || decision.operation,
      text,
      pageChanged,
    });

    const recent = history.slice(-NO_OP_LIMIT);
    if (recent.length === NO_OP_LIMIT && recent.every(item => !item.pageChanged && item.operation !== 'WAIT')) {
      return { status: 'blocked', summary: 'Three actions did not change the page.', history };
    }
  }

  return { status: 'blocked', summary: `Stopped after ${MAX_STEPS} actions.`, history };
}
