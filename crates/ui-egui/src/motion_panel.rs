//! Motion Studio's timeline in After Effects style: layer rows that twirl open to
//! per-property lanes, a shared ruler and playhead (CTI), zoom-to-fit, stopwatch toggles and
//! draggable keyframes. Every edit runs an engine command; the saved document only changes
//! through undoable commands, while playback renders a preview (see `canvas.rs`).
use egui::{Align2, Rect, Sense, Stroke, Ui, pos2, vec2};
use serde_json::json;
use undesign_doc::{AnimatedProperty, Composition, NodeId};

use crate::FigApp;
use crate::a11y::Tip;
use crate::i18n::tr;
use crate::theme::{Tokens, regular};

const RULER_H: f32 = 20.0;
const LAYER_H: f32 = 24.0;
const PROP_H: f32 = 22.0;
/// Frozen label column width (screen space; the lanes start after it).
const LABEL_W: f32 = 100.0;
/// Lane start in content coordinates (past the labels).
const LANE_X0: f32 = LABEL_W + 16.0;
const DIAMOND: f32 = 8.0;
/// Snap radius in pixels, as in the reference timeline.
const SNAP_PX: f32 = 8.0;

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

/// A row's frozen label: what the overlay chip toggles.
enum RowRef {
    Layer { target: NodeId },
    Prop { target: NodeId, property: AnimatedProperty, track: Option<u64> },
}

/// A frame from a lane x, snapped to the nearest keyframe within [`SNAP_PX`].
fn snap_frame(composition: &Composition, frame: f32, ppf: f32) -> u32 {
    let mut best = frame.round().clamp(0.0, composition.duration_frames as f32);
    let tol = SNAP_PX / ppf.max(0.01);
    for track in &composition.tracks {
        for key in &track.keyframes {
            let at = key.frame as f32;
            if (at - frame).abs() <= tol && (at - frame).abs() < (best - frame).abs() {
                best = at;
            }
        }
    }
    best as u32
}

/// The nearest keyframe before (`dir` < 0) or after it across all tracks.
fn neighbor_key(composition: &Composition, frame: u32, dir: i8) -> Option<u32> {
    let mut best: Option<u32> = None;
    for track in &composition.tracks {
        for key in &track.keyframes {
            let wanted = if dir < 0 { key.frame < frame } else { key.frame > frame };
            if wanted && best.is_none_or(|at| if dir < 0 { key.frame > at } else { key.frame < at }) {
                best = Some(key.frame);
            }
        }
    }
    best
}

/// Ruler label step in frames: the smallest step at least ~40 px wide.
fn label_step(ppf: f32) -> u32 {
    [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].into_iter().find(|s| *s as f32 * ppf >= 40.0).unwrap_or(600)
}

fn paint_diamond(painter: &egui::Painter, at: egui::Pos2, size: f32, color: egui::Color32) {
    let half = size / 2.0;
    painter.add(egui::Shape::convex_polygon(
        vec![pos2(at.x, at.y - half), pos2(at.x + half, at.y), pos2(at.x, at.y + half), pos2(at.x - half, at.y)],
        color,
        Stroke::NONE,
    ));
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

    if empty_state(app, ui, &t) {
        return;
    }
    let Some(composition) = selected_composition(app) else { return };
    composition_combo(app, ui, "motion-composition", ui.available_width());
    meta_row(ui, &composition);
    ui.add_space(8.0);

    advance_playback(app, ui, &composition);
    transport(app, ui, &composition, &t);
    ui.add_space(4.0);
    timeline(app, ui, &composition, &t, "motion-timeline");
    ui.add_space(8.0);
    key_value(app, ui, &composition, &t);
}

