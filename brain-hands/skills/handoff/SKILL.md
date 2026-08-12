---
name: handoff
description: Write an implementation brief and dispatch it to the hands executor subagent. Use when the main session runs a brain-tier model and a designed change is ready to be implemented, or when the user says "handoff", "dispatch", "ship it to the executor".
---

# Handoff: brief + dispatch

Dispatch implementation to the `hands` executor subagent. The executor starts with zero session context - the brief must stand alone.

## 1. Write the brief (all five sections required)

```
GOAL
  One sentence: what exists after this work that does not exist now.

BACKGROUND
  Constraints, prior decisions, and conventions the executor cannot infer
  from the code alone. Link files instead of pasting where possible.

FILES
  Every file to create or change, with its role.

CHANGES
  Concrete per-file changes. "Refactor X" is not concrete;
  "extract <fn> from <file> into <new file>, keep signature" is.

ACCEPTANCE
  Checkable criteria: commands to run and their expected output,
  behaviors to verify. The executor must verify these before reporting.
```

If the work should follow a workflow skill (a TDD loop, a migration recipe), name the skill in the brief and instruct the executor to load it and run the whole loop - never dispatch loop iterations one at a time.

## 2. Dispatch

Call the Agent tool with the `hands` agent (installed by this plugin) and the brief as the prompt. For mechanical bulk work (renames, formatting, boilerplate) pass a cheaper `model` override on the call; otherwise use the agent's default.

## 3. Accept

- Read the executor's report, the diffs, and the verification output against each acceptance criterion.
- Failed acceptance: send it back once with the failure evidence. Failed twice: take over per the protocol exceptions.
- Do not rewrite accepted work for style.
