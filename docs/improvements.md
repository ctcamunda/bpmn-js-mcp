## Tool Consolidation Plan

This plan is optimized for two goals:

1. Keep the public MCP interface small enough that it does not waste the agent's context window before useful work begins.
2. Keep the interface effective for agents that must turn human requirements into BPMN diagrams, especially executable Camunda 8 diagrams.

There are effectively no existing users to preserve, so migration cost is not a meaningful constraint. That means the right question is not “what can we deprecate safely?” but “what public surface gives agents the best chance of succeeding quickly?”

## Recommendation summary

Target a public surface of **15 tools or fewer**.

Do not treat `20` as the real goal. `20` is the ceiling. The real objective is to get to a tool set that is small enough to be mentally compressible by the agent while still preserving strong schemas and clear modeling semantics.

The best end-state shape is roughly:

1. create
2. connect
3. move
4. delete-element
5. configure
6. inspect
7. layout
8. lane-management
9. import
10. export
11. history
12. batch

That leaves a little room for one or two additional public tools only if qualitative testing shows they improve agent performance materially.

## Evaluation rubric

Each proposal below includes:

- **Recommendation:** `strongly recommend`, `recommend`, `uncertain`, or `do not recommend`
- **Priority:** `P0`, `P1`, `P2`, or `P3`

Meaning:

- `P0`: best first tranche for implementation and qualitative testing
- `P1`: strong follow-up after P0 if testing is positive
- `P2`: useful, but should wait until earlier consolidation proves out
- `P3`: low priority or only worth revisiting later

## Guiding principles

1. Optimize for the agent's decision tree, not for internal handler purity.
2. Favor broad top-level intents with strongly typed mode-specific schemas.
3. Keep the number of public tool names small.
4. Avoid broad tools that become ambiguous dumping grounds.
5. Prefer consolidations that reduce tool-choice uncertainty without weakening validation.

## Proposal A: remove `delete_bpmn_diagram`

**Recommendation:** strongly recommend

**Priority:** P0

### Why

- This tool does not materially help agents model BPMN.
- It costs context-window budget because it must be listed, described, and mentally filtered out.
- The user can delete persisted files directly if they want a diagram gone.
- For in-memory state, the agent can simply stop referencing a diagram.

### Expected impact

- Immediate surface reduction with almost no downside.
- `32 -> 31`

### Risk

- Very low.

## Proposal B: remove `configure_bpmn_zeebe_extensions`

**Recommendation:** recommend

**Priority:** P1

### Why

- The product direction already favors specialized executable-authoring semantics over a second competing Zeebe batch surface.
- This tool adds one more public name the agent must evaluate before acting.
- Its main remaining value is workflow compression, which can be recovered later through:
	- `configure_bpmn` with `elementIds`, or
	- `batch_bpmn_operations`

### Why not P0

- It still has some practical convenience value.
- If removed too early, you may temporarily lose a useful shortcut before the unified configuration tool exists.

### Expected impact

- `31 -> 30`

### Risk

- Low to medium.

## Proposal C: merge creation-oriented tools into one `create_bpmn`

**Recommendation:** recommend

**Priority:** P1

### Current tools absorbed

- `create_bpmn_diagram`
- `create_bpmn_participant`
- `create_bpmn_lanes`
- `add_bpmn_element`
- `add_bpmn_element_chain`
- `generate_bpmn_from_structure`
- `manage_bpmn_root_elements`

### Proposed public shape

- `create_bpmn(mode: "diagram" | "participant" | "lanes" | "element" | "chain" | "structure" | "root-elements")`

### Why this is attractive

- These are all “introduce BPMN objects into the model” actions.
- The biggest agent-facing confusion today is often not how to configure BPMN, but which creation path to start with.
- Putting creation under one name simplifies the first major branch in the agent's workflow.

### Main benefit

- This consolidation most directly addresses your context-window concern.
- It sharply reduces the amount of tool-list space spent on slightly different forms of creation.

### Main risk

- The schema can become too broad if not designed as a strict discriminated union.
- `mode: "structure"` must remain first-class, not buried, because it is often the best first-pass workflow.

### Constraint

- This should only proceed if each mode has very explicit required fields and mutually exclusive parameter groups.

### Expected impact

- `30 -> 24`

## Proposal D: merge configuration tools into one `configure_bpmn`

**Recommendation:** recommend

**Priority:** P1

### Current tools absorbed

- `set_bpmn_element_properties`
- `set_bpmn_input_output_mapping`
- `set_bpmn_event_definition`
- `set_bpmn_form_data`
- `set_bpmn_loop_characteristics`
- `set_bpmn_camunda_listeners`
- `set_bpmn_call_activity_variables`

### Proposed public shape

- `configure_bpmn(mode: "properties" | "io" | "event" | "form" | "loop" | "listeners" | "call-activity")`

