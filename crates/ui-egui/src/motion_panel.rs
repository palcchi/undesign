//! Motion Studio properties and a compact timeline dock for scenes, per-layer tracks and keyframes.
//!
//! A scene is a lightweight composition: one timeline over the document's layers, usually started
//! from a Frame's size and name. Scenes never nest.
use egui::{Align2, CornerRadius, Key, Modifiers, Rect, Response, Sense, Stroke, StrokeKind, Ui, pos2, vec2};
use serde_json::json;
use undesign_doc::{AnimatedProperty, AnimationTrack, Composition, NodeId, NodeKind};

use crate::FigApp;
use crate::theme::{Tokens, regular, semibold};

const RULER_H: f32 = 22.0;
const LAYER_H: f32 = 28.0;
const PROPERTY_H: f32 = 24.0;
const LANE_GAP: f32 = 6.0;
/// Keyframes at frame 0 and the last frame sit this far inside the lane so they are not clipped.
const KEY_INSET: f32 = 8.0;
const MAX_SCENE_SIDE: f32 = 16384.0;

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

fn selected_composition(app: &mut FigApp) -> Option<Composition> {
    let compositions = app.session.doc().ok()?.motion.compositions.clone();
    let id = app.ui.motion_composition.filter(|id| compositions.iter().any(|c| c.id == *id)).unwrap_or(compositions.first()?.id);
    app.ui.motion_composition = Some(id);
    compositions.into_iter().find(|c| c.id == id)
}

/// Motion-specific controls stay in the inspector; the timeline itself is docked beneath the canvas.
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
        if crate::widgets::button(ui, "＋  Create composition", true, true).clicked()
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

    ui.label(egui::RichText::new("Add track").size(11.0).strong().color(t.text));
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
        if crate::widgets::button(ui, "＋ Track", false, can_add).clicked()
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

    ui.label(egui::RichText::new("Keyframe").size(11.0).strong().color(t.text));
    ui.horizontal(|ui| {
        ui.label("Value");
        ui.add(egui::DragValue::new(&mut app.ui.motion_value).speed(0.1).max_decimals(3));
    });
    if crate::widgets::button(ui, "◆  Set keyframe at current frame", true, selected.is_some()).clicked() {
        set_keyframe_at_playhead(app, &composition);
    }
}

/// Keys the selected layer's current Motion property at the playhead, adding its track if needed.
fn set_keyframe_at_playhead(app: &mut FigApp, composition: &Composition) {
    let Some(target) = app.session.selection().first().copied() else { return };
    let property = app.ui.motion_property;
    let track_id = composition.tracks.iter().find(|track| track.target == target && track.property == property).map(|track| track.id).or_else(|| {
        let result = app.run(
            "motion.track.add",
            json!({
                "compositionId": composition.id,
                "target": target.0,
                "property": serde_json::to_value(property).unwrap_or(serde_json::Value::Null)
            }),
        )?;
        result.get("trackId").and_then(serde_json::Value::as_u64)
    });
    if let Some(track_id) = track_id {
        app.run(
            "motion.keyframe.set",
            json!({
                "compositionId": composition.id,
                "trackId": track_id,
                "frame": app.ui.motion_frame.min(composition.duration_frames),
                "value": app.ui.motion_value,
                "interpolation": "linear"
            }),
        );
    }
}

/// A compact diamond button: keys the selected layer at the playhead.
fn add_keyframe_button(app: &mut FigApp, ui: &mut Ui, composition: &Composition, t: Tokens) {
    let enabled = !app.session.selection().is_empty();
    let (rect, resp) = ui.allocate_exact_size(vec2(26.0, 26.0), if enabled { Sense::click() } else { Sense::hover() });
    crate::a11y::button(&resp, "Add keyframe at playhead");
    let resp = resp.on_hover_text(if enabled { "Add keyframe at playhead" } else { "Select a layer to add a keyframe" });
    if enabled && (resp.hovered() || resp.is_pointer_button_down_on()) {
        ui.painter().rect_filled(rect, CornerRadius::same(8), if resp.is_pointer_button_down_on() { t.pressed } else { t.hover });
    }
    let color = if enabled { t.icon_secondary } else { t.text_tertiary };
    paint_diamond(ui, rect.center(), 5.5, color);
    paint_diamond(ui, rect.center(), 2.5, if resp.hovered() && enabled { t.hover } else { t.panel });
    if resp.clicked() {
        set_keyframe_at_playhead(app, composition);
    }
}

