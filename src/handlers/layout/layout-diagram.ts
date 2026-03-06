/**
 * Handler for layout_diagram tool.
 *
 * Uses the rebuild-based layout engine that repositions elements using
 * topology-driven placement with bpmn-js native positioning.
 *
 * Supports pinned element skipping, pre/post-processing (DI repair,
 * grid snap, pool autosize, labels), and dry-run previews.
 */
// @mutating

import { type ToolResult, type ToolContext, type DiagramState } from '../../types';
import {
  requireDiagram,
  jsonResult,
  syncXml,
  getVisibleElements,
  getService,
  isCollaboration,
} from '../helpers';
import { appendLintFeedback, resetMutationCounter } from '../../linter';
import { adjustDiagramLabels, centerFlowLabels } from './labels/adjust-labels';
import {
  applyPixelGridSnap,
  checkDiIntegrity,
  deduplicateDiInModeler,
  alignCollapsedPoolsAfterAutosize,
  computeDisplacementStats,
  repairMissingDiShapes,
} from './layout-helpers';
import { handleAutosizePoolsAndLanes } from '../collaboration/autosize-pools-and-lanes';
import { expandCollapsedSubprocesses } from './expand-subprocesses';
import { rebuildLayout, applyAllBackEdgeUShapes } from '../../rebuild';
import { straightenNonOrthogonalFlows } from '../../rebuild/waypoints';
import { stackPools } from '../../rebuild/container-layout';
import {
  generateDiagramId,
  storeDiagram,
  deleteDiagram,
  createModelerFromXml,
} from '../../diagram-manager';
import {
  computeLayoutQualityMetrics,
  detectContainerSizingIssues,
  type ContainerSizingIssue,
} from './layout-quality-metrics';
import { computeLaneCrossingMetrics } from './lane-crossing-metrics';

// ── Tolerance (px) for detecting stale association waypoints after layout ──
const ASSOCIATION_WAYPOINT_TOLERANCE = 20;

/** Check whether a point is within element bounds (+ tolerance). */
function pointInBounds(
  pt: { x: number; y: number },
  el: { x: number; y: number; width?: number; height?: number },
  tolerance: number
): boolean {
  const w = el.width || 0;
  const h = el.height || 0;
  return (
    pt.x >= el.x - tolerance &&
    pt.x <= el.x + w + tolerance &&
    pt.y >= el.y - tolerance &&
    pt.y <= el.y + h + tolerance
  );
}

/** Compute a straight 2-point association path using nearest facing edge midpoints. */
function computeAssocWaypoints(
  src: { x: number; y: number; width?: number; height?: number },
  tgt: { x: number; y: number; width?: number; height?: number }
): [{ x: number; y: number }, { x: number; y: number }] {
  const srcCx = src.x + (src.width || 0) / 2;
  const srcCy = src.y + (src.height || 0) / 2;
  const tgtCx = tgt.x + (tgt.width || 0) / 2;
  const tgtCy = tgt.y + (tgt.height || 0) / 2;
  const dx = Math.abs(tgtCx - srcCx);
  const dy = Math.abs(tgtCy - srcCy);
  if (dx >= dy) {
    // Horizontal-dominant: left/right edges
    return tgtCx >= srcCx
      ? [
          { x: Math.round(src.x + (src.width || 0)), y: Math.round(srcCy) },
          { x: Math.round(tgt.x), y: Math.round(tgtCy) },
        ]
      : [
          { x: Math.round(src.x), y: Math.round(srcCy) },
          { x: Math.round(tgt.x + (tgt.width || 0)), y: Math.round(tgtCy) },
        ];
  }
  // Vertical-dominant: top/bottom edges
  return tgtCy >= srcCy
    ? [
        { x: Math.round(srcCx), y: Math.round(src.y + (src.height || 0)) },
        { x: Math.round(tgtCx), y: Math.round(tgt.y) },
      ]
    : [
        { x: Math.round(srcCx), y: Math.round(src.y) },
        { x: Math.round(tgtCx), y: Math.round(tgt.y + (tgt.height || 0)) },
      ];
}