/// The Motion timeline docked along the bottom: the same transport and timeline as the side
/// tab, wide enough to direct on.
pub fn dock(app: &mut FigApp, ui: &mut Ui) {
    let t = Tokens::get(ui.ctx());
    if empty_state(app, ui, &t) {
        return;
    }
    let Some(composition) = selected_composition(app) else { return };
    advance_playback(app, ui, &composition);
    ui.horizontal(|ui| {
        ui.label(egui::RichText::new("Motion Studio").size(13.0).strong().color(t.text));
        ui.label(egui::RichText::new("BETA").size(9.0).color(t.text_tertiary));
        ui.separator();
        composition_combo(app, ui, "motion-composition-dock", 200.0);
        let meta = format!("{} × {} · {} fps · {:.1}s", composition.width, composition.height, composition.fps, composition.duration_seconds());
        ui.label(egui::RichText::new(meta).color(t.text_secondary));
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            if crate::widgets::icon_button(ui, crate::icons::Icon::Close, tr("Close")) {
                app.run("motion.timeline", json!({"on": false}));
            }
        });
    });
    ui.add_space(2.0);
    transport(app, ui, &composition, &t);
    egui::ScrollArea::vertical().id_salt("motion-dock-scroll").show(ui, |ui| {
        timeline(app, ui, &composition, &t, "motion-dock-timeline");
    });
}

/// The compositions on the open document, if any.
fn compositions(app: &FigApp) -> Vec<Composition> {
    app.session.doc().map(|d| d.motion.compositions.clone()).unwrap_or_default()
}

/// The empty state (no compositions yet): an explanation and a way to make one. True when
/// there is nothing to direct.
fn empty_state(app: &mut FigApp, ui: &mut Ui, t: &Tokens) -> bool {
    if !compositions(app).is_empty() {
        return false;
    }
    ui.label(egui::RichText::new("No compositions yet").color(t.text_secondary));
    ui.add_space(8.0);
    if crate::widgets::button(ui, "＋  Create composition", true, true).clicked()
        && let Some(result) = app.run("motion.composition.create", json!({"name":"Main","width":1920,"height":1080,"fps":30,"durationFrames":300}))
    {
        app.ui.motion_composition = result.get("compositionId").and_then(serde_json::Value::as_u64);
        app.ui.motion_frame = 0;
    }
    true
}

/// The composition being directed: the remembered one when it still exists, else the first.
fn selected_composition(app: &mut FigApp) -> Option<Composition> {
    let all = compositions(app);
    if all.is_empty() {
        return None;
    }
    let selected = app.ui.motion_composition.filter(|id| all.iter().any(|c| c.id == *id)).unwrap_or(all[0].id);
    app.ui.motion_composition = Some(selected);
    all.into_iter().find(|c| c.id == selected)
}

/// The composition picker (the side tab and the dock keep their own open state).
fn composition_combo(app: &mut FigApp, ui: &mut Ui, salt: &str, width: f32) {
    let all = compositions(app);
    let name = app.ui.motion_composition.and_then(|id| all.iter().find(|c| c.id == id)).map(|c| c.name.as_str()).unwrap_or("Composition");
    egui::ComboBox::from_id_salt(salt).selected_text(name).width(width).show_ui(ui, |ui| {
        for composition in &all {
            ui.selectable_value(&mut app.ui.motion_composition, Some(composition.id), &composition.name);
        }
    });
}

/// One line of composition facts (size, frame rate, duration).
fn meta_row(ui: &mut Ui, composition: &Composition) {
    ui.horizontal(|ui| {
        ui.label(format!("{} × {}", composition.width, composition.height));
        ui.separator();
        ui.label(format!("{} fps", composition.fps));
        ui.separator();
        ui.label(format!("{:.1}s", composition.duration_seconds()));
    });
}

/// Frame-accurate advance at the composition's fps; loops for directing.
fn advance_playback(app: &mut FigApp, ui: &mut Ui, composition: &Composition) {
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
        let len = composition.duration_frames.saturating_add(1);
        app.ui.motion_frame = app.ui.motion_frame.saturating_add(steps) % len;
    }
    ui.ctx().request_repaint();
}

/// Transport: jump to start/end, previous/next keyframe, play/pause, and the CTI readout.
fn transport(app: &mut FigApp, ui: &mut Ui, composition: &Composition, t: &Tokens) {
    let frame = app.ui.motion_frame.min(composition.duration_frames);
    ui.horizontal(|ui| {
        if crate::widgets::icon_button(ui, crate::icons::Icon::SkipBack, "Go to start") {
            app.ui.motion_frame = 0;
        }
        if crate::widgets::icon_button(ui, crate::icons::Icon::PrevKey, "Previous keyframe")
            && let Some(at) = neighbor_key(composition, frame, -1)
        {
            app.ui.motion_frame = at;
        }
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
        if crate::widgets::icon_button(ui, crate::icons::Icon::NextKey, "Next keyframe")
            && let Some(at) = neighbor_key(composition, frame, 1)
        {
            app.ui.motion_frame = at;
        }
        if crate::widgets::icon_button(ui, crate::icons::Icon::SkipFwd, "Go to end") {
            app.ui.motion_frame = composition.duration_frames;
        }
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            let secs = f64::from(frame) / f64::from(composition.fps.max(1));
            ui.label(egui::RichText::new(format!("{frame}f·{secs:.2}s")).color(t.text_secondary));
        });
    });
}

