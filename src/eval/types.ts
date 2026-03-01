export interface ListedElement {
  id: string;
  type: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  sourceId?: string;
  targetId?: string;
  waypoints?: Array<{ x: number; y: number }>;
}

export interface LayoutMetrics {
  nodeCount: number;
  flowCount: number;

  overlaps: number;
  nearMisses: number;

  crossings: number;
  bendCount: number;
  diagonalSegments: number;

  detourRatioAvg: number;
  gridSnapAvg: number; // 0..1, higher is better
}

export interface ScenarioScore {
  scenarioId: string;
  name: string;
  metrics: LayoutMetrics;
  score: number; // 0..100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  artifacts?: {
    bpmnPath?: string;
    svgPath?: string;
  };
}

export interface EvalConfig {
  outputDir: string;
  exportArtifacts: boolean;
  failBelowScore?: number;
}

export interface EvalReport {
  reportVersion: 1;
  config: EvalConfig;
  aggregate: {
    scenarioCount: number;
    scoreAvg: number;
    scoreMin: number;
  };
  scenarios: ScenarioScore[];
}