/// Horizontal split shared by the ruler and every row, so the playhead lines up across them.
#[derive(Clone, Copy)]
struct Geometry {
    label_w: f32,
    duration: u32,
}

impl Geometry {
    fn new(total: f32, composition: &Composition) -> Self {
        Self { label_w: timeline_label_width(total), duration: composition.duration_frames.max(1) }
    }

    /// The label column and the lane of a full-width row.
    fn split(self, row: Rect) -> (Rect, Rect) {
        let label = Rect::from_min_max(row.min, pos2(row.min.x + self.label_w, row.max.y));
        let lane = Rect::from_min_max(pos2(label.max.x + LANE_GAP, row.min.y), row.max);
        (label, lane)
    }
}

fn track_span(lane: Rect) -> Rect {
    lane.shrink2(vec2(KEY_INSET, 0.0))
}

fn x_at_frame(span: Rect, frame: u32, duration: u32) -> f32 {
    span.left() + span.width() * frame.min(duration) as f32 / duration.max(1) as f32
}

fn frame_at_x(span: Rect, x: f32, duration: u32) -> u32 {
    if !x.is_finite() {
        return 0;
    }
    let ratio = ((x - span.left()) / span.width().max(1.0)).clamp(0.0, 1.0);
    ((ratio * duration as f32).round() as u32).min(duration)
}

fn shifted_frame(frame: u32, delta: i64, duration: u32) -> u32 {
    (i64::from(frame) + delta).clamp(0, i64::from(duration)) as u32
}

fn timeline_label_width(total: f32) -> f32 {
    ((total * 0.22).clamp(150.0, 280.0)).min((total - 96.0).max(64.0))
}

fn seconds_per_tick(duration: f64) -> f64 {
    let target = (duration / 5.0).max(0.1);
    for step in [0.5, 1.0, 2.0, 5.0, 10.0, 15.0, 30.0, 60.0] {
        if step >= target {
            return step;
        }
    }
    (target / 60.0).ceil().max(1.0) * 60.0
}

/// Ruler ticks as (x in the lane span, seconds).
fn ticks(span: Rect, composition: &Composition) -> Vec<(f32, f64)> {
    let duration = composition.duration_seconds().max(0.001);
    let step = seconds_per_tick(duration);
    let last = (duration / step).floor().clamp(0.0, 64.0) as usize;
    (0..=last)
        .map(|tick| {
            let seconds = tick as f64 * step;
            (span.left() + span.width() * (seconds / duration) as f32, seconds)
        })
        .collect()
}

fn selected_frame(app: &FigApp) -> Option<(String, u32, u32)> {
    let id = app.session.selection().first().copied()?;
    let doc = app.session.doc().ok()?;
    let node = doc.node(id)?;
    if !matches!(node.kind, NodeKind::Frame) {
        return None;
    }
    Some((node.name.clone(), scene_side(node.width), scene_side(node.height)))
}

fn scene_side(value: f64) -> u32 {
    if value.is_finite() { value.round().clamp(1.0, f64::from(MAX_SCENE_SIDE)) as u32 } else { 1 }
}

fn layer_name(app: &FigApp, target: NodeId) -> String {
    app.session.doc().ok().and_then(|d| d.node(target).map(|n| n.name.clone())).unwrap_or_else(|| format!("Layer {}", target.0))
}

/// Tracks grouped by layer, in the order each layer first appears.
fn layer_groups(composition: &Composition) -> Vec<(NodeId, Vec<&AnimationTrack>)> {
    let mut groups: Vec<(NodeId, Vec<&AnimationTrack>)> = Vec::new();
    for track in &composition.tracks {
        match groups.iter_mut().find(|(target, _)| *target == track.target) {
            Some((_, tracks)) => tracks.push(track),
            None => groups.push((track.target, vec![track])),
        }
    }
    groups
}

