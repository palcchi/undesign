//! The right panel: Design, Prototype and Inspect tabs.

use egui::{Align2, Color32, CornerRadius, Id, Pos2, Rect, Sense, Stroke, Ui, pos2, vec2};
use serde_json::{Value, json};
use undesign_color::{BlendMode, Paint, PaintKind};
use undesign_doc::*;
use undesign_engine::cmd::lists::{moved_index, removed_index};

use crate::a11y::{self, Tip};
use crate::app_glyphs::{self, Glyph};
use crate::i18n::{tr, trf, trn};
use crate::icons::{self, Icon};
use crate::list_drag::{ListDrag, move_flags, remove_flags};
use crate::style_picker::{self, StyleSlot};
use crate::theme::{Tokens, regular, semibold};
use crate::widgets::{self, Edit, FIELD_H, FieldEdit, Lead, PAD};
use crate::{FigApp, RightTab};

/// Common value of `f` across `ids` (None when mixed or empty).
pub(crate) fn common<T: PartialEq + Clone>(doc: &Document, ids: &[NodeId], f: impl Fn(&Node) -> T) -> Option<T> {
    let mut it = ids.iter().filter_map(|i| doc.node(*i));
    let first = f(it.next()?);
    if it.all(|n| f(n) == first) { Some(first) } else { None }
}

impl FigApp {
    /// Set properties on `ids` (one undo step).
    pub fn set_props(&mut self, ids: &[NodeId], props: Value) {
        if ids.is_empty() {
            return;
        }
        self.run("node.set", json!({"ids": ids, "props": props}));
    }

    /// Apply a field edit: scrubs are live previews committed as one step.
    pub fn field(&mut self, ids: &[NodeId], key: &str, edit: Option<FieldEdit>, map: impl Fn(f64) -> Value) {
        if ids.is_empty() {
            return;
        }
        self.field_run(edit, "node.set", |v| json!({"ids": ids, "props": { key: map(v) }}));
    }

    /// [`Self::field`] for a field showing `shown(layer)`: a relative edit of mixed values (`+10`,
    /// `*2`, an arrow key's step) goes to each layer from its own value, in one undo step.
    pub fn field_of(&mut self, ids: &[NodeId], key: &str, edit: Option<Edit>, shown: impl Fn(&Node) -> f64, map: impl Fn(f64) -> Value) {
        let rel = match edit {
            Some(Edit::Each(rel)) => rel,
            Some(Edit::All(e)) => return self.field(ids, key, Some(e), map),
            None => return,
        };
        let Ok(doc) = self.session.doc() else { return };
        let values: Vec<(NodeId, f64)> = ids.iter().filter_map(|i| Some((*i, rel.apply(shown(doc.node(*i)?))?))).collect();
        if values.is_empty() || self.session.begin_interaction("Edit").is_err() {
            return;
        }
        for (id, v) in values {
            if let Err(e) = self.session.execute("node.set", &json!({"ids": [id], "props": { key: map(v) }})) {
                self.failed("node.set", &e);
            }
        }
        let _ = self.session.commit_interaction();
    }

    /// Apply a field edit through any command: `params` builds the command's params from the value.
    pub fn field_run(&mut self, edit: Option<FieldEdit>, cmd: &str, params: impl Fn(f64) -> Value) {
        match edit {
            Some(FieldEdit::Set(v)) => {
                self.run(cmd, params(v));
            }
            Some(FieldEdit::Scrub(v, done)) => {
                let _ = self.session.begin_interaction("Edit");
                let _ = self.session.execute(cmd, &params(v));
                if done {
                    let _ = self.session.commit_interaction();
                }
            }
            None => {}
        }
    }
}

/// Global document actions in the top editor bar, separate from the inspector panel.
pub fn header_actions(app: &mut FigApp, ui: &mut Ui, bar: Rect, buttons_w: f32) {
    let t = Tokens::get(ui.ctx());
    let cy = bar.center().y;
    let right = bar.max.x - buttons_w - 10.0;

    // Share remains the primary action, with live collaborators grouped beside it.
    let share = Rect::from_min_size(pos2(right - 64.0, cy - 16.0), vec2(64.0, 32.0));
    let label = ui.painter().layout_no_wrap(tr("Share").to_string(), semibold(11.5), t.accent_on);
    let sresp = ui.interact(share, ui.id().with("global_share"), Sense::click()).tip(tr("Share: live session, export"));
    ui.painter().rect_filled(share, CornerRadius::same(7), if sresp.hovered() { t.accent_hover } else { t.accent });
    ui.painter().galley(share.center() - label.size() / 2.0, label, t.accent_on);
    crate::live::share_popover(app, &sresp);

    let people = Rect::from_min_max(pos2(share.min.x - 92.0, bar.min.y), pos2(share.min.x - 72.0, bar.max.y));
    crate::live::people_bar(app, ui, people);

    let play = Rect::from_min_size(pos2(share.min.x - 128.0, cy - 14.0), vec2(34.0, 28.0));
    let (tri_r, chev_r) =
        (Rect::from_min_max(play.min, pos2(play.max.x - 13.0, play.max.y)), Rect::from_min_max(pos2(play.max.x - 13.0, play.min.y), play.max));
    let present_keys = crate::toolbar::pretty_shortcut(crate::shortcuts::shortcut("proto.present").unwrap_or(""));
    let presp = ui.interact(tri_r, ui.id().with("global_play"), Sense::click()).tip(format!("{}  {present_keys}", tr("Present")));
    let mresp = ui.interact(chev_r, ui.id().with("global_play_menu"), Sense::click()).tip(tr("Present or preview"));
    if presp.hovered() || mresp.hovered() {
        ui.painter().rect_filled(play, CornerRadius::same(6), t.hover);
    }
    app_glyphs::paint(ui.painter(), Rect::from_center_size(play.center() - vec2(5.0, 0.0), vec2(15.0, 15.0)), Glyph::Play, t.icon);
    app_glyphs::paint(ui.painter(), Rect::from_center_size(play.center() + vec2(10.0, 0.0), vec2(9.0, 9.0)), Glyph::ChevronDown, t.icon_secondary);
    if presp.clicked() {
        app.run("proto.present", json!({}));
    }
    menu_popup(&mresp).width(200.0).show(|ui| {
        if menu_item(ui, tr("Present"), &present_keys) {
            app.run("proto.present", json!({}));
            ui.close();
        }
        let (label, cmd) = if app.ui.preview.is_some() { (tr("Close preview"), "proto.closePreview") } else { (tr("Preview"), "proto.preview") };
        if menu_item(ui, label, "") {
            app.run(cmd, json!({}));
            ui.close();
        }
    });

    for (offset, (glyph, command, tip)) in [(0.0, (Icon::Undo, "edit.undo", tr("Undo"))), (34.0, (Icon::Redo, "edit.redo", tr("Redo")))] {
        let r = Rect::from_center_size(pos2(play.min.x - 18.0 - offset, cy), vec2(28.0, 28.0));
        let resp = ui.interact(r, ui.id().with(("global_history", command)), Sense::click()).tip(tip);
        if resp.hovered() || resp.has_focus() {
            ui.painter().rect_filled(r, CornerRadius::same(6), t.hover);
        }
        icons::paint(ui.painter(), r.shrink(7.0), glyph, t.icon);
        if resp.clicked() {
            app.run(command, json!({}));
        }
    }
}