### Why this is attractive

- These are all semantic-configuration operations on existing BPMN elements.
- The agent usually thinks “configure this task” or “configure this event,” not “select one of seven configuration tool names.”
- This consolidation is likely to improve first-pass agent behavior if the mode schemas remain crisp.

### Main benefit

- This removes one of the biggest sources of public-tool sprawl without losing functional power.

### Main risk

- This can easily become a dumping ground if the modes are not enforced strictly.
- Error messages must remain mode-aware and element-type-aware.

### Constraint

- The implementation should preserve strongly typed mode-specific payloads and explicit validation errors.

### Expected impact

- `24 -> 18`

## Proposal E: merge read-only tools into one `inspect_bpmn`

**Recommendation:** strongly recommend

**Priority:** P0

### Current tools absorbed

- `list_bpmn_diagrams`
- `list_bpmn_elements`
- `get_bpmn_element_properties`
- `validate_bpmn_diagram`
- `list_bpmn_process_variables`

### Proposed public shape

- `inspect_bpmn(mode: "diagrams" | "diagram" | "elements" | "element" | "validation" | "variables" | "diff")`

### Why this is attractive

- Read-only operations are the cleanest place to consolidate aggressively.
- These tools all answer some form of “tell me about the current BPMN state.”
- This dramatically reduces the number of top-level names without compromising mutation semantics.

### Main benefit

- High value, low risk.
- This is one of the best first things to implement and qualitatively test.

### Main risk

- Response contracts must stay mode-discriminated and easy to consume.
- Do not force one giant polymorphic response shape.

### Expected impact

- `18 -> 14`

## Proposal F: absorb `align_bpmn_elements` into `layout_bpmn_diagram`

**Recommendation:** strongly recommend

**Priority:** P0

### Current tools absorbed

- `align_bpmn_elements`

### Proposed public shape

- `layout_bpmn_diagram(mode: "layout" | "align" | "distribute" | "labels" | "autosize")`

### Why this is attractive

- Alignment, distribution, autosizing, and label cleanup are layout concerns.
- The current public split is implementation-oriented, not agent-oriented.
- The layout tool already behaves like a multi-mode interface.

### Main benefit

- This is a natural and low-risk consolidation.

### Main risk

- Minimal, as long as the new mode names are explicit.

### Expected impact

- `14 -> 13`

## Proposal G: merge lane tools into `manage_bpmn_lanes`

**Recommendation:** strongly recommend

**Priority:** P0

### Current tools absorbed

- `assign_bpmn_elements_to_lane`
- `analyze_bpmn_lanes`

### Proposed public shape

- `manage_bpmn_lanes(mode: "assign" | "suggest" | "validate" | "pool-vs-lanes" | "redistribute")`

### Why this is attractive

- Lane operations are already conceptually grouped.
- The current split is unnecessary from an agent perspective.
- This keeps lane-related reasoning behind one top-level public name.

### Main benefit

- Another high-value, low-risk consolidation.

### Main risk

- Very low.

## Proposal H: keep `connect_bpmn_elements` as a distinct top-level tool

**Recommendation:** strongly recommend

**Priority:** keep as-is

### Why

- Connection semantics are fundamental and deserve a stable, dedicated surface.
- It already usefully absorbs several formerly separate behaviors.
- Folding connect into a mega-tool would increase ambiguity for little gain.

## Proposal I: keep `import_bpmn_xml` and `export_bpmn` distinct

**Recommendation:** strongly recommend

**Priority:** keep as-is

### Why

- Import and export are lifecycle boundaries, not just another mode.
- Keeping them separate keeps the API clearer and safer.
- `export_bpmn` in particular has important lint-gate semantics that should stay obvious.

## Proposal J: keep `bpmn_history` and `batch_bpmn_operations` distinct

**Recommendation:** recommend

**Priority:** P2

### Why

- Both are conceptually important enough to justify separate top-level tools.
- They support distinct cross-cutting workflows rather than element-level BPMN semantics.
- Folding them into a generic utility umbrella would likely reduce clarity.

### Note

- These should only be reconsidered if qualitative agent testing shows they are rarely used or misunderstood.

## Proposal K: keep `delete_bpmn_element` and `move_bpmn_element` distinct for now

**Recommendation:** recommend

**Priority:** P2

### Why

- These operations are common, concrete, and easy for agents to understand.
- Folding them into a generic mutate tool would save one or two tool names but likely make the mutation surface harder to reason about.

### Note

- If later testing shows `move_bpmn_element` and `delete_bpmn_element` should be modes of a general mutation tool, revisit then. It is not the best first consolidation.

## Proposed target surface

The recommended end-state public surface is:

