/**
 * Post-processing function that adjusts external labels to bpmn-js
 * default positions (matching Camunda Modeler interactive placement).
 *
 * Uses the same formula as bpmn-js `getExternalLabelMid()`:
 * - Events / Gateways / Data objects: label centre below the element
 *   at (element.centerX, element.bottom + DEFAULT_LABEL_SIZE.height / 2)
 * - Flows: label at the midpoint of the first segment, offset perpendicular
 *   to the side (top/bottom/left/right) with fewer shape crossings
 *
 * Boundary events with outgoing flows get their label placed to the left
 * to avoid overlapping the downward-exiting flow.
 *
 * Entry points:
 * - `adjustDiagramLabels(diagram)` — adjusts all element labels in a diagram
 * - `adjustElementLabel(diagram, elementId)` — adjusts a single element's label
 * - `centerFlowLabels(diagram)` — centers flow labels on connection midpoints
 */

import { type DiagramState } from '../../../types';
import type { BpmnElement } from '../../../bpmn-types';
import {
  DEFAULT_LABEL_SIZE,
  ELEMENT_LABEL_DISTANCE,
  FLOW_LABEL_SIDE_OFFSET,
} from '../../../constants';
import { getVisibleElements, syncXml, getService } from '../../helpers';

// ── Helpers ────────────────────────────────────────────────────────────────

const BOUNDARY_EVENT_TYPE = 'bpmn:BoundaryEvent';

/** Check whether an element type has an external label. */
function hasExternalLabel(type: string): boolean {
  return (
    type.includes('Event') ||
    type.includes('Gateway') ||
    type === 'bpmn:DataStoreReference' ||
    type === 'bpmn:DataObjectReference'
  );
}

/**
 * Compute the bpmn-js default label position for an element.
 *
 * Replicates `getExternalLabelMid()` from bpmn-js/lib/util/LabelUtil:
 *   centre = (element.centerX, element.bottom + DEFAULT_LABEL_SIZE.height / 2)
 *
 * Returns the top-left corner of the label rect.
 */
function getDefaultLabelPosition(
  element: { x: number; y: number; width: number; height: number },
  labelWidth: number,
  labelHeight: number
): { x: number; y: number } {
  const midX = element.x + element.width / 2;
  const midY = element.y + element.height + DEFAULT_LABEL_SIZE.height / 2;
  return {
    x: Math.round(midX - labelWidth / 2),
    y: Math.round(midY - labelHeight / 2),
  };
}

/** Classify a waypoint into 'top' | 'bottom' | 'left' | 'right' relative to a gateway centre. */
function classifyWaypointSide(
  wp: { x: number; y: number },
  cx: number,
  cy: number,
  dockTol: number
): string {
  if (wp.y < cy - dockTol) return 'top';
  if (wp.y > cy + dockTol) return 'bottom';
  return wp.x <= cx ? 'left' : 'right';
}

/**
 * Determine which sides of a gateway diamond have sequence flow endpoints
 * docked to them.  Returns a Set of side names ('top' | 'bottom' | 'left' | 'right').
 *
 * A flow endpoint is considered "docked" to a side when the relevant waypoint
 * (first for outgoing, last for incoming) is:
 *   - top    : waypoint.y  < elementCentreY - DOCK_TOLERANCE
 *   - bottom : waypoint.y  > elementCentreY + DOCK_TOLERANCE
 *   - left   : waypoint.x <= elementCentreX (and not top/bottom)
 *   - right  : waypoint.x >  elementCentreX (and not top/bottom)
 */
function getGatewaySidesWithFlows(
  element: { id?: string; x: number; y: number; width: number; height: number },
  allElements: any[]
): Set<string> {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const DOCK_TOLERANCE = (element.height / 2) * 0.4; // ~40% of half-height
  const elementId = (element as any).id;

  const sides = new Set<string>();

  for (const conn of allElements) {
    if (conn.type !== 'bpmn:SequenceFlow') continue;
    const wps: Array<{ x: number; y: number }> = conn.waypoints;
    if (!wps || wps.length < 2) continue;

    if (conn.source?.id === elementId) {
      sides.add(classifyWaypointSide(wps[0], cx, cy, DOCK_TOLERANCE));
    }
    if (conn.target?.id === elementId) {
      sides.add(classifyWaypointSide(wps[wps.length - 1], cx, cy, DOCK_TOLERANCE));
    }
  }
  return sides;
}

/** Count shapes whose bounds overlap the given label candidate box. */
function countShapeOverlaps(
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  shapes: any[]
): number {
  let count = 0;
  for (const s of shapes) {
    if (s.x === undefined || s.y === undefined || !s.width || !s.height) continue;
    if (cx1 < s.x + s.width && cx2 > s.x && cy1 < s.y + s.height && cy2 > s.y) count++;
  }
  return count;
}

