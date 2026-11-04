//! Provider protocol types for the local Agent: OpenAI-compatible Chat Completions and the
//! Anthropic Messages API.

use std::fmt;
use std::sync::mpsc::{Receiver, TryRecvError};

use serde_json::{Value, json};
use zeroize::Zeroizing;

use crate::agent::{AgentBackend, AgentConversation, AgentMessage, AgentRole, AgentToolCall};

pub const MAX_PROVIDER_REQUEST_BYTES: usize = 128 * 1024;
pub const MAX_PROVIDER_RESPONSE_BYTES: usize = 1024 * 1024;
pub const META_RELAY_ENDPOINT: &str = "https://api.meta.ai/v1/chat/completions";
pub const ANTHROPIC_ENDPOINT: &str = "https://api.anthropic.com/v1/messages";
pub const ANTHROPIC_API_VERSION: &str = "2026-10-21";
/// Beta header for the scalar `fallbacks: "default"` form; sent only when the request carries it.
pub const ANTHROPIC_FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
const ANTHROPIC_FALLBACK_MODELS: [&str; 4] = ["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"];
const ANTHROPIC_MAX_TOKENS: u64 = 16_000;
const MAX_API_KEY_BYTES: usize = 8192;
const MAX_MODEL_BYTES: usize = 128;
const MAX_TOOL_ARGUMENT_BYTES: usize = 16 * 1024;

/// Whether the host can make a native request without exposing a key to browser storage.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentProviderAvailability {
    NativeOpenAiCompatible,
    BrowserMetaRelay,
    BrowserRelayRequired,
    MissingCurl,
    Unsupported,
}

/// Provider credential held only in process memory. It cannot be serialized or formatted as text.
pub struct AgentSecret(Zeroizing<Vec<u8>>);

impl AgentSecret {
    pub fn from_input(value: String) -> Result<Self, String> {
        let bytes = Zeroizing::new(value.into_bytes());
        if bytes.is_empty() {
            return Err("Enter an API key.".to_string());
        }
        if bytes.len() > MAX_API_KEY_BYTES {
            return Err("The API key is too long.".to_string());
        }
        if !bytes.iter().all(|byte| (0x21..=0x7e).contains(byte)) {
            return Err("The API key must contain printable characters without spaces.".to_string());
        }
        Ok(Self(bytes))
    }

    pub fn expose_bytes(&self) -> &[u8] {
        self.0.as_slice()
    }

    pub fn duplicate_for_request(&self) -> Self {
        Self(Zeroizing::new(self.0.to_vec()))
    }
}

impl fmt::Debug for AgentSecret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("AgentSecret([redacted])")
    }
}

/// A provider connection owned by one native app session, never by document or preference state.
pub struct AgentProviderConfig {
    protocol: AgentProviderProtocol,
    endpoint: String,
    model: String,
    secret: AgentSecret,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentProviderProtocol {
    OpenAiCompatible,
    AnthropicMessages,
}

impl AgentProviderConfig {
    pub fn new(endpoint: String, model: String, secret: AgentSecret) -> Self {
        Self { protocol: AgentProviderProtocol::OpenAiCompatible, endpoint, model, secret }
    }

    pub fn anthropic(model: String, secret: AgentSecret) -> Self {
        Self { protocol: AgentProviderProtocol::AnthropicMessages, endpoint: ANTHROPIC_ENDPOINT.to_string(), model, secret }
    }

    pub fn protocol(&self) -> AgentProviderProtocol {
        self.protocol
    }

    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    pub fn duplicate_secret_for_request(&self) -> AgentSecret {
        self.secret.duplicate_for_request()
    }
}

/// A single non-streamed provider response delivered back to the UI thread.
pub struct AgentProviderTask {
    receiver: Receiver<Result<AgentProviderReply, String>>,
}

impl AgentProviderTask {
    pub fn new(receiver: Receiver<Result<AgentProviderReply, String>>) -> Self {
        Self { receiver }
    }

