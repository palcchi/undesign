//! The canvas while a drag edits the document every frame, driven through egui headless: each
//! finished render shows (a newer one already on its way doesn't hide it), and a button held still
//! stops making new documents to render.

use std::sync::Arc;
use std::time::Duration;

use egui::{Event, vec2};
use serde_json::json;
use undesign_engine::Session;

use crate::layers_drag_tests::Ui;

/// Frames until the render worker has nothing in flight (a few seconds at most).
fn settle(u: &mut Ui) {
    for _ in 0..300 {
        u.frame(vec![]);
        if u.app.worker.as_ref().is_some_and(|w| !w.in_flight()) {
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn a_drag_shows_on_the_canvas_while_it_moves() {
    let mut s = Session::new();
    let id = |v: serde_json::Value| undesign_engine::params::id_of(&v["id"]).unwrap();
    let f = id(s.execute("frame.create", &json!({"x": 100, "y": 100, "width": 300, "height": 200})).unwrap());
    s.execute("node.set", &json!({"id": f, "rotation": 25})).unwrap();
    let r =
        id(s.execute("shape.rectangle", &json!({"x": 40, "y": 40, "width": 80, "height": 60, "parent": f, "props": {"fill": "#e03030"}})).unwrap());
    s.execute("select.set", &json!({"ids": [r]})).unwrap();
    let mut u = Ui::new(s);
    settle(&mut u);
    let c = u.app.session.doc().unwrap().world_bounds(r).unwrap().center();
    let p = u.app.to_screen(c.x, c.y);
    u.button(p, true);
    settle(&mut u);
    // A move every frame, each one a new document and a new render request.
    u.app.canvas.render_work = None;
    let before = u.app.session.ds().unwrap().doc.clone();
    // At least 30 moves, then on until a finished render shows (slow machines need longer).
    for k in 1..=300 {
        u.frame(vec![Event::PointerMoved(p + vec2(k as f32, k as f32 / 3.0))]);
        std::thread::sleep(Duration::from_millis(15));
        if k >= 30 && u.app.canvas.render_work.is_some() {
            break;
        }
    }
    assert!(!Arc::ptr_eq(&before, &u.app.session.ds().unwrap().doc), "the drag moved the layer");
    assert!(u.app.canvas.render_work.is_some(), "renders finished during the drag are shown");
    // Held still: the same move each frame keeps the preview, and the canvas settles.
    let held = u.app.session.ds().unwrap().doc.clone();
    // Frames until the last render lands (slow machines take a while): a drag held still makes
    // no new documents, so the worker runs dry.
    settle(&mut u);
    assert!(Arc::ptr_eq(&held, &u.app.session.ds().unwrap().doc));
    assert!(u.app.worker.as_ref().is_some_and(|w| !w.in_flight()), "nothing left to render");
    u.button(p + vec2(30.0, 10.0), false);
}

#[test]
fn releasing_a_canvas_drag_outside_finishes_the_interaction() {
    let mut s = Session::new();
    let r =
        undesign_engine::params::id_of(&s.execute("shape.rectangle", &json!({"x": 40, "y": 40, "width": 80, "height": 60})).unwrap()["id"]).unwrap();
    s.execute("select.set", &json!({"ids": [r]})).unwrap();
    let mut u = Ui::new(s);
    let start = u.app.to_screen(80.0, 70.0);
    let outside = egui::pos2(u.app.canvas.rect.max.x + 20.0, start.y);
    u.button(start, true);
    u.frame(vec![Event::PointerMoved(outside)]);
    u.button(outside, false);

    assert!(u.app.session.ds().unwrap().interaction.is_none(), "the document interaction is committed");
}

fn key(u: &mut Ui, key: egui::Key) {
    let modifiers = egui::Modifiers::NONE;
    u.frame(vec![
        Event::Key { key, physical_key: None, pressed: true, repeat: false, modifiers },
        Event::Key { key, physical_key: None, pressed: false, repeat: false, modifiers },
    ]);
}

fn pointer_button(u: &mut Ui, pos: egui::Pos2, button: egui::PointerButton, pressed: bool) {
    u.frame(vec![Event::PointerMoved(pos), Event::PointerButton { pos, button, pressed, modifiers: egui::Modifiers::NONE }]);
}

fn right_click(u: &mut Ui, pos: egui::Pos2) {
    pointer_button(u, pos, egui::PointerButton::Secondary, true);
    pointer_button(u, pos, egui::PointerButton::Secondary, false);
}

fn new_rect(s: &mut Session, x: f64, y: f64, width: f64, height: f64) -> undesign_doc::NodeId {
    let out = s.execute("shape.rectangle", &json!({"x": x, "y": y, "width": width, "height": height})).unwrap();
    undesign_engine::params::id_of(&out["id"]).unwrap()
}

fn near(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-5
}

#[test]
fn pointer_zoom_and_wheel_pan_reach_the_view_through_egui() {
    let mut u = Ui::new(Session::new());
    let at = u.app.to_screen(100.0, 80.0);
    assert!(u.app.canvas.rect.contains(at), "the pointer starts over the canvas");
    let (zoom_before, anchor_before) = (u.app.session.ds().unwrap().view.zoom, u.app.to_page(at));

    u.frame(vec![Event::PointerMoved(at), Event::Zoom(1.25)]);

    let zoomed = &u.app.session.ds().unwrap().view;
    assert!(near(zoomed.zoom, zoom_before * 1.25), "pinch zoom reaches the view: {}", zoomed.zoom);
    let anchor_after = u.app.to_page(at);
    assert!(
        near(anchor_after.x, anchor_before.x) && near(anchor_after.y, anchor_before.y),
        "zoom keeps the page point under the pointer: {anchor_before:?} -> {anchor_after:?}"
    );

    let (cx_before, cy_before) = (zoomed.cx, zoomed.cy);
    u.frame(vec![
        Event::PointerMoved(at),
        Event::MouseWheel {
            unit: egui::MouseWheelUnit::Point,
            delta: vec2(0.0, -64.0),
            phase: egui::TouchPhase::Move,
            modifiers: egui::Modifiers::NONE,
        },
    ]);
    let panned = &u.app.session.ds().unwrap().view;
    assert!(!near(panned.cx, cx_before) || !near(panned.cy, cy_before), "plain wheel input pans the view");
}

#[test]
fn middle_button_and_space_drags_pan_through_the_canvas() {
    let mut u = Ui::new(Session::new());
    let from = u.app.canvas.rect.center();
    let delta = vec2(72.0, 36.0);
    let to = from + delta;
    assert!(u.app.canvas.rect.contains(to));
    let before = u.app.session.ds().unwrap().view.clone();

    pointer_button(&mut u, from, egui::PointerButton::Middle, true);
    u.frame(vec![Event::PointerMoved(to)]);
    let after_middle = &u.app.session.ds().unwrap().view;
    assert!(near(after_middle.cx, before.cx - f64::from(delta.x) / before.zoom));
    assert!(near(after_middle.cy, before.cy - f64::from(delta.y) / before.zoom));
    pointer_button(&mut u, to, egui::PointerButton::Middle, false);

    let from = u.app.canvas.rect.center();
    let delta = vec2(-54.0, 42.0);
    let to = from + delta;
    let before = u.app.session.ds().unwrap().view.clone();
    u.frame(vec![Event::Key { key: egui::Key::Space, physical_key: None, pressed: true, repeat: false, modifiers: egui::Modifiers::NONE }]);
    u.button(from, true);
    u.frame(vec![Event::PointerMoved(to)]);
    let after_space = &u.app.session.ds().unwrap().view;
    assert!(near(after_space.cx, before.cx - f64::from(delta.x) / before.zoom));
    assert!(near(after_space.cy, before.cy - f64::from(delta.y) / before.zoom));
    u.button(to, false);
    u.frame(vec![Event::Key { key: egui::Key::Space, physical_key: None, pressed: false, repeat: false, modifiers: egui::Modifiers::NONE }]);
}

#[test]
fn canvas_corner_drag_resizes_a_selected_layer_as_one_undo_step() {
    let mut s = Session::new();
    let rect = new_rect(&mut s, 100.0, 100.0, 100.0, 50.0);
    s.execute("select.set", &json!({"ids": [rect]})).unwrap();
    let mut u = Ui::new(s);
    let before_undo = u.app.session.undo_depth().0;
    let from = u.app.to_screen(200.0, 150.0);
    let to = u.app.to_screen(250.0, 175.0);
    assert!(u.app.canvas.rect.contains(from) && u.app.canvas.rect.contains(to));

    u.button(from, true);
    u.frame(vec![Event::PointerMoved(to)]);
    u.button(to, false);

    let node = u.app.session.doc().unwrap().node(rect).unwrap();
    assert!(near(node.width, 150.0) && near(node.height, 75.0), "the canvas corner handle resizes both axes: {}×{}", node.width, node.height);
    assert!(u.app.session.ds().unwrap().interaction.is_none());
    assert_eq!(u.app.session.undo_depth().0, before_undo + 1, "the drag is one undo step");
    u.app.run("edit.undo", json!({}));
    let restored = u.app.session.doc().unwrap().node(rect).unwrap();
    assert!(near(restored.width, 100.0) && near(restored.height, 50.0), "undo restores the original bounds");
}

#[test]
fn canvas_rotation_handle_drag_rotates_a_selected_layer_as_one_undo_step() {
    let mut s = Session::new();
    let rect = new_rect(&mut s, 100.0, 100.0, 100.0, 100.0);
    s.execute("select.set", &json!({"ids": [rect]})).unwrap();
    let mut u = Ui::new(s);
    let before_undo = u.app.session.undo_depth().0;
    let zoom = u.app.session.ds().unwrap().view.zoom;
    let (cx, cy) = (150.0, 150.0);
    let pad = 10.0 / zoom;
    let (sx, sy) = (200.0 + pad, 100.0 - pad);
    let (dx, dy) = (sx - cx, sy - cy);
    let radius = dx.hypot(dy);
    let angle = dy.atan2(dx) + 37.0_f64.to_radians();
    let (tx, ty) = (cx + radius * angle.cos(), cy + radius * angle.sin());
    let from = u.app.to_screen(sx, sy);
    let to = u.app.to_screen(tx, ty);
    assert!(u.app.canvas.rect.contains(from) && u.app.canvas.rect.contains(to));

    u.button(from, true);
    u.frame(vec![Event::PointerMoved(to)]);
    u.button(to, false);

    let node = u.app.session.doc().unwrap().node(rect).unwrap();
    let rotation = undesign_geom::rotation_degrees(node.transform);
    assert!((rotation.abs() - 37.0).abs() < 0.1, "the canvas rotation handle applies the pointer's 37° turn: {rotation}");
    assert!(u.app.session.ds().unwrap().interaction.is_none());
    assert_eq!(u.app.session.undo_depth().0, before_undo + 1, "the drag is one undo step");
    u.app.run("edit.undo", json!({}));
    let restored = u.app.session.doc().unwrap().node(rect).unwrap();
    assert!(near(undesign_geom::rotation_degrees(restored.transform), 0.0), "undo restores the original rotation");
}

#[test]
fn canvas_right_click_selects_the_layer_and_anchors_the_context_menu() {
    let mut s = Session::new();
    let selected = new_rect(&mut s, 20.0, 30.0, 80.0, 60.0);
    let target = new_rect(&mut s, 200.0, 100.0, 100.0, 60.0);
    s.execute("select.set", &json!({"ids": [selected]})).unwrap();
    let mut u = Ui::new(s);
    let on_layer = u.app.to_screen(250.0, 130.0);
    assert!(u.app.canvas.rect.contains(on_layer));

    right_click(&mut u, on_layer);

    let (anchor, ids) = u.app.ui.context_menu.clone().expect("right-click opens the canvas context menu");
    assert_eq!(ids, vec![target], "right-click selects the layer under the pointer");
    assert!(
        near(f64::from(anchor.x), f64::from(on_layer.x)) && near(f64::from(anchor.y), f64::from(on_layer.y)),
        "menu is anchored at the clicked point: {anchor:?}"
    );

    // A blank-canvas context menu stays at the pointer and preserves the current selection.
    u.app.ui.context_menu = None;
    let blank = u.app.to_screen(450.0, 350.0);
    assert!(u.app.canvas.rect.contains(blank));
    right_click(&mut u, blank);
    let (anchor, ids) = u.app.ui.context_menu.clone().expect("blank-canvas right-click opens the menu");
    assert_eq!(ids, vec![target], "right-clicking blank canvas preserves the selection");
    assert!(
        near(f64::from(anchor.x), f64::from(blank.x)) && near(f64::from(anchor.y), f64::from(blank.y)),
        "blank-canvas menu is anchored at the pointer: {anchor:?}"
    );
}

#[test]
fn a_drag_released_off_the_window_ends_where_the_pointer_was_last_seen_and_later_edits_stay() {
    // #278: a drag left open made a later text edit roll back the changes made since.
    let mut s = Session::new();
    let id = |v: serde_json::Value| undesign_engine::params::id_of(&v["id"]).unwrap();
    let kept = id(s.execute("shape.rectangle", &json!({"x": 40, "y": 400, "width": 80, "height": 40})).unwrap());
    let gone = id(s.execute("shape.rectangle", &json!({"x": 160, "y": 400, "width": 80, "height": 40})).unwrap());
    let text = id(s.execute("text.create", &json!({"text": "A", "x": 40, "y": 500})).unwrap());
    s.execute("tool.rectangle", &json!({})).unwrap();
    let mut u = Ui::new(s);
    // A rectangle drawn from the middle of the canvas, released off the window, the pointer gone.
    let start = u.app.canvas.rect.center();
    u.button(start, true);
    for i in 1..=6 {
        u.frame(vec![Event::PointerMoved(start + vec2(10.0, 6.0) * i as f32)]);
    }
    let release =
        Event::PointerButton { pos: egui::pos2(-50.0, -50.0), button: egui::PointerButton::Primary, pressed: false, modifiers: Default::default() };
    u.frame(vec![release, Event::PointerGone]);
    let ds = u.app.session.ds().unwrap();
    assert!(ds.interaction.is_none(), "the drawing is committed");
    let (drawn, zoom) = (ds.selection[0], ds.view.zoom);
    let b = ds.doc.world_bounds(drawn).unwrap();
    // Not the 100 x 100 shape of a click, as an end in the middle of the canvas would make.
    assert!((b.width() * zoom - 60.0).abs() < 1.5 && (b.height() * zoom - 36.0).abs() < 1.5, "{b:?} at zoom {zoom}");
    // #278's steps: a move in the panel, a delete, then a text edit.
    u.app.run("node.set", json!({"ids": [kept], "props": {"x": 650}}));
    u.app.run("edit.delete", json!({"ids": [gone]}));
    u.app.run("select.set", json!({"ids": [text]}));
    key(&mut u, egui::Key::Enter);
    u.frame(vec![Event::Text("B".into())]);
    key(&mut u, egui::Key::Escape);
    let doc = u.app.session.doc().unwrap();
    assert_eq!(doc.world_bounds(kept).unwrap().x0, 650.0, "the move stays");
    assert!(!doc.contains(gone), "the delete stays");
    assert_eq!(doc.node(text).unwrap().kind.text().unwrap().characters, "B");
}
