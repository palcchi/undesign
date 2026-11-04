//! Monochrome UI glyphs for the full Undesign editor icon family and workspace shell.
//!
//! The inherited geometric marks follow a shared 24-unit grid, round-ended strokes and a consistent
//! optical weight. Figma-like silhouettes across editor-visible roles are explicitly owner-approved
//! for this isolated task; `paint` still takes one color for the complete glyph.

use egui::{Color32, CornerRadius, Painter, Pos2, Rect, Shape, Stroke, StrokeKind, pos2};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Glyph {
    Select,
    Hand,
    Scale,
    Frame,
    Section,
    Slice,
    Rectangle,
    Line,
    Arrow,
    Ellipse,
    Polygon,
    Star,
    Pen,
    Pencil,
    ShapeBuilder,
    ShapeBuilderRemove,
    Bend,
    Text,
    TextOnPath,
    Comment,
    Components,
    Puzzle,
    Actions,
    More,
    Menu,
    Shapes,
    Motion,
    Design,
    Prototype,
    Agent,
    Page,
    Layers,
    Assets,
    Search,
    Folder,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    Plus,
    Minus,
    Home,
    Online,
    Close,
    Check,
    Eye,
    EyeOff,
    Code,
    Clock,
    PaintBucket,
    Lasso,
    Cut,
    Eraser,
    VariableWidth,
    Marker,
    Highlighter,
    Connector,
    Board,
    Stamp,
    Panels,
    Play,
    Effects,
    Styles,
}

impl Glyph {
    pub const ALL: &[Glyph] = &[
        Glyph::Select,
        Glyph::Hand,
        Glyph::Scale,
        Glyph::Frame,
        Glyph::Section,
        Glyph::Slice,
        Glyph::Rectangle,
        Glyph::Line,
        Glyph::Arrow,
        Glyph::Ellipse,
        Glyph::Polygon,
        Glyph::Star,
        Glyph::Pen,
        Glyph::Pencil,
        Glyph::ShapeBuilder,
        Glyph::ShapeBuilderRemove,
        Glyph::Bend,
        Glyph::Text,
        Glyph::TextOnPath,
        Glyph::Comment,
        Glyph::Components,
        Glyph::Puzzle,
        Glyph::Actions,
        Glyph::More,
        Glyph::Menu,
        Glyph::Shapes,
        Glyph::Motion,
        Glyph::Design,
        Glyph::Prototype,
        Glyph::Agent,
        Glyph::Page,
        Glyph::Layers,
        Glyph::Assets,
        Glyph::Search,
        Glyph::Folder,
        Glyph::ChevronDown,
        Glyph::ChevronLeft,
        Glyph::ChevronRight,
        Glyph::ChevronUp,
        Glyph::Plus,
        Glyph::Minus,
        Glyph::Home,
        Glyph::Online,
        Glyph::Close,
        Glyph::Check,
        Glyph::Eye,
        Glyph::EyeOff,
        Glyph::Code,
        Glyph::Clock,
        Glyph::PaintBucket,
        Glyph::Lasso,
        Glyph::Cut,
        Glyph::Eraser,
        Glyph::VariableWidth,
        Glyph::Marker,
        Glyph::Highlighter,
        Glyph::Connector,
        Glyph::Board,
        Glyph::Stamp,
        Glyph::Panels,
        Glyph::Play,
        Glyph::Effects,
        Glyph::Styles,
    ];
}

