//! Undesign WASM engine bridge.
//!
//! Original Undesign glue over the FigCraft engine crates (see `rust/Cargo.toml`
//! for the pinned upstream revision and `third-party/figcraft/` for licenses).
//!
//! Boundary contract (JSON strings cross the WASM boundary; ids are numbers):
//! - [`Engine::execute`] runs any engine command, e.g. `shape.rectangle`
//!   with `{"x":0,"y":0,"width":100,"height":60}`, and returns result JSON.
//! - [`Engine::undo`] / [`Engine::redo`] step the engine's own history.
//! - [`Engine::selection`] / [`Engine::set_selection`] sync the selection.
//! - [`Engine::export_page_svg`] renders the active page as an SVG document.
//! - [`Engine::save`] / [`Engine::load`] serialize the whole [`Document`].
//!
//! Loading a document replaces the active [`DocState`], which resets its undo
//! history; that reset is reported through [`Engine::undo_depth`].

use figcraft_doc::{Document, NodeId};
use figcraft_engine::Session;
use wasm_bindgen::prelude::*;

/// One live engine session (exactly one is owned by the React app).
pub struct Engine {
    session: Session,
}

impl Engine {
    pub fn new() -> Self {
        Self {
            session: Session::new(),
        }
    }

    /// Run an engine command; `params_json` must be a JSON object.
    /// Returns the command's result as a JSON string.
    pub fn execute(&mut self, cmd: &str, params_json: &str) -> Result<String, String> {
        let params: serde_json::Value =
            serde_json::from_str(params_json).map_err(|e| format!("bad params JSON: {e}"))?;
        let out = self.session.execute(cmd, &params).map_err(|e| e.to_string())?;
        serde_json::to_string(&out).map_err(|e| e.to_string())
    }

    /// Undo one step. Returns false when there was nothing to undo.
    pub fn undo(&mut self) -> bool {
        self.session.undo().unwrap_or(false)
    }

    /// Redo one step. Returns false when there was nothing to redo.
    pub fn redo(&mut self) -> bool {
        self.session.redo().unwrap_or(false)
    }

    /// (undo depth, redo depth) of the active document's history.
    pub fn undo_depth(&self) -> (usize, usize) {
        self.session.undo_depth()
    }

    /// Current selection as a JSON array of node ids.
    pub fn selection(&self) -> String {
        serde_json::to_string(&self.session.selection()).unwrap_or_else(|_| "[]".into())
    }

    /// Replace the selection; `ids_json` is a JSON array of node ids.
    pub fn set_selection(&mut self, ids_json: &str) -> Result<(), String> {
        let ids: Vec<NodeId> =
            serde_json::from_str(ids_json).map_err(|e| format!("bad selection JSON: {e}"))?;
        self.session.set_selection(ids);
        Ok(())
    }

    /// Small JSON summary of the active document: name, page count,
    /// node count, active page id, and selection.
    pub fn doc_info(&self) -> Result<String, String> {
        let doc = self.session.doc().map_err(|e| e.to_string())?;
        let ds = self.session.ds().map_err(|e| e.to_string())?;
        let info = serde_json::json!({
            "name": doc.name,
            "pages": doc.pages.len(),
            "nodes": doc.node_count(),
            "page": ds.page,
            "selection": ds.selection,
        });
        serde_json::to_string(&info).map_err(|e| e.to_string())
    }

    /// Render the active page as a standalone SVG document string.
    pub fn export_page_svg(&self) -> Result<String, String> {
        let doc = self.session.doc().map_err(|e| e.to_string())?;
        let ds = self.session.ds().map_err(|e| e.to_string())?;
        let opts = figcraft_svg::SvgOptions::default();
        figcraft_svg::export_svg(doc, &[ds.page], &opts)
            .ok_or_else(|| "export produced no SVG (empty page?)".to_string())
    }

    /// Serialize the active document to a JSON string.
    pub fn save(&self) -> Result<String, String> {
        let doc = self.session.doc().map_err(|e| e.to_string())?;
        serde_json::to_string(doc).map_err(|e| e.to_string())
    }

