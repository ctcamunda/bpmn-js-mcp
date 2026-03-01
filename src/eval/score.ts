import {
  cloneWaypoints,
  deduplicateWaypoints,
  rectsNearby,
  rectsOverlap,
  segmentsIntersect,
} from '../geometry';
import type { ListedElement, LayoutMetrics } from './types';

const GRID = 10;

function isConnection(type: string): boolean {
  return (
    type === 'bpmn:SequenceFlow' ||
    type === 'bpmn:MessageFlow' ||
    type === 'bpmn:Association' ||
    type.endsWith('Flow')
  );
}

function isContainer(type: string): boolean {
  return type === 'bpmn:Participant' || type === 'bpmn:Lane';
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function segmentEndpointProximity(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
  eps = 3
): boolean {
  // If any endpoints are very close, treat as non-crossing (shared vertex / touching).
  return dist(a1, b1) <= eps || dist(a1, b2) <= eps || dist(a2, b1) <= eps || dist(a2, b2) <= eps;
}

function gridSnap01(value: number | undefined): number {
  if (value === undefined) return 0;
  const mod = Math.abs(value % GRID);
  const d = Math.min(mod, GRID - mod);
  // 0px away => 1. 5px or more away => 0.
  return clamp(1 - d / (GRID / 2), 0, 1);
}

function splitElements(elements: ListedElement[]): {
  shapes: ListedElement[];
  flows: ListedElement[];
} {
  const shapes = elements.filter((e) => !isConnection(e.type) && !isContainer(e.type));
  const flows = elements.filter((e) => isConnection(e.type));
  return { shapes, flows };
}

function computeOverlapAndNearMisses(shapes: ListedElement[]): {
  overlaps: number;
  nearMisses: number;
} {
  let overlaps = 0;
  let nearMisses = 0;

  for (let i = 0; i < shapes.length; i++) {
    const a = shapes[i];
    if (a.x === undefined || a.y === undefined || a.width === undefined || a.height === undefined)
      continue;
    const ra = { x: a.x, y: a.y, width: a.width, height: a.height };
    for (let j = i + 1; j < shapes.length; j++) {
      const b = shapes[j];
      if (b.x === undefined || b.y === undefined || b.width === undefined || b.height === undefined)
        continue;
      const rb = { x: b.x, y: b.y, width: b.width, height: b.height };
      if (rectsOverlap(ra, rb)) overlaps++;
      else if (rectsNearby(ra, rb, 15)) nearMisses++;
    }
  }

  return { overlaps, nearMisses };
}

type Segment = { p1: { x: number; y: number }; p2: { x: number; y: number } };
type FlowSegments = Map<string, { sourceId?: string; targetId?: string; segments: Segment[] }>;

function buildFlowSegments(flows: ListedElement[]): {
  flowSegments: FlowSegments;
  bendCount: number;
  diagonalSegments: number;
  detourRatioAvg: number;
} {
  let bendCount = 0;
  let diagonalSegments = 0;
  const detourRatios: number[] = [];
  const flowSegments: FlowSegments = new Map();

  for (const f of flows) {
    if (!f.waypoints || f.waypoints.length < 2) continue;
    const wps = deduplicateWaypoints(cloneWaypoints(f.waypoints), 1);
    if (wps.length < 2) continue;

    bendCount += Math.max(0, wps.length - 2);

    const segs: Segment[] = [];
    let pathLen = 0;
    for (let i = 0; i < wps.length - 1; i++) {
      const p1 = wps[i];
      const p2 = wps[i + 1];
      segs.push({ p1, p2 });
      pathLen += dist(p1, p2);

      const dx = Math.abs(p2.x - p1.x);
      const dy = Math.abs(p2.y - p1.y);
      if (dx !== 0 && dy !== 0) diagonalSegments++;
    }

    const start = wps[0];
    const end = wps[wps.length - 1];
    const manhattan = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
    if (manhattan > 0) detourRatios.push(pathLen / manhattan);

    flowSegments.set(f.id, { sourceId: f.sourceId, targetId: f.targetId, segments: segs });
  }

  const detourRatioAvg = detourRatios.length
    ? detourRatios.reduce((a, b) => a + b, 0) / detourRatios.length
    : 1;

  return { flowSegments, bendCount, diagonalSegments, detourRatioAvg };
}

function computeCrossings(flowSegments: FlowSegments): number {
  let crossings = 0;
  const ids = [...flowSegments.keys()];

  for (let i = 0; i < ids.length; i++) {
    const fa = flowSegments.get(ids[i])!;
    for (let j = i + 1; j < ids.length; j++) {
      const fb = flowSegments.get(ids[j])!;

      if (
        (fa.sourceId && (fa.sourceId === fb.sourceId || fa.sourceId === fb.targetId)) ||
        (fa.targetId && (fa.targetId === fb.sourceId || fa.targetId === fb.targetId))
      ) {
        continue;
      }

      crossings += countCrossingsBetweenFlows(fa.segments, fb.segments);
    }
  }

  return crossings;
}

function countCrossingsBetweenFlows(a: Segment[], b: Segment[]): number {
  let c = 0;
  for (const sa of a) {
    for (const sb of b) {
      if (segmentEndpointProximity(sa.p1, sa.p2, sb.p1, sb.p2, 3)) continue;
      if (segmentsIntersect(sa.p1, sa.p2, sb.p1, sb.p2)) c++;
    }
  }
  return c;
}

function computeGridSnapAvg(shapes: ListedElement[]): number {
  const gridSnaps: number[] = [];
  for (const s of shapes) {
    gridSnaps.push(gridSnap01(s.x));
    gridSnaps.push(gridSnap01(s.y));
  }
  return gridSnaps.length ? gridSnaps.reduce((a, b) => a + b, 0) / gridSnaps.length : 1;
}

export function computeLayoutMetrics(elements: ListedElement[]): LayoutMetrics {
  const { shapes, flows } = splitElements(elements);
  const { overlaps, nearMisses } = computeOverlapAndNearMisses(shapes);
  const { flowSegments, bendCount, diagonalSegments, detourRatioAvg } = buildFlowSegments(flows);
  const crossings = computeCrossings(flowSegments);
  const gridSnapAvg = computeGridSnapAvg(shapes);

  return {
    nodeCount: shapes.length,
    flowCount: flows.length,
    overlaps,
    nearMisses,
    crossings,
    bendCount,
    diagonalSegments,
    detourRatioAvg,
    gridSnapAvg,
  };
}

export function scoreLayout(metrics: LayoutMetrics): {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
} {
  // Start at 100 and subtract penalties. Weights are intentionally simple and stable.
  let score = 100;

  score -= metrics.overlaps * 25;
  score -= metrics.crossings * 12;

  score -= metrics.diagonalSegments * 2;
  score -= metrics.bendCount * 1.5;
  score -= metrics.nearMisses * 0.5;

  // Penalize detours above ~1.2x. (1.0 is ideal.)
  if (metrics.detourRatioAvg > 1.2) score -= (metrics.detourRatioAvg - 1.2) * 30;

  // Grid snap: 1 is ideal.
  score -= (1 - metrics.gridSnapAvg) * 10;

  score = clamp(score, 0, 100);

  const grade: 'A' | 'B' | 'C' | 'D' | 'F' =
    score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';

  return { score, grade };
}
