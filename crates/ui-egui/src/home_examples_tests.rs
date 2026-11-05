//! The built-in examples: every one opens, and a card on the home screen opens its file.

use base64::Engine as _;
use egui::Pos2;
use egui::accesskit::Role;
use serde_json::json;
use undesign_engine::Session;

use crate::home_examples::EXAMPLES;
use crate::layers_drag_tests::Ui;

#[test]
fn every_example_opens_as_a_new_unsaved_document_with_its_layers() {
    for example in EXAMPLES {
        let mut s = Session::new();
        let data = base64::engine::general_purpose::STANDARD.encode(example.bytes());
        let opened = s.execute("file.open", &json!({"data": data, "name": example.file}));
        assert!(opened.is_ok(), "{}: {opened:?}", example.file);
        let ds = s.ds().unwrap();
        assert!(ds.path.is_none(), "{}: a copy, not the file", example.file);
        assert!(ds.doc.node_count() > 3, "{}: has layers", example.file);
    }
    // The Motion examples carry a composition.
    for file in ["undesign-intro.undesign", "daybreak-motion-study.undesign"] {
        let example = EXAMPLES.iter().find(|e| e.file == file).unwrap();
        let mut s = Session::new();
        let data = base64::engine::general_purpose::STANDARD.encode(example.bytes());
        s.execute("file.open", &json!({"data": data, "name": example.file})).unwrap();
        assert!(!s.doc().unwrap().motion.compositions.is_empty(), "{file}: a Motion composition");
    }
}

#[test]
fn a_card_on_the_home_screen_opens_its_example() {
    let mut u = Ui::new(Session::empty());
    u.app.ui.home = true;
    for _ in 0..(EXAMPLES.len() + 3) {
        u.frame(vec![]);
    }
    u.ctx.enable_accesskit();
    u.frame(vec![]);
    let nodes: Vec<_> = u.frame_output(vec![]).platform_output.accesskit_update.unwrap().nodes.into_iter().map(|(_, n)| n).collect();
    let label = format!("{}, {}", EXAMPLES[0].title, EXAMPLES[0].about);
    let card = nodes.iter().find(|n| n.role() == Role::Button && n.label() == Some(label.as_str())).expect("the first example's card");
    let b = card.bounds().unwrap();
    let at = Pos2::new(((b.x0 + b.x1) / 2.0) as f32, ((b.y0 + b.y1) / 2.0) as f32);
    u.button(at, true);
    u.button(at, false);
    u.frame(vec![]);
    assert!(!u.app.ui.home, "the example opened");
    assert_eq!(u.app.session.ds().unwrap().doc.name, "Undesign intro");
    assert!(u.app.session.ds().unwrap().path.is_none());
}

#[test]
fn a_link_opens_a_motion_example_in_the_motion_workspace_playing() {
    let mut app = crate::FigApp::new(Session::empty(), Box::new(crate::NoServices));
    app.ui.home = true;
    assert!(crate::home_examples::open(&mut app, "undesign-intro", true));
    assert!(!app.ui.home);
    assert_eq!(app.ui.right_tab, crate::RightTab::Motion);
    assert!(app.ui.motion_timeline, "the timeline shows");
    assert!(app.ui.motion_playing, "it plays unless motion is reduced");
    // A design example opens in Design; an unknown name opens nothing.
    let mut app = crate::FigApp::new(Session::empty(), Box::new(crate::NoServices));
    assert!(crate::home_examples::open(&mut app, "profile-card-design", true));
    assert_eq!(app.ui.right_tab, crate::RightTab::Design);
    assert!(!app.ui.motion_playing);
    let docs = app.session.docs.len();
    assert!(!crate::home_examples::open(&mut app, "no-such-example", true));
    assert_eq!(app.session.docs.len(), docs);
}

#[test]
fn home_example_catalog_keeps_the_two_recent_samples_and_adds_both_profile_cards() {
    let names = EXAMPLES.iter().map(|example| example.name()).collect::<Vec<_>>();
    assert_eq!(names, vec!["undesign-intro", "daybreak-motion-study", "profile-card-design", "profile-card-prototype"]);
}

#[test]
fn every_example_has_a_plain_link_name() {
    for example in EXAMPLES {
        let name = example.name();
        assert!(!name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'), "{name}");
    }
}
