//! Motion Studio's timeline in After Effects style: layer rows that twirl open to
//! per-property lanes, a shared ruler and playhead (CTI), zoom-to-fit, stopwatch toggles and
//! draggable keyframes. Every edit runs an engine command; the saved document only changes
//! through undoable commands, while playback renders a preview (see `canvas.rs`).
use egui::{Align2, Rect, Sense, Stroke, Ui, pos2, vec2};
use serde_json::json;
use undesign_doc::{AnimatedProperty, Composition, Document, Interpolation, NodeId};

use crate::FigApp;
use crate::a11y::Tip;
use crate::i18n::{tr, trf, trn};
use crate::theme::{Tokens, regular};

const RULER_H: f32 = 24.0;
const LAYER_H: f32 = 24.0;
const PROP_H: f32 = 22.0;
const LABEL_MIN_W: f32 = 112.0;
const LABEL_MAX_W: f32 = 180.0;
const DIAMOND: f32 = 8.0;
/// Snap radius in pixels, as in the reference timeline.
const SNAP_PX: f32 = 8.0;

/// The single brand accent for active, focused, and selected states: Undesign
/// selection blue `#315BFF`, lightened one step on dark surfaces so small text
/// keeps AA contrast (`#8FA6FF` on the `#1D1D1D` panel).
pub(crate) fn motion_state_accent(t: &Tokens) -> egui::Color32 {
    if t.dark { egui::Color32::from_rgb(0x8F, 0xA6, 0xFF) } else { egui::Color32::from_rgb(0x31, 0x5B, 0xFF) }
}

fn label_column_width(available_width: f32) -> f32 {
    if !available_width.is_finite() {
        return LABEL_MIN_W;
    }
    (available_width * 0.18).clamp(LABEL_MIN_W, LABEL_MAX_W)
}

pub(crate) fn layer_indent(depth: usize, label_width: f32) -> f32 {
    let room = (label_width - 96.0).clamp(0.0, 48.0);
    (depth.min(6) as f32 * 10.0).min(room)
}

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

pub(crate) fn property_tracks(composition: &Composition, target: NodeId) -> Vec<(AnimatedProperty, u64)> {
    properties()
        .into_iter()
        .filter_map(|property| {
            composition.tracks.iter().find(|track| track.target == target && track.property == property).map(|track| (property, track.id))
        })
        .collect()
}

pub(crate) fn available_properties(composition: &Composition, target: NodeId) -> Vec<AnimatedProperty> {
    properties()
        .into_iter()
        .filter(|property| !composition.tracks.iter().any(|track| track.target == target && track.property == *property))
        .collect()
}

pub(crate) fn track_count_label(count: usize) -> String {
    trn("{n} tracks", count, &[])
}

