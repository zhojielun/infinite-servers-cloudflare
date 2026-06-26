---
name: superpowers
description: >
  Enhanced workflow orchestration skills for complex multi-step tasks. Provides
  structured approaches to brainstorming, planning, execution, verification, and
  reporting. Use when tackling large features, debugging complex issues, or
  coordinating multiple parallel workstreams.
---

# Superpowers Workflow Skills

Structured workflow patterns for complex software engineering tasks. These skills provide systematic approaches to common multi-step operations.

## Brainstorming (Design First)

Before any creative work -- creating features, building components, adding functionality, or modifying behavior -- explore user intent, requirements, and design before implementation.

1. Understand the current project context
2. Ask clarifying questions one at a time
3. Present the design and get user approval
4. Only then proceed to implementation

**Never skip design for "simple" projects.** Unexamined assumptions cause the most wasted work on simple tasks.

## Planning (Task Breakdown)

Before implementing a complex change:

1. Break the work into discrete, testable tasks
2. Identify dependencies between tasks
3. Determine the optimal execution order
4. Create tasks using the `task` tool for tracking
5. Mark tasks `in_progress` before working, `done` immediately after

## Execution (Systematic Implementation)

When implementing:

1. Read existing code to understand conventions before writing
2. Make minimal, focused changes
3. Follow existing patterns -- don't introduce new abstractions unnecessarily
4. Verify each change compiles/types-checks before moving on
5. Run lint and typecheck after completing the implementation

## Verification (Quality Gates)

After implementation:

1. Run typecheck: `cd worker && npm run typecheck`
2. Run lint if configured (currently none in this repo)
3. Check for any hardcoded values that should be configurable
4. Verify no secrets or keys are committed
5. Test the specific functionality that was changed

## Reporting (Clear Communication)

When reporting results:

1. State what was done (1-2 sentences)
2. Note any issues encountered
3. List files changed
4. Suggest next steps if applicable

## Parallel Work (Subagent Coordination)

For large tasks with independent workstreams:

1. Spawn subagents for independent exploration/implementation
2. Use `task` tool to track each workstream
3. Wait for results before synthesizing
4. Resolve any conflicts between parallel results

## Error Recovery

When something fails:

1. Read the error message carefully
2. Check if the issue is environmental (missing deps, wrong directory)
3. Check if the issue is in the code (type error, logic error)
4. Fix the root cause, don't mask it
5. Re-run the failing command to verify the fix