pub fn right_panel(app: &mut FigApp, ui: &mut Ui) {
    let t = Tokens::get(ui.ctx());
    let w = ui.available_width();
    // Workspace tabs follow the compact segmented layout from the editor reference: four equal
    // targets on one row, with the zoom control on its own second row.
    let (tabs, _) = ui.allocate_exact_size(vec2(w, 68.0), Sense::hover());
    ui.painter().line_segment([tabs.left_top(), tabs.right_top()], Stroke::new(1.0, t.border));
    let tab_items =
        [(RightTab::Design, tr("Design")), (RightTab::Prototype, tr("Prototype")), (RightTab::Motion, tr("Motion")), (RightTab::Agent, tr("Agent"))];
    let tab_gap = 2.0;
    let tab_w = ((w - 12.0) - tab_gap * 3.0) / 4.0;
    for (index, (tab, label)) in tab_items.into_iter().enumerate() {
        let x = tabs.min.x + 6.0 + index as f32 * (tab_w + tab_gap);
        let r = Rect::from_min_size(pos2(x, tabs.min.y + 5.0), vec2(tab_w, 27.0));
        let resp = ui.interact(r, ui.id().with(("rtab", label)), Sense::click());
        let active = app.ui.right_tab == tab;
        a11y::tab(&resp, label, active);
        if active {
            ui.painter().rect_filled(r, CornerRadius::same(7), t.selected_row);
        } else if resp.hovered() || resp.has_focus() {
            ui.painter().rect_filled(r, CornerRadius::same(7), t.hover);
        }
        ui.painter().text(r.center(), Align2::CENTER_CENTER, label, semibold(10.5), if active { t.accent_text } else { t.text_secondary });
        if resp.clicked() {
            if tab != RightTab::Motion {
                crate::motion_panel::cancel_keyframe_interaction(app);
            }
            if tab == RightTab::Prototype && app.ui.right_tab != tab {
                crate::proto_panel::open_editor(ui.ctx(), None);
            }
            app.ui.right_tab = tab;
        }
    }
    // Zoom menu.
    let zoom = app.session.ds().map(|d| d.view.zoom).unwrap_or(1.0);
    let zr = Rect::from_min_size(pos2(tabs.max.x - 64.0, tabs.min.y + 38.0), vec2(56.0, 28.0));
    let zresp = ui.interact(zr, ui.id().with("zoommenu"), Sense::click());
    // The value is only spelled out while a screen reader reads the tree.
    let value = if a11y::active(&zresp.ctx) { format!("{}%", (zoom * 100.0).round()) } else { String::new() };
    a11y::combo(&zresp, tr("Zoom"), &value, a11y::menu_open(&zresp));
    if zresp.hovered() {
        ui.painter().rect_filled(zr, CornerRadius::same(5), t.hover);
    }
    // Use the same neutral selected-text token as other active controls.
    ui.painter().text(pos2(zr.min.x + 6.0, zr.center().y), Align2::LEFT_CENTER, format!("{}%", (zoom * 100.0).round()), regular(11.0), t.accent_text);
    app_glyphs::paint(
        ui.painter(),
        Rect::from_center_size(pos2(zr.max.x - 9.0, zr.center().y), vec2(10.0, 10.0)),
        Glyph::ChevronDown,
        t.icon_secondary,
    );
    menu_popup(&zresp).width(200.0).show(|ui| {
        for (label, cmd) in [
            (tr("Zoom in"), "view.zoomIn"),
            (tr("Zoom out"), "view.zoomOut"),
            (tr("Zoom to fit"), "view.zoomFit"),
            (tr("Zoom to 50%"), "view.zoom50"),
            (tr("Zoom to 100%"), "view.zoom100"),
            (tr("Zoom to 200%"), "view.zoom200"),
            (tr("Zoom to selection"), "view.zoomSelection"),
        ] {
            if menu_item(ui, label, crate::shortcuts::shortcut(cmd).unwrap_or("")) {
                app.run(cmd, json!({}));
                ui.close();
            }
        }
        ui.separator();
        let Ok(v) = app.session.ds().map(|d| d.view.clone()) else { return };
        for (label, scale) in [(tr("Pixel preview 1x"), 1u8), (tr("Pixel preview 2x"), 2)] {
            let on = v.pixel_preview && v.pixel_scale == scale;
            if menu_check(ui, on, label, "") {
                app.run("view.pixelPreview", json!({"on": !on, "scale": scale}));
                ui.close();
            }
        }
        let toggles: [(&str, &str, bool); 5] = [
            (tr("Pixel grid"), "view.pixelGrid", v.pixel_grid),
            (tr("Snap to pixel grid"), "view.snapPixel", v.snap_pixel),
            (tr("Layout grids"), "view.layoutGrids", v.layout_grids),
            (tr("Rulers"), "view.rulers", v.rulers),
            (tr("Outlines"), "view.outlines", v.outlines),
        ];
        for (label, cmd, on) in toggles {
            if menu_check(ui, on, label, crate::shortcuts::shortcut(cmd).unwrap_or("")) {
                app.run(cmd, json!({}));
                ui.close();
            }
        }
    });
    ui.painter().line_segment([tabs.left_bottom(), tabs.right_bottom()], Stroke::new(1.0, t.border));
    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
        ui.spacing_mut().item_spacing = vec2(8.0, 0.0);
        if app.session.tool.tool == undesign_engine::ToolId::Comment {
            crate::comments::panel(app, ui);
            ui.add_space(80.0);
            return;
        }
        match app.ui.right_tab {
            // The Frame tool shows the frame presets.
            RightTab::Design if app.session.tool.tool == undesign_engine::ToolId::Frame => crate::frame_presets::panel(app, ui),
            RightTab::Design => design(app, ui),
            RightTab::Prototype => crate::proto_panel::prototype(app, ui),
            RightTab::Motion => crate::motion_panel::panel(app, ui),
            RightTab::Agent => crate::agent_ui::panel(app, ui),
            RightTab::Inspect => inspect(app, ui),
        }
        ui.add_space(80.0);
        a11y::scroll_focus(&mut app.ui.nav, ui);
    });
}

