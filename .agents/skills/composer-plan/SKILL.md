---
name: composer-plan
description: Create implementation plans optimized for Cursor Composer 2 execution. Use when the user wants Codex to inspect a repo and produce a handoff plan for Cursor/Composer.
---

# Composer 2 Implementation Plan Skill

Do not edit code.

Inspect the repository and produce a implementation plan as .cursor/plans/<YYMMdd-Index-plan-name>.md intended for Cursor Composer 2. e.g. .cursor/plans/260614-01-provider-shared-transition-engine.md. Index resets to 01 everyday.

The plan must include:

1. Goal
2. Non-goals
3. Current-state findings
4. Existing patterns to follow
5. Atomic implementation steps
6. Tests to add or update
7. Verification
8. Acceptance criteria
9. Risks, ambiguities, and stop conditions

Optimize for an implementation agent:

- Be explicit.
- Avoid broad refactors.
- Prefer minimal diffs.
- State what must not be changed.
- Include “stop and ask/report” conditions if the repo differs from assumptions.
- Avoid stopgap fixes and aim for fundamental solutions and future-proof improvements.
- Rather than overfitting to a specific library or framework, abstract it so that it can accommodate different ones.
- Never consider backward compatibility.

If the plan may be large, consider splitting it into multiple plans at proper granularity.
Output only the plan.
