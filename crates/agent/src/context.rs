//! The minimal document context sent to the model: canvas size, selection summary,
//! top-level layer names, and the timeline's compositions. Never the whole file.

use undesign_engine::Session;

/// Most layer names listed (top-level only).
const MAX_LAYERS: usize = 20;
/// Most selected layers described.
const MAX_SELECTION: usize = 8;
/// Most compositions described.
const MAX_COMPOSITIONS: usize = 5;

/// One composition's facts for the prompt.
#[derive(Clone, Debug)]
pub struct CompositionSummary {
    /// Engine id (the model passes it back as `compositionId`).
    pub id: u64,
    /// Composition name.
    pub name: String,
    /// Frames per second.
    pub fps: u16,
    /// Length in frames.
    pub duration_frames: u32,
    /// Track count.
    pub tracks: usize,
}

/// The document facts accompanying a prompt. Built infallibly: whatever is missing
/// simply stays empty.
#[derive(Clone, Debug, Default)]
pub struct ChatContext {
    /// Active page size in page units, when a document is open.
    pub canvas: Option<(f64, f64)>,
    /// Up to [`MAX_SELECTION`] selected layers as `"name (kind)"`.
    pub selection: Vec<String>,
    /// Up to [`MAX_LAYERS`] top-level layer names on the active page.
    pub layers: Vec<String>,
    /// Up to [`MAX_COMPOSITIONS`] compositions on the document.
    pub compositions: Vec<CompositionSummary>,
}

impl ChatContext {
    /// Read the context from a session. Never fails: an empty session yields an
    /// empty context.
    pub fn from_session(session: &Session) -> Self {
        let mut out = Self::default();
        let Ok(doc) = session.doc() else { return out };
        if let Ok(page) = session.page()
            && let Some(node) = doc.node(page)
        {
            out.canvas = Some((node.width, node.height));
            out.layers = node.children.iter().filter_map(|id| doc.node(*id)).take(MAX_LAYERS).map(|n| n.name.clone()).collect();
        }
        out.selection = session
            .selection()
            .iter()
            .filter_map(|id| doc.node(*id))
            .take(MAX_SELECTION)
            .map(|n| format!("{} ({})", n.name, n.kind.type_name()))
            .collect();
        out.compositions = doc
            .motion
            .compositions
            .iter()
            .take(MAX_COMPOSITIONS)
            .map(|c| CompositionSummary { id: c.id, name: c.name.clone(), fps: c.fps, duration_frames: c.duration_frames, tracks: c.tracks.len() })
            .collect();
        out
    }

    /// Render the context as a compact block appended to the user message.
    pub fn render(&self) -> String {
        let mut out = String::new();
        match self.canvas {
            Some((w, h)) => out.push_str(&format!("Canvas: {w:.0} x {h:.0}\n")),
            None => out.push_str("Canvas: none open\n"),
        }
        if self.selection.is_empty() {
            out.push_str("Selection: none\n");
        } else {
            out.push_str(&format!("Selection: {}\n", self.selection.join(", ")));
        }
        if !self.layers.is_empty() {
            out.push_str(&format!("Layers: {}\n", self.layers.join(", ")));
        }
        if self.compositions.is_empty() {
            out.push_str("Timeline: no compositions (create one if the prompt animates)\n");
        } else {
            let comps: Vec<String> = self
                .compositions
                .iter()
                .map(|c| format!("{} (id {}, {} fps, {} frames, {} tracks)", c.name, c.id, c.fps, c.duration_frames, c.tracks))
                .collect();
            out.push_str(&format!("Timeline: {}\n", comps.join("; ")));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn empty_session_yields_an_empty_context() {
        let session = Session::new();
        let ctx = ChatContext::from_session(&session);
        let text = ctx.render();
        assert!(text.contains("Selection: none"));
        assert!(text.contains("no compositions"));
    }

    #[test]
    fn context_names_selection_layers_and_compositions() {
        let mut session = Session::new();
        session.execute("shape.rectangle", &json!({"x": 0, "y": 0, "width": 10, "height": 10})).unwrap();
        session.execute("motion.composition.create", &json!({"name": "Intro", "fps": 24, "durationFrames": 72})).unwrap();
        let ctx = ChatContext::from_session(&session);
        assert!(ctx.canvas.is_some());
        assert!(!ctx.layers.is_empty());
        assert_eq!(ctx.compositions.len(), 1);
        assert_eq!(ctx.compositions[0].fps, 24);
        let text = ctx.render();
        assert!(text.contains("Intro"));
        assert!(text.contains("24 fps"));
    }
}
