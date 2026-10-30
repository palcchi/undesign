//! Mobile app: four screens of an invented recipe app ("Simmer") built with auto layout
//! from three components (a button, a recipe card, a tab bar with two variants), linked into a
//! prototype flow.

use serde_json::json;
use undesign_doc::NodeId;

use super::glyphs::{self, Glyph};
use super::kit::*;
use crate::Result;

const W: f64 = 390.0;
const SCREEN_H: f64 = 844.0;
/// Space between screens on the canvas.
const GAP: f64 = 80.0;

/// The recipes on the Explore screen: (name, time and level).
const RECIPES: [(&str, &str); 3] =
    [("Charred leek soup", "35 min · Easy"), ("Miso-glazed aubergine", "25 min · Easy"), ("Rye and seed loaf", "3 h · Weekend")];

const TABS: [(&str, Glyph); 4] = [("Explore", glyphs::SEARCH), ("Saved", glyphs::BOOKMARK), ("Planned", glyphs::CALENDAR), ("Profile", glyphs::USER)];

struct Parts {
    button: NodeId,
    card: NodeId,
    tabs: NodeId,
}

pub(super) fn build(k: &mut Kit) -> Result<()> {
    k.foundations()?;
    k.rename_page("Screens")?;
    let screens = k.page()?;
    let page = k.add_page("Components")?;
    let parts = Parts { button: button(k, page)?, card: recipe_card(k, page)?, tabs: tab_bar(k, page)? };
    k.go(screens)?;
    let (welcome, start) = welcome(k, screens, &parts)?;
    let (explore, first_card, explore_tabs) = explore(k, screens, &parts)?;
    let (detail, back) = detail(k, screens, &parts)?;
    let (profile, profile_tabs) = profile(k, screens, &parts)?;
    for (from, to) in [(start, explore), (first_card, detail), (back, explore), (explore_tabs, profile), (profile_tabs, explore)] {
        k.link(from, to)?;
    }
    k.flow(welcome, "Onboarding")
}

fn button(k: &mut Kit, page: NodeId) -> Result<NodeId> {
    let props = json!({"fill": PRIMARY, "cornerRadius": 16, "mainAlign": "center", "crossAlign": "center"});
    let c = k.stack_of("component", page, "Button", H, 8.0, json!([16, 24, 16, 24]), props)?;
    let label = k.text(c, "Button", "Label/M", ON_BRAND)?;
    k.text_prop(c, "Label", "Button", &[label])?;
    Ok(c)
}

fn recipe_card(k: &mut Kit, page: NodeId) -> Result<NodeId> {
    let props =
        json!({"fill": CARD, "cornerRadius": 20, "crossAlign": "center", "effects": shadow(), "sizingH": "fixed", "width": W - 48.0, "y": 120});
    let c = k.stack_of("component", page, "Recipe card", H, 14.0, json!(12), props)?;
    k.scene(c, "Picture", [72.0, 72.0], json!({"cornerRadius": 14}))?;
    let words = k.stack(c, "Words", V, 2.0, json!(0), json!({"sizingH": "fill"}))?;
    let title = k.text(words, "Recipe name", "Heading/S", INK)?;
    let meta = k.text(words, "Time · Level", "Body/S", MUTED)?;
    k.icon(c, &glyphs::CHEVRON_RIGHT, 20.0, MUTED)?;
    k.text_prop(c, "Name", "Recipe name", &[title])?;
    k.text_prop(c, "Details", "Time · Level", &[meta])?;
    Ok(c)
}

/// The tab bar as a component set: one variant per tab the screens show as current.
fn tab_bar(k: &mut Kit, page: NodeId) -> Result<NodeId> {
    let mut variants = Vec::new();
    for (i, current) in ["Explore", "Profile"].into_iter().enumerate() {
        let props = json!({"fill": CARD, "stroke": BORDER, "strokeSides": TOP_EDGE, "sizingH": "fixed", "width": W, "y": 260.0 + i as f64 * 110.0});
        let bar = k.stack_of("component", page, &format!("Current={current}"), H, 0.0, json!([10, 12, 26, 12]), props)?;
        for (label, glyph) in &TABS {
            let color = if *label == current { PRIMARY } else { MUTED };
            let tab = k.stack(bar, label, V, 4.0, json!(0), json!({"sizingH": "fill", "crossAlign": "center"}))?;
            k.icon(tab, glyph, ICON, color)?;
            k.text(tab, label, "Label/S", color)?;
        }
        variants.push(bar);
    }
    k.variants("Tab bar", &variants, json!({}))
}

