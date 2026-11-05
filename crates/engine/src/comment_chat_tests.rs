//! Group chat threads: unpinned conversation stored in the document beside pinned comments.
//!
//! A chat thread is a comment thread with `chat` set: it has no pin on the canvas, takes no
//! canvas position unless it names an anchor, and opening one never pans to a meaningless spot.
//! Chat threads sync, keep read state and take replies like any other thread.

use serde_json::json;

use crate::Session;

fn add_chat(s: &mut Session, p: serde_json::Value) -> u64 {
    s.execute("comment.add", &p).unwrap()["id"].as_u64().unwrap()
}

#[test]
fn chat_posts_without_a_canvas_position() {
    let mut s = Session::new();
    let id = add_chat(&mut s, json!({"chat": true, "text": "Hello group"}));
    let c = s.doc().unwrap().comment(id).unwrap().clone();
    assert!(c.chat);
    assert_eq!((c.x, c.y), (0.0, 0.0));
    assert_eq!(c.anchor, None);
}

#[test]
fn chat_threads_join_and_leave_the_list_by_flag() {
    let mut s = Session::new();
    let pinned = s.execute("comment.add", &json!({"x": 10, "y": 10, "text": "On the canvas"})).unwrap()["id"].as_u64().unwrap();
    let chat = add_chat(&mut s, json!({"chat": true, "text": "In the group"}));
    let ids = |s: &mut Session, p: serde_json::Value| {
        s.execute("comment.list", &p).unwrap()["comments"].as_array().unwrap().iter().map(|c| c["id"].as_u64().unwrap()).collect::<Vec<_>>()
    };
    assert_eq!(ids(&mut s, json!({"chat": true})), vec![chat]);
    assert_eq!(ids(&mut s, json!({"chat": false})), vec![pinned]);
    let mut all = ids(&mut s, json!({}));
    all.sort_unstable();
    assert_eq!(all, {
        let mut both = vec![pinned, chat];
        both.sort_unstable();
        both
    });
}

#[test]
fn anchorless_chat_has_no_frame_and_opening_keeps_the_view() {
    let mut s = Session::new();
    let id = add_chat(&mut s, json!({"chat": true, "x": 5000.0, "y": 4000.0, "text": "From nowhere"}));
    let doc = s.doc().unwrap().clone();
    let c = doc.comment(id).unwrap();
    assert_eq!(crate::cmd::comment::frame_of(&doc, c), None);
    assert!(s.execute("comment.list", &json!({})).unwrap()["comments"].as_array().unwrap().iter().any(|v| v["id"] == id && v["chat"] == true));
    let (cx, cy) = {
        let ds = s.ds().unwrap();
        (ds.view.cx, ds.view.cy)
    };
    s.execute("comment.open", &json!({"id": id, "view": "center"})).unwrap();
    let ds = s.ds().unwrap();
    assert_eq!((ds.view.cx, ds.view.cy), (cx, cy), "opening an anchorless chat message leaves the canvas where it was");
}

#[test]
fn anchored_chat_keeps_its_target() {
    let mut s = Session::new();
    let target = s.execute("shape.rectangle", &json!({"x": 80, "y": 60, "width": 120, "height": 60})).unwrap()["id"].as_u64().unwrap();
    let target = undesign_doc::NodeId(target);
    let id = add_chat(&mut s, json!({"chat": true, "x": 100.0, "y": 80.0, "text": "About this one", "anchor": target.0}));
    let doc = s.doc().unwrap().clone();
    let c = doc.comment(id).unwrap();
    assert!(c.chat);
    assert_eq!(c.anchor, Some(target));
    let shown = s.execute("comment.list", &json!({})).unwrap();
    let shown = shown["comments"].as_array().unwrap().iter().find(|v| v["id"] == id).unwrap().clone();
    assert_eq!(shown["anchor"], json!(target.0));
}

#[test]
fn chat_threads_read_back_from_files_written_before_them() {
    let c: undesign_doc::Comment =
        serde_json::from_str(r#"{"id":9,"page":1,"x":0.0,"y":0.0,"author":"Sam","text":"hi","created":7,"edited":0,"reactions":[]}"#).unwrap();
    assert!(!c.chat, "threads saved before chat existed are pinned comments");
}