/// The bottom dock: scene and transport on top, then the ruler and one group of tracks per layer.
pub fn timeline_dock(app: &mut FigApp, ui: &mut Ui) {
    let t = Tokens::get(ui.ctx());
    egui::Frame::NONE.inner_margin(egui::Margin::symmetric(10, 6)).show(ui, |ui| {
        let composition = selected_composition(app);
        transport(app, ui, composition.as_ref(), t);
        ui.add_space(6.0);
        let Some(composition) = composition else {
            ui.label(
                egui::RichText::new("No scenes yet. Select a Frame and press ＋ Scene to animate it, or start with a blank scene.")
                    .size(11.0)
                    .color(t.text_secondary),
            );
            return;
        };

        advance_playhead(app, ui, &composition);
        let total = ui.available_width();
        let geo = Geometry::new(total, &composition);
        ruler(app, ui, &composition, geo, total, t);
        if composition.tracks.is_empty() {
            ui.add_space(6.0);
            ui.label(
                egui::RichText::new("Select a layer, then add a track or set a keyframe in the Motion panel").size(10.5).color(t.text_secondary),
            );
        }
        egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
            ui.spacing_mut().item_spacing.y = 0.0;
            for (target, tracks) in layer_groups(&composition) {
                let collapsed = layer_row(app, ui, &composition, geo, total, target, &tracks, t);
                if !collapsed {
                    for track in tracks {
                        property_row(app, ui, &composition, geo, total, track, t);
                    }
                }
            }
        });
    });
}

fn transport(app: &mut FigApp, ui: &mut Ui, composition: Option<&Composition>, t: Tokens) {
    let scenes: Vec<(u64, String)> =
        app.session.doc().map(|d| d.motion.compositions.iter().map(|c| (c.id, c.name.clone())).collect()).unwrap_or_default();
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = 7.0;
        ui.label(egui::RichText::new("Scene").font(semibold(12.0)).color(t.text));
        if let Some(composition) = composition {
            let before = app.ui.motion_composition;
            egui::ComboBox::from_id_salt("motion-scene").selected_text(&composition.name).width(150.0).show_ui(ui, |ui| {
                for (id, name) in &scenes {
                    ui.selectable_value(&mut app.ui.motion_composition, Some(*id), name);
                }
            });
            if before != app.ui.motion_composition {
                app.ui.motion_frame = 0;
                app.ui.motion_playing = false;
            }
        }
        new_scene_button(app, ui, composition);
        let Some(composition) = composition else { return };

        ui.separator();
        let max_frame = composition.duration_frames;
        let playing = app.ui.motion_playing;
        if crate::widgets::icon_button(
            ui,
            if playing { crate::icons::Icon::Pause } else { crate::icons::Icon::Play },
            if playing { "Pause" } else { "Play" },
        ) {
            app.ui.motion_playing = !playing;
            app.ui.motion_play_acc = 0.0;
            app.ui.motion_play_last = 0.0;
        }
        add_keyframe_button(app, ui, composition, t);
        let mut frame = app.ui.motion_frame.min(max_frame);
        if ui.add_sized(vec2(58.0, 22.0), egui::DragValue::new(&mut frame).range(0..=max_frame).speed(1)).changed() {
            app.ui.motion_frame = frame;
        }
        ui.label(egui::RichText::new(format!("/ {max_frame}")).size(11.0).color(t.text_secondary));
        ui.label(format!("{:.2}s", f64::from(frame) / f64::from(composition.fps.max(1))));
        ui.label(
            egui::RichText::new(format!("{} fps · {} layers", composition.fps, layer_groups(composition).len())).size(10.0).color(t.text_secondary),
        );
    });
}

/// A scene starts from the selected Frame's name and size; with no scenes yet, a blank one is allowed.
fn new_scene_button(app: &mut FigApp, ui: &mut Ui, composition: Option<&Composition>) {
    let frame = selected_frame(app);
    let enabled = frame.is_some() || composition.is_none();
    let label = if frame.is_some() { "＋ Scene from Frame" } else { "＋ Scene" };
    let hint = if enabled { "Create a scene" } else { "Select a Frame to turn it into a scene" };
    if !crate::widgets::button(ui, label, composition.is_none(), enabled).on_hover_text(hint).clicked() {
        return;
    }
    let (name, width, height) = frame.unwrap_or_else(|| ("Main".to_string(), 1920, 1080));
    let fps = composition.map_or(30, |c| c.fps);
    let duration = composition.map_or(300, |c| c.duration_frames);
    if let Some(result) =
        app.run("motion.composition.create", json!({"name": name, "width": width, "height": height, "fps": fps, "durationFrames": duration}))
    {
        app.ui.motion_composition = result.get("compositionId").and_then(serde_json::Value::as_u64);
        app.ui.motion_frame = 0;
        app.ui.motion_playing = false;
    }
}

