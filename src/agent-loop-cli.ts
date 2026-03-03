/**
 * agent-loop-cli — self-improving loop for the BPMN layout engine.
 *
 * Uses the GitHub Copilot CLI as an autonomous agent to iteratively improve
 * the layout engine source code in src/rebuild/ by:
 *
 *  1. Requiring a clean git tree (refuses to run with uncommitted changes).
 *  2. Running a baseline eval: builds fixed BPMN diagrams via the eval
 *     scenarios (src/eval/scenarios.ts), runs the layout engine on them, and
 *     scores the output on metrics such as overlaps, crossings, grid-snapping,
 *     bend count, and detour ratio.
 *  3. Looping N iterations (default 3, --iterations <n>):
 *     a. Builds a prompt (agent-loop-prompt.ts) containing the scoring
 *        formula, per-scenario penalties, architecture notes, allowed files,
 *        and results of previous iterations so the agent can learn from them.
 *     b. Invokes the `copilot` CLI with the prompt, injecting this MCP server
 *        via --additional-mcp-config so the agent can inspect diagrams.
 *        Shell commands (npm, git, node, make, rm, mv) are denied to sandbox
 *        the agent.
 *     c. Captures the git diff of whatever Copilot changed.
 *     d. Validates the diff — rejects changes to protected eval files
 *        (src/eval/scenarios.ts, score.ts, run-eval.ts, types.ts) and
 *        forbidden paths (dist/, node_modules/).
 *     e. Builds and tests the candidate (npm run build + npm test).
 *     f. Re-runs the eval and compares aggregate scoreAvg to the baseline.
 *     g. Accepts (git commit) if improvement ≥ minImprove (default 0.1);
 *        otherwise hard-reverts (git reset --hard HEAD).
 *  4. Generates a full audit trail: JSON audit log, markdown report with
 *     SVG before/after comparisons, patch files, and token usage stats.
 *
 * The diagrams produced by the eval scenarios are purely a test harness.
 * The agent's job is to improve the layout *algorithm* in src/rebuild/ so
 * those same scenarios produce better-scoring output after each iteration.
 *
 * CLI flags:
 *   --iterations <n>   Number of improvement iterations (default: 3)
 *   --minImprove <f>   Minimum scoreAvg improvement to accept (default: 0.1)
 *   --outputDir <dir>  Eval output directory (default: test-outputs/eval)
 *   --repoDir <dir>    Repository root (default: cwd)
 *   --model <name>     Copilot model to use (default: Copilot default)
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { runEval } from './eval/run-eval'; // baseline only — candidate eval uses runEvalSubprocess
import type { EvalConfig, EvalReport } from './eval/types';
import type { AuditLog, IterationAudit } from './agent-loop-types';
import { generateMarkdownReport } from './agent-loop-report';
import { buildPrompt } from './agent-loop-prompt';
import {
  captureScenarioSvgs,
  copilotRunEdits,
  parseSessionTranscript,
  validateDiffPaths,
  writeMcpConfig,
} from './agent-loop-helpers';

// ---------------------------------------------------------------------------
// CLI arg parser
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Shell helpers
// ---------------------------------------------------------------------------

function run(cmd: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
  const res = spawnSync(cmd, args, {
    cwd: opts?.cwd ?? process.cwd(),
    env: { ...process.env, ...(opts?.env ?? {}) },
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  if (res.status !== 0) {
    const err = new Error(
      `Command failed: ${cmd} ${args.join(' ')}\nexit=${res.status}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`
    );
    (err as any).stdout = res.stdout;
    (err as any).stderr = res.stderr;
    throw err;
  }
  return { stdout: res.stdout as string, stderr: res.stderr as string };
}

function tryRun(cmd: string, args: string[], opts?: { cwd?: string }): string {
  try {
    return run(cmd, args, opts).stdout.trim();
  } catch {
    return '';
  }
}

function getCurrentGitCommit(repoDir: string): string {
  return tryRun('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoDir });
}

function requireCleanGitTree() {
  const trackedDirty =
    spawnSync('git', ['diff', '--quiet'], { encoding: 'utf-8', stdio: 'ignore' }).status !== 0 ||
    spawnSync('git', ['diff', '--cached', '--quiet'], { encoding: 'utf-8', stdio: 'ignore' })
      .status !== 0;
  if (trackedDirty) {
    throw new Error('Refusing to run agent-loop: tracked files have diffs (git diff not clean).');
  }
}

function hardRevert(repoDir: string) {
  run('git', ['reset', '--hard', 'HEAD'], { cwd: repoDir });
  run('git', ['clean', '-fd'], { cwd: repoDir });
}

// ---------------------------------------------------------------------------
// Eval helpers
// ---------------------------------------------------------------------------

function summarizeReport(report: EvalReport): string {
  const worst = [...report.scenarios].sort((a, b) => a.score - b.score)[0];
  const lines = [
    `Aggregate: avg=${report.aggregate.scoreAvg} min=${report.aggregate.scoreMin}`,
    `Worst: ${worst.scenarioId} ${worst.name} score=${worst.score} grade=${worst.grade}`,
  ];
  return lines.join('\n');
}

/**
 * Run the eval harness in a **child process** so it picks up the freshly
 * compiled `dist/eval-cli.js` rather than the stale bundle that was loaded
 * when this agent-loop process started.
 *
 * Background: `agent-loop-cli.js` is a self-contained esbuild bundle.  Once
 * it starts, `require()` cache is fixed — re-building dist/ on disk has no
 * effect on the in-process module graph.  Calling `runEval()` directly after
 * `npm run build` would always execute the *original* layout engine, making
 * every candidate score identical to baseline (0.000 improvement every iter).
 *
 * The subprocess writes `report.json` to `outputDir` and we read it back.
 */
