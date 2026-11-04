//! The docked Motion timeline: `motion.timeline` toggles it, `on` sets it, and the dock
//! draws (empty and with a composition, tracks and keyframes) without panicking.

use egui::Pos2;
use egui::accesskit::{Node, Role};
use serde_json::json;
use undesign_doc::{Interpolation, NodeId};
use undesign_engine::Session;

use crate::layers_drag_tests::Ui as HeadlessUi;
use crate::{FigApp, NoServices};

fn app() -> FigApp {
    FigApp::new(Session::new(), Box::new(NoServices))
}

/// One editor frame on a 1280×800 window.
fn frame(ctx: &egui::Context, app: &mut FigApp) {
    let input = egui::RawInput { screen_rect: Some(egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(1280.0, 800.0))), ..Default::default() };
    ctx.run_ui(input, |ui| app.ui(ui)).textures_delta.clear();
}

fn motion_session() -> (Session, NodeId, u64, u64) {
    let mut session = Session::new();
    let target = NodeId(session.execute("shape.rectangle", &json!({"x": 10, "y": 10, "width": 100, "height": 50})).unwrap()["id"].as_u64().unwrap());
    let composition =
        session.execute("motion.composition.create", &json!({"name": "Main", "durationFrames": 60})).unwrap()["compositionId"].as_u64().unwrap();
    let track =
        session.execute("motion.track.add", &json!({"compositionId": composition, "target": target.0, "property": "opacity"})).unwrap()["trackId"]
            .as_u64()
            .unwrap();
    (session, target, composition, track)
}

fn accesskit_tree(ui: &mut HeadlessUi) -> Vec<Node> {
    ui.ctx.enable_accesskit();
    ui.frame(vec![]);
    ui.frame_output(vec![]).platform_output.accesskit_update.expect("an AccessKit update").nodes.into_iter().map(|(_, node)| node).collect()
}

fn button_center(ui: &mut HeadlessUi, label: &str, bottom_only: bool) -> Pos2 {
    let nodes = accesskit_tree(ui);
    let button = nodes
        .iter()
        .find(|node| {
            node.role() == Role::Button && node.label() == Some(label) && (!bottom_only || node.bounds().is_some_and(|bounds| bounds.y0 > 500.0))
        })
        .unwrap_or_else(|| panic!("no button named {label:?}"));
    let bounds = button.bounds().expect("button bounds");
    Pos2::new(((bounds.x0 + bounds.x1) / 2.0) as f32, ((bounds.y0 + bounds.y1) / 2.0) as f32)
}

fn click_at(ui: &mut HeadlessUi, at: Pos2) {
    ui.button(at, true);
    ui.button(at, false);
    ui.frame(vec![]);
}

