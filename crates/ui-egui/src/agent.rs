use std::collections::BTreeSet;
use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use undesign_engine::doc::{AnimatedProperty, Composition, Document, Interpolation, Keyframe, NodeId, NodeKind};
use undesign_engine::{EngineError, Session};

const MAX_MESSAGES: usize = 100;
const MAX_MESSAGE_BYTES: usize = 16_384;
const MAX_TOOL_CALLS: usize = 16;
const MAX_TOOL_ARGUMENT_BYTES: usize = 16_384;
const MAX_CONTEXT_BYTES: usize = 32_768;
const MAX_OUTLINE_NODES: usize = 32;
const MAX_OUTLINE_DEPTH: usize = 4;
const MAX_SELECTED_NODES: usize = 8;
const DESIGN_SKILL_INSTRUCTIONS: &str = include_str!("../../../docs/assistant-skills/design.md");
const MOTION_SKILL_INSTRUCTIONS: &str = include_str!("../../../docs/assistant-skills/motion.md");

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentError(String);

impl AgentError {
    fn invalid(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for AgentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for AgentError {}

impl From<EngineError> for AgentError {
    fn from(error: EngineError) -> Self {
        Self(error.to_string())
    }
}

pub type AgentResult<T> = Result<T, AgentError>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AgentToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AgentMessage {
    pub role: AgentRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<AgentToolCall>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// In-memory chat history; external messages must enter through `push` so the bounds are enforced.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct AgentConversation {
    messages: Vec<AgentMessage>,
}

impl AgentConversation {
    pub fn messages(&self) -> &[AgentMessage] {
        &self.messages
    }

    pub fn push(&mut self, message: AgentMessage) -> AgentResult<()> {
        if message.content.len() > MAX_MESSAGE_BYTES {
            return Err(AgentError::invalid("message exceeds the Agent conversation size limit"));
        }
        if message.tool_calls.len() > MAX_TOOL_CALLS {
            return Err(AgentError::invalid("message contains too many tool calls"));
        }
        let encoded = serde_json::to_vec(&message).map_err(|error| AgentError::invalid(error.to_string()))?;
        if encoded.len() > MAX_MESSAGE_BYTES {
            return Err(AgentError::invalid("message exceeds the Agent conversation size limit"));
        }
        if self.messages.len() == MAX_MESSAGES {
            self.messages.remove(0);
        }
        self.messages.push(message);
        Ok(())
    }

    pub fn clear(&mut self) {
        self.messages.clear();
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AgentToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AgentSkill {
    pub id: String,
    pub label: String,
    pub description: String,
    pub instructions: String,
    pub allowed_tools: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AgentToolResult {
    pub call_id: String,
    pub name: String,
    pub result: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AgentChange {
    pub call_id: String,
    pub tool: String,
    pub summary: String,
    pub targets: Vec<NodeId>,
    pub details: Value,
}

struct PreparedOperation {
    command: &'static str,
    params: Value,
    change: AgentChange,
}

pub struct AgentProposal {
    document_uid: u64,
    revision: u64,
    page: NodeId,
    operations: Vec<PreparedOperation>,
}

impl AgentProposal {
    pub fn changes(&self) -> Vec<&AgentChange> {
        self.operations.iter().map(|operation| &operation.change).collect()
    }

    pub fn is_empty(&self) -> bool {
        self.operations.is_empty()
    }

    pub fn is_current(&self, session: &Session) -> bool {
        session.ds().is_ok_and(|state| state.uid == self.document_uid && state.revision == self.revision && state.page == self.page)
    }
}

#[derive(Default)]
pub struct AgentTurn {
    pub results: Vec<AgentToolResult>,
    pub proposal: Option<AgentProposal>,
}

pub struct AgentBackend;

impl AgentBackend {
    pub fn skills() -> Vec<AgentSkill> {
        vec![
            AgentSkill {
                id: "design".to_string(),
                label: "Design".to_string(),
                description: "Plan and refine editable static designs.".to_string(),
                instructions: DESIGN_SKILL_INSTRUCTIONS.to_string(),
                allowed_tools: ["document.inspect", "selection.inspect", "node.create", "node.set"].map(str::to_string).to_vec(),
            },
            AgentSkill {
                id: "motion".to_string(),
                label: "Motion".to_string(),
                description: "Create or refine animation in validated Motion compositions.".to_string(),
                instructions: MOTION_SKILL_INSTRUCTIONS.to_string(),
                allowed_tools: [
                    "document.inspect",
                    "selection.inspect",
                    "motion.inspect",
                    "motion.composition.create",
                    "motion.track.add",
                    "motion.keyframe.set",
                ]
                .map(str::to_string)
                .to_vec(),
            },
        ]
    }

    pub fn skill(skill_id: &str) -> AgentResult<AgentSkill> {
        Self::skills().into_iter().find(|skill| skill.id == skill_id).ok_or_else(|| AgentError::invalid(format!("unknown Agent skill `{skill_id}`")))
    }

    pub fn tool_definitions_for(skill_id: &str) -> AgentResult<Vec<AgentToolDefinition>> {
        let allowed = Self::skill(skill_id)?.allowed_tools.into_iter().collect::<BTreeSet<_>>();
        Ok(Self::all_tool_definitions().into_iter().filter(|tool| allowed.contains(&tool.name)).collect())
    }

    fn all_tool_definitions() -> Vec<AgentToolDefinition> {
        vec![
            tool(
                "document.inspect",
                "Read a compact outline of the current page, selection, and Motion compositions.",
                object_schema(json!({}), vec![]),
            ),
            tool("selection.inspect", "Read the selected layers and their editable properties.", object_schema(json!({}), vec![])),
            tool(
                "motion.inspect",
                "Read Motion compositions and tracks, optionally limited to one composition.",
                object_schema(
                    json!({
                        "compositionId": {"type": "integer", "minimum": 1}
                    }),
                    vec![],
                ),
            ),
            tool(
                "node.create",
                "Propose a frame, rectangle, ellipse, or text layer on the current page.",
                object_schema(
                    json!({
                        "type": {"type": "string", "enum": ["frame", "rectangle", "ellipse", "text"]},
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                        "width": {"type": "number", "exclusiveMinimum": 0},
                        "height": {"type": "number", "exclusiveMinimum": 0},
                        "parent": {"type": "integer", "minimum": 1},
                        "name": {"type": "string", "maxLength": 128},
                        "text": {"type": "string", "maxLength": 8192}
                    }),
                    vec!["type"],
                ),
            ),
            tool(
                "node.set",
                "Propose changes to a small allow-list of visual and text properties.",
                object_schema(
                    json!({
                        "ids": {"type": "array", "minItems": 1, "maxItems": 32, "items": {"type": "integer", "minimum": 1}},
                        "props": {"type": "object", "minProperties": 1, "additionalProperties": false, "properties": {
                            "name": {"type": "string", "maxLength": 128},
                            "x": {"type": "number"},
                            "y": {"type": "number"},
                            "width": {"type": "number", "exclusiveMinimum": 0},
                            "height": {"type": "number", "exclusiveMinimum": 0},
                            "rotation": {"type": "number"},
                            "opacity": {"type": "number", "minimum": 0, "maximum": 1},
                            "visible": {"type": "boolean"},
                            "fill": {"type": "string", "maxLength": 64},
                            "cornerRadius": {"type": "number", "minimum": 0},
                            "characters": {"type": "string", "maxLength": 8192},
                            "fontSize": {"type": "number", "exclusiveMinimum": 0},
                            "fontFamily": {"type": "string", "maxLength": 128},
                            "textAlign": {"type": "string"}
                        }}
                    }),
                    vec!["ids", "props"],
                ),
            ),
            tool(
                "motion.composition.create",
                "Propose a new Motion composition.",
                object_schema(
                    json!({
                        "name": {"type": "string", "maxLength": 128},
                        "width": {"type": "integer", "minimum": 1, "maximum": 16384},
                        "height": {"type": "integer", "minimum": 1, "maximum": 16384},
                        "fps": {"type": "integer", "minimum": 1, "maximum": 240},
                        "durationFrames": {"type": "integer", "minimum": 1, "maximum": 1000000}
                    }),
                    vec![],
                ),
            ),
            tool(
                "motion.track.add",
                "Propose an animation track for a layer property.",
                object_schema(
                    json!({
                        "compositionId": {"type": "integer", "minimum": 1},
                        "target": {"type": "integer", "minimum": 1},
                        "property": {"type": "string", "enum": ["positionX", "positionY", "rotation", "scaleX", "scaleY", "opacity", "width", "height"]}
                    }),
                    vec!["compositionId", "target", "property"],
                ),
            ),
            tool(
                "motion.keyframe.set",
                "Propose a numeric keyframe on an existing Motion track.",
                object_schema(
                    json!({
                        "compositionId": {"type": "integer", "minimum": 1},
                        "trackId": {"type": "integer", "minimum": 1},
                        "frame": {"type": "integer", "minimum": 0},
                        "value": {"type": "number"},
                        "interpolation": {"oneOf": [
                            {"type": "string", "enum": ["step", "linear"]},
                            {"type": "object", "additionalProperties": false, "properties": {
                                "type": {"const": "cubicBezier"},
                                "x1": {"type": "number", "minimum": 0, "maximum": 1},
                                "y1": {"type": "number"},
                                "x2": {"type": "number", "minimum": 0, "maximum": 1},
                                "y2": {"type": "number"}
                            }, "required": ["type", "x1", "y1", "x2", "y2"]}
                        ]}
                    }),
                    vec!["compositionId", "trackId", "frame", "value"],
                ),
            ),
        ]
    }

    pub fn context(session: &Session) -> AgentResult<Value> {
        let state = session.ds()?;
        let page_id = state.page;
        let doc = state.doc.as_ref();
        let page = doc.node(page_id).ok_or_else(|| AgentError::invalid("the current page is missing"))?;
        let mut remaining = MAX_OUTLINE_NODES;
        let outline = outline_node(doc, page_id, 0, &mut remaining);
        let selected = state
            .selection
            .iter()
            .take(MAX_SELECTED_NODES)
            .filter(|id| is_on_page(doc, page_id, **id))
            .map(|id| selected_node(doc, *id))
            .collect::<Vec<_>>();
        let value = json!({
            "document": doc.name,
            "page": {"id": page_id.0, "name": page.name},
            "outline": outline,
            "selection": selected,
            "motion": motion_summary(doc, page_id, None)
        });
        let encoded = serde_json::to_vec(&value).map_err(|error| AgentError::invalid(error.to_string()))?;
        if encoded.len() > MAX_CONTEXT_BYTES {
            return Err(AgentError::invalid("the current page context exceeds the Agent size limit; select fewer layers or simplify the page"));
        }
        Ok(value)
    }

    pub fn prepare(session: &Session, skill_id: &str, calls: &[AgentToolCall]) -> AgentResult<AgentTurn> {
        if calls.len() > MAX_TOOL_CALLS {
            return Err(AgentError::invalid("too many Agent tool calls in one turn"));
        }
        let skill = Self::skill(skill_id)?;
        let mut seen = BTreeSet::new();
        let mut results = Vec::new();
        let mut operations = Vec::new();
        for call in calls {
            if call.id.is_empty() || call.id.len() > 128 || !seen.insert(call.id.as_str()) {
                return Err(AgentError::invalid("tool call ids must be unique, non-empty, and at most 128 bytes"));
            }
            let encoded = serde_json::to_vec(&call.arguments).map_err(|error| AgentError::invalid(error.to_string()))?;
            if encoded.len() > MAX_TOOL_ARGUMENT_BYTES {
                return Err(AgentError::invalid("tool arguments exceed the Agent size limit"));
            }
            if !skill.allowed_tools.iter().any(|tool| tool == &call.name) {
                return Err(AgentError::invalid(format!("tool `{}` is not enabled for the `{skill_id}` skill", call.name)));
            }
            match call.name.as_str() {
                "document.inspect" => results.push(tool_result(call, Self::context(session)?)),
                "selection.inspect" => results.push(tool_result(call, inspect_selection(session)?)),
                "motion.inspect" => results.push(tool_result(call, inspect_motion(session, &call.arguments)?)),
                "node.create" => operations.push(prepare_node_create(session, call)?),
                "node.set" => operations.push(prepare_node_set(session, call)?),
                "motion.composition.create" => operations.push(prepare_composition(session, call)?),
                "motion.track.add" => operations.push(prepare_track(session, call)?),
                "motion.keyframe.set" => operations.push(prepare_keyframe(session, call)?),
                other => return Err(AgentError::invalid(format!("tool `{other}` is not available to the Agent"))),
            }
        }
        let proposal = if operations.is_empty() {
            None
        } else {
            let state = session.ds()?;
            Some(AgentProposal { document_uid: state.uid, revision: state.revision, page: state.page, operations })
        };
        Ok(AgentTurn { results, proposal })
    }

    pub fn apply(session: &mut Session, proposal: &AgentProposal, user_approved: bool) -> AgentResult<Value> {
        if !user_approved {
            return Err(AgentError::invalid("the user must approve an Agent proposal before it can be applied"));
        }
        if proposal.operations.is_empty() || proposal.operations.len() > MAX_TOOL_CALLS {
            return Err(AgentError::invalid("the Agent proposal is empty or exceeds the operation limit"));
        }
        let state = session.ds()?;
        if state.uid != proposal.document_uid || state.revision != proposal.revision || state.page != proposal.page {
            return Err(AgentError::invalid(
                "the document or page changed after this proposal was prepared; inspect the updated document and prepare it again",
            ));
        }
        let commands =
            proposal.operations.iter().map(|operation| json!({"command": operation.command, "params": operation.params})).collect::<Vec<_>>();
        session.execute("command.batch", &json!({"label": "Agent changes", "commands": commands})).map_err(AgentError::from)
    }

    pub fn applied_results(proposal: &AgentProposal, batch_result: &Value) -> AgentResult<Vec<AgentToolResult>> {
        let results = batch_result.as_array().ok_or_else(|| AgentError::invalid("the editor returned an invalid Agent batch result"))?;
        if results.len() != proposal.operations.len() {
            return Err(AgentError::invalid("the editor result does not match the Agent proposal"));
        }
        Ok(proposal
            .operations
            .iter()
            .zip(results)
            .map(|(operation, result)| AgentToolResult {
                call_id: operation.change.call_id.clone(),
                name: operation.change.tool.clone(),
                result: result.clone(),
            })
            .collect())
    }
}

fn tool(name: &str, description: &str, input_schema: Value) -> AgentToolDefinition {
    AgentToolDefinition { name: name.to_string(), description: description.to_string(), input_schema }
}

fn object_schema(properties: Value, required: Vec<&str>) -> Value {
    json!({"type": "object", "properties": properties, "required": required, "additionalProperties": false})
}

fn tool_result(call: &AgentToolCall, result: Value) -> AgentToolResult {
    AgentToolResult { call_id: call.id.clone(), name: call.name.clone(), result }
}

fn inspect_selection(session: &Session) -> AgentResult<Value> {
    let state = session.ds()?;
    let doc = state.doc.as_ref();
    let ids = state.selection.iter().take(MAX_SELECTED_NODES).filter(|id| is_on_page(doc, state.page, **id));
    Ok(Value::Array(ids.map(|id| selected_node(doc, *id)).collect()))
}

fn inspect_motion(session: &Session, arguments: &Value) -> AgentResult<Value> {
    let state = session.ds()?;
    let doc = state.doc.as_ref();
    let composition_id = match arguments.get("compositionId") {
        None => None,
        Some(Value::Number(number)) => number.as_u64(),
        Some(_) => return Err(AgentError::invalid("`compositionId` must be a non-negative integer")),
    };
    if arguments.get("compositionId").is_some() && composition_id.is_none() {
        return Err(AgentError::invalid("`compositionId` must be a non-negative integer"));
    }
    if let Some(id) = composition_id
        && !doc.motion.compositions.iter().any(|composition| composition.id == id)
    {
        return Err(AgentError::invalid("no such Motion composition"));
    }
    if let Some(id) = composition_id {
        let Some(composition) = doc.motion.compositions.iter().find(|composition| composition.id == id) else {
            return Err(AgentError::invalid("no such Motion composition"));
        };
        if !composition.tracks.is_empty() && !composition.tracks.iter().any(|track| is_on_page(doc, state.page, track.target)) {
            return Err(AgentError::invalid("Motion composition has no tracks on the current page"));
        }
    }
    Ok(motion_summary(doc, state.page, composition_id))
}

fn outline_node(doc: &Document, id: NodeId, depth: usize, remaining: &mut usize) -> Value {
    if *remaining == 0 {
        return Value::Null;
    }
    let Some(node) = doc.node(id) else { return Value::Null };
    *remaining -= 1;
    let children = node.children.clone();
    let mut value = json!({
        "id": id.0,
        "name": clipped(&node.name, 128),
        "type": node.kind.type_name(),
        "visible": node.visible,
        "locked": node.locked
    });
    if !node.is_page() {
        let transform = doc.frame_relative(id).as_coeffs();
        if transform[4].is_finite() && transform[5].is_finite() {
            value["x"] = json!(transform[4]);
            value["y"] = json!(transform[5]);
        }
        value["width"] = json!(node.width);
        value["height"] = json!(node.height);
        value["opacity"] = json!(node.opacity);
    }
    if !children.is_empty() {
        if depth >= MAX_OUTLINE_DEPTH || *remaining == 0 {
            value["childCount"] = json!(children.len());
            value["truncated"] = json!(true);
        } else {
            let mut rendered = Vec::new();
            for child in &children {
                if *remaining == 0 {
                    value["truncated"] = json!(true);
                    break;
                }
                rendered.push(outline_node(doc, *child, depth + 1, remaining));
            }
            value["children"] = Value::Array(rendered);
        }
    }
    value
}

fn selected_node(doc: &Document, id: NodeId) -> Value {
    let mut value = undesign_engine::inspect::node_json(doc, id, 0);
    if let Some(object) = value.as_object_mut() {
        for key in
            ["pluginData", "overrides", "interactions", "devResources", "codeLinks", "measurements", "annotations", "board", "exports", "grids"]
        {
            object.remove(key);
        }
    }
    trim_strings(&mut value, 2048);
    value
}

fn trim_strings(value: &mut Value, limit: usize) {
    match value {
        Value::String(text) => {
            if text.len() > limit {
                *text = clipped(text, limit);
            }
        }
        Value::Array(items) => items.iter_mut().for_each(|item| trim_strings(item, limit)),
        Value::Object(items) => items.values_mut().for_each(|item| trim_strings(item, limit)),
        _ => {}
    }
}

fn clipped(text: &str, limit: usize) -> String {
    let mut chars = text.chars();
    let prefix = chars.by_ref().take(limit).collect::<String>();
    if chars.next().is_some() { format!("{prefix}…") } else { prefix }
}

fn motion_summary(doc: &Document, page: NodeId, requested: Option<u64>) -> Value {
    let available = doc
        .motion
        .compositions
        .iter()
        .filter(|composition| requested.is_none_or(|id| composition.id == id))
        .filter(|composition| composition.tracks.is_empty() || composition.tracks.iter().any(|track| is_on_page(doc, page, track.target)))
        .collect::<Vec<_>>();
    let compositions = available
        .iter()
        .take(3)
        .map(|composition| {
            let visible_tracks = composition.tracks.iter().filter(|track| is_on_page(doc, page, track.target)).collect::<Vec<_>>();
            let tracks = visible_tracks
                .iter()
                .take(8)
                .map(|track| {
                    let keyframes = track
                        .keyframes
                        .iter()
                        .take(12)
                        .map(|keyframe| json!({"frame": keyframe.frame, "value": keyframe.value, "interpolation": keyframe.interpolation}))
                        .collect::<Vec<_>>();
                    json!({
                        "id": track.id,
                        "target": track.target.0,
                        "property": track.property,
                        "enabled": track.enabled,
                        "keyframes": keyframes,
                        "keyframesTruncated": track.keyframes.len() > 12
                    })
                })
                .collect::<Vec<_>>();
            json!({
                "id": composition.id,
                "name": clipped(&composition.name, 128),
                "width": composition.width,
                "height": composition.height,
                "fps": composition.fps,
                "durationFrames": composition.duration_frames,
                "tracks": tracks,
                "tracksTruncated": visible_tracks.len() > 8
            })
        })
        .collect::<Vec<_>>();
    json!({
        "compositions": compositions,
        "compositionsTruncated": requested.is_none() && available.len() > 3
    })
}

fn prepare_node_create(session: &Session, call: &AgentToolCall) -> AgentResult<PreparedOperation> {
    let args = call.arguments.as_object().ok_or_else(|| AgentError::invalid("`node.create` arguments must be an object"))?;
    ensure_keys(args, &["type", "x", "y", "width", "height", "parent", "name", "text"])?;
    let kind = required_string(&call.arguments, "type")?;
    if !["frame", "rectangle", "ellipse", "text"].contains(&kind.as_str()) {
        return Err(AgentError::invalid("`node.create` only supports frame, rectangle, ellipse, or text"));
    }
    for key in ["x", "y"] {
        optional_number(&call.arguments, key, -100_000.0, 100_000.0)?;
    }
    for key in ["width", "height"] {
        optional_number(&call.arguments, key, 0.001, 100_000.0)?;
    }
    if let Some(name) = call.arguments.get("name") {
        validate_text(name, "name", 128, false)?;
    }
    if let Some(text) = call.arguments.get("text") {
        validate_text(text, "text", 8192, true)?;
    }
    if kind == "text" && call.arguments.get("text").is_none() {
        return Err(AgentError::invalid("text layers need a `text` value"));
    }
    if kind != "text" && call.arguments.get("text").is_some() {
        return Err(AgentError::invalid("`text` is only valid when creating a text layer"));
    }
    let state = session.ds()?;
    let page = state.page;
    if let Some(parent) = call.arguments.get("parent") {
        let parent = parent.as_u64().map(NodeId).ok_or_else(|| AgentError::invalid("`parent` must be a positive layer id"))?;
        if !is_on_page(state.doc.as_ref(), page, parent) {
            return Err(AgentError::invalid("`parent` must be on the current page"));
        }
    }
    let mut params = call.arguments.clone();
    if let Some(object) = params.as_object_mut() {
        object.remove("type");
        object.insert("type".to_string(), json!(kind));
    }
    let name = call.arguments.get("name").and_then(Value::as_str).unwrap_or(kind.as_str());
    Ok(PreparedOperation {
        command: "node.create",
        params,
        change: AgentChange {
            call_id: call.id.clone(),
            tool: call.name.clone(),
            summary: format!("Create {kind}: {}", clipped(name, 64)),
            targets: call.arguments.get("parent").and_then(Value::as_u64).map(NodeId).into_iter().collect(),
            details: call.arguments.clone(),
        },
    })
}

fn prepare_node_set(session: &Session, call: &AgentToolCall) -> AgentResult<PreparedOperation> {
    let args = call.arguments.as_object().ok_or_else(|| AgentError::invalid("`node.set` arguments must be an object"))?;
    ensure_keys(args, &["ids", "props"])?;
    let ids_value = call.arguments.get("ids").and_then(Value::as_array).ok_or_else(|| AgentError::invalid("`ids` must be an array"))?;
    if ids_value.is_empty() || ids_value.len() > 32 {
        return Err(AgentError::invalid("`ids` must contain between 1 and 32 layer ids"));
    }
    let ids = ids_value
        .iter()
        .map(|value| value.as_u64().map(NodeId).ok_or_else(|| AgentError::invalid("each layer id must be a positive integer")))
        .collect::<AgentResult<Vec<_>>>()?;
    let props = call.arguments.get("props").and_then(Value::as_object).ok_or_else(|| AgentError::invalid("`props` must be an object"))?;
    if props.is_empty() || props.len() > 16 {
        return Err(AgentError::invalid("`props` must contain between 1 and 16 properties"));
    }
    let allowed = [
        "name",
        "x",
        "y",
        "width",
        "height",
        "rotation",
        "opacity",
        "visible",
        "fill",
        "cornerRadius",
        "characters",
        "fontSize",
        "fontFamily",
        "textAlign",
    ];
    for (key, value) in props {
        if !allowed.contains(&key.as_str()) {
            return Err(AgentError::invalid(format!("property `{key}` is not available to the Agent")));
        }
        validate_property(key, value)?;
    }
    let state = session.ds()?;
    for id in &ids {
        if !is_on_page(state.doc.as_ref(), state.page, *id) {
            return Err(AgentError::invalid(format!("layer {} is not on the current page", id.0)));
        }
        let node = state.doc.node(*id).ok_or_else(|| AgentError::invalid(format!("no such layer {}", id.0)))?;
        if ["characters", "fontSize", "fontFamily", "textAlign"].iter().any(|key| props.contains_key(*key)) && !matches!(node.kind, NodeKind::Text(_))
        {
            return Err(AgentError::invalid(format!("layer {} is not a text layer", id.0)));
        }
    }
    let fields = props.keys().cloned().collect::<Vec<_>>().join(", ");
    Ok(PreparedOperation {
        command: "node.set",
        params: call.arguments.clone(),
        change: AgentChange {
            call_id: call.id.clone(),
            tool: call.name.clone(),
            summary: format!("Update {} layer(s): {fields}", ids.len()),
            targets: ids,
            details: json!({"props": props}),
        },
    })
}

fn prepare_composition(session: &Session, call: &AgentToolCall) -> AgentResult<PreparedOperation> {
    let args = call.arguments.as_object().ok_or_else(|| AgentError::invalid("Motion composition arguments must be an object"))?;
    ensure_keys(args, &["name", "width", "height", "fps", "durationFrames"])?;
    if let Some(name) = call.arguments.get("name") {
        validate_text(name, "name", 128, false)?;
    }
    let width = optional_integer(&call.arguments, "width", 1, 16_384)?.unwrap_or(1920);
    let height = optional_integer(&call.arguments, "height", 1, 16_384)?.unwrap_or(1080);
    let fps = optional_integer(&call.arguments, "fps", 1, 240)?.unwrap_or(30);
    let duration = optional_integer(&call.arguments, "durationFrames", 1, 1_000_000)?.unwrap_or(300);
    let name = call.arguments.get("name").and_then(Value::as_str).unwrap_or("Main");
    let composition = Composition {
        id: 0,
        name: name.to_string(),
        width: width as u32,
        height: height as u32,
        fps: fps as u16,
        duration_frames: duration as u32,
        tracks: Vec::new(),
    };
    composition.validate().map_err(|error| AgentError::invalid(error.to_string()))?;
    let _ = session.ds()?;
    Ok(PreparedOperation {
        command: "motion.composition.create",
        params: call.arguments.clone(),
        change: AgentChange {
            call_id: call.id.clone(),
            tool: call.name.clone(),
            summary: format!("Create Motion composition: {}", clipped(name, 64)),
            targets: Vec::new(),
            details: json!({"name": name, "width": width, "height": height, "fps": fps, "durationFrames": duration}),
        },
    })
}

fn prepare_track(session: &Session, call: &AgentToolCall) -> AgentResult<PreparedOperation> {
    let args = call.arguments.as_object().ok_or_else(|| AgentError::invalid("Motion track arguments must be an object"))?;
    ensure_keys(args, &["compositionId", "target", "property"])?;
    let composition_id = required_u64(&call.arguments, "compositionId")?;
    let target = NodeId(required_u64(&call.arguments, "target")?);
    let property_name = required_string(&call.arguments, "property")?;
    let property = serde_json::from_value::<AnimatedProperty>(json!(property_name)).map_err(|_| AgentError::invalid("unknown Motion property"))?;
    let state = session.ds()?;
    if !is_on_page(state.doc.as_ref(), state.page, target) {
        return Err(AgentError::invalid("Motion targets must be layers on the current page"));
    }
    let composition = state
        .doc
        .motion
        .compositions
        .iter()
        .find(|composition| composition.id == composition_id)
        .ok_or_else(|| AgentError::invalid("no such Motion composition"))?;
    if composition.tracks.iter().any(|track| track.target == target && track.property == property) {
        return Err(AgentError::invalid("that Motion track already exists"));
    }
    Ok(PreparedOperation {
        command: "motion.track.add",
        params: call.arguments.clone(),
        change: AgentChange {
            call_id: call.id.clone(),
            tool: call.name.clone(),
            summary: format!("Add Motion {property_name} track to layer {}", target.0),
            targets: vec![target],
            details: json!({"compositionId": composition_id, "property": property_name}),
        },
    })
}

fn prepare_keyframe(session: &Session, call: &AgentToolCall) -> AgentResult<PreparedOperation> {
    let args = call.arguments.as_object().ok_or_else(|| AgentError::invalid("Motion keyframe arguments must be an object"))?;
    ensure_keys(args, &["compositionId", "trackId", "frame", "value", "interpolation"])?;
    let composition_id = required_u64(&call.arguments, "compositionId")?;
    let track_id = required_u64(&call.arguments, "trackId")?;
    let frame = required_u32(&call.arguments, "frame")?;
    let value = call
        .arguments
        .get("value")
        .and_then(Value::as_f64)
        .filter(|number| number.is_finite() && number.abs() <= 10_000_000.0)
        .ok_or_else(|| AgentError::invalid("`value` must be a finite number within the Agent range"))?;
    let state = session.ds()?;
    let doc = state.doc.as_ref();
    let mut composition = doc
        .motion
        .compositions
        .iter()
        .find(|composition| composition.id == composition_id)
        .cloned()
        .ok_or_else(|| AgentError::invalid("no such Motion composition"))?;
    let track = composition.tracks.iter_mut().find(|track| track.id == track_id).ok_or_else(|| AgentError::invalid("no such Motion track"))?;
    if !is_on_page(doc, state.page, track.target) {
        return Err(AgentError::invalid("Motion tracks must target layers on the current page"));
    }
    let interpolation = parse_interpolation(call.arguments.get("interpolation"))?;
    if frame > composition.duration_frames {
        return Err(AgentError::invalid("the keyframe is beyond the composition duration"));
    }
    if let Some(existing) = track.keyframes.iter_mut().find(|keyframe| keyframe.frame == frame) {
        *existing = Keyframe { frame, value, interpolation };
    } else {
        track.keyframes.push(Keyframe { frame, value, interpolation });
        track.keyframes.sort_by_key(|keyframe| keyframe.frame);
    }
    composition.validate().map_err(|error| AgentError::invalid(error.to_string()))?;
    let property = composition
        .tracks
        .iter()
        .find(|track| track.id == track_id)
        .map(|track| format!("{:?}", track.property))
        .unwrap_or_else(|| "property".to_string());
    Ok(PreparedOperation {
        command: "motion.keyframe.set",
        params: call.arguments.clone(),
        change: AgentChange {
            call_id: call.id.clone(),
            tool: call.name.clone(),
            summary: format!("Set {property} at frame {frame}"),
            targets: composition.tracks.iter().find(|track| track.id == track_id).map(|track| vec![track.target]).unwrap_or_default(),
            details: json!({"compositionId": composition_id, "trackId": track_id, "frame": frame, "value": value, "interpolation": interpolation}),
        },
    })
}

fn parse_interpolation(value: Option<&Value>) -> AgentResult<Interpolation> {
    match value {
        None | Some(Value::Null) => Ok(Interpolation::Linear),
        Some(Value::String(name)) if name.eq_ignore_ascii_case("step") => Ok(Interpolation::Step),
        Some(Value::String(name)) if name.eq_ignore_ascii_case("linear") => Ok(Interpolation::Linear),
        Some(value) => serde_json::from_value(value.clone()).map_err(|error| AgentError::invalid(format!("invalid interpolation: {error}"))),
    }
}

fn validate_property(name: &str, value: &Value) -> AgentResult<()> {
    match name {
        "name" => validate_text(value, name, 128, false),
        "characters" => validate_text(value, name, 8192, true),
        "fontFamily" => validate_text(value, name, 128, false),
        "fill" => validate_text(value, name, 64, false),
        "textAlign" => validate_text(value, name, 24, false),
        "visible" if value.is_boolean() => Ok(()),
        "opacity" => number_range(value, 0.0, 1.0, name),
        "width" | "height" | "fontSize" => number_range(value, 0.001, 100_000.0, name),
        "cornerRadius" => number_range(value, 0.0, 100_000.0, name),
        "x" | "y" | "rotation" => number_range(value, -100_000.0, 100_000.0, name),
        "visible" => Err(AgentError::invalid("`visible` must be a boolean")),
        _ => Err(AgentError::invalid(format!("property `{name}` is not available to the Agent"))),
    }
}

fn validate_text(value: &Value, name: &str, max_bytes: usize, allow_empty: bool) -> AgentResult<()> {
    let text = value.as_str().ok_or_else(|| AgentError::invalid(format!("`{name}` must be a string")))?;
    if text.len() > max_bytes || (!allow_empty && text.trim().is_empty()) {
        return Err(AgentError::invalid(format!(
            "`{name}` must be {} and at most {max_bytes} bytes",
            if allow_empty { "shorter" } else { "non-empty" }
        )));
    }
    Ok(())
}

fn number_range(value: &Value, minimum: f64, maximum: f64, name: &str) -> AgentResult<()> {
    let number =
        value.as_f64().filter(|number| number.is_finite()).ok_or_else(|| AgentError::invalid(format!("`{name}` must be a finite number")))?;
    if !(minimum..=maximum).contains(&number) {
        return Err(AgentError::invalid(format!("`{name}` must be between {minimum} and {maximum}")));
    }
    Ok(())
}

fn optional_number(value: &Value, name: &str, minimum: f64, maximum: f64) -> AgentResult<Option<f64>> {
    value
        .get(name)
        .map(|value| {
            number_range(value, minimum, maximum, name)
                .and_then(|()| value.as_f64().ok_or_else(|| AgentError::invalid(format!("`{name}` must be a number"))))
        })
        .transpose()
}

fn optional_integer(value: &Value, name: &str, minimum: u64, maximum: u64) -> AgentResult<Option<u64>> {
    value
        .get(name)
        .map(|value| {
            let integer = value.as_u64().ok_or_else(|| AgentError::invalid(format!("`{name}` must be an unsigned integer")))?;
            if !(minimum..=maximum).contains(&integer) {
                return Err(AgentError::invalid(format!("`{name}` must be between {minimum} and {maximum}")));
            }
            Ok(integer)
        })
        .transpose()
}

fn required_string(value: &Value, name: &str) -> AgentResult<String> {
    value.get(name).and_then(Value::as_str).map(str::to_string).ok_or_else(|| AgentError::invalid(format!("`{name}` must be a string")))
}

fn required_u64(value: &Value, name: &str) -> AgentResult<u64> {
    value
        .get(name)
        .and_then(Value::as_u64)
        .filter(|number| *number > 0)
        .ok_or_else(|| AgentError::invalid(format!("`{name}` must be a positive integer")))
}

fn required_u32(value: &Value, name: &str) -> AgentResult<u32> {
    value
        .get(name)
        .and_then(Value::as_u64)
        .and_then(|number| u32::try_from(number).ok())
        .ok_or_else(|| AgentError::invalid(format!("`{name}` must be an integer between 0 and {}", u32::MAX)))
}

fn ensure_keys(object: &serde_json::Map<String, Value>, allowed: &[&str]) -> AgentResult<()> {
    if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(AgentError::invalid(format!("argument `{key}` is not available to the Agent")));
    }
    Ok(())
}

fn is_on_page(doc: &Document, page: NodeId, id: NodeId) -> bool {
    if id == page || !doc.contains(id) {
        return false;
    }
    let mut current = Some(id);
    for _ in 0..=128 {
        if current == Some(page) {
            return true;
        }
        current = current.and_then(|node_id| doc.node(node_id)).and_then(|node| node.parent);
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn rectangle(session: &mut Session) -> NodeId {
        let result = session.execute("shape.rectangle", &json!({"x": 0, "y": 0, "width": 80, "height": 40})).unwrap();
        NodeId(result["id"].as_u64().unwrap())
    }

    fn call(id: &str, name: &str, arguments: Value) -> AgentToolCall {
        AgentToolCall { id: id.to_string(), name: name.to_string(), arguments }
    }

    #[test]
    fn skill_catalog_scopes_tools_and_uses_product_owned_instructions() {
        let design = AgentBackend::tool_definitions_for("design").unwrap();
        let design_names = design.iter().map(|definition| definition.name.as_str()).collect::<Vec<_>>();
        assert!(design_names.contains(&"node.create"));
        assert!(design_names.contains(&"node.set"));
        assert!(!design_names.contains(&"motion.inspect"));
        assert!(!design_names.contains(&"command.batch"));
        assert!(!design_names.contains(&"file.save"));

        let motion = AgentBackend::tool_definitions_for("motion").unwrap();
        let motion_names = motion.iter().map(|definition| definition.name.as_str()).collect::<Vec<_>>();
        assert!(motion_names.contains(&"motion.inspect"));
        assert!(motion_names.contains(&"motion.composition.create"));
        assert!(motion_names.contains(&"motion.track.add"));
        assert!(motion_names.contains(&"motion.keyframe.set"));
        assert!(!motion_names.contains(&"node.set"));

        let skill = AgentBackend::skill("design").unwrap();
        assert!(skill.instructions.contains("Each user connects their own provider"));
        assert!(AgentBackend::skill("unknown").is_err());
    }

    #[test]
    fn context_includes_compact_outline_selection_and_motion_without_file_path() {
        let mut session = Session::new();
        let id = rectangle(&mut session);
        session.set_selection(vec![id]);
        let context = AgentBackend::context(&session).unwrap();
        assert!(context["document"].as_str().is_some());
        assert_eq!(context["selection"][0]["id"], json!(id.0));
        assert_eq!(context["outline"]["children"][0]["id"], json!(id.0));
        assert!(context.get("path").is_none());
        assert!(serde_json::to_vec(&context).unwrap().len() <= MAX_CONTEXT_BYTES);
    }

    #[test]
    fn design_edits_are_proposed_then_applied_as_one_undoable_batch() {
        let mut session = Session::new();
        let target = rectangle(&mut session);
        let history_before = session.undo_depth().0;
        let turn = AgentBackend::prepare(
            &session,
            "design",
            &[
                call("1", "node.set", json!({"ids": [target.0], "props": {"fill": "#264653", "opacity": 0.8}})),
                call("2", "node.create", json!({"type": "text", "x": 12, "y": 18, "text": "Hello"})),
            ],
        )
        .unwrap();
        let proposal = turn.proposal.as_ref().unwrap();
        assert_eq!(proposal.changes().len(), 2);
        assert_eq!(session.undo_depth().0, history_before);
        assert_eq!(session.doc().unwrap().node(target).unwrap().opacity, 1.0);

        assert!(AgentBackend::apply(&mut session, proposal, false).is_err());
        assert_eq!(session.undo_depth().0, history_before);
        let result = AgentBackend::apply(&mut session, proposal, true).unwrap();
        assert_eq!(result.as_array().unwrap().len(), 2);
        let tool_results = AgentBackend::applied_results(proposal, &result).unwrap();
        assert_eq!(tool_results[0].call_id, "1");
        assert_eq!(tool_results[1].call_id, "2");
        assert_eq!(session.undo_depth().0, history_before + 1);
        assert_eq!(session.doc().unwrap().node(target).unwrap().opacity, 0.8);
        assert!(session.undo().unwrap());
        assert_eq!(session.doc().unwrap().node(target).unwrap().opacity, 1.0);
        assert_eq!(session.doc().unwrap().node(session.page().unwrap()).unwrap().children.len(), 1);
    }

    #[test]
    fn motion_keyframe_changes_use_existing_validated_commands() {
        let mut session = Session::new();
        let target = rectangle(&mut session);
        let composition =
            session.execute("motion.composition.create", &json!({"name": "Intro", "durationFrames": 60})).unwrap()["compositionId"].as_u64().unwrap();
        let track = session.execute("motion.track.add", &json!({"compositionId": composition, "target": target.0, "property": "opacity"})).unwrap()["trackId"].as_u64().unwrap();
        let before = session.undo_depth().0;
        let turn = AgentBackend::prepare(
            &session,
            "motion",
            &[call(
                "kf",
                "motion.keyframe.set",
                json!({
                    "compositionId": composition,
                    "trackId": track,
                    "frame": 30,
                    "value": 0.25,
                    "interpolation": "step"
                }),
            )],
        )
        .unwrap();
        assert_eq!(session.doc().unwrap().motion.compositions[0].tracks[0].keyframes.len(), 0);
        AgentBackend::apply(&mut session, turn.proposal.as_ref().unwrap(), true).unwrap();
        let keyframe = session.doc().unwrap().motion.compositions[0].tracks[0].keyframes[0];
        assert_eq!(keyframe.frame, 30);
        assert_eq!(keyframe.value, 0.25);
        assert_eq!(session.undo_depth().0, before + 1);
    }

    #[test]
    fn motion_context_and_keyframes_are_scoped_to_current_page() {
        let mut session = Session::new();
        let target = rectangle(&mut session);
        let composition =
            session.execute("motion.composition.create", &json!({"name": "Intro", "durationFrames": 60})).unwrap()["compositionId"].as_u64().unwrap();
        let track = session.execute("motion.track.add", &json!({"compositionId": composition, "target": target.0, "property": "opacity"})).unwrap()["trackId"]
            .as_u64()
            .unwrap();
        session.execute("page.duplicate", &json!({})).unwrap();

        let context = AgentBackend::context(&session).unwrap();
        assert_eq!(context["motion"]["compositions"], json!([]));
        assert!(AgentBackend::prepare(&session, "motion", &[call("inspect", "motion.inspect", json!({"compositionId": composition}))]).is_err());
        assert!(
            AgentBackend::prepare(
                &session,
                "motion",
                &[call("keyframe", "motion.keyframe.set", json!({"compositionId": composition, "trackId": track, "frame": 10, "value": 0.5}))]
            )
            .is_err()
        );
    }

    #[test]
    fn unknown_tools_unsafe_properties_and_stale_proposals_are_rejected() {
        let mut session = Session::new();
        let target = rectangle(&mut session);
        assert!(AgentBackend::prepare(&session, "design", &[call("unsafe", "file.save", json!({}))]).is_err());
        assert!(
            AgentBackend::prepare(
                &session,
                "design",
                &[call("bad", "node.set", json!({"ids": [target.0], "props": {"pluginData": {"secret": true}}}))]
            )
            .is_err()
        );
        assert!(AgentBackend::prepare(&session, "design", &[call("motion", "motion.inspect", json!({}))]).is_err());
        assert!(AgentBackend::prepare(&session, "motion", &[call("design", "node.set", json!({"ids": [target.0], "props": {"x": 5}}))]).is_err());
        let turn = AgentBackend::prepare(&session, "design", &[call("ok", "node.set", json!({"ids": [target.0], "props": {"x": 5}}))]).unwrap();
        session.execute("node.set", &json!({"id": target.0, "props": {"y": 9}})).unwrap();
        assert!(AgentBackend::apply(&mut session, turn.proposal.as_ref().unwrap(), true).is_err());
    }

    #[test]
    fn conversation_is_bounded_and_clearable() {
        let mut conversation = AgentConversation::default();
        for index in 0..MAX_MESSAGES + 1 {
            conversation
                .push(AgentMessage { role: AgentRole::User, content: index.to_string(), tool_calls: Vec::new(), tool_call_id: None, name: None })
                .unwrap();
        }
        assert_eq!(conversation.messages().len(), MAX_MESSAGES);
        assert_eq!(conversation.messages()[0].content, "1");
        assert!(
            conversation
                .push(AgentMessage {
                    role: AgentRole::User,
                    content: "x".repeat(MAX_MESSAGE_BYTES + 1),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    name: None,
                })
                .is_err()
        );
        conversation.clear();
        assert!(conversation.messages().is_empty());
    }
}
