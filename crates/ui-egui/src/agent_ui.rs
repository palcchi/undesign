//! Provider setup, chat, and explicit review controls for the Agent panel.

use std::sync::mpsc::TryRecvError;
use std::time::Duration;

use egui::{RichText, Ui};
use serde_json::json;
use undesign_doc::NodeId;
use undesign_engine::Session;
use zeroize::Zeroizing;

use crate::FigApp;
use crate::a11y;
use crate::agent::{AgentBackend, AgentConversation, AgentMessage, AgentProposal, AgentRole, AgentToolCall, AgentToolResult};
use crate::agent_provider::{
    AgentProviderAvailability, AgentProviderConfig, AgentProviderTask, AgentSecret, build_openai_request, validate_model_id,
};
use crate::i18n::tr;
use crate::theme::{Tokens, regular, semibold};
use crate::widgets;

const MAX_VISIBLE_MESSAGES: usize = 40;
const MAX_PROMPT_BYTES: usize = 16 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PageScope {
    document_uid: u64,
    revision: u64,
    page: NodeId,
}

/// Chat and form state is scoped to this app session and is never serialized.
pub struct AgentPanelState {
    endpoint: String,
    model: String,
    api_key_draft: Zeroizing<String>,
    prompt: String,
    skill_id: String,
    conversation: AgentConversation,
    page_scope: Option<(u64, NodeId)>,
    pending: Option<AgentProviderTask>,
    pending_scope: Option<PageScope>,
    pending_skill: Option<String>,
    pending_allow_tools: bool,
    proposal: Option<AgentProposal>,
    error: Option<String>,
    status: Option<String>,
}

impl Default for AgentPanelState {
    fn default() -> Self {
        Self {
            endpoint: String::new(),
            model: String::new(),
            api_key_draft: Zeroizing::new(String::new()),
            prompt: String::new(),
            skill_id: "design".to_string(),
            conversation: AgentConversation::default(),
            page_scope: None,
            pending: None,
            pending_scope: None,
            pending_skill: None,
            pending_allow_tools: true,
            proposal: None,
            error: None,
            status: None,
        }
    }
}

pub fn panel(app: &mut FigApp, ui: &mut Ui) {
    let ctx = ui.ctx().clone();
    sync_page_scope(&mut app.agent_panel, &app.session);
    discard_stale_work(&mut app.agent_panel, &app.session);
    poll_provider(app, &ctx);

    let t = Tokens::get(ui.ctx());
    ui.add_space(8.0);
    ui.label(RichText::new(tr("Agent")).font(semibold(14.0)).color(t.text));
    ui.add_space(7.0);
    draw_skill_switch(app, ui);
    ui.add_space(8.0);

    match app.services.agent_provider_availability() {
        AgentProviderAvailability::BrowserRelayRequired => {
            unavailable(ui, tr("Browser provider setup is disabled until a secure server relay is available. This browser does not store API keys."));
            return;
        }
        AgentProviderAvailability::MissingCurl => {
            unavailable(ui, tr("Native provider setup needs the system curl command."));
            return;
        }
        AgentProviderAvailability::Unsupported => {
            unavailable(ui, tr("Provider setup is not available on this platform."));
            return;
        }
        AgentProviderAvailability::NativeOpenAiCompatible => {}
    }

    if app.services.agent_provider_connected() {
        draw_connected(app, ui);
    } else {
        draw_setup(app, ui);
        return;
    }

    ui.add_space(8.0);
    draw_conversation(&app.agent_panel, ui);
    if app.agent_panel.proposal.is_some() {
        ui.add_space(8.0);
        draw_proposal(app, ui);
    }
    ui.add_space(8.0);
    draw_composer(app, ui, &ctx);
    draw_feedback(&app.agent_panel, ui);
}

fn unavailable(ui: &mut Ui, message: &str) {
    let t = Tokens::get(ui.ctx());
    ui.label(RichText::new(tr("OpenAI-compatible Chat Completions only")).font(semibold(10.5)).color(t.text));
    ui.add_space(5.0);
    ui.label(RichText::new(message).size(10.5).color(t.text_secondary));
    ui.add_space(5.0);
    ui.label(RichText::new(tr("No provider is configured. No request is sent.")).size(9.5).color(t.text_tertiary));
}

