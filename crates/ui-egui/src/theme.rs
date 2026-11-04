//! Design tokens (UI3 light and dark) and fonts.
//!
//! Shared surface radii (points): panels 20, inputs 12, numeric controls 8. Small controls retain
//! their compact radii; full-round pills and circular swatches use half their height.

use std::sync::{Arc, OnceLock};

use egui::{Color32, Context, FontData, FontDefinitions, FontFamily, FontId, Stroke, TextStyle, Visuals};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tokens {
    pub dark: bool,
    pub bg: Color32,
    pub panel: Color32,
    pub canvas: Color32,
    pub border: Color32,
    pub border_strong: Color32,
    pub control_border: Color32,
    pub text: Color32,
    pub text_secondary: Color32,
    /// Dim text: disabled controls, placeholders, hints. At least 3:1 against the panels, fields
    /// and selected rows, yet dimmer than `text_secondary`.
    pub text_tertiary: Color32,
    pub icon: Color32,
    pub icon_secondary: Color32,
    pub hover: Color32,
    pub pressed: Color32,
    pub field: Color32,
    pub field_hover_border: Color32,
    pub accent: Color32,
    pub accent_hover: Color32,
    pub accent_on: Color32,
    pub accent_text: Color32,
    pub selected_row: Color32,
    pub selected_row_child: Color32,
    pub component: Color32,
    pub component_row: Color32,
    pub danger: Color32,
    pub success: Color32,
    pub warning: Color32,
    pub guide: Color32,
    pub tab_bar: Color32,
    pub tab_active: Color32,
    pub shadow: Color32,
    pub menu: Color32,
    pub menu_text: Color32,
    pub menu_hover: Color32,
    pub menu_dim: Color32,
    /// The ring around the control with the keyboard (keyboard navigation): at least 3:1 against
    /// the panels and the canvas.
    pub focus: Color32,
}

/// Shared corner-radius tokens from the UI spec, in points.
pub const PANEL_RADIUS: u8 = 12;
pub const INPUT_RADIUS: u8 = 5;
pub const NUMERIC_RADIUS: u8 = 5;

/// Light grayscale surface used for brand marks and canvas overlays on dark pages.
pub const BRAND: Color32 = Color32::from_rgb(0xD8, 0xD8, 0xD8);
/// Contrast-safe dark grayscale for selection outlines and labels on light surfaces.
pub const ACCENT: Color32 = Color32::from_rgb(0x44, 0x44, 0x44);
/// Ink on the light grayscale brand surface.
pub const ACCENT_ON: Color32 = Color32::from_rgb(0x17, 0x17, 0x17);
/// Id of the canvas overlay grayscale selected for this frame ([`set_canvas_page`]).
const CANVAS_ACCENT: &str = "undesign-canvas-accent";

/// Remember the page colour the canvas shows. Its overlays (outlines, handles, arrows) take
/// whichever grayscale contrasts more with it: the lighter one on a dark page, the darker on a light one.
pub fn set_canvas_page(ctx: &Context, page: Color32) {
    let pick = if c(BRAND).contrast(c(page)) > c(ACCENT).contrast(c(page)) { BRAND } else { ACCENT };
    ctx.data_mut(|d| d.insert_temp(egui::Id::new(CANVAS_ACCENT), pick));
}

/// `x` (opaque) as a document colour, for its contrast with another.
fn c(x: Color32) -> undesign_color::Color {
    undesign_color::Color::new(f32::from(x.r()) / 255.0, f32::from(x.g()) / 255.0, f32::from(x.b()) / 255.0, 1.0)
}

/// The neutral overlay color drawn on the page ([`set_canvas_page`]); [`ACCENT`] before a page shows.
pub fn canvas_accent(ctx: &Context) -> Color32 {
    ctx.data(|d| d.get_temp(egui::Id::new(CANVAS_ACCENT))).unwrap_or(ACCENT)
}

