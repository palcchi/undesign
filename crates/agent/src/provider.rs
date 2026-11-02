//! Providers turn a prompt into model text. The interface is poll-based instead of
//! async so the same core runs natively (a worker thread) and on wasm (pumped once per
//! frame) with no executor dependency.

use std::collections::{HashMap, VecDeque};

use serde_json::{Value, json};

use crate::error::{Error, Result};

/// An in-flight completion, handed out by [`Provider::start`].
pub type RequestId = u64;

/// What the core asks the model.
#[derive(Clone, Debug)]
pub struct ChatRequest {
    /// System prompt: role, rules and the whitelisted commands.
    pub system: String,
    /// The user prompt plus the rendered [`crate::ChatContext`].
    pub user: String,
    /// Cap for the reply length.
    pub max_tokens: u32,
}

/// User-owned provider settings. The key is kept in memory and is never serialized.
pub struct ProviderConfig {
    /// OpenAI-compatible chat-completions endpoint.
    pub endpoint: String,
    /// Provider model identifier.
    pub model: String,
    api_key: String,
    /// Upper bound requested for one completion.
    pub max_tokens: u32,
}

impl ProviderConfig {
    /// Build settings for a user-owned endpoint and key.
    pub fn new(endpoint: impl Into<String>, model: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self { endpoint: endpoint.into(), model: model.into(), api_key: api_key.into(), max_tokens: 2000 }
    }

    fn api_key(&self) -> &str {
        &self.api_key
    }
}

impl std::fmt::Debug for ProviderConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProviderConfig")
            .field("endpoint", &self.endpoint)
            .field("model", &self.model)
            .field("api_key", &"[redacted]")
            .field("max_tokens", &self.max_tokens)
            .finish()
    }
}

/// Request handed to a native or browser HTTP adapter.
pub struct ModelRequest {
    pub endpoint: String,
    pub model: String,
    pub api_key: String,
    pub body: Value,
}

impl std::fmt::Debug for ModelRequest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ModelRequest")
            .field("endpoint", &self.endpoint)
            .field("model", &self.model)
            .field("api_key", &"[redacted]")
            .field("body", &self.body)
            .finish()
    }
}

/// Transport boundary for native and WASM HTTP implementations.
pub trait ModelTransport {
    fn start(&mut self, request: ModelRequest) -> Result<RequestId>;
    fn poll(&mut self, id: RequestId) -> Poll;
}

/// OpenAI-compatible provider. The transport is injected so this crate stays
/// shared between native and WASM and never owns browser or desktop networking.
pub struct MetaModelApi<T> {
    config: ProviderConfig,
    transport: T,
}

impl<T> MetaModelApi<T> {
    pub fn new(config: ProviderConfig, transport: T) -> Self {
        Self { config, transport }
    }
}

impl<T: ModelTransport> Provider for MetaModelApi<T> {
    fn start(&mut self, request: ChatRequest) -> Result<RequestId> {
        if self.config.endpoint.trim().is_empty() || self.config.model.trim().is_empty() {
            return Err(Error::Provider("provider endpoint and model are required".into()));
        }
        if self.config.api_key().trim().is_empty() {
            return Err(Error::Provider("an API key is required for the selected provider".into()));
        }
        let body = json!({
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": request.system},
                {"role": "user", "content": request.user}
            ],
            "max_tokens": request.max_tokens.min(self.config.max_tokens),
            "response_format": {"type": "json_object"}
        });
        self.transport.start(ModelRequest {
            endpoint: self.config.endpoint.clone(),
            model: self.config.model.clone(),
            api_key: self.config.api_key.clone(),
            body,
        })
    }

    fn poll(&mut self, id: RequestId) -> Poll {
        self.transport.poll(id)
    }
}

/// What the model answered: raw text, expected to hold one JSON plan.
#[derive(Clone, Debug)]
pub struct ChatResponse {
    /// The reply text.
    pub text: String,
}

/// The state of one [`RequestId`].
#[derive(Clone, Debug)]
pub enum Poll {
    /// Still thinking; pump again later.
    Pending,
    /// Answered.
    Done(ChatResponse),
    /// Failed with a human-readable message (never a key or a secret).
    Failed(String),
}

/// A model backend. Implementations must never log credentials.
pub trait Provider {
    /// Queue a completion; the returned id identifies it to [`Provider::poll`].
    fn start(&mut self, request: ChatRequest) -> Result<RequestId>;
    /// Check one request exactly once (cheap; the caller decides the cadence).
    fn poll(&mut self, id: RequestId) -> Poll;
}