/**
 * Compute the best label position for a gateway using four-sided candidate scoring.
 *
 * Scores four candidate positions (below / above / left / right) for:
 *   1. Whether the side has a flow endpoint docked to it (+100 penalty)
 *   2. How many sibling shapes the label rect overlaps (+1 per overlap)
 *
 * Picks the lowest-scoring candidate. Falls back to "below" (bpmn-js default)
 * when all sides score equally (e.g. a gateway with 4-way flows).
 */
function getGatewayLabelPosition(
  element: { id?: string; x: number; y: number; width: number; height: number },
  labelWidth: number,
  labelHeight: number,
  shapes: any[],
  allElements: any[]
): { x: number; y: number } {
  const midX = element.x + element.width / 2;
  const midY = element.y + element.height / 2;
  const bottom = element.y + element.height;
  const top = element.y;
  const left = element.x;
  const right = element.x + element.width;

  // Label vertical padding mirrors bpmn-js getExternalLabelMid formula
  const vertGap = DEFAULT_LABEL_SIZE.height / 2 - labelHeight / 2;

  const candidates: Array<{ side: string; x: number; y: number }> = [
    // below (bpmn-js default — preferred when free)
    {
      side: 'bottom',
      x: Math.round(midX - labelWidth / 2),
      y: Math.round(bottom + vertGap),
    },
    // above
    {
      side: 'top',
      x: Math.round(midX - labelWidth / 2),
      y: Math.round(top - vertGap - labelHeight),
    },
    // right of gateway
    {
      side: 'right',
      x: Math.round(right + ELEMENT_LABEL_DISTANCE),
      y: Math.round(midY - labelHeight / 2),
    },
    // left of gateway
    {
      side: 'left',
      x: Math.round(left - ELEMENT_LABEL_DISTANCE - labelWidth),
      y: Math.round(midY - labelHeight / 2),
    },
  ];

  const sidesUsed = getGatewaySidesWithFlows(element, allElements);

  let best = candidates[0];
  let bestScore = Infinity;

  for (const c of candidates) {
    let score = 0;

    // Heavy penalty when this side has a flow endpoint docked to it
    if (sidesUsed.has(c.side)) score += 100;

    // Lighter penalty for overlapping sibling shapes
    score += countShapeOverlaps(c.x, c.y, c.x + labelWidth, c.y + labelHeight, shapes);

    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return { x: best.x, y: best.y };
}

/**
 * Compute the best label position for a boundary event.
 *
 * Boundary events sit on the bottom edge of their host task. Their outgoing
 * flows exit downward, so placing the label directly below (centred) puts it
 * on top of the flow line.  Placing it mid-height to the left/right overlaps
 * the host task body.
 *
 * Instead we use LOWER-LEFT and LOWER-RIGHT candidates: same Y as "below"
 * (below the event's bottom edge) but offset horizontally so the label sits
 * beside the downward flow rather than under it.
 *
 * Falls back to "below" when no shapes are provided for scoring.
 */
function getBoundaryEventLabelPosition(
  element: { x: number; y: number; width: number; height: number },
  labelWidth: number,
  labelHeight: number,
  shapes?: Array<{ x: number; y: number; width: number; height: number }>
): { x: number; y: number } {
  const midX = element.x + element.width / 2;
  const bottom = element.y + element.height;
  const labelY = Math.round(bottom + ELEMENT_LABEL_DISTANCE);

  // Three candidate positions:
  //   lower-left  — to the left of the event, below the host task
  //   lower-right — to the right of the event, beside the exception chain
  //   below       — centred below (fallback; sits on the downward flow line)
  const candidates = [
    {
      x: Math.round(element.x - ELEMENT_LABEL_DISTANCE - labelWidth),
      y: labelY,
    }, // lower-left
    {
      x: Math.round(element.x + element.width + ELEMENT_LABEL_DISTANCE),
      y: labelY,
    }, // lower-right
    { x: Math.round(midX - labelWidth / 2), y: labelY }, // below (fallback)
  ];

  if (!shapes || shapes.length === 0) {
    // No shape context — prefer lower-left (exception chains extend to the right)
    return candidates[0];
  }

  // Pick candidate with fewest overlapping shapes; ties broken left → right → below
  let best = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    let score = 0;
    const cx2 = c.x + labelWidth;
    const cy2 = c.y + labelHeight;
    for (const s of shapes) {
      if (c.x < s.x + s.width && cx2 > s.x && c.y < s.y + s.height && cy2 > s.y) score++;
    }
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/**
 * Check whether a boundary event has outgoing flows.
 */
function hasBoundaryOutgoingFlows(elementId: string, elements: any[]): boolean {
  return elements.some(
    (el) =>
      (el.type === 'bpmn:SequenceFlow' || el.type === 'bpmn:MessageFlow') &&
      el.source?.id === elementId
  );
}

// ── Core adjustment logic ──────────────────────────────────────────────────

/**
 * Adjust all external labels in a diagram to bpmn-js default positions.
 *
 * Returns the number of labels that were moved.
 */
export async function adjustDiagramLabels(diagram: DiagramState): Promise<number> {
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const allElements = getVisibleElements(elementRegistry);

  // Collect all elements with external labels
  const labelBearers = allElements.filter(
    (el: any) => hasExternalLabel(el.type) && el.label && el.businessObject?.name
  );

  if (labelBearers.length === 0) return 0;

  // Shapes used for overlap scoring (non-container, non-flow)
  const shapes = allElements.filter(
    (el: any) =>
      el.type !== 'label' &&
      !String(el.type).includes('Flow') &&
      !String(el.type).includes('Association') &&
      el.type !== 'bpmn:Participant' &&
      el.type !== 'bpmn:Lane' &&
      el.x !== undefined &&
      el.width !== undefined
  );

  let movedCount = 0;

  for (const el of labelBearers) {
    const label = el.label;
    if (!label) continue;

    const labelWidth = label.width || DEFAULT_LABEL_SIZE.width;
    const labelHeight = label.height || DEFAULT_LABEL_SIZE.height;

    let target: { x: number; y: number };

    // Gateways: use four-sided scoring to avoid placing label on a flow-docked face
    if (el.type.includes('Gateway')) {
      target = getGatewayLabelPosition(el, labelWidth, labelHeight, shapes, allElements);
    } else if (el.type === BOUNDARY_EVENT_TYPE && hasBoundaryOutgoingFlows(el.id, allElements)) {
      // Boundary events: use overlap-scored placement (left / right / below)
      target = getBoundaryEventLabelPosition(el, labelWidth, labelHeight, shapes);
    } else {
      target = getDefaultLabelPosition(el, labelWidth, labelHeight);
    }

    const dx = target.x - label.x;
    const dy = target.y - label.y;

    // Only move if displacement is significant (> 1px)
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      modeling.moveShape(label as unknown as BpmnElement, { x: dx, y: dy });
      movedCount++;
    }
  }

  if (movedCount > 0) {
    await syncXml(diagram);
  }

  return movedCount;
}

/**
 * Adjust the label for a single element (used after adding/connecting).
 *
 * Returns true if the label was moved.
 */
export async function adjustElementLabel(
  diagram: DiagramState,
  elementId: string
): Promise<boolean> {
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const el = elementRegistry.get(elementId);

  if (!el || !el.label || !hasExternalLabel(el.type) || !el.businessObject?.name) {
    return false;
  }

  const label = el.label;
  const labelWidth = label.width || DEFAULT_LABEL_SIZE.width;
  const labelHeight = label.height || DEFAULT_LABEL_SIZE.height;

  let target: { x: number; y: number };

  const allVisibleElements = getVisibleElements(elementRegistry);
  const shapesForEl = allVisibleElements.filter(
    (s: any) =>
      s.type !== 'label' &&
      !String(s.type).includes('Flow') &&
      !String(s.type).includes('Association') &&
      s.type !== 'bpmn:Participant' &&
      s.type !== 'bpmn:Lane' &&
      s.x !== undefined &&
      s.width !== undefined
  );

  if (el.type.includes('Gateway')) {
    target = getGatewayLabelPosition(el, labelWidth, labelHeight, shapesForEl, allVisibleElements);
  } else if (
    el.type === BOUNDARY_EVENT_TYPE &&
    hasBoundaryOutgoingFlows(el.id, allVisibleElements)
  ) {
    target = getBoundaryEventLabelPosition(el, labelWidth, labelHeight, shapesForEl);
  } else {
    target = getDefaultLabelPosition(el, labelWidth, labelHeight);
  }

  const dx = target.x - label.x;
  const dy = target.y - label.y;

  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    modeling.moveShape(label as BpmnElement, { x: dx, y: dy });
    await syncXml(diagram);
    return true;
  }

  return false;
}