/// A darker fill under white text when the light grayscale brand surface is used.
pub fn under_white(c: Color32) -> Color32 {
    if c == BRAND { ACCENT } else { c }
}

pub const COMPONENT: Color32 = Color32::from_rgb(0x85, 0x85, 0x85);
/// Handoff status badges (white text on these, in both themes).
pub const DEV_READY: Color32 = Color32::from_rgb(0x66, 0x66, 0x66);
pub const DEV_CHANGED: Color32 = Color32::from_rgb(0x55, 0x55, 0x55);
pub const DEV_COMPLETED: Color32 = Color32::from_rgb(0x70, 0x70, 0x70);

impl Tokens {
    pub fn light() -> Self {
        Self {
            dark: false,
            bg: Color32::from_rgb(0xFF, 0xFF, 0xFF),
            panel: Color32::from_rgb(0xFF, 0xFF, 0xFF),
            canvas: Color32::from_rgb(0xF4, 0xF4, 0xF4),
            border: Color32::from_rgb(0xDC, 0xDC, 0xDC),
            border_strong: Color32::from_rgb(0xC2, 0xC2, 0xC2),
            control_border: Color32::from_rgb(0x7C, 0x7C, 0x7C),
            text: Color32::from_rgb(0x18, 0x18, 0x18),
            text_secondary: Color32::from_rgb(0x59, 0x59, 0x59),
            text_tertiary: Color32::from_rgb(0x62, 0x62, 0x62),
            icon: Color32::from_rgb(0x18, 0x18, 0x18),
            icon_secondary: Color32::from_rgb(0x59, 0x59, 0x59),
            hover: Color32::from_rgb(0xEF, 0xEF, 0xEF),
            pressed: Color32::from_rgb(0xE7, 0xE7, 0xE7),
            field: Color32::from_rgb(0xF8, 0xF8, 0xF8),
            field_hover_border: Color32::from_rgb(0x7C, 0x7C, 0x7C),
            accent: Color32::from_rgb(0x36, 0x36, 0x36),
            accent_hover: Color32::from_rgb(0x24, 0x24, 0x24),
            accent_on: Color32::WHITE,
            accent_text: Color32::from_rgb(0x34, 0x34, 0x34),
            selected_row: Color32::from_rgb(0xE8, 0xE8, 0xE8),
            selected_row_child: Color32::from_rgb(0xF4, 0xF4, 0xF4),
            component: COMPONENT,
            component_row: Color32::from_rgb(0xF1, 0xF1, 0xF1),
            danger: Color32::from_rgb(0x5F, 0x5F, 0x5F),
            success: DEV_READY,
            warning: Color32::from_rgb(0x70, 0x70, 0x70),
            guide: Color32::from_rgb(0x5F, 0x5F, 0x5F),
            tab_bar: Color32::from_rgb(0xF8, 0xF8, 0xF8),
            tab_active: Color32::from_rgb(0xFF, 0xFF, 0xFF),
            shadow: Color32::from_rgba_unmultiplied(0x00, 0x00, 0x00, 20),
            menu: Color32::from_rgb(0xFF, 0xFF, 0xFF),
            menu_text: Color32::from_rgb(0x18, 0x18, 0x18),
            menu_hover: Color32::from_rgb(0xE8, 0xE8, 0xE8),
            menu_dim: Color32::from_rgb(0x62, 0x62, 0x62),
            focus: Color32::from_rgb(0x44, 0x44, 0x44),
        }
    }