enum ActiveRequest {
    Primary { id: RequestId, request: ChatRequest },
    Replay(RequestId),
}

/// Provider wrapper that keeps the demo usable when a user's provider is unavailable.
pub struct FallbackProvider<P> {
    primary: P,
    replay: Replay,
    active: HashMap<RequestId, ActiveRequest>,
    next: RequestId,
}

impl<P: Provider> FallbackProvider<P> {
    pub fn new(primary: P, replay: Replay) -> Self {
        Self { primary, replay, active: HashMap::new(), next: 0 }
    }
}

impl<P: Provider> Provider for FallbackProvider<P> {
    fn start(&mut self, request: ChatRequest) -> Result<RequestId> {
        self.next = self.next.saturating_add(1);
        let active = match self.primary.start(request.clone()) {
            Ok(id) => ActiveRequest::Primary { id, request },
            Err(_) => ActiveRequest::Replay(self.replay.start(request)?),
        };
        self.active.insert(self.next, active);
        Ok(self.next)
    }

    fn poll(&mut self, id: RequestId) -> Poll {
        let Some(active) = self.active.remove(&id) else {
            return Poll::Failed("unknown provider request".into());
        };
        match active {
            ActiveRequest::Replay(replay_id) => self.replay.poll(replay_id),
            ActiveRequest::Primary { id: primary_id, request } => match self.primary.poll(primary_id) {
                Poll::Failed(_) => match self.replay.start(request) {
                    Ok(replay_id) => self.replay.poll(replay_id),
                    Err(error) => Poll::Failed(error.to_string()),
                },
                result => {
                    if matches!(result, Poll::Pending) {
                        self.active.insert(id, ActiveRequest::Primary { id: primary_id, request });
                    }
                    result
                }
            },
        }
    }
}

/// Offline fallback with five deterministic animation examples.
#[derive(Debug)]
pub struct Replay {
    plans: Vec<(String, String)>,
    pending: HashMap<RequestId, Poll>,
    next: RequestId,
}

impl Replay {
    pub fn demo() -> Self {
        let shape = |kind: &str, name: &str| {
            format!(
                r#"{{"commands":[{{"command":"shape.{kind}","params":{{"x":120,"y":120,"width":160,"height":160}}}},{{"command":"motion.composition.create","params":{{"name":"{name}","fps":30,"durationFrames":90}}}},{{"command":"motion.track.add","params":{{"compositionId":{{"$step":1,"field":"compositionId"}},"target":{{"$step":0}},"property":"positionY"}}}},{{"command":"motion.keyframe.set","params":{{"compositionId":{{"$step":1,"field":"compositionId"}},"trackId":{{"$step":2,"field":"trackId"}},"frame":0,"value":120}}}},{{"command":"motion.keyframe.set","params":{{"compositionId":{{"$step":1,"field":"compositionId"}},"trackId":{{"$step":2,"field":"trackId"}},"frame":45,"value":280,"interpolation":"linear"}}}}]}}"#
            )
        };
        Self {
            plans: vec![
                ("logo bola memantul".into(), shape("ellipse", "Bouncing logo")),
                ("tiga lingkaran".into(), shape("ellipse", "Intro circles")),
                ("spinner loading".into(), shape("ellipse", "Spinner")),
                ("lower-third".into(), shape("rectangle", "Lower third")),
                ("tombol pulse".into(), shape("rectangle", "Pulse button")),
            ],
            pending: HashMap::new(),
            next: 0,
        }
    }

    fn choose(&self, prompt: &str) -> Option<&str> {
        let prompt = prompt.to_lowercase();
        self.plans.iter().find(|(key, _)| prompt.contains(key)).map(|(_, plan)| plan.as_str())
    }
}

impl Default for Replay {
    fn default() -> Self {
        Self::demo()
    }
}

impl Provider for Replay {
    fn start(&mut self, request: ChatRequest) -> Result<RequestId> {
        self.next = self.next.saturating_add(1);
        let result = self
            .choose(&request.user)
            .map(|text| ChatResponse { text: text.to_string() })
            .ok_or_else(|| "Replay has no recorded plan for this prompt".to_string());
        self.pending.insert(
            self.next,
            match result {
                Ok(response) => Poll::Done(response),
                Err(message) => Poll::Failed(message),
            },
        );
        Ok(self.next)
    }

    fn poll(&mut self, id: RequestId) -> Poll {
        self.pending.remove(&id).unwrap_or_else(|| Poll::Failed("unknown replay request".into()))
    }
}