fn press_key(ui: &mut HeadlessUi, key: egui::Key) {
    ui.frame(vec![
        egui::Event::Key { key, physical_key: None, pressed: true, repeat: false, modifiers: egui::Modifiers::NONE },
        egui::Event::Key { key, physical_key: None, pressed: false, repeat: false, modifiers: egui::Modifiers::NONE },
    ]);
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
fn motion_dock_can_collapse_and_expand_accessibly() {
    let (session, _, _, _) = motion_session();
    let mut ui = HeadlessUi::new(session);
    ui.app.ui.motion_timeline = true;

    let collapse = button_center(&mut ui, "Collapse panel", true);
    click_at(&mut ui, collapse);
    assert!(ui.app.ui.motion_timeline_collapsed);
    assert_eq!(ui.app.inspect()["motionTimeline"]["collapsed"], true);
    assert!(accesskit_tree(&mut ui).iter().all(|node| node.label() != Some("Add keyframe")), "the collapsed dock hides timeline controls");

    let expand = button_center(&mut ui, "Expand", true);
    click_at(&mut ui, expand);
    assert!(!ui.app.ui.motion_timeline_collapsed);
    assert_eq!(ui.app.inspect()["motionTimeline"]["collapsed"], false);
    assert!(accesskit_tree(&mut ui).iter().any(|node| node.role() == Role::Button && node.label() == Some("Add keyframe")));
}

#[test]
fn timeline_adds_at_playhead_scrubs_and_moves_keyframes() {
    let (mut session, target, composition_id, track_id) = motion_session();
    for (frame, value) in [(10, 0.9), (30, 0.2)] {
        session
            .execute("motion.keyframe.set", &json!({"compositionId": composition_id, "trackId": track_id, "frame": frame, "value": value}))
            .unwrap();
    }
    let mut ui = HeadlessUi::new(session);
    ui.app.ui.motion_timeline = true;
    ui.app.ui.motion_composition = Some(composition_id);
    ui.app.ui.motion_active_track = Some(track_id);
    ui.app.ui.motion_frame = 12;

    let add = button_center(&mut ui, "Add keyframe", true);
    click_at(&mut ui, add);
    assert_eq!(ui.app.ui.motion_selected, Some((track_id, 12)));
    let document = ui.app.session.doc().unwrap();
    let composition = document.motion.compositions.iter().find(|composition| composition.id == composition_id).unwrap();
    let track = composition.tracks.iter().find(|track| track.id == track_id).unwrap();
    assert_eq!(track.keyframes.iter().map(|key| key.frame).collect::<Vec<_>>(), vec![10, 12, 30]);
    assert_eq!(document.node(target).unwrap().opacity, 1.0, "inserting a keyframe samples without changing base Design opacity");

    let ruler = button_center(&mut ui, "Timeline", true);
    click_at(&mut ui, ruler);
    assert!((1..60).contains(&ui.app.ui.motion_frame), "clicking the ruler scrubs to an in-range frame");

    let key_30 = button_center(&mut ui, "Opacity keyframe at frame 30", true);
    click_at(&mut ui, key_30);
    assert_eq!(ui.app.ui.motion_selected, Some((track_id, 30)));
    assert_eq!(ui.app.ui.motion_frame, 30, "selecting a keyframe moves the playhead to it");

    let key_10 = button_center(&mut ui, "Opacity keyframe at frame 10", true);
    let key_30 = button_center(&mut ui, "Opacity keyframe at frame 30", true);
    let destination = Pos2::new((key_10.x + key_30.x) / 2.0, key_10.y);
    ui.drag_to(key_10, destination);
    ui.button(destination, false);
    ui.frame(vec![]);

    let composition = ui.app.session.doc().unwrap().motion.compositions.iter().find(|composition| composition.id == composition_id).unwrap().clone();
    let track = composition.tracks.iter().find(|track| track.id == track_id).unwrap();
    assert_eq!(track.keyframes.iter().map(|key| key.frame).collect::<Vec<_>>(), vec![12, 20, 30]);
    assert_eq!(ui.app.ui.motion_selected, Some((track_id, 20)), "dragging moves and selects the keyframe at its new frame");
}

#[test]
fn motion_inspector_names_the_selected_property_and_keeps_base_opacity_unchanged() {
    let (mut session, target, composition_id, track_id) = motion_session();
    session
        .execute(
            "motion.keyframe.set",
            &json!({"compositionId": composition_id, "trackId": track_id, "frame": 12, "value": 0.42, "interpolation": serde_json::to_value(Interpolation::Step).unwrap()}),
        )
        .unwrap();
    let mut ui = HeadlessUi::new(session);
    ui.app.ui.right_tab = crate::RightTab::Motion;
    ui.app.ui.motion_composition = Some(composition_id);
    ui.app.ui.motion_active_track = Some(track_id);
    ui.app.ui.motion_selected = Some((track_id, 12));

    let nodes = accesskit_tree(&mut ui);
    let opacity = nodes.iter().find(|node| node.role() == Role::SpinButton && node.label() == Some("Opacity")).expect("Opacity keyframe field");
    assert_eq!(opacity.value(), Some("42%"));
    assert!(
        nodes.iter().all(|node| !(node.role() == Role::SpinButton && node.label() == Some("Value"))),
        "the field is named for the animated property"
    );
    assert_eq!(
        ui.app.session.doc().unwrap().node(target).unwrap().opacity,
        1.0,
        "the inspector reads and edits the selected keyframe, not the base Design property"
    );

    press_key(&mut ui, egui::Key::F6);
    for _ in 0..200 {
        if crate::a11y::focused_name(&ui.ctx) == "Opacity" {
            break;
        }
        press_key(&mut ui, egui::Key::Tab);
    }
    assert_eq!(crate::a11y::focused_name(&ui.ctx), "Opacity", "the keyframe value field is keyboard reachable");
    press_key(&mut ui, egui::Key::ArrowUp);
    let edited_nodes = accesskit_tree(&mut ui);
    let edited_opacity =
        edited_nodes.iter().find(|node| node.role() == Role::SpinButton && node.label() == Some("Opacity")).expect("edited Opacity keyframe field");
    assert_ne!(edited_opacity.value(), Some("42%"), "ArrowUp edits the selected keyframe value");
    let document = ui.app.session.doc().unwrap();
    let composition = document.motion.compositions.iter().find(|composition| composition.id == composition_id).unwrap();
    let track = composition.tracks.iter().find(|track| track.id == track_id).unwrap();
    let keyframe = track.keyframes.iter().find(|key| key.frame == 12).unwrap();
    assert_ne!(keyframe.value, 0.42);
    assert_eq!(keyframe.interpolation, Interpolation::Step, "editing a keyframe value preserves its interpolation");
    assert_eq!(document.node(target).unwrap().opacity, 1.0, "editing the Motion value leaves base Design opacity unchanged");
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

#[test]
fn ruler_prefers_seconds_at_normal_zoom_and_frames_when_zoomed_in() {
    assert_eq!(crate::motion_panel::ruler_label_step(2.0, 30), 30, "normal zoom labels seconds");
    assert_eq!(crate::motion_panel::ruler_label_step(0.5, 30), 150, "distant zoom uses five-second intervals");
    assert_eq!(crate::motion_panel::ruler_label_step(64.0, 30), 1, "close zoom labels individual frames");
}