/**
 * Recompute stale association waypoints after element repositioning.
 *
 * `modeling.layoutConnection()` explicitly skips `bpmn:Association`, so
 * association waypoints created at connection-time remain at their original
 * coordinates even after layout repositions connected elements.
 *
 * For each `bpmn:Association` whose first waypoint is outside the source
 * element bounds (+ tolerance) or whose last waypoint is outside the target
 * element bounds (+ tolerance), this function replaces the waypoints with a
 * clean 2-point path: source-element edge midpoint → target-element edge
 * midpoint (nearest facing edges).
 *
 * @returns Object with count of updated associations and their IDs.
 */
function recomputeStaleAssociationWaypoints(
  elementRegistry: any,
  modeling: any
): { count: number; fixedIds: string[] } {
  const tolerance = ASSOCIATION_WAYPOINT_TOLERANCE;
  const allElements: any[] = elementRegistry.getAll();
  const associations = allElements.filter(
    (el: any) => el.type === 'bpmn:Association' && el.source && el.target && el.waypoints?.length
  );

  let count = 0;
  const fixedIds: string[] = [];
  for (const assoc of associations) {
    const src = assoc.source;
    const tgt = assoc.target;
    const wps: Array<{ x: number; y: number }> = assoc.waypoints;
    if (
      pointInBounds(wps[0], src, tolerance) &&
      pointInBounds(wps[wps.length - 1], tgt, tolerance)
    ) {
      continue;
    }
    const [p1, p2] = computeAssocWaypoints(src, tgt);
    try {
      modeling.updateWaypoints(assoc, [p1, p2]);
      count++;
      fixedIds.push(assoc.id as string);
    } catch {
      // Non-fatal: association may not support updateWaypoints in all configs
    }
  }
  return { count, fixedIds };
}

export interface LayoutDiagramArgs {
  diagramId: string;
  /** Optional ID of a Participant or SubProcess to layout in isolation. */
  scopeElementId?: string;
  /** Pixel grid snap: snap element positions to the nearest multiple of this value. */
  gridSnap?: number;
  /** When true, preview layout changes without applying them. */
  dryRun?: boolean;
  /**
   * Automatically resize pools and lanes after layout to fit all elements
   * with proper padding. Default: auto-enabled when the diagram contains pools.
   */
  poolExpansion?: boolean;
  /**
   * When true, expand collapsed subprocesses that have internal flow-node
   * children before running layout.
   * Default: false (preserve existing collapsed/expanded state).
   */
  expandSubprocesses?: boolean;
  /**
   * When true, only adjust labels without performing full layout.
   * Useful for fixing label overlaps without changing element positions.
   */
  labelsOnly?: boolean;
  /**
   * When true, only resize pools and lanes to fit their contents without running full layout.
   * Equivalent to the former autosize_bpmn_pools_and_lanes tool.
   * Accepts participantId to scope resizing to a single pool.
   */
  autosizeOnly?: boolean;
  /** When autosizeOnly is true, scope pool resizing to this participant ID. */
  participantId?: string;
  /**
   * When false, disable the post-layout pass that replaces non-orthogonal
   * (Z-shaped or diagonal) forward sequence-flow waypoints with clean
   * L-shaped or 2-point straight paths.
   *
   * Works in full layout mode (runs after rebuild + connection routing)
   * and in labelsOnly mode (standalone routing cleanup without moving elements).
   * Default: true (always-on).
   */
  straightenFlows?: boolean;
}