fn draw_skill_switch(app: &mut FigApp, ui: &mut Ui) {
    let busy = app.agent_panel.pending.is_some() || app.agent_panel.proposal.is_some();
    ui.horizontal(|ui| {
        for (id, label) in [("design", tr("Design")), ("motion", tr("Motion"))] {
            let selected = app.agent_panel.skill_id == id;
            let response = widgets::button(ui, label, selected, !busy);
            a11y::tab(&response, label, selected);
            if response.clicked() && !busy {
                app.agent_panel.skill_id = id.to_string();
                app.agent_panel.error = None;
                app.agent_panel.status = None;
            }
        }
    });
}

fn draw_setup(app: &mut FigApp, ui: &mut Ui) {
    let t = Tokens::get(ui.ctx());
    ui.label(RichText::new(tr("OpenAI-compatible Chat Completions only")).font(semibold(10.5)).color(t.text));
    ui.add_space(3.0);
    ui.label(
        RichText::new(tr("Enter a full chat-completions URL, model ID, and API key. No model is preselected.")).size(9.5).color(t.text_secondary),
    );
    ui.label(
        RichText::new(tr("No shared or default provider is used. Connect your own endpoint, model ID, and key.")).size(9.5).color(t.text_secondary),
    );
    ui.add_space(7.0);

    ui.label(RichText::new(tr("Chat completions URL")).font(semibold(10.0)).color(t.text));
    let field_width = ui.available_width();
    let endpoint = ui.add(
        egui::TextEdit::singleline(&mut app.agent_panel.endpoint)
            .hint_text(tr("https://provider.example/v1/chat/completions"))
            .desired_width(field_width),
    );
    a11y::text(&endpoint, tr("Chat completions URL"), &app.agent_panel.endpoint);

    ui.add_space(5.0);
    ui.label(RichText::new(tr("Model ID")).font(semibold(10.0)).color(t.text));
    let field_width = ui.available_width();
    let model = ui.add(egui::TextEdit::singleline(&mut app.agent_panel.model).hint_text(tr("Enter a model ID")).desired_width(field_width));
    a11y::text(&model, tr("Model ID"), &app.agent_panel.model);

    ui.add_space(5.0);
    ui.label(RichText::new(tr("API key")).font(semibold(10.0)).color(t.text));
    let field_width = ui.available_width();
    let key = ui.add(
        egui::TextEdit::singleline(&mut *app.agent_panel.api_key_draft)
            .password(true)
            .hint_text(tr("Paste your own API key"))
            .desired_width(field_width),
    );
    let accessible_key = if app.agent_panel.api_key_draft.is_empty() { "" } else { "••••••" };
    a11y::text(&key, tr("API key"), accessible_key);

    ui.add_space(5.0);
    ui.label(
        RichText::new(tr("The key stays in memory for this session and is not saved. HTTPS is required except for loopback local servers."))
            .size(9.5)
            .color(t.text_secondary),
    );
    ui.label(
        RichText::new(tr("No request is sent until you press Send. That sends your prompt and bounded current-page context to this endpoint."))
            .size(9.5)
            .color(t.text_secondary),
    );
    ui.add_space(8.0);

    let ready = !app.agent_panel.endpoint.trim().is_empty() && !app.agent_panel.model.trim().is_empty() && !app.agent_panel.api_key_draft.is_empty();
    let connect = widgets::button(ui, tr("Connect"), true, ready);
    a11y::status(&connect, tr("Connect"), tr("Enter an endpoint, model ID, and API key."));
    if connect.clicked() && ready {
        connect_provider(app);
    }
    draw_feedback(&app.agent_panel, ui);
}