// FLOW_LABEL_SIDE_OFFSET is imported from ../../../constants

/**
 * Position labeled flow labels at the midpoint of their first segment,
 * offset perpendicular to the side with fewer shape overlaps.
 *
 * - Horizontal first segment → above (preferred) or below.
 * - Vertical first segment   → right (preferred) or left.
 *
 * This matches bpmn-js interactive placement: the label hugs the first
 * bend of the connection rather than floating at the path midpoint.
 *
 * Returns the number of flow labels moved.
 */
export async function centerFlowLabels(diagram: DiagramState): Promise<number> {
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const allElements = getVisibleElements(elementRegistry);

  // Non-container, non-flow shapes used when scoring candidate sides.
  const shapes = allElements.filter(
    (el: any) =>
      el.type !== 'label' &&
      !String(el.type).includes('Flow') &&
      !String(el.type).includes('Association') &&
      el.type !== 'bpmn:Participant' &&
      el.type !== 'bpmn:Lane' &&
      el.x !== undefined &&
      el.width !== undefined
  );

  const labeledFlows = allElements.filter(
    (el: any) =>
      (el.type === 'bpmn:SequenceFlow' || el.type === 'bpmn:MessageFlow') &&
      el.label &&
      el.businessObject?.name &&
      el.waypoints &&
      el.waypoints.length >= 2
  );

  let movedCount = 0;

  for (const flow of labeledFlows) {
    const label = flow.label!;
    const waypoints = flow.waypoints!;

    const labelW = label.width || DEFAULT_LABEL_SIZE.width;
    const labelH = label.height || DEFAULT_LABEL_SIZE.height;

    const target = computePathMidpointLabelPos(waypoints, labelW, labelH, shapes);

    const moveX = target.x - label.x;
    const moveY = target.y - label.y;

    // Only move if displacement is significant (> 2px)
    if (Math.abs(moveX) > 2 || Math.abs(moveY) > 2) {
      modeling.moveShape(label as unknown as BpmnElement, { x: moveX, y: moveY });
      movedCount++;
    }
  }

  if (movedCount > 0) await syncXml(diagram);
  return movedCount;
}