    /// Replace the active document from [`Engine::save`] output.
    /// The replacement resets that document's undo history.
    pub fn load(&mut self, json: &str) -> Result<(), String> {
        let doc: Document =
            serde_json::from_str(json).map_err(|e| format!("bad document JSON: {e}"))?;
        let ds = self.session.ds_mut().map_err(|e| e.to_string())?;
        *ds = figcraft_engine::DocState::new(doc, None);
        Ok(())
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

/// WASM handle: the same [`Engine`] with a wasm-bindgen constructor.
/// Methods take/return plain strings so the JS side never touches Rust types.
#[wasm_bindgen]
pub struct WasmEngine {
    inner: Engine,
}

#[wasm_bindgen]
impl WasmEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> WasmEngine {
        WasmEngine {
            inner: Engine::new(),
        }
    }

    pub fn execute(&mut self, cmd: &str, params_json: &str) -> Result<String, JsValue> {
        self.inner
            .execute(cmd, params_json)
            .map_err(|e| JsValue::from_str(&e))
    }

    pub fn undo(&mut self) -> bool {
        self.inner.undo()
    }

    pub fn redo(&mut self) -> bool {
        self.inner.redo()
    }

    /// "undo_depth,redo_depth" (cheap tuple encoding for the JS side).
    #[wasm_bindgen(js_name = undoDepth)]
    pub fn undo_depth(&self) -> String {
        let (u, r) = self.inner.undo_depth();
        format!("{u},{r}")
    }

    pub fn selection(&self) -> String {
        self.inner.selection()
    }

    #[wasm_bindgen(js_name = setSelection)]
    pub fn set_selection(&mut self, ids_json: &str) -> Result<(), JsValue> {
        self.inner
            .set_selection(ids_json)
            .map_err(|e| JsValue::from_str(&e))
    }

    #[wasm_bindgen(js_name = docInfo)]
    pub fn doc_info(&self) -> Result<String, JsValue> {
        self.inner.doc_info().map_err(|e| JsValue::from_str(&e))
    }

    #[wasm_bindgen(js_name = exportPageSvg)]
    pub fn export_page_svg(&self) -> Result<String, JsValue> {
        self.inner
            .export_page_svg()
            .map_err(|e| JsValue::from_str(&e))
    }

    pub fn save(&self) -> Result<String, JsValue> {
        self.inner.save().map_err(|e| JsValue::from_str(&e))
    }

    pub fn load(&mut self, json: &str) -> Result<(), JsValue> {
        self.inner.load(json).map_err(|e| JsValue::from_str(&e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(engine: &mut Engine, x: f64, y: f64) -> u64 {
        let out = engine
            .execute(
                "shape.rectangle",
                &format!(r#"{{"x":{x},"y":{y},"width":100,"height":60}}"#),
            )
            .expect("create rectangle");
        serde_json::from_str::<serde_json::Value>(&out).expect("result JSON")["id"]
            .as_u64()
            .expect("numeric id")
    }

    #[test]
    fn session_boots_with_one_untitled_document() {
        let engine = Engine::new();
        let info: serde_json::Value =
            serde_json::from_str(&engine.doc_info().unwrap()).unwrap();
        assert_eq!(info["name"], "Untitled");
        assert_eq!(info["pages"], 1);
        assert_eq!(engine.undo_depth(), (0, 0));
    }

    #[test]
    fn create_move_undo_redo_round_trip() {
        let mut engine = Engine::new();
        let id = rect(&mut engine, 10.0, 20.0);
        assert_eq!(engine.undo_depth().0, 1);
        engine
            .execute("node.set", &format!(r#"{{"id":{id},"props":{{"x":50}}}}"#))
            .expect("move node");
        assert_eq!(engine.undo_depth().0, 2);
        assert!(engine.undo(), "undo the move");
        assert!(engine.undo(), "undo the creation");
        assert!(!engine.undo(), "nothing left to undo");
        assert!(engine.redo(), "redo the creation");
        assert!(engine.redo(), "redo the move");
        assert!(!engine.redo(), "nothing left to redo");
        // The surviving node is the moved one at x=50.
        let doc = engine.session.doc().unwrap();
        let node = doc.node(NodeId(id)).expect("node exists");
        let t = node.transform.as_coeffs();
        assert!((t[4] - 50.0).abs() < 1e-9, "x is 50, got {:?}", t);
    }

    #[test]
    fn unknown_commands_and_bad_params_are_errors() {
        let mut engine = Engine::new();
        assert!(engine.execute("nope.command", "{}").is_err());
        assert!(engine.execute("shape.rectangle", "{oops").is_err());
    }

    #[test]
    fn selection_round_trips() {
        let mut engine = Engine::new();
        assert_eq!(engine.selection(), "[]");
        let id = rect(&mut engine, 0.0, 0.0);
        // The engine auto-selects the node it just created.
        assert_eq!(engine.selection(), format!("[{id}]"));
        engine.set_selection("[]").unwrap();
        assert_eq!(engine.selection(), "[]");
        engine.set_selection(&format!("[{id}]")).unwrap();
        assert_eq!(engine.selection(), format!("[{id}]"));
        assert!(engine.set_selection("[oops]").is_err());
    }

    #[test]
    fn page_svg_export_renders_created_shapes() {
        let mut engine = Engine::new();
        rect(&mut engine, 10.0, 20.0);
        let svg = engine.export_page_svg().expect("svg export");
        assert!(svg.contains("<svg"), "has svg root, got {svg}");
        // Rectangles export as stroked paths positioned by a transform.
        assert!(
            svg.contains("M0 0L100 0L100 60L0 60Z"),
            "rectangle outline rendered, got {svg}"
        );
        assert!(
            svg.contains("matrix(1 0 0 1 10 20)"),
            "rectangle transform rendered, got {svg}"
        );
    }

    #[test]
    fn save_load_round_trip_preserves_the_document() {
        let mut engine = Engine::new();
        let id = rect(&mut engine, 10.0, 20.0);
        let json = engine.save().expect("save");
        let mut fresh = Engine::new();
        fresh.load(&json).expect("load");
        let again = fresh.save().expect("resave");
        assert_eq!(serde_json::from_str::<serde_json::Value>(&json).unwrap(), serde_json::from_str::<serde_json::Value>(&again).unwrap(), "byte-stable round trip");
        let doc = fresh.session.doc().unwrap();
        assert!(doc.node(NodeId(id)).is_some(), "node survives");
        assert!(fresh.load("{oops").is_err(), "bad json rejected");
    }
}