/// A row in the frozen label column and its timeline lane.
enum RowRef {
    Layer { target: NodeId, depth: usize },
    Prop { target: NodeId, property: AnimatedProperty, track: u64 },
    AddProperty { target: NodeId },
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

/// Ruler label step in frames. Prefer readable second marks at normal zoom, then individual
/// frames when zoomed in; distant zooms use multi-second intervals rather than dense frame labels.
fn label_step(ppf: f32, fps: u16) -> u32 {
    let fps = u32::from(fps.max(1));
    let pixels_per_second = ppf * fps as f32;
    if (24.0..=800.0).contains(&pixels_per_second) {
        return fps;
    }
    if pixels_per_second > 800.0 {
        return [1, 2, 5, 10, 15, 30, 60].into_iter().find(|step| *step as f32 * ppf >= 40.0).unwrap_or(60);
    }
    [2, 5, 10, 15, 30, 60].into_iter().map(|seconds| seconds * fps).find(|step| *step as f32 * ppf >= 40.0).unwrap_or(60 * fps)
}

#[cfg(test)]
pub(crate) fn ruler_label_step(ppf: f32, fps: u16) -> u32 {
    label_step(ppf, fps)
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
    if compositions(app).is_empty() {
        ui.add_space(8.0);
        egui::Frame::NONE.inner_margin(egui::Margin::symmetric(crate::widgets::PAD as i8, 0)).show(ui, |ui| empty_state(app, ui, &t));
        return;
    }
    let Some(composition) = selected_composition(app) else { return };
    advance_playback(app, ui, &composition);
    ui.add_space(8.0);
    egui::Frame::NONE.inner_margin(egui::Margin::symmetric(crate::widgets::PAD as i8, 0)).show(ui, |ui| {
        composition_combo(app, ui, "motion-composition", ui.available_width());
        ui.add_space(4.0);
        meta_row(ui, &composition, &t);
    });
    ui.add_space(4.0);
    track_list(app, ui, &composition, &t);
    ui.add_space(8.0);
    keyframe_inspector(app, ui, &composition, &t);
}

/// A compact, editable track list in the Motion inspector. Track enablement is a real engine
/// command, and selecting a row makes its keyframes the active editing target. Rows keep the
/// inspector's side padding; long names end with an ellipsis and show in full on hover.
fn track_list(app: &mut FigApp, ui: &mut Ui, composition: &Composition, t: &Tokens) {
    let pad = crate::widgets::PAD;
    let (head, _) = ui.allocate_exact_size(vec2(ui.available_width(), 36.0), Sense::hover());
    ui.painter().text(pos2(head.min.x + pad, head.center().y), Align2::LEFT_CENTER, tr("Tracks"), crate::theme::semibold(11.0), t.text);
    ui.painter().text(
        pos2(head.max.x - pad, head.center().y),
        Align2::RIGHT_CENTER,
        track_count_label(composition.tracks.len()),
        regular(10.5),
        t.text_secondary,
    );
    if composition.tracks.is_empty() {
        crate::widgets::note(ui, tr("Add a track from the timeline to animate a layer"), t.text_secondary);
        return;
    }
    for track in &composition.tracks {
        let selected = app.ui.motion_active_track == Some(track.id) || app.ui.motion_selected.is_some_and(|(id, _)| id == track.id);
        let label = format!("{} · {}", layer_name(app, track.target), tr(property_label(track.property)));
        let (row, _) = ui.allocate_exact_size(vec2(ui.available_width(), 28.0), Sense::hover());
        let toggle_r = Rect::from_center_size(pos2(row.min.x + pad + 7.0, row.center().y), vec2(14.0, 14.0));
        let toggle = ui.interact(toggle_r.expand(5.0), ui.id().with(("motion-track-enabled", track.id)), Sense::click());
        crate::a11y::toggle(&toggle, &label, track.enabled);
        let select_r = Rect::from_min_max(pos2(toggle_r.max.x + 6.0, row.min.y + 2.0), pos2(row.max.x - pad + 6.0, row.max.y - 2.0));
        let count = track.keyframes.len().to_string();
        let mut select = ui.interact(select_r, ui.id().with(("motion-track-row", track.id)), Sense::click());
        crate::a11y::button(&select, &label);
        if selected {
            ui.painter().rect_filled(select_r, egui::CornerRadius::same(6), t.selected_row);
        } else if select.hovered() || select.has_focus() {
            ui.painter().rect_filled(select_r, egui::CornerRadius::same(6), t.hover);
        }
        if select.has_focus() || toggle.has_focus() {
            let ring = if toggle.has_focus() { toggle_r.expand(3.0) } else { select_r };
            ui.painter().rect_stroke(ring, egui::CornerRadius::same(6), Stroke::new(1.0, motion_state_accent(t)), egui::StrokeKind::Inside);
        }
        ui.painter().rect_stroke(toggle_r, egui::CornerRadius::same(4), Stroke::new(1.0, t.border_strong), egui::StrokeKind::Inside);
        if track.enabled {
            ui.painter().rect_filled(toggle_r, egui::CornerRadius::same(4), t.text);
            crate::icons::paint(ui.painter(), toggle_r.shrink(1.0), crate::icons::Icon::Check, t.panel);
        }
        let count_w = ui.painter().layout_no_wrap(count.clone(), regular(10.5), t.text_secondary).size().x;
        let text_w = (select_r.width() - count_w - 22.0).max(24.0);
        let shown = crate::widgets::elide_font(ui, &label, text_w, regular(11.0));
        ui.painter().text(
            pos2(select_r.min.x + 6.0, row.center().y),
            Align2::LEFT_CENTER,
            &shown,
            regular(11.0),
            if track.enabled { t.text } else { t.text_secondary },
        );
        ui.painter().text(pos2(row.max.x - pad, row.center().y), Align2::RIGHT_CENTER, count, regular(10.5), t.text_secondary);
        if shown != label {
            select = select.on_hover_text(&label);
        }
        if toggle.clicked() {
            app.run("motion.track.set_enabled", json!({"compositionId": composition.id, "trackId": track.id, "enabled": !track.enabled}));
        }
        if select.clicked() {
            app.ui.motion_active_track = Some(track.id);
            app.ui.motion_selected = None;
        }
    }
}

/// The Motion timeline docked along the bottom: the same transport and timeline as the side
/// tab, wide enough to direct on.
pub fn dock(app: &mut FigApp, ui: &mut Ui) {
    let t = Tokens::get(ui.ctx());
    let composition = selected_composition(app);
    let collapsed = app.ui.motion_timeline_collapsed;
    ui.horizontal(|ui| {
        ui.set_min_height(28.0);
        ui.label(egui::RichText::new(tr("Timeline")).font(crate::theme::semibold(12.0)).color(t.text));
        if let Some(composition) = &composition {
            ui.add_space(4.0);
            let combo_width = (ui.available_width() - 260.0).clamp(88.0, 200.0);
            composition_combo(app, ui, "motion-composition-dock", combo_width);
            if ui.available_width() > 320.0 {
                ui.add_space(4.0);
                let meta =
                    format!("{} × {} · {} fps · {:.1}s", composition.width, composition.height, composition.fps, composition.duration_seconds());
                ui.label(egui::RichText::new(meta).font(regular(11.0)).color(t.text_secondary));
            }
        }
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            if crate::widgets::icon_button(ui, crate::icons::Icon::Close, tr("Close")) {
                app.run("motion.timeline", json!({"on": false}));
            }
            let (icon, tip) =
                if collapsed { (crate::icons::Icon::ChevronUp, tr("Expand")) } else { (crate::icons::Icon::Chevron, tr("Collapse panel")) };
            if crate::widgets::icon_button(ui, icon, tip) {
                app.ui.motion_timeline_collapsed = !collapsed;
            }
        });
    });
    if collapsed {
        return;
    }
    ui.add_space(2.0);
    crate::widgets::separator(ui);
    ui.add_space(2.0);
    let Some(composition) = composition else {
        empty_state(app, ui, &t);
        return;
    };
    advance_playback(app, ui, &composition);
    let fit_ppf = fit_ppf(ui.available_width(), &composition);
    transport(app, ui, &composition, &t, fit_ppf);
    ui.add_space(2.0);
    egui::ScrollArea::vertical().id_salt("motion-dock-scroll").show(ui, |ui| {
        timeline(app, ui, &composition, &t, "motion-dock-timeline");
    });
}

/// Pixels per frame that fit the whole composition into `width` beside the label column.
fn fit_ppf(width: f32, composition: &Composition) -> f32 {
    let lane_x0 = label_column_width(width) + 16.0;
    (width - lane_x0 - 24.0).max(40.0) / composition.duration_frames.max(1) as f32
}

/// A 24 px text button for the dense timeline toolbar.
fn small_button(ui: &mut Ui, label: &str, enabled: bool) -> egui::Response {
    let t = Tokens::get(ui.ctx());
    let galley = ui.painter().layout_no_wrap(label.to_string(), regular(11.0), t.text);
    let sense = if enabled { Sense::click() } else { Sense::hover() };
    let (rect, resp) = ui.allocate_exact_size(vec2(galley.size().x + 16.0, 24.0), sense);
    crate::a11y::button(&resp, label);
    if enabled && (resp.hovered() || resp.has_focus()) {
        ui.painter().rect_filled(rect, egui::CornerRadius::same(6), t.hover);
    }
    ui.painter().rect_stroke(rect, egui::CornerRadius::same(6), Stroke::new(1.0, t.border_strong), egui::StrokeKind::Inside);
    ui.painter().text(rect.center(), Align2::CENTER_CENTER, label, regular(11.0), if enabled { t.text } else { t.text_tertiary });
    resp
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
    ui.label(egui::RichText::new(tr("No compositions yet")).color(t.text_secondary));
    ui.add_space(8.0);
    if crate::widgets::button(ui, tr("Create composition"), true, true).clicked()
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
    if app.ui.motion_composition != Some(selected) {
        if app.ui.motion_keyframe_interaction.is_some() {
            let _ = app.session.cancel_interaction();
        }
        app.ui.motion_selected = None;
        app.ui.motion_active_track = None;
        app.ui.motion_keyframe_interaction = None;
    }
    app.ui.motion_composition = Some(selected);
    all.into_iter().find(|c| c.id == selected)
}