    pub fn dark() -> Self {
        Self {
            dark: true,
            bg: Color32::from_rgb(0x1B, 0x1B, 0x1B),
            panel: Color32::from_rgb(0x1D, 0x1D, 0x1D),
            canvas: Color32::from_rgb(0x15, 0x15, 0x15),
            border: Color32::from_rgb(0x3B, 0x3B, 0x3B),
            border_strong: Color32::from_rgb(0x59, 0x59, 0x59),
            control_border: Color32::from_rgb(0x73, 0x73, 0x73),
            text: Color32::from_rgb(0xF2, 0xF2, 0xF2),
            text_secondary: Color32::from_rgb(0xBE, 0xBE, 0xBE),
            text_tertiary: Color32::from_rgb(0xA7, 0xA7, 0xA7),
            icon: Color32::from_rgb(0xF2, 0xF2, 0xF2),
            icon_secondary: Color32::from_rgb(0xBE, 0xBE, 0xBE),
            hover: Color32::from_rgb(0x2A, 0x2A, 0x2A),
            pressed: Color32::from_rgb(0x31, 0x31, 0x31),
            field: Color32::from_rgb(0x20, 0x20, 0x20),
            field_hover_border: Color32::from_rgb(0x73, 0x73, 0x73),
            accent: Color32::from_rgb(0xD9, 0xD9, 0xD9),
            accent_hover: Color32::from_rgb(0xF0, 0xF0, 0xF0),
            accent_on: Color32::from_rgb(0x18, 0x18, 0x18),
            accent_text: Color32::from_rgb(0xE0, 0xE0, 0xE0),
            selected_row: Color32::from_rgb(0x33, 0x33, 0x33),
            selected_row_child: Color32::from_rgb(0x29, 0x29, 0x29),
            component: COMPONENT,
            component_row: Color32::from_rgb(0x2C, 0x2C, 0x2C),
            danger: Color32::from_rgb(0xB0, 0xB0, 0xB0),
            success: DEV_READY,
            warning: Color32::from_rgb(0xA0, 0xA0, 0xA0),
            guide: Color32::from_rgb(0xB0, 0xB0, 0xB0),
            tab_bar: Color32::from_rgb(0x20, 0x20, 0x20),
            tab_active: Color32::from_rgb(0x24, 0x24, 0x24),
            shadow: Color32::from_black_alpha(61),
            menu: Color32::from_rgb(0x24, 0x24, 0x24),
            menu_text: Color32::from_rgb(0xF2, 0xF2, 0xF2),
            menu_hover: Color32::from_rgb(0x2A, 0x2A, 0x2A),
            menu_dim: Color32::from_rgb(0xA7, 0xA7, 0xA7),
            focus: Color32::from_rgb(0xF0, 0xF0, 0xF0),
        }
    }

    pub fn get(ctx: &Context) -> Tokens {
        ctx.data(|d| d.get_temp::<Tokens>(tokens_id())).unwrap_or_else(Tokens::light)
    }
}

fn tokens_id() -> egui::Id {
    egui::Id::new("undesign_tokens")
}

/// egui's default for how long hover fades and openings animate.
const ANIMATION_TIME: f32 = 0.2;

/// Install tokens and egui visuals.
pub fn apply(ctx: &Context, t: Tokens) {
    apply_with(ctx, t, false);
}

/// [`apply`], with egui's own animations (hover fades, openings, smooth scrolling to a target) off
/// when the system or the preferences ask for reduced motion. Prototype transitions still play.
pub fn apply_with(ctx: &Context, t: Tokens, reduce_motion: bool) {
    ctx.data_mut(|d| d.insert_temp(tokens_id(), t));
    ctx.set_visuals(visuals(t));
    ctx.global_style_mut(|s| {
        s.spacing.item_spacing = egui::vec2(8.0, 6.0);
        s.spacing.button_padding = egui::vec2(8.0, 4.0);
        s.spacing.interact_size = egui::vec2(24.0, 24.0);
        s.spacing.menu_margin = egui::Margin::same(8);
        s.spacing.window_margin = egui::Margin::same(12);
        s.text_styles = [
            (TextStyle::Small, FontId::new(10.0, FontFamily::Proportional)),
            (TextStyle::Body, FontId::new(11.0, FontFamily::Proportional)),
            (TextStyle::Button, FontId::new(11.0, FontFamily::Proportional)),
            (TextStyle::Heading, FontId::new(13.0, FontFamily::Name("semibold".into()))),
            (TextStyle::Monospace, FontId::new(11.0, FontFamily::Monospace)),
        ]
        .into();
        s.interaction.tooltip_delay = 0.4;
        s.animation_time = if reduce_motion { 0.0 } else { ANIMATION_TIME };
        s.scroll_animation = if reduce_motion { egui::style::ScrollAnimation::none() } else { egui::style::ScrollAnimation::default() };
    });
}

