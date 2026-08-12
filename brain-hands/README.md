# brain-hands

**Keep your smartest model as the brain. Let cheaper models be the hands.**

## The problem

Top-tier models (Fable, Opus) are the best at understanding requirements, designing solutions and reviewing results - and the most expensive per token, with the tightest subscription quotas. Yet ask one a question and it will happily "get to work": dozens of edit-test-retry loops, burning your scarcest quota on work a cheaper model executes just as well.

Hard blocks (plan mode, permission walls) fix this at the cost of flexibility: sometimes you *do* want the smart model to make an edit.

## What brain-hands does

brain-hands installs a **role protocol** instead of a wall. When your main session runs a brain-tier model:

- The model's job is: understand, design, decompose, write an implementation brief, review results.
- Implementation work (features, multi-file edits, refactors, debug loops) is dispatched to the bundled **`hands` executor subagent**, which runs on a cheaper model (Opus by default). Execution tokens land on the executor's quota, not the brain's.
- Built-in exceptions keep it flexible: say "do it yourself" and the brain executes directly; trivial one-line edits skip dispatch; if the executor fails twice the brain takes over; for large continuous work it suggests `/model` instead.

Even when the model misjudges a question as a task, the failure is cheap: it "gets to work" by writing a brief and dispatching, not by burning brain-tier quota on an edit loop.

Three mechanisms, all standard Claude Code plugin surface:

1. **SessionStart hook** injects the protocol into every session (including after context compaction) - no edits to your `CLAUDE.md`.
2. **`hands` agent** ships with the plugin, pinned to Opus. Override it by placing a same-name agent in `~/.claude/agents/` (user agents take precedence over plugin agents and survive plugin updates).
3. **`handoff` skill** carries the brief template and dispatch checklist.

## Install

```
/plugin marketplace add cookaihq/plugin-marketplace
/plugin install brain-hands@plugin-marketplace
```

## Updating

Third-party marketplaces like this one do **not** auto-update by default. Two ways to stay current:

**Manual** (the default):

```
/plugin update brain-hands@plugin-marketplace
```

New versions load in new sessions; run `/reload-plugins` to activate one in the current session.

**Automatic**: in `/plugin` → **Marketplaces** → `plugin-marketplace` → **Enable auto-update**. Teams can instead declare the marketplace in the project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "plugin-marketplace": {
      "source": { "source": "github", "repo": "cookaihq/plugin-marketplace" },
      "autoUpdate": true
    }
  }
}
```

Auto-update checks shortly after session start; a running session keeps the version it loaded until you `/reload-plugins` or start a new one. Releases are gated by the `version` field in `plugin.json` — a new version number, not a new commit, is what makes an update visible.

## Configuration

- `BRAIN_HANDS_BRAIN_MODELS` - comma-separated model-name substrings that count as brain-tier. Default: `fable`. Example: `BRAIN_HANDS_BRAIN_MODELS=fable,opus` makes Opus sessions delegate too (to whatever your hands override runs).
- **Change the executor model**: create `~/.claude/agents/hands.md` with the same `name: hands` and your preferred `model:` - your version wins.

## Composing with workflow plugins (TDD, BMAD, spec-driven flows)

Workflow skills define the *process*; brain-hands decides *who executes it*. Three cases:

| Skill type | Examples | What happens |
|---|---|---|
| Thinking-stage | domain modeling, codebase design, research, grilling, BMAD analyst/PM/architect | The brain runs them itself - that is what you pay it for. |
| Execution-loop | TDD red-green loops, prototype builds, BMAD dev/QA | Packaged as **one brief**; the hands agent loads the skill and runs the whole loop in its own session. Never dispatched step by step. |
| Skills that spawn subagents | parallel review skills | The protocol requires every execution/review subagent to get an explicit `model` parameter - unspecified models inherit the parent (your brain-tier model) and leak quota. Fork-type subagents are banned for such work. |

## Manual install (no plugin)

Prefer zero dependencies? Copy the protocol from [`scripts/inject-protocol.sh`](scripts/inject-protocol.sh) (the `CTX` text) into your `~/.claude/CLAUDE.md`, and create an executor agent in `~/.claude/agents/`. You lose automatic updates and the survives-compaction re-injection.

## Honest limits

- This is a prompt-layer protocol, not an enforcement mechanism. The brain model follows it with high - not perfect - reliability. The prohibition-plus-named-alternative phrasing ("must not execute; dispatch to hands") is deliberately chosen over process rules ("confirm before acting"), which models follow far less consistently.
- Claude Code only. The mechanisms used (plugin hooks, subagent model override) have no equivalent in other agent CLIs.
