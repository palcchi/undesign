//! Motion Studio's first editing surface: compositions, animated properties and keyframes.
use egui::{Rect, Sense, Stroke, Ui, pos2, vec2};
use serde_json::json;
use undesign_doc::AnimatedProperty;

use crate::FigApp;
use crate::theme::Tokens;

fn property_label(property: AnimatedProperty) -> &'static str {
    match property {
        AnimatedProperty::PositionX => "Position X",
        AnimatedProperty::PositionY => "Position Y",
        AnimatedProperty::Rotation => "Rotation",
        AnimatedProperty::ScaleX => "Scale X",
        AnimatedProperty::ScaleY => "Scale Y",
        AnimatedProperty::Opacity => "Opacity",
        AnimatedProperty::Width => "Width",
        AnimatedProperty::Height => "Height",
    }
}

fn properties() -> [AnimatedProperty; 8] {
    [
        AnimatedProperty::PositionX,
        AnimatedProperty::PositionY,
        AnimatedProperty::Rotation,
        AnimatedProperty::ScaleX,
        AnimatedProperty::ScaleY,
        AnimatedProperty::Opacity,
        AnimatedProperty::Width,
        AnimatedProperty::Height,
    ]
}

pub fn panel(app: &mut FigApp, ui: &mut Ui) {
    let t = Tokens::get(ui.ctx());
    ui.add_space(10.0);
    ui.horizontal(|ui| {
        ui.heading("Motion Studio");
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.label(egui::RichText::new("BETA").size(9.0).color(t.text_tertiary));
        });
    });
    ui.add_space(4.0);
    ui.label(egui::RichText::new("Animate layers with editable keyframes").size(11.0).color(t.text_secondary));
    ui.add_space(10.0);

    let compositions = app.session.doc().map(|d| d.motion.compositions.clone()).unwrap_or_default();
    if compositions.is_empty() {
        ui.label(egui::RichText::new("No compositions yet").color(t.text_secondary));
        ui.add_space(8.0);
        if ui.button("＋  Create composition").clicked()
            && let Some(result) =
                app.run("motion.composition.create", json!({"name":"Main","width":1920,"height":1080,"fps":30,"durationFrames":300}))
        {
            app.ui.motion_composition = result.get("compositionId").and_then(serde_json::Value::as_u64);
            app.ui.motion_frame = 0;
        }
        return;
    }

    let selected_id = app.ui.motion_composition.filter(|id| compositions.iter().any(|c| c.id == *id)).unwrap_or(compositions[0].id);
    app.ui.motion_composition = Some(selected_id);
    let selected_name = compositions.iter().find(|c| c.id == selected_id).map(|c| c.name.as_str()).unwrap_or("Composition");
    egui::ComboBox::from_id_salt("motion-composition").selected_text(selected_name).width(ui.available_width()).show_ui(ui, |ui| {
        for composition in &compositions {
            ui.selectable_value(&mut app.ui.motion_composition, Some(composition.id), &composition.name);
        }
    });

    let Some(composition) = compositions.iter().find(|c| c.id == selected_id).cloned() else { return };
    ui.horizontal(|ui| {
        ui.label(format!("{} × {}", composition.width, composition.height));
        ui.separator();
        ui.label(format!("{} fps", composition.fps));
        ui.separator();
        ui.label(format!("{:.1}s", composition.duration_seconds()));
    });
    ui.add_space(8.0);
    ui.separator();

    ui.label(egui::RichText::new("PLAYHEAD").size(9.0).strong().color(t.text_tertiary));
    let mut frame = app.ui.motion_frame.min(composition.duration_frames);
    ui.horizontal(|ui| {
        ui.label("Frame");
        let changed = ui.add(egui::DragValue::new(&mut frame).range(0..=composition.duration_frames).speed(1)).changed();
        if changed {
            app.ui.motion_frame = frame;
        }
        ui.label(format!("/ {}", composition.duration_frames));
    });
    let slider = ui.add(egui::Slider::new(&mut frame, 0..=composition.duration_frames).show_value(false));
    if slider.changed() {
        app.ui.motion_frame = frame;
    }
    ui.add_space(8.0);
    ui.separator();

    ui.label(egui::RichText::new("ADD TRACK").size(9.0).strong().color(t.text_tertiary));
    let selected = app.session.selection().first().copied();
    let selected_name = selected.and_then(|id| app.session.doc().ok()?.node(id).map(|n| n.name.clone()));
    ui.label(selected_name.as_deref().unwrap_or("Select a layer on the canvas"));
    ui.horizontal(|ui| {
        egui::ComboBox::from_id_salt("motion-property")
            .selected_text(property_label(app.ui.motion_property))
            .width((ui.available_width() - 78.0).max(90.0))
            .show_ui(ui, |ui| {
                for property in properties() {
                    ui.selectable_value(&mut app.ui.motion_property, property, property_label(property));
                }
            });
        let can_add = selected.is_some();
        if ui.add_enabled(can_add, egui::Button::new("＋ Track")).clicked()
            && let Some(target) = selected
        {
            app.run(
                "motion.track.add",
                json!({
                    "compositionId": selected_id,
                    "target": target.0,
                    "property": serde_json::to_value(app.ui.motion_property).unwrap_or(serde_json::Value::Null)
                }),
            );
        }
    });
    ui.add_space(8.0);
    ui.separator();

    ui.label(egui::RichText::new("KEYFRAME").size(9.0).strong().color(t.text_tertiary));
    ui.horizontal(|ui| {
        ui.label("Value");
        ui.add(egui::DragValue::new(&mut app.ui.motion_value).speed(0.1).max_decimals(3));
    });
    let matching_track = selected.and_then(|target| {
        composition.tracks.iter().find(|track| track.target == target && track.property == app.ui.motion_property).map(|track| track.id)
    });
    if ui.add_enabled(selected.is_some(), egui::Button::new("◆  Set keyframe at current frame")).clicked()
        && let Some(target) = selected
    {
        let track_id = matching_track.or_else(|| {
            let result = app.run(
                "motion.track.add",
                json!({
                    "compositionId": selected_id,
                    "target": target.0,
                    "property": serde_json::to_value(app.ui.motion_property).unwrap_or(serde_json::Value::Null)
                }),
            )?;
            result.get("trackId").and_then(serde_json::Value::as_u64)
        });
        if let Some(track_id) = track_id {
            app.run(
                "motion.keyframe.set",
                json!({
                    "compositionId": selected_id,
                    "trackId": track_id,
                    "frame": app.ui.motion_frame.min(composition.duration_frames),
                    "value": app.ui.motion_value,
                    "interpolation": "linear"
                }),
            );
        }
    }

    ui.add_space(10.0);
    ui.separator();
    ui.horizontal(|ui| {
        ui.label(egui::RichText::new("TIMELINE").size(9.0).strong().color(t.text_tertiary));
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.label(egui::RichText::new(format!("{} tracks", composition.tracks.len())).size(10.0).color(t.text_secondary));
        });
    });
    if composition.tracks.is_empty() {
        ui.add_space(8.0);
        ui.label(egui::RichText::new("Add a track to start animating").size(11.0).color(t.text_secondary));
    }
    for track in &composition.tracks {
        let name =
            app.session.doc().ok().and_then(|d| d.node(track.target).map(|n| n.name.clone())).unwrap_or_else(|| format!("Layer {}", track.target.0));
        ui.horizontal(|ui| {
            ui.label(egui::RichText::new(name).size(11.0).strong());
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.label(egui::RichText::new(property_label(track.property)).size(10.0).color(t.text_secondary));
            });
        });
        let width = ui.available_width().max(80.0);
        let (rect, response) = ui.allocate_exact_size(vec2(width, 28.0), Sense::click());
        ui.painter().rect_filled(rect, 4.0, t.field);
        let y = rect.center().y;
        ui.painter().line_segment([pos2(rect.left() + 5.0, y), pos2(rect.right() - 5.0, y)], Stroke::new(1.0, t.border_strong));
        for tick in 0..=10 {
            let x = rect.left() + 5.0 + (rect.width() - 10.0) * tick as f32 / 10.0;
            ui.painter().line_segment([pos2(x, y - 3.0), pos2(x, y + 3.0)], Stroke::new(1.0, t.text_tertiary));
        }
        let playhead_x = rect.left()
            + 5.0
            + (rect.width() - 10.0) * app.ui.motion_frame.min(composition.duration_frames) as f32 / composition.duration_frames.max(1) as f32;
        ui.painter().line_segment([pos2(playhead_x, rect.top() + 2.0), pos2(playhead_x, rect.bottom() - 2.0)], Stroke::new(1.2, t.accent));
        if response.clicked()
            && let Some(pointer) = response.interact_pointer_pos()
        {
            let ratio = ((pointer.x - rect.left() - 5.0) / (rect.width() - 10.0).max(1.0)).clamp(0.0, 1.0);
            app.ui.motion_frame = (ratio * composition.duration_frames as f32).round() as u32;
        }
        for keyframe in &track.keyframes {
            let x = rect.left() + 5.0 + (rect.width() - 10.0) * keyframe.frame as f32 / composition.duration_frames.max(1) as f32;
            let diamond = Rect::from_center_size(pos2(x, y), vec2(8.0, 8.0));
            let points = vec![pos2(x, diamond.top()), pos2(diamond.right(), y), pos2(x, diamond.bottom()), pos2(diamond.left(), y)];
            let hit = Rect::from_center_size(pos2(x, y), vec2(14.0, 18.0));
            let key_response = ui.interact(hit, ui.id().with(("motion-key", composition.id, track.id, keyframe.frame)), Sense::click());
            ui.painter().add(egui::Shape::convex_polygon(
                points,
                if keyframe.frame == app.ui.motion_frame { t.accent } else { t.text_secondary },
                Stroke::NONE,
            ));
            if key_response.clicked() {
                app.ui.motion_frame = keyframe.frame;
                app.ui.motion_value = keyframe.value;
            }
        }
        ui.add_space(4.0);
    }
}