/// egui visuals for tokens `t`.
fn visuals(t: Tokens) -> Visuals {
    let mut v = if t.dark { Visuals::dark() } else { Visuals::light() };
    v.panel_fill = t.panel;
    v.window_fill = t.panel;
    v.extreme_bg_color = t.field;
    v.faint_bg_color = t.hover;
    v.override_text_color = Some(t.text);
    v.window_stroke = Stroke::new(1.0, t.border);
    v.window_corner_radius = egui::CornerRadius::same(PANEL_RADIUS);
    v.menu_corner_radius = egui::CornerRadius::same(INPUT_RADIUS);
    v.selection.bg_fill = t.selected_row;
    // Also the color of selected text on that highlight (and a focused text box's outline): use
    // the theme's high-contrast neutral token in both modes.
    v.selection.stroke = Stroke::new(1.0, t.accent_text);
    v.hyperlink_color = t.accent_text;
    for w in [&mut v.widgets.inactive, &mut v.widgets.hovered, &mut v.widgets.active, &mut v.widgets.open, &mut v.widgets.noninteractive] {
        w.corner_radius = egui::CornerRadius::same(5);
        w.fg_stroke = Stroke::new(1.0, t.text);
    }
    v.widgets.noninteractive.bg_stroke = Stroke::new(1.0, t.border);
    v.widgets.noninteractive.bg_fill = t.panel;
    v.widgets.inactive.bg_fill = t.field;
    v.widgets.inactive.weak_bg_fill = Color32::TRANSPARENT;
    v.widgets.inactive.bg_stroke = Stroke::new(1.0, t.control_border);
    v.widgets.hovered.bg_fill = t.hover;
    v.widgets.hovered.weak_bg_fill = t.hover;
    v.widgets.hovered.bg_stroke = Stroke::new(1.0, t.control_border);
    v.widgets.active.bg_fill = t.pressed;
    v.widgets.active.weak_bg_fill = t.pressed;
    v.widgets.active.bg_stroke = Stroke::new(1.0, t.accent);
    v.popup_shadow = egui::Shadow { offset: [0, 4], blur: 16, spread: 0, color: t.shadow };
    v.window_shadow = egui::Shadow { offset: [0, 8], blur: 24, spread: 0, color: t.shadow };
    v.text_cursor.stroke = Stroke::new(1.0, t.focus);
    v
}

/// Draw `f` with the dark tokens and visuals: controls on the dark popovers (the style browser's
/// style editor), whichever theme the app shows.
pub fn on_dark<R>(ui: &mut egui::Ui, f: impl FnOnce(&mut egui::Ui) -> R) -> R {
    let ctx = ui.ctx().clone();
    let saved = Tokens::get(&ctx);
    let dark = Tokens::dark();
    ctx.data_mut(|d| d.insert_temp(tokens_id(), dark));
    let r = ui
        .scope(|ui| {
            *ui.visuals_mut() = visuals(dark);
            f(ui)
        })
        .inner;
    ctx.data_mut(|d| d.insert_temp(tokens_id(), saved));
    r
}