/** Handle labels-only mode: just adjust labels without full layout. */
async function handleLabelsOnlyMode(
  diagramId: string,
  opts?: { straightenFlows?: boolean }
): Promise<ToolResult> {
  const diagram = requireDiagram(diagramId);
  const flowLabelsCentered = await centerFlowLabels(diagram);
  const elementLabelsMoved = await adjustDiagramLabels(diagram);
  const totalMoved = flowLabelsCentered + elementLabelsMoved;

  let straightenedFlowCount = 0;
  if (opts?.straightenFlows !== false) {
    const elementRegistry = getService(diagram.modeler, 'elementRegistry');
    const modeling = getService(diagram.modeler, 'modeling');
    straightenedFlowCount = straightenNonOrthogonalFlows(elementRegistry.getAll(), modeling);
    if (straightenedFlowCount > 0) await syncXml(diagram);
  }

  return jsonResult({
    success: true,
    flowLabelsCentered,
    elementLabelsMoved,
    totalMoved,
    ...(opts?.straightenFlows !== false ? { straightenedFlowCount } : {}),
    message:
      totalMoved > 0 || straightenedFlowCount > 0
        ? [
            totalMoved > 0
              ? `Adjusted ${totalMoved} label(s) to reduce overlap (${elementLabelsMoved} element labels, ${flowLabelsCentered} flow labels centered)`
              : null,
            straightenedFlowCount > 0
              ? `Straightened ${straightenedFlowCount} non-orthogonal flow(s) to L-shape/straight paths`
              : null,
          ]
            .filter(Boolean)
            .join('. ')
        : 'No label adjustments needed \u2014 all labels are well-positioned',
  });
}

/** Perform a dry-run layout: clone → rebuild → diff → discard clone. */
async function handleDryRunLayout(args: LayoutDiagramArgs): Promise<ToolResult> {
  const { diagramId } = args;
  const diagram = requireDiagram(diagramId);
  const { xml } = await diagram.modeler.saveXML({ format: true });

  const tempId = generateDiagramId();
  const modeler = await createModelerFromXml(xml || '');
  storeDiagram(tempId, { modeler, xml: xml || '', name: `_dryrun_${diagramId}` });

  try {
    const tempDiagram: DiagramState = { modeler, xml: xml || '' };
    const tempRegistry = getService(tempDiagram.modeler, 'elementRegistry');

    // Capture original positions
    const originalPositions = new Map<string, { x: number; y: number }>();
    for (const el of getVisibleElements(tempRegistry)) {
      if (el.x !== undefined && el.y !== undefined) {
        originalPositions.set(el.id, { x: el.x, y: el.y });
      }
    }

    // Run rebuild layout on the clone (pass gridSnap for forward-pass alignment)
    const pixelGridSnap = typeof args.gridSnap === 'number' ? args.gridSnap : undefined;
    rebuildLayout(tempDiagram, { gridSnap: pixelGridSnap });

    if (pixelGridSnap && pixelGridSnap > 0) applyPixelGridSnap(tempDiagram, pixelGridSnap);

    const stats = computeDisplacementStats(originalPositions, tempRegistry);
    const qualityMetrics = computeLayoutQualityMetrics(tempRegistry);
    const totalElements = getVisibleElements(tempRegistry).filter(
      (el: any) =>
        !el.type.includes('SequenceFlow') &&
        !el.type.includes('MessageFlow') &&
        !el.type.includes('Association')
    ).length;

    const isLargeChange = stats.movedCount > totalElements * 0.5 && stats.maxDisplacement > 200;

    return jsonResult({
      success: true,
      dryRun: true,
      totalElements,
      movedCount: stats.movedCount,
      maxDisplacement: stats.maxDisplacement,
      avgDisplacement: stats.avgDisplacement,
      qualityMetrics,
      ...(isLargeChange
        ? {
            warning: `Layout would move ${stats.movedCount}/${totalElements} elements with max displacement of ${stats.maxDisplacement}px.`,
          }
        : {}),
      topDisplacements: stats.displacements,
      message: `Dry run: layout would move ${stats.movedCount}/${totalElements} elements (max ${stats.maxDisplacement}px, avg ${stats.avgDisplacement}px). Call without dryRun to apply.`,
    });
  } finally {
    deleteDiagram(tempId);
  }
}

