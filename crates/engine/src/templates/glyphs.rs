//! Original icons for the starter templates: each is one outline drawn for Undesign from straight
//! lines, arcs and simple curves on a 24 px grid (2 px margin, 2 px round strokes).

/// An icon: its name and its outline as SVG path data on the 24 px grid.
pub(super) struct Glyph {
    pub name: &'static str,
    pub path: &'static str,
}

macro_rules! glyphs {
    ($($id:ident $name:literal $path:literal)*) => {
        $(pub(super) const $id: Glyph = Glyph { name: $name, path: $path };)*
        /// Every icon, in the order the icon set lays them out.
        pub(super) const ALL: &[Glyph] = &[$($id),*];
    };
}

glyphs! {
    HOME "Home" "M4 11 L12 4 L20 11 V20 H4 Z M10 20 V14 H14 V20 M17 5.5 V9"
    SEARCH "Search" "M4.5 10.5 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 M15 15 L20.5 20.5"
    USER "User" "M8.5 8.5 a3.5 3.5 0 1 0 7 0 a3.5 3.5 0 1 0 -7 0 M5 20 C5 15.5 8 13.5 12 13.5 C16 13.5 19 15.5 19 20"
    BELL "Bell" "M7 16 V10.5 C7 7 9.5 4.5 12 4.5 C14.5 4.5 17 7 17 10.5 V16 L18.5 18.5 H5.5 Z M10 20.5 C10.4 21.4 11.2 22 12 22 C12.8 22 13.6 21.4 14 20.5"
    HEART "Heart" "M12 20.5 C7 16 3.5 12.8 3.5 9.3 C3.5 6.6 5.5 5 7.8 5 C9.6 5 11.2 6.1 12 7.6 C12.8 6.1 14.4 5 16.2 5 C18.5 5 20.5 6.6 20.5 9.3 C20.5 12.8 17 16 12 20.5 Z"
    STAR "Star" "M12 3 L14.2 9.2 L20.8 9.7 L15.7 13.9 L17.2 20.4 L12 16.9 L6.8 20.4 L8.3 13.9 L3.2 9.7 L9.8 9.2 Z"
    PIN "Pin" "M12 21.5 C7.5 17 4.5 13.6 4.5 9.8 C4.5 5.7 7.9 3 12 3 C16.1 3 19.5 5.7 19.5 9.8 C19.5 13.6 16.5 17 12 21.5 Z M9.8 9.8 a2.2 2.2 0 1 0 4.4 0 a2.2 2.2 0 1 0 -4.4 0"
    SPROUT "Sprout" "M12 21 V10 M12 13 C12 9 9 7 5.5 7 C5.5 11 8 13 12 13 M12 11 C12 7.5 14.5 5.5 18.5 5.5 C18.5 9.5 15.8 11 12 11"
    CLOCK "Clock" "M3.5 12 a8.5 8.5 0 1 0 17 0 a8.5 8.5 0 1 0 -17 0 M12 7 V12.5 L15.5 14.5"
    CALENDAR "Calendar" "M4.5 5.5 H19.5 V19.5 H4.5 Z M4.5 9.5 H19.5 M8.5 3.5 V7.5 M15.5 3.5 V7.5 M8 13.5 H10 M12 13.5 H14 M8 16 H12"
    MAIL "Mail" "M3.5 6.5 H20.5 V17.5 H3.5 Z M4 7.5 L12 13 L20 7.5"
    CHART "Chart" "M4 4 V20 H20 M8 16 V11 M12 16 V7 M16 16 V9"
    LAYERS "Layers" "M12 3.5 L20.5 8.5 L12 13.5 L3.5 8.5 Z M3.5 12 L12 17 L20.5 12 M3.5 15.8 L12 20.8 L20.5 15.8"
    SLIDERS "Sliders" "M4 7.5 H9.5 M14.5 7.5 H19.5 M9.5 7.5 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0 M4 16.5 H12.5 M17.5 16.5 H19.5 M12.5 16.5 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0"
    BOOKMARK "Bookmark" "M7 3.5 H17 V20.5 L12 17 L7 20.5 Z M10 7.5 H14"
    DOWNLOAD "Download" "M12 3.5 V14.5 M7.5 10.5 L12 15 L16.5 10.5 M4.5 20.5 H19.5"
    PLUS "Plus" "M12 5.5 V18.5 M5.5 12 H18.5"
    CHECK "Check" "M4.5 12.5 L9.5 17.5 L19.5 6.5"
    CLOSE "Close" "M6.5 6.5 L17.5 17.5 M17.5 6.5 L6.5 17.5"
    MENU "Menu" "M4 6.5 H20 M4 12 H20 M4 17.5 H14"
    ARROW_LEFT "Arrow left" "M20 12 H4.5 M10.5 5.5 L4 12 L10.5 18.5"
    ARROW_RIGHT "Arrow right" "M4 12 H19.5 M13.5 5.5 L20 12 L13.5 18.5"
    CHEVRON_RIGHT "Chevron right" "M9.5 5.5 L15.5 12 L9.5 18.5"
    CHEVRON_DOWN "Chevron down" "M5.5 9.5 L12 15.5 L18.5 9.5"
}
