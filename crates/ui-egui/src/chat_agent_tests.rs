//! The agent as a group chat participant, driven headless through egui: `/agent <prompt>`
//! in the Chat composer runs one plan turn and posts the outcome as an anchored chat thread;
//! failures, retries, a missing provider and a page switch mid-run all answer in chat.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;

use egui::{Event, Key, Modifiers, Pos2};
use serde_json::{Value, json};
use undesign_engine::Session;

use crate::agent::{AgentMessage, AgentRole};
use crate::agent_provider::{AgentProviderReply, AgentProviderTask};
use crate::present_tests::Ui;
use crate::{Services, chat_agent};

const RECT: &str = r#"{"commands": [{"command": "shape.rectangle", "params": {"x": 0, "y": 0, "width": 10, "height": 10}}]}"#;

#[derive(Default)]
struct Script {
    requests: Vec<Value>,
    script: VecDeque<Result<String, String>>,
    open: Vec<std::sync::mpsc::Sender<Result<AgentProviderReply, String>>>,
}

struct AgentServices {
    script: Rc<RefCell<Script>>,
    connected: bool,
}

fn reply_with(text: &str) -> AgentProviderReply {
    AgentProviderReply {
        message: AgentMessage { role: AgentRole::Assistant, content: text.to_string(), tool_calls: Vec::new(), tool_call_id: None, name: None },
        tool_calls: Vec::new(),
    }
}

impl Services for AgentServices {
    fn agent_provider_connected(&self) -> bool {
        self.connected
    }

    fn agent_provider_model(&self) -> Option<&str> {
        Some("test-model")
    }

    fn request_agent_completion(&mut self, request: Value) -> Result<AgentProviderTask, String> {
        let mut script = self.script.borrow_mut();
        script.requests.push(request);
        let (tx, rx) = std::sync::mpsc::channel();
        match script.script.pop_front() {
            Some(Ok(text)) => tx.send(Ok(reply_with(&text))).map_err(|_| "the test hung up".to_string())?,
            Some(Err(message)) => tx.send(Err(message)).map_err(|_| "the test hung up".to_string())?,
            None => script.open.push(tx),
        }
        Ok(AgentProviderTask::new(rx))
    }
}

fn harness(script: Vec<Result<String, String>>, connected: bool) -> (Ui, Rc<RefCell<Script>>) {
    let mut u = Ui::new(Session::new());
    let shared = Rc::new(RefCell::new(Script { script: script.into(), ..Script::default() }));
    u.app.services = Box::new(AgentServices { script: Rc::clone(&shared), connected });
    u.app.ui.chat_open = true;
    u.app.ui.right_tab = crate::RightTab::Design;
    u.frames(20, Vec::new);
    (u, shared)
}

fn click(u: &mut Ui, p: Pos2) {
    u.button(p, true);
    u.button(p, false);
    u.frame(vec![]);
}

fn key(u: &mut Ui, key: Key, modifiers: Modifiers) {
    let k = |pressed| Event::Key { key, physical_key: None, pressed, repeat: false, modifiers };
    u.frame(vec![k(true), k(false)]);
    u.frame(vec![]);
}

/// Post `text` through the Chat composer.
fn say(u: &mut Ui, text: &str) {
    let out = u.frame_output(vec![]);
    let shapes: Vec<_> = out.shapes.into_iter().map(|s| s.shape).collect();
    let field = crate::live_tests::text_center(&shapes, "Message the group");
    click(u, field);
    u.frame(vec![Event::Text(text.into())]);
    key(u, Key::Enter, Modifiers::NONE);
}

fn agent_threads(u: &Ui) -> Vec<undesign_doc::Comment> {
    u.app.session.doc().unwrap().comments.iter().filter(|c| c.chat && c.first.author == chat_agent::AGENT_NAME).cloned().collect()
}

#[test]
fn agent_answers_in_chat_anchored_to_what_it_made() {
    let (mut u, shared) = harness(vec![Ok(RECT.to_string())], true);
    say(&mut u, "/agent a small square");
    u.frame(vec![]);
    let threads = agent_threads(&u);
    assert_eq!(threads.len(), 1);
    assert!(threads[0].first.text.contains("Agent applied: shape.rectangle"), "{}", threads[0].first.text);
    let target = threads[0].anchor.expect("the reply anchors to the made layer");
    let doc = u.app.session.doc().unwrap();
    assert!(doc.node(target).is_some());
    let requests = &shared.borrow().requests;
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0]["response_format"]["type"], "json_object");
    let user = requests[0]["messages"][1]["content"].as_str().unwrap_or_default();
    assert!(user.contains("a small square"), "the prompt reaches the provider");
    assert!(user.contains("Canvas:"), "with the minimal context");
    assert!(u.app.ui.comments.agent.is_none(), "the run is done");
}

