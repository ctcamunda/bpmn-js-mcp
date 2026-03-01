import fs from 'node:fs';
import path from 'node:path';

import { runEval } from './eval/run-eval';
import type { EvalConfig } from './eval/types';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const outputDir = String(args.outputDir ?? 'test-outputs/eval');
  const exportArtifacts =
    args.exportArtifacts === false ? false : args.exportArtifacts ? true : true;
  const failBelowScore = args.failBelowScore ? Number(args.failBelowScore) : undefined;

  const config: EvalConfig = {
    outputDir,
    exportArtifacts,
    failBelowScore,
  };

  const report = await runEval(config);

  const reportPath = path.join(path.resolve(outputDir), 'report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');

  // Minimal stdout (useful in CI)
  process.stdout.write(
    `Eval: scenarios=${report.aggregate.scenarioCount} avg=${report.aggregate.scoreAvg} min=${report.aggregate.scoreMin}\n`
  );
  process.stdout.write(`Report: ${path.relative(process.cwd(), reportPath)}\n`);

  if (failBelowScore !== undefined && report.aggregate.scoreMin < failBelowScore) {
    console.error(`FAIL: scoreMin ${report.aggregate.scoreMin} < failBelowScore ${failBelowScore}`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
