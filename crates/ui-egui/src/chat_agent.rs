//! The agent as a group chat participant: `/agent <prompt>` in the Chat history runs one
//! plan turn through the connected provider and posts the outcome as a chat thread, anchored
//! to the first layer it made. The turn is pumped once per frame, like the Agent tab's own
//! requests, and applies atomically (one undo step) with one automatic retry, like
//! [`undesign_agent::run_turn`]. Nothing here holds a key: requests go through the host's
//! connected provider, and only the prompt plus the minimal [`undesign_agent::ChatContext`]
//! ever leaves the app.

use std::time::Duration;

use serde_json::{Value, json};
use undesign_doc::NodeId;

use crate::FigApp;
use crate::agent_provider::{AgentProviderProtocol, AgentProviderTask, MAX_PROVIDER_REQUEST_BYTES, validate_model_id};
use crate::i18n::{tr, trf};

/// Who the agent's chat messages are signed.
pub const AGENT_NAME: &str = "Agent";
/// The chat prefix asking the agent, with the request after a space.
const COMMAND: &str = "/agent";
/// Reply cap per request, the agent core's default.
const MAX_TOKENS: u32 = undesign_agent::DEFAULT_MAX_TOKENS;
/// Anthropic output cap, the same the Agent tab asks for.
const ANTHROPIC_MAX_TOKENS: u64 = 16_000;
/// Provider attempts per run: the first try plus one retry of an unusable plan.
const MAX_ATTEMPTS: u32 = 2;

/// The document and page a run belongs to. Unlike the Agent tab's scope, edits made while
/// the provider thinks do not abandon the run: the group keeps chatting and the batch stays
/// atomic, so a stale plan either applies cleanly or is refused with a reason.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Scope {
    uid: u64,
    page: NodeId,
}

/// One `/agent` turn in flight.
pub struct ChatAgentRun {
    task: AgentProviderTask,
    attempt: u32,
    /// The prompt plus its rendered context, which a retry extends with the error.
    base: String,
    system: String,
    user: String,
    scope: Scope,
}

/// Run the agent for a posted chat message (a no-op unless it invokes `/agent`).
pub fn maybe_run(app: &mut FigApp, ctx: &egui::Context, text: &str) {
    let Some(rest) = text.strip_prefix(COMMAND).filter(|r| r.is_empty() || r.starts_with(' ')) else { return };
    let prompt = rest.trim().to_string();
    if prompt.is_empty() {
        post(app, None, tr("Ask me with /agent followed by a request, for example: /agent add a primary button.").to_string());
        return;
    }
    if app.ui.comments.agent.is_some() {
        post(app, None, tr("The agent is already working on a request. Wait for its reply first.").to_string());
        return;
    }
    if !app.services.agent_provider_connected() {
        post(app, None, tr("Connect a provider before sending a request.").to_string());
        return;
    }
    let Some(model) = app.services.agent_provider_model().map(str::to_string) else {
        post(app, None, tr("The provider has no model ID. Disconnect and set it again.").to_string());
        return;
    };
    let Ok(ds) = app.session.ds() else {
        post(app, None, tr("Open a document before sending a message.").to_string());
        return;
    };
    let scope = Scope { uid: ds.uid, page: ds.page };
    let system = match undesign_agent::build_system_prompt() {
        Ok(system) => system,
        Err(error) => {
            post(app, None, failed(&error.to_string()));
            return;
        }
    };
    let base = format!("{prompt}\n{}", undesign_agent::ChatContext::from_session(&app.session).render());
    let request = match build_plan_request(app.services.agent_provider_protocol(), &model, &system, &base) {
        Ok(request) => request,
        Err(error) => {
            post(app, None, failed(&error));
            return;
        }
    };
    match app.services.request_agent_completion(request) {
        Ok(task) => {
            let user = base.clone();
            app.ui.comments.agent = Some(ChatAgentRun { task, attempt: 1, base, system, user, scope });
            ctx.request_repaint_after(Duration::from_millis(100));
        }
        Err(error) => post(app, None, failed(&error)),
    }
}

