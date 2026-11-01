# AI Assistant and Motion Studio architecture

> Status: in progress, 2026-11-01. The motion document model, undoable engine commands and an
> initial Motion Studio side panel are implemented. Playback, render evaluation, graph editing,
> export and the AI provider transport remain future milestones.

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

1. The user opens the Assistant panel and chooses a provider/model.
2. The assistant receives a compact context snapshot: selected node ids, selected layer properties,
   page outline, active composition and relevant timeline state. It does not upload the whole file
   by default.
3. The model responds with either normal text or a typed list of proposed editor operations.
4. Undesign validates the operation schema, target ids, numeric bounds and permissions.
5. A preview lists the exact layers and properties that will change. The user can apply or discard.
6. Accepted operations run as one engine batch and one undo step. The assistant reports the result.

### Tool surface

The initial tool set should stay deliberately small:

- `document.inspect`: read the current page, selected layers and their relevant properties.
- `selection.inspect`: read selected ids and bounding boxes.
- `node.create`: create supported shapes, text and frames.
- `node.set`: change allow-listed properties on existing nodes.
- `node.move` / `node.reparent`: arrange layers with cycle and bounds validation.
- `style.create`: create reusable colours and text styles.
- `motion.inspect`: inspect a composition and its tracks.
- `motion.keyframe`: add or update a keyframe through the engine command layer.

The model must not receive arbitrary filesystem, shell, network or plugin execution. It cannot bypass
engine validation by writing serialized document JSON directly.

### Provider and credential architecture

Provider adapters should live outside `undesign-doc` and `undesign-engine`; those crates remain
pure document and command logic. The UI talks to an AI transport abstraction that supports streamed
messages and structured tool calls.

- Desktop: store credentials in the operating system credential store; never in plain preferences.
- Browser: use an authenticated server-side relay for persistent credentials. A session-only
  bring-your-own-key option may be offered with an explicit warning, but keys must not be persisted
  in browser storage or sent to analytics.
- Self-hosted: allow an administrator to configure a compatible gateway endpoint and provider
  credentials on the server.
- All requests use TLS, bounded timeouts, request-size limits and redacted error reporting.
- Provider/model catalogues are fetched dynamically and cached without credentials.
- No default provider is silently selected and no API usage occurs before the user configures it.

The repository is currently a Rust/egui application with a WASM browser build, not a Next.js server.
Do not add a JavaScript AI SDK or expose provider secrets in the WASM bundle just to make the first
chat panel appear. First choose and implement the transport boundary for both native and browser
targets; then add provider adapters.

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
- **M14.3 Timeline UI:** in progress. Initial Motion tab supports composition creation, track creation,
  playhead scrubbing, numeric keyframe entry and clickable keyframe rows. Docking, playback and a
  render-only evaluated scene are still required.
- **M14.4 Graph editor:** Bezier editing and interpolation preview.
- **M14.5 Export:** image sequence, then browser/native video encoders.
- **M13.1 AI foundation:** provider configuration and secure credential storage for desktop and
  browser relay.
- **M13.2 AI chat:** streamed conversation, model picker and document-aware context.
- **M13.3 AI editor tools:** typed operation proposals, preview/apply, command batching and undo.
- **M13.4 AI motion assistant:** generate and revise timeline tracks and keyframes.

## Acceptance criteria

- Existing documents without motion open and save unchanged in meaning.
- Motion documents round-trip through the native format and reject invalid timelines without panic.
- Playback does not mutate the source document or create undo entries.
- Every AI edit is a validated command, previewable, undoable and limited to explicit user-approved
  scope.
- API keys never appear in `.undesign`, exports, logs or browser persistent storage.
- The same document can be edited manually after AI-generated changes.