    pub fn try_recv(&self) -> Result<Result<AgentProviderReply, String>, TryRecvError> {
        self.receiver.try_recv()
    }
}

pub struct AgentProviderReply {
    pub message: AgentMessage,
    pub tool_calls: Vec<AgentToolCall>,
}

pub fn validate_model_id(model: &str) -> Result<(), String> {
    if model.is_empty() || model.trim() != model {
        return Err("Enter a model ID without leading or trailing spaces.".to_string());
    }
    if model.len() > MAX_MODEL_BYTES || model.chars().any(char::is_control) {
        return Err("The model ID is too long or contains control characters.".to_string());
    }
    Ok(())
}

/// Build one bounded Chat Completions request. The caller supplies only the current-page snapshot.
pub fn build_openai_request(
    model: &str,
    skill_id: &str,
    conversation: &AgentConversation,
    context: &Value,
    allow_tools: bool,
) -> Result<Value, String> {
    validate_model_id(model)?;
    let skill = AgentBackend::skill(skill_id).map_err(|error| error.to_string())?;
    let context_json = serde_json::to_string(context).map_err(|_| "Could not encode the current page context.".to_string())?;
    let system = format!(
        "{}\n\nUndesign runtime rules: use only the supplied current-page context and listed tools. Tool calls that change the document are proposals, not completed edits. Never say a change was applied until the user approves it in Undesign.\n\nCurrent-page context (JSON):\n{}",
        skill.instructions, context_json
    );
    let mut messages = Vec::with_capacity(conversation.messages().len() + 1);
    messages.push(json!({"role": "system", "content": system}));
    for message in conversation.messages() {
        messages.push(openai_message(message)?);
    }
    let tools = AgentBackend::tool_definitions_for(skill_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": wire_tool_name(&tool.name),
                    "description": tool.description,
                    "parameters": tool.input_schema
                }
            })
        })
        .collect::<Vec<_>>();
    let request = json!({
        "model": model,
        "messages": messages,
        "tools": tools,
        "tool_choice": if allow_tools { "auto" } else { "none" },
        "stream": false
    });
    let encoded = serde_json::to_vec(&request).map_err(|_| "Could not encode the provider request.".to_string())?;
    if encoded.len() > MAX_PROVIDER_REQUEST_BYTES {
        return Err("The chat and current-page context exceed the provider request limit. Clear the conversation or shorten the prompt.".to_string());
    }
    Ok(request)
}

/// Build one bounded Anthropic Messages request from the same skill, context and tool allow-list.
///
/// Thinking blocks are never replayed: the system prompt carries a fresh page snapshot on every
/// request, so earlier blocks would no longer match their conversation prefix. Text and tool-use
/// blocks are kept, which the API accepts.
pub fn build_anthropic_request(
    model: &str,
    skill_id: &str,
    conversation: &AgentConversation,
    context: &Value,
    allow_tools: bool,
) -> Result<Value, String> {
    validate_model_id(model)?;
    let skill = AgentBackend::skill(skill_id).map_err(|error| error.to_string())?;
    let context_json = serde_json::to_string(context).map_err(|_| "Could not encode the current page context.".to_string())?;
    let system = format!(
        "{}\n\nUndesign runtime rules: use only the supplied current-page context and listed tools. Tool calls that change the document are proposals, not completed edits. Never say a change was applied until the user approves it in Undesign.\n\nCurrent-page context (JSON):\n{}",
        skill.instructions, context_json
    );
    let messages = anthropic_messages(conversation.messages())?;
    let mut request = json!({
        "model": model,
        "max_tokens": ANTHROPIC_MAX_TOKENS,
        "system": system,
        "messages": messages
    });
    if allow_tools {
        let tools = AgentBackend::tool_definitions_for(skill_id)
            .map_err(|error| error.to_string())?
            .into_iter()
            .map(|tool| json!({"name": wire_tool_name(&tool.name), "description": tool.description, "input_schema": tool.input_schema}))
            .collect::<Vec<_>>();
        if !tools.is_empty() {
            request["tools"] = Value::Array(tools);
            request["tool_choice"] = json!({"type": "auto"});
        }
    }
    if anthropic_uses_fallbacks(model) {
        request["fallbacks"] = Value::String("default".to_string());
    }
    let encoded = serde_json::to_vec(&request).map_err(|_| "Could not encode the provider request.".to_string())?;
    if encoded.len() > MAX_PROVIDER_REQUEST_BYTES {
        return Err("The chat and current-page context exceed the provider request limit. Clear the conversation or shorten the prompt.".to_string());
    }
    Ok(request)
}

/// Models that accept the scalar `fallbacks: "default"` refusal routing on the Claude API.
pub fn anthropic_uses_fallbacks(model: &str) -> bool {
    ANTHROPIC_FALLBACK_MODELS.contains(&model)
}