/** Build the nextSteps array with lane and sizing advice. */
function buildNextSteps(
  laneCrossingMetrics: ReturnType<typeof computeLaneCrossingMetrics>,
  sizingIssues: ContainerSizingIssue[],
  poolExpansionApplied?: boolean,
  qualityMetrics?: ReturnType<typeof computeLayoutQualityMetrics>
): Array<{ tool: string; description: string }> {
  const steps: Array<{ tool: string; description: string }> = [
    {
      tool: 'export_bpmn',
      description:
        'Diagram layout is complete. Use export_bpmn with format and filePath to save the diagram.',
    },
  ];

  if (qualityMetrics) {
    const pct = qualityMetrics.orthogonalFlowPercent;
    if (pct < 90) {
      steps.push({
        tool: 'layout_bpmn_diagram',
        description:
          `Flow orthogonality is ${pct}% (below 90%). Re-run layout_bpmn_diagram to attempt ` +
          `improvement, or run validate_bpmn_diagram to identify specific non-orthogonal segments.`,
      });
    }
  }

  if (laneCrossingMetrics && laneCrossingMetrics.laneCoherenceScore < 70) {
    // Suppress redistribution advice when most crossings originate from
    // gateway fan-out — those cross-lane flows are structurally required
    // and lane reordering cannot eliminate them.
    const gw = laneCrossingMetrics.gatewaySourcedCrossings ?? 0;
    const crossings = laneCrossingMetrics.crossingLaneFlows;
    const mostlyGateway = crossings > 0 && gw / crossings >= 0.8;

    if (mostlyGateway) {
      steps.push({
        tool: 'analyze_bpmn_lanes',
        description:
          `Lane coherence score is ${laneCrossingMetrics.laneCoherenceScore}% — ` +
          `but ${gw}/${crossings} crossing flow(s) originate from gateway fan-out, which is ` +
          `structurally necessary and cannot be reduced by lane reordering. ` +
          `No redistribution is recommended.`,
      });
    } else {
      steps.push({
        tool: 'analyze_bpmn_lanes',
        description: `Lane coherence score is ${laneCrossingMetrics.laneCoherenceScore}% (below 70%). Run analyze_bpmn_lanes with mode: 'validate' for detailed lane improvement suggestions.`,
      });
      steps.push({
        tool: 'redistribute_bpmn_elements_across_lanes',
        description: `Lane coherence is low (${laneCrossingMetrics.laneCoherenceScore}%). Run redistribute_bpmn_elements_across_lanes with validate: true to automatically minimize cross-lane flows.`,
      });
    }
  }

  const poolIssues = sizingIssues.filter((i) => i.severity === 'warning');
  if (poolIssues.length > 0 && !poolExpansionApplied) {
    steps.push({
      tool: 'autosize_bpmn_pools_and_lanes',
      description:
        `${poolIssues.length} pool(s) need resizing: ` +
        poolIssues
          .map((i) => `${i.containerName} → ${i.recommendedWidth}×${i.recommendedHeight}px`)
          .join(', ') +
        '. Run autosize_bpmn_pools_and_lanes to fix automatically, or use move_bpmn_element with width/height for manual control.',
    });
  }

  return steps;
}

/** Run labels adjustment (center flow labels + adjust element labels). */
async function adjustAllLabels(diagram: DiagramState): Promise<number> {
  const flowLabelsCentered = await centerFlowLabels(diagram);
  const elLabelsMoved = await adjustDiagramLabels(diagram);
  return flowLabelsCentered + elLabelsMoved;
}

/** Auto-resize pools/lanes if needed, returns whether resizing was applied. */
async function autosizePools(
  args: LayoutDiagramArgs,
  diagram: DiagramState,
  elementRegistry: any
): Promise<boolean> {
  const shouldAutosize =
    args.poolExpansion === true ||
    (args.poolExpansion === undefined && isCollaboration(elementRegistry));
  if (!shouldAutosize) return false;

  const poolResult = await handleAutosizePoolsAndLanes({ diagramId: args.diagramId });
  const poolData = JSON.parse(poolResult.content[0].text as string);
  const applied = (poolData.resizedCount ?? 0) > 0;
  if (applied) {
    const modeling = getService(diagram.modeler, 'modeling');
    alignCollapsedPoolsAfterAutosize(elementRegistry, modeling);
    // Re-stack pools to fix gaps after height changes from autosizing
    const pools = elementRegistry.filter((el: any) => el.type === 'bpmn:Participant');
    if (pools.length >= 2) stackPools(pools, modeling, 30);
  }
  return applied;
}

