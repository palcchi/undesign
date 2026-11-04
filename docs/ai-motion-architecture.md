# AI Assistant and Motion Studio architecture

> Status: in progress, 2026-11-03. The motion document model, undoable engine commands, a dockable
> Motion timeline, frame-accurate playback and a render-only canvas preview are implemented. The
> Agent now loads the Design and Motion skill contracts through a session-only OpenAI-compatible
> Chat Completions adapter on desktop. Browser transport, OS credential-store integration, streaming,
> model discovery, graph editing and export remain future work.

Undesign is evolving from a static interface editor into an AI-assisted design and motion workspace.
The design engine remains the source of truth: AI and timeline tools must edit the same document
that a person can inspect and change manually.

## Product principles

- **Editable output:** AI creates and edits real Undesign layers and properties, not flattened
  screenshots. Generated raster artwork may be an asset, but layout, text, shapes and transforms
  remain editable.
- **One document model:** static design, compositions, tracks and keyframes are saved together in
  `.undesign`. Files without motion keep the motion section omitted.
- **Commands are the boundary:** every AI edit and timeline edit becomes a validated engine command,
  so undo/redo, scripting, audit history and future collaboration use the same path.
- **Provider-neutral:** users can choose a supported provider, model and compatible endpoint. Model
  identifiers are discovered from the configured provider or gateway, not hard-coded as a permanent
  catalogue.
- **Secrets stay out of files:** API keys must never be written into a design document, command
  journal, diagnostics, logs, screenshots or exported assets.
- **Human control:** preview proposed operations, scope edits to the current selection when possible,
  and require confirmation for destructive or broad changes. Every accepted AI edit is undoable.
- **No copied product assets:** the interface and icons remain original Undesign work.

## AI Assistant

### Intended workflow

1. Each user connects their own provider and model. The Assistant panel shows that user's connection
   state; there is no shared or silently selected default provider, and no request is sent before
   that user connects.
2. The assistant receives a compact context snapshot: selected node ids, selected layer properties,
   page outline, active composition and relevant timeline state. It does not upload the whole file
   by default.
3. The model responds with either normal text or a typed list of proposed editor operations.
4. Undesign validates the operation schema, target ids, numeric bounds and permissions.
5. A preview lists the exact layers and properties that will change. The user can apply or discard.
6. Accepted operations run as one engine batch and one undo step. The assistant reports the result.

### Agent skills: Design and Motion

[`assistant-skills/design.md`](assistant-skills/design.md) defines the Design skill for editable
interface work. [`assistant-skills/motion.md`](assistant-skills/motion.md) defines the separate
Motion skill for compositions, property tracks, and keyframes. The backend skill catalog supplies
the selected skill instructions and allowed tools to the current chat request. Each user enters an
endpoint, model ID, and key for the current desktop session. Only the existing tool allow-list is
reachable from chat; unsupported design and Motion operations are not advertised.

### Tool surface

The initial tool set should stay deliberately small:

- `document.inspect`: read the current page, selected layers and their relevant properties.
- `selection.inspect`: read selected ids and bounding boxes.
- `node.create`: create supported shapes, text and frames.
- `node.set`: change allow-listed properties on existing nodes.
- `motion.inspect`: inspect a composition and its tracks.
- `motion.composition.create`: create a composition after user approval.
- `motion.track.add`: add a supported property track.
- `motion.keyframe.set`: set a bounded keyframe.

This is the current backend allow-list. Layer arrangement, reusable style creation, and Motion track
or keyframe removal/moving remain future tools and must not be advertised as available.

The model must not receive arbitrary filesystem, shell, network or plugin execution. It cannot bypass
engine validation by writing serialized document JSON directly.

### Provider and credential architecture

Provider adapters live outside `undesign-doc` and `undesign-engine`; those crates remain pure
document and command logic. The platform service boundary accepts a request only after the current
user configures a provider.

The initial native adapter is deliberately limited:

- The user supplies a full OpenAI-compatible Chat Completions URL, model ID, and API key. There is no
  built-in provider, default model, model catalogue, provider-specific OAuth, or claim of universal
  compatibility.
- The Connect action stores settings in the current desktop process only. It does not probe the URL;
  the first network request happens only after the user presses Send. Responses are non-streamed.
- The key is held in zeroizing process memory and is not written to `state.json`, preferences,
  document files, logs, or command arguments. The transport passes its curl configuration through
  stdin, disables redirects, bounds request and response sizes, and uses verified HTTPS for remote
  providers. Plain HTTP is accepted only for localhost or a loopback IP.
- No OS credential-store integration is present in the current repository. The key is cleared when
  the desktop service is disconnected or the process exits; this is session-only storage, not a
  persistent keychain solution.