/// Turn the bounded local history into alternating Messages turns.
///
/// The history drops its oldest entries when full, so it can start with an assistant reply or a
/// tool result whose call is gone. The request starts at the first user prompt, merges adjacent
/// turns of the same role, drops results without a matching call, and answers any call that has no
/// result yet so every `tool_use` is paired.
fn anthropic_messages(history: &[AgentMessage]) -> Result<Vec<Value>, String> {
    let start = history
        .iter()
        .position(|message| message.role == AgentRole::User)
        .ok_or_else(|| "The provider conversation has no user message.".to_string())?;
    let mut turns: Vec<(&'static str, Vec<Value>)> = Vec::new();
    for message in history.iter().skip(start) {
        let (role, blocks) = match message.role {
            AgentRole::System => return Err("The provider conversation contained an unexpected system message.".to_string()),
            AgentRole::User => {
                let blocks = if message.content.is_empty() { Vec::new() } else { vec![json!({"type": "text", "text": message.content})] };
                ("user", blocks)
            }
            AgentRole::Tool => {
                let id =
                    message.tool_call_id.as_deref().ok_or_else(|| "The provider conversation contained a tool result without an ID.".to_string())?;
                ("user", vec![json!({"type": "tool_result", "tool_use_id": id, "content": message.content})])
            }
            AgentRole::Assistant => {
                let mut blocks = Vec::with_capacity(message.tool_calls.len() + 1);
                if !message.content.is_empty() {
                    blocks.push(json!({"type": "text", "text": message.content}));
                }
                for call in &message.tool_calls {
                    blocks.push(json!({"type": "tool_use", "id": call.id, "name": wire_tool_name(&call.name), "input": call.arguments}));
                }
                ("assistant", blocks)
            }
        };
        if blocks.is_empty() {
            continue;
        }
        match turns.last_mut() {
            Some((last_role, last_blocks)) if *last_role == role => last_blocks.extend(blocks),
            _ => turns.push((role, blocks)),
        }
    }
    let mut pending: Vec<String> = Vec::new();
    for (role, blocks) in &mut turns {
        if *role == "assistant" {
            pending =
                blocks.iter().filter(|block| block["type"] == "tool_use").filter_map(|block| block["id"].as_str().map(str::to_string)).collect();
            continue;
        }
        let (mut results, rest): (Vec<Value>, Vec<Value>) = std::mem::take(blocks).into_iter().partition(|block| block["type"] == "tool_result");
        results.retain(|block| block["tool_use_id"].as_str().is_some_and(|id| pending.iter().any(|call| call == id)));
        for id in &pending {
            if !results.iter().any(|block| block["tool_use_id"].as_str() == Some(id.as_str())) {
                results.push(json!({"type": "tool_result", "tool_use_id": id, "content": "{\"applied\":false,\"status\":\"not run\"}"}));
            }
        }
        pending.clear();
        results.extend(rest);
        *blocks = results;
    }
    turns.retain(|(_, blocks)| !blocks.is_empty());
    match turns.last() {
        Some(("user", _)) => {}
        _ => return Err("The provider conversation must end with a user message.".to_string()),
    }
    Ok(turns.into_iter().map(|(role, content)| json!({"role": role, "content": content})).collect())
}

/// Parse one non-streamed Messages response; thinking and fallback markers are not shown in chat.
pub fn parse_anthropic_response(body: &str) -> Result<AgentProviderReply, String> {
    if body.len() > MAX_PROVIDER_RESPONSE_BYTES {
        return Err("The provider response exceeds the size limit.".to_string());
    }
    let value: Value = serde_json::from_str(body).map_err(|_| "The provider returned invalid JSON.".to_string())?;
    if value.get("error").is_some() || value.get("type").and_then(Value::as_str) == Some("error") {
        return Err("The provider rejected the request. Check the model ID and API key.".to_string());
    }
    let stop_reason = value.get("stop_reason").and_then(Value::as_str);
    if stop_reason == Some("refusal") {
        return Err("The model declined this request. No changes were applied.".to_string());
    }
    let blocks = value.get("content").and_then(Value::as_array).ok_or_else(|| "The provider response has no content blocks.".to_string())?;
    if blocks.len() > 64 {
        return Err("The provider returned too many content blocks.".to_string());
    }
    let mut content = String::new();
    let mut calls = Vec::new();
    for block in blocks {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                let text = block.get("text").and_then(Value::as_str).ok_or_else(|| "The provider returned invalid text content.".to_string())?;
                if content.len().saturating_add(text.len()) > 16_384 {
                    return Err("The assistant reply exceeds the message size limit.".to_string());
                }
                content.push_str(text);
            }
            Some("tool_use") => {
                if calls.len() >= 16 {
                    return Err("The provider returned too many tool calls.".to_string());
                }
                let id = block
                    .get("id")
                    .and_then(Value::as_str)
                    .filter(|id| !id.is_empty() && id.len() <= 128)
                    .ok_or_else(|| "The provider returned a tool call without a valid ID.".to_string())?;
                let name = block
                    .get("name")
                    .and_then(Value::as_str)
                    .filter(|name| !name.is_empty() && name.len() <= 128)
                    .ok_or_else(|| "The provider returned a tool call without a valid name.".to_string())?;
                let arguments = block
                    .get("input")
                    .filter(|input| input.is_object())
                    .cloned()
                    .ok_or_else(|| "The provider returned tool arguments in an unsupported format.".to_string())?;
                if serde_json::to_vec(&arguments).map(|bytes| bytes.len() > MAX_TOOL_ARGUMENT_BYTES).unwrap_or(true) {
                    return Err("The provider returned oversized tool arguments.".to_string());
                }
                calls.push(AgentToolCall { id: id.to_string(), name: local_tool_name(name), arguments });
            }
            _ => {}
        }
    }
    if stop_reason == Some("max_tokens") && !calls.is_empty() {
        return Err("The assistant reply was cut off before its tool call finished. No changes were applied.".to_string());
    }
    if content.is_empty() && calls.is_empty() {
        return Err("The provider returned an empty assistant message.".to_string());
    }
    Ok(AgentProviderReply {
        message: AgentMessage { role: AgentRole::Assistant, content, tool_calls: calls.clone(), tool_call_id: None, name: None },
        tool_calls: calls,
    })
}

