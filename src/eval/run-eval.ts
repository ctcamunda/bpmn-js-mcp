import fs from 'node:fs';
import path from 'node:path';

import { handleExportBpmn, handleListElements } from '../handlers';
import { parseToolJson } from './mcp-json';
import { getEvalScenarios } from './scenarios';
import type { EvalConfig, EvalReport, ListedElement, ScenarioScore } from './types';
import { computeLayoutMetrics, scoreLayout } from './score';

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function toListedElements(json: any): ListedElement[] {
  const els = (json?.elements ?? []) as any[];
  return els.map((e) => ({
    id: String(e.id),
    type: String(e.type),
    name: e.name ? String(e.name) : undefined,
    x: typeof e.x === 'number' ? e.x : undefined,
    y: typeof e.y === 'number' ? e.y : undefined,
    width: typeof e.width === 'number' ? e.width : undefined,
    height: typeof e.height === 'number' ? e.height : undefined,
    sourceId: e.sourceId ? String(e.sourceId) : undefined,
    targetId: e.targetId ? String(e.targetId) : undefined,
    waypoints: Array.isArray(e.waypoints)
      ? e.waypoints
          .filter((wp: any) => wp && typeof wp.x === 'number' && typeof wp.y === 'number')
          .map((wp: any) => ({ x: wp.x, y: wp.y }))
      : undefined,
  }));
}

export async function runEval(config: EvalConfig): Promise<EvalReport> {
  const outputDir = path.resolve(config.outputDir);
  ensureDir(outputDir);

  const scenarios = getEvalScenarios();
  const scenarioScores: ScenarioScore[] = [];

  for (const scenario of scenarios) {
    const { diagramId } = await scenario.build();

    if (config.exportArtifacts) {
      const bpmnPath = path.join(outputDir, `${scenario.scenarioId}-${slug(scenario.name)}.bpmn`);
      const svgPath = path.join(outputDir, `${scenario.scenarioId}-${slug(scenario.name)}.svg`);

      await handleExportBpmn({ diagramId, format: 'xml', filePath: bpmnPath });
      await handleExportBpmn({ diagramId, format: 'svg', filePath: svgPath });
    }

    const listJson = parseToolJson<any>(await handleListElements({ diagramId }));
    const listed = toListedElements(listJson);

    const metrics = computeLayoutMetrics(listed);
    const { score, grade } = scoreLayout(metrics);

    const artifacts = config.exportArtifacts
      ? {
          bpmnPath: path.join(outputDir, `${scenario.scenarioId}-${slug(scenario.name)}.bpmn`),
          svgPath: path.join(outputDir, `${scenario.scenarioId}-${slug(scenario.name)}.svg`),
        }
      : undefined;

    scenarioScores.push({
      scenarioId: scenario.scenarioId,
      name: scenario.name,
      metrics,
      score,
      grade,
      artifacts,
    });
  }

  const scoreAvg = scenarioScores.reduce((a, s) => a + s.score, 0) / scenarioScores.length;
  const scoreMin = Math.min(...scenarioScores.map((s) => s.score));

  const report: EvalReport = {
    reportVersion: 1,
    config,
    aggregate: {
      scenarioCount: scenarioScores.length,
      scoreAvg: round2(scoreAvg),
      scoreMin: round2(scoreMin),
    },
    scenarios: scenarioScores.map((s) => ({
      ...s,
      metrics: {
        ...s.metrics,
        detourRatioAvg: round3(s.metrics.detourRatioAvg),
        gridSnapAvg: round3(s.metrics.gridSnapAvg),
      },
      score: round2(s.score),
    })),
  };

  return report;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}
