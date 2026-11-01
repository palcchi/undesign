# Agent (hackathon track)

Prompt-to-animation loop for the Meta hackathon: the user types a prompt, Muse Spark
returns a JSON plan of engine commands, the core validates and applies it as one undo
step. Demo flow: shapes appear on the canvas, keyframes land on the Motion timeline,
everything stays editable and playable afterwards.

## Model API (verified against the official docs)

Inspected at <https://dev.meta.ai/docs/quickstart> and
<https://dev.meta.ai/docs/protocols/chat-completions> on 2026-11-01:

- Base URL `https://api.meta.ai/v1`, model id `muse-spark-1.3`.
- `POST /v1/chat/completions`, OpenAI-compatible; auth is
  `Authorization: Bearer $MODEL_API_KEY` (key from dev.meta.ai).
- Structured output via `response_format`, tool calling via `tools`/`tool_choice`.
- The browser never calls Meta directly (see below), so CORS is moot. The
  `meta/muse-spark-1.3` id form is the Vercel AI Gateway namespacing, kept as the
  documented fallback behind the provider trait.

## Architecture

- `crates/agent` (L6, shared native + wasm, no UI, no network): whitelist (14
  commands), registry-derived prompt docs, plan parsing, validation + clamping,
  minimal context (canvas size, selection, layer names, compositions), the
  poll-based `Provider` trait, and the turn driver (one retry on unusable JSON,
  atomic apply through `command.batch`).
- Provider boundary: `MetaModelApi` builds an OpenAI-compatible structured-output request
  for a user-owned endpoint and injects a native or browser `ModelTransport`; `Replay`
  contains five deterministic demo prompts and is network-free. `FallbackProvider`
  switches to Replay when the configured provider fails.
- Key safety: `ProviderConfig` keeps the user key in memory and redacts it from `Debug`.
  The WASM and desktop adapters still need to provide the actual HTTP transport. Do not
  persist a key in the document, logs or diagnostics. A UI may add explicit session-only
  storage later, but the default remains BYO key per session.
- The provider request uses the configured model, system prompt, user context, bounded
  `max_tokens`, and `response_format: {type: "json_object"}`. The core does not assume
  a shared demo key or silently select a provider.
- The current Agent panel is wired to `Replay` so the five demo prompts work without
  network access. It shows the applied command ids and offers one undo action per turn.
  Live provider configuration and HTTP transport remain separate follow-up work.
- Playback after a turn is set by the Agent panel itself (`motion.timeline`-style UI
  state); no motion files change for the agent.

## Whitelist

`shape.rectangle`, `shape.ellipse`, `text.create`, `node.set`, `node.get`,
`fill.set`, `transform.moveTo`, `transform.resize`, `motion.composition.create`,
`motion.track.add`, `motion.keyframe.set`, `motion.keyframe.move`,
`motion.keyframe.remove`, `motion.track.remove`. Labels and parameter docs ship from
the live engine registry; a renamed command fails closed.