/// The smallest width a popup menu is measured in (see [`menu_popup`]).
const MENU_MIN_W: f32 = 48.0;
/// A menu row's inset either side, and the gap between its label and its shortcut or art.
const MENU_PAD: f32 = 8.0;
const MENU_GAP: f32 = 24.0;

/// The style of popup menus: egui's, with text kept on one line (a menu grows to its widest item).
pub(crate) fn menu_style(s: &mut egui::Style) {
    egui::containers::menu::menu_style(s);
    s.wrap_mode = Some(egui::TextWrapMode::Extend);
}

/// The menu a dropdown or button opens: as wide as its widest row and at least as wide as
/// `anchor`. egui measures a popup in a first, invisible pass as wide as the width it is given
/// (else its 600 px default area width) and keeps the size measured; rows ([`menu_row`]) take the
/// larger of that width and their content, so the menu fits its content. Chain `.width(w)` for a
/// menu at least `w` wide.
/// The blend modes as menu items in groups (pass-through only for layers); the one picked.
pub fn blend_menu(ui: &mut Ui, with_pass_through: bool) -> Option<BlendMode> {
    let mut picked = None;
    for b in BlendMode::ALL.into_iter().filter(|b| with_pass_through || *b != BlendMode::PassThrough) {
        if menu_item(ui, tr(b.label()), "") {
            picked = Some(b);
            ui.close();
        }
        if matches!(b, BlendMode::Normal | BlendMode::ColorBurn | BlendMode::ColorDodge | BlendMode::HardLight | BlendMode::Exclusion) {
            ui.separator();
        }
    }
    picked
}

pub fn menu_popup(anchor: &egui::Response) -> egui::Popup<'static> {
    egui::Popup::menu(anchor).width(anchor.rect.width().max(MENU_MIN_W)).style(menu_style)
}

/// A context menu (secondary click on `resp`) sized like [`menu_popup`].
pub fn context_popup(resp: &egui::Response) -> egui::Popup<'static> {
    egui::Popup::context_menu(resp).width(MENU_MIN_W).style(menu_style)
}

pub fn menu_item(ui: &mut Ui, label: &str, shortcut: &str) -> bool {
    menu_row(ui, label, shortcut, 0.0, |_, _, _| {}).clicked()
}

/// A menu row with art drawn into it after the label (`art(painter, row rect, text colour)`),
/// taking `art_w` from the row's right edge.
pub fn menu_item_with(ui: &mut Ui, label: &str, shortcut: &str, art_w: f32, art: impl FnOnce(&egui::Painter, Rect, Color32)) -> bool {
    menu_row(ui, label, shortcut, art_w, art).clicked()
}

/// The width a menu row needs for a label `label_w` wide and, at its right end, a shortcut or
/// art `trail` wide (0 for neither).
pub(crate) fn menu_row_width(label_w: f32, trail: f32) -> f32 {
    MENU_PAD + label_w + if trail > 0.0 { MENU_GAP + trail } else { MENU_PAD }
}

/// A menu row (see [`menu_item_with`]); its response tells hovering too. It spans the menu and
/// is at least as wide as its label, shortcut and art.
pub fn menu_row(ui: &mut Ui, label: &str, shortcut: &str, art_w: f32, art: impl FnOnce(&egui::Painter, Rect, Color32)) -> egui::Response {
    let t = Tokens::get(ui.ctx());
    let text = ui.painter().layout_no_wrap(label.to_owned(), regular(11.5), Color32::PLACEHOLDER);
    let keys =
        (!shortcut.is_empty()).then(|| ui.painter().layout_no_wrap(crate::toolbar::pretty_shortcut(shortcut), regular(11.0), Color32::PLACEHOLDER));
    let trail = keys.as_ref().map_or(0.0, |k| k.size().x + MENU_PAD).max(art_w);
    let w = ui.available_width().max(menu_row_width(text.size().x, trail).ceil());
    let (r, resp) = ui.allocate_exact_size(vec2(w, 26.0), Sense::click());
    a11y::menu_item(&resp, label, shortcut, None);
    // The keyboard's item is highlighted like the hovered one.
    a11y::own_focus(&resp);
    let hovered = resp.hovered() || resp.has_focus();
    if hovered {
        ui.painter().rect_filled(r, CornerRadius::same(5), t.menu_hover);
    }
    // These menus sit on the theme's popup fill (white in the light theme), not on the dark
    // `t.menu` of the menu bar: the theme's text, white only on the green highlight (#972).
    let col = if hovered { t.menu_text } else { t.text };
    ui.painter().galley(pos2(r.min.x + MENU_PAD, r.center().y - text.size().y / 2.0), text, col);
    if let Some(k) = keys {
        let at = pos2(r.max.x - MENU_PAD - k.size().x, r.center().y - k.size().y / 2.0);
        ui.painter().galley(at, k, if hovered { t.menu_text } else { t.text_secondary });
    }
    art(ui.painter(), r, col);
    resp
}

/// A menu item with a check mark when `on` (the unchecked ones line up with it).
pub fn menu_check(ui: &mut Ui, on: bool, label: &str, shortcut: &str) -> bool {
    marked_row(ui, Some(on), label, shortcut)
}

/// A plain menu item lined up with the check items above or below it.
pub fn menu_item_beside_checks(ui: &mut Ui, label: &str, shortcut: &str) -> bool {
    marked_row(ui, None, label, shortcut)
}

fn marked_row(ui: &mut Ui, on: Option<bool>, label: &str, shortcut: &str) -> bool {
    let resp = menu_row(ui, &format!("{}{label}", if on == Some(true) { "✓ " } else { "    " }), shortcut, 0.0, |_, _, _| {});
    a11y::menu_item(&resp, label, shortcut, on);
    resp.clicked()
}

pub(crate) fn row(ui: &mut Ui, h: f32, add: impl FnOnce(&mut Ui)) {
    row_rect(ui, h, add);
}

/// [`row`], returning the area the row takes.
pub(crate) fn row_rect(ui: &mut Ui, h: f32, add: impl FnOnce(&mut Ui)) -> Rect {
    block(ui, h, (h - FIELD_H) / 2.0, add)
}