/** Build the orthogonality warning string, including non-orthogonal flow IDs if available. */
function buildOrthogonalityWarning(
  qualityMetrics: ReturnType<typeof computeLayoutQualityMetrics>
): string {
  const ids = qualityMetrics.nonOrthogonalFlowIds;
  return (
    `Layout produced ${qualityMetrics.orthogonalFlowPercent}% orthogonal flows ` +
    `(${qualityMetrics.avgBendCount} avg bends/flow). ` +
    `Re-run layout_bpmn_diagram or run validate_bpmn_diagram to identify non-orthogonal segments.` +
    (ids && ids.length > 0 ? ` Non-orthogonal flow IDs: [${ids.join(', ')}].` : '')
  );
}

/**
 * For each non-orthogonal flow whose source is a gateway, compute concrete
 * set_bpmn_connection_waypoints fix hints with 2-point straight waypoints.
 *
 * Returns an array of fix objects (empty when no gateway-sourced non-orthogonal flows exist).
 */
function buildGatewayFlowFixes(
  diagramId: string,
  nonOrthogonalFlowIds: string[],
  elementRegistry: any
): Array<{ flowId: string; tool: string; args: Record<string, any> }> {
  const fixes: Array<{ flowId: string; tool: string; args: Record<string, any> }> = [];

  for (const flowId of nonOrthogonalFlowIds) {
    const conn = elementRegistry.get(flowId);
    if (!conn || !conn.waypoints || conn.waypoints.length < 2) continue;

    // Only emit fixes for gateway-sourced flows
    const sourceType: string = conn.source?.type ?? '';
    if (!sourceType.includes('Gateway')) continue;

    const wps: Array<{ x: number; y: number }> = conn.waypoints;
    const first = wps[0];
    const last = wps[wps.length - 1];

    fixes.push({
      flowId,
      tool: 'set_bpmn_connection_waypoints',
      args: {
        diagramId,
        connectionId: flowId,
        waypoints: [
          { x: Math.round(first.x), y: Math.round(first.y) },
          { x: Math.round(last.x), y: Math.round(last.y) },
        ],
      },
    });
  }

  return fixes;
}

/** Build the association stale-waypoint block for the layout response. */
function buildAssocWaypointsBlock(
  associationWaypointsFixed: number | undefined,
  fixedAssociationIds: string[] | undefined
): Record<string, unknown> {
  if (!associationWaypointsFixed || associationWaypointsFixed === 0) return {};
  return {
    associationWaypointsFixed,
    ...(fixedAssociationIds && fixedAssociationIds.length > 0 ? { fixedAssociationIds } : {}),
    associationWarning:
      `${associationWaypointsFixed} association(s) had stale waypoints that were recomputed: ` +
      `[${(fixedAssociationIds ?? []).join(', ')}]. ` +
      `Verify association paths are visually correct; if not, use connect_bpmn_elements ` +
      `with explicit waypoints to route them manually.`,
  };
}

/** Build the laneCrossingMetrics block for the layout response. */
function buildLaneCrossingBlock(
  laneCrossingMetrics: ReturnType<typeof computeLaneCrossingMetrics>
): Record<string, unknown> {
  if (!laneCrossingMetrics) return {};
  return {
    laneCrossingMetrics: {
      totalLaneFlows: laneCrossingMetrics.totalLaneFlows,
      crossingLaneFlows: laneCrossingMetrics.crossingLaneFlows,
      laneCoherenceScore: laneCrossingMetrics.laneCoherenceScore,
      ...(laneCrossingMetrics.crossingFlowIds
        ? { crossingFlowIds: laneCrossingMetrics.crossingFlowIds }
        : {}),
    },
  };
}