/// The composition picker (the side tab and the dock keep their own open state).
fn composition_combo(app: &mut FigApp, ui: &mut Ui, salt: &str, width: f32) {
    let all = compositions(app);
    let name = app.ui.motion_composition.and_then(|id| all.iter().find(|c| c.id == id)).map(|c| c.name.as_str()).unwrap_or("Composition");
    egui::ComboBox::from_id_salt(salt).selected_text(name).width(width).show_ui(ui, |ui| {
        for composition in &all {
            let previous = app.ui.motion_composition;
            if ui.selectable_value(&mut app.ui.motion_composition, Some(composition.id), &composition.name).clicked()
                && previous != Some(composition.id)
            {
                if app.ui.motion_keyframe_interaction.is_some() {
                    let _ = app.session.cancel_interaction();
                }
                app.ui.motion_selected = None;
                app.ui.motion_active_track = None;
                app.ui.motion_keyframe_interaction = None;
                app.ui.motion_frame = 0;
            }
        }
    });
}

/// One line of composition facts (size, frame rate, duration).
fn meta_row(ui: &mut Ui, composition: &Composition, t: &Tokens) {
    let meta = format!("{} × {} · {} fps · {:.1}s", composition.width, composition.height, composition.fps, composition.duration_seconds());
    ui.label(egui::RichText::new(meta).font(regular(11.0)).color(t.text_secondary));
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

/// The timeline toolbar: transport (start, previous key, play, next key, end), the current time,
/// Add keyframe and the track count, with zoom at the far end. One row, so the lanes keep the
/// dock's height.
fn transport(app: &mut FigApp, ui: &mut Ui, composition: &Composition, t: &Tokens, fit_ppf: f32) {
    let frame = app.ui.motion_frame.min(composition.duration_frames);
    ui.horizontal(|ui| {
        ui.set_min_height(28.0);
        ui.spacing_mut().item_spacing.x = 4.0;
        if crate::widgets::icon_button(ui, crate::icons::Icon::SkipBack, tr("Go to start")) {
            app.ui.motion_frame = 0;
        }
        if crate::widgets::icon_button(ui, crate::icons::Icon::PrevKey, tr("Previous keyframe"))
            && let Some(at) = neighbor_key(composition, frame, -1)
        {
            app.ui.motion_frame = at;
        }
        let playing = app.ui.motion_playing;
        if crate::widgets::icon_button(
            ui,
            if playing { crate::icons::Icon::Pause } else { crate::icons::Icon::Play },
            if playing { tr("Pause") } else { tr("Play") },
        ) {
            app.ui.motion_playing = !playing;
            app.ui.motion_play_acc = 0.0;
            app.ui.motion_play_last = 0.0;
        }
        if crate::widgets::icon_button(ui, crate::icons::Icon::NextKey, tr("Next keyframe"))
            && let Some(at) = neighbor_key(composition, frame, 1)
        {
            app.ui.motion_frame = at;
        }
        if crate::widgets::icon_button(ui, crate::icons::Icon::SkipFwd, tr("Go to end")) {
            app.ui.motion_frame = composition.duration_frames;
        }
        ui.add_space(8.0);
        let secs = f64::from(frame) / f64::from(composition.fps.max(1));
        ui.label(egui::RichText::new(format!("{frame}f · {secs:.2}s")).font(crate::theme::semibold(11.0)).color(t.text));
        ui.add_space(12.0);
        let can_add = can_add_keyframe(app, composition);
        if small_button(ui, tr("Add keyframe"), can_add).clicked() && can_add {
            add_keyframe_at_playhead(app, composition);
        }
        ui.add_space(4.0);
        ui.label(egui::RichText::new(track_count_label(composition.tracks.len())).font(regular(10.5)).color(t.text_secondary));
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| zoom(app, ui, fit_ppf));
    });
}

/// Zoom controls: out, fit, in.
/// Laid out right to left at the end of the toolbar, so it reads "Zoom − Fit +".
fn zoom(app: &mut FigApp, ui: &mut Ui, fit_ppf: f32) {
    let base = app.ui.motion_ppf.unwrap_or(fit_ppf);
    if crate::widgets::icon_button(ui, crate::icons::Icon::Plus, tr("Zoom in")) {
        app.ui.motion_ppf = Some((base * 1.25).clamp(0.25, 64.0));
    }
    if small_button(ui, tr("Fit"), true).clicked() {
        app.ui.motion_ppf = None;
    }
    if crate::widgets::icon_button(ui, crate::icons::Icon::Minus, tr("Zoom out")) {
        app.ui.motion_ppf = Some((base / 1.25).clamp(0.25, 64.0));
    }
    let secondary = Tokens::get(ui.ctx()).text_secondary;
    ui.label(egui::RichText::new(tr("Zoom")).font(regular(11.0)).color(secondary));
}

/// Every animatable layer in page order, with its depth. Track targets outside the page trail at
/// the end as roots so their lanes stay reachable.
pub(crate) fn timeline_layers_with_depth(app: &FigApp, composition: &Composition) -> Vec<(NodeId, usize)> {
    let mut layers = Vec::new();
    if let (Ok(doc), Ok(page)) = (app.session.doc(), app.session.page()) {
        walk_page(doc, page, 0, &mut layers);
    }
    for track in &composition.tracks {
        if !layers.iter().any(|(target, _)| *target == track.target) {
            layers.push((track.target, 0));
        }
    }
    layers
}

#[cfg(test)]
pub(crate) fn timeline_layers(app: &FigApp, composition: &Composition) -> Vec<NodeId> {
    timeline_layers_with_depth(app, composition).into_iter().map(|(target, _)| target).collect()
}

/// Depth-first in layer order (`children` is layer order; pages never list).
fn walk_page(doc: &Document, id: NodeId, depth: usize, out: &mut Vec<(NodeId, usize)>) {
    let Some(node) = doc.node(id) else { return };
    let children = node.children.clone();
    for child in children {
        let Some(next) = doc.node(child) else { continue };
        if next.is_page() {
            continue;
        }
        out.push((child, depth));
        walk_page(doc, child, depth.saturating_add(1), out);
    }
}

fn layer_name(app: &FigApp, target: NodeId) -> String {
    app.session.doc().ok().and_then(|d| d.node(target).map(|n| n.name.clone())).unwrap_or_else(|| format!("Layer {}", target.0))
}

