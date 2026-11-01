//! The docked Motion timeline: `motion.timeline` toggles it, `on` sets it, and the dock
//! draws (empty and with a composition, tracks and keyframes) without panicking.

use serde_json::json;
use undesign_engine::Session;

use crate::{FigApp, NoServices};

fn app() -> FigApp {
    FigApp::new(Session::new(), Box::new(NoServices))
}

/// One editor frame on a 1280×800 window.
fn frame(ctx: &egui::Context, app: &mut FigApp) {
    let input = egui::RawInput { screen_rect: Some(egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(1280.0, 800.0))), ..Default::default() };
    ctx.run_ui(input, |ui| app.ui(ui)).textures_delta.clear();
}

#[test]
fn timeline_command_toggles_the_dock() {
    let mut app = app();
    assert!(!app.ui.motion_timeline);
    app.run("motion.timeline", json!({}));
    assert!(app.ui.motion_timeline);
    app.run("motion.timeline", json!({}));
    assert!(!app.ui.motion_timeline);
}

#[test]
fn timeline_on_sets_the_dock() {
    let mut app = app();
    app.run("motion.timeline", json!({"on": true}));
    assert!(app.ui.motion_timeline);
    app.run("motion.timeline", json!({"on": true}));
    assert!(app.ui.motion_timeline);
    app.run("motion.timeline", json!({"on": false}));
    assert!(!app.ui.motion_timeline);
}

#[test]
fn dock_draws_empty_and_with_tracks() {
    let ctx = egui::Context::default();
    let mut app = app();
    app.run("motion.timeline", json!({"on": true}));
    frame(&ctx, &mut app);

    let target = app.run("shape.rectangle", json!({"x": 10, "y": 10, "width": 100, "height": 50})).unwrap()["id"].clone();
    let composition = app.run("motion.composition.create", json!({"name": "Main"})).unwrap()["compositionId"].clone();
    let track_params = json!({"compositionId": composition, "target": target, "property": "positionX"});
    let track = app.run("motion.track.add", track_params).unwrap()["trackId"].clone();
    app.run("motion.keyframe.set", json!({"compositionId": composition, "trackId": track, "frame": 0, "value": 10.0}));
    app.run("motion.keyframe.set", json!({"compositionId": composition, "trackId": track, "frame": 60, "value": 200.0}));
    frame(&ctx, &mut app);
    assert!(app.ui.motion_timeline);
    assert!(app.motion_preview_view().is_some(), "the canvas previews the composition while the dock is open");
}