/// Zoom controls: out, fit, in.
fn zoom(app: &mut FigApp, ui: &mut Ui, fit_ppf: f32) {
    ui.horizontal(|ui| {
        ui.label("Zoom");
        let base = app.ui.motion_ppf.unwrap_or(fit_ppf);
        if crate::widgets::icon_button(ui, crate::icons::Icon::Minus, "Zoom out") {
            app.ui.motion_ppf = Some((base / 1.25).clamp(0.25, 64.0));
        }
        if crate::widgets::button(ui, "Fit", false, true).clicked() {
            app.ui.motion_ppf = None;
        }
        if crate::widgets::icon_button(ui, crate::icons::Icon::Plus, "Zoom in") {
            app.ui.motion_ppf = Some((base * 1.25).clamp(0.25, 64.0));
        }
    });
}

/// Layers with tracks plus the selected layer, in first-seen order.
fn timeline_layers(composition: &Composition, selected: Option<NodeId>) -> Vec<NodeId> {
    let mut layers = Vec::new();
    for track in &composition.tracks {
        if !layers.contains(&track.target) {
            layers.push(track.target);
        }
    }
    if let Some(id) = selected
        && !layers.contains(&id)
    {
        layers.push(id);
    }
    layers
}

fn layer_name(app: &FigApp, target: NodeId) -> String {
    app.session.doc().ok().and_then(|d| d.node(target).map(|n| n.name.clone())).unwrap_or_else(|| format!("Layer {}", target.0))
}

