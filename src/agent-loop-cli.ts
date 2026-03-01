import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { runEval } from './eval/run-eval';
import type { EvalConfig, EvalReport } from './eval/types';

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

function requireCleanGitTree() {
  // Only consider tracked diffs. Untracked files (e.g. test outputs) are fine.
  const trackedDirty =
    spawnSync('git', ['diff', '--quiet'], { encoding: 'utf-8', stdio: 'ignore' }).status !== 0 ||
    spawnSync('git', ['diff', '--cached', '--quiet'], { encoding: 'utf-8', stdio: 'ignore' })
      .status !== 0;
  if (trackedDirty) {
    throw new Error('Refusing to run agent-loop: tracked files have diffs (git diff not clean).');
  }
}

function hardRevert() {
  run('git', ['reset', '--hard', 'HEAD']);
  run('git', ['clean', '-fd']);
}

function stripFences(s: string): string {
  const trimmed = s.trim();
  if (trimmed.startsWith('```')) {
    const lines = trimmed.split(/\r?\n/);
    // drop first and last fence line
    if (lines.length >= 3 && lines[lines.length - 1].startsWith('```')) {
      return lines.slice(1, -1).join('\n');
    }
  }
  return s;
}

function extractUnifiedDiff(text: string): string {
  // Drop noisy environment warnings (e.g., OpenSSL cert message).
  const cleaned = text
    .split(/\r?\n/)
    .filter(
      (l) =>
        !l.startsWith('Cannot open directory /nix/store/') || !l.includes('OpenSSL certificates')
    )
    .join('\n');

  const unfenced = stripFences(cleaned);
  const idx = unfenced.indexOf('diff --git ');
  if (idx === -1) return '';
  return unfenced.slice(idx).trim() + '\n';
}

