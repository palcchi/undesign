//! The docked Motion timeline: `motion.timeline` toggles it, `on` sets it, and the dock
//! draws (empty and with a composition, tracks and keyframes) without panicking.

use serde_json::json;
use undesign_doc::NodeId;
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

#[test]
fn timeline_lists_every_page_layer_in_tree_order() {
    let mut app = app();
    let first = app.run("shape.rectangle", json!({"x": 10, "y": 10, "width": 100, "height": 50})).unwrap()["id"].as_u64().unwrap();
    let second = app.run("shape.rectangle", json!({"x": 20, "y": 20, "width": 40, "height": 40})).unwrap()["id"].as_u64().unwrap();
    app.run("motion.composition.create", json!({"name": "Main"})).unwrap();
    // No tracks and no canvas selection: the whole page still lists.
    app.session.set_selection(Vec::new());
    let composition = app.session.doc().unwrap().motion.compositions[0].clone();
    let page = app.session.page().unwrap();
    let doc = app.session.doc().unwrap();
    let expected: Vec<NodeId> = doc.node(page).unwrap().children.iter().filter(|id| doc.node(**id).is_some_and(|n| !n.is_page())).copied().collect();
    assert!(expected.contains(&NodeId(first)) && expected.contains(&NodeId(second)));
    assert_eq!(crate::motion_panel::timeline_layers(&app, &composition), expected);
    // Selecting a layer or animating one does not change the list.
    app.session.set_selection(vec![NodeId(first)]);
    let _track = app.run("motion.track.add", json!({"compositionId": composition.id, "target": first, "property": "opacity"})).unwrap();
    let composition = app.session.doc().unwrap().motion.compositions[0].clone();
    assert_eq!(crate::motion_panel::timeline_layers(&app, &composition), expected);
    let ctx = egui::Context::default();
    frame(&ctx, &mut app);
}

#[test]
fn timeline_layers_keep_tree_depth_and_indent_within_the_label_column() {
    let mut app = app();
    let first = app.run("shape.rectangle", json!({"x": 10, "y": 10, "width": 100, "height": 50})).unwrap()["id"].as_u64().unwrap();
    let second = app.run("shape.rectangle", json!({"x": 20, "y": 20, "width": 40, "height": 40})).unwrap()["id"].as_u64().unwrap();
    app.run("object.group", json!({"ids": [first, second]})).unwrap();
    app.run("motion.composition.create", json!({"name": "Main"})).unwrap();

    let page = app.session.page().unwrap();
    let doc = app.session.doc().unwrap();
    let group = doc
        .node(page)
        .unwrap()
        .children
        .iter()
        .copied()
        .find(|id| doc.node(*id).is_some_and(|node| matches!(node.kind, undesign_doc::NodeKind::Group)))
        .unwrap();
    let children = doc.node(group).unwrap().children.clone();
    let composition = doc.motion.compositions[0].clone();
    let layers = crate::motion_panel::timeline_layers_with_depth(&app, &composition);

    assert_eq!(layers.len(), 3);
    assert_eq!(layers[0], (group, 0));
    assert!(children.iter().all(|child| layers.contains(&(*child, 1))));
    assert_eq!(crate::motion_panel::layer_indent(0, 112.0), 0.0);
    assert_eq!(crate::motion_panel::layer_indent(1, 112.0), 10.0);
    assert_eq!(crate::motion_panel::layer_indent(4, 112.0), 16.0);
    assert_eq!(crate::motion_panel::layer_indent(4, 180.0), 40.0);
    assert_eq!(crate::motion_panel::layer_indent(12, 180.0), 48.0);
}

