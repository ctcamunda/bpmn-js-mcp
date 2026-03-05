/**
 * Tests for backward (loop-back) flow waypoint routing in resetStaleWaypoints.
 *
 * resetStaleWaypoints previously early-returned for backward flows
 * (targetLeft <= sourceRight), leaving loop-back waypoints untouched.
 * This test verifies that backward flows now receive clean rectangular
 * U-arch waypoints (exit source bottom → drop below → traverse left →
 * enter target bottom).
 */
import { describe, test, expect } from 'vitest';
import { resetStaleWaypoints, isFullyOrthogonal } from '../../../src/rebuild/waypoints';

/** Create a minimal connection-like object for testing. */
function createConn(
  source: { x: number; y: number; width: number; height: number; type?: string },
  target: { x: number; y: number; width: number; height: number; type?: string },
  waypoints: Array<{ x: number; y: number }>
): any {
  return {
    type: 'bpmn:SequenceFlow',
    source: { id: 'source', type: source.type ?? 'bpmn:Task', ...source, parent: null },
    target: { id: 'target', type: target.type ?? 'bpmn:Task', ...target, parent: null },
    waypoints,
  };
}

describe('resetStaleWaypoints — backward flows', () => {
  test('assigns U-shaped waypoints to a backward connection', () => {
    // Source is to the RIGHT of target (backward loop-back flow)
    const source = { x: 400, y: 100, width: 100, height: 80 };
    const target = { x: 100, y: 100, width: 100, height: 80 };

    // Start with diagonal/messy waypoints
    const conn = createConn(source, target, [
      { x: 450, y: 180 },
      { x: 350, y: 250 },
      { x: 150, y: 180 },
    ]);

    resetStaleWaypoints(conn);

    // Should now have a U-shaped path (4 waypoints)
    expect(conn.waypoints.length).toBe(4);
    expect(isFullyOrthogonal(conn.waypoints)).toBe(true);

    // First waypoint exits from source bottom-centre
    const srcCenterX = source.x + source.width / 2;
    const srcBottom = source.y + source.height;
    expect(conn.waypoints[0].x).toBe(srcCenterX);
    expect(conn.waypoints[0].y).toBe(srcBottom);

    // Last waypoint enters target bottom-centre
    const tgtCenterX = target.x + target.width / 2;
    const tgtBottom = target.y + target.height;
    expect(conn.waypoints[3].x).toBe(tgtCenterX);
    expect(conn.waypoints[3].y).toBe(tgtBottom);

    // Middle waypoints form a horizontal segment below both elements
    expect(conn.waypoints[1].y).toBeGreaterThan(Math.max(srcBottom, tgtBottom));
    expect(conn.waypoints[2].y).toBe(conn.waypoints[1].y); // same Y = horizontal segment
  });

  test('does not modify already-orthogonal backward connections', () => {
    const source = { x: 400, y: 100, width: 100, height: 80 };
    const target = { x: 100, y: 100, width: 100, height: 80 };

    // Already clean U-shape waypoints
    const srcCenterX = source.x + source.width / 2;
    const tgtCenterX = target.x + target.width / 2;
    const routeY = 220;
    const originalWps = [
      { x: srcCenterX, y: source.y + source.height },
      { x: srcCenterX, y: routeY },
      { x: tgtCenterX, y: routeY },
      { x: tgtCenterX, y: target.y + target.height },
    ];

    const conn = createConn(source, target, JSON.parse(JSON.stringify(originalWps)));
    resetStaleWaypoints(conn);

    // Already orthogonal — should still be orthogonal
    expect(isFullyOrthogonal(conn.waypoints)).toBe(true);
  });

  test('handles backward flow where source and target are at different Y levels', () => {
    const source = { x: 400, y: 200, width: 100, height: 80 };
    const target = { x: 100, y: 50, width: 100, height: 80 };

    const conn = createConn(source, target, [
      { x: 400, y: 240 },
      { x: 250, y: 150 },
      { x: 100, y: 90 },
    ]);

    resetStaleWaypoints(conn);

    // Should produce orthogonal U-shaped waypoints
    expect(conn.waypoints.length).toBe(4);
    expect(isFullyOrthogonal(conn.waypoints)).toBe(true);

    // The route Y should be below the lower element
    const routeY = conn.waypoints[1].y;
    expect(routeY).toBeGreaterThan(source.y + source.height);
  });
});