/// A panel row `h` tall whose content is inset `inset_y` from its top and bottom (for content
/// taller than one field); returns the area the row takes.
pub(crate) fn block(ui: &mut Ui, h: f32, inset_y: f32, add: impl FnOnce(&mut Ui)) -> Rect {
    let w = ui.available_width();
    let (r, _) = ui.allocate_exact_size(vec2(w, h), Sense::hover());
    let mut child =
        ui.new_child(egui::UiBuilder::new().max_rect(r.shrink2(vec2(PAD, inset_y))).layout(egui::Layout::left_to_right(egui::Align::Center)));
    child.spacing_mut().item_spacing = vec2(8.0, 0.0);
    add(&mut child);
    r
}

fn design(app: &mut FigApp, ui: &mut Ui) {
    let Ok(ds) = app.session.ds() else { return };
    // The panel shows the document itself, not a live text preview over it.
    let doc = ds.text_preview.clone().unwrap_or_else(|| ds.doc.clone());
    let sel = ds.selection.clone();
    let vector_edit = ds.vector_edit.clone();
    if sel.is_empty() {
        page_section(app, ui, &doc);
        return;
    }
    header(app, ui, &doc, &sel);
    widgets::separator(ui);
    // Editing a vector with points selected, the points' fields stand in for the layer's position
    // and dimensions.
    let points_selected = vector_edit.as_ref().is_some_and(|ve| !ve.vertices.is_empty() || !ve.segments.is_empty());
    let vector_edit_none = vector_edit.is_none();
    match vector_edit {
        Some(ve) => crate::vector_panel::points(app, ui, &doc, &ve),
        None => {
            crate::section_panel::section(app, ui, &doc, &sel);
            if app.session.tool.tool == undesign_engine::ToolId::Scale {
                crate::scale_panel::section(app, ui, &doc, &sel);
                widgets::separator(ui);
            }
            position(app, ui, &doc, &sel);
        }
    }
    widgets::separator(ui);
    if !points_selected {
        crate::layout_panel::layout_section(app, ui, &doc, &sel);
        widgets::separator(ui);
    }
    if vector_edit_none && (arc_section(app, ui, &doc, &sel) || points_section(app, ui, &doc, &sel)) {
        widgets::separator(ui);
    }
    appearance(app, ui, &doc, &sel);
    widgets::separator(ui);
    if variable_modes(app, ui, &doc, &sel) {
        widgets::separator(ui);
    }
    if sel.iter().any(|i| matches!(doc.node(*i).map(|n| &n.kind), Some(NodeKind::Text(_)))) {
        crate::typography::typography(app, ui, &doc, &sel);
        widgets::separator(ui);
    }
    paints(app, ui, &doc, &sel, true);
    widgets::separator(ui);
    paints(app, ui, &doc, &sel, false);
    widgets::separator(ui);
    effects(app, ui, &doc, &sel);
    widgets::separator(ui);
    crate::selection_colors::section(app, ui, &doc, &sel);
    if sel.iter().all(|i| doc.node(*i).is_some_and(|n| n.kind.is_frame_like())) {
        grids(app, ui, &doc, &sel);
        widgets::separator(ui);
    }
    crate::export_panel::section(app, ui, &doc, &sel);
}

fn page_section(app: &mut FigApp, ui: &mut Ui, doc: &Document) {
    let t = Tokens::get(ui.ctx());
    let Ok(page) = app.session.page() else { return };
    let bg = match doc.node(page).map(|n| &n.kind) {
        Some(NodeKind::Page { background, .. }) => *background,
        _ => undesign_color::Color::DEFAULT_PAGE,
    };
    widgets::section_header(ui, tr("Page"), &[], false);
    let mut open_picker = false;
    let mut new_hex = None;
    row(ui, 32.0, |ui| {
        let p = Paint::solid(bg);
        if widgets::swatch(ui, &p, 16.0).clicked() {
            open_picker = true;
        }
        if let Some(h) = widgets::text_field(ui, Id::new("pagebg"), &bg.to_hex(), 96.0, "") {
            new_hex = Some(h);
        }
        widgets::label(ui, "100 %", t.text);
    });
    if open_picker {
        app.ui.picker = Some(crate::colorpicker::PickerTarget::PageBackground);
    }
    if let Some(h) = new_hex
        && let Some(c) = undesign_color::Color::from_hex_or_name(&h)
    {
        app.run("page.setBackground", json!({"color": c.to_css_hex()}));
    }
    widgets::separator(ui);
    widgets::section_header(ui, tr("Color profile"), &[], false);
    row(ui, 32.0, |ui| {
        let resp = widgets::dropdown(ui, doc.color_profile.label(), 140.0, None);
        menu_popup(&resp).show(|ui| {
            for p in undesign_color::ColorProfile::ALL {
                if menu_item(ui, p.label(), "") {
                    if p != doc.color_profile {
                        app.ui.color_profile = Some(p);
                    }
                    ui.close();
                }
            }
        });
    });
    widgets::separator(ui);
    // Local variables & styles.
    let vars = doc.variables.variables.iter().filter(|v| !undesign_engine::library::is_remote_variable(doc, &v.id)).count();
    widgets::section_header(ui, tr("Local variables"), &[], vars == 0);
    row(ui, 32.0, |ui| {
        let r = widgets::dropdown(ui, &trf("Open variables ({count})", &[("count", &vars)]), 200.0, Some(Icon::Styles));
        if r.clicked() {
            app.ui.preferences = false;
            app.ui.palette = None;
            app.ui.variables.get_or_insert_with(Default::default);
        }
    });
    widgets::separator(ui);
    widgets::section_header(ui, tr("Local styles"), &[], undesign_engine::library::local_styles(doc).next().is_none());
    crate::style_picker::local_styles(app, ui, doc);
    widgets::separator(ui);
    crate::export_panel::page_section(app, ui, doc, page);
}