/// Provider function names allow only ASCII letters, digits, `_` and `-`; local tool ids use dots.
fn wire_tool_name(name: &str) -> String {
    name.replace('.', "__")
}

fn local_tool_name(name: &str) -> String {
    name.replace("__", ".")
}

fn openai_message(message: &AgentMessage) -> Result<Value, String> {
    let role = match message.role {
        AgentRole::System => "system",
        AgentRole::User => "user",
        AgentRole::Assistant => "assistant",
        AgentRole::Tool => "tool",
    };
    let content = if message.role == AgentRole::Assistant && !message.tool_calls.is_empty() && message.content.is_empty() {
        Value::Null
    } else {
        Value::String(message.content.clone())
    };
    let mut result = json!({"role": role, "content": content});
    if message.role == AgentRole::Assistant && !message.tool_calls.is_empty() {
        let calls = message
            .tool_calls
            .iter()
            .map(|call| {
                let arguments = serde_json::to_string(&call.arguments).map_err(|_| "Could not encode a tool call.".to_string())?;
                Ok(json!({
                    "id": call.id,
                    "type": "function",
                    "function": {"name": wire_tool_name(&call.name), "arguments": arguments}
                }))
            })
            .collect::<Result<Vec<_>, String>>()?;
        result["tool_calls"] = Value::Array(calls);
    }
    if let Some(id) = &message.tool_call_id {
        result["tool_call_id"] = Value::String(id.clone());
    }
    if let Some(name) = &message.name {
        result["name"] = Value::String(wire_tool_name(name));
    }
    Ok(result)
}

