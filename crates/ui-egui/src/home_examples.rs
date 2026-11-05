//! Examples on the home screen: the sample files in `examples/`, built into the app so they open
//! anywhere, the browser included. Each opens as a new unsaved document; the file on disk is never
//! touched.

use base64::Engine as _;
use egui::{Align2, Color32, CornerRadius, Rect, Sense, Stroke, StrokeKind, TextureHandle, Ui, pos2, vec2};
use serde_json::json;

use crate::FigApp;
use crate::a11y;
use crate::i18n::{tr, tr_noop};
use crate::theme::{Tokens, regular, semibold};

/// One built-in example: its file name (which also tells `file.open` the format), what it is and
/// what it shows.
pub struct Example {
    pub file: &'static str,
    pub title: &'static str,
    pub about: &'static str,
    /// A Motion sample: it opens in the Motion workspace with the timeline showing.
    pub motion: bool,
    bytes: &'static [u8],
}

impl Example {
    /// The file's bytes as built into the app.
    pub fn bytes(&self) -> &'static [u8] {
        self.bytes
    }

    /// The name a link uses for it: the file name without `.undesign` (`undesign-intro`).
    pub fn name(&self) -> &'static str {
        self.file.strip_suffix(".undesign").unwrap_or(self.file)
    }
}

/// Open the example called `name` (see [`Example::name`]) as a new unsaved copy and leave Home; a
/// Motion example opens in the Motion workspace with the timeline showing, playing when `play` (and
/// the system doesn't ask for reduced motion). False for an unknown name or a file that won't open.
pub fn open(app: &mut FigApp, name: &str, play: bool) -> bool {
    let Some(example) = EXAMPLES.iter().find(|e| e.name() == name) else { return false };
    let data = base64::engine::general_purpose::STANDARD.encode(example.bytes);
    if app.run_user("file.open", json!({"data": data, "name": example.file})).is_none() {
        return false;
    }
    app.ui.home = false;
    if example.motion {
        app.ui.right_tab = crate::RightTab::Motion;
        app.ui.compact_panel = crate::CompactPanel::Motion;
        app.ui.motion_timeline = true;
        app.ui.motion_frame = 0;
        app.ui.motion_playing = play && !app.reduce_motion();
    }
    true
}

/// Motion first: the samples a demo usually starts from.
pub const EXAMPLES: &[Example] = &[
    Example {
        file: "undesign-intro.undesign",
        title: tr_noop("Undesign intro"),
        about: tr_noop("Motion: the mark, the wordmark and four feature chips animate in over 3 s"),
        motion: true,
        bytes: include_bytes!("../../../examples/undesign-intro.undesign"),
    },
    Example {
        file: "daybreak-motion-study.undesign",
        title: tr_noop("Daybreak motion study"),
        about: tr_noop("Motion: a weather screen's glass panels, sun and forecast on a 4 s timeline"),
        motion: true,
        bytes: include_bytes!("../../../examples/daybreak-motion-study.undesign"),
    },
    Example {
        file: "profile-card-design.undesign",
        title: tr_noop("Profile card design"),
        about: tr_noop("Design: a profile shown in light and green surfaces"),
        motion: false,
        bytes: include_bytes!("../../../examples/profile-card-design.undesign"),
    },
    Example {
        file: "profile-card-prototype.undesign",
        title: tr_noop("Profile card prototype"),
        about: tr_noop("Prototype: follow and save actions connect three profile states"),
        motion: false,
        bytes: include_bytes!("../../../examples/profile-card-prototype.undesign"),
    },
];

/// The pictures, read one per frame so opening Home never stalls on decoding them all.
#[derive(Default)]
pub struct Pictures {
    shown: Vec<Option<TextureHandle>>,
    read: usize,
}

impl Pictures {
    /// The textures of the pictures read so far (tests tell them from the recent files' pictures).
    #[cfg(test)]
    pub(crate) fn texture_ids(&self) -> Vec<egui::TextureId> {
        self.shown.iter().flatten().map(TextureHandle::id).collect()
    }

