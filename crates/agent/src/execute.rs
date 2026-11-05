//! Turn driver: prompt → provider → parse → validate → one atomic batch. Parsing or
//! validation gets exactly one automatic retry with the error message; an engine
//! refusal returns at once (the batch already rolled the document back).

use serde_json::{Value, json};

use crate::context::ChatContext;
use crate::error::{Error, Result};
use crate::plan::{Plan, Step, parse_plan};
use crate::provider::{ChatRequest, ChatResponse, Poll, Provider, RequestId};
use crate::validate::{MAX_COMMANDS, validate};
use crate::whitelist::prompt_section;

/// Default reply cap in tokens.
pub const DEFAULT_MAX_TOKENS: u32 = 2000;
/// Pump spins before a blocking caller gives up on a provider.
pub const MAX_SPINS: u32 = 10_000;

/// What one applied plan did, for the turn history.
#[derive(Clone, Debug)]
pub struct ApplyReport {
    /// The applied command ids in order.
    pub applied: Vec<String>,
    /// Layers the plan created, in step order (steps returning an `id`).
    pub created: Vec<u64>,
}

/// What one turn did.
#[derive(Clone, Debug)]
pub struct TurnReport {
    /// The applied command ids in order.
    pub applied: Vec<String>,
    /// Layers the plan created, in step order (steps returning an `id`).
    pub created: Vec<u64>,
    /// Provider attempts used (1, or 2 after the automatic retry).
    pub attempts: u32,
}

/// The system prompt: role, output format, rules, and the whitelisted commands with
/// their registry parameter docs.
pub fn build_system_prompt() -> Result<String> {
    Ok(format!(
        "You drive the Undesign design tool by returning ONE JSON plan. Reply with nothing \
         but this object: {{\"commands\": [{{\"command\": \"<id>\", \"params\": {{...}}}}]}}.\n\
         Rules: use only the commands below; at most {MAX_COMMANDS} steps; reuse ids earlier \
         steps returned with {{\"$step\": n}} (step numbers start at 0, default field `id`); \
         `motion.composition.create` returns `compositionId` and `motion.track.add` returns \
         `trackId`, so address those with {{\"$step\": n, \"field\": \"compositionId\"}} and \
         {{\"$step\": n, \"field\": \"trackId\"}}; keep every frame inside the composition's \
         duration; prefer interpolation \"linear\", use \"step\" for holds; create a \
         composition with the fps and duration the animation needs when the timeline \
         has none.\n\
         {}",
        prompt_section()?
    ))
}

/// Apply a validated plan as one undo step. On any failure the batch rolls back and
/// the document is untouched.
pub fn apply(session: &mut undesign_engine::Session, plan: &Plan) -> Result<ApplyReport> {
    let commands: Vec<Value> = plan.steps.iter().map(|Step { command, params }| json!({"command": command, "params": params})).collect();
    let out = session.execute("command.batch", &json!({"label": "Agent", "commands": commands}))?;
    let created = out.as_array().map(|steps| steps.iter().filter_map(|r| r.get("id").and_then(Value::as_u64)).collect()).unwrap_or_default();
    Ok(ApplyReport { applied: plan.steps.iter().map(|s| s.command.clone()).collect(), created })
}

/// Pump one request to an answer. Blocking callers (tests, a native worker) loop on
/// this; the UI instead polls once per frame and never calls it.
pub fn pump(provider: &mut impl Provider, id: RequestId, max_spins: u32) -> Result<ChatResponse> {
    for _ in 0..max_spins {
        match provider.poll(id) {
            Poll::Done(response) => return Ok(response),
            Poll::Failed(message) => return Err(Error::Provider(message)),
            Poll::Pending => {}
        }
    }
    Err(Error::Provider("the provider never answered".into()))
}