fn advance_playhead(app: &mut FigApp, ui: &Ui, composition: &Composition) {
    if !app.ui.motion_playing {
        return;
    }
    let now = ui.ctx().input(|i| i.time);
    let dt = if app.ui.motion_play_last > 0.0 { (now - app.ui.motion_play_last).clamp(0.0, 0.25) } else { 0.0 };
    app.ui.motion_play_last = now;
    app.ui.motion_play_acc += dt * f64::from(composition.fps.max(1));
    let steps = app.ui.motion_play_acc.floor().max(0.0) as u32;
    if steps > 0 {
        app.ui.motion_play_acc -= f64::from(steps);
        let len = composition.duration_frames.saturating_add(1).max(1);
        app.ui.motion_frame = app.ui.motion_frame.saturating_add(steps) % len;
    }
    ui.ctx().request_repaint();
}

/// Pressing or dragging a lane moves the playhead and pauses playback.
fn scrub(app: &mut FigApp, resp: &Response, span: Rect, duration: u32) {
    if (resp.clicked() || resp.dragged())
        && let Some(pointer) = resp.interact_pointer_pos()
    {
        app.ui.motion_frame = frame_at_x(span, pointer.x, duration);
        app.ui.motion_playing = false;
    }
}

fn paint_playhead(ui: &Ui, span: Rect, rows: Rect, frame: u32, duration: u32, t: Tokens) {
    let x = x_at_frame(span, frame, duration);
    ui.painter().line_segment([pos2(x, rows.top()), pos2(x, rows.bottom())], Stroke::new(1.5, t.accent));
}

fn paint_diamond(ui: &Ui, center: egui::Pos2, half: f32, fill: egui::Color32) {
    ui.painter().add(egui::Shape::convex_polygon(
        vec![pos2(center.x, center.y - half), pos2(center.x + half, center.y), pos2(center.x, center.y + half), pos2(center.x - half, center.y)],
        fill,
        Stroke::NONE,
    ));
}

fn ruler(app: &mut FigApp, ui: &mut Ui, composition: &Composition, geo: Geometry, total: f32, t: Tokens) {
    let (row, _) = ui.allocate_exact_size(vec2(total, RULER_H), Sense::hover());
    let (label, lane) = geo.split(row);
    let span = track_span(lane);
    ui.painter().rect_filled(label, CornerRadius::same(3), t.hover);
    ui.painter().text(pos2(label.min.x + 8.0, label.center().y), Align2::LEFT_CENTER, "Layers", semibold(10.5), t.text);

    let resp = ui.interact(lane, ui.id().with(("motion-ruler", composition.id)), Sense::click_and_drag());
    crate::a11y::button(&resp, "Timeline ruler");
    scrub(app, &resp, span, geo.duration);

    let painter = ui.painter();
    painter.line_segment([lane.left_bottom(), lane.right_bottom()], Stroke::new(1.0, t.border));
    let duration = composition.duration_seconds().max(0.001);
    for (x, seconds) in ticks(span, composition) {
        painter.line_segment([pos2(x, lane.bottom() - 5.0), pos2(x, lane.bottom())], Stroke::new(1.0, t.control_border));
        let text = if seconds.fract().abs() < 0.001 { format!("{seconds:.0}s") } else { format!("{seconds:.1}s") };
        let align = if seconds <= 0.0 {
            Align2::LEFT_BOTTOM
        } else if seconds >= duration - 0.001 {
            Align2::RIGHT_BOTTOM
        } else {
            Align2::CENTER_BOTTOM
        };
        painter.text(pos2(x, lane.bottom() - 6.0), align, text, regular(9.5), t.text_secondary);
    }
    let x = x_at_frame(span, app.ui.motion_frame, geo.duration);
    painter.line_segment([pos2(x, lane.top() + 5.0), pos2(x, lane.bottom())], Stroke::new(1.5, t.accent));
    painter.add(egui::Shape::convex_polygon(
        vec![pos2(x - 4.5, lane.top() + 1.0), pos2(x + 4.5, lane.top() + 1.0), pos2(x, lane.top() + 7.0)],
        t.accent,
        Stroke::NONE,
    ));
}