/// Map common editor roles to the shared monochrome glyph family.
/// Unmapped specialist roles keep their dedicated feature shapes in `icons`.
pub fn from_icon(icon: crate::icons::Icon) -> Option<Glyph> {
    use crate::icons::Icon as I;
    Some(match icon {
        I::Move => Glyph::Select,
        I::Hand => Glyph::Hand,
        I::Scale => Glyph::Scale,
        I::Frame => Glyph::Frame,
        I::Section => Glyph::Section,
        I::Slice => Glyph::Slice,
        I::Rectangle => Glyph::Rectangle,
        I::Line => Glyph::Line,
        I::Arrow => Glyph::Arrow,
        I::Ellipse => Glyph::Ellipse,
        I::Polygon => Glyph::Polygon,
        I::Star => Glyph::Star,
        I::Pen => Glyph::Pen,
        I::Pencil => Glyph::Pencil,
        I::ShapeBuilder => Glyph::ShapeBuilder,
        I::ShapeBuilderRemove => Glyph::ShapeBuilderRemove,
        I::Bend => Glyph::Bend,
        I::Text => Glyph::Text,
        I::TextOnPath => Glyph::TextOnPath,
        I::Comment => Glyph::Comment,
        I::Component | I::ComponentSet | I::Instance | I::Assets | I::Library => Glyph::Components,
        I::Actions => Glyph::Actions,
        I::Motion => Glyph::Motion,
        I::Prototype => Glyph::Prototype,
        I::Page => Glyph::Page,
        I::Layers => Glyph::Layers,
        I::Search => Glyph::Search,
        I::Chevron => Glyph::ChevronDown,
        I::ChevronLeft => Glyph::ChevronLeft,
        I::ChevronRight => Glyph::ChevronRight,
        I::ChevronUp => Glyph::ChevronUp,
        I::Plus => Glyph::Plus,
        I::Minus => Glyph::Minus,
        I::Home => Glyph::Home,
        I::Online => Glyph::Online,
        I::LiveShared | I::LivePrivate => Glyph::Online,
        I::Close => Glyph::Close,
        I::Check => Glyph::Check,
        I::Eye => Glyph::Eye,
        I::EyeOff => Glyph::EyeOff,
        I::Code => Glyph::Code,
        I::Clock => Glyph::Clock,
        I::PaintBucket | I::Fill => Glyph::PaintBucket,
        I::PenNib => Glyph::Pen,
        I::Lasso => Glyph::Lasso,
        I::Cut => Glyph::Cut,
        I::Eraser => Glyph::Eraser,
        I::VariableWidth => Glyph::VariableWidth,
        I::Marker => Glyph::Marker,
        I::Highlighter => Glyph::Highlighter,
        I::Connector => Glyph::Connector,
        I::Shapes => Glyph::Shapes,
        I::Board => Glyph::Board,
        I::Stamp => Glyph::Stamp,
        I::Panels => Glyph::Panels,
        I::Play => Glyph::Play,
        I::Preview => Glyph::Play,
        I::Effects => Glyph::Effects,
        I::Adjust => Glyph::Design,
        I::Dots => Glyph::More,
        I::Menu => Glyph::Menu,
        I::Styles => Glyph::Styles,
        _ => return None,
    })
}