/** Apply association waypoint recomputation after layout and return layout-response props. */
function fixStaleAssocWaypoints(diagram: any): {
  assocCount: number;
  assocIds: string[];
} {
  const modelingService = getService(diagram.modeler, 'modeling');
  const registryService = getService(diagram.modeler, 'elementRegistry');
  const fix = recomputeStaleAssociationWaypoints(registryService, modelingService);
  return { assocCount: fix.count, assocIds: fix.fixedIds };
}

/** Build the final JSON response for a layout result. */
function buildLayoutResponse(opts: {
  diagramId: string;
  scopeElementId?: string;
  elementCount: number;
  labelsMoved: number;
  result: { repositionedCount: number; reroutedCount: number };
  laneCrossingMetrics: ReturnType<typeof computeLaneCrossingMetrics>;
  sizingIssues: ContainerSizingIssue[];
  qualityMetrics: ReturnType<typeof computeLayoutQualityMetrics>;
  diWarnings: string[];
  poolExpansionApplied: boolean;
  subprocessesExpanded: number;
  boundaryEventWarning?: string;
  straightenedFlowCount?: number;
  gatewayFlowFixes?: Array<{ flowId: string; tool: string; args: Record<string, any> }>;
  associationWaypointsFixed?: number;
  fixedAssociationIds?: string[];
}): ToolResult {
  const {
    diagramId,
    scopeElementId,
    elementCount,
    labelsMoved,
    result,
    laneCrossingMetrics,
    sizingIssues,
    qualityMetrics,
    diWarnings,
    poolExpansionApplied,
    subprocessesExpanded,
    boundaryEventWarning,
    straightenedFlowCount,
    gatewayFlowFixes,
    associationWaypointsFixed,
    fixedAssociationIds,
  } = opts;

  const scopeNote = scopeElementId
    ? 'Message flows crossing the scope boundary were not re-routed. Run a full layout (without scopeElementId) or use set_bpmn_connection_waypoints to fix any displaced message flow waypoints.'
    : undefined;

  return jsonResult({
    success: true,
    elementCount,
    labelsMoved,
    repositionedCount: result.repositionedCount,
    reroutedCount: result.reroutedCount,
    ...(straightenedFlowCount ? { straightenedFlowCount } : {}),
    ...buildAssocWaypointsBlock(associationWaypointsFixed, fixedAssociationIds),
    ...(boundaryEventWarning ? { boundaryEventWarning } : {}),
    ...buildLaneCrossingBlock(laneCrossingMetrics),
    ...(sizingIssues.length > 0 ? { containerSizingIssues: sizingIssues } : {}),
    qualityMetrics,
    ...(qualityMetrics.orthogonalFlowPercent < 90
      ? { warning: buildOrthogonalityWarning(qualityMetrics) }
      : {}),
    ...(gatewayFlowFixes && gatewayFlowFixes.length > 0 ? { gatewayFlowFixes } : {}),
    message:
      `Rebuild layout applied to diagram ${diagramId}` +
      `${scopeElementId ? ` (scoped to ${scopeElementId})` : ''}` +
      ` — ${elementCount} elements arranged, ${result.repositionedCount} repositioned, ${result.reroutedCount} connections re-routed`,
    ...(scopeNote ? { scopeNote } : {}),
    ...(diWarnings.length > 0 ? { diWarnings } : {}),
    ...(poolExpansionApplied ? { poolExpansionApplied: true } : {}),
    ...(subprocessesExpanded > 0 ? { subprocessesExpanded } : {}),
    nextSteps: buildNextSteps(
      laneCrossingMetrics,
      sizingIssues,
      poolExpansionApplied,
      qualityMetrics
    ),
  });
}

/** Count non-connection visible elements. */
function countFlowElements(elementRegistry: any): number {
  return getVisibleElements(elementRegistry).filter(
    (el: any) =>
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association')
  ).length;
}

/** Validate the scopeElementId argument — throws if invalid. */
function validateScopeElement(diagram: any, scopeElementId: string): void {
  const registry = getService(diagram.modeler, 'elementRegistry');
  const scopeEl = registry.get(scopeElementId);
  if (!scopeEl) {
    throw new Error(`Scope element '${scopeElementId}' not found in diagram`);
  }
  const t = scopeEl.type;
  if (t !== 'bpmn:Participant' && t !== 'bpmn:SubProcess' && t !== 'bpmn:Process') {
    throw new Error(
      `scopeElementId must reference a Participant, SubProcess, or Process, got '${t}'`
    );
  }
}

