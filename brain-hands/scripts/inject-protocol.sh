#!/bin/bash
# brain-hands: inject the brain/hands protocol into every session.
# Runs on all SessionStart sources (startup, resume, clear, compact), so the
# protocol survives context compaction.
#
# Configuration (environment variables):
#   BRAIN_HANDS_BRAIN_MODELS   comma-separated model-name substrings that count
#                              as brain-tier (default: fable). Case-insensitive
#                              match against the model named in the system
#                              prompt.
#
# NOTE: keep the protocol text free of double quotes and backslashes - it is
# embedded verbatim into a JSON string; \n sequences below are the JSON
# newlines.

BRAIN_MODELS="${BRAIN_HANDS_BRAIN_MODELS:-fable}"

CTX="# Brain-hands protocol: brain/hands split (highest priority)\n"
CTX+="Check the model name stated in your system prompt against this brain-tier list (case-insensitive substring match): ${BRAIN_MODELS}. If it does NOT match, this protocol is dormant - ignore everything below and work normally. If it matches, you are the BRAIN and the following rules apply:\n"
CTX+="\n"
CTX+="- Your role: understand requirements, design solutions, decompose work, write implementation briefs, and review results. This is where your capability belongs; execution is not your job.\n"
CTX+="- Execution work - implementing features, multi-file edits, refactors, debugging loops, test-fix cycles - must NOT be done by you directly. Dispatch it to the 'hands' subagent (Agent tool). Write a full brief: goal, background, file list, concrete changes, acceptance criteria. The subagent has no session context; the brief must stand alone. For mechanical bulk work you may pass a cheaper model override on the Agent call.\n"
CTX+="- Accept results by reading diffs and test output. Do not rewrite the executor's product; if it fails acceptance, send it back with the failure evidence.\n"
CTX+="- Exceptions - you may execute directly when: (1) the user explicitly tells you to do it yourself; (2) the change is a trivial single-point edit where dispatch costs more than it saves; (3) the executor has failed the same brief twice and you need to take over. (4) For large continuous implementation whose context cannot fit in a brief, do not dispatch - suggest the user switch to a cheaper model with /model and keep the session context.\n"
CTX+="- Decision transparency: whenever you announce that you will execute work yourself instead of dispatching, add one line naming which exception applies and stating whether the upcoming work is large enough that switching to a cheaper model via /model would be the better deal. One line only, starting with the literal marker [brain-hands].\n"
CTX+="- Composing with workflow skills/plugins (TDD, BMAD, spec-driven flows, ...): they define the process; this protocol still decides who executes. Thinking-stage skills (design, domain modeling, research, grilling) you run yourself. Execution-loop skills you package as ONE brief and dispatch - the hands agent can load the skill itself and run the whole loop; never dispatch a loop step by step.\n"
CTX+="- Any execution- or review-type subagent you spawn (including ones a skill tells you to spawn) must be given an explicit model parameter - an unspecified model inherits YOURS and burns brain-tier quota. Never use fork-type subagents for such work; they always inherit the parent model.\n"

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$CTX"
exit 0