fn timeline(app: &mut FigApp, ui: &mut Ui, composition: &Composition, t: &Tokens, salt: &str) {
    let layers = timeline_layers_with_depth(app, composition);
    if layers.is_empty() {
        let (empty, _) = ui.allocate_exact_size(vec2(ui.available_width(), 52.0), Sense::hover());
        ui.painter().rect_filled(empty, egui::CornerRadius::same(8), t.field);
        ui.painter().rect_stroke(empty, egui::CornerRadius::same(8), Stroke::new(1.0, t.border), egui::StrokeKind::Inside);
        ui.painter().text(
            empty.center(),
            Align2::CENTER_CENTER,
            tr("Add a frame or shape to this page, then select it to animate"),
            regular(11.0),
            t.text_secondary,
        );
        return;
    }
    let label_width = label_column_width(ui.available_width());
    let lane_x0 = label_width + 16.0;
    let fit_ppf = fit_ppf(ui.available_width(), composition);
    let ppf = app.ui.motion_ppf.unwrap_or(fit_ppf).clamp(0.25, 64.0);
    let x_of = |frame: f32| lane_x0 + frame * ppf;
    let frame_of = |x: f32| ((x - lane_x0) / ppf.max(0.01)).clamp(0.0, composition.duration_frames as f32);
    // Rows: each layer plus its active properties and one property chooser when twirled open.
    let mut rows: Vec<(RowRef, f32)> = Vec::new();
    let selection = app.session.selection();
    for (target, depth) in &layers {
        rows.push((RowRef::Layer { target: *target, depth: *depth }, LAYER_H));
        if !app.ui.motion_closed.contains(target) {
            rows.extend(
                property_tracks(composition, *target)
                    .into_iter()
                    .map(|(property, track)| (RowRef::Prop { target: *target, property, track }, PROP_H)),
            );
            // The chooser shows on layers that are already animated or selected on the canvas, so
            // a page of still layers doesn't push the animated lanes out of the dock.
            let animated = composition.tracks.iter().any(|track| track.target == *target);
            let selected = selection.contains(target);
            if (animated || selected) && !available_properties(composition, *target).is_empty() {
                rows.push((RowRef::AddProperty { target: *target }, PROP_H));
            }
        }
    }
    let content_w = (x_of(composition.duration_frames as f32) + 24.0).max(ui.available_width());
    let cti = app.ui.motion_frame.min(composition.duration_frames);
    let mut hovered = false;

    egui::ScrollArea::horizontal().id_salt(salt).show(ui, |ui| {
        // Ruler: ticks, frame numbers, and the playhead handle; drag scrubs the CTI.
        let (ruler, ruler_resp) = ui.allocate_exact_size(vec2(content_w, RULER_H), Sense::click_and_drag());
        crate::a11y::button(&ruler_resp, tr("Timeline"));
        if ruler_resp.has_focus() {
            ui.painter().rect_stroke(ruler.shrink(1.0), 3.0, Stroke::new(1.0, motion_state_accent(t)), egui::StrokeKind::Inside);
        }
        hovered |= ruler_resp.hovered();
        let fps = u32::from(composition.fps.max(1));
        let step = label_step(ppf, composition.fps);
        // Only the visible span (long compositions hold hundreds of thousands of frames).
        let vis = ui.clip_rect();
        let first = frame_of(vis.min.x - ruler.min.x).floor().max(0.0) as u32;
        let last = (frame_of(vis.max.x - ruler.min.x).ceil() as u32).min(composition.duration_frames);
        let first_major = first.checked_add((step - first % step) % step).filter(|at| *at <= last);
        for f in first..=last {
            let x = ruler.min.x + x_of(f as f32);
            if f % step == 0 {
                ui.painter().line_segment([pos2(x, ruler.max.y - 8.0), pos2(x, ruler.max.y)], Stroke::new(1.0, t.text_tertiary));
                // Offset past the playhead handle, which wins ties at the CTI.
                let label = if f % fps == 0 { format!("{}s", f / fps) } else { f.to_string() };
                ui.painter().text(pos2(x + 8.0, ruler.min.y + 1.0), Align2::LEFT_TOP, label, regular(9.0), t.text_secondary);
            } else if ppf >= 6.0 {
                ui.painter().line_segment([pos2(x, ruler.max.y - 4.0), pos2(x, ruler.max.y)], Stroke::new(1.0, t.border));
            }
        }
        let divider_x = vis.min.x + label_width + 8.0;
        ui.painter().line_segment([pos2(divider_x, ruler.min.y), pos2(divider_x, ruler.max.y)], Stroke::new(1.0, t.border));
        ui.painter().line_segment([pos2(vis.min.x, ruler.max.y), pos2(vis.max.x, ruler.max.y)], Stroke::new(1.0, t.border));
        if (ruler_resp.clicked() || ruler_resp.dragged())
            && let Some(pointer) = ruler_resp.interact_pointer_pos()
        {
            app.ui.motion_frame = snap_frame(composition, frame_of(pointer.x - ruler.min.x), ppf);
        }
        if ruler_resp.has_focus() {
            let target = ui.input(|i| {
                let step = if i.modifiers.shift { 10 } else { 1 };
                if i.key_pressed(egui::Key::Home) {
                    Some(0)
                } else if i.key_pressed(egui::Key::End) {
                    Some(composition.duration_frames)
                } else if i.key_pressed(egui::Key::ArrowLeft) {
                    Some(cti.saturating_sub(step))
                } else if i.key_pressed(egui::Key::ArrowRight) {
                    Some(cti.saturating_add(step).min(composition.duration_frames))
                } else {
                    None
                }
            });
            if let Some(target) = target {
                app.ui.motion_frame = target;
            }
        }
        let cti_x = ruler.min.x + x_of(cti as f32);
        ui.painter().rect_filled(Rect::from_center_size(pos2(cti_x, ruler.min.y + 5.0), vec2(9.0, 10.0)), 3.0, motion_state_accent(t));

        for (row, height) in &rows {
            let is_lane = !matches!(row, RowRef::AddProperty { .. });
            let sense = if is_lane { Sense::click() } else { Sense::hover() };
            let (rect, lane_resp) = ui.allocate_exact_size(vec2(content_w, *height), sense);
            if is_lane {
                hovered |= lane_resp.hovered();
                if let RowRef::Prop { track, .. } = row
                    && app.ui.motion_active_track == Some(*track)
                {
                    let lane = Rect::from_min_max(pos2(rect.min.x + lane_x0, rect.min.y), pos2(rect.max.x - 8.0, rect.max.y));
                    ui.painter().rect_filled(lane, 0.0, t.selected_row_child);
                }
                if let Some(first_major) = first_major {
                    for frame in (first_major..=last).step_by(step as usize) {
                        let x = rect.min.x + x_of(frame as f32);
                        ui.painter().line_segment([pos2(x, rect.min.y), pos2(x, rect.max.y)], Stroke::new(1.0, t.border));
                    }
                }
                let y = rect.center().y;
                ui.painter().line_segment([pos2(rect.min.x + lane_x0, y), pos2(rect.max.x - 8.0, y)], Stroke::new(1.0, t.border));
                if lane_resp.clicked()
                    && let Some(pointer) = lane_resp.interact_pointer_pos()
                {
                    let frame = snap_frame(composition, frame_of(pointer.x - rect.min.x), ppf);
                    app.ui.motion_frame = frame;
                    if let RowRef::Prop { track, .. } = row {
                        app.ui.motion_active_track = Some(*track);
                        app.ui.motion_selected = composition
                            .tracks
                            .iter()
                            .find(|t| t.id == *track)
                            .filter(|t| t.keyframes.iter().any(|key| key.frame == frame))
                            .map(|_| (*track, frame));
                    }
                }
            }
            let keys = match row {
                RowRef::Layer { .. } | RowRef::AddProperty { .. } => &[][..],
                RowRef::Prop { track, .. } => composition.tracks.iter().find(|t| t.id == *track).map(|t| t.keyframes.as_slice()).unwrap_or(&[]),
            };
            for key in keys {
                paint_key(app, ui, t, composition, row_track(row), key, rect.min.x, lane_x0, &x_of, rect.center().y, ppf);
            }
            if is_lane {
                ui.painter().line_segment([pos2(cti_x, rect.min.y), pos2(cti_x, rect.max.y)], Stroke::new(1.5, motion_state_accent(t)));
            }
            ui.painter().line_segment([pos2(divider_x, rect.min.y), pos2(divider_x, rect.max.y)], Stroke::new(1.0, t.border));
            paint_label(app, ui, t, composition, row, rect, label_width);
        }
        // Playing follows the playhead (horizontal only; the area never scrolls up).
        if app.ui.motion_playing {
            let vis = ui.clip_rect();
            let cx = x_of(cti as f32);
            if cx < vis.min.x + lane_x0 || cx > vis.max.x {
                ui.scroll_to_rect(Rect::from_min_max(pos2(cx - 40.0, 0.0), pos2(cx + 40.0, 10000.0)), None);
            }
        }
    });

    // Delete removes the selected keyframe (never while typing in a field).
    if hovered
        && !crate::a11y::field_focused(ui.ctx())
        && ui.input(|i| i.key_pressed(egui::Key::Delete))
        && selected_key(composition, app.ui.motion_selected).is_some()
        && let Some((track_id, frame)) = app.ui.motion_selected
    {
        app.run("motion.keyframe.remove", json!({"compositionId": composition.id, "trackId": track_id, "frame": frame}));
        app.ui.motion_selected = None;
    }
}