/// Draw a glyph centred in `rect` using a uniform monochrome round-ended stroke.
pub fn paint(painter: &Painter, rect: Rect, glyph: Glyph, color: Color32) {
    let side = rect.width().min(rect.height());
    if side <= 0.0 {
        return;
    }
    let scale = side / 24.0;
    let point = |x: f32, y: f32| pos2(rect.center().x + (x - 12.0) * scale, rect.center().y + (y - 12.0) * scale);
    let ppp = painter.ctx().pixels_per_point().max(1.0);
    let width = (1.85 * scale).max(1.0 / ppp);
    let stroke = Stroke::new(width, color);
    let cap = width / 2.0;

    let line = |a: (f32, f32), b: (f32, f32)| {
        let (a, b) = (point(a.0, a.1), point(b.0, b.1));
        painter.line_segment([a, b], stroke);
        painter.circle_filled(a, cap, color);
        painter.circle_filled(b, cap, color);
    };
    let path = |points: &[(f32, f32)], closed: bool| {
        let mapped: Vec<Pos2> = points.iter().map(|&(x, y)| point(x, y)).collect();
        if closed {
            painter.add(Shape::closed_line(mapped.clone(), stroke));
        } else {
            painter.add(Shape::line(mapped.clone(), stroke));
        }
        for p in mapped {
            painter.circle_filled(p, cap, color);
        }
    };
    let outline_rect = |min: (f32, f32), max: (f32, f32), radius: f32| {
        let r = Rect::from_min_max(point(min.0, min.1), point(max.0, max.1));
        painter.rect_stroke(r, CornerRadius::same((radius * scale).round() as u8), stroke, StrokeKind::Inside);
    };
    let circle = |center: (f32, f32), radius: f32| {
        painter.circle_stroke(point(center.0, center.1), radius * scale, stroke);
    };
    let dot = |center: (f32, f32), radius: f32| {
        painter.circle_filled(point(center.0, center.1), radius * scale, color);
    };
    let filled_poly = |points: &[(f32, f32)]| {
        let mapped = points.iter().map(|&(x, y)| point(x, y)).collect();
        painter.add(Shape::convex_polygon(mapped, color, Stroke::NONE));
    };
    let diamond = |x: f32, y: f32, radius: f32| {
        path(&[(x, y - radius), (x + radius, y), (x, y + radius), (x - radius, y)], true);
    };

    use Glyph::*;
    match glyph {
        Select => path(&[(5.0, 3.0), (19.0, 10.0), (13.2, 11.8), (17.0, 19.0), (14.5, 20.3), (10.7, 13.0), (5.0, 18.0), (5.0, 3.0)], true),
        Hand => path(
            &[
                (7.0, 20.0),
                (5.5, 14.0),
                (5.5, 9.0),
                (7.0, 8.5),
                (8.5, 13.0),
                (8.5, 5.0),
                (10.5, 4.0),
                (11.5, 13.0),
                (11.5, 6.5),
                (13.5, 5.5),
                (14.5, 13.0),
                (14.5, 8.5),
                (16.5, 8.5),
                (17.0, 15.5),
                (15.0, 19.5),
                (11.0, 21.0),
            ],
            true,
        ),
        Scale => {
            outline_rect((7.0, 7.0), (17.0, 17.0), 1.5);
            line((4.0, 8.0), (8.0, 4.0));
            line((16.0, 20.0), (20.0, 16.0));
            path(&[(4.0, 4.0), (8.0, 4.0), (4.0, 8.0)], false);
            path(&[(20.0, 16.0), (20.0, 20.0), (16.0, 20.0)], false);
        }
        Frame => {
            // Open frame corners with a subtle center cross, rather than a heavy grid.
            line((5.0, 10.0), (5.0, 5.0));
            line((5.0, 5.0), (10.0, 5.0));
            line((14.0, 5.0), (19.0, 5.0));
            line((19.0, 5.0), (19.0, 10.0));
            line((19.0, 14.0), (19.0, 19.0));
            line((19.0, 19.0), (14.0, 19.0));
            line((10.0, 19.0), (5.0, 19.0));
            line((5.0, 19.0), (5.0, 14.0));
            line((12.0, 8.0), (12.0, 10.0));
            line((12.0, 14.0), (12.0, 16.0));
            line((8.0, 12.0), (10.0, 12.0));
            line((14.0, 12.0), (16.0, 12.0));
        }
        Section => {
            path(&[(5.0, 7.0), (5.0, 18.0), (19.0, 18.0), (19.0, 7.0), (13.0, 7.0), (11.0, 5.0), (6.0, 5.0), (5.0, 7.0)], true);
            line((8.0, 11.0), (16.0, 11.0));
        }
        Slice => {
            path(&[(5.0, 5.0), (5.0, 9.0)], false);
            path(&[(5.0, 5.0), (9.0, 5.0)], false);
            path(&[(19.0, 5.0), (15.0, 5.0)], false);
            path(&[(19.0, 5.0), (19.0, 9.0)], false);
            path(&[(5.0, 19.0), (5.0, 15.0)], false);
            path(&[(5.0, 19.0), (9.0, 19.0)], false);
            path(&[(19.0, 19.0), (15.0, 19.0)], false);
            path(&[(19.0, 19.0), (19.0, 15.0)], false);
        }
        Rectangle => outline_rect((5.0, 5.0), (19.0, 19.0), 1.5),
        Line => line((5.0, 19.0), (19.0, 5.0)),
        Arrow => {
            line((5.0, 19.0), (19.0, 5.0));
            path(&[(12.0, 5.0), (19.0, 5.0), (19.0, 12.0)], false);
        }
        Ellipse => circle((12.0, 12.0), 7.0),
        Polygon => path(&[(12.0, 4.0), (19.0, 9.0), (16.5, 18.0), (7.5, 18.0), (5.0, 9.0), (12.0, 4.0)], true),
        Star => path(
            &[
                (12.0, 4.0),
                (14.2, 9.3),
                (20.0, 10.0),
                (15.6, 13.7),
                (17.0, 19.5),
                (12.0, 16.2),
                (7.0, 19.5),
                (8.4, 13.7),
                (4.0, 10.0),
                (9.8, 9.3),
                (12.0, 4.0),
            ],
            true,
        ),
        Pen => {
            path(&[(5.0, 3.0), (14.5, 6.0), (19.5, 11.0), (12.0, 18.5), (8.0, 17.5), (5.0, 3.0)], true);
            circle((13.0, 11.5), 1.7);
        }
        Pencil => {
            path(&[(6.0, 17.0), (16.0, 7.0), (19.0, 10.0), (9.0, 20.0), (6.0, 20.0), (6.0, 17.0)], true);
            line((14.5, 8.5), (17.5, 11.5));
        }
        ShapeBuilder => {
            circle((9.0, 12.0), 5.0);
            circle((15.0, 12.0), 5.0);
            dot((12.0, 12.0), 1.2);
        }
        ShapeBuilderRemove => {
            circle((9.0, 12.0), 5.0);
            circle((15.0, 12.0), 5.0);
            line((10.0, 12.0), (14.0, 12.0));
        }
        Bend => {
            path(&[(4.0, 18.0), (7.0, 17.0), (10.0, 13.0), (13.0, 8.0), (17.0, 7.0), (20.0, 9.0)], false);
            dot((4.0, 18.0), 1.6);
            dot((20.0, 9.0), 1.6);
            line((13.0, 8.0), (13.0, 4.0));
            dot((13.0, 4.0), 1.2);
        }
        Text => {
            line((5.0, 6.0), (19.0, 6.0));
            line((12.0, 6.0), (12.0, 19.0));
        }
        TextOnPath => {
            line((7.0, 5.0), (17.0, 5.0));
            line((12.0, 5.0), (12.0, 10.0));
            path(&[(4.0, 19.0), (8.0, 15.0), (12.0, 15.0), (16.0, 15.0), (20.0, 19.0)], false);
        }
        Comment => {
            circle((12.0, 11.0), 8.0);
            path(&[(7.0, 17.0), (6.0, 20.0), (11.0, 18.0)], false);
        }
        Components | Assets => {
            for (x, y) in [(5.0, 5.0), (13.0, 5.0), (5.0, 13.0), (13.0, 13.0)] {
                outline_rect((x, y), (x + 6.0, y + 6.0), 1.0);
            }
        }
        Puzzle => path(
            &[
                (5.0, 5.0),
                (9.0, 5.0),
                (9.0, 3.5),
                (11.0, 2.5),
                (13.0, 3.5),
                (13.0, 5.0),
                (19.0, 5.0),
                (19.0, 10.0),
                (20.5, 10.0),
                (21.5, 12.0),
                (20.5, 14.0),
                (19.0, 14.0),
                (19.0, 19.0),
                (14.0, 19.0),
                (14.0, 17.5),
                (12.0, 16.5),
                (10.0, 17.5),
                (10.0, 19.0),
                (5.0, 19.0),
                (5.0, 14.0),
                (6.5, 14.0),
                (7.5, 12.0),
                (6.5, 10.0),
                (5.0, 10.0),
                (5.0, 5.0),
            ],
            true,
        ),
        Actions => {
            path(&[(12.0, 3.0), (13.7, 9.5), (20.0, 12.0), (13.7, 13.7), (12.0, 20.0), (10.3, 13.7), (4.0, 12.0), (10.3, 9.5), (12.0, 3.0)], false);
            circle((19.0, 5.0), 1.4);
            line((18.0, 18.0), (22.0, 18.0));
            line((20.0, 16.0), (20.0, 20.0));
        }
        More => {
            dot((6.0, 12.0), 1.2);
            dot((12.0, 12.0), 1.2);
            dot((18.0, 12.0), 1.2);
        }
        Menu => {
            line((5.0, 7.0), (19.0, 7.0));
            line((5.0, 12.0), (19.0, 12.0));
            line((5.0, 17.0), (19.0, 17.0));
        }
        Shapes => {
            outline_rect((4.0, 4.0), (11.0, 11.0), 1.0);
            circle((16.0, 8.0), 4.0);
            path(&[(5.0, 20.0), (10.0, 13.0), (15.0, 20.0), (5.0, 20.0)], true);
        }
        Motion => {
            line((7.0, 4.0), (7.0, 20.0));
            line((4.0, 18.0), (20.0, 18.0));
            diamond(15.0, 11.0, 3.0);
        }
        Design | Styles => {
            for (y, knob) in [(6.0, 9.0), (12.0, 16.0), (18.0, 11.0)] {
                line((4.0, y), (20.0, y));
                painter.circle_filled(point(knob, y), 2.1 * scale, color);
            }
        }
        Prototype => {
            line((7.0, 12.0), (17.0, 12.0));
            path(&[(14.0, 9.0), (17.0, 12.0), (14.0, 15.0)], false);
            circle((5.0, 12.0), 2.5);
            circle((19.0, 12.0), 2.5);
        }
        Agent => {
            outline_rect((4.0, 5.0), (17.0, 15.0), 3.0);
            path(&[(8.0, 15.0), (7.0, 18.0), (11.0, 15.0)], false);
            outline_rect((11.0, 10.0), (20.0, 18.0), 2.5);
            line((14.0, 13.0), (17.0, 13.0));
        }
        Page => {
            path(&[(6.0, 4.0), (14.0, 4.0), (19.0, 9.0), (19.0, 20.0), (6.0, 20.0), (6.0, 4.0)], true);
            path(&[(14.0, 4.0), (14.0, 9.0), (19.0, 9.0)], false);
            line((9.0, 13.0), (16.0, 13.0));
            line((9.0, 16.0), (15.0, 16.0));
        }
        Layers => {
            path(&[(12.0, 4.0), (20.0, 8.0), (12.0, 12.0), (4.0, 8.0), (12.0, 4.0)], true);
            path(&[(5.0, 12.0), (12.0, 16.0), (19.0, 12.0)], false);
            path(&[(5.0, 16.0), (12.0, 20.0), (19.0, 16.0)], false);
        }
        Search => {
            circle((10.0, 10.0), 5.5);
            line((14.0, 14.0), (20.0, 20.0));
        }
        Folder => {
            path(&[(4.0, 7.0), (10.0, 7.0), (12.0, 9.0), (20.0, 9.0), (20.0, 18.0), (4.0, 18.0), (4.0, 7.0)], true);
            line((5.0, 11.0), (19.0, 11.0));
        }
        ChevronDown => path(&[(7.0, 10.0), (12.0, 15.0), (17.0, 10.0)], false),
        ChevronLeft => path(&[(15.0, 6.0), (9.0, 12.0), (15.0, 18.0)], false),
        ChevronRight => path(&[(9.0, 6.0), (15.0, 12.0), (9.0, 18.0)], false),
        ChevronUp => path(&[(7.0, 14.0), (12.0, 9.0), (17.0, 14.0)], false),
        Plus => {
            line((12.0, 5.0), (12.0, 19.0));
            line((5.0, 12.0), (19.0, 12.0));
        }
        Minus => line((5.0, 12.0), (19.0, 12.0)),
        Home => {
            path(&[(4.0, 11.0), (12.0, 5.0), (20.0, 11.0)], false);
            path(&[(6.0, 10.0), (6.0, 19.0), (18.0, 19.0), (18.0, 10.0)], true);
            outline_rect((10.0, 14.0), (14.0, 19.0), 0.5);
        }
        Online => {
            circle((12.0, 12.0), 8.0);
            path(&[(4.5, 9.0), (8.0, 10.0), (12.0, 10.5), (16.0, 10.0), (19.5, 9.0)], false);
            path(&[(4.5, 15.0), (8.0, 14.0), (12.0, 13.5), (16.0, 14.0), (19.5, 15.0)], false);
            path(&[(12.0, 4.0), (9.0, 8.0), (8.0, 12.0), (9.0, 16.0), (12.0, 20.0)], false);
            path(&[(12.0, 4.0), (15.0, 8.0), (16.0, 12.0), (15.0, 16.0), (12.0, 20.0)], false);
        }
        Close => {
            line((7.0, 7.0), (17.0, 17.0));
            line((17.0, 7.0), (7.0, 17.0));
        }
        Check => path(&[(5.0, 12.0), (10.0, 17.0), (19.0, 7.0)], false),
        Eye | EyeOff => {
            path(&[(3.0, 12.0), (7.0, 7.0), (12.0, 5.0), (17.0, 7.0), (21.0, 12.0), (17.0, 17.0), (12.0, 19.0), (7.0, 17.0), (3.0, 12.0)], true);
            if glyph == Eye {
                circle((12.0, 12.0), 2.5);
            } else {
                line((5.0, 19.0), (19.0, 5.0));
            }
        }
        Code => {
            path(&[(9.0, 6.0), (4.0, 12.0), (9.0, 18.0)], false);
            path(&[(15.0, 6.0), (20.0, 12.0), (15.0, 18.0)], false);
            line((14.0, 5.0), (10.0, 19.0));
        }
        Clock => {
            circle((12.0, 12.0), 8.0);
            line((12.0, 7.0), (12.0, 12.0));
            line((12.0, 12.0), (16.0, 14.0));
        }
        PaintBucket => {
            path(&[(6.0, 8.0), (10.0, 4.0), (19.0, 13.0), (13.0, 19.0), (5.0, 11.0), (6.0, 8.0)], true);
            line((8.0, 6.0), (17.0, 15.0));
            path(&[(19.0, 5.0), (17.0, 9.0), (21.0, 9.0), (19.0, 5.0)], true);
        }
        Lasso => {
            circle((10.0, 9.0), 5.0);
            path(&[(14.0, 13.0), (18.0, 17.0), (17.0, 20.0)], false);
        }
        Cut => {
            circle((6.0, 17.0), 2.5);
            circle((6.0, 7.0), 2.5);
            line((8.0, 8.0), (19.0, 18.0));
            line((8.0, 16.0), (19.0, 6.0));
        }
        Eraser => path(&[(6.0, 15.0), (14.0, 7.0), (19.0, 12.0), (11.0, 20.0), (6.0, 15.0)], true),
        VariableWidth => {
            path(&[(4.0, 17.0), (8.0, 14.0), (12.0, 12.0), (16.0, 10.0), (20.0, 7.0)], false);
            line((12.0, 6.0), (12.0, 18.0));
        }
        Marker | Highlighter => {
            path(&[(6.0, 17.0), (15.0, 8.0), (19.0, 12.0), (10.0, 21.0), (6.0, 17.0)], true);
            line((5.0, 20.0), (11.0, 20.0));
        }
        Connector => {
            outline_rect((4.0, 5.0), (10.0, 11.0), 1.0);
            outline_rect((14.0, 13.0), (20.0, 19.0), 1.0);
            path(&[(10.0, 8.0), (14.0, 8.0), (14.0, 16.0)], false);
        }
        Board => {
            path(&[(5.0, 4.0), (19.0, 4.0), (19.0, 20.0), (5.0, 20.0), (5.0, 4.0)], true);
            path(&[(15.0, 20.0), (15.0, 16.0), (19.0, 16.0)], false);
            line((8.0, 9.0), (16.0, 9.0));
            line((8.0, 12.0), (16.0, 12.0));
        }
        Stamp => {
            circle((12.0, 9.0), 4.0);
            path(&[(8.0, 13.0), (7.0, 18.0), (12.0, 16.0), (17.0, 18.0), (16.0, 13.0)], true);
        }
        Panels => {
            outline_rect((4.0, 5.0), (20.0, 19.0), 2.0);
            line((9.0, 5.0), (9.0, 19.0));
            line((14.0, 5.0), (14.0, 19.0));
        }
        Play => filled_poly(&[(8.0, 5.0), (19.0, 12.0), (8.0, 19.0)]),
        Effects => {
            path(&[(12.0, 4.0), (13.0, 10.0), (19.0, 12.0), (13.0, 14.0), (12.0, 20.0), (11.0, 14.0), (5.0, 12.0), (11.0, 10.0), (12.0, 4.0)], false);
            dot((19.0, 5.0), 1.0);
        }
    }
}