// ── Flow label positioning ─────────────────────────────────────────────────

/**
 * Compute the bpmn-js-style label position for a flow connection.
 *
 * Picks the middle pair of waypoints using the same formula as bpmn-js
 * `getFlowLabelPosition()`: `mid = waypoints.length / 2 - 1`.
 * For 2-point connections this is equivalent to the first-segment midpoint;
 * for multi-bend L-shaped or U-shaped connections the label is placed at the
 * true path centre rather than near the source.
 *
 * The label is then placed on the perpendicular side with fewer shape overlaps.
 */
function computePathMidpointLabelPos(
  waypoints: Array<{ x: number; y: number }>,
  labelW: number,
  labelH: number,
  shapes: any[]
): { x: number; y: number } {
  // Use path midpoint: pick the middle waypoint pair (matches bpmn-js LabelUtil)
  const mid = waypoints.length / 2 - 1;
  const p0 = waypoints[Math.floor(mid)];
  const p1 = waypoints[Math.ceil(mid + 0.01)];

  const midX = (p0.x + p1.x) / 2;
  const midY = (p0.y + p1.y) / 2;
  const isHoriz = Math.abs(p1.x - p0.x) >= Math.abs(p1.y - p0.y);

  // Two perpendicular candidates — candidateA is the preferred default side.
  const candidateA = isHoriz
    ? { x: Math.round(midX - labelW / 2), y: Math.round(midY - FLOW_LABEL_SIDE_OFFSET - labelH) } // above
    : { x: Math.round(midX + FLOW_LABEL_SIDE_OFFSET), y: Math.round(midY - labelH / 2) }; // right
  const candidateB = isHoriz
    ? { x: Math.round(midX - labelW / 2), y: Math.round(midY + FLOW_LABEL_SIDE_OFFSET) } // below
    : { x: Math.round(midX - FLOW_LABEL_SIDE_OFFSET - labelW), y: Math.round(midY - labelH / 2) }; // left

  return labelSideScore(candidateA, labelW, labelH, shapes) <=
    labelSideScore(candidateB, labelW, labelH, shapes)
    ? candidateA
    : candidateB;
}

/** Count shape overlaps for a label candidate rect (lower score = better). */
function labelSideScore(
  pos: { x: number; y: number },
  w: number,
  h: number,
  shapes: any[]
): number {
  const x2 = pos.x + w;
  const y2 = pos.y + h;
  let score = 0;
  for (const s of shapes) {
    if (s.x === undefined || s.y === undefined || s.width === undefined || s.height === undefined) {
      continue;
    }
    if (pos.x < s.x + s.width && x2 > s.x && pos.y < s.y + s.height && y2 > s.y) score++;
  }
  return score;
}