/// Run one turn: ask the provider, parse and validate (one automatic retry with the
/// error when the reply is not a usable plan), then apply atomically.
pub fn run_turn(session: &mut undesign_engine::Session, provider: &mut impl Provider, prompt: &str, max_tokens: u32) -> Result<TurnReport> {
    let context = ChatContext::from_session(session).render();
    let system = build_system_prompt()?;
    let mut user = format!("{prompt}\n{context}");
    let mut attempts = 0;
    loop {
        attempts += 1;
        let id = provider.start(ChatRequest { system: system.clone(), user: user.clone(), max_tokens })?;
        let reply = pump(provider, id, MAX_SPINS)?;
        match parse_plan(&reply.text).and_then(validate).and_then(|plan| apply(session, &plan)) {
            Ok(report) => return Ok(TurnReport { applied: report.applied, created: report.created, attempts }),
            // The batch already rolled back; retrying the same plan cannot help.
            Err(Error::Engine(e)) => return Err(Error::Engine(e)),
            Err(other) if attempts < 2 => {
                user = format!("{prompt}\n{context}\nYour last reply was unusable ({other}). Reply with nothing but a fixed JSON plan.");
            }
            Err(other) => return Err(other),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::FakeProvider;

    const RECT: &str = r#"{"commands": [{"command": "shape.rectangle", "params": {"x": 0, "y": 0, "width": 10, "height": 10}}]}"#;

    fn node_count(session: &undesign_engine::Session) -> usize {
        session.page().ok().and_then(|p| session.doc().ok()?.node(p).map(|n| n.children.len())).unwrap_or(0)
    }

    #[test]
    fn turn_applies_and_undoes_as_one_step() {
        let mut session = undesign_engine::Session::new();
        let before = node_count(&session);
        let mut provider = FakeProvider::replies(&[RECT]);
        let report = run_turn(&mut session, &mut provider, "a rectangle", 500).unwrap();
        assert_eq!(report.applied, vec!["shape.rectangle"]);
        assert_eq!(report.attempts, 1);
        assert_eq!(node_count(&session), before + 1);
        assert!(session.undo().unwrap());
        assert_eq!(node_count(&session), before);
    }

    #[test]
    fn turn_report_lists_created_layers() {
        let mut session = undesign_engine::Session::new();
        let mut provider = FakeProvider::replies(&[RECT]);
        let report = run_turn(&mut session, &mut provider, "a rectangle", 500).unwrap();
        assert_eq!(report.created.len(), 1);
        assert!(session.doc().unwrap().node(undesign_doc::NodeId(report.created[0])).is_some());
    }

    #[test]
    fn invalid_json_retries_once_with_the_error() {
        let mut session = undesign_engine::Session::new();
        let before = node_count(&session);
        let mut provider = FakeProvider::replies(&["not json", RECT]);
        let report = run_turn(&mut session, &mut provider, "a rectangle", 500).unwrap();
        assert_eq!(report.attempts, 2);
        assert_eq!(provider.seen.len(), 2);
        assert!(provider.seen[1].user.contains("unusable"));
        assert_eq!(node_count(&session), before + 1);
    }

    #[test]
    fn engine_refusal_rolls_back_and_does_not_retry() {
        let mut session = undesign_engine::Session::new();
        let before = node_count(&session);
        let bad = r#"{"commands": [
            {"command": "shape.rectangle", "params": {"x": 0, "y": 0, "width": 10, "height": 10}},
            {"command": "motion.keyframe.set", "params": {"compositionId": 424242, "trackId": 1, "frame": 0, "value": 0.0}}
        ]}"#;
        let mut provider = FakeProvider::replies(&[bad]);
        let Err(Error::Engine(_)) = run_turn(&mut session, &mut provider, "doomed", 500) else { panic!("want the engine error") };
        assert_eq!(provider.seen.len(), 1, "no retry after an engine refusal");
        assert_eq!(node_count(&session), before, "the batch rolled back");
    }

    #[test]
    fn keyframes_land_on_the_timeline() {
        let mut session = undesign_engine::Session::new();
        let plan = r#"{"commands": [
            {"command": "shape.rectangle", "params": {"x": 0, "y": 0, "width": 10, "height": 10}},
            {"command": "motion.composition.create", "params": {"name": "Bounce", "fps": 30, "durationFrames": 60}},
            {"command": "motion.track.add", "params": {"compositionId": {"$step": 1, "field": "compositionId"}, "target": {"$step": 0}, "property": "positionY"}},
            {"command": "motion.keyframe.set", "params": {"compositionId": {"$step": 1, "field": "compositionId"}, "trackId": {"$step": 2, "field": "trackId"}, "frame": 0, "value": 0.0}},
            {"command": "motion.keyframe.set", "params": {"compositionId": {"$step": 1, "field": "compositionId"}, "trackId": {"$step": 2, "field": "trackId"}, "frame": 30, "value": 100.0, "interpolation": "step"}}
        ]}"#;
        let mut provider = FakeProvider::replies(&[plan]);
        run_turn(&mut session, &mut provider, "a bounce", 1000).unwrap();
        let doc = session.doc().unwrap();
        assert_eq!(doc.motion.compositions.len(), 1);
        let comp = &doc.motion.compositions[0];
        assert_eq!(comp.tracks.len(), 1);
        assert_eq!(comp.tracks[0].keyframes.len(), 2);
    }

    #[test]
    fn system_prompt_carries_the_registry_docs() {
        let prompt = build_system_prompt().unwrap();
        assert!(prompt.contains("shape.rectangle"));
        assert!(prompt.contains("motion.keyframe.set"));
        assert!(prompt.contains("$step"));
        assert!(prompt.contains("\"field\": \"compositionId\""));
        assert!(prompt.contains("\"field\": \"trackId\""));
    }
}
