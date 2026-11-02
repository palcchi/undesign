//! `motion.timeline` only asks the interface to show or hide the docked Motion timeline:
//! the document stays untouched.

use serde_json::json;

use crate::Session;

fn requests(s: &Session) -> Vec<(String, serde_json::Value)> {
    s.ui_requests.iter().map(|r| (r.kind.clone(), r.data.clone())).collect()
}

#[test]
fn timeline_requests_the_docked_panel() {
    let mut s = Session::new();
    s.execute("motion.timeline", &json!({})).unwrap();
    let reqs = requests(&s);
    assert_eq!(reqs.len(), 1);
    assert_eq!(reqs[0].0, "panel.motionTimeline");
    assert!(reqs[0].1.get("on").is_none_or(serde_json::Value::is_null));
}

#[test]
fn timeline_passes_on_through() {
    for on in [true, false] {
        let mut s = Session::new();
        s.execute("motion.timeline", &json!({"on": on})).unwrap();
        let reqs = requests(&s);
        assert_eq!(reqs.len(), 1);
        assert_eq!(reqs[0].1.get("on").and_then(serde_json::Value::as_bool), Some(on));
    }
}

#[test]
fn timeline_leaves_the_document_alone() {
    let mut s = Session::new();
    s.execute("motion.timeline", &json!({"on": true})).unwrap();
    assert_eq!(s.undo_depth(), (0, 0), "a view toggle writes no undo entry");
    assert!(s.doc().is_ok_and(|d| d.motion.compositions.is_empty()));
}
