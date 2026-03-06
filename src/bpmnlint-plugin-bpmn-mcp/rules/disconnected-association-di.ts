/**
 * Custom bpmnlint rule: disconnected-association-di
 *
 * Reports an error when a `bpmn:Association`'s `BPMNEdge` has its first
 * waypoint outside the source element's DI bounds (+ tolerance) or its last
 * waypoint outside the target element's DI bounds (+ tolerance).
 *
 * Root cause: `modeling.layoutConnection()` explicitly skips `bpmn:Association`,
 * so association waypoints frozen at creation time are never updated when layout
 * repositions the connected elements.  This produces edges whose waypoints are
 * disconnected from their source/target shapes, making the link invisible.
 *
 * This is most commonly observed with compensation associations:
 *   Event_CompensationLink (x=433, y=222) → ServiceTask_RefundPayment (x=130, y=290)
 *   BPMNEdge waypoints: (100,82)→(100,60)→(180,60)→(180,290)  ← far from source
 *
 * Fix: run `layout_bpmn_diagram` (which now recomputes stale association
 * waypoints) or use `connect_bpmn_elements` with explicit `waypoints`.
 */

import { isType } from '../utils';

/** Tolerance in pixels for waypoint-within-bounds check. */
const TOLERANCE = 20;

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

/** Check if a point is within bounds + tolerance. */
function pointWithinBounds(p: Point, b: Bounds, tol: number): boolean {
  return (
    p.x >= b.x - tol &&
    p.x <= b.x + b.width + tol &&
    p.y >= b.y - tol &&
    p.y <= b.y + b.height + tol
  );
}

/** Walk up parent chain to find bpmn:Definitions. */
function findDefinitions(node: any): any | null {
  let current = node;
  while (current) {
    if (current.$type === 'bpmn:Definitions') return current;
    current = current.$parent;
  }
  return null;
}

/**
 * Build maps from bpmnElement ID → DI bounds (for shapes) and
 * bpmnElement ID → waypoints (for edges).
 */
function collectDI(definitions: any): {
  shapeBounds: Map<string, Bounds>;
  edgeWaypoints: Map<string, Point[]>;
  edgeElementIds: Map<string, string>; // bpmndi:BPMNEdge id → bpmnElement id
} {
  const shapeBounds = new Map<string, Bounds>();
  const edgeWaypoints = new Map<string, Point[]>();
  const edgeElementIds = new Map<string, string>();

  const diagrams = definitions?.diagrams ?? [];
  for (const diagram of diagrams) {
    const plane = diagram?.plane;
    if (!plane?.planeElement) continue;

    for (const el of plane.planeElement) {
      if (isType(el, 'bpmndi:BPMNShape') && el.bpmnElement?.id && el.bounds) {
        shapeBounds.set(el.bpmnElement.id, {
          x: el.bounds.x,
          y: el.bounds.y,
          width: el.bounds.width,
          height: el.bounds.height,
        });
      } else if (isType(el, 'bpmndi:BPMNEdge') && el.bpmnElement?.id) {
        const wps: Point[] = (el.waypoint ?? []).map((wp: any) => ({ x: wp.x, y: wp.y }));
        edgeWaypoints.set(el.bpmnElement.id, wps);
        edgeElementIds.set(el.id, el.bpmnElement.id);
      }
    }
  }

  return { shapeBounds, edgeWaypoints, edgeElementIds };
}

export default function disconnectedAssociationDi() {
  function check(node: any, reporter: any) {
    // Check at Process / SubProcess level where flowElements and artifacts live
    if (!isType(node, 'bpmn:Process') && !isType(node, 'bpmn:SubProcess')) return;

    const defs = findDefinitions(node);
    if (!defs) return;

    const { shapeBounds, edgeWaypoints } = collectDI(defs);
    if (shapeBounds.size === 0 || edgeWaypoints.size === 0) return;

    const flowElements = node.flowElements ?? [];
    const artifacts = node.artifacts ?? [];
    const allElements = [...flowElements, ...artifacts];

    const associations = allElements.filter((el: any) => isType(el, 'bpmn:Association'));

    for (const assoc of associations) {
      const sourceId = assoc.sourceRef?.id;
      const targetId = assoc.targetRef?.id;
      if (!sourceId || !targetId) continue;

      const wps = edgeWaypoints.get(assoc.id);
      if (!wps || wps.length < 2) continue;

      const srcBounds = shapeBounds.get(sourceId);
      const tgtBounds = shapeBounds.get(targetId);
      if (!srcBounds || !tgtBounds) continue;

      const firstWp = wps[0];
      const lastWp = wps[wps.length - 1];

      const firstOk = pointWithinBounds(firstWp, srcBounds, TOLERANCE);
      const lastOk = pointWithinBounds(lastWp, tgtBounds, TOLERANCE);

      if (!firstOk || !lastOk) {
        const srcName = assoc.sourceRef?.name || sourceId;
        const tgtName = assoc.targetRef?.name || targetId;
        const issues: string[] = [];
        if (!firstOk) {
          issues.push(
            `first waypoint (${firstWp.x},${firstWp.y}) is outside source "${srcName}" bounds ` +
              `[${srcBounds.x},${srcBounds.y} ${srcBounds.width}×${srcBounds.height}]`
          );
        }
        if (!lastOk) {
          issues.push(
            `last waypoint (${lastWp.x},${lastWp.y}) is outside target "${tgtName}" bounds ` +
              `[${tgtBounds.x},${tgtBounds.y} ${tgtBounds.width}×${tgtBounds.height}]`
          );
        }
        reporter.report(
          assoc.id,
          `Association has disconnected DI waypoints — ${issues.join('; ')}. ` +
            `Run layout_bpmn_diagram to recompute association waypoints, or use ` +
            `connect_bpmn_elements with explicit waypoints to fix.`
        );
      }
    }
  }

  return { check };
}