/// UI fonts: Inter and the Archivo wordmark (from the craft-fonts build input) when present;
/// otherwise egui's defaults. With
/// `system`, also system faces for scripts those lack (Hebrew, joined Arabic) so names in them show,
/// and faces for the CJK scripts in `cjk` ([`crate::cjk`]).
pub fn install_fonts(ctx: &Context, system: bool, cjk: u8) {
    let mut fonts = FontDefinitions::default();
    let find = |family: &str, style: &str| undesign_text::CRAFT_FONTS.iter().find(|f| f.family == family && f.style == style).map(|f| f.bytes);
    let regular = find("Inter", "Regular");
    let semibold = find("Inter", "SemiBold").or_else(|| find("Inter", "Bold"));
    if let Some(r) = regular {
        fonts.font_data.insert("inter".into(), Arc::new(FontData::from_static(r)));
        if let Some(list) = fonts.families.get_mut(&FontFamily::Proportional) {
            list.insert(0, "inter".into());
        }
    }
    let sb_name = if let Some(sb) = semibold {
        fonts.font_data.insert("inter-semibold".into(), Arc::new(FontData::from_static(sb)));
        "inter-semibold"
    } else {
        "inter"
    };
    let mut semi: Vec<String> = Vec::new();
    if fonts.font_data.contains_key(sb_name) {
        semi.push(sb_name.into());
    }
    semi.extend(fonts.families.get(&FontFamily::Proportional).cloned().unwrap_or_default());
    fonts.families.insert(FontFamily::Name("semibold".into()), semi);
    // Keep the logo's typeface independent of UI text. System Archivo is used when available;
    // releases with craft-fonts embed it so the wordmark does not depend on installation.
    let archivo = find("Archivo", "SemiBold").map(FontData::from_static).or_else(|| {
        system.then(|| undesign_text::find_face("Archivo", "SemiBold")).flatten().filter(|face| face.family == "Archivo").map(|face| font_data(&face))
    });
    let mut brand = Vec::new();
    if let Some(data) = archivo {
        fonts.font_data.insert("archivo".into(), Arc::new(data));
        brand.push("archivo".into());
    }
    brand.extend(fonts.families.get(&FontFamily::Name("semibold".into())).cloned().unwrap_or_default());
    fonts.families.insert(FontFamily::Name("brand".into()), brand);
    // CJK and other scripts from craft-fonts as fallbacks (Noto Sans CJK only with UNDESIGN_EMBED_CJK).
    const BUILT_IN: [&str; 5] = ["Inter", "BIZ UDPGothic", "Noto Sans CJK SC", "Noto Sans Arabic", "Noto Sans Georgian"];
    let lang = crate::i18n::current().map_or("en", |l| l.code);
    // A Chinese UI draws Han in a Chinese face: the built-in Japanese one goes after the system faces.
    let late = |family: &str| family == "BIZ UDPGothic" && crate::cjk::language(lang) == crate::cjk::HAN;
    let craft = |last: bool| {
        undesign_text::CRAFT_FONTS
            .iter()
            .filter(move |f| f.family != "Inter" && f.style == "Regular" && BUILT_IN.contains(&f.family) && late(f.family) == last)
            .map(|f| (format!("craft-{}", f.family), FontData::from_static(f.bytes)))
    };
    let mut extra: Vec<(String, FontData)> = craft(false).collect();
    if system {
        // What the built-in faces above already draw.
        let embedded = |c: char| {
            BUILT_IN
                .into_iter()
                .filter(|f| !late(f) && undesign_text::CRAFT_FONTS.iter().any(|cf| cf.family == *f))
                .filter_map(|f| undesign_text::find_face(f, "Regular"))
                .any(|x| x.has_char(c))
        };
        let mut taken = Vec::new();
        extra.extend(crate::bidi::script_fallbacks(&embedded, &mut taken));
        extra.extend(key_symbol_fallbacks(&embedded, &mut taken));
        extra.extend(crate::cjk::faces(cjk, lang, &embedded).iter().map(|f| (format!("system-{}-{}", f.family, f.style), font_data(f))));
    }
    extra.extend(craft(true));
    for (key, data) in extra {
        fonts.font_data.insert(key.clone(), Arc::new(data));
        for fam in [FontFamily::Proportional, FontFamily::Name("semibold".into())] {
            if let Some(list) = fonts.families.get_mut(&fam) {
                list.push(key.clone());
            }
        }
    }
    ctx.set_fonts(fonts);
}