fn header(app: &mut FigApp, ui: &mut Ui, doc: &Document, sel: &[NodeId]) {
    let t = Tokens::get(ui.ctx());
    let label = match common(doc, sel, |n| n.kind.label()) {
        Some(l) if sel.len() == 1 => tr(l).to_string(),
        // The plural ("Frames") is a key of its own.
        Some(l) => tr(&format!("{l}s")).to_string(),
        None => tr("Mixed").into(),
    };
    let is_frame = sel.len() == 1 && sel.first().and_then(|i| doc.node(*i)).is_some_and(|n| matches!(n.kind, NodeKind::Frame));
    // Frames and groups convert into each other from the type menu.
    let is_group = !sel.is_empty() && sel.iter().all(|i| doc.node(*i).is_some_and(|n| matches!(n.kind, NodeKind::Group)));
    let kind_items = |app: &mut FigApp, ui: &mut Ui, frame: bool| {
        for (to_frame, label, cmd) in [(true, tr("Frame"), "object.convertToFrame"), (false, tr("Group"), "object.convertToGroup")] {
            if menu_check(ui, to_frame == frame, label, "") {
                if to_frame != frame {
                    app.run(cmd, json!({"ids": sel}));
                }
                ui.close();
            }
        }
    };
    let w = ui.available_width();
    let (r, _) = ui.allocate_exact_size(vec2(w, 40.0), Sense::hover());
    let lr = Rect::from_min_size(pos2(r.min.x + 8.0, r.center().y - 12.0), vec2(120.0, 24.0));
    let resp = ui.interact(lr, ui.id().with("typedd"), Sense::click());
    if resp.hovered() {
        ui.painter().rect_filled(lr, CornerRadius::same(5), t.hover);
    }
    ui.painter().text(pos2(lr.min.x + 8.0, lr.center().y), Align2::LEFT_CENTER, &label, semibold(13.0), t.text);
    if is_frame || is_group {
        icons::paint(
            ui.painter(),
            Rect::from_center_size(pos2(lr.min.x + 18.0 + label.len() as f32 * 6.5, lr.center().y), vec2(10.0, 10.0)),
            Icon::Chevron,
            t.icon_secondary,
        );
    }
    if is_group {
        menu_popup(&resp).width(180.0).show(|ui| kind_items(app, ui, false));
    }
    if is_frame {
        let sr = Rect::from_min_size(pos2(lr.max.x + 4.0, r.center().y - 12.0), vec2(24.0, 24.0));
        let sresp = ui.interact(sr, ui.id().with("swap_orient"), Sense::click()).tip(tr("Swap orientation"));
        if sresp.hovered() {
            ui.painter().rect_filled(sr, CornerRadius::same(5), t.hover);
        }
        icons::paint(ui.painter(), sr.shrink(5.0), Icon::Rotate, t.icon);
        if sresp.clicked() {
            app.run("frame.swapOrientation", json!({"ids": sel}));
        }
        let ids: Vec<NodeId> = sel.to_vec();
        menu_popup(&resp).width(260.0).show(|ui| {
            egui::ScrollArea::vertical().max_height(420.0).show(ui, |ui| {
                kind_items(app, ui, true);
                ui.separator();
                let mut cat = "";
                for (c, name, pw, ph) in undesign_engine::cmd::create::FRAME_PRESETS {
                    if *c != cat {
                        cat = c;
                        ui.label(egui::RichText::new(tr(c)).font(semibold(11.0)).color(t.text_secondary));
                    }
                    if menu_item(ui, name, &format!("{}×{}", pw, ph)) {
                        app.set_props(&ids, json!({"width": pw, "height": ph}));
                        ui.close();
                    }
                }
            });
        });
    }
    // Quick actions on the right.
    let mut x = r.max.x - 8.0;
    let actions = [
        (Icon::Component, tr("Create component"), "component.create"),
        (Icon::Mask, tr("Use as mask"), "object.mask"),
        (Icon::Union, tr("Boolean groups"), "bool.union"),
    ];
    // Layers in boolean groups, or one boolean group: the operation they use (checked in the menu).
    let current = undesign_engine::booleans::shown_op(doc, sel);
    for (icon, label, cmd) in actions.into_iter().rev() {
        let br = Rect::from_min_size(pos2(x - 24.0, r.center().y - 12.0), vec2(24.0, 24.0));
        let tip = if cmd == "bool.union" { label } else { crate::shortcuts::tip(label, cmd) };
        let bresp = ui.interact(br, ui.id().with(("qa", cmd)), Sense::click()).tip(tip);
        if bresp.hovered() {
            ui.painter().rect_filled(br, CornerRadius::same(5), t.hover);
        }
        // The boolean button shows the operation in use.
        let icon = match (cmd, current) {
            ("bool.union", Some(op)) => crate::layers::op_icon(op),
            _ => icon,
        };
        icons::paint(ui.painter(), br.shrink(5.0), icon, t.icon);
        if cmd == "bool.union" {
            menu_popup(&bresp).width(180.0).show(|ui| {
                for (op, c) in [
                    (BoolOp::Union, "bool.union"),
                    (BoolOp::Subtract, "bool.subtract"),
                    (BoolOp::Intersect, "bool.intersect"),
                    (BoolOp::Exclude, "bool.exclude"),
                ] {
                    let key = crate::shortcuts::shortcut(c).unwrap_or("");
                    let picked = match current {
                        Some(cur) => menu_check(ui, cur == op, tr(op.label()), key),
                        None => menu_item(ui, tr(op.label()), key),
                    };
                    if picked {
                        app.run(c, json!({}));
                        ui.close();
                    }
                }
                let key = crate::shortcuts::shortcut("vector.flatten").unwrap_or("");
                let flatten = if current.is_some() { menu_item_beside_checks(ui, tr("Flatten"), key) } else { menu_item(ui, tr("Flatten"), key) };
                if flatten {
                    app.run("vector.flatten", json!({}));
                    ui.close();
                }
            });
        } else if bresp.clicked() {
            app.run(cmd, json!({}));
        }
        x -= 26.0;
    }
    crate::component_panel::instance_section(app, ui, doc, sel);
}

fn position(app: &mut FigApp, ui: &mut Ui, doc: &Document, sel: &[NodeId]) {
    widgets::section_header(ui, tr("Position"), &[], false);
    // Layers inside an instance take their place and constraints from the main component.
    let nested = sel.iter().any(|i| undesign_engine::components::inside_instance(doc, *i));
    ui.add_enabled_ui(!nested, |ui| position_fields(app, ui, doc, sel))
        .response
        .on_disabled_hover_text(tr("Layers in an instance take their position from the main component"));
    ui.add_space(8.0);
}