#[test]
fn property_rows_list_only_existing_tracks_and_offer_untracked_properties() {
    let mut app = app();
    let target = app.run("shape.rectangle", json!({"x": 10, "y": 10, "width": 100, "height": 50})).unwrap()["id"].as_u64().unwrap();
    app.run("motion.composition.create", json!({"name": "Main"})).unwrap();
    let composition = app.session.doc().unwrap().motion.compositions[0].clone();
    let target = NodeId(target);

    assert!(crate::motion_panel::property_tracks(&composition, target).is_empty());
    assert_eq!(crate::motion_panel::available_properties(&composition, target).len(), 8);

    let track_id =
        app.run("motion.track.add", json!({"compositionId": composition.id, "target": target.0, "property": "opacity"})).unwrap()["trackId"]
            .as_u64()
            .unwrap();
    let composition = app.session.doc().unwrap().motion.compositions[0].clone();

    assert_eq!(crate::motion_panel::property_tracks(&composition, target), vec![(undesign_doc::AnimatedProperty::Opacity, track_id)]);
    let available = crate::motion_panel::available_properties(&composition, target);
    assert_eq!(available.len(), 7);
    assert!(!available.contains(&undesign_doc::AnimatedProperty::Opacity));

    app.run("motion.timeline", json!({"on": true}));
    frame(&egui::Context::default(), &mut app);
}

#[test]
fn track_counter_has_singular_and_plural_catalog_forms() {
    for (code, singular, plural) in [("en", Some("{n} track"), "{n} tracks"), ("es", Some("{n} pista"), "{n} pistas"), ("id", None, "{n} track")] {
        let language = crate::i18n::languages().iter().find(|language| language.code == code).unwrap();
        let entry = language.ui.iter().find(|(key, _)| *key == "{n} tracks").map(|(_, text)| text).unwrap();
        let crate::i18n::Text::Plural { one, other, .. } = entry else { panic!("{code} track counter is not pluralized") };
        assert_eq!(*one, singular, "{code} singular form");
        assert_eq!(*other, plural, "{code} plural form");
    }
}

#[test]
fn muting_a_track_keeps_its_keys_and_hides_the_preview() {
    let mut app = app();
    app.run("motion.timeline", json!({"on": true}));
    let target = app.run("shape.rectangle", json!({"x": 10, "y": 10, "width": 100, "height": 50})).unwrap()["id"].clone();
    let composition = app.run("motion.composition.create", json!({"durationFrames": 60})).unwrap()["compositionId"].clone();
    let track =
        app.run("motion.track.add", json!({"compositionId": composition, "target": target, "property": "opacity"})).unwrap()["trackId"].clone();
    for (frame, value) in [(0, 1.0), (30, 0.0)] {
        app.run("motion.keyframe.set", json!({"compositionId": composition, "trackId": track, "frame": frame, "value": value}));
    }
    let id = composition.as_u64().unwrap();
    let doc = app.session.doc().unwrap().clone();
    assert!(undesign_engine::cmd::motion::preview_document(&doc, id, 15.0).is_some());
    app.run("motion.track.set_enabled", json!({"compositionId": composition, "trackId": track, "enabled": false}));
    let doc = app.session.doc().unwrap().clone();
    assert!(undesign_engine::cmd::motion::preview_document(&doc, id, 15.0).is_none());
    assert_eq!(doc.motion.compositions[0].tracks[0].keyframes.len(), 2);
    app.ui.motion_selected = Some((track.as_u64().unwrap(), 10));
    let ctx = egui::Context::default();
    frame(&ctx, &mut app);
}

#[test]
fn interpolation_presets_apply_through_keyframe_set() {
    let mut app = app();
    let target = app.run("shape.rectangle", json!({"x": 10, "y": 10, "width": 100, "height": 50})).unwrap()["id"].clone();
    let composition = app.run("motion.composition.create", json!({"durationFrames": 60})).unwrap()["compositionId"].clone();
    let track =
        app.run("motion.track.add", json!({"compositionId": composition, "target": target, "property": "opacity"})).unwrap()["trackId"].clone();
    for (label, preset) in crate::motion_panel::interpolation_presets() {
        let payload = serde_json::to_value(preset).expect("preset serializes");
        app.run("motion.keyframe.set", json!({"compositionId": composition, "trackId": track, "frame": 10, "value": 0.5, "interpolation": payload}))
            .expect("interpolation preset applies");
        let doc = app.session.doc().unwrap();
        let stored = doc.motion.compositions[0].tracks[0].keyframes.iter().find(|k| k.frame == 10).unwrap().interpolation;
        assert_eq!(stored, preset, "preset {label} round-trips");
    }
    assert!(app.session.doc().unwrap().motion.compositions[0].validate().is_ok());
}