/// Paint a mapped app glyph if this common control role has an original shape here.
pub fn paint_compat(painter: &Painter, rect: Rect, icon: crate::icons::Icon, color: Color32) -> bool {
    if let Some(glyph) = from_icon(icon) {
        paint(painter, rect, glyph, color);
        true
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use egui::vec2;

    #[test]
    fn every_app_glyph_produces_a_shape() {
        let ctx = egui::Context::default();
        let mut failures = Vec::new();
        for &glyph in Glyph::ALL {
            let mut output = ctx.run_ui(egui::RawInput::default(), |ui| {
                let rect = Rect::from_center_size(pos2(24.0, 24.0), vec2(18.0, 18.0));
                paint(ui.painter(), rect, glyph, Color32::from_gray(32));
            });
            output.textures_delta.clear();
            if output.shapes.is_empty() {
                failures.push(format!("{glyph:?}"));
            }
        }
        assert!(failures.is_empty(), "empty app glyphs: {failures:?}");
    }

    #[test]
    fn full_editor_common_roles_map_to_the_expected_glyphs() {
        use crate::icons::Icon as I;
        for (icon, expected) in [
            (I::Move, Glyph::Select),
            (I::Hand, Glyph::Hand),
            (I::Scale, Glyph::Scale),
            (I::Frame, Glyph::Frame),
            (I::Section, Glyph::Section),
            (I::Slice, Glyph::Slice),
            (I::Rectangle, Glyph::Rectangle),
            (I::Line, Glyph::Line),
            (I::Arrow, Glyph::Arrow),
            (I::Ellipse, Glyph::Ellipse),
            (I::Polygon, Glyph::Polygon),
            (I::Star, Glyph::Star),
            (I::Pen, Glyph::Pen),
            (I::Pencil, Glyph::Pencil),
            (I::ShapeBuilder, Glyph::ShapeBuilder),
            (I::ShapeBuilderRemove, Glyph::ShapeBuilderRemove),
            (I::Bend, Glyph::Bend),
            (I::Text, Glyph::Text),
            (I::TextOnPath, Glyph::TextOnPath),
            (I::Comment, Glyph::Comment),
            (I::Component, Glyph::Components),
            (I::Instance, Glyph::Components),
            (I::ComponentSet, Glyph::Components),
            (I::Actions, Glyph::Actions),
            (I::Motion, Glyph::Motion),
            (I::Prototype, Glyph::Prototype),
            (I::Page, Glyph::Page),
            (I::Layers, Glyph::Layers),
            (I::Search, Glyph::Search),
            (I::Chevron, Glyph::ChevronDown),
            (I::ChevronRight, Glyph::ChevronRight),
            (I::Plus, Glyph::Plus),
            (I::Minus, Glyph::Minus),
            (I::Eye, Glyph::Eye),
            (I::EyeOff, Glyph::EyeOff),
            (I::Code, Glyph::Code),
            (I::Menu, Glyph::Menu),
            (I::Dots, Glyph::More),
            (I::Shapes, Glyph::Shapes),
        ] {
            assert_eq!(from_icon(icon), Some(expected), "wrong glyph for {icon:?}");
        }
    }

    #[test]
    fn specialist_property_icons_keep_their_dedicated_shapes() {
        use crate::icons::Icon as I;
        for icon in [I::AlignLeft, I::GradientLinear, I::CornerRadius, I::PaddingTop, I::LinkOn] {
            assert_eq!(from_icon(icon), None, "{icon:?} remains in the feature renderer");
        }
    }
}