1. `create_bpmn`
2. `connect_bpmn_elements`
3. `move_bpmn_element`
4. `delete_bpmn_element`
5. `configure_bpmn`
6. `inspect_bpmn`
7. `layout_bpmn_diagram`
8. `manage_bpmn_lanes`
9. `import_bpmn_xml`
10. `export_bpmn`
11. `bpmn_history`
12. `batch_bpmn_operations`

Optional additional public tools only if testing shows clear value:

13. a recommendation/planning helper
14. one specialized high-value shortcut if it materially improves agent success

This lands the public surface at **12 to 14 tools**.

## Best first implementation tranche

Status: implemented on the current branch.

If the goal is to implement part of the plan and then do qualitative testing with real agents, the best first tranche is:

### P0 tranche

1. Remove `delete_bpmn_diagram` from the public registry
2. Add `inspect_bpmn`
3. Add `manage_bpmn_lanes`
4. Fold `align_bpmn_elements` into `layout_bpmn_diagram`

### Why this tranche first

- It is relatively low risk.
- It gives a meaningful reduction in public names.
- It should improve the agent's first-pass tool selection without forcing the riskiest schema redesign yet.
- It is a good qualitative test of whether broad mode-driven tools actually improve agent effectiveness in practice.

### Surface size after this tranche

Roughly:

- remove `delete_bpmn_diagram`
- replace 5 read-only tools with 1
- replace 2 lane tools with 1
- replace 2 layout tools with 1

This should move the surface from `32` to about **25** immediately, while preserving most of the existing internal architecture.

Observed result on the current branch: the public tool-definition count is now `25`, and the focused contract tests/typecheck pass against the consolidated surface.

## Second implementation tranche

### P1 tranche

1. Add `create_bpmn`
2. Add `configure_bpmn`
3. Remove the superseded public creation and configuration tool names
4. Remove `configure_bpmn_zeebe_extensions` once batch or multi-element configuration is covered elsewhere

### Why this tranche second

- This is where the biggest public-surface reduction happens.
- It is also where the greatest schema-design risk lives.
- It should come after the P0 tranche proves that consolidated top-level tools actually help agents.

## Qualitative testing plan

After each tranche, test with real agents on representative human requests.

### Test prompts to use

1. “Model a simple approval workflow with a manager review and a service task to send a confirmation.”
2. “Create an executable pool with lanes for requester and approver, including a timer escalation.”
3. “Build a collaboration with one executable pool and one collapsed external system pool.”
4. “Update this existing diagram to add a retry loop and a merge gateway.”
5. “Given this structured process description, generate the initial BPMN and then make it executable for Camunda 8.”

### Questions to evaluate qualitatively

1. Does the agent choose an effective first tool more quickly?
2. Does the agent spend fewer turns deciding which tool to use?
3. Does the agent make fewer schema mistakes?
4. Does the resulting workflow feel easier to prompt and explain?
5. Does the new surface reduce prompt and tool-list verbosity meaningfully?

## Risks to watch closely during testing

1. Broad tools may increase malformed payloads even if they reduce tool-choice errors.
2. A unified `create_bpmn` tool may become too large unless the modes are sharply separated.
3. A unified `configure_bpmn` tool may become an unstructured catch-all if the mode schemas are loose.
4. If agents become less reliable despite the smaller surface, stop and keep the safer P0 consolidations only.

## Success criteria

The consolidation plan is succeeding if:

1. The tool list shrinks materially.
2. Agents get to useful modeling actions faster.
3. Prompts and docs become shorter and clearer.
4. Acceptance coverage still passes for the major workflows.
5. Qualitative testing shows fewer tool-selection detours and no major drop in execution quality.

Status: completed

Implemented as a narrow, validated batch shortcut with per-element type checks and dedicated behavior coverage, while keeping the specialized tools as the authoritative executable-authoring surface.

## 2. Add End-to-End Executable Camunda 8 Coverage

Status: completed

Acceptance coverage now exercises the canonical executable Camunda 8 authoring flows, the generator-first path, the Zeebe batch shortcut in combination with specialized tools, and a Zeebe persistence/reload roundtrip.

## 3. Zeebe Authoring Surface Strategy

Status: completed

The prompts and documentation now consistently position the specialized tools as primary and `configure_bpmn_zeebe_extensions` as an optional batch shortcut layered on top.

## 4. Promote the Preferred Generator Workflow

Status: completed

The README, executable guide, and executable prompts now recommend `generate_bpmn_from_structure` for first-pass construction when the workflow is already well specified, while reserving low-level tools for refinement and advanced modeling.

## 5. Add a Small Improvement Roadmap

Status: unfinished synthesis output

The original plan ended with a prioritized roadmap. The remaining work can be organized as:

### Quick wins

No remaining quick wins from the original review plan.

### Medium-scope work

1. Expand the batch Zeebe tool to cover more of the commonly used executable surface.

### Larger product/architecture work

1. Consider whether additional read-only analysis resources would reduce round-trips better than adding more authoring tools.