function runEvalSubprocess(opts: { repoDir: string; outputDir: string }): EvalReport {
  const evalCli = path.join(opts.repoDir, 'dist', 'eval-cli.js');
  run('node', [evalCli, '--outputDir', opts.outputDir, '--exportArtifacts'], {
    cwd: opts.repoDir,
  });
  const reportPath = path.join(opts.outputDir, 'report.json');
  return JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as EvalReport;
}

// ---------------------------------------------------------------------------
// Iteration runner
// ---------------------------------------------------------------------------

interface IterCtx {
  iter: number;
  iterations: number;
  repoDir: string;
  journalDir: string;
  evalConfig: EvalConfig;
  minImprove: number;
  mcpConfigPath: string;
  model?: string;
}

async function evalCandidate(
  iterAudit: IterationAudit,
  diff: string,
  patchPath: string,
  iterDir: string,
  ctx: IterCtx,
  baseline: EvalReport
): Promise<{ next: EvalReport; ok: boolean }> {
  const { iter, repoDir, evalConfig, minImprove } = ctx;
  const worst = [...baseline.scenarios].sort((a, b) => a.score - b.score)[0];
  iterAudit.changedFiles = diff
    .split('\n')
    .filter((l) => l.startsWith('+++ b/'))
    .map((l) => l.replace('+++ b/', '').trim());

  let ok = false;
  let next = baseline;
  try {
    validateDiffPaths(diff);
    fs.writeFileSync(patchPath, diff + '\n', 'utf-8');
    run('npm', ['run', 'build'], { cwd: repoDir });
    run('npm', ['test'], { cwd: repoDir });
    // Run eval in a subprocess so it uses the freshly built dist/eval-cli.js.
    // In-process runEval() would silently use the stale bundle loaded at startup.
    const candidate = runEvalSubprocess({ repoDir, outputDir: evalConfig.outputDir });
    fs.writeFileSync(path.join(iterDir, 'report.json'), JSON.stringify(candidate, null, 2) + '\n', 'utf-8'); // prettier-ignore
    iterAudit.candidateReport = candidate;
    iterAudit.svgSnapshots.after = captureScenarioSvgs(candidate.scenarios, path.join(iterDir, 'svgs-after'), 'after'); // prettier-ignore

    const improve = candidate.aggregate.scoreAvg - baseline.aggregate.scoreAvg;
    iterAudit.scoreImprovement = improve;
    if (improve >= minImprove) {
      run('git', ['add', '-A'], { cwd: repoDir });
      run('git', ['commit', '--no-verify', '-m', `agent-loop: iter-${iter} avg +${improve.toFixed(2)} (${worst.scenarioId})`], { cwd: repoDir }); // prettier-ignore
      process.stdout.write(`Iteration ${iter}: accepted (avg +${improve.toFixed(2)}) patch=${path.relative(repoDir, patchPath)}\n`); // prettier-ignore
      next = candidate;
      ok = true;
      iterAudit.accepted = true;
    } else {
      iterAudit.rejectionReason = `score improvement ${improve.toFixed(3)} < threshold ${minImprove}`;
      process.stdout.write(`Iteration ${iter}: rejected (avg +${improve.toFixed(2)} < ${minImprove})\n`); // prettier-ignore
    }
  } catch (err) {
    const msg = (err as Error).message;
    process.stderr.write(`Iteration ${iter}: failed: ${msg}\n`);
    iterAudit.rejectionReason = `error: ${msg}`;
  } finally {
    if (!ok) hardRevert(repoDir);
  }
  return { next, ok };
}