pub fn parse_openai_response(body: &str) -> Result<AgentProviderReply, String> {
    if body.len() > MAX_PROVIDER_RESPONSE_BYTES {
        return Err("The provider response exceeds the size limit.".to_string());
    }
    let value: Value = serde_json::from_str(body).map_err(|_| "The provider returned invalid JSON.".to_string())?;
    if value.get("error").is_some() {
        return Err("The provider rejected the request. Check the endpoint, model ID, and API key.".to_string());
    }
    let message = value
        .pointer("/choices/0/message")
        .and_then(Value::as_object)
        .ok_or_else(|| "The provider response has no assistant message.".to_string())?;
    let content = match message.get("content") {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(text)) if text.len() <= 16_384 => text.clone(),
        Some(Value::String(_)) => return Err("The assistant reply exceeds the message size limit.".to_string()),
        Some(_) => return Err("The provider returned an unsupported message format.".to_string()),
    };
    let mut calls = Vec::new();
    if let Some(entries) = message.get("tool_calls").and_then(Value::as_array) {
        if entries.len() > 16 {
            return Err("The provider returned too many tool calls.".to_string());
        }
        for entry in entries {
            let id = entry
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty() && id.len() <= 128)
                .ok_or_else(|| "The provider returned a tool call without a valid ID.".to_string())?;
            let function =
                entry.get("function").and_then(Value::as_object).ok_or_else(|| "The provider returned an invalid tool call.".to_string())?;
            let name = function
                .get("name")
                .and_then(Value::as_str)
                .filter(|name| !name.is_empty() && name.len() <= 128)
                .ok_or_else(|| "The provider returned a tool call without a valid name.".to_string())?;
            let arguments = function
                .get("arguments")
                .and_then(Value::as_str)
                .filter(|text| text.len() <= MAX_TOOL_ARGUMENT_BYTES)
                .ok_or_else(|| "The provider returned tool arguments in an unsupported format.".to_string())?;
            let arguments: Value = serde_json::from_str(arguments).map_err(|_| "The provider returned invalid tool arguments.".to_string())?;
            calls.push(AgentToolCall { id: id.to_string(), name: local_tool_name(name), arguments });
        }
    }
    if content.is_empty() && calls.is_empty() {
        return Err("The provider returned an empty assistant message.".to_string());
    }
    Ok(AgentProviderReply {
        message: AgentMessage { role: AgentRole::Assistant, content, tool_calls: calls.clone(), tool_call_id: None, name: None },
        tool_calls: calls,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    #[test]
    fn motion_request_exposes_only_motion_tools_and_no_secret_field() {
        let request = build_openai_request("local-motion-model", "motion", &AgentConversation::default(), &json!({"page": "current"}), true);
        assert!(request.is_ok());
        let request = request.unwrap_or(Value::Null);
        let names = request["tools"]
            .as_array()
            .map(|tools| tools.iter().filter_map(|tool| tool.pointer("/function/name").and_then(Value::as_str)).collect::<Vec<_>>())
            .unwrap_or_default();
        assert!(names.contains(&"motion__inspect"));
        assert!(names.contains(&"motion__keyframe__set"));
        assert!(!names.contains(&"node__create"));
        assert!(names.iter().all(|name| name.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')));
        assert!(request.get("api_key").is_none());
        assert_eq!(request["tool_choice"], "auto");
        assert_eq!(request["stream"], false);
    }

    #[test]
    fn response_parser_accepts_typed_tool_calls_and_rejects_bad_arguments() {
        let body = r#"{"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"document__inspect","arguments":"{}"}}]}}]}"#;
        let parsed = parse_openai_response(body);
        assert!(parsed.is_ok());
        let parsed = parsed.unwrap_or_else(|_| AgentProviderReply {
            message: AgentMessage { role: AgentRole::Assistant, content: String::new(), tool_calls: Vec::new(), tool_call_id: None, name: None },
            tool_calls: Vec::new(),
        });
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "document.inspect");
        assert_eq!(parsed.tool_calls[0].arguments, json!({}));
        assert!(
            parse_openai_response(
                r#"{"choices":[{"message":{"tool_calls":[{"id":"x","function":{"name":"document.inspect","arguments":"not json"}}]}}]}"#
            )
            .is_err()
        );
    }

    fn message(role: AgentRole, content: &str) -> AgentMessage {
        AgentMessage { role, content: content.to_string(), tool_calls: Vec::new(), tool_call_id: None, name: None }
    }

    fn tool_result(id: &str) -> AgentMessage {
        AgentMessage {
            role: AgentRole::Tool,
            content: "{\"ok\":true}".to_string(),
            tool_calls: Vec::new(),
            tool_call_id: Some(id.to_string()),
            name: Some("document.inspect".to_string()),
        }
    }

    #[test]
    fn anthropic_request_uses_messages_shape_safe_tool_names_and_no_secret() {
        let mut conversation = AgentConversation::default();
        assert!(conversation.push(message(AgentRole::User, "Make a card")).is_ok());
        let request = build_anthropic_request("claude-opus-5-5", "design", &conversation, &json!({"page": "current"}), true);
        assert!(request.is_ok());
        let request = request.unwrap_or(Value::Null);
        assert_eq!(request["model"], "claude-opus-5-5");
        assert!(request["system"].as_str().is_some_and(|system| system.contains("Current-page context")));
        assert_eq!(request["messages"][0]["role"], "user");
        assert_eq!(request["messages"][0]["content"][0]["text"], "Make a card");
        assert_eq!(request["tool_choice"]["type"], "auto");
        assert_eq!(request["fallbacks"], "default");
        assert!(request.get("temperature").is_none());
        assert!(request.get("thinking").is_none());
        assert!(request.get("api_key").is_none());
        let names =
            request["tools"].as_array().map(|tools| tools.iter().filter_map(|tool| tool["name"].as_str()).collect::<Vec<_>>()).unwrap_or_default();
        assert!(names.contains(&"node__create"));
        assert!(names.iter().all(|name| name.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')));

        let inspection = build_anthropic_request("claude-haiku-4-5", "design", &conversation, &json!({}), false);
        assert!(inspection.as_ref().is_ok_and(|request| request.get("tools").is_none() && request.get("fallbacks").is_none()));
    }

    #[test]
    fn anthropic_history_starts_at_a_prompt_pairs_tool_results_and_merges_turns() {
        let mut conversation = AgentConversation::default();
        assert!(conversation.push(message(AgentRole::Assistant, "left over from a trimmed history")).is_ok());
        assert!(conversation.push(tool_result("orphan")).is_ok());
        assert!(conversation.push(message(AgentRole::User, "Inspect the page")).is_ok());
        let call = AgentMessage {
            role: AgentRole::Assistant,
            content: String::new(),
            tool_calls: vec![
                AgentToolCall { id: "call_a".to_string(), name: "document.inspect".to_string(), arguments: json!({}) },
                AgentToolCall { id: "call_b".to_string(), name: "selection.inspect".to_string(), arguments: json!({}) },
            ],
            tool_call_id: None,
            name: None,
        };
        assert!(conversation.push(call).is_ok());
        assert!(conversation.push(tool_result("call_a")).is_ok());
        assert!(conversation.push(tool_result("stale")).is_ok());
        let request = build_anthropic_request("claude-opus-5-5", "design", &conversation, &json!({}), false);
        assert!(request.is_ok());
        let request = request.unwrap_or(Value::Null);
        let messages = request["messages"].as_array().cloned().unwrap_or_default();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(messages[1]["content"][0]["type"], "tool_use");
        assert_eq!(messages[1]["content"][0]["name"], "document__inspect");
        let results = messages[2]["content"].as_array().cloned().unwrap_or_default();
        let ids = results.iter().filter_map(|block| block["tool_use_id"].as_str()).collect::<Vec<_>>();
        assert_eq!(ids, vec!["call_a", "call_b"]);

        let mut ends_with_reply = AgentConversation::default();
        assert!(ends_with_reply.push(message(AgentRole::User, "hi")).is_ok());
        assert!(ends_with_reply.push(message(AgentRole::Assistant, "hello")).is_ok());
        assert!(build_anthropic_request("claude-opus-5-5", "design", &ends_with_reply, &json!({}), true).is_err());
        assert!(build_anthropic_request("claude-opus-5-5", "design", &AgentConversation::default(), &json!({}), true).is_err());
    }

    #[test]
    fn anthropic_response_parser_maps_tools_skips_thinking_and_reports_refusals() {
        let body = r#"{"type":"message","role":"assistant","stop_reason":"tool_use","content":[{"type":"thinking","thinking":"","signature":"sig"},{"type":"text","text":"Checking."},{"type":"tool_use","id":"toolu_1","name":"document__inspect","input":{}}]}"#;
        let parsed = parse_anthropic_response(body);
        assert!(parsed.is_ok());
        let Ok(parsed) = parsed else { return };
        assert_eq!(parsed.message.content, "Checking.");
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "document.inspect");
        assert!(parse_anthropic_response(r#"{"stop_reason":"refusal","content":[]}"#).is_err());
        assert!(parse_anthropic_response(r#"{"type":"error","error":{"type":"authentication_error","message":"x"}}"#).is_err());
        assert!(parse_anthropic_response(r#"{"content":[{"type":"tool_use","id":"t","name":"node__create","input":"text"}]}"#).is_err());
        assert!(
            parse_anthropic_response(r#"{"stop_reason":"max_tokens","content":[{"type":"tool_use","id":"t","name":"node__create","input":{}}]}"#)
                .is_err()
        );
        assert!(parse_anthropic_response("not json").is_err());
        assert!(parse_anthropic_response(r#"{"content":[]}"#).is_err());
    }

    #[test]
    fn secret_debug_output_is_redacted_and_validation_is_bounded() {
        let secret = AgentSecret::from_input("user-token-do-not-print".to_string());
        assert!(secret.is_ok());
        let secret = secret.unwrap_or_else(|_| AgentSecret(Zeroizing::new(Vec::new())));
        assert!(!format!("{secret:?}").contains("user-token-do-not-print"));
        assert!(AgentSecret::from_input("key with space".to_string()).is_err());
        assert!(AgentSecret::from_input("".to_string()).is_err());
    }
}