    fn step(&mut self, ctx: &egui::Context) {
        if self.shown.len() != EXAMPLES.len() {
            self.shown = vec![None; EXAMPLES.len()];
            self.read = 0;
        }
        let Some(example) = EXAMPLES.get(self.read) else { return };
        let preview = undesign_format::thumbnail::archive_preview(std::io::Cursor::new(example.bytes), 480);
        if let (Some(picture), Some(slot)) = (preview.picture, self.shown.get_mut(self.read)) {
            let size = [picture.width as usize, picture.height as usize];
            if picture.rgba.len() == size[0] * size[1] * 4 {
                let image = egui::ColorImage::from_rgba_unmultiplied(size, &picture.rgba);
                *slot = Some(ctx.load_texture(format!("home-example-{}", example.file), image, egui::TextureOptions::LINEAR));
            }
        }
        self.read += 1;
        if self.read < EXAMPLES.len() {
            ctx.request_repaint();
        }
    }
}

/// The Examples section: a card per example; a click (or Enter on a focused card) opens it.
pub fn section(app: &mut FigApp, ui: &mut Ui, t: &Tokens) {
    app.ui.home_view.examples.step(ui.ctx());
    ui.add_space(28.0);
    ui.label(egui::RichText::new(tr("Examples")).font(semibold(12.0)).color(t.text_secondary));
    ui.add_space(4.0);
    ui.label(
        egui::RichText::new(tr("Built into the app. Each opens as a new copy; the original stays as it is."))
            .font(regular(11.5))
            .color(t.text_secondary),
    );
    ui.add_space(12.0);
    let (columns, card_w) = crate::home_recents::grid_columns(ui.available_width());
    let picture_h = (card_w * 9.0 / 16.0).round();
    let card_h = picture_h + 64.0;
    let gap = crate::home_recents::GAP;
    let mut open = None;
    for (row, chunk) in EXAMPLES.chunks(columns.max(1)).enumerate() {
        let (r, _) = ui.allocate_exact_size(vec2(ui.available_width(), card_h), Sense::hover());
        for (i, example) in chunk.iter().enumerate() {
            let index = row * columns.max(1) + i;
            let rect = Rect::from_min_size(pos2(r.min.x + i as f32 * (card_w + gap), r.min.y), vec2(card_w, card_h));
            let resp = ui.interact(rect, ui.id().with(("home_example", example.file)), Sense::click());
            let title = tr(example.title);
            let about = tr(example.about);
            a11y::button(&resp, &format!("{title}, {about}"));
            let hover = resp.hovered() || resp.has_focus();
            ui.painter().rect_filled(rect, CornerRadius::same(8), if hover { t.hover } else { t.panel });
            ui.painter().rect_stroke(rect, CornerRadius::same(8), Stroke::new(1.0, t.border), StrokeKind::Inside);
            if resp.has_focus() {
                ui.painter().rect_stroke(rect, CornerRadius::same(8), Stroke::new(2.0, t.focus), StrokeKind::Outside);
            }
            let picture = Rect::from_min_size(rect.min + vec2(1.0, 1.0), vec2(card_w - 2.0, picture_h));
            ui.painter().rect_filled(picture, CornerRadius { nw: 7, ne: 7, sw: 0, se: 0 }, t.field);
            if let Some(Some(texture)) = app.ui.home_view.examples.shown.get(index) {
                let size = texture.size_vec2();
                let scale = (picture.width() / size.x).min(picture.height() / size.y);
                let shown = Rect::from_center_size(picture.center(), size * scale);
                ui.painter().image(texture.id(), shown, Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)), Color32::WHITE);
            }
            ui.painter().line_segment([picture.left_bottom(), picture.right_bottom()], Stroke::new(1.0, t.border));
            let text_w = card_w - 24.0;
            let shown_title = crate::widgets::elide_font(ui, title, text_w, semibold(12.0));
            ui.painter().text(pos2(rect.min.x + 12.0, picture.max.y + 18.0), Align2::LEFT_CENTER, shown_title, semibold(12.0), t.text);
            let galley = ui.painter().layout(about.to_string(), regular(11.0), t.text_secondary, text_w);
            let clip = Rect::from_min_max(pos2(rect.min.x + 12.0, picture.max.y + 30.0), pos2(rect.max.x - 12.0, rect.max.y - 4.0));
            ui.painter().with_clip_rect(clip).galley(clip.min, galley, t.text_secondary);
            if resp.clicked() {
                open = Some(example);
            }
        }
        ui.add_space(gap);
    }
    if let Some(example) = open {
        self::open(app, example.name(), false);
    }
}