fn position_fields(app: &mut FigApp, ui: &mut Ui, doc: &Document, sel: &[NodeId]) {
    let ids = sel.to_vec();
    let col = widgets::col_width(ui.available_width());
    widgets::sublabels(ui, tr("Alignment"), None);
    row(ui, 32.0, |ui| {
        let cmds = ["align.left", "align.hcenter", "align.right", "align.top", "align.vcenter", "align.bottom"];
        let tip = crate::shortcuts::tip;
        let items = [
            (Icon::AlignLeft, tip(tr("Align left"), cmds[0])),
            (Icon::AlignHCenter, tip(tr("Align horizontal centers"), cmds[1])),
            (Icon::AlignRight, tip(tr("Align right"), cmds[2])),
            (Icon::AlignTop, tip(tr("Align top"), cmds[3])),
            (Icon::AlignVCenter, tip(tr("Align vertical centers"), cmds[4])),
            (Icon::AlignBottom, tip(tr("Align bottom"), cmds[5])),
        ];
        let w = col / 3.0;
        let picked = ui.add_enabled_ui(undesign_engine::cmd::arrange::can_align(doc, sel), |ui| {
            let h = widgets::segmented(ui, &items[..3], None, w);
            let v = widgets::segmented(ui, &items[3..], None, w).map(|i| i + 3);
            h.or(v)
        });
        picked.response.on_disabled_hover_text(tr("A layer on its own aligns to its frame: select more layers, or one in a frame"));
        if let Some(i) = picked.inner {
            app.run(cmds[i], json!({"ids": ids}));
        }
        if sel.len() > 2 {
            let more = icons::button(ui, Icon::DistributeH, 24.0, false, tr("Distribute and tidy"));
            menu_popup(&more).show(|ui| {
                for (l, c) in [
                    (tr("Distribute horizontal spacing"), "distribute.horizontal"),
                    (tr("Distribute vertical spacing"), "distribute.vertical"),
                    (tr("Tidy up"), "arrange.tidy"),
                ] {
                    if menu_item(ui, l, crate::shortcuts::shortcut(c).unwrap_or("")) {
                        app.run(c, json!({"ids": ids}));
                        ui.close();
                    }
                }
            });
        }
    });
    // In the frame's space: groups have none of their own.
    // What each field shows of a layer (a relative edit of mixed values starts from it).
    let x_of = |n: &Node| (doc.frame_relative(n.id).as_coeffs()[4] * 100.0).round() / 100.0;
    let y_of = |n: &Node| (doc.frame_relative(n.id).as_coeffs()[5] * 100.0).round() / 100.0;
    let rot_of = |n: &Node| (undesign_geom::rotation_degrees(n.transform) * 100.0).round() / 100.0;
    let (x, y, rot) = (common(doc, sel, x_of), common(doc, sel, y_of), common(doc, sel, rot_of));
    let parent_al = sel.iter().all(|i| doc.node(*i).and_then(|n| n.parent).and_then(|p| doc.node(p)).is_some_and(|p| p.layout.is_some()));
    let absolute = common(doc, sel, |n| n.child_layout.absolute);
    widgets::sublabels(ui, tr("Position"), None);
    row(ui, 32.0, |ui| {
        let e = widgets::number_field_mixed(ui, Id::new("pos_x"), Lead::Text("X"), x, "", col, 1.0);
        app.field_of(&ids, "x", e, x_of, |v| json!(v));
        let e = widgets::number_field_mixed(ui, Id::new("pos_y"), Lead::Text("Y"), y, "", col, 1.0);
        app.field_of(&ids, "y", e, y_of, |v| json!(v));
        // Children of auto layout frames can ignore the layout (absolute position).
        if parent_al {
            let on = absolute.unwrap_or(false);
            if icons::button(
                ui,
                Icon::AbsolutePosition,
                24.0,
                on,
                if on { tr("Use auto layout") } else { tr("Ignore auto layout (absolute position)") },
            )
            .clicked()
            {
                app.set_props(&ids, json!({"absolute": !on}));
            }
        }
    });
    widgets::sublabels(ui, tr("Rotation"), None);
    row(ui, 32.0, |ui| {
        let e = widgets::number_field_mixed(ui, Id::new("pos_rot"), Lead::Icon(Icon::Angle, tr("Rotation")), rot, "°", col, 1.0);
        app.field_of(&ids, "rotation", e, rot_of, |v| json!(v));
        let items = [
            (Icon::Rotate, tr("Rotate 90° right")),
            (Icon::FlipH, crate::shortcuts::tip(tr("Flip horizontal"), "object.flipH")),
            (Icon::FlipV, crate::shortcuts::tip(tr("Flip vertical"), "object.flipV")),
        ];
        if let Some(i) = widgets::segmented(ui, &items, None, col / 3.0) {
            app.run(["object.rotateRight", "object.flipH", "object.flipV"][i], json!({"ids": ids}));
        }
    });
    // Constraints (children of frames without auto layout, or ignoring it).
    let in_frame = sel.iter().all(|i| {
        doc.node(*i).is_some_and(|n| {
            n.parent.and_then(|p| doc.node(p)).is_some_and(|p| p.kind.is_frame_like() && (p.layout.is_none() || n.child_layout.absolute))
        })
    });
    if in_frame {
        let c = common(doc, sel, |n| n.constraints);
        widgets::sublabels(ui, tr("Constraints"), None);
        row(ui, 32.0, |ui| {
            let h = c.map(|c| format!("{:?}", c.horizontal)).unwrap_or_else(|| "Mixed".into());
            let resp = widgets::dropdown(ui, tr(&pretty(&h)), col, None);
            menu_popup(&resp).show(|ui| {
                for (l, v) in [
                    (tr("Left"), "left"),
                    (tr("Right"), "right"),
                    (tr("Left & right"), "leftRight"),
                    (tr("Center"), "center"),
                    (tr("Scale"), "scale"),
                ] {
                    if menu_item(ui, l, "") {
                        app.set_props(&ids, json!({"constraints": {"horizontal": v}}));
                        ui.close();
                    }
                }
            });
            let v = c.map(|c| format!("{:?}", c.vertical)).unwrap_or_else(|| "Mixed".into());
            let resp = widgets::dropdown(ui, tr(&pretty(&v)), col, None);
            menu_popup(&resp).show(|ui| {
                for (l, val) in [
                    (tr("Top"), "top"),
                    (tr("Bottom"), "bottom"),
                    (tr("Top & bottom"), "topBottom"),
                    (tr("Center"), "center"),
                    (tr("Scale"), "scale"),
                ] {
                    if menu_item(ui, l, "") {
                        app.set_props(&ids, json!({"constraints": {"vertical": val}}));
                        ui.close();
                    }
                }
            });
        });
    }
}