/// A screen: a phone-sized frame that stacks its content.
fn screen(k: &mut Kit, page: NodeId, name: &str, index: usize) -> Result<NodeId> {
    let props = json!({"fill": PAGE, "stroke": BORDER, "strokeWeight": 1, "strokeAlign": "outside", "clip": true, "sizingH": "fixed", "sizingV": "fixed", "width": W, "height": SCREEN_H, "x": index as f64 * (W + GAP)});
    k.stack(page, name, V, 0.0, json!(0), props)
}

/// The part of a screen above the tab bar or its last button: it takes the room that is left.
fn body(k: &mut Kit, screen: NodeId, gap: f64, top: f64) -> Result<NodeId> {
    k.stack(screen, "Content", V, gap, json!([top, 24, 24, 24]), json!({"sizingH": "fill", "sizingV": "fill"}))
}

fn welcome(k: &mut Kit, page: NodeId, parts: &Parts) -> Result<(NodeId, NodeId)> {
    let s = screen(k, page, "Welcome", 0)?;
    k.scene(s, "Picture", [W, 440.0], json!({"sizingH": "fill"}))?;
    let content = body(k, s, 0.0, 32.0)?;
    k.set(content, json!({"mainAlign": "spaceBetween"}))?;
    let words = k.stack(content, "Words", V, 12.0, json!(0), json!({"sizingH": "fill"}))?;
    k.text(words, "SIMMER", "Label/S", PRIMARY)?;
    k.para(words, "Dinner, decided", "Heading/L", INK)?;
    k.para(words, "Seasonal recipes with pantry-first shopping lists, tested twice in our own kitchen.", "Body/M", MUTED)?;
    let actions = k.stack(content, "Actions", V, 16.0, json!(0), json!({"sizingH": "fill", "crossAlign": "center"}))?;
    let start = k.instance(parts.button, actions, json!({"Label": "Get cooking"}), json!({"sizingH": "fill"}))?;
    k.text(actions, "I already have an account", "Label/M", PRIMARY)?;
    Ok((s, start))
}

fn avatar(k: &mut Kit, parent: NodeId, size: f64, style: &str) -> Result<NodeId> {
    let a = k.tile(parent, size, size / 2.0)?;
    k.text(a, "JP", style, PRIMARY)?;
    Ok(a)
}

fn explore(k: &mut Kit, page: NodeId, parts: &Parts) -> Result<(NodeId, NodeId, NodeId)> {
    let s = screen(k, page, "Explore", 1)?;
    let content = body(k, s, 20.0, 56.0)?;
    let header = k.stack(content, "Header", H, 12.0, json!(0), json!({"sizingH": "fill", "mainAlign": "spaceBetween", "crossAlign": "center"}))?;
    let hello = k.stack(header, "Greeting", V, 2.0, json!(0), json!({}))?;
    k.text(hello, "Good evening", "Body/S", MUTED)?;
    k.text(hello, "June Park", "Heading/M", INK)?;
    avatar(k, header, 44.0, "Label/M")?;
    let search_props = json!({"fill": CARD, "cornerRadius": 16, "stroke": BORDER, "strokeWeight": 1, "sizingH": "fill", "crossAlign": "center"});
    let search = k.stack(content, "Search", H, 10.0, json!([14, 16, 14, 16]), search_props)?;
    k.icon(search, &glyphs::SEARCH, 20.0, MUTED)?;
    k.text(search, "Search recipes and ingredients", "Body/M", MUTED)?;
    let filters = k.stack(content, "Filters", H, 8.0, json!(0), json!({}))?;
    for (i, label) in ["Under 30 min", "Vegetarian", "One pot", "Baking"].into_iter().enumerate() {
        let (color, fill) = if i == 0 { (ON_BRAND, PRIMARY) } else { (INK, SUNKEN) };
        k.chip(filters, label, ["Label/M", color], fill, [8.0, 16.0], 999.0)?;
    }
    let title =
        k.stack(content, "Section title", H, 8.0, json!(0), json!({"sizingH": "fill", "mainAlign": "spaceBetween", "crossAlign": "center"}))?;
    k.text(title, "Popular this week", "Heading/S", INK)?;
    k.text(title, "See all", "Label/M", PRIMARY)?;
    let list = k.stack(content, "Recipes", V, 12.0, json!(0), json!({"sizingH": "fill"}))?;
    let mut first = None;
    for (name, details) in RECIPES {
        let card = k.instance(parts.card, list, json!({"Name": name, "Details": details}), json!({"sizingH": "fill"}))?;
        first.get_or_insert(card);
    }
    let tabs = k.instance(parts.tabs, s, json!({"Current": "Explore"}), json!({"sizingH": "fill"}))?;
    Ok((s, first.unwrap_or(list), tabs))
}