/**
 * Determine whether pool autosize will run after layout.
 * Used to skip the redundant internal resize in rebuildLayout (task 7b).
 */
function shouldAutosizePools(args: LayoutDiagramArgs, diagram: any): boolean {
  if (args.poolExpansion === false) return false;
  const registry = getService(diagram.modeler, 'elementRegistry');
  return args.poolExpansion === true || isCollaboration(registry);
}

/**
 * Apply the optional post-layout straightening pass.
 * Replaces non-orthogonal forward-flow waypoints with clean L-shapes.
 * Returns the count of straightened connections (added to reroutedCount).
 * Runs by default; pass straightenFlows: false to disable.
 * Passes the modeling service to ensure DI is synced via updateWaypoints().
 */
function applyPostLayoutStraighten(args: LayoutDiagramArgs, diagram: any): number {
  if (args.straightenFlows === false) return 0;
  const allElements = getService(diagram.modeler, 'elementRegistry').getAll();
  const modeling = getService(diagram.modeler, 'modeling');
  return straightenNonOrthogonalFlows(allElements, modeling);
}

/** Compute boundary-event warning text (or undefined when none present). */
function computeBoundaryWarning(elementRegistry: any): string | undefined {
  const count = elementRegistry
    .getAll()
    .filter((el: any) => el.type === 'bpmn:BoundaryEvent').length;
  if (count === 0) return undefined;
  return (
    `\u26a0 This diagram has ${count} boundary event(s). ` +
    `Full layout repositions them relative to their host tasks — verify positions after layout. ` +
    `Use labelsOnly: true for label-only cleanup, or scopeElementId to scope layout to one participant.`
  );
}

/**
 * Re-route U-shaped back-edges and re-straighten flows after pool autosize.
 * Pool autosize re-routes connections via MoveShapeHandler.postExecute which
 * can produce Z-shaped waypoints; this pass restores orthogonality.
 */
function applyPoolExpansionReRouting(
  args: LayoutDiagramArgs,
  diagram: any,
  elementRegistry: any,
  result: any
): void {
  const modeling = getService(diagram.modeler, 'modeling');
  result.reroutedCount += applyAllBackEdgeUShapes(elementRegistry, modeling);
  result.reroutedCount += applyPostLayoutStraighten(args, diagram);
}