function validateDiffPaths(diff: string) {
  const allowedPrefixes = [
    'src/',
    'test/',
    'docs/',
    'README.md',
    'TODO.md',
    'Makefile',
    'package.json',
    'esbuild.config.mjs',
    'tsconfig.json',
    'tsconfig.test.json',
    'vitest.config.ts',
    'eslint.config.mjs',
  ];

  const forbiddenPrefixes = ['dist/', 'node_modules/', '.git/'];

  const fileLines = diff
    .split(/\r?\n/)
    .filter((l) => l.startsWith('+++ b/') || l.startsWith('--- a/'));

  const paths = new Set<string>();
  for (const l of fileLines) {
    const p = l
      .replace(/^\+\+\+ b\//, '')
      .replace(/^--- a\//, '')
      .trim();
    if (p === '/dev/null') continue;
    paths.add(p);
  }

  for (const p of paths) {
    if (forbiddenPrefixes.some((fx) => p.startsWith(fx))) {
      throw new Error(`Diff touches forbidden path: ${p}`);
    }
    if (!allowedPrefixes.some((fx) => p === fx || p.startsWith(fx))) {
      throw new Error(`Diff touches disallowed path: ${p}`);
    }
  }
}

function applyDiff(diff: string, journalDir: string, label: string) {
  validateDiffPaths(diff);

  const patchPath = path.join(journalDir, `${label}.patch`);
  fs.writeFileSync(patchPath, diff, 'utf-8');
  run('git', ['apply', patchPath]);
  return patchPath;
}

function summarizeReport(report: EvalReport): string {
  const worst = [...report.scenarios].sort((a, b) => a.score - b.score)[0];
  return [
    `Aggregate: avg=${report.aggregate.scoreAvg} min=${report.aggregate.scoreMin}`,
    `Worst: ${worst.scenarioId} ${worst.name} score=${worst.score} grade=${worst.grade}`,
    `Worst metrics: overlaps=${worst.metrics.overlaps}, crossings=${worst.metrics.crossings}, diagonalSegments=${worst.metrics.diagonalSegments}, bendCount=${worst.metrics.bendCount}, detourRatioAvg=${worst.metrics.detourRatioAvg}, nearMisses=${worst.metrics.nearMisses}, gridSnapAvg=${worst.metrics.gridSnapAvg}`,
  ].join('\n');
}

function copilotSuggestPatch(prompt: string, repoDir: string): string {
  const args = [
    '-p',
    prompt,
    '-s',
    '--no-ask-user',
    '--allow-all-tools',
    '--deny-tool',
    'shell',
    '--deny-tool',
    'write',
    '--disable-builtin-mcps',
    '--add-dir',
    repoDir,
    '--stream',
    'off',
  ];

  const res = spawnSync('copilot', args, {
    cwd: repoDir,
    encoding: 'utf-8',
    stdio: 'pipe',
  });

  const raw = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  const diff = extractUnifiedDiff(raw);
  return diff;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const repoDir = path.resolve(String(args.repoDir ?? process.cwd()));
  const outputDir = path.resolve(String(args.outputDir ?? 'test-outputs/eval'));
  const journalDir = path.join(outputDir, 'agent-loop');
  const iterations = args.iterations ? Number(args.iterations) : 3;
  const minImprove = args.minImprove ? Number(args.minImprove) : 0.1;

  if (!Number.isFinite(iterations) || iterations <= 0) throw new Error('--iterations must be > 0');

  fs.mkdirSync(journalDir, { recursive: true });

  process.chdir(repoDir);
  requireCleanGitTree();

  const evalConfig: EvalConfig = { outputDir, exportArtifacts: true };

  let baseline = await runEval(evalConfig);
  fs.writeFileSync(
    path.join(outputDir, 'report.baseline.json'),
    JSON.stringify(baseline, null, 2) + '\n',
    'utf-8'
  );
  process.stdout.write('Baseline\n');
  process.stdout.write(summarizeReport(baseline) + '\n');

  for (let iter = 1; iter <= iterations; iter++) {
    const worst = [...baseline.scenarios].sort((a, b) => a.score - b.score)[0];

    const prompt = [
      'You are improving an open-source TypeScript project that lays out BPMN diagrams headlessly.',
      'Your task: propose a SINGLE unified diff patch (git-style) that improves the layout score produced by the eval harness.',
      '',
      'Hard constraints:',
      '- Output ONLY a unified diff starting with "diff --git" (no commentary, no markdown).',
      '- Keep changes minimal and focused; do not touch dist/, node_modules/, or generated artifacts.',
      '- Do not change the scoring weights; improve the actual layout or geometry behavior.',
      '',
      'Context: current eval report summary:',
      summarizeReport(baseline),
      '',
      `Focus on improving the worst scenario: ${worst.scenarioId} ${worst.name}.`,
      'Typical fix areas include routing waypoints, overlap avoidance, and layout spacing in src/rebuild/.',
    ].join('\n');

    const diff = copilotSuggestPatch(prompt, repoDir);
    if (!diff) {
      console.error(`Iteration ${iter}: Copilot did not return a diff. Stopping.`);
      break;
    }

    const label = `iter-${String(iter).padStart(2, '0')}`;
    const patchPath = applyDiff(diff, journalDir, label);

    let ok = false;
    try {
      run('npm', ['test'], { cwd: repoDir });
      const candidate = await runEval(evalConfig);
      fs.writeFileSync(
        path.join(journalDir, `${label}.report.json`),
        JSON.stringify(candidate, null, 2) + '\n',
        'utf-8'
      );

      const improve = candidate.aggregate.scoreAvg - baseline.aggregate.scoreAvg;
      const minImproveOk = improve >= minImprove;

      if (minImproveOk) {
        process.stdout.write(
          `Iteration ${iter}: accepted (avg +${improve.toFixed(2)}) patch=${path.relative(repoDir, patchPath)}\n`
        );
        baseline = candidate;
        ok = true;
      } else {
        process.stdout.write(
          `Iteration ${iter}: rejected (avg +${improve.toFixed(2)} < ${minImprove}) patch=${path.relative(repoDir, patchPath)}\n`
        );
      }
    } catch (err) {
      console.error(`Iteration ${iter}: failed: ${(err as Error).message}`);
    } finally {
      if (!ok) hardRevert();
    }
  }

  fs.writeFileSync(
    path.join(outputDir, 'report.final.json'),
    JSON.stringify(baseline, null, 2) + '\n',
    'utf-8'
  );
  process.stdout.write('Final\n');
  process.stdout.write(summarizeReport(baseline) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