fn detail(k: &mut Kit, page: NodeId, parts: &Parts) -> Result<(NodeId, NodeId)> {
    let s = screen(k, page, "Recipe", 2)?;
    k.scene(s, "Picture", [W, 300.0], json!({"sizingH": "fill"}))?;
    let back = k.tile(s, 44.0, 22.0)?;
    k.set(back, json!({"name": "Back", "fill": CARD, "absolute": true, "x": 20, "y": 52}))?;
    k.icon(back, &glyphs::ARROW_LEFT, 20.0, INK)?;
    let content = body(k, s, 20.0, 24.0)?;
    k.set(content, json!({"mainAlign": "spaceBetween"}))?;
    let about = k.stack(content, "About", V, 16.0, json!(0), json!({"sizingH": "fill"}))?;
    let heading = k.stack(about, "Heading", V, 6.0, json!(0), json!({"sizingH": "fill"}))?;
    let [(name, _), ..] = RECIPES;
    k.para(heading, name, "Heading/L", INK)?;
    let place = k.stack(heading, "Place", H, 6.0, json!(0), json!({"crossAlign": "center"}))?;
    k.icon(place, &glyphs::PIN, 16.0, MUTED)?;
    k.text(place, "From our test farm", "Body/M", MUTED)?;
    let stats = k.stack(about, "Figures", H, 10.0, json!(0), json!({"sizingH": "fill"}))?;
    for (value, label) in [("35 min", "Time"), ("4", "Serves"), ("Easy", "Level")] {
        k.stat(stats, value, label, "Heading/S")?;
    }
    k.text(about, "About this recipe", "Heading/S", INK)?;
    k.para(about, "Leeks scorched until sweet, blended with potato and finished with brown butter. The leeks grow two streets from our kitchen, so this one is on the menu all winter.", "Body/M", MUTED)?;
    k.instance(parts.button, content, json!({"Label": "Start cooking"}), json!({"sizingH": "fill"}))?;
    Ok((s, back))
}

fn profile(k: &mut Kit, page: NodeId, parts: &Parts) -> Result<(NodeId, NodeId)> {
    let s = screen(k, page, "Profile", 3)?;
    let content = body(k, s, 24.0, 72.0)?;
    let who = k.stack(content, "Who", V, 6.0, json!(0), json!({"sizingH": "fill", "crossAlign": "center"}))?;
    avatar(k, who, 88.0, "Heading/M")?;
    k.text(who, "June Park", "Heading/M", INK)?;
    k.text(who, "Cooking since 2023 · Northfork", "Body/M", MUTED)?;
    let stats = k.stack(content, "Figures", H, 10.0, json!(0), json!({"sizingH": "fill"}))?;
    for (value, label) in [("214", "Cooked"), ("38", "Planned"), ("12", "Shared")] {
        k.stat(stats, value, label, "Heading/S")?;
    }
    let menu = k.stack(content, "Menu", V, 0.0, json!([4, 16, 4, 16]), json!({"fill": CARD, "cornerRadius": 20, "sizingH": "fill"}))?;
    for (label, glyph) in
        [("Saved recipes", glyphs::BOOKMARK), ("Meal planner", glyphs::CALENDAR), ("Notifications", glyphs::BELL), ("Settings", glyphs::SLIDERS)]
    {
        let row = k.stack(menu, label, H, 12.0, json!([14, 0, 14, 0]), json!({"sizingH": "fill", "crossAlign": "center"}))?;
        k.icon(row, &glyph, 20.0, PRIMARY)?;
        k.text_with(row, label, "Body/M", INK, json!({"sizingH": "fill"}))?;
        k.icon(row, &glyphs::CHEVRON_RIGHT, 16.0, MUTED)?;
    }
    let tabs = k.instance(parts.tabs, s, json!({"Current": "Profile"}), json!({"sizingH": "fill"}))?;
    Ok((s, tabs))
}