/// The selected ellipses' arc: Start (degrees), Sweep (a share of a full turn, negative running
/// the other way) and Ratio (the inner radius), the same values the canvas arc handles drag
/// (`node.set`'s `arcStart` / `arcSweep` / `arcInner`; bindable to number variables, sweep and
/// ratio ones holding percentages). Returns whether it showed.
fn arc_section(app: &mut FigApp, ui: &mut Ui, doc: &Document, sel: &[NodeId]) -> bool {
    let arcs: Vec<(f64, f64, f64)> = sel
        .iter()
        .filter_map(|i| match doc.node(*i)?.kind {
            NodeKind::Ellipse { start, sweep, inner } => Some((start, sweep, inner)),
            _ => None,
        })
        .collect();
    if arcs.is_empty() || arcs.len() != sel.len() {
        return false;
    }
    let ids = sel.to_vec();
    let same = |f: &dyn Fn(&(f64, f64, f64)) -> f64| -> Option<f64> {
        let v = (f(arcs.first()?) * 100.0).round() / 100.0;
        arcs.iter().all(|a| ((f(a) * 100.0).round() / 100.0 - v).abs() < 1e-9).then_some(v)
    };
    let start = same(&|a| a.0.to_degrees().rem_euclid(360.0));
    let sweep = same(&|a| a.1 / std::f64::consts::TAU * 100.0);
    let ratio = same(&|a| a.2 * 100.0);
    widgets::section_header(ui, tr("Arc"), &[], false);
    let col = widgets::col_width(ui.available_width());
    let field = |app: &mut FigApp, ui: &mut Ui, key: &str, icon: Icon, name: &str, value: Option<f64>, suffix: &str| {
        crate::variable_ui::number_field(app, ui, &ids, key, Id::new(("arc", key)), Lead::Icon(icon, name), value, suffix, col)
    };
    widgets::sublabels(ui, tr("Start"), Some(tr("Sweep")));
    row(ui, 32.0, |ui| {
        let e = field(app, ui, "arcStart", Icon::ArcStart, tr("Arc start"), start, "°");
        app.field(&ids, "arcStart", e, |v| json!(v));
        let e = field(app, ui, "arcSweep", Icon::ArcSweep, tr("Arc sweep"), sweep, "%");
        app.field(&ids, "arcSweep", e, |v| json!(v.clamp(-100.0, 100.0) * 3.6));
    });
    widgets::sublabels(ui, tr("Ratio"), None);
    row(ui, 32.0, |ui| {
        let e = field(app, ui, "arcInner", Icon::ArcRatio, tr("Arc ratio"), ratio, "%");
        app.field(&ids, "arcInner", e, |v| json!((v / 100.0).clamp(0.0, 0.99)));
    });
    ui.add_space(8.0);
    true
}

/// The selected polygons' and stars' point count (3 to 60 on stars), and the stars' ratio (the
/// inner radius as a share of the outer one), as `node.set`'s `pointCount` / `innerRadius`.
/// Returns whether it showed.
fn points_section(app: &mut FigApp, ui: &mut Ui, doc: &Document, sel: &[NodeId]) -> bool {
    let shapes: Vec<(u32, Option<f64>)> = sel
        .iter()
        .filter_map(|i| match doc.node(*i)?.kind {
            NodeKind::Polygon { count } => Some((count, None)),
            NodeKind::Star { count, inner_ratio } => Some((count, Some(inner_ratio))),
            _ => None,
        })
        .collect();
    if shapes.is_empty() || shapes.len() != sel.len() {
        return false;
    }
    let ids = sel.to_vec();
    let count = shapes.first().map(|s| s.0).filter(|c| shapes.iter().all(|s| s.0 == *c)).map(f64::from);
    let stars: Vec<f64> = shapes.iter().filter_map(|s| s.1).collect();
    let ratio = stars.first().map(|r| (r * 1000.0).round() / 10.0).filter(|r| stars.iter().all(|x| ((x * 1000.0).round() / 10.0 - r).abs() < 1e-9));
    let all_stars = stars.len() == shapes.len();
    widgets::section_header(ui, tr(if all_stars { "Star" } else { "Polygon" }), &[], false);
    let col = widgets::col_width(ui.available_width());
    widgets::sublabels(ui, tr("Count"), all_stars.then_some(tr("Ratio")));
    row(ui, 32.0, |ui| {
        let e = widgets::number_field(ui, Id::new("pts_count"), Lead::Icon(Icon::Polygon, tr("Count")), count, "", col, 1.0);
        app.field(&ids, "pointCount", e, |v| json!(v.round().clamp(3.0, 120.0)));
        if all_stars {
            let e = widgets::number_field(ui, Id::new("pts_ratio"), Lead::Icon(Icon::Star, tr("Ratio")), ratio, "%", col, 1.0);
            app.field(&ids, "innerRadius", e, |v| json!((v / 100.0).clamp(0.001, 1.0)));
        }
    });
    ui.add_space(8.0);
    true
}

/// Constraint names as shown (English keys, translated at display).
fn pretty(s: &str) -> String {
    match s {
        "LeftRight" => "Left & right".into(),
        "TopBottom" => "Top & bottom".into(),
        other => other.to_string(),
    }
}