fn draw_connected(app: &mut FigApp, ui: &mut Ui) {
    let t = Tokens::get(ui.ctx());
    let model = app.services.agent_provider_model().unwrap_or("");
    ui.horizontal_wrapped(|ui| {
        ui.label(RichText::new(tr("Configured for this session")).font(semibold(10.5)).color(t.text));
        if !model.is_empty() {
            ui.label(RichText::new(model).size(9.5).color(t.text_secondary));
        }
    });
    ui.label(
        RichText::new(tr("The endpoint has not been contacted yet. Press Send to transmit the prompt and bounded current-page context."))
            .size(9.5)
            .color(t.text_secondary),
    );
    ui.label(RichText::new(tr("The API key stays in memory only. Disconnect or close the app to clear it.")).size(9.5).color(t.text_secondary));
    ui.label(
        RichText::new(tr("Only OpenAI-compatible Chat Completions are supported. Other provider APIs are not supported by this adapter."))
            .size(9.5)
            .color(t.text_secondary),
    );
    ui.add_space(5.0);
    let disconnect = widgets::button(ui, tr("Disconnect"), false, app.agent_panel.pending.is_none());
    a11y::status(&disconnect, tr("Disconnect"), tr("Wait for the current request to finish before disconnecting."));
    if disconnect.clicked() && app.agent_panel.pending.is_none() {
        app.services.disconnect_agent_provider();
        app.agent_panel.pending = None;
        app.agent_panel.pending_scope = None;
        app.agent_panel.pending_skill = None;
        app.agent_panel.proposal = None;
        app.agent_panel.conversation.clear();
        app.agent_panel.prompt.clear();
        app.agent_panel.error = None;
        app.agent_panel.status = Some(tr("Provider disconnected. No more requests will be sent.").to_string());
    }
}

fn draw_conversation(state: &AgentPanelState, ui: &mut Ui) {
    let t = Tokens::get(ui.ctx());
    ui.label(RichText::new(tr("Conversation")).font(semibold(10.5)).color(t.text));
    if state.conversation.messages().is_empty() {
        ui.add_space(3.0);
        ui.label(RichText::new(tr("No messages yet. Ask about this page or request a Design or Motion change.")).size(9.5).color(t.text_secondary));
        return;
    }
    let messages = state.conversation.messages();
    let start = messages.len().saturating_sub(MAX_VISIBLE_MESSAGES);
    for message in &messages[start..] {
        if message.role == AgentRole::Tool {
            continue;
        }
        ui.add_space(4.0);
        let role = if message.role == AgentRole::User { tr("You") } else { tr("Assistant") };
        ui.label(RichText::new(role).font(semibold(9.5)).color(t.text_secondary));
        egui::Frame::NONE
            .fill(if message.role == AgentRole::User { t.field } else { t.panel })
            .stroke(egui::Stroke::new(1.0, t.border))
            .corner_radius(egui::CornerRadius::same(8))
            .inner_margin(8.0)
            .show(ui, |ui| {
                ui.label(RichText::new(&message.content).size(10.5).color(t.text));
            });
    }
}

fn draw_proposal(app: &mut FigApp, ui: &mut Ui) {
    let t = Tokens::get(ui.ctx());
    let Some(proposal) = app.agent_panel.proposal.as_ref() else { return };
    ui.label(RichText::new(tr("Proposed changes")).font(semibold(11.0)).color(t.text));
    ui.label(RichText::new(tr("Review each operation. Apply runs them as one undoable batch.")).size(9.5).color(t.text_secondary));
    for change in proposal.changes() {
        ui.add_space(5.0);
        ui.label(RichText::new(&change.summary).font(semibold(10.0)).color(t.text));
        if !change.targets.is_empty() {
            let targets = change.targets.iter().map(|id| id.0.to_string()).collect::<Vec<_>>().join(", ");
            ui.label(RichText::new(format!("{} {targets}", tr("Target layers:"))).size(9.5).color(t.text_secondary));
        }
        let details = serde_json::to_string(&change.details).unwrap_or_else(|_| "{}".to_string());
        ui.label(RichText::new(details).font(regular(9.0)).color(t.text_secondary));
    }
    ui.add_space(7.0);
    let mut apply = false;
    let mut reject = false;
    ui.horizontal_wrapped(|ui| {
        let response = widgets::button(ui, tr("Apply proposal"), true, true);
        a11y::status(&response, tr("Apply proposal"), tr("Apply these operations as one undoable batch."));
        apply = response.clicked();
        let response = widgets::button(ui, tr("Reject"), false, true);
        a11y::status(&response, tr("Reject"), tr("Discard the proposal without changing the document."));
        reject = response.clicked();
    });
    if apply {
        apply_proposal(app);
    } else if reject {
        reject_proposal(app);
    }
}