fn paint_lane(ui: &Ui, lane: Rect, composition: &Composition, fill: egui::Color32, t: Tokens) {
    let painter = ui.painter();
    painter.rect_filled(lane, CornerRadius::same(3), fill);
    painter.line_segment([lane.left_bottom(), lane.right_bottom()], Stroke::new(1.0, t.border));
    for (x, _) in ticks(track_span(lane), composition) {
        painter.line_segment([pos2(x, lane.top() + 2.0), pos2(x, lane.bottom() - 2.0)], Stroke::new(1.0, t.border));
    }
}

/// Selecting a track's layer keeps the Motion panel's "Set keyframe" aimed at the same property.
fn focus_track(app: &mut FigApp, target: NodeId, property: AnimatedProperty) {
    if app.session.selection().first().copied() != Some(target) {
        app.run("select.set", json!({"ids": [target.0]}));
    }
    app.ui.motion_property = property;
}

/// Returns whether the layer's property rows are folded away.
#[allow(clippy::too_many_arguments)]
fn layer_row(
    app: &mut FigApp,
    ui: &mut Ui,
    composition: &Composition,
    geo: Geometry,
    total: f32,
    target: NodeId,
    tracks: &[&AnimationTrack],
    t: Tokens,
) -> bool {
    let fold_id = egui::Id::new(("motion-collapsed", composition.id, target.0));
    let mut collapsed = ui.data(|d| d.get_temp::<bool>(fold_id)).unwrap_or(false);
    let (row, _) = ui.allocate_exact_size(vec2(total, LAYER_H), Sense::hover());
    let (label, lane) = geo.split(row);
    let span = track_span(lane);
    let name = layer_name(app, target);
    let selected = app.session.selection().first().copied() == Some(target);
    ui.painter().rect_filled(label, CornerRadius::same(3), if selected { t.selected_row } else { t.hover });
    paint_lane(ui, lane, composition, if selected { t.selected_row_child } else { t.field }, t);
    ui.painter()
        .line_segment([pos2(label.max.x + LANE_GAP / 2.0, row.top()), pos2(label.max.x + LANE_GAP / 2.0, row.bottom())], Stroke::new(1.0, t.border));
    ui.painter().line_segment([label.left_bottom(), label.right_bottom()], Stroke::new(1.0, t.border));

    let caret = Rect::from_min_size(label.min, vec2(22.0, LAYER_H));
    let caret_resp = ui.interact(caret, fold_id.with("caret"), Sense::click());
    crate::a11y::toggle(&caret_resp, &format!("{name} tracks"), !collapsed);
    if caret_resp.clicked() {
        collapsed = !collapsed;
        ui.data_mut(|d| d.insert_temp(fold_id, collapsed));
    }
    let c = caret.center();
    let triangle = if collapsed {
        vec![pos2(c.x - 2.5, c.y - 4.0), pos2(c.x + 3.0, c.y), pos2(c.x - 2.5, c.y + 4.0)]
    } else {
        vec![pos2(c.x - 4.0, c.y - 2.5), pos2(c.x + 4.0, c.y - 2.5), pos2(c.x, c.y + 3.0)]
    };
    ui.painter().add(egui::Shape::convex_polygon(triangle, t.icon_secondary, Stroke::NONE));

    let name_rect = Rect::from_min_max(pos2(caret.max.x, label.min.y), label.max);
    let name_resp = ui.interact(name_rect, fold_id.with("name"), Sense::click());
    crate::a11y::button(&name_resp, &format!("Select {name}"));
    if name_resp.clicked() {
        let property = app.ui.motion_property;
        focus_track(app, target, property);
    }
    ui.painter().with_clip_rect(name_rect.shrink2(vec2(2.0, 0.0))).text(
        pos2(name_rect.min.x + 2.0, name_rect.center().y),
        Align2::LEFT_CENTER,
        &name,
        semibold(11.5),
        t.text,
    );

    let resp = ui.interact(lane, fold_id.with("lane"), Sense::click_and_drag());
    crate::a11y::button(&resp, &format!("{name} timeline"));
    scrub(app, &resp, span, geo.duration);
    let mut frames: Vec<u32> = tracks.iter().flat_map(|track| track.keyframes.iter().map(|k| k.frame)).collect();
    frames.sort_unstable();
    frames.dedup();
    for frame in frames {
        paint_diamond(ui, pos2(x_at_frame(span, frame, geo.duration), lane.center().y), 3.5, t.text_tertiary);
    }
    paint_playhead(ui, span, lane, app.ui.motion_frame, geo.duration, t);
    collapsed
}