/// The glyphs macOS shortcuts are written with ([`undesign_engine::keymap::display`]).
const KEY_SYMBOLS: &str = "⌃⌥⇧⌘⌫↵⇥⇞⇟←→↑↓";
/// System families that have them, in order of preference.
const KEY_FAMILIES: [&str; 6] = ["Lucida Grande", "Apple Symbols", "Segoe UI Symbol", "DejaVu Sans", "Noto Sans Symbols 2", "FreeSans"];

/// System faces for the shortcut glyphs the UI's own fonts lack (egui's default face has ⌘ but
/// not ⌥ or ↵); `taken` as for [`system_fallbacks`].
fn key_symbol_fallbacks(have: &dyn Fn(char) -> bool, taken: &mut Vec<Arc<undesign_text::Face>>) -> Vec<(String, FontData)> {
    system_fallbacks(KEY_SYMBOLS.chars(), &KEY_FAMILIES, have, taken)
}

/// System faces, the first of `families` that has each, for the `samples` neither the UI's own
/// fonts (`have`) nor the faces already `taken` draw. Each face found joins `taken`, so a face that
/// several lists name is added once.
pub(crate) fn system_fallbacks(
    samples: impl IntoIterator<Item = char>,
    families: &[&str],
    have: &dyn Fn(char) -> bool,
    taken: &mut Vec<Arc<undesign_text::Face>>,
) -> Vec<(String, FontData)> {
    let mut out = Vec::new();
    for c in samples {
        if have(c) || taken.iter().any(|f| f.has_char(c)) {
            continue;
        }
        let Some(face) = undesign_text::face_with_char(c, families) else { continue };
        out.push((format!("system-{}-{}", face.family, face.style), font_data(&face)));
        taken.push(face);
    }
    out
}

/// egui font data over a face's bytes, without copying them (CJK faces are 10–20 MB). Font
/// database faces are never dropped, so a system face's shared bytes are kept for good: leaking
/// one more reference to them costs a pointer and gives egui the `'static` slice it needs.
pub fn font_data(face: &undesign_text::Face) -> FontData {
    let bytes: &'static [u8] = match &face.bytes {
        undesign_text::fontdb::FontBytes::Static(b) => b,
        undesign_text::fontdb::FontBytes::Shared(v) => Box::leak(Box::new(v.clone())).as_slice(),
    };
    let mut data = FontData::from_static(bytes);
    data.index = face.index;
    data
}

pub fn semibold(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name("semibold".into()))
}

pub fn brand(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name("brand".into()))
}

/// The two-tone Archivo wordmark used in the home sidebar and About window.
pub fn paint_wordmark(painter: &egui::Painter, left_center: egui::Pos2, size: f32, t: &Tokens) {
    let font = brand(size);
    let un = painter.layout_no_wrap("Un".into(), font.clone(), t.text);
    let un_width = un.size().x;
    painter.galley(egui::pos2(left_center.x, left_center.y - un.size().y / 2.0), un, t.text);
    painter.text(egui::pos2(left_center.x + un_width, left_center.y), egui::Align2::LEFT_CENTER, "design", font, t.accent_text);
}