async function runIteration(
  ctx: IterCtx,
  baseline: EvalReport,
  previousAudits?: IterationAudit[]
): Promise<{ next: EvalReport; ok: boolean; audit: IterationAudit }> {
  const { iter, iterations, repoDir, journalDir, evalConfig, mcpConfigPath, model } = ctx;
  const label = `iter-${String(iter).padStart(2, '0')}`;
  const iterDir = path.join(journalDir, label);
  fs.mkdirSync(iterDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const baselineSvgDir = path.join(iterDir, 'svgs-baseline');
  const transcriptPath = path.join(iterDir, 'session.md');
  const patchPath = path.join(iterDir, 'changes.patch');

  const iterAudit: IterationAudit = {
    iter,
    startedAt,
    finishedAt: '',
    durationSec: 0,
    model: model ?? '(default)',
    tokenUsage: {},
    svgSnapshots: {
      baseline: captureScenarioSvgs(baseline.scenarios, baselineSvgDir, 'baseline'),
      after: [],
    },
    sessionTranscriptPath: transcriptPath,
    toolCalls: [],
    patchPath,
    changedFiles: [],
    scoreImprovement: 0,
    accepted: false,
    rejectionReason: '',
    baselineReport: baseline,
    candidateReport: null,
  };

  process.stdout.write(`\nIteration ${iter}/${iterations}: asking Copilot to edit files...\n`);
  const diff = copilotRunEdits({
    prompt: buildPrompt(baseline, evalConfig.outputDir, previousAudits),
    repoDir,
    mcpConfigPath,
    transcriptPath,
    model,
  });

  const parsed = parseSessionTranscript(transcriptPath);
  iterAudit.model = parsed.model !== 'unknown' ? parsed.model : (model ?? '(default)');
  iterAudit.tokenUsage = parsed.tokenUsage;
  iterAudit.toolCalls = parsed.toolCalls;

  let result: { next: EvalReport; ok: boolean };
  if (!diff) {
    process.stdout.write(`Iteration ${iter}: Copilot made no changes. Stopping.\n`);
    iterAudit.rejectionReason = 'no changes made';
    result = { next: baseline, ok: false };
  } else {
    result = await evalCandidate(iterAudit, diff, patchPath, iterDir, ctx, baseline);
  }

  iterAudit.finishedAt = new Date().toISOString();
  iterAudit.durationSec = (Date.now() - new Date(startedAt).getTime()) / 1000;
  fs.writeFileSync(path.join(iterDir, 'audit.json'), JSON.stringify(iterAudit, null, 2) + '\n', 'utf-8'); // prettier-ignore

  return { ...result, audit: iterAudit };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const repoDir = path.resolve(String(args.repoDir ?? process.cwd()));
  const outputDir = path.resolve(String(args.outputDir ?? 'test-outputs/eval'));
  const journalDir = path.join(outputDir, 'agent-loop');
  const iterations = args.iterations ? Number(args.iterations) : 3;
  const minImprove = args.minImprove ? Number(args.minImprove) : 0.1;
  const model = typeof args.model === 'string' ? args.model : undefined;

  if (!Number.isFinite(iterations) || iterations <= 0) throw new Error('--iterations must be > 0');

  fs.mkdirSync(journalDir, { recursive: true });
  process.chdir(repoDir);
  requireCleanGitTree();

  const startedAt = new Date().toISOString();
  const gitCommit = getCurrentGitCommit(repoDir);
  const mcpConfigPath = writeMcpConfig(repoDir);

  try {
    const evalConfig: EvalConfig = { outputDir, exportArtifacts: true };
    let baseline = await runEval(evalConfig);
    fs.writeFileSync(path.join(outputDir, 'report.baseline.json'), JSON.stringify(baseline, null, 2) + '\n', 'utf-8'); // prettier-ignore
    process.stdout.write('Baseline\n' + summarizeReport(baseline) + '\n');

    // Save baseline SVGs to iter-00 for report
    const iter00SvgDir = path.join(journalDir, 'iter-00', 'svgs-baseline');
    captureScenarioSvgs(baseline.scenarios, iter00SvgDir, 'baseline');

    const auditIterations: IterationAudit[] = [];

    for (let iter = 1; iter <= iterations; iter++) {
      const { next, ok, audit } = await runIteration(
        { iter, iterations, repoDir, journalDir, evalConfig, minImprove, mcpConfigPath, model },
        baseline,
        auditIterations // pass previous iterations for learning
      );
      auditIterations.push(audit);
      baseline = next;
      if (!ok && !next) break;
    }

    // Final eval & SVGs
    const finalReport = await runEval(evalConfig);
    fs.writeFileSync(path.join(outputDir, 'report.final.json'), JSON.stringify(finalReport, null, 2) + '\n', 'utf-8'); // prettier-ignore
    process.stdout.write('Final\n' + summarizeReport(finalReport) + '\n');

    const finalSvgDir = path.join(journalDir, 'final-svgs');
    captureScenarioSvgs(finalReport.scenarios, finalSvgDir, 'after');

    // Write full audit JSON
    const finishedAt = new Date().toISOString();
    const fullAudit: AuditLog = {
      startedAt,
      finishedAt,
      repoDir,
      gitCommit,
      iterations: auditIterations,
      baselineReport: JSON.parse(
        fs.readFileSync(path.join(outputDir, 'report.baseline.json'), 'utf-8')
      ),
      finalReport,
    };

    fs.writeFileSync(
      path.join(journalDir, 'audit.json'),
      JSON.stringify(fullAudit, null, 2) + '\n',
      'utf-8'
    );

    // Generate markdown report (reportDir = directory where the .md file lives,
    // so relative image paths like agent-loop/iter-01/svgs-after/after-S01-....svg resolve correctly)
    const mdPath = path.join(outputDir, 'agent-loop-audit.md');
    const mdReport = generateMarkdownReport(fullAudit, journalDir, outputDir);
    fs.writeFileSync(mdPath, mdReport, 'utf-8');
    process.stdout.write(`\nAudit report: ${path.relative(repoDir, mdPath)}\n`);
  } finally {
    // Clean up temp MCP config
    try {
      fs.unlinkSync(mcpConfigPath);
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