fn appearance(app: &mut FigApp, ui: &mut Ui, doc: &Document, sel: &[NodeId]) {
    let ids = sel.to_vec();
    let visible = common(doc, sel, |n| n.visible).unwrap_or(true);
    let hdr = widgets::section_header(
        ui,
        tr("Appearance"),
        &[
            (if visible { Icon::Eye } else { Icon::EyeOff }, crate::shortcuts::tip(tr("Show/Hide"), "object.toggleVisible")),
            (Icon::Variable, tr("Apply variable to visibility")),
            (Icon::Blend, tr("Blend mode")),
        ],
        false,
    );
    if hdr == Some(0) {
        app.run("object.toggleVisible", json!({"ids": ids}));
    }
    if hdr == Some(1) {
        crate::variable_ui::open_at_pointer(ui, &ids, "visible", VariableType::Boolean);
    }
    if hdr == Some(2) {
        ui.data_mut(|d| d.insert_temp(Id::new("blend_open"), !d.get_temp::<bool>(Id::new("blend_open")).unwrap_or(false)));
    }
    let col = widgets::col_width(ui.available_width());
    crate::variable_ui::bound_row(app, ui, &ids, "visible", VariableType::Boolean, Lead::Icon(Icon::Eye, tr("Visible")), col * 2.0 + 8.0);
    // Masks: how they mask.
    if sel.iter().all(|i| doc.node(*i).is_some_and(|n| n.is_mask)) {
        let mt = common(doc, sel, |n| n.mask_type);
        widgets::sublabels(ui, tr("Mask"), None);
        row(ui, 32.0, |ui| {
            let resp = widgets::dropdown(ui, mt.map(|m| tr(m.label())).unwrap_or(tr("Mixed")), col * 2.0 + 8.0, Some(Icon::Mask));
            menu_popup(&resp).show(|ui| {
                for m in MaskType::ALL {
                    if menu_item(ui, tr(m.label()), "") {
                        app.set_props(&ids, json!({"maskType": m.id()}));
                        ui.close();
                    }
                }
            });
        });
    }
    let op_of = |n: &Node| (f64::from(n.opacity) * 100.0).round();
    let op = common(doc, sel, op_of);
    let radius_ok = sel.iter().all(|i| doc.node(*i).is_some_and(|n| n.kind.has_corner_radius()));
    // Only rectangles and frames round each corner on its own.
    let indep_ok = radius_ok && sel.iter().all(|i| doc.node(*i).is_some_and(|n| n.kind.has_independent_corners()));
    // For polygons and stars the same panel holds only the Corner smoothing row.
    let smooth_ok = radius_ok && sel.iter().all(|i| doc.node(*i).is_some_and(|n| n.kind.has_corner_smoothing()));
    let r = common(doc, sel, |n| n.corners.uniform().map(|r| (r * 100.0).round() / 100.0));
    widgets::sublabels(ui, tr("Opacity"), radius_ok.then_some(tr("Corner radius")));
    row(ui, 32.0, |ui| {
        let lead = Lead::Icon(Icon::Opacity, tr("Opacity"));
        let e = crate::variable_ui::number_field_mixed(app, ui, &ids, "opacity", Id::new("ap_op"), lead, op, "%", col);
        app.field_of(&ids, "opacity", e, op_of, |v| json!((v / 100.0).clamp(0.0, 1.0)));
        if radius_ok {
            let e = crate::variable_ui::number_field_mixed(
                app,
                ui,
                &ids,
                "cornerRadius",
                Id::new("ap_rad"),
                Lead::Icon(Icon::CornerRadius, tr("Corner radius")),
                r.flatten(),
                "",
                col,
            );
            // A layer with corners of its own starts from its largest.
            let radius_of = |n: &Node| n.corners.uniform().unwrap_or_else(|| n.corners.radii.iter().copied().fold(0.0, f64::max));
            app.field_of(&ids, "cornerRadius", e, radius_of, |v| json!(v.max(0.0)));
            let open = ui.data(|d| d.get_temp::<bool>(Id::new("indep_corners"))).unwrap_or(false);
            // Polygons and stars have no corners of their own: the button opens only Corner smoothing.
            let tip = if indep_ok { tr("Individual corners") } else { tr("Corner smoothing") };
            if smooth_ok && icons::button(ui, Icon::IndependentCorners, 24.0, open, tip).clicked() {
                ui.data_mut(|d| d.insert_temp(Id::new("indep_corners"), !open));
            }
        }
    });
    if smooth_ok && ui.data(|d| d.get_temp::<bool>(Id::new("indep_corners"))).unwrap_or(false) {
        let radii = common(doc, sel, |n| n.corners.radii);
        // `k` indexes `radii` ([top left, top right, bottom right, bottom left]); the fields sit
        // where their corners are: top left, top right / bottom left, bottom right.
        let corners = [
            ("topLeftRadius", tr("Top left radius"), Icon::CornerTopLeft, 0),
            ("topRightRadius", tr("Top right radius"), Icon::CornerTopRight, 1),
            ("bottomLeftRadius", tr("Bottom left radius"), Icon::CornerBottomLeft, 3),
            ("bottomRightRadius", tr("Bottom right radius"), Icon::CornerBottomRight, 2),
        ];
        // Polygons and stars have one radius, so no field per corner.
        for pair in corners.chunks(2).filter(|_| indep_ok) {
            row(ui, 32.0, |ui| {
                for (key, name, icon, k) in pair {
                    let e = crate::variable_ui::number_field(
                        app,
                        ui,
                        &ids,
                        key,
                        Id::new(("corner", *k)),
                        Lead::Icon(*icon, name),
                        radii.map(|r| r[*k]),
                        "",
                        col,
                    );
                    app.field(&ids, key, e, |v| json!(v.max(0.0)));
                }
            });
        }
        let sm = common(doc, sel, |n| (n.corners.smoothing * 100.0).round());
        widgets::sublabels(ui, tr("Corner smoothing"), None);
        row(ui, 32.0, |ui| {
            let e = widgets::number_field(ui, Id::new("smoothing"), Lead::None, sm, "%", col, 1.0);
            app.field(&ids, "cornerSmoothing", e, |v| json!((v / 100.0).clamp(0.0, 1.0)));
            if widgets::button(ui, tr("iOS"), false, true).on_hover_text(tr("Set corner smoothing to 60%")).clicked() {
                app.set_props(&ids, json!({"cornerSmoothing": 0.6}));
            }
        });
    }
    let blend = common(doc, sel, |n| n.blend);
    let show_blend = ui.data(|d| d.get_temp::<bool>(Id::new("blend_open"))).unwrap_or(false)
        || blend.is_some_and(|b| !matches!(b, BlendMode::Normal | BlendMode::PassThrough));
    if show_blend {
        widgets::sublabels(ui, tr("Blend mode"), None);
        row(ui, 32.0, |ui| {
            let label = blend.map(|b| tr(b.label())).unwrap_or(tr("Mixed"));
            let resp = widgets::dropdown(ui, label, col * 2.0 + 8.0, Some(Icon::Blend));
            menu_popup(&resp).width(200.0).show(|ui| {
                if let Some(b) = blend_menu(ui, true) {
                    app.set_props(&ids, json!({"blend": b.label()}));
                }
            });
        });
    }
    ui.add_space(8.0);
}

/// The variable modes of the selected frames (sections, components, instances): a row per
/// collection with more than one mode, Auto (the mode the layer inherits from its parent) or a mode
/// of its own (`variable.setMode`). Collections from enabled libraries follow under their
/// library's name (`library.setVariableMode` copies the collection in). Returns whether it showed.
fn variable_modes(app: &mut FigApp, ui: &mut Ui, doc: &Document, sel: &[NodeId]) -> bool {
    if !sel.iter().all(|i| doc.node(*i).is_some_and(|n| n.kind.is_frame_like())) {
        return false;
    }
    let libs = crate::variable_ui::libraries(app, doc);
    let rows = crate::variable_ui::mode_rows(doc, &libs);
    if rows.is_empty() {
        return false;
    }
    let t = Tokens::get(ui.ctx());
    widgets::section_header(ui, tr("Variable modes"), &[], false);
    // The collection's name, then a wider mode picker ("Auto (Light)") across both field columns.
    let col = widgets::col_width(ui.available_width());
    let (name_w, pick_w) = ((col * 0.7).round(), (col * 1.3).round());
    // Auto resolves as for the first selected layer: from its parent, or an instance's main.
    let parent_modes = sel.first().map(|i| doc.inherited_modes(*i)).unwrap_or_default();
    let mut group = None;
    for r in &rows {
        let c = r.coll;
        // Library collections under their library's name.