export async function handleLayoutDiagram(
  args: LayoutDiagramArgs,
  context?: ToolContext
): Promise<ToolResult> {
  if (args.autosizeOnly) {
    // Delegate to autosize handler, passing optional participantId
    const autosizeArgs: any = { diagramId: args.diagramId };
    if (args.participantId) autosizeArgs.participantId = args.participantId;
    const result = await handleAutosizePoolsAndLanes(autosizeArgs);
    const data = JSON.parse(result.content[0].text as string);
    return jsonResult({ ...data, autosizeOnly: true });
  }
  if (args.labelsOnly) {
    return handleLabelsOnlyMode(args.diagramId, { straightenFlows: args.straightenFlows });
  }
  if (args.dryRun) return handleDryRunLayout(args);

  const { diagramId, scopeElementId } = args;
  const diagram = requireDiagram(diagramId);
  const progress = context?.sendProgress;

  if (scopeElementId) validateScopeElement(diagram, scopeElementId);

  await progress?.(0, 100, 'Preparing layout…');
  const subprocessesExpanded = args.expandSubprocesses ? expandCollapsedSubprocesses(diagram) : 0;
  const preRepairs = repairMissingDiShapes(diagram);
  const boundaryEventWarning = computeBoundaryWarning(
    getService(diagram.modeler, 'elementRegistry')
  );

  // Determine whether pool autosize will run after layout (task 7b):
  // when poolExpansion is enabled (or auto-detected), `handleAutosizePoolsAndLanes`
  // will resize pools/lanes — skip the redundant internal resize in rebuildLayout.
  const willAutosize = shouldAutosizePools(args, diagram);

  await progress?.(10, 100, 'Running rebuild layout…');
  const pixelGridSnap = typeof args.gridSnap === 'number' ? args.gridSnap : undefined;
  const result = rebuildLayout(diagram, {
    pinnedElementIds: diagram.pinnedElements,
    skipPoolResize: willAutosize,
    // Pass gridSnap into the rebuild engine so snapLeft() uses the configured
    // grid during the forward pass (not only as a post-processing step).
    gridSnap: pixelGridSnap,
  });

  await progress?.(60, 100, 'Post-processing layout…');
  // applyPixelGridSnap is still applied after rebuild to snap Y coordinates
  // (which are not aligned by snapLeft()) and to handle any residual drift
  // from boundary-event and pool-resize operations.
  if (pixelGridSnap) applyPixelGridSnap(diagram, pixelGridSnap);
  deduplicateDiInModeler(diagram);

  // DI integrity check + post-layout repair (task 6b):
  // Re-run repairMissingDiShapes after layout to recover any pool/lane/flow DI shapes
  // that may have been lost or invalidated by element repositioning (e.g. jsdom
  // headless polyfill inconsistencies with resizeShape on stale element references).
  const postRepairs = repairMissingDiShapes(diagram);
  const allRepairs = [...preRepairs, ...postRepairs];

  if (!scopeElementId) {
    diagram.pinnedElements = undefined;
    diagram.pinnedConnections = undefined;
  }

  // Post-layout straightening: replace non-orthogonal forward flows with
  // clean L-shape / 2-point straight paths after all routing is settled.
  // Runs before syncXml so the corrected waypoints are captured in diagram.xml.
  const straightenedFlowCount = applyPostLayoutStraighten(args, diagram);
  result.reroutedCount += straightenedFlowCount;

  // Recompute stale association waypoints after element repositioning.
  // modeling.layoutConnection() skips bpmn:Association, so association
  // waypoints created at connection-time may be far outside their connected
  // element bounds after layout moves the elements.
  const { assocCount, assocIds } = fixStaleAssocWaypoints(diagram);
  result.reroutedCount += assocCount;

  await syncXml(diagram);
  resetMutationCounter(diagram);

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  await progress?.(70, 100, 'Adjusting labels…');
  const labelsMoved = await adjustAllLabels(diagram);

  await progress?.(85, 100, 'Resizing pools…');
  const poolExpansionApplied = await autosizePools(args, diagram, elementRegistry);

  // Re-apply U-shaped back-edge routing and re-straighten flows after pool autosize.
  if (poolExpansionApplied) applyPoolExpansionReRouting(args, diagram, elementRegistry, result);

  const finalQualityMetrics = computeLayoutQualityMetrics(elementRegistry);
  const nonOrthIds = finalQualityMetrics.nonOrthogonalFlowIds ?? [];

  const layoutResult = buildLayoutResponse({
    diagramId,
    scopeElementId,
    elementCount: countFlowElements(elementRegistry),
    labelsMoved,
    result,
    laneCrossingMetrics: computeLaneCrossingMetrics(elementRegistry),
    sizingIssues: detectContainerSizingIssues(elementRegistry),
    qualityMetrics: finalQualityMetrics,
    diWarnings: [...allRepairs, ...checkDiIntegrity(diagram, elementRegistry)],
    poolExpansionApplied,
    subprocessesExpanded,
    boundaryEventWarning,
    straightenedFlowCount,
    gatewayFlowFixes:
      nonOrthIds.length > 0
        ? buildGatewayFlowFixes(diagramId, nonOrthIds, elementRegistry)
        : undefined,
    associationWaypointsFixed: assocCount,
    fixedAssociationIds: assocIds,
  });

  return appendLintFeedback(layoutResult, diagram);
}

// Schema extracted to layout-diagram-schema.ts for readability.
export { TOOL_DEFINITION } from './layout-diagram-schema';
