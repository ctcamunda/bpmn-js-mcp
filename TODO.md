# TODO — Automated “Eval → Improve → Verify” Loop

Goal: build a self-reinforcing improvement loop for `bpmn-js-mcp` focused on:
1) executable BPMN correctness (Camunda 7-friendly output)
2) pleasing, stable layout that matches current engine defaults.

This file is now the backlog for the automation + scoring harness.

---

## P0 — Ship an end-to-end loop (local)

- [x] Add `make eval` to generate deterministic diagrams, export artifacts, and write a single JSON report with layout metrics + scores.
- [x] Implement a first-pass layout scoring algorithm (no SVG parsing) using `list_bpmn_elements` geometry:
	- overlaps (node-node)
	- crossings (flow-flow)
	- bends / waypoint count
	- orthogonality (diagonal segment penalty)
	- detour ratio (polyline length vs Manhattan distance)
	- minimum spacing (near-miss penalty)
	- grid-snapping (how “clean” coordinates are)
- [x] Make the score deterministic and stable across runs (no timestamps in metrics; fixed weights).
- [x] Export artifacts to `test-outputs/eval/` (`.bpmn`, `.svg`, `report.json`).
- [x] Add `make agent-loop` that iterates:
	1) baseline eval
	2) ask Copilot CLI for a *unified diff* patch for the worst-scoring issue
	3) apply patch
	4) run `make test` + `make eval`
	5) keep only if score improves and tests pass; otherwise revert

---

## P1 — Guardrails + ergonomics

- [x] Require a clean git working tree before `agent-loop` starts.
- [x] Reject Copilot-proposed diffs touching disallowed paths (e.g. `dist/`, `node_modules/`, `.git/`).
- [x] Add max-iterations / time budget / failure budget.
- [x] Emit a small “iteration journal” under `test-outputs/eval/agent-loop/` with:
	- patch file
	- score before/after
	- test status

---

## P2 — CI integration

- [x] Add a CI-friendly `make eval-ci` that fails if the aggregate score regresses beyond a small tolerance.
- [ ] Store a baseline score file in-repo (or compute baseline from main branch in CI).

---

## P3 — Scoring extensions

- [ ] Add label-quality scoring (requires label bounds extraction; likely via registry labels or SVG parsing).
- [ ] Add lane/pool containment + cross-lane “zig-zag” penalty.
- [ ] Add per-pattern scenario coverage (boundary events, event subprocess, call activity mappings, collaboration message flows).

---

## Notes

- The harness should use internal handlers (`handleAddElement`, `handleConnect`, `handleLayoutDiagram`, `handleListElements`, `handleExportBpmn`) so it tests the same code paths as MCP clients.
- Export uses the lint gate by default; the eval harness should prefer structurally valid scenarios.