/// The timeline: a shared ruler and playhead over layer rows that twirl open to property
/// lanes. Labels freeze on the left while the lanes scroll and zoom underneath.
fn timeline(app: &mut FigApp, ui: &mut Ui, composition: &Composition, t: &Tokens, salt: &str) {
    ui.horizontal(|ui| {
        ui.label(egui::RichText::new("Timeline").size(11.0).strong().color(t.text));
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.label(egui::RichText::new(format!("{} tracks", composition.tracks.len())).size(10.0).color(t.text_secondary));
        });
    });
    let fit_ppf = (ui.available_width() - LANE_X0 - 24.0).max(40.0) / composition.duration_frames.max(1) as f32;
    zoom(app, ui, fit_ppf);
    let ppf = app.ui.motion_ppf.unwrap_or(fit_ppf).clamp(0.25, 64.0);
    let x_of = |frame: f32| LANE_X0 + frame * ppf;
    let frame_of = |x: f32| ((x - LANE_X0) / ppf.max(0.01)).clamp(0.0, composition.duration_frames as f32);

    let selected = app.session.selection().first().copied();
    let layers = timeline_layers(composition, selected);
    if layers.is_empty() {
        ui.add_space(8.0);
        ui.label(egui::RichText::new("Select a layer to animate its properties").size(11.0).color(t.text_secondary));
        return;
    }
    // Rows: each layer plus its properties when twirled open.
    let mut rows: Vec<(RowRef, f32)> = Vec::new();
    for target in &layers {
        rows.push((RowRef::Layer { target: *target }, LAYER_H));
        if !app.ui.motion_closed.contains(target) {
            for property in properties() {
                let track = composition.tracks.iter().find(|t| t.target == *target && t.property == property).map(|t| t.id);
                rows.push((RowRef::Prop { target: *target, property, track }, PROP_H));
            }
        }
    }
    let content_w = (x_of(composition.duration_frames as f32) + 24.0).max(ui.available_width());
    let cti = app.ui.motion_frame.min(composition.duration_frames);
    let mut hovered = false;

    egui::ScrollArea::horizontal().id_salt(salt).show(ui, |ui| {
        // Ruler: ticks, frame numbers, and the playhead handle; drag scrubs the CTI.
        let (ruler, ruler_resp) = ui.allocate_exact_size(vec2(content_w, RULER_H), Sense::click_and_drag());
        hovered |= ruler_resp.hovered();
        let step = label_step(ppf);
        // Only the visible span (long compositions hold hundreds of thousands of frames).
        let vis = ui.clip_rect();
        let first = frame_of(vis.min.x - ruler.min.x).floor().max(0.0) as u32;
        let last = (frame_of(vis.max.x - ruler.min.x).ceil() as u32).min(composition.duration_frames);
        for f in first..=last {
            let x = ruler.min.x + x_of(f as f32);
            if f % step == 0 {
                ui.painter().line_segment([pos2(x, ruler.max.y - 8.0), pos2(x, ruler.max.y)], Stroke::new(1.0, t.text_tertiary));
                // Offset past the playhead handle, which wins ties at the CTI.
                ui.painter().text(pos2(x + 8.0, ruler.min.y + 1.0), Align2::LEFT_TOP, f.to_string(), regular(9.0), t.text_secondary);
            } else if ppf >= 6.0 {
                ui.painter().line_segment([pos2(x, ruler.max.y - 4.0), pos2(x, ruler.max.y)], Stroke::new(1.0, t.border));
            }
        }
        if (ruler_resp.clicked() || ruler_resp.dragged())
            && let Some(pointer) = ruler_resp.interact_pointer_pos()
        {
            app.ui.motion_frame = snap_frame(composition, frame_of(pointer.x - ruler.min.x), ppf);
        }
        let cti_x = ruler.min.x + x_of(cti as f32);
        ui.painter().rect_filled(Rect::from_center_size(pos2(cti_x, ruler.min.y + 5.0), vec2(9.0, 10.0)), 3.0, t.accent);

        for (row, height) in &rows {
            let (rect, lane_resp) = ui.allocate_exact_size(vec2(content_w, *height), Sense::click());
            hovered |= lane_resp.hovered();
            let y = rect.center().y;
            ui.painter().line_segment([pos2(rect.min.x + LANE_X0, y), pos2(rect.max.x - 8.0, y)], Stroke::new(1.0, t.border));
            if lane_resp.clicked()
                && let Some(pointer) = lane_resp.interact_pointer_pos()
            {
                app.ui.motion_frame = snap_frame(composition, frame_of(pointer.x - rect.min.x), ppf);
            }
            let keys = match row {
                RowRef::Layer { .. } => &[][..],
                RowRef::Prop { track: Some(id), .. } => {
                    composition.tracks.iter().find(|t| t.id == *id).map(|t| t.keyframes.as_slice()).unwrap_or(&[])
                }
                RowRef::Prop { track: None, .. } => &[],
            };
            for key in keys {
                paint_key(app, ui, t, composition, *row_track(row), key, rect.min.x, &x_of, y, ppf);
            }
            // The playhead crosses every row.
            ui.painter().line_segment([pos2(cti_x, rect.min.y), pos2(cti_x, rect.max.y)], Stroke::new(1.5, t.accent));
            paint_label(app, ui, t, composition, row, rect);
        }
        // Playing follows the playhead (horizontal only; the area never scrolls up).
        if app.ui.motion_playing {
            let vis = ui.clip_rect();
            let cx = x_of(cti as f32);
            if cx < vis.min.x + LANE_X0 || cx > vis.max.x {
                ui.scroll_to_rect(Rect::from_min_max(pos2(cx - 40.0, 0.0), pos2(cx + 40.0, 10000.0)), None);
            }
        }
    });

    // Delete removes the selected keyframe (never while typing in a field).
    if hovered
        && !crate::a11y::field_focused(ui.ctx())
        && ui.input(|i| i.key_pressed(egui::Key::Delete))
        && let Some((track_id, frame)) = app.ui.motion_selected
    {
        app.run("motion.keyframe.remove", json!({"compositionId": composition.id, "trackId": track_id, "frame": frame}));
        app.ui.motion_selected = None;
    }
}

fn row_track(row: &RowRef) -> &Option<u64> {
    match row {
        RowRef::Layer { .. } => &None,
        RowRef::Prop { track, .. } => track,
    }
}

