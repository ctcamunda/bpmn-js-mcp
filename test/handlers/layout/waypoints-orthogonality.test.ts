/**
 * Tests for waypoint orthogonality — shared-Y snap and SAME_Y_TOLERANCE.
 *
 * Regression tests for the bug where `assignLShapeWaypoints` in the
 * "same-Y" branch assigned individual midY values to each endpoint, producing
 * a diagonal (non-orthogonal) 2-waypoint path when source and target had a
 * small Y drift (e.g. 5–10 px from grid-snap or gateway height mismatch).
 *
 * Also tests that gateway connections with small vertical offset produce
 * orthogonal paths via `resetStaleWaypoints`.
 */

import { describe, test, expect } from 'vitest';
import {
  resetStaleWaypoints,
  straightenNonOrthogonalFlows,
  isFullyOrthogonal,
  SAME_Y_TOLERANCE,
} from '../../../src/rebuild/waypoints';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Assert all segments of a waypoint path are axis-aligned (orthogonal). */
function expectFullyOrthogonal(wps: Array<{ x: number; y: number }>, label = '') {
  for (let i = 1; i < wps.length; i++) {
    const dx = Math.abs(wps[i].x - wps[i - 1].x);
    const dy = Math.abs(wps[i].y - wps[i - 1].y);
    expect(
      dx < 1 || dy < 1,
      `${label} segment ${i - 1}→${i} is diagonal: ` +
        `(${wps[i - 1].x},${wps[i - 1].y})→(${wps[i].x},${wps[i].y})`
    ).toBe(true);
  }
}

/** Build a fake forward bpmn:SequenceFlow connection object. */
function makeConn(opts: {
  sourceX: number;
  sourceY: number;
  sourceW: number;
  sourceH: number;
  targetX: number;
  targetY: number;
  targetW: number;
  targetH: number;
  sourceType?: string;
  waypoints: Array<{ x: number; y: number }>;
}) {
  const source = {
    type: opts.sourceType ?? 'bpmn:UserTask',
    x: opts.sourceX,
    y: opts.sourceY,
    width: opts.sourceW,
    height: opts.sourceH,
  };
  const target = {
    type: 'bpmn:UserTask',
    x: opts.targetX,
    y: opts.targetY,
    width: opts.targetW,
    height: opts.targetH,
  };
  return {
    type: 'bpmn:SequenceFlow',
    source,
    target,
    waypoints: opts.waypoints.map((wp) => ({ ...wp })),
  } as any;
}

// ── SAME_Y_TOLERANCE value ─────────────────────────────────────────────────

describe('SAME_Y_TOLERANCE', () => {
  test('is ≥ 10 to absorb grid-snap-induced drift', () => {
    expect(SAME_Y_TOLERANCE).toBeGreaterThanOrEqual(10);
  });
});

// ── assignLShapeWaypoints shared-Y snap ────────────────────────────────────
// Tested via the public straightenNonOrthogonalFlows interface.

describe('straightenNonOrthogonalFlows — shared-Y snap', () => {
  /**
   * Classic pizza-process case:
   *   Gateway at y=180, h=50  → midY = 205
   *   Task    at y=160, h=80  → midY = 200
   *   drift   = 5 px  (within old SAME_Y_TOLERANCE and new tolerance)
   *
   * Before fix: assignLShapeWaypoints used individual midY values → diagonal path.
   * After fix : both endpoints snapped to shared Y → orthogonal path.
   */
  test('5 px Y drift (gateway–task): produces orthogonal 2-point path', () => {
    const conn = makeConn({
      sourceX: 550,
      sourceY: 180,
      sourceW: 50,
      sourceH: 50, // midY = 205  (gateway)
      targetX: 650,
      targetY: 160,
      targetW: 100,
      targetH: 80, // midY = 200  (task)
      // diagonal stale waypoints (ManhattanLayout artefact)
      waypoints: [
        { x: 600, y: 205 },
        { x: 625, y: 202 },
        { x: 650, y: 200 },
      ],
    });

    const fixed = straightenNonOrthogonalFlows([conn]);
    expect(fixed).toBe(1); // one connection was replaced
    expect(conn.waypoints.length).toBeGreaterThanOrEqual(2);
    expectFullyOrthogonal(conn.waypoints, '5 px drift');
    // Both endpoints must be at the same Y
    const ys = conn.waypoints.map((wp: any) => wp.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1);
  });

  test('10 px Y drift: produces orthogonal path (within raised tolerance)', () => {
    // Task at y=160 h=80, midY=200; task at y=170, h=80, midY=210 → drift=10
    const conn = makeConn({
      sourceX: 400,
      sourceY: 160,
      sourceW: 100,
      sourceH: 80, // midY = 200
      targetX: 550,
      targetY: 170,
      targetW: 100,
      targetH: 80, // midY = 210
      waypoints: [
        { x: 500, y: 200 },
        { x: 525, y: 205 },
        { x: 550, y: 210 },
      ],
    });

    const fixed = straightenNonOrthogonalFlows([conn]);
    expect(fixed).toBe(1);
    expectFullyOrthogonal(conn.waypoints, '10 px drift');
  });

  test('0 px Y drift: already orthogonal path is not modified', () => {
    const conn = makeConn({
      sourceX: 400,
      sourceY: 160,
      sourceW: 100,
      sourceH: 80, // midY = 200
      targetX: 550,
      targetY: 160,
      targetW: 100,
      targetH: 80, // midY = 200
      waypoints: [
        { x: 500, y: 200 },
        { x: 550, y: 200 },
      ],
    });
    const originalWps = conn.waypoints.map((wp: any) => ({ ...wp }));
    const fixed = straightenNonOrthogonalFlows([conn]);
    expect(fixed).toBe(0); // already orthogonal → not modified
    expect(conn.waypoints).toEqual(originalWps);
  });

  test('large Y drift (> tolerance): produces orthogonal L-shape', () => {
    // source midY=200, target midY=350 → large vertical offset → 4-point L-shape
    const conn = makeConn({
      sourceX: 400,
      sourceY: 160,
      sourceW: 100,
      sourceH: 80, // midY = 200
      targetX: 550,
      targetY: 310,
      targetW: 100,
      targetH: 80, // midY = 350
      waypoints: [
        { x: 500, y: 200 },
        { x: 520, y: 250 }, // diagonal
        { x: 550, y: 350 },
      ],
    });

    const fixed = straightenNonOrthogonalFlows([conn]);
    expect(fixed).toBe(1);
    expect(conn.waypoints.length).toBeGreaterThanOrEqual(2);
    expectFullyOrthogonal(conn.waypoints, 'large drift L-shape');
  });
});