/// Paint the monochrome app icon from the neutral app asset.
pub fn paint_app_icon(ui: &egui::Ui, rect: egui::Rect) {
    static ICON: OnceLock<Option<egui::ColorImage>> = OnceLock::new();
    let image = ICON.get_or_init(|| {
        let rgba = image::load_from_memory(include_bytes!("../../../assets/app-icon/undesign-64-mono.png")).ok()?.to_rgba8();
        Some(egui::ColorImage::from_rgba_unmultiplied([rgba.width() as usize, rgba.height() as usize], rgba.as_raw()))
    });
    let Some(image) = image else {
        ui.painter().rect_filled(rect, egui::CornerRadius::same(5), BRAND);
        crate::icons::paint(ui.painter(), rect.shrink(rect.width() * 0.22), crate::icons::Icon::Logo, ACCENT_ON);
        return;
    };
    let id = egui::Id::new("undesign_monochrome_app_icon");
    let texture = ui.ctx().data(|data| data.get_temp::<egui::TextureHandle>(id)).unwrap_or_else(|| {
        let texture = ui.ctx().load_texture("undesign-monochrome-app-icon", image.clone(), egui::TextureOptions::LINEAR);
        ui.ctx().data_mut(|data| data.insert_temp(id, texture.clone()));
        texture
    });
    ui.painter().image(texture.id(), rect, egui::Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)), Color32::WHITE);
}

pub fn regular(size: f32) -> FontId {
    FontId::new(size, FontFamily::Proportional)
}

pub fn c32(c: undesign_color::Color) -> Color32 {
    let [r, g, b, a] = c.to_rgba8();
    Color32::from_rgba_unmultiplied(r, g, b, a)
}

fn screen_conversion_id() -> egui::Id {
    egui::Id::new("undesign_screen_conversion")
}

/// Remember the colour profile of the document on screen (once per frame): document colours drawn
/// by the UI ([`doc_c32`]) go from it to the screen's sRGB.
pub fn set_doc_profile(ctx: &Context, profile: undesign_color::ColorProfile) {
    let conv = profile.conversion_to(undesign_color::ColorProfile::Srgb);
    ctx.data_mut(|d| d.insert_temp(screen_conversion_id(), conv));
}

