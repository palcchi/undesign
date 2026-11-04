//! The Motion timeline dock, driven headless: keyframes drag and nudge through `motion.keyframe.move`,
//! scenes start from a Frame, and layers group their property tracks.

use egui::accesskit::{Node, Role};
use egui::{Event, Key, Modifiers, Pos2};
use serde_json::json;
use undesign_doc::{Keyframe, NodeId};
use undesign_engine::Session;

use crate::RightTab;
use crate::layers_drag_tests::Ui;

fn id(v: serde_json::Value) -> NodeId {
    NodeId(v["id"].as_u64().unwrap())
}

/// A rectangle "Box" with opacity keyframes at frames 10 (0.25) and 30 (0.75) in a 60-frame scene.
fn setup() -> (Ui, u64, u64) {
    let mut s = Session::new();
    let rect = id(s.execute("shape.rectangle", &json!({"x": 0, "y": 0, "width": 40, "height": 30})).unwrap());
    s.execute("object.rename", &json!({"ids": [rect], "name": "Box"})).unwrap();
    s.execute("select.set", &json!({"ids": [rect]})).unwrap();
    let scene = s.execute("motion.composition.create", &json!({"name": "Intro", "durationFrames": 60})).unwrap()["compositionId"].as_u64().unwrap();
    let track = s.execute("motion.track.add", &json!({"compositionId": scene, "target": rect.0, "property": "opacity"})).unwrap()["trackId"]
        .as_u64()
        .unwrap();
    for (frame, value) in [(10, 0.25), (30, 0.75)] {
        s.execute("motion.keyframe.set", &json!({"compositionId": scene, "trackId": track, "frame": frame, "value": value})).unwrap();
    }
    let mut u = Ui::new(s);
    u.app.ui.right_tab = RightTab::Motion;
    u.app.ui.motion_composition = Some(scene);
    u.ctx.enable_accesskit();
    u.frame(vec![]);
    u.frame(vec![]);
    (u, scene, track)
}

fn nodes(u: &mut Ui) -> Vec<Node> {
    let out = u.frame_output(vec![]);
    out.platform_output.accesskit_update.expect("an AccessKit update").nodes.into_iter().map(|(_, n)| n).collect()
}

fn centre(u: &mut Ui, label: &str) -> Pos2 {
    let all = nodes(u);
    let node = all.iter().find(|n| n.role() == Role::Button && n.label() == Some(label)).unwrap_or_else(|| panic!("no button named {label:?}"));
    let b = node.bounds().expect("the control has bounds");
    Pos2::new(((b.x0 + b.x1) / 2.0) as f32, ((b.y0 + b.y1) / 2.0) as f32)
}

fn keyframes(u: &Ui) -> Vec<Keyframe> {
    u.app.session.doc().unwrap().motion.compositions[0].tracks[0].keyframes.clone()
}

fn undo_len(u: &Ui) -> usize {
    u.app.session.ds().unwrap().history.undo.len()
}

fn frames_of(u: &Ui) -> Vec<u32> {
    keyframes(u).iter().map(|k| k.frame).collect()
}

/// The pixel `frames` after the keyframe at `from_label`, from how far apart two keyframes sit.
fn x_after(u: &mut Ui, from_frame: u32, frames: i32) -> Pos2 {
    let a = centre(u, "Box Opacity keyframe, frame 10");
    let b = centre(u, "Box Opacity keyframe, frame 30");
    let per_frame = (b.x - a.x) / 20.0;
    let from = if from_frame == 10 { a } else { b };
    Pos2::new(from.x + per_frame * frames as f32, from.y)
}

fn drag_keyframe(u: &mut Ui, from: Pos2, to: Pos2) {
    u.drag_to(from, to);
    u.button(to, false);
    u.frame(vec![]);
}

#[test]
fn dragging_a_keyframe_moves_it_in_one_undo_step_and_keeps_its_value() {
    let (mut u, ..) = setup();
    let source = keyframes(&u)[1];
    let from = centre(&mut u, "Box Opacity keyframe, frame 30");
    let to = x_after(&mut u, 30, 10);
    let undo = undo_len(&u);

    u.drag_to(from, to);
    assert_eq!(frames_of(&u), [10, 30], "nothing is written before the drop");
    u.button(to, false);
    u.frame(vec![]);

    assert_eq!(frames_of(&u), [10, 40]);
    assert_eq!(keyframes(&u)[1], Keyframe { frame: 40, ..source });
    assert_eq!(undo_len(&u), undo + 1);
    assert_eq!(u.app.ui.motion_frame, 40, "the playhead lands on the moved keyframe");

    u.app.run("edit.undo", json!({}));
    assert_eq!(keyframes(&u)[1], source);
}

