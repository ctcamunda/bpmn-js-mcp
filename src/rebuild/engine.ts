/**
 * Rebuild-based layout engine — core positioning algorithm.
 *
 * Repositions existing diagram elements using a topology-driven
 * forward pass.  Elements are moved (not recreated) to preserve
 * all business properties, IDs, and connections.
 *
 * Algorithm:
 *   1. Build container hierarchy and process inside-out
 *   2. Per container: extract flow graph and detect back-edges
 *   3. Topological sort with layer assignment
 *   4. Detect gateway split/merge patterns
 *   5. Forward pass: compute target positions left-to-right
 *   6. Apply positions via modeling.moveElements
 *   7. Position boundary events and exception chains
 *   8. Resize expanded subprocesses to fit contents
 *   9. Position artifacts (text annotations, data objects) near associated nodes
 *   10. Layout all connections (forward flows + back-edges + exception chains)
 *   11. Stack pools vertically for collaborations
 *   12. Adjust labels to bpmn-js default positions
 */

import type { DiagramState } from '../types';
import { type BpmnElement, type ElementRegistry, type Modeling, getService } from '../bpmn-types';
import { STANDARD_BPMN_GAP } from '../constants';
import { extractFlowGraph, type FlowGraph } from './topology';
import { detectBackEdges, topologicalSort } from './graph';
import { detectGatewayPatterns } from './patterns';
import { identifyBoundaryEvents } from './boundary';
import {
  buildContainerHierarchy,
  getContainerRebuildOrder,
  moveElementTo,
  collectExceptionChainIds,
  positionBoundaryEventsAndChains,
  resizeSubprocessToFit,
  stackPools,
  layoutMessageFlows,
  getEventSubprocessIds,
  positionEventSubprocesses,
} from './container-layout';
import { buildPatternLookups, computePositions, resolvePositionOverlaps } from './positioning';
import {
  applyLaneLayout,
  buildElementToLaneMap,
  buildElementLaneYMap,
  getLanesForParticipant,
  resizePoolToFit,
  restoreLaneAssignments,
  syncBoundaryEventLanes,
} from './lane-layout';
import { positionArtifacts, adjustLabels } from './artifacts';

// ── Types ──────────────────────────────────────────────────────────────────

/** Options for the rebuild layout engine. */
export interface RebuildOptions {
  /** Origin position for the first start event (center coordinates). */
  origin?: { x: number; y: number };
  /** Edge-to-edge gap between consecutive elements (default: 50). */
  gap?: number;
  /**
   * Vertical centre-to-centre spacing between gateway branches.
   * Default: 130 (task height 80 + standard gap 50).
   */
  branchSpacing?: number;
  /**
   * Set of element IDs that should not be repositioned (pinned elements).
   * The rebuild engine will skip these elements and place other elements
   * around them.
   */
  pinnedElementIds?: Set<string>;
  /**
   * When true, skip the internal pool/lane resize that normally runs after
   * element positioning.  Use this when the caller intends to run
   * `autosize_bpmn_pools_and_lanes` (or `handleAutosizePoolsAndLanes`)
   * afterwards, to avoid a redundant double-resize.
   *
   * Task 7b: `rebuildLayout` uses a proportional lane-height algorithm
   * (`resizePoolAndLanes`) while `handleAutosizePoolsAndLanes` uses the
   * `autosize-pools-and-lanes` handler algorithm.  When `poolExpansion`
   * is enabled in `handleLayoutDiagram`, the handler calls
   * `handleAutosizePoolsAndLanes` after rebuild, which overrides the
   * internal resize anyway — setting this flag avoids the redundant step.
   */
  skipPoolResize?: boolean;
}