// ── resetStaleWaypoints — gateway near-horizontal connections ──────────────

describe('resetStaleWaypoints — gateway small vertical offset', () => {
  /**
   * Classic pizza-process case: Gateway fan-out to a task on (almost) the same row.
   * applyGatewayFanoutReset skips small offsets (≤ sourceHalfHeight=25px).
   * The resulting routing from ManhattanLayout is often Z-shaped.
   * resetStaleWaypoints should assign a clean L-shape path.
   */
  test('gateway → task with 5 px drift produces orthogonal path', () => {
    const conn = makeConn({
      sourceX: 550,
      sourceY: 180,
      sourceW: 50,
      sourceH: 50, // midY = 205  (gateway, halfHeight=25)
      targetX: 650,
      targetY: 160,
      targetW: 100,
      targetH: 80, // midY = 200
      sourceType: 'bpmn:ExclusiveGateway',
      waypoints: [
        { x: 575, y: 205 }, // stale: at gateway center-X (triggers check 4)
        { x: 700, y: 200 },
      ],
    });

    resetStaleWaypoints(conn);

    expect(conn.waypoints.length).toBeGreaterThanOrEqual(2);
    expectFullyOrthogonal(conn.waypoints, 'gateway 5 px drift');
    // First waypoint must be at the gateway right edge
    expect(Math.abs(conn.waypoints[0].x - 600)).toBeLessThanOrEqual(2);
    // Last waypoint must be at the task left edge
    expect(Math.abs(conn.waypoints[conn.waypoints.length - 1].x - 650)).toBeLessThanOrEqual(2);
  });

  test('gateway → task with 15 px drift produces orthogonal path', () => {
    // Beyond SAME_Y_TOLERANCE → L-shape, not straight path
    const conn = makeConn({
      sourceX: 550,
      sourceY: 180,
      sourceW: 50,
      sourceH: 50, // midY = 205
      targetX: 650,
      targetY: 150,
      targetW: 100,
      targetH: 80, // midY = 190  → drift = 15 px
      sourceType: 'bpmn:ExclusiveGateway',
      waypoints: [
        { x: 575, y: 205 }, // stale: center-X
        { x: 700, y: 190 },
      ],
    });

    resetStaleWaypoints(conn);

    expect(conn.waypoints.length).toBeGreaterThanOrEqual(2);
    expectFullyOrthogonal(conn.waypoints, 'gateway 15 px drift');
  });

  test('isFullyOrthogonal correctly detects a diagonal 2-point path', () => {
    // Reproduces the old (broken) behaviour: two waypoints at different Y
    const diagonal = [
      { x: 600, y: 205 },
      { x: 650, y: 200 },
    ];
    expect(isFullyOrthogonal(diagonal)).toBe(false);
  });

  test('isFullyOrthogonal accepts 2-point path with shared Y', () => {
    const straight = [
      { x: 600, y: 202 },
      { x: 650, y: 202 },
    ];
    expect(isFullyOrthogonal(straight)).toBe(true);
  });
});