fn draw_composer(app: &mut FigApp, ui: &mut Ui, ctx: &egui::Context) {
    let t = Tokens::get(ui.ctx());
    let blocked = app.agent_panel.pending.is_some() || app.agent_panel.proposal.is_some();
    ui.label(RichText::new(tr("Message")).font(semibold(10.0)).color(t.text));
    let composer_width = ui.available_width();
    let composer = ui.add_enabled(
        !blocked,
        egui::TextEdit::multiline(&mut app.agent_panel.prompt)
            .desired_rows(3)
            .hint_text(tr("Ask for a design or motion change"))
            .desired_width(composer_width),
    );
    a11y::text(&composer, tr("Message"), &app.agent_panel.prompt);
    ui.add_space(5.0);
    let can_send = !blocked && !app.agent_panel.prompt.trim().is_empty() && current_scope(&app.session).is_some();
    let send = widgets::button(ui, tr("Send"), true, can_send);
    a11y::status(&send, tr("Send"), tr("Connect a provider and enter a message before sending."));
    if send.clicked() && can_send {
        submit_prompt(app, ctx);
    }
}

fn draw_feedback(state: &AgentPanelState, ui: &mut Ui) {
    let t = Tokens::get(ui.ctx());
    if let Some(error) = &state.error {
        ui.add_space(5.0);
        ui.label(RichText::new(error).size(9.5).color(t.text));
    }
    if let Some(status) = &state.status {
        ui.add_space(5.0);
        ui.label(RichText::new(status).size(9.5).color(t.text_secondary));
    }
}

fn connect_provider(app: &mut FigApp) {
    let endpoint = app.agent_panel.endpoint.trim().to_string();
    let model = app.agent_panel.model.trim().to_string();
    if endpoint.is_empty() {
        app.agent_panel.error = Some(tr("Enter a chat-completions URL.").to_string());
        return;
    }
    if let Err(error) = validate_model_id(&model) {
        app.agent_panel.error = Some(error);
        return;
    }
    let key = std::mem::take(&mut *app.agent_panel.api_key_draft);
    let secret = match AgentSecret::from_input(key) {
        Ok(secret) => secret,
        Err(error) => {
            app.agent_panel.error = Some(error);
            return;
        }
    };
    let config = AgentProviderConfig::new(endpoint, model.clone(), secret);
    match app.services.connect_agent_provider(config) {
        Ok(()) => {
            app.agent_panel.error = None;
            app.agent_panel.status =
                Some(tr("Configured for this session. The endpoint has not been contacted; press Send to make a request.").to_string());
        }
        Err(error) => {
            app.agent_panel.error = Some(error);
            app.agent_panel.status = None;
        }
    }
}

fn submit_prompt(app: &mut FigApp, ctx: &egui::Context) {
    if !app.services.agent_provider_connected() || app.agent_panel.pending.is_some() || app.agent_panel.proposal.is_some() {
        return;
    }
    let Some(scope) = current_scope(&app.session) else {
        app.agent_panel.error = Some(tr("Open a document before sending a message.").to_string());
        return;
    };
    let prompt = std::mem::take(&mut app.agent_panel.prompt).trim().to_string();
    if prompt.is_empty() {
        return;
    }
    if prompt.len() > MAX_PROMPT_BYTES {
        app.agent_panel.error = Some(tr("The message is too long.").to_string());
        app.agent_panel.prompt = prompt;
        return;
    }
    let message = AgentMessage { role: AgentRole::User, content: prompt, tool_calls: Vec::new(), tool_call_id: None, name: None };
    if let Err(error) = app.agent_panel.conversation.push(message) {
        app.agent_panel.error = Some(error.to_string());
        return;
    }
    app.agent_panel.error = None;
    let skill = app.agent_panel.skill_id.clone();
    start_provider_request(app, ctx, scope, &skill, true);
}