fn property_row(app: &mut FigApp, ui: &mut Ui, composition: &Composition, geo: Geometry, total: f32, track: &AnimationTrack, t: Tokens) {
    let name = layer_name(app, track.target);
    let property = property_label(track.property);
    let (row, _) = ui.allocate_exact_size(vec2(total, PROPERTY_H), Sense::hover());
    let (label, lane) = geo.split(row);
    let span = track_span(lane);
    let selected = app.session.selection().first().copied() == Some(track.target) && app.ui.motion_property == track.property;
    if selected {
        ui.painter().rect_filled(label, CornerRadius::same(3), t.selected_row);
    }
    paint_lane(ui, lane, composition, if selected { t.selected_row_child } else { t.canvas }, t);
    ui.painter()
        .line_segment([pos2(label.max.x + LANE_GAP / 2.0, row.top()), pos2(label.max.x + LANE_GAP / 2.0, row.bottom())], Stroke::new(1.0, t.border));

    let label_resp = ui.interact(label, ui.id().with(("motion-property", composition.id, track.id)), Sense::click());
    crate::a11y::button(&label_resp, &format!("{name} {property} track"));
    if label_resp.clicked() {
        focus_track(app, track.target, track.property);
    }
    ui.painter().with_clip_rect(label.shrink2(vec2(2.0, 0.0))).text(
        pos2(label.min.x + 26.0, label.center().y),
        Align2::LEFT_CENTER,
        property,
        regular(10.5),
        if selected { t.text } else { t.text_secondary },
    );

    let resp = ui.interact(lane, ui.id().with(("motion-lane", composition.id, track.id)), Sense::click_and_drag());
    crate::a11y::button(&resp, &format!("{name} {property} timeline"));
    scrub(app, &resp, span, geo.duration);
    for keyframe in &track.keyframes {
        keyframe_handle(app, ui, composition, track, keyframe, &name, span, lane.center().y, t);
    }
    paint_playhead(ui, span, lane, app.ui.motion_frame, geo.duration, t);
}