/// A document colour (a paint, swatch, background) for the screen: converted from the document's
/// colour profile to sRGB. UI chrome colours use [`c32`].
pub fn doc_c32(ctx: &Context, c: undesign_color::Color) -> Color32 {
    let conv = ctx.data(|d| d.get_temp::<undesign_color::ProfileConversion>(screen_conversion_id()));
    c32(conv.map_or(c, |k| k.apply(c)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ui_radius_tokens_match_the_reference_scale() {
        assert_eq!(PANEL_RADIUS, 12);
        assert_eq!(INPUT_RADIUS, 5);
        assert_eq!(NUMERIC_RADIUS, 5);
        let light = visuals(Tokens::light());
        assert_eq!(light.window_corner_radius, egui::CornerRadius::same(PANEL_RADIUS));
        assert_eq!(light.menu_corner_radius, egui::CornerRadius::same(INPUT_RADIUS));
    }

    #[test]
    fn canvas_overlays_choose_the_grayscale_with_stronger_contrast() {
        let ctx = Context::default();
        assert_eq!(canvas_accent(&ctx), ACCENT, "before any page shows");
        set_canvas_page(&ctx, Color32::from_rgb(0x1E, 0x1E, 0x1E));
        assert_eq!(canvas_accent(&ctx), BRAND, "the lighter gray on a dark page");
        set_canvas_page(&ctx, Color32::WHITE);
        assert_eq!(canvas_accent(&ctx), ACCENT, "the darker gray on a light page");
        set_canvas_page(&ctx, Color32::from_rgb(0xF5, 0xF5, 0xF5));
        assert_eq!(canvas_accent(&ctx), ACCENT);
        // White text never sits on the light-gray brand fill.
        assert_eq!(under_white(BRAND), ACCENT);
        assert_eq!(under_white(COMPONENT), COMPONENT);
    }

    #[test]
    fn general_theme_tokens_are_grayscale_and_live_peer_colors_remain_independent() {
        for t in [Tokens::light(), Tokens::dark()] {
            let colors = [
                t.bg,
                t.panel,
                t.canvas,
                t.border,
                t.border_strong,
                t.control_border,
                t.text,
                t.text_secondary,
                t.text_tertiary,
                t.icon,
                t.icon_secondary,
                t.hover,
                t.pressed,
                t.field,
                t.field_hover_border,
                t.accent,
                t.accent_hover,
                t.accent_on,
                t.accent_text,
                t.selected_row,
                t.selected_row_child,
                t.component,
                t.component_row,
                t.danger,
                t.success,
                t.warning,
                t.guide,
                t.tab_bar,
                t.tab_active,
                t.shadow,
                t.menu,
                t.menu_text,
                t.menu_hover,
                t.menu_dim,
                t.focus,
            ];
            for color in colors {
                assert_eq!(color.r(), color.g(), "general UI token must be grayscale: {color:?}");
                assert_eq!(color.g(), color.b(), "general UI token must be grayscale: {color:?}");
            }
        }

        let peer = crate::live::color("#14AE5C");
        assert_eq!(peer, Color32::from_rgb(0x14, 0xAE, 0x5C));
        assert_ne!(peer, Tokens::light().accent, "live participant color stays separate from neutral UI chrome");
    }

    /// `fill` (premultiplied, maybe translucent) painted over the opaque `bg`.
    fn over(fill: Color32, bg: Color32) -> Color32 {
        let k = 1.0 - f32::from(fill.a()) / 255.0;
        let mix = |f: u8, b: u8| (f32::from(f) + f32::from(b) * k).round().min(255.0) as u8;
        Color32::from_rgb(mix(fill.r(), bg.r()), mix(fill.g(), bg.g()), mix(fill.b(), bg.b()))
    }

    #[test]
    fn disabled_and_selected_text_stay_readable_in_both_themes() {
        for t in [Tokens::light(), Tokens::dark()] {
            let theme = if t.dark { "dark" } else { "light" };
            // Disabled text (a disabled button's label, placeholders) on panels, fields and
            // selected rows, still dimmer than secondary text.
            for bg in [t.panel, t.field, t.hover, t.selected_row] {
                let ratio = c(t.text_tertiary).contrast(c(bg));
                assert!(ratio >= 3.0, "{theme}: dim text {:?} on {bg:?} is {ratio:.2}:1", t.text_tertiary);
                assert!(ratio < c(t.text_secondary).contrast(c(bg)), "{theme}: dim text reads dimmer than secondary text");
            }
            for bg in [t.field, t.hover] {
                let ratio = c(t.control_border).contrast(c(bg));
                assert!(ratio >= 3.0, "{theme}: control border {:?} on {bg:?} is {ratio:.2}:1", t.control_border);
            }
            // Selected text (renaming a page or layer, any text box) on the selection highlight.
            let v = visuals(t);
            for bg in [t.panel, t.field] {
                let highlight = over(v.selection.bg_fill, bg);
                let ratio = c(v.selection.stroke.color).contrast(c(highlight));
                assert!(ratio >= 3.0, "{theme}: selected text on {highlight:?} is {ratio:.2}:1");
            }
        }
    }

    #[test]
    fn ui_font_draws_every_mac_shortcut_glyph() {
        undesign_text::scan_system_fonts();
        let lacking: String = KEY_SYMBOLS.chars().filter(|c| undesign_text::face_with_char(*c, &KEY_FAMILIES).is_none()).collect();
        if !lacking.is_empty() {
            eprintln!("no system face here draws {lacking}; skipping");
            return;
        }
        let ctx = Context::default();
        install_fonts(&ctx, true, 0);
        let input =
            egui::RawInput { screen_rect: Some(egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(100.0, 100.0))), ..Default::default() };
        ctx.run_ui(input, |_| {}).textures_delta.clear();
        ctx.fonts_mut(|f| {
            for c in KEY_SYMBOLS.chars() {
                for font in [regular(11.0), semibold(11.0)] {
                    assert!(f.has_glyphs(&font, &c.to_string()), "UI font draws {c:?}");
                }
            }
        });
    }
}
