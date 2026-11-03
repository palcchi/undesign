//! OpenAI-compatible Chat Completions protocol types for the local Agent.

use std::fmt;
use std::sync::mpsc::{Receiver, TryRecvError};

use serde_json::{Value, json};
use zeroize::Zeroizing;

use crate::agent::{AgentBackend, AgentConversation, AgentMessage, AgentRole, AgentToolCall};

pub const MAX_PROVIDER_REQUEST_BYTES: usize = 128 * 1024;
pub const MAX_PROVIDER_RESPONSE_BYTES: usize = 1024 * 1024;
pub const META_RELAY_ENDPOINT: &str = "https://api.meta.ai/v1/chat/completions";
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
    endpoint: String,
    model: String,
    secret: AgentSecret,
}

impl AgentProviderConfig {
    pub fn new(endpoint: String, model: String, secret: AgentSecret) -> Self {
        Self { endpoint, model, secret }
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
                    "name": tool.name,
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
                    "function": {"name": call.name, "arguments": arguments}
                }))
            })
            .collect::<Result<Vec<_>, String>>()?;
        result["tool_calls"] = Value::Array(calls);
    }
    if let Some(id) = &message.tool_call_id {
        result["tool_call_id"] = Value::String(id.clone());
    }
    if let Some(name) = &message.name {
        result["name"] = Value::String(name.clone());
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
            calls.push(AgentToolCall { id: id.to_string(), name: name.to_string(), arguments });
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
        assert!(names.contains(&"motion.inspect"));
        assert!(names.contains(&"motion.keyframe.set"));
        assert!(!names.contains(&"node.create"));
        assert!(request.get("api_key").is_none());
        assert_eq!(request["tool_choice"], "auto");
        assert_eq!(request["stream"], false);
    }

    #[test]
    fn response_parser_accepts_typed_tool_calls_and_rejects_bad_arguments() {
        let body = r#"{"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"document.inspect","arguments":"{}"}}]}}]}"#;
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