#[test]
fn normal_messages_never_start_a_run() {
    let (mut u, shared) = harness(vec![], true);
    say(&mut u, "hello group");
    u.frame(vec![]);
    assert!(u.app.ui.comments.agent.is_none());
    assert!(shared.borrow().requests.is_empty());
    assert!(agent_threads(&u).is_empty());
}

#[test]
fn bare_agent_command_shows_usage() {
    let (mut u, shared) = harness(vec![], true);
    say(&mut u, "/agent");
    u.frame(vec![]);
    assert!(shared.borrow().requests.is_empty(), "no request without a prompt");
    let threads = agent_threads(&u);
    assert_eq!(threads.len(), 1);
    assert!(threads[0].first.text.contains("/agent add a primary button"), "{}", threads[0].first.text);
}

#[test]
fn agent_without_a_provider_points_to_the_agent_tab() {
    let (mut u, shared) = harness(vec![], false);
    say(&mut u, "/agent a square");
    u.frame(vec![]);
    assert!(shared.borrow().requests.is_empty(), "no request is sent");
    let threads = agent_threads(&u);
    assert_eq!(threads.len(), 1);
    assert_eq!(threads[0].first.text, "Connect a provider before sending a request.");
}

#[test]
fn bad_plan_retries_once_then_posts() {
    let (mut u, shared) = harness(vec![Ok("not json".to_string()), Ok(RECT.to_string())], true);
    say(&mut u, "/agent a square");
    u.frames(5, Vec::new);
    let shared = shared.borrow();
    assert_eq!(shared.requests.len(), 2);
    assert!(shared.requests[1]["messages"][1]["content"].as_str().unwrap_or_default().contains("unusable"));
    assert_eq!(agent_threads(&u).len(), 1);
}

#[test]
fn provider_failure_posts_the_reason() {
    let (mut u, _) = harness(vec![Err("offline".to_string())], true);
    say(&mut u, "/agent a square");
    u.frame(vec![]);
    let threads = agent_threads(&u);
    assert_eq!(threads.len(), 1);
    assert_eq!(threads[0].first.text, "The agent could not finish: offline");
}

#[test]
fn switching_page_abandons_the_run() {
    let (mut u, shared) = harness(vec![], true);
    say(&mut u, "/agent a square");
    u.frame(vec![]);
    assert!(u.app.ui.comments.agent.is_some(), "the run waits for its reply");
    let out = u.frame_output(vec![]);
    let shapes: Vec<_> = out.shapes.into_iter().map(|s| s.shape).collect();
    assert!(crate::live_tests::has_text(&shapes, "Agent is thinking..."));
    let other = u.app.session.execute("page.add", &json!({})).unwrap()["id"].as_u64().unwrap();
    u.app.session.execute("page.select", &json!({"id": other})).unwrap();
    u.frame(vec![]);
    assert!(u.app.ui.comments.agent.is_none());
    assert_eq!(agent_threads(&u).len(), 1);
    assert!(agent_threads(&u)[0].first.text.contains("Nothing was applied"), "{}", agent_threads(&u)[0].first.text);
    assert_eq!(shared.borrow().requests.len(), 1, "no retry after the scope changed");
}

#[test]
fn agent_undo_takes_back_the_reply_and_the_turn() {
    let (mut u, _) = harness(vec![Ok(RECT.to_string())], true);
    say(&mut u, "/agent a square");
    u.frame(vec![]);
    assert_eq!(agent_threads(&u).len(), 1);
    let target = agent_threads(&u)[0].anchor.expect("an anchored reply");
    let out = u.frame_output(vec![]);
    let shapes: Vec<_> = out.shapes.into_iter().map(|s| s.shape).collect();
    assert!(crate::live_tests::has_text(&shapes, "Undo"));
    let undo = crate::live_tests::text_center(&shapes, "Undo");
    click(&mut u, undo);
    u.frames(3, Vec::new);
    assert!(u.app.session.doc().unwrap().node(target).is_none(), "the made layer is gone");
    assert!(agent_threads(&u).is_empty(), "the reply is gone too");
    let out = u.frame_output(vec![]);
    let shapes: Vec<_> = out.shapes.into_iter().map(|s| s.shape).collect();
    assert!(!crate::live_tests::has_text(&shapes, "Undo"), "nothing left to take back");
}

#[test]
fn agent_undo_hides_once_something_else_runs() {
    let (mut u, _) = harness(vec![Ok(RECT.to_string())], true);
    say(&mut u, "/agent a square");
    u.frame(vec![]);
    say(&mut u, "noted");
    u.frame(vec![]);
    let out = u.frame_output(vec![]);
    let shapes: Vec<_> = out.shapes.into_iter().map(|s| s.shape).collect();
    assert!(!crate::live_tests::has_text(&shapes, "Undo"));
    assert_eq!(agent_threads(&u).len(), 1, "the turn itself is untouched");
}