fn row_track(row: &RowRef) -> Option<u64> {
    match row {
        RowRef::Layer { .. } | RowRef::AddProperty { .. } => None,
        RowRef::Prop { track, .. } => Some(*track),
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
    lane_x0: f32,
    x_of: &impl Fn(f32) -> f32,
    y: f32,
    ppf: f32,
) {
    let Some(track_id) = track else { return };
    let at = pos2(lane_min_x + x_of(key.frame as f32), y);
    let hit = Rect::from_center_size(at, vec2(14.0, 18.0));
    let resp = ui
        .interact(hit, ui.id().with(("motion-key", composition.id, track_id, key.frame)), Sense::click_and_drag())
        .tip(tr("Drag to move; Delete removes"));
    let property_name =
        composition.tracks.iter().find(|t| t.id == track_id).map(|t| tr(property_label(t.property))).unwrap_or_else(|| tr("Keyframe"));
    let accessible_name = trf("{property} keyframe at frame {frame}", &[("property", &property_name), ("frame", &key.frame)]);
    crate::a11y::button(&resp, &accessible_name);
    let selected = app.ui.motion_selected == Some((track_id, key.frame));
    let enabled = composition.tracks.iter().find(|t| t.id == track_id).is_some_and(|t| t.enabled);
    let dragging = app.ui.motion_drag == Some((track_id, key.frame));
    if resp.clicked() {
        app.ui.motion_selected = Some((track_id, key.frame));
        app.ui.motion_active_track = Some(track_id);
        app.ui.motion_frame = key.frame;
    }
    if resp.drag_started() {
        app.ui.motion_drag = Some((track_id, key.frame));
        app.ui.motion_selected = Some((track_id, key.frame));
        app.ui.motion_active_track = Some(track_id);
    }
    if dragging
        && resp.dragged()
        && let Some(pointer) = resp.interact_pointer_pos()
    {
        let to = snap_frame(composition, (pointer.x - lane_min_x - lane_x0) / ppf.max(0.01), ppf);
        paint_diamond(ui.painter(), pos2(lane_min_x + x_of(to as f32), y), DIAMOND, motion_state_accent(t));
    } else {
        paint_diamond(
            ui.painter(),
            at,
            DIAMOND,
            if selected {
                motion_state_accent(t)
            } else if enabled {
                t.text_secondary
            } else {
                t.text_tertiary
            },
        );
    }
    if resp.has_focus() {
        ui.painter().rect_stroke(hit.shrink(1.0), 3.0, Stroke::new(1.0, motion_state_accent(t)), egui::StrokeKind::Inside);
    }
    if resp.drag_stopped() {
        if let (Some(pointer), Some((drag_track, from))) = (resp.interact_pointer_pos(), app.ui.motion_drag) {
            let to = snap_frame(composition, (pointer.x - lane_min_x - lane_x0) / ppf.max(0.01), ppf);
            if to != from {
                app.run("motion.keyframe.move", json!({"compositionId": composition.id, "trackId": drag_track, "from": from, "to": to}));
            }
            app.ui.motion_selected = Some((drag_track, to));
            app.ui.motion_active_track = Some(drag_track);
        }
        app.ui.motion_drag = None;
    }
}

fn paint_track_toggle(painter: &egui::Painter, center: egui::Pos2, enabled: bool, color: egui::Color32) {
    let x = center.x;
    let y = center.y;
    painter.add(egui::Shape::convex_polygon(
        vec![
            pos2(x - 5.0, y - 2.0),
            pos2(x - 2.0, y - 2.0),
            pos2(x + 0.8, y - 4.2),
            pos2(x + 0.8, y + 4.2),
            pos2(x - 2.0, y + 2.0),
            pos2(x - 5.0, y + 2.0),
        ],
        color,
        Stroke::NONE,
    ));
    if enabled {
        painter.add(egui::Shape::line(vec![pos2(x + 2.0, y - 2.7), pos2(x + 4.3, y), pos2(x + 2.0, y + 2.7)], Stroke::new(1.5, color)));
    } else {
        painter.line_segment([pos2(x + 1.8, y - 2.5), pos2(x + 4.8, y + 2.5)], Stroke::new(1.5, color));
        painter.line_segment([pos2(x + 4.8, y - 2.5), pos2(x + 1.8, y + 2.5)], Stroke::new(1.5, color));
    }
}

/// The frozen label chip: hierarchy disclosure, active property controls and add-property menu.
fn paint_label(app: &mut FigApp, ui: &mut Ui, t: &Tokens, composition: &Composition, row: &RowRef, rect: Rect, label_width: f32) {
    // Frozen in screen space: the clip rect's left edge is the visible content offset.
    let frozen = ui.clip_rect().min.x + 4.0;
    let chip = Rect::from_min_max(pos2(frozen, rect.min.y + 2.0), pos2(frozen + label_width, rect.max.y - 2.0));
    if !matches!(row, RowRef::AddProperty { .. }) {
        let selected_track = matches!(row, RowRef::Prop { track, .. } if app.ui.motion_active_track == Some(*track));
        ui.painter().rect_filled(chip, 6.0, if selected_track { t.selected_row } else { t.panel });
        ui.painter().rect_stroke(chip, 6.0, Stroke::new(1.0, t.border), egui::StrokeKind::Inside);
    }
    match row {
        RowRef::Layer { target, depth } => {
            let open = !app.ui.motion_closed.contains(target);
            let indent = layer_indent(*depth, label_width);
            let twirl = Rect::from_center_size(pos2(chip.min.x + 10.0 + indent, chip.center().y), vec2(16.0, 16.0));
            let label = if open { tr("Collapse layer") } else { tr("Expand layer") };
            let resp = ui.interact(twirl, ui.id().with(("motion-twirl", composition.id, target.0)), Sense::click()).tip(label);
            crate::a11y::button(&resp, label);
            if resp.has_focus() {
                ui.painter().rect_stroke(twirl, 4.0, Stroke::new(1.0, motion_state_accent(t)), egui::StrokeKind::Inside);
            }
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
            let full = layer_name(app, *target);
            let name_x = chip.min.x + 20.0 + indent;
            let name = crate::widgets::elide(ui, &full, (label_width - 24.0 - indent).max(0.0));
            let is_selected = app.session.selection().contains(target);
            ui.painter().text(
                pos2(name_x, chip.center().y),
                Align2::LEFT_CENTER,
                name,
                regular(11.0),
                if is_selected { motion_state_accent(t) } else { t.text },
            );
            let name_rect = Rect::from_min_max(pos2(name_x, rect.min.y + 2.0), pos2(chip.max.x - 2.0, rect.max.y - 2.0));
            let name_resp = ui
                .interact(name_rect, ui.id().with(("motion-layer-select", composition.id, target.0)), Sense::click())
                .tip(trf("Select {name}", &[("name", &full)]));
            crate::a11y::button(&name_resp, &trf("Select {name}", &[("name", &full)]));
            if name_resp.has_focus() {
                ui.painter().rect_stroke(name_rect.shrink(1.0), 4.0, Stroke::new(1.0, motion_state_accent(t)), egui::StrokeKind::Inside);
            }
            if name_resp.clicked() {
                app.session.set_selection(vec![*target]);
            }
        }
        RowRef::Prop { target, property, track } => {
            let track_enabled = composition.tracks.iter().find(|t| t.id == *track).is_some_and(|t| t.enabled);
            let watch = Rect::from_center_size(pos2(chip.min.x + 12.0, chip.center().y), vec2(20.0, 18.0));
            let watch_label = tr("Remove animation for this property");
            let resp = ui.interact(watch, ui.id().with(("motion-watch", composition.id, target.0, *property as u8)), Sense::click()).tip(watch_label);
            crate::a11y::button(&resp, watch_label);
            if resp.hovered() {
                ui.painter().rect_filled(watch, 6.0, t.hover);
            }
            if resp.has_focus() {
                ui.painter().rect_stroke(watch, 6.0, Stroke::new(1.0, motion_state_accent(t)), egui::StrokeKind::Inside);
            }
            crate::icons::paint(
                ui.painter(),
                Rect::from_center_size(watch.center(), vec2(13.0, 13.0)),
                crate::icons::Icon::Stopwatch,
                t.icon_secondary,
            );
            if resp.clicked() {
                toggle_animation(app, composition, *target, *property, Some(*track));
            }
            let mute = Rect::from_center_size(pos2(chip.max.x - 12.0, chip.center().y), vec2(20.0, 18.0));
            let mute_label = if track_enabled { tr("Mute track") } else { tr("Unmute track") };
            let mute_resp = ui.interact(mute, ui.id().with(("motion-mute", composition.id, *track)), Sense::click()).tip(mute_label);
            crate::a11y::button(&mute_resp, mute_label);
            if mute_resp.hovered() {
                ui.painter().rect_filled(mute, 6.0, t.hover);
            }
            if mute_resp.has_focus() {
                ui.painter().rect_stroke(mute, 6.0, Stroke::new(1.0, motion_state_accent(t)), egui::StrokeKind::Inside);
            }
            paint_track_toggle(ui.painter(), mute.center(), track_enabled, t.icon_secondary);
            if mute_resp.clicked() {
                app.run("motion.track.set_enabled", json!({"compositionId": composition.id, "trackId": track, "enabled": !track_enabled}));
            }
            let property_name = tr(property_label(*property));
            let label = crate::widgets::elide(ui, property_name, label_width - 50.0);
            ui.painter().text(
                pos2(chip.min.x + 24.0, chip.center().y),
                Align2::LEFT_CENTER,
                label,
                if app.ui.motion_active_track == Some(*track) { crate::theme::semibold(11.0) } else { regular(11.0) },
                if !track_enabled {
                    t.text_tertiary
                } else if app.ui.motion_active_track == Some(*track) {
                    motion_state_accent(t)
                } else {
                    t.text
                },
            );
            let label_rect = Rect::from_min_max(pos2(chip.min.x + 24.0, rect.min.y + 2.0), pos2(chip.max.x - 24.0, rect.max.y - 2.0));
            let select_track = trf("Select {property} track", &[("property", &property_name)]);
            let label_resp =
                ui.interact(label_rect, ui.id().with(("motion-track-select", composition.id, *track)), Sense::click()).tip(&select_track);
            crate::a11y::button(&label_resp, &select_track);
            if label_resp.has_focus() {
                ui.painter().rect_stroke(label_rect.shrink(1.0), 4.0, Stroke::new(1.0, motion_state_accent(t)), egui::StrokeKind::Inside);
            }
            if label_resp.clicked() {
                app.ui.motion_active_track = Some(*track);
                app.ui.motion_selected = None;
            }
        }
        RowRef::AddProperty { target } => {
            let mut add = None;
            let mut child = ui.new_child(egui::UiBuilder::new().max_rect(chip).layout(egui::Layout::left_to_right(egui::Align::Center)));
            egui::ComboBox::from_id_salt(("motion-add-property", composition.id, target.0))
                .selected_text(egui::RichText::new(tr("Add property")).size(11.0))
                .width((label_width - 8.0).max(80.0))
                .show_ui(&mut child, |menu| {
                    for property in available_properties(composition, *target) {
                        if menu.selectable_label(false, tr(property_label(property))).clicked() {
                            add = Some(property);
                        }
                    }
                });
            if let Some(property) = add {
                toggle_animation(app, composition, *target, property, None);
            }
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
        if app.ui.motion_active_track == Some(track_id) {
            app.ui.motion_active_track = None;
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
        app.run(
            "motion.keyframe.set",
            json!({"compositionId": composition.id, "trackId": track_id, "frame": frame, "value": value, "interpolation": "linear"}),
        );
        app.ui.motion_selected = Some((track_id, frame));
    }
    app.ui.motion_active_track = Some(track_id);
}

fn can_add_keyframe(app: &FigApp, composition: &Composition) -> bool {
    let Some(track_id) = app.ui.motion_active_track else { return false };
    let frame = app.ui.motion_frame.min(composition.duration_frames);
    composition.tracks.iter().find(|track| track.id == track_id).is_some_and(|track| !track.keyframes.iter().any(|key| key.frame == frame))
}

/// Insert at the playhead using the track's evaluated value so the new key does not jump.
fn add_keyframe_at_playhead(app: &mut FigApp, composition: &Composition) -> Option<(u64, u32)> {
    let track_id = app.ui.motion_active_track?;
    let frame = app.ui.motion_frame.min(composition.duration_frames);
    let (target, property, sampled, interpolation) = {
        let track = composition.tracks.iter().find(|track| track.id == track_id)?;
        if track.keyframes.iter().any(|key| key.frame == frame) {
            return None;
        }
        let mut sample_track = track.clone();
        sample_track.enabled = true;
        let sampled = sample_track.sample(f64::from(frame));
        let interpolation = track.keyframes.iter().rev().find(|key| key.frame < frame).map(|key| key.interpolation).unwrap_or(Interpolation::Linear);
        (track.target, track.property, sampled, interpolation)
    };
    let value = sampled.or_else(|| app.session.doc().ok().and_then(|doc| undesign_engine::cmd::motion::current_value(doc, target, property)))?;
    app.run(
        "motion.keyframe.set",
        json!({
            "compositionId": composition.id,
            "trackId": track_id,
            "frame": frame,
            "value": value,
            "interpolation": serde_json::to_value(interpolation).unwrap_or(serde_json::Value::Null),
        }),
    )?;
    app.ui.motion_selected = Some((track_id, frame));
    app.ui.motion_active_track = Some(track_id);
    Some((track_id, frame))
}

/// Interpolation presets for the selected keyframe: easing as valid cubic-bezier curves.
pub(crate) fn interpolation_presets() -> [(&'static str, Interpolation); 5] {
    [
        ("Hold/Step", Interpolation::Step),
        ("Linear", Interpolation::Linear),
        ("Ease In", Interpolation::CubicBezier { x1: 0.42, y1: 0.0, x2: 1.0, y2: 1.0 }),
        ("Ease Out", Interpolation::CubicBezier { x1: 0.0, y1: 0.0, x2: 0.58, y2: 1.0 }),
        ("Ease In & Out", Interpolation::CubicBezier { x1: 0.42, y1: 0.0, x2: 0.58, y2: 1.0 }),
    ]
}

/// The preset label matching an interpolation, or "Custom" for a hand-tuned curve.
pub(crate) fn interpolation_label(interpolation: Interpolation) -> &'static str {
    for (label, preset) in interpolation_presets() {
        if preset == interpolation {
            return label;
        }
    }
    "Custom"
}

/// The selected keyframe's track, frame, value and interpolation, when it still exists.
pub(crate) fn selected_key(composition: &Composition, selected: Option<(u64, u32)>) -> Option<(u64, u32, f64, Interpolation)> {
    let (track_id, frame) = selected?;
    let track = composition.tracks.iter().find(|t| t.id == track_id)?;
    let key = track.keyframes.iter().find(|k| k.frame == frame)?;
    Some((track_id, key.frame, key.value, key.interpolation))
}

/// The interpolation preset picker for the selected keyframe: applying a preset rewrites
/// that keyframe with the same frame and value through `motion.keyframe.set`.
fn interpolation_row(app: &mut FigApp, ui: &mut Ui, composition: &Composition) {
    let Some((track_id, frame, value, interpolation)) = selected_key(composition, app.ui.motion_selected) else { return };
    ui.horizontal(|ui| {
        ui.label(tr("Interpolation"));
        egui::ComboBox::from_id_salt("motion-interpolation").selected_text(tr(interpolation_label(interpolation))).width(120.0).show_ui(ui, |ui| {
            for (label, preset) in interpolation_presets() {
                if ui.selectable_label(interpolation == preset, tr(label)).clicked() && interpolation != preset {
                    app.run(
                        "motion.keyframe.set",
                        json!({
                            "compositionId": composition.id,
                            "trackId": track_id,
                            "frame": frame,
                            "value": value,
                            "interpolation": serde_json::to_value(preset).unwrap_or(serde_json::Value::Null),
                        }),
                    );
                }
            }
        });
    });
}

/// Right-side property inspector for the active track and selected keyframe.
fn keyframe_inspector(app: &mut FigApp, ui: &mut Ui, composition: &Composition, t: &Tokens) {
    let selected = selected_key(composition, app.ui.motion_selected);
    let track_id = selected.map(|(id, _, _, _)| id).or(app.ui.motion_active_track);
    let selected_at = selected.map(|(id, frame, _, _)| (id, frame));
    if app.ui.motion_keyframe_interaction.is_some_and(|active| Some(active) != selected_at) {
        cancel_keyframe_interaction(app);
    }
    crate::widgets::section_header(ui, tr("Keyframe"), &[], false);
    let Some(track_id) = track_id else {
        crate::widgets::note(ui, tr("Select a track or keyframe in the timeline"), t.text_secondary);
        return;
    };
    let Some(track) = composition.tracks.iter().find(|track| track.id == track_id) else {
        app.ui.motion_active_track = None;
        app.ui.motion_selected = None;
        crate::widgets::note(ui, tr("Select a track or keyframe in the timeline"), t.text_secondary);
        return;
    };
    app.ui.motion_active_track = Some(track_id);
    ui.label(egui::RichText::new(layer_name(app, track.target)).size(12.0).strong().color(t.text));
    ui.label(egui::RichText::new(tr(property_label(track.property))).size(11.0).color(t.text_secondary));
    ui.add_space(4.0);

    let Some((_, frame, value, interpolation)) = selected.filter(|(id, _, _, _)| *id == track_id) else {
        let frame = app.ui.motion_frame.min(composition.duration_frames);
        crate::widgets::note(ui, tr("Select a keyframe in the timeline to edit its value"), t.text_secondary);
        ui.horizontal(|ui| {
            ui.label(format!("Frame {frame}"));
            if crate::widgets::button(ui, tr("Add keyframe"), true, can_add_keyframe(app, composition)).clicked() {
                add_keyframe_at_playhead(app, composition);
            }
        });
        return;
    };

    ui.label(format!("Frame {frame}"));
    ui.horizontal(|ui| {
        ui.label(tr(property_label(track.property)));
        let display = display_value(track.property, value);
        let width = ui.available_width().clamp(72.0, 196.0);
        let edit = crate::widgets::number_field(
            ui,
            egui::Id::new(("motion-key-value", composition.id, track_id, frame)),
            crate::widgets::Lead::Named(tr(property_label(track.property))),
            Some(display),
            value_suffix(track.property),
            width,
            1.0,
        );
        edit_keyframe_value(app, ui, composition.id, track_id, frame, track.property, interpolation, edit);
    });
    ui.add_space(4.0);
    interpolation_row(app, ui, composition);
    ui.add_space(4.0);
    if crate::widgets::button(ui, tr("Delete keyframe"), false, true).clicked() {
        app.run("motion.keyframe.remove", json!({"compositionId": composition.id, "trackId": track_id, "frame": frame}));
        app.ui.motion_selected = None;
        app.ui.motion_active_track = Some(track_id);
    }
}

fn display_value(property: AnimatedProperty, value: f64) -> f64 {
    match property {
        AnimatedProperty::Opacity | AnimatedProperty::ScaleX | AnimatedProperty::ScaleY => value * 100.0,
        _ => value,
    }
}

fn stored_value(property: AnimatedProperty, value: f64) -> f64 {
    match property {
        AnimatedProperty::Opacity => (value / 100.0).clamp(0.0, 1.0),
        AnimatedProperty::ScaleX | AnimatedProperty::ScaleY => value / 100.0,
        _ => value,
    }
}

fn value_suffix(property: AnimatedProperty) -> &'static str {
    match property {
        AnimatedProperty::Opacity | AnimatedProperty::ScaleX | AnimatedProperty::ScaleY => "%",
        AnimatedProperty::Rotation => "°",
        AnimatedProperty::PositionX | AnimatedProperty::PositionY | AnimatedProperty::Width | AnimatedProperty::Height => "px",
    }
}

fn keyframe_set_params(
    composition_id: u64,
    track_id: u64,
    frame: u32,
    property: AnimatedProperty,
    value: f64,
    interpolation: Interpolation,
) -> serde_json::Value {
    json!({
        "compositionId": composition_id,
        "trackId": track_id,
        "frame": frame,
        "value": stored_value(property, value),
        "interpolation": serde_json::to_value(interpolation).unwrap_or(serde_json::Value::Null),
    })
}

pub(crate) fn edit_keyframe_value(
    app: &mut FigApp,
    ui: &Ui,
    composition_id: u64,
    track_id: u64,
    frame: u32,
    property: AnimatedProperty,
    interpolation: Interpolation,
    edit: Option<crate::widgets::FieldEdit>,
) {
    if app.ui.motion_keyframe_interaction == Some((track_id, frame)) && ui.input(|i| i.key_pressed(egui::Key::Escape)) {
        cancel_keyframe_interaction(app);
        return;
    }
    let params = |value| keyframe_set_params(composition_id, track_id, frame, property, value, interpolation);
    match edit {
        Some(crate::widgets::FieldEdit::Set(value)) => {
            if app.ui.motion_keyframe_interaction.is_some() {
                let _ = app.session.commit_interaction();
                app.ui.motion_keyframe_interaction = None;
            }
            app.run("motion.keyframe.set", params(value));
        }
        Some(crate::widgets::FieldEdit::Scrub(value, done)) => {
            if app.ui.motion_keyframe_interaction.is_none() {
                if let Err(error) = app.session.begin_interaction("Edit keyframe") {
                    app.toast(error.to_string());
                    return;
                }
                app.ui.motion_keyframe_interaction = Some((track_id, frame));
            }
            if let Err(error) = app.session.execute("motion.keyframe.set", &params(value)) {
                let _ = app.session.cancel_interaction();
                app.ui.motion_keyframe_interaction = None;
                app.toast(error.to_string());
                return;
            }
            if done {
                if let Err(error) = app.session.commit_interaction() {
                    app.toast(error.to_string());
                }
                app.ui.motion_keyframe_interaction = None;
            }
        }
        None => {}
    }
}

pub(crate) fn cancel_keyframe_interaction(app: &mut FigApp) {
    if app.ui.motion_keyframe_interaction.take().is_some() {
        let _ = app.session.cancel_interaction();
    }
}

#[cfg(test)]
mod keyframe_value_tests {
    use super::*;

    #[test]
    fn percentage_properties_round_trip_without_changing_motion_payload_scope() {
        assert_eq!(display_value(AnimatedProperty::Opacity, 0.42), 42.0);
        assert_eq!(stored_value(AnimatedProperty::Opacity, 42.0), 0.42);
        assert_eq!(stored_value(AnimatedProperty::Opacity, 120.0), 1.0);
        assert_eq!(display_value(AnimatedProperty::ScaleX, 1.25), 125.0);
        assert_eq!(stored_value(AnimatedProperty::ScaleX, 125.0), 1.25);

        let params = keyframe_set_params(7, 11, 24, AnimatedProperty::Opacity, 75.0, Interpolation::Step);
        assert_eq!(params["compositionId"], 7);
        assert_eq!(params["trackId"], 11);
        assert_eq!(params["frame"], 24);
        assert_eq!(params["value"], 0.75);
        assert_eq!(params["interpolation"], serde_json::to_value(Interpolation::Step).unwrap());
        assert!(params.get("target").is_none(), "editing a keyframe must not target base Design properties");
    }
}