fn start_provider_request(app: &mut FigApp, ctx: &egui::Context, scope: PageScope, skill: &str, allow_tools: bool) {
    if !app.services.agent_provider_connected() {
        report_request_failure(&mut app.agent_panel, tr("Connect a provider before sending a request.").to_string());
        return;
    }
    let Some(model) = app.services.agent_provider_model().map(str::to_string) else {
        report_request_failure(&mut app.agent_panel, tr("The provider has no model ID. Disconnect and set it again.").to_string());
        return;
    };
    let context = match AgentBackend::context(&app.session) {
        Ok(context) => context,
        Err(error) => {
            report_request_failure(&mut app.agent_panel, error.to_string());
            return;
        }
    };
    let request = match build_openai_request(&model, skill, &app.agent_panel.conversation, &context, allow_tools) {
        Ok(request) => request,
        Err(error) => {
            report_request_failure(&mut app.agent_panel, error);
            return;
        }
    };
    match app.services.request_agent_completion(request) {
        Ok(task) => {
            app.agent_panel.pending = Some(task);
            app.agent_panel.pending_scope = Some(scope);
            app.agent_panel.pending_skill = Some(skill.to_string());
            app.agent_panel.pending_allow_tools = allow_tools;
            app.agent_panel.error = None;
            app.agent_panel.status = Some(tr("Waiting for the provider response...").to_string());
            ctx.request_repaint_after(Duration::from_millis(100));
        }
        Err(error) => {
            report_request_failure(&mut app.agent_panel, error);
            app.agent_panel.status = None;
        }
    }
}

fn poll_provider(app: &mut FigApp, ctx: &egui::Context) {
    let Some(scope) = current_scope(&app.session) else { return };
    if app.agent_panel.pending.is_some() && app.agent_panel.pending_scope != Some(scope) {
        app.agent_panel.pending = None;
        app.agent_panel.pending_scope = None;
        app.agent_panel.pending_skill = None;
        app.agent_panel.conversation.clear();
        app.agent_panel.status =
            Some(tr("The document changed while the assistant was working. Nothing was applied. Send your prompt again.").to_string());
        app.agent_panel.error = None;
        return;
    }
    let Some(task) = app.agent_panel.pending.take() else { return };
    match task.try_recv() {
        Ok(Ok(reply)) => {
            let skill = app.agent_panel.pending_skill.take().unwrap_or_else(|| app.agent_panel.skill_id.clone());
            let allow_tools = app.agent_panel.pending_allow_tools;
            app.agent_panel.pending_scope = None;
            app.agent_panel.status = None;
            handle_response(app, ctx, &skill, allow_tools, reply, scope);
        }
        Ok(Err(error)) => {
            app.agent_panel.pending_scope = None;
            app.agent_panel.pending_skill = None;
            app.agent_panel.status = None;
            report_request_failure(&mut app.agent_panel, error);
        }
        Err(TryRecvError::Empty) => {
            app.agent_panel.pending = Some(task);
            ctx.request_repaint_after(Duration::from_millis(100));
        }
        Err(TryRecvError::Disconnected) => {
            app.agent_panel.pending_scope = None;
            app.agent_panel.pending_skill = None;
            app.agent_panel.status = None;
            report_request_failure(&mut app.agent_panel, tr("The provider request ended before a response arrived.").to_string());
        }
    }
}

fn handle_response(
    app: &mut FigApp,
    ctx: &egui::Context,
    skill: &str,
    allow_tools: bool,
    reply: crate::agent_provider::AgentProviderReply,
    scope: PageScope,
) {
    let calls = reply.tool_calls;
    if let Err(error) = app.agent_panel.conversation.push(reply.message) {
        app.agent_panel.conversation.clear();
        app.agent_panel.error = Some(error.to_string());
        return;
    }
    if calls.is_empty() {
        return;
    }
    if !allow_tools {
        let message = tr("The provider returned an extra tool call after inspection. No changes were applied.");
        if add_tool_errors(&mut app.agent_panel.conversation, &calls, message).is_err() {
            app.agent_panel.conversation.clear();
        }
        if append_assistant_note(&mut app.agent_panel.conversation, message).is_err() {
            app.agent_panel.conversation.clear();
        }
        app.agent_panel.error = Some(tr("The provider returned an extra tool call after inspection. No changes were applied.").to_string());
        return;
    }
    let turn = match AgentBackend::prepare(&app.session, skill, &calls) {
        Ok(turn) => turn,
        Err(error) => {
            let message = format!("{} {}", tr("The requested operation was not available or could not be validated."), error);
            if add_tool_errors(&mut app.agent_panel.conversation, &calls, &message).is_err() {
                app.agent_panel.conversation.clear();
            }
            if append_assistant_note(&mut app.agent_panel.conversation, &message).is_err() {
                app.agent_panel.conversation.clear();
            }
            app.agent_panel.error = Some(message);
            return;
        }
    };
    if let Err(error) = append_tool_results(&mut app.agent_panel.conversation, &turn.results) {
        app.agent_panel.conversation.clear();
        app.agent_panel.error = Some(error);
        return;
    }
    if let Some(proposal) = turn.proposal {
        app.agent_panel.proposal = Some(proposal);
        app.agent_panel.status = Some(tr("Review the proposed changes before applying them.").to_string());
    } else if !turn.results.is_empty() {
        start_provider_request(app, ctx, scope, skill, false);
    }
}