/// One keyframe diamond: click selects and moves the CTI, drag moves it (snapping to keys).
#[allow(clippy::too_many_arguments)]
fn paint_key(
    app: &mut FigApp,
    ui: &mut Ui,
    t: &Tokens,
    composition: &Composition,
    track: Option<u64>,
    key: &undesign_doc::Keyframe,
    lane_min_x: f32,
    x_of: &impl Fn(f32) -> f32,
    y: f32,
    ppf: f32,
) {
    let Some(track_id) = track else { return };
    let at = pos2(lane_min_x + x_of(key.frame as f32), y);
    let hit = Rect::from_center_size(at, vec2(14.0, 18.0));
    let resp = ui
        .interact(hit, ui.id().with(("motion-key", composition.id, track_id, key.frame)), Sense::click_and_drag())
        .tip("Drag to move; Delete removes");
    let selected = app.ui.motion_selected == Some((track_id, key.frame));
    let dragging = app.ui.motion_drag == Some((track_id, key.frame));
    if resp.clicked() {
        app.ui.motion_selected = Some((track_id, key.frame));
        app.ui.motion_frame = key.frame;
    }
    if resp.drag_started() {
        app.ui.motion_drag = Some((track_id, key.frame));
        app.ui.motion_selected = Some((track_id, key.frame));
    }
    if dragging
        && resp.dragged()
        && let Some(pointer) = resp.interact_pointer_pos()
    {
        let to = snap_frame(composition, (pointer.x - lane_min_x - LANE_X0) / ppf.max(0.01), ppf);
        paint_diamond(ui.painter(), pos2(lane_min_x + x_of(to as f32), y), DIAMOND, t.accent);
    } else {
        paint_diamond(ui.painter(), at, DIAMOND, if selected { t.accent } else { t.text_secondary });
    }
    if resp.drag_stopped() {
        if let (Some(pointer), Some((drag_track, from))) = (resp.interact_pointer_pos(), app.ui.motion_drag) {
            let to = snap_frame(composition, (pointer.x - lane_min_x - LANE_X0) / ppf.max(0.01), ppf);
            if to != from {
                app.run("motion.keyframe.move", json!({"compositionId": composition.id, "trackId": drag_track, "from": from, "to": to}));
            }
            app.ui.motion_selected = Some((drag_track, to));
        }
        app.ui.motion_drag = None;
    }
}

/// The frozen label chip: twirl-downs for layers, stopwatch toggles for properties.
fn paint_label(app: &mut FigApp, ui: &mut Ui, t: &Tokens, composition: &Composition, row: &RowRef, rect: Rect) {
    // Frozen in screen space: the clip rect's left edge is the visible content offset.
    let frozen = ui.clip_rect().min.x + 4.0;
    let chip = Rect::from_min_max(pos2(frozen, rect.min.y + 2.0), pos2(frozen + LABEL_W, rect.max.y - 2.0));
    ui.painter().rect_filled(chip, 6.0, t.panel);
    ui.painter().rect_stroke(chip, 6.0, Stroke::new(1.0, t.border), egui::StrokeKind::Inside);
    match row {
        RowRef::Layer { target } => {
            let open = !app.ui.motion_closed.contains(target);
            let twirl = Rect::from_center_size(pos2(chip.min.x + 10.0, chip.center().y), vec2(16.0, 16.0));
            let resp = ui.interact(twirl, ui.id().with(("motion-twirl", composition.id, target.0)), Sense::click()).tip(if open {
                "Collapse layer"
            } else {
                "Expand layer"
            });
            crate::icons::paint(
                ui.painter(),
                Rect::from_center_size(twirl.center(), vec2(10.0, 10.0)),
                if open { crate::icons::Icon::Chevron } else { crate::icons::Icon::ChevronRight },
                t.icon_secondary,
            );
            if resp.clicked() {
                if open {
                    app.ui.motion_closed.insert(*target);
                } else {
                    app.ui.motion_closed.remove(target);
                }
            }
            let name = crate::widgets::elide(ui, &layer_name(app, *target), LABEL_W - 24.0);
            ui.painter().text(pos2(chip.min.x + 20.0, chip.center().y), Align2::LEFT_CENTER, name, regular(11.0), t.text);
        }
        RowRef::Prop { target, property, track } => {
            let animated = track.is_some();
            let watch = Rect::from_center_size(pos2(chip.min.x + 12.0, chip.center().y), vec2(20.0, 18.0));
            let resp = ui
                .interact(watch, ui.id().with(("motion-watch", composition.id, target.0, *property as u8)), Sense::click())
                .tip(if animated { "Remove animation for this property" } else { "Animate this property (keys its current value)" });
            if resp.hovered() {
                ui.painter().rect_filled(watch, 6.0, t.hover);
            }
            crate::icons::paint(
                ui.painter(),
                Rect::from_center_size(watch.center(), vec2(13.0, 13.0)),
                crate::icons::Icon::Stopwatch,
                if animated { t.accent } else { t.text_tertiary },
            );
            if resp.clicked() {
                toggle_animation(app, composition, *target, *property, *track);
            }
            let label = crate::widgets::elide(ui, property_label(*property), LABEL_W - 28.0);
            ui.painter().text(
                pos2(chip.min.x + 24.0, chip.center().y),
                Align2::LEFT_CENTER,
                label,
                regular(11.0),
                if animated { t.text } else { t.text_secondary },
            );
        }
    }
}