/** Result returned by the rebuild layout engine. */
export interface RebuildResult {
  /** Number of elements repositioned. */
  repositionedCount: number;
  /** Number of connections re-routed. */
  reroutedCount: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Default origin for the first start event (center coordinates). */
const DEFAULT_ORIGIN = { x: 180, y: 200 };

/**
 * Default vertical centre-to-centre spacing between gateway branches.
 * Matches typical BPMN layout: task height (80) + standard gap (50).
 */
const DEFAULT_BRANCH_SPACING = 130;

/**
 * Padding (px) inside an expanded subprocess around its internal
 * elements.  Applied on all four sides.
 */
const SUBPROCESS_PADDING = 40;

/** Gap (px) between stacked participant pools. */
const POOL_GAP = 68;

// ── Main rebuild function ──────────────────────────────────────────────────

/**
 * Rebuild the layout of a diagram by repositioning elements using
 * topology-driven placement.
 *
 * Does NOT create or delete elements — only moves them.  All business
 * properties, IDs, and connections are preserved.
 *
 * Handles containers (subprocesses, participants) by rebuilding
 * inside-out: deepest containers first, then their parents.
 *
 * @param diagram  The diagram state to rebuild.
 * @param options  Optional configuration for origin, gap, and branch spacing.
 * @returns        Summary of repositioned elements and re-routed connections.
 */
export function rebuildLayout(diagram: DiagramState, options?: RebuildOptions): RebuildResult {
  const modeler = diagram.modeler;
  const modeling = getService(modeler, 'modeling');
  const registry = getService(modeler, 'elementRegistry');

  const origin = options?.origin ?? DEFAULT_ORIGIN;
  const gap = options?.gap ?? STANDARD_BPMN_GAP;
  const branchSpacing = options?.branchSpacing ?? DEFAULT_BRANCH_SPACING;
  const pinnedElementIds = options?.pinnedElementIds;
  const skipPoolResize = options?.skipPoolResize ?? false;

  const hierarchy = buildContainerHierarchy(registry);
  const rebuildOrder = getContainerRebuildOrder(hierarchy);

  let totalRepositioned = 0;
  let totalRerouted = 0;
  const rebuiltParticipants: BpmnElement[] = [];

  for (const containerNode of rebuildOrder) {
    const counts = processContainerNode(
      containerNode,
      registry,
      modeling,
      origin,
      gap,
      branchSpacing,
      pinnedElementIds,
      rebuiltParticipants,
      skipPoolResize
    );
    totalRepositioned += counts.repositionedCount;
    totalRerouted += counts.reroutedCount;
  }

  if (rebuiltParticipants.length > 1) {
    totalRepositioned += stackPools(rebuiltParticipants, modeling, POOL_GAP);
  }

  totalRerouted += layoutMessageFlows(registry, modeling);
  totalRepositioned += adjustLabels(registry, modeling);

  return { repositionedCount: totalRepositioned, reroutedCount: totalRerouted };
}

// ── Per-container processing ───────────────────────────────────────────────

/**
 * Process a single container node in the rebuild order.
 * Returns repositioned/rerouted counts (zeros for skipped containers).
 */
function processContainerNode(
  containerNode: ReturnType<typeof getContainerRebuildOrder>[number],
  registry: ElementRegistry,
  modeling: Modeling,
  origin: { x: number; y: number },
  gap: number,
  branchSpacing: number,
  pinnedElementIds: Set<string> | undefined,
  rebuiltParticipants: BpmnElement[],
  skipPoolResize: boolean
): RebuildResult {
  const container = containerNode.element;

  // Skip Collaboration root — it doesn't hold flow nodes directly
  if (container.type === 'bpmn:Collaboration') return { repositionedCount: 0, reroutedCount: 0 };

  // Use subprocess-internal origin for subprocesses
  const containerOrigin =
    container.type === 'bpmn:SubProcess' ? { x: SUBPROCESS_PADDING + 18, y: origin.y } : origin;

  // Detect event subprocesses to exclude from main flow positioning
  const eventSubIds = getEventSubprocessIds(registry, container);

  // Save lane assignments BEFORE rebuild — bpmn-js mutates flowNodeRef
  // when elements are moved, so we need the original mapping.
  const participantLanes =
    container.type === 'bpmn:Participant' ? getLanesForParticipant(registry, container) : [];
  const savedLaneMap =
    participantLanes.length > 0
      ? buildElementToLaneMap(participantLanes, registry)
      : new Map<string, BpmnElement>();

  // Lane-aware positioning: precompute element → lane center Y (tasks 3a/3c)
  const elementLaneYs =
    participantLanes.length > 0
      ? buildElementLaneYMap(participantLanes, savedLaneMap, containerOrigin.y)
      : undefined;

  const result = rebuildContainer(
    registry,
    modeling,
    container,
    containerOrigin,
    gap,
    branchSpacing,
    eventSubIds,
    pinnedElementIds,
    elementLaneYs
  );

  let repositionedCount = result.repositionedCount;
  const reroutedCount = result.reroutedCount;

  if (eventSubIds.size > 0) {
    repositionedCount += positionEventSubprocesses(
      eventSubIds,
      registry,
      modeling,
      container,
      gap,
      containerOrigin.x
    );
  }

  if (container.type === 'bpmn:SubProcess' && containerNode.isExpanded) {
    resizeSubprocessToFit(modeling, registry, container, SUBPROCESS_PADDING);
  }

  repositionedCount += positionArtifacts(registry, modeling, container);

  if (container.type === 'bpmn:Participant') {
    repositionedCount += applyParticipantLayout(
      container,
      participantLanes,
      savedLaneMap,
      registry,
      modeling,
      origin,
      rebuiltParticipants,
      skipPoolResize
    );

    // Clamp connection waypoints so none escape outside the pool Y bounds
    // (TODO #1: normaliseOrigin shifts elements but not waypoints).
    clampConnectionWaypointsToParticipant(container, registry, modeling);

    if (participantLanes.length > 0) {
      // Sync boundary event lane membership to their host's lane (issue #14).
      // Must run after applyParticipantLayout because the lane assignment
      // can be mutated when elements are moved during layout.
      syncBoundaryEventLanes(registry, savedLaneMap, participantLanes);
    }
  }

  return { repositionedCount, reroutedCount };
}

/**
 * Apply lane layout (or pool-fit resize) for a participant container.
 * Pushes the participant to `rebuiltParticipants` for pool stacking.
 *
 * @param skipPoolResize  When true, skip the internal pool/lane resize step.
 *   Use when the caller will run `handleAutosizePoolsAndLanes` afterwards
 *   (task 7b: avoids redundant double-resize with a different algorithm).
 */
function applyParticipantLayout(
  container: BpmnElement,
  participantLanes: BpmnElement[],
  savedLaneMap: Map<string, BpmnElement>,
  registry: ElementRegistry,
  modeling: Modeling,
  origin: { x: number; y: number },
  rebuiltParticipants: BpmnElement[],
  skipPoolResize: boolean
): number {
  let repositioned = 0;
  if (participantLanes.length > 0) {
    restoreLaneAssignments(registry, savedLaneMap, participantLanes);
    repositioned += applyLaneLayout(
      registry,
      modeling,
      container,
      origin.y,
      SUBPROCESS_PADDING,
      savedLaneMap,
      skipPoolResize
    );
  } else if (!skipPoolResize) {
    resizePoolToFit(modeling, registry, container, SUBPROCESS_PADDING);
  }
  rebuiltParticipants.push(container);
  return repositioned;
}

// ── Container rebuild ──────────────────────────────────────────────────────

/**
 * Rebuild the layout of a single container scope (Process, Participant,
 * or SubProcess).  Positions flow nodes, boundary events, and exception
 * chains within the container.
 */
function rebuildContainer(
  registry: ElementRegistry,
  modeling: Modeling,
  container: BpmnElement,
  origin: { x: number; y: number },
  gap: number,
  branchSpacing: number,
  additionalExcludeIds?: Set<string>,
  pinnedElementIds?: Set<string>,
  elementLaneYs?: Map<string, number>
): RebuildResult {
  // Extract flow graph scoped to this container
  const graph = extractFlowGraph(registry, container);
  if (graph.nodes.size === 0) {
    return { repositionedCount: 0, reroutedCount: 0 };
  }

  // Identify boundary events and collect exception chain IDs to skip
  const boundaryInfos = identifyBoundaryEvents(registry, container);
  const exceptionChainIds = collectExceptionChainIds(boundaryInfos);

  // Merge all exclude IDs (exception chains + event subprocesses)
  const allExcludeIds = new Set([...exceptionChainIds, ...(additionalExcludeIds ?? [])]);

  // Topology analysis
  const backEdgeIds = detectBackEdges(graph);
  const sorted = topologicalSort(graph, backEdgeIds);
  const patterns = detectGatewayPatterns(graph, backEdgeIds);
  const { mergeToPattern, elementToBranch } = buildPatternLookups(patterns);

  // Compute positions (skipping exception chain elements + event subprocesses)
  const positions = computePositions(
    graph,
    sorted,
    backEdgeIds,
    mergeToPattern,
    elementToBranch,
    origin,
    gap,
    branchSpacing,
    allExcludeIds,
    elementLaneYs
  );

  // Safety-net: spread any overlapping elements (e.g. open-fan parallel branches)
  resolvePositionOverlaps(positions, branchSpacing);

  // Apply positions (skip pinned elements)
  let repositionedCount = 0;
  for (const [id, target] of positions) {
    if (pinnedElementIds?.has(id)) continue;
    const element = registry.get(id);
    if (!element) continue;
    if (moveElementTo(modeling, element, target)) {
      repositionedCount++;
    }
  }

  // Layout main flow connections
  let reroutedCount = layoutConnections(graph, backEdgeIds, registry, modeling);

  // Position boundary events and exception chains
  const boundaryResult = positionBoundaryEventsAndChains(
    boundaryInfos,
    positions,
    registry,
    modeling,
    gap
  );
  repositionedCount += boundaryResult.repositionedCount;
  reroutedCount += boundaryResult.reroutedCount;

  return { repositionedCount, reroutedCount };
}

// ── Waypoint clamping ──────────────────────────────────────────────────────

/**
 * Clamp all sequence-flow waypoints so none fall outside the enclosing
 * participant's Y range.
 *
 * After pool resize (which may expand downward to include boundary-event
 * exception chains), bpmn-js's ManhattanLayout occasionally produces
 * intermediate waypoints that escape slightly above or below the pool
 * boundary.  This pass corrects them (TODO #1).
 *
 * Only sequence flows whose `parent` is the participant are considered;
 * message flows between pools are intentionally left untouched.
 *
 * @param container  The participant element whose waypoints to clamp.
 * @param registry   Element registry for the diagram.
 * @param modeling   Modeling service for waypoint updates.
 */
function clampConnectionWaypointsToParticipant(
  container: BpmnElement,
  registry: ElementRegistry,
  modeling: Modeling
): void {
  const poolTop = container.y;
  const poolBottom = container.y + container.height;

  const allElements = registry.getAll();
  for (const el of allElements) {
    if (el.type !== 'bpmn:SequenceFlow') continue;
    const waypoints = el.waypoints;
    if (!waypoints || waypoints.length === 0) continue;

    // Only clamp flows that belong to this participant's process
    if (el.parent !== container) continue;

    const newWaypoints = waypoints.map((wp) => ({
      ...wp,
      y: Math.max(poolTop, Math.min(poolBottom, wp.y)),
    }));

    const changed = newWaypoints.some((wp, i) => wp.y !== waypoints[i].y);
    if (changed) {
      modeling.updateWaypoints(el, newWaypoints);
    }
  }
}

// ── Connection layout ──────────────────────────────────────────────────────

/**
 * Re-layout all sequence flow connections after element repositioning.
 * Forward flows are laid out first, then back-edges (loops).
 *
 * Uses bpmn-js ManhattanLayout via modeling.layoutConnection() which
 * computes orthogonal waypoints based on element positions.
 */
/**
 * Reset a connection's waypoints to edge-to-edge so that ManhattanLayout
 * computes fresh routing based on current element positions rather than
 * being influenced by stale waypoints from intermediate moves.
 *
 * Detects two types of stale routing:
 * 1. Backward detour: intermediate waypoints go left of the source element,
 *    indicating the connection routes backward before coming forward.
 *    This commonly happens for reconverging flows to merge gateways.
 * 2. Same-Y vertical detour: source and target are at the same Y level but
 *    waypoints detour significantly above or below.
 */
function resetStaleWaypoints(conn: any): void {
  const source = conn.source;
  const target = conn.target;
  if (!source || !target) return;

  const wps = conn.waypoints;
  if (!wps || wps.length === 0) return;

  const sourceRight = source.x + (source.width || 0);
  const targetLeft = target.x;

  // Only applies to left-to-right connections (target is to the right)
  if (targetLeft <= sourceRight) return;

  const sourceMidY = source.y + (source.height || 0) / 2;
  const targetMidY = target.y + (target.height || 0) / 2;

  // For gateway sources with vertically offset targets, always set proper
  // v:h waypoints (vertical exit → horizontal approach) regardless of the
  // current waypoint count.  This ensures ManhattanLayout receives correct
  // routing hints for fan-out patterns.
  const isGatewaySource = source.type?.includes('Gateway');
  const verticalOffset = Math.abs(sourceMidY - targetMidY);
  const sourceHalfHeight = (source.height || 0) / 2;

  if (isGatewaySource && verticalOffset > sourceHalfHeight) {
    const sourceMidX = source.x + (source.width || 0) / 2;
    const exitY =
      targetMidY < sourceMidY
        ? source.y // exit from top
        : source.y + (source.height || 0); // exit from bottom
    conn.waypoints = [
      {
        x: sourceMidX,
        y: exitY,
        original: { x: sourceMidX, y: exitY },
      },
      { x: sourceMidX, y: targetMidY },
      {
        x: targetLeft,
        y: targetMidY,
        original: { x: targetLeft, y: targetMidY },
      },
    ];
    return;
  }

  // For non-gateway connections with fewer than 3 waypoints, there's no
  // stale routing to detect (simple 2-point line is fine).
  if (wps.length < 3) return;

  let needsReset = false;

  // Check 1: Backward detour — intermediate waypoints go left of source's
  // left edge.  This catches reconverging flows (branch → merge gateway)
  // where stale waypoints from pre-layout positions route backward.
  const hasBackwardDetour = wps.slice(1, -1).some((wp: any) => wp.x < source.x - 5);
  if (hasBackwardDetour) {
    needsReset = true;
  }

  // Check 2: Same-Y connections with vertical detours (straight connections
  // that route upward/downward instead of going straight across)
  if (!needsReset && Math.abs(sourceMidY - targetMidY) <= 10) {
    const bandTop = Math.min(source.y, target.y);
    const bandBottom = Math.max(source.y + (source.height || 0), target.y + (target.height || 0));
    const hasVerticalDetour = wps.some((wp: any) => wp.y < bandTop - 5 || wp.y > bandBottom + 5);
    if (hasVerticalDetour) {
      needsReset = true;
    }
  }

  // Check 3: Vertical escape — intermediate waypoints go significantly
  // above/below the Y-range of source and target, indicating stale routing
  // that exits the wrong side of an element (e.g. routing upward from a
  // gateway when the target is below)
  if (!needsReset) {
    const yTop = Math.min(source.y, target.y);
    const yBottom = Math.max(source.y + (source.height || 0), target.y + (target.height || 0));
    const margin = 50; // Allow one standard gap of tolerance
    const hasVerticalEscape = wps
      .slice(1, -1)
      .some((wp: any) => wp.y < yTop - margin || wp.y > yBottom + margin);
    if (hasVerticalEscape) {
      needsReset = true;
    }
  }

  if (!needsReset) return;

  // Reset to L-shaped orthogonal path so ManhattanLayout receives clean
  // forward-routing hints.  A 2-point diagonal would be kept as-is by
  // ManhattanLayout in headless mode, so we must provide the bend.
  const midX = Math.round((sourceRight + targetLeft) / 2);

  if (Math.abs(sourceMidY - targetMidY) <= 1) {
    // Same Y: straight horizontal line (2 points)
    conn.waypoints = [
      {
        x: sourceRight,
        y: sourceMidY,
        original: { x: sourceRight, y: sourceMidY },
      },
      {
        x: targetLeft,
        y: targetMidY,
        original: { x: targetLeft, y: targetMidY },
      },
    ];
  } else {
    // Different Y: L-shaped orthogonal path (4 points)
    conn.waypoints = [
      {
        x: sourceRight,
        y: sourceMidY,
        original: { x: sourceRight, y: sourceMidY },
      },
      { x: midX, y: sourceMidY },
      { x: midX, y: targetMidY },
      {
        x: targetLeft,
        y: targetMidY,
        original: { x: targetLeft, y: targetMidY },
      },
    ];
  }
}

function layoutConnections(
  graph: FlowGraph,
  backEdgeIds: Set<string>,
  registry: ElementRegistry,
  modeling: Modeling
): number {
  let count = 0;

  // Layout forward connections first
  for (const [, node] of graph.nodes) {
    for (let i = 0; i < node.outgoing.length; i++) {
      const flowId = node.outgoingFlowIds[i];
      if (backEdgeIds.has(flowId)) continue;
      const conn = registry.get(flowId);
      if (conn) {
        try {
          // Fix stale waypoints from intermediate element moves that cause
          // same-level connections to route upward instead of straight
          resetStaleWaypoints(conn);
          modeling.layoutConnection(conn);
          count++;
        } catch {
          // ManhattanLayout throws "unexpected dockingDirection" when waypoints are
          // inconsistent. Skip silently — element still appears in the diagram.
        }
      }
    }
  }

  // Layout back-edge connections (loops)
  for (const flowId of backEdgeIds) {
    const conn = registry.get(flowId);
    if (conn) {
      try {
        resetStaleWaypoints(conn);
        modeling.layoutConnection(conn);
        count++;
      } catch {
        // Same docking guard for back-edge (loop) connections.
      }
    }
  }

  return count;
}