#[test]
fn dropping_a_keyframe_on_an_occupied_frame_is_refused_and_changes_nothing() {
    let (mut u, ..) = setup();
    let undo = undo_len(&u);
    let before = u.app.session.doc().unwrap().motion.clone();
    let from = centre(&mut u, "Box Opacity keyframe, frame 30");
    let onto_ten = x_after(&mut u, 30, -20);
    drag_keyframe(&mut u, from, onto_ten);
    assert_eq!(u.app.session.doc().unwrap().motion, before);
    assert_eq!(undo_len(&u), undo);
}

#[test]
fn dropping_a_keyframe_past_the_end_snaps_to_the_last_frame() {
    let (mut u, ..) = setup();
    let from = centre(&mut u, "Box Opacity keyframe, frame 30");
    drag_keyframe(&mut u, from, Pos2::new(1430.0, from.y));
    assert_eq!(frames_of(&u), [10, 60]);
    assert!(u.app.session.doc().unwrap().motion.compositions[0].validate().is_ok());
}

#[test]
fn clicking_a_keyframe_without_moving_it_only_selects_it() {
    let (mut u, ..) = setup();
    let undo = undo_len(&u);
    let at = centre(&mut u, "Box Opacity keyframe, frame 30");
    u.button(at, true);
    u.button(at, false);
    u.frame(vec![]);
    assert_eq!(frames_of(&u), [10, 30]);
    assert_eq!(u.app.ui.motion_frame, 30);
    assert_eq!(u.app.ui.motion_value, 0.75);
    assert_eq!(undo_len(&u), undo);
}

#[test]
fn a_focused_keyframe_nudges_with_the_arrow_keys() {
    let (mut u, ..) = setup();
    let at = centre(&mut u, "Box Opacity keyframe, frame 30");
    u.button(at, true);
    u.button(at, false);
    let key = |key, modifiers| {
        vec![
            Event::Key { key, physical_key: None, pressed: true, repeat: false, modifiers },
            Event::Key { key, physical_key: None, pressed: false, repeat: false, modifiers },
        ]
    };
    u.frame_with(key(Key::ArrowRight, Modifiers::NONE), Modifiers::NONE);
    assert_eq!(frames_of(&u), [10, 31]);
    u.frame_with(key(Key::ArrowLeft, Modifiers::SHIFT), Modifiers::SHIFT);
    assert_eq!(frames_of(&u), [10, 21]);
}

#[test]
fn pressing_the_ruler_scrubs_the_playhead_and_stops_playback() {
    let (mut u, ..) = setup();
    u.app.ui.motion_playing = true;
    let ruler = centre(&mut u, "Timeline ruler");
    u.button(ruler, true);
    u.button(ruler, false);
    assert!(!u.app.ui.motion_playing);
    assert!(u.app.ui.motion_frame > 0 && u.app.ui.motion_frame < 60, "the middle of the ruler is mid-scene: {}", u.app.ui.motion_frame);
}

#[test]
fn a_scene_starts_from_the_selected_frames_name_and_size() {
    let mut s = Session::new();
    let frame = id(s.execute("frame.create", &json!({"x": 0, "y": 0, "width": 390, "height": 844, "name": "Onboarding"})).unwrap());
    s.execute("select.set", &json!({"ids": [frame]})).unwrap();
    let mut u = Ui::new(s);
    u.app.ui.right_tab = RightTab::Motion;
    u.ctx.enable_accesskit();
    u.frame(vec![]);
    u.frame(vec![]);

    let button = centre(&mut u, "＋ Scene from Frame");
    u.button(button, true);
    u.button(button, false);
    u.frame(vec![]);

    let doc = u.app.session.doc().unwrap();
    let scene = &doc.motion.compositions[0];
    assert_eq!((scene.name.as_str(), scene.width, scene.height), ("Onboarding", 390, 844));
    assert_eq!(u.app.ui.motion_composition, Some(scene.id));
}