/// The stopwatch: on, a track plus a keyframe of the current value at the CTI; off, the track
/// (and its keys) goes away. Both are undoable.
fn toggle_animation(app: &mut FigApp, composition: &Composition, target: NodeId, property: AnimatedProperty, track: Option<u64>) {
    if let Some(track_id) = track {
        app.run("motion.track.remove", json!({"compositionId": composition.id, "trackId": track_id}));
        if app.ui.motion_selected.is_some_and(|(id, _)| id == track_id) {
            app.ui.motion_selected = None;
        }
        return;
    }
    let Some(result) = app.run(
        "motion.track.add",
        json!({
            "compositionId": composition.id,
            "target": target.0,
            "property": serde_json::to_value(property).unwrap_or(serde_json::Value::Null)
        }),
    ) else {
        return;
    };
    let Some(track_id) = result.get("trackId").and_then(serde_json::Value::as_u64) else { return };
    let frame = app.ui.motion_frame.min(composition.duration_frames);
    let value = app.session.doc().ok().and_then(|d| undesign_engine::cmd::motion::current_value(d, target, property));
    if let Some(value) = value {
        app.run("motion.keyframe.set", json!({"compositionId": composition.id, "trackId": track_id, "frame": frame, "value": value}));
    }
}

/// Numeric keyframe entry for the selected layer and property.
fn key_value(app: &mut FigApp, ui: &mut Ui, composition: &Composition, t: &Tokens) {
    ui.label(egui::RichText::new("Keyframe").size(11.0).strong().color(t.text));
    let selected = app.session.selection().first().copied();
    ui.horizontal(|ui| {
        egui::ComboBox::from_id_salt("motion-property").selected_text(property_label(app.ui.motion_property)).width(96.0).show_ui(ui, |ui| {
            for property in properties() {
                ui.selectable_value(&mut app.ui.motion_property, property, property_label(property));
            }
        });
        ui.label("Value");
        ui.add(egui::DragValue::new(&mut app.ui.motion_value).speed(0.1).max_decimals(3));
    });
    ui.add_space(4.0);
    ui.horizontal(|ui| {
        let can_set = selected.is_some();
        if crate::widgets::button(ui, "Set key at playhead", true, can_set).clicked()
            && let Some(target) = selected
        {
            let track_id = composition
                .tracks
                .iter()
                .find(|track| track.target == target && track.property == app.ui.motion_property)
                .map(|track| track.id)
                .or_else(|| {
                    let result = app.run(
                        "motion.track.add",
                        json!({
                            "compositionId": composition.id,
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
                        "compositionId": composition.id,
                        "trackId": track_id,
                        "frame": app.ui.motion_frame.min(composition.duration_frames),
                        "value": app.ui.motion_value,
                        "interpolation": "linear"
                    }),
                );
            }
        }
    });
    if selected.is_none() {
        ui.label(egui::RichText::new("Select a layer on the canvas").size(11.0).color(t.text_secondary));
    }
}