fn append_tool_results(conversation: &mut AgentConversation, results: &[AgentToolResult]) -> Result<(), String> {
    for result in results {
        let content = serde_json::to_string(&result.result).map_err(|_| "Could not encode the local tool result.".to_string())?;
        let message = AgentMessage {
            role: AgentRole::Tool,
            content,
            tool_calls: Vec::new(),
            tool_call_id: Some(result.call_id.clone()),
            name: Some(result.name.clone()),
        };
        conversation.push(message).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn add_tool_errors(conversation: &mut AgentConversation, calls: &[AgentToolCall], message: &str) -> Result<(), String> {
    for call in calls {
        let result = AgentToolResult { call_id: call.id.clone(), name: call.name.clone(), result: json!({"error": message, "applied": false}) };
        append_tool_results(conversation, &[result])?;
    }
    Ok(())
}

fn append_assistant_note(conversation: &mut AgentConversation, text: &str) -> Result<(), String> {
    conversation
        .push(AgentMessage { role: AgentRole::Assistant, content: text.to_string(), tool_calls: Vec::new(), tool_call_id: None, name: None })
        .map_err(|error| error.to_string())
}

fn report_request_failure(state: &mut AgentPanelState, error: String) {
    if append_assistant_note(&mut state.conversation, tr("The provider request failed. No changes were applied.")).is_err() {
        state.conversation.clear();
    }
    state.error = Some(error);
}

fn apply_proposal(app: &mut FigApp) {
    let Some(proposal) = app.agent_panel.proposal.take() else { return };
    if !proposal.is_current(&app.session) {
        app.agent_panel.conversation.clear();
        app.agent_panel.error = None;
        app.agent_panel.status = Some(tr("The proposal is out of date. Nothing was applied. Send your prompt again.").to_string());
        return;
    }
    match AgentBackend::apply(&mut app.session, &proposal, true) {
        Ok(result) => {
            app.handle_ui_requests();
            match AgentBackend::applied_results(&proposal, &result) {
                Ok(results) => {
                    if append_tool_results(&mut app.agent_panel.conversation, &results).is_err() {
                        app.agent_panel.conversation.clear();
                    }
                }
                Err(error) => app.agent_panel.error = Some(error.to_string()),
            }
            if append_assistant_note(&mut app.agent_panel.conversation, tr("Applied as one undoable batch. Use Undo to reverse it.")).is_err() {
                app.agent_panel.conversation.clear();
            }
            app.agent_panel.status = Some(tr("Applied as one undoable batch. Use Undo to reverse it.").to_string());
            app.agent_panel.error = None;
        }
        Err(error) => {
            app.agent_panel.conversation.clear();
            app.agent_panel.error = None;
            app.agent_panel.status = Some(format!("{} {error}", tr("The proposal is out of date or could not be applied. Nothing was applied.")));
        }
    }
}

fn reject_proposal(app: &mut FigApp) {
    let Some(proposal) = app.agent_panel.proposal.take() else { return };
    for change in proposal.changes() {
        let result =
            AgentToolResult { call_id: change.call_id.clone(), name: change.tool.clone(), result: json!({"rejected": true, "applied": false}) };
        if append_tool_results(&mut app.agent_panel.conversation, &[result]).is_err() {
            app.agent_panel.conversation.clear();
        }
    }
    if append_assistant_note(&mut app.agent_panel.conversation, tr("Proposal rejected. No changes were applied.")).is_err() {
        app.agent_panel.conversation.clear();
    }
    app.agent_panel.error = None;
    app.agent_panel.status = Some(tr("Proposal rejected. No changes were applied.").to_string());
}

fn sync_page_scope(state: &mut AgentPanelState, session: &Session) {
    let next = current_scope(session).map(|scope| (scope.document_uid, scope.page));
    if let Some(previous) = state.page_scope
        && Some(previous) != next
    {
        state.conversation.clear();
        state.pending = None;
        state.pending_scope = None;
        state.pending_skill = None;
        state.proposal = None;
        state.error = None;
        state.status = Some(tr("The current page changed. The conversation was cleared.").to_string());
    }
    state.page_scope = next;
}

fn discard_stale_work(state: &mut AgentPanelState, session: &Session) {
    if state.pending.is_some() && state.pending_scope != current_scope(session) {
        state.pending = None;
        state.pending_scope = None;
        state.pending_skill = None;
        state.conversation.clear();
        state.error = None;
        state.status = Some(tr("The document changed while the assistant was working. Nothing was applied. Send your prompt again.").to_string());
    }
    if state.proposal.as_ref().is_some_and(|proposal| !proposal.is_current(session)) {
        state.proposal = None;
        state.conversation.clear();
        state.error = None;
        state.status = Some(tr("The proposal is out of date. Nothing was applied. Send your prompt again.").to_string());
    }
}

fn current_scope(session: &Session) -> Option<PageScope> {
    session.ds().ok().map(|state| PageScope { document_uid: state.uid, revision: state.revision, page: state.page })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use serde_json::Value;
    use undesign_engine::Session;

    use super::*;
    use crate::{FigApp, Services};

    struct CountingServices(Arc<AtomicUsize>);

    impl Services for CountingServices {
        fn request_agent_completion(&mut self, _request: Value) -> Result<AgentProviderTask, String> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Err("unexpected provider request".to_string())
        }
    }

    struct NativeSetupServices;

    impl Services for NativeSetupServices {
        fn agent_provider_availability(&self) -> AgentProviderAvailability {
            AgentProviderAvailability::NativeOpenAiCompatible
        }
    }

    #[test]
    fn api_key_accessibility_node_is_masked_and_keeps_label_role_and_focus() {
        use egui::accesskit::Role;
        use zeroize::Zeroizing;

        let mut ui = crate::layers_drag_tests::Ui::new(Session::new());
        ui.app.services = Box::new(NativeSetupServices);
        ui.app.ui.right_tab = crate::RightTab::Agent;
        let secret = "synthetic-accessibility-key";
        ui.app.agent_panel.api_key_draft = Zeroizing::new(secret.to_string());
        ui.ctx.enable_accesskit();
        ui.frame(vec![]);
        let output = ui.frame_output(vec![]);
        let nodes = output.platform_output.accesskit_update.expect("an AccessKit update").nodes;
        let point = {
            let node = nodes.iter().find(|(_, node)| node.role() == Role::TextInput && node.label() == Some("API key"));
            assert!(node.is_some(), "the API key remains a labelled text input");
            let (_, node) = node.unwrap();
            assert_eq!(node.value(), Some("••••••"));
            assert!(!format!("{node:?}").contains(secret));
            let bounds = node.bounds().expect("the API key has focusable bounds");
            egui::Pos2::new(((bounds.x0 + bounds.x1) / 2.0) as f32, ((bounds.y0 + bounds.y1) / 2.0) as f32)
        };

        ui.button(point, true);
        ui.button(point, false);
        ui.frame(vec![]);
        assert_eq!(crate::a11y::focused_name(&ui.ctx), "API key");
    }

    #[test]
    fn empty_provider_fields_have_no_shared_default_and_send_does_not_request_before_connect() {
        let state = AgentPanelState::default();
        assert!(state.endpoint.is_empty());
        assert!(state.model.is_empty());
        assert!(state.api_key_draft.is_empty());
        assert_eq!(state.skill_id, "design");

        let requests = Arc::new(AtomicUsize::new(0));
        let mut app = FigApp::new(Session::new(), Box::new(CountingServices(requests.clone())));
        app.agent_panel.prompt = "Create a frame".to_string();
        submit_prompt(&mut app, &egui::Context::default());
        assert_eq!(requests.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn page_scope_changes_clear_history_and_pending_proposals() {
        let mut state = AgentPanelState::default();
        let added = state.conversation.push(AgentMessage {
            role: AgentRole::User,
            content: "page A".to_string(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            name: None,
        });
        assert!(added.is_ok());
        let session = Session::new();
        let scope = current_scope(&session);
        assert!(scope.is_some());
        if let Some(scope) = scope {
            state.page_scope = Some((scope.document_uid, NodeId(scope.page.0.saturating_add(1))));
        }
        sync_page_scope(&mut state, &session);
        assert!(state.conversation.messages().is_empty());
    }
}
