# Changelog

## 0.9.0 — 2026-10-02

- Check delivered results against preserved user requirements by default. Prefer available host media tools, or use configurable AIhub reviewers with `gemini-3.8-flash` as the built-in default.
- Add `review` and `review-submit`, per-requirement evidence, file hashes, bounded document text extraction and resumable review tasks. Incomplete coverage cannot pass; check failures never regenerate media or automatically switch reviewers.
- Remind users after every enabled completed check that they can disable checks through conversation; document single-task and persistent configuration actions in all six Skills.
- Count independent upstream errors, deduplicate terminal task failures, and produce a local public Issue draft plus private administrator diagnostics. Never send feedback automatically or copy raw responses into reports.
- Add optional check and feedback settings to the layered loader, source inspection, credential declaration and packaged instructions. Only the API Key remains required.

## 0.8.0 — 2026-10-01

- Read ordered per-Skill model lists and `auto`, `confirm`, `off`, or `preflight_only` fallback policies; only the API Key is required and the built-in service URL remains overridable.
- Add `plan`, `run`, and `continue` with saved requirements, independently validated model requests, attempt limits and persistent confirmation. Explicit user model choices stay fixed.
- Keep uncertain submissions, active tasks, query/download errors and content mismatches on their original task. Legacy `resume` never submits another generation; native music now checks media tools before submission.
- Route all six Skills through the configured model workflow, documenting verified parameter mappings and unsupported conversions.
- Add `config-check` to report effective configuration files, missing or invalid settings and stale-report checks without exposing values or requiring network/media tools.
- Use secret-book to preview and save consumer configuration, repairing the actual source file and using Plugin globals only for new settings without an existing location. Normal AIhub commands read local configuration directly; table rotation does not automatically overwrite it.
- Report authentication rejection with configuration sources, separately from balance, permissions, rate limits and network errors. Configuration repair does not resubmit a business request.
- Update the first-configuration prompt and shared workflow; keep record/key confirmation and Agent rule inspection in secret-book.

## 0.7.0 — 2026-10-01

- Add the current Skill's `~/.config/<skill-name>/.env` after all five Plugin global files, filling each missing or empty field without overriding Plugin, project or process settings.
- Report the fallback file in configuration sources and make `--no-global-config` skip both Plugin and standalone Skill directories.
- Keep new file configuration in the Plugin directory by default; existing Skill files can be reused without migration. Do not read standalone `.env.local`, other Skills or old product aliases.

## 0.6.0 — 2026-10-01

- Offer secret-book or self-managed `.env` during first configuration, retaining personal global files as the default for the file option.
- Ship a credential requirements declaration and route all six Skills through secret-book consumer connections when selected. Record/key confirmation, scope and subsequent injection belong to secret-book 2.3.0 or newer.
- Keep the installation and first-configuration prompts short; distinguish local configuration checks from remote authentication.

## 0.5.0 — 2026-09-30

- Automatically read shared configuration from `~/.config/aihub/.env` and `.env.local`, with per-Skill `.env.<skill-name>` files and optional Skill subdirectory overrides. Process and project settings remain higher priority.
- Add `--no-global-config` to skip all global files for one command; retain `--use-global-config` as a compatibility no-op and reject conflicting flags.
- Stop reading the old parallel `~/.config/aihub-*/.env` directories. Existing users must explicitly migrate shared settings or per-Skill overrides; credentials are never moved automatically.
- Rewrite installation and first configuration guidance for users, including GitHub/CNB sources, personal global configuration, platform paths and source diagnostics.

## 0.4.0 — 2026-09-30

- Choose GPT Image 2.5 Flare for speed, or for drafts and iteration without an explicit detail priority; choose Sunburst when fine detail is the priority and speed is secondary. Clarify conflicting priorities and preserve explicit model choices.
- Select Seedance 2.5 text, first-frame image or reference generation according to the intended role of the inputs. Keep dedicated lip-sync and digital-human workflows separate.
- Refresh the bundled GPT Image 2.5 and Seedance 2.5 parameter contracts and reject incompatible inputs before submitting a generation request.
- Replace Seedance 2.0 defaults for new generation while retaining its six variants for explicit user selection; existing tasks remain resumable without resubmission. Unavailable models never trigger an automatic fallback.
- Treat strict first/last-frame control, source-preserving edits and video extension as requiring separate capability verification; model selection alone does not establish support.

## 0.3.0 — 2026-09-23

- Split D1 audio and speech processing, D2 music generation, E1 multimodal understanding, and E2 document conversion into separate Skills.
- Add default model planning for `speech-2.8-hd`, `paraformer-v2`, `lyria-3-pro`, `lyria-3-pro-preview`, `gemini-3.1-pro-preview`, `gemini-3.5-flash`, and `doc2x-v3`.
- Add LLM task results, Gemini native music inline audio, and Doc2X ZIP validation to the shared CLI.
- Add WorkBuddy/CodeBuddy manifests and marketplace registration.
- Remove B10 video upscaling from the current scope and regression target.


## 0.2.0 — 2026-09-22

- Restrict image workflows to A1/A2 and expose `gpt-image-2.5-flare` and `gpt-image-2.5-sunburst` in the bundled catalog.
- Add Seedance 2.0 standard and fast model IDs, C1/C2 digital-human model variants, and explicit rejection for excluded profile, subtitle, interpolation, Sora-character and voice-creation tasks.
- Preserve task-specific result metadata such as seeds, lyrics, degradation reasons and output types in normal CLI results.
- Update image/video Skill instructions for the confirmed scope and document the Seedance 2.5 replacement condition.

## 0.1.0 — 2026-09-15

- Add `aihub-image`, `aihub-video`, and `aihub-audio` for image generation/editing, video generation, music, and text-to-speech.
- Share one CLI for configuration, model discovery, parameter descriptions, uploads, generation, task recovery, and verified downloads.
- Persist task records outside the installation so interrupted queries and downloads can resume without submitting another generation request.
- Package native Claude Code and Codex manifests, compiled JavaScript, and the model catalog in one Plugin directory.
- Support caller-specific `.env.<skill-name>` configuration before shared project configuration; home configuration requires an explicit flag.