/// Pump the in-flight run, if any. A no-op without one, so idle frames stay quiet.
pub fn poll(app: &mut FigApp, ctx: &egui::Context) {
    if app.ui.comments.agent.is_none() {
        return;
    }
    let scope = app.session.ds().ok().map(|ds| Scope { uid: ds.uid, page: ds.page });
    if scope != app.ui.comments.agent.as_ref().map(|run| run.scope) {
        app.ui.comments.agent = None;
        post(app, None, tr("The document changed while the assistant was working. Nothing was applied. Send your prompt again.").to_string());
        return;
    }
    let Some(run) = app.ui.comments.agent.take() else { return };
    match run.task.try_recv() {
        Err(std::sync::mpsc::TryRecvError::Empty) => {
            app.ui.comments.agent = Some(run);
            ctx.request_repaint_after(Duration::from_millis(100));
        }
        Err(std::sync::mpsc::TryRecvError::Disconnected) => post(app, None, tr("The provider request ended before a response arrived.").to_string()),
        Ok(Err(message)) => post(app, None, failed(&message)),
        Ok(Ok(reply)) => handle_reply(app, ctx, run, &reply.message.content),
    }
}

/// One completion back: parse, validate and apply, retrying an unusable plan once.
fn handle_reply(app: &mut FigApp, ctx: &egui::Context, mut run: ChatAgentRun, text: &str) {
    match undesign_agent::parse_plan(text).and_then(undesign_agent::validate).and_then(|plan| undesign_agent::apply(&mut app.session, &plan)) {
        Ok(report) => {
            if report.applied.is_empty() {
                post(app, None, tr("The agent made no changes.").to_string());
                return;
            }
            let anchor = report.created.iter().find_map(|id| {
                let id = NodeId(*id);
                app.session.doc().ok()?.node(id).map(|_| id)
            });
            post(app, anchor, trf("Agent applied: {commands}. Undo reverts them together.", &[("commands", &report.applied.join(", "))]));
        }
        // The batch already rolled back; retrying the same plan cannot help.
        Err(undesign_agent::Error::Engine(error)) => post(app, None, failed(&error.to_string())),
        Err(other) if run.attempt < MAX_ATTEMPTS => {
            run.attempt += 1;
            run.user = format!("{}\nYour last reply was unusable ({other}). Reply with nothing but a fixed JSON plan.", run.base);
            let protocol = app.services.agent_provider_protocol();
            let model = app.services.agent_provider_model().unwrap_or_default().to_string();
            match build_plan_request(protocol, &model, &run.system, &run.user).and_then(|request| app.services.request_agent_completion(request)) {
                Ok(task) => {
                    run.task = task;
                    app.ui.comments.agent = Some(run);
                    ctx.request_repaint_after(Duration::from_millis(100));
                }
                Err(error) => post(app, None, failed(&error)),
            }
        }
        Err(other) => post(app, None, failed(&other.to_string())),
    }
}

/// A JSON-plan completion request in the connected protocol's shape.
fn build_plan_request(protocol: AgentProviderProtocol, model: &str, system: &str, user: &str) -> Result<Value, String> {
    validate_model_id(model)?;
    let request = match protocol {
        AgentProviderProtocol::OpenAiCompatible => json!({
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "response_format": {"type": "json_object"},
            "max_tokens": MAX_TOKENS,
            "stream": false,
        }),
        AgentProviderProtocol::AnthropicMessages => json!({
            "model": model,
            "max_tokens": ANTHROPIC_MAX_TOKENS,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }),
    };
    let encoded = serde_json::to_vec(&request).map_err(|_| "Could not encode the provider request.".to_string())?;
    if encoded.len() > MAX_PROVIDER_REQUEST_BYTES {
        return Err("The prompt and current-page context exceed the provider request limit. Shorten the prompt.".to_string());
    }
    Ok(request)
}

/// Post `text` as the agent's chat message, about `anchor` when it names a layer.
fn post(app: &mut FigApp, anchor: Option<NodeId>, text: String) {
    let mut params = json!({"chat": true, "text": text, "author": AGENT_NAME});
    if let Some(id) = anchor {
        let (x, y) = app.session.doc().ok().and_then(|doc| doc.world_bounds(id)).map(|b| (b.center().x, b.center().y)).unwrap_or((0.0, 0.0));
        params["anchor"] = json!(id.0);
        params["x"] = json!(x);
        params["y"] = json!(y);
    }
    // The text is never empty and the anchor was just read from the document, so the only
    // failures left are a missing document, which the composer already rules out.
    let _ = app.run("comment.add", params);
}

/// A failed run, with the provider's or the engine's own reason.
fn failed(reason: &str) -> String {
    trf("The agent could not finish: {reason}", &[("reason", &reason)])
}