/// A draggable diamond. Dropping it runs `motion.keyframe.move`; the arrow keys nudge it a frame
/// (ten with Shift) while it has the keyboard.
#[allow(clippy::too_many_arguments)]
fn keyframe_handle(
    app: &mut FigApp,
    ui: &mut Ui,
    composition: &Composition,
    track: &AnimationTrack,
    keyframe: &undesign_doc::Keyframe,
    name: &str,
    span: Rect,
    cy: f32,
    t: Tokens,
) {
    let duration = composition.duration_frames.max(1);
    let id = ui.id().with(("motion-key", composition.id, track.id, keyframe.frame));
    let x = x_at_frame(span, keyframe.frame, duration);
    let resp = ui.interact(Rect::from_center_size(pos2(x, cy), vec2(14.0, PROPERTY_H)), id, Sense::click_and_drag());
    crate::a11y::button(&resp, &format!("{name} {} keyframe, frame {}", property_label(track.property), keyframe.frame));
    if resp.dragged() {
        ui.ctx().set_cursor_icon(egui::CursorIcon::Grabbing);
    } else if resp.hovered() {
        ui.ctx().set_cursor_icon(egui::CursorIcon::Grab);
    }
    if resp.clicked() || resp.drag_started() {
        resp.request_focus();
        app.ui.motion_frame = keyframe.frame;
        app.ui.motion_value = keyframe.value;
        app.ui.motion_playing = false;
        focus_track(app, track.target, track.property);
    }

    let drop_id = id.with("drop");
    let mut shown = keyframe.frame;
    if resp.dragged()
        && let Some(pointer) = resp.interact_pointer_pos()
    {
        shown = frame_at_x(span, pointer.x, duration);
        ui.data_mut(|d| d.insert_temp(drop_id, shown));
        app.ui.motion_frame = shown;
    }
    let mut to = if resp.drag_stopped() { ui.data_mut(|d| d.remove_temp::<u32>(drop_id)) } else { None };
    let had_focus = resp.has_focus();
    if had_focus {
        for (key, step) in [(Key::ArrowLeft, -1), (Key::ArrowRight, 1)] {
            if ui.input_mut(|i| i.consume_key(Modifiers::SHIFT, key)) {
                to = Some(shifted_frame(keyframe.frame, step * 10, duration));
            } else if ui.input_mut(|i| i.consume_key(Modifiers::NONE, key)) {
                to = Some(shifted_frame(keyframe.frame, step, duration));
            }
        }
    }
    if let Some(to) = to.filter(|to| *to != keyframe.frame)
        && app
            .run("motion.keyframe.move", json!({"compositionId": composition.id, "trackId": track.id, "fromFrame": keyframe.frame, "toFrame": to}))
            .is_some()
    {
        app.ui.motion_frame = to;
        // The handle's id carries its frame; the keyboard follows the keyframe to its new one.
        if had_focus {
            let moved = ui.id().with(("motion-key", composition.id, track.id, to));
            ui.memory_mut(|m| m.request_focus(moved));
        }
    }

    let center = pos2(x_at_frame(span, shown, duration), cy);
    if resp.has_focus() && app.ui.nav.keyboard {
        ui.painter().rect_stroke(
            Rect::from_center_size(center, vec2(14.0, 14.0)),
            CornerRadius::same(3),
            Stroke::new(1.5, t.focus),
            StrokeKind::Outside,
        );
    }
    paint_diamond(ui, center, 4.5, if shown == app.ui.motion_frame { t.accent } else { t.text_secondary });
    if resp.dragged() {
        ui.painter().text(center + vec2(9.0, 0.0), Align2::LEFT_CENTER, shown.to_string(), regular(9.5), t.text);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn span() -> Rect {
        Rect::from_min_max(pos2(100.0, 0.0), pos2(500.0, 20.0))
    }

    #[test]
    fn frames_and_pixels_round_trip_and_clamp_to_the_lane() {
        let span = span();
        for frame in [0, 1, 37, 60] {
            assert_eq!(frame_at_x(span, x_at_frame(span, frame, 60), 60), frame);
        }
        assert_eq!(frame_at_x(span, -50.0, 60), 0);
        assert_eq!(frame_at_x(span, 9000.0, 60), 60);
        assert_eq!(frame_at_x(span, f32::NAN, 60), 0);
        assert_eq!(frame_at_x(span, f32::INFINITY, 60), 0);
        assert_eq!(x_at_frame(span, 9000, 60), span.right());
    }

    #[test]
    fn a_zero_width_lane_or_duration_does_not_divide_by_zero() {
        let flat = Rect::from_min_max(pos2(10.0, 0.0), pos2(10.0, 20.0));
        assert_eq!(frame_at_x(flat, 400.0, 60), 60);
        assert!(x_at_frame(span(), 5, 0).is_finite());
        assert_eq!(frame_at_x(span(), 300.0, 0), 0);
    }

    #[test]
    fn arrow_nudges_stay_inside_the_scene() {
        assert_eq!(shifted_frame(5, -10, 60), 0);
        assert_eq!(shifted_frame(55, 10, 60), 60);
        assert_eq!(shifted_frame(30, 1, 60), 31);
    }

    #[test]
    fn scene_sizes_are_whole_finite_and_capped() {
        assert_eq!(scene_side(390.4), 390);
        assert_eq!(scene_side(0.0), 1);
        assert_eq!(scene_side(f64::NAN), 1);
        assert_eq!(scene_side(1e12), 16384);
    }
}