/// A scripted provider for tests: each `poll` answers with the next scripted item.
/// An empty script fails loudly so a test never hangs on `Pending`.
#[derive(Debug, Default)]
pub struct FakeProvider {
    /// Scripted replies in order (`Ok` text answers, `Err` fails).
    script: VecDeque<std::result::Result<String, String>>,
    /// Requests seen (the test asserts on these).
    pub seen: Vec<ChatRequest>,
    next: RequestId,
}

impl FakeProvider {
    /// A provider answering `texts` in order.
    pub fn replies(texts: &[&str]) -> Self {
        Self { script: texts.iter().map(|t| Ok(t.to_string())).collect(), seen: Vec::new(), next: 0 }
    }

    /// A provider failing every request with `message`.
    pub fn failing(message: &str) -> Self {
        Self { script: VecDeque::from([Err(message.to_string())]), seen: Vec::new(), next: 0 }
    }
}

impl Provider for FakeProvider {
    fn start(&mut self, request: ChatRequest) -> Result<RequestId> {
        self.seen.push(request);
        self.next += 1;
        Ok(self.next)
    }

    fn poll(&mut self, _id: RequestId) -> Poll {
        match self.script.pop_front() {
            Some(Ok(text)) => Poll::Done(ChatResponse { text }),
            Some(Err(message)) => Poll::Failed(message),
            None => Poll::Failed("the scripted provider ran out of replies".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Default)]
    struct CaptureTransport {
        request: Option<ModelRequest>,
    }

    impl ModelTransport for CaptureTransport {
        fn start(&mut self, request: ModelRequest) -> Result<RequestId> {
            self.request = Some(request);
            Ok(7)
        }

        fn poll(&mut self, _id: RequestId) -> Poll {
            Poll::Done(ChatResponse { text: r#"{"commands":[]}"#.into() })
        }
    }

    fn request() -> ChatRequest {
        ChatRequest { system: "s".into(), user: "u".into(), max_tokens: 100 }
    }

    #[test]
    fn fake_answers_in_order_then_fails_loudly() {
        let mut provider = FakeProvider::replies(&["first", "second"]);
        let a = provider.start(request()).unwrap();
        assert!(matches!(provider.poll(a), Poll::Done(r) if r.text == "first"));
        let b = provider.start(request()).unwrap();
        assert!(matches!(provider.poll(b), Poll::Done(r) if r.text == "second"));
        let c = provider.start(request()).unwrap();
        assert!(matches!(provider.poll(c), Poll::Failed(_)));
        assert_eq!(provider.seen.len(), 3);
    }

    #[test]
    fn meta_provider_builds_structured_request_without_changing_user_prompt() {
        let transport = CaptureTransport::default();
        let mut provider = MetaModelApi::new(ProviderConfig::new("https://example.test/v1/chat/completions", "muse-spark-1.3", "secret"), transport);
        let id = provider.start(request()).unwrap();
        assert_eq!(id, 7);
        let request = provider.transport.request.as_ref().unwrap();
        assert_eq!(request.api_key, "secret");
        assert_eq!(request.body["model"], "muse-spark-1.3");
        assert_eq!(request.body["response_format"]["type"], "json_object");
        assert_eq!(request.body["messages"][1]["content"], "u");
    }

    #[test]
    fn meta_provider_rejects_missing_credentials() {
        let mut provider = MetaModelApi::new(ProviderConfig::new("", "", ""), CaptureTransport::default());
        assert!(provider.start(request()).is_err());
    }

    #[test]
    fn replay_serves_demo_prompt_and_rejects_unknown_prompt() {
        let mut replay = Replay::demo();
        let first = ChatRequest { user: "logo bola memantul".into(), ..request() };
        let id = replay.start(first).unwrap();
        assert!(matches!(replay.poll(id), Poll::Done(response) if response.text.contains("shape.ellipse")));
        let id = replay.start(ChatRequest { user: "something else".into(), ..request() }).unwrap();
        assert!(matches!(replay.poll(id), Poll::Failed(message) if message.contains("no recorded plan")));
    }

    #[test]
    fn fallback_switches_to_replay_after_provider_failure() {
        let primary = FakeProvider::failing("offline");
        let mut provider = FallbackProvider::new(primary, Replay::demo());
        let id = provider.start(ChatRequest { user: "spinner loading".into(), ..request() }).unwrap();
        assert!(matches!(provider.poll(id), Poll::Done(response) if response.text.contains("shape.ellipse")));
    }
}