- The browser connection UI is disabled until a secure server-side relay exists. The WASM app does
  not accept or store a long-lived provider key.
- Each request contains the conversation, the selected skill's instructions and tools, plus the
  bounded current-page context. Chat history stays in memory and is cleared when the user changes
  pages. A response tied to an older document revision is discarded.
- Typed calls pass through `AgentBackend::prepare`. Mutations remain proposals until explicit user
  approval; apply runs one validated batch and one undo step. Rejection and stale-proposal paths do
  not mutate the document.

Self-hosted gateways, streamed responses, credential-store persistence, model discovery, and
provider-specific adapters remain separate future work. Do not add a JavaScript AI SDK or expose
provider secrets in the WASM bundle to fill the browser gap.

## Motion Studio

### Document model

The first data-model slice is in `undesign-doc::motion`:

- A document can contain independent compositions.
- A composition defines dimensions, frame rate and duration in frames.
- An animation track targets a document node and one supported property.
- Keyframes store a frame, numeric value and outgoing interpolation.
- Initial interpolation modes are Step, Linear and Cubic Bezier.
- The initial property set is position X/Y, rotation, scale X/Y, opacity and width/height.

The model must validate frame rate, composition size/duration, finite values, keyframe ordering,
duration bounds and Bezier control points. Old documents deserialize with an empty motion model.

### Engine and UI sequence

1. Composition commands: create, rename, resize, set frame rate/duration and delete.
2. Track commands: add/remove/enable tracks and target supported node properties.
3. Keyframe commands: add, update, move and delete keyframes; each operation is undoable.
4. Timeline panel: layer rows, property disclosure, ruler, playhead, zoom and snapping.
5. Playback evaluator: sample tracks at a frame and apply evaluated values to a render-only scene
   snapshot, never mutating the saved base design on every playback tick.
6. Graph editor: inspect and edit Bezier handles, with deterministic interpolation tests.
7. Effects and compositing: animated masks, effect parameters, parenting, precompositions and blend
   modes after the core transform pipeline is stable.
8. Export: deterministic image sequence first; add WebM/MP4 through platform/browser encoders after
   validating codec availability and memory limits. Audio tracks follow video export.

### Rendering boundary

Animation evaluation produces an ephemeral render state from the saved document plus a composition
and frame. The normal renderer remains the pixel source for the canvas and exports. Playback must
not create undo entries, mark the document dirty on every frame, or change the saved base properties.

## First milestones

- **M14.1 Motion data model:** done. Serializable compositions, tracks, keyframes, interpolation,
  validation and backwards-compatible document decoding.
- **M14.2 Motion commands:** first slice done. Undoable composition creation/deletion, track add/remove,
  keyframe set/remove and inspection; command tests cover undo and validation.
- **M14.3 Timeline UI:** playback slice done. The Motion tab plays and loops at the composition's
  fps with a time readout; while it is active the canvas renders the composition evaluated at the
  playhead without touching the saved document, creating undo entries or marking it dirty.
  Selection outlines and hit-testing stay on base values. A dockable timeline and auto-keyframing
  from canvas edits remain; bezier editing is M14.4.
- **M14.4 Graph editor:** Bezier editing and interpolation preview.
- **M14.5 Export:** image sequence, then browser/native video encoders.
- **M13.1 AI foundation:** initial desktop setup and OpenAI-compatible adapter are implemented with
  session-only credentials. OS credential-store integration and a secure browser relay remain open.
- **M13.2 AI chat:** non-streamed chat with a manually entered model and current-page context is
  implemented. Provider-specific formats and model discovery remain open.
- **M13.3 AI editor tools:** the Design and Motion allow-lists feed typed proposals; the user must
  approve a proposal before one-batch apply and undo. Stale proposals are rejected.
- **M13.4 AI motion assistant:** the Motion skill is wired to its current inspection and mutation
  tools. Track deletion, rearrangement, and other unsupported operations remain unavailable.

## Acceptance criteria

- Existing documents without motion open and save unchanged in meaning.
- Motion documents round-trip through the native format and reject invalid timelines without panic.
- Playback does not mutate the source document or create undo entries.
- Every AI edit is a validated command, previewable, undoable and limited to explicit user-approved
  scope.
- Provider requests occur only after a user configures an endpoint and presses Send; no shared or
  default provider is used.
- The Design and Motion skills use only supplied current-page context and their allow-listed tools;
  every mutation requires an explicit proposal approval and remains undoable.
- API keys never appear in `.undesign`, exports, logs, command arguments, preferences, `state.json`,
  or browser storage. Desktop credentials remain session-only until keychain support exists.
- Browser provider setup stays disabled until the app has a secure server-side relay.
- The same document can be edited manually after AI-generated changes.
