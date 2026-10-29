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

    /// Describe the active page subtree as JSON (engine `node_json` with
    /// `depth` levels of children; deeper subtrees report `childCount`).
    /// Depth is clamped to 0..=32. One call feeds the whole layer tree.
    pub fn describe_page(&self, depth: usize) -> Result<String, String> {
        let doc = self.session.doc().map_err(|e| e.to_string())?;
        let page = self.session.page().map_err(|e| e.to_string())?;
        let v = figcraft_engine::inspect::node_json(doc, page, depth.min(32));
        serde_json::to_string(&v).map_err(|e| e.to_string())
    }

    /// Click-hit the active page in page coordinates. Returns the topmost
    /// node id as JSON (`{"id":…}`) or `null`. Uses the engine's own
    /// click-through rules; boolean-result outlines are not resolved (the
    /// `result` closure is session-UI state, so plain geometry applies).
    pub fn hit_test(&self, x: f64, y: f64) -> Result<String, String> {
        let doc = self.session.doc().map_err(|e| e.to_string())?;
        let page = self.session.page().map_err(|e| e.to_string())?;
        let pt = figcraft_geom::Point::new(x, y);
        let out = match doc.hit_test(page, pt, 0.5, None) {
            Some(id) => serde_json::json!({ "id": id }),
            None => serde_json::Value::Null,
        };
        serde_json::to_string(&out).map_err(|e| e.to_string())
    }

    /// Describe one node (includes direct-children summaries).
    /// Errors when the id names no node.
    pub fn describe_node(&self, id: u64) -> Result<String, String> {
        let doc = self.session.doc().map_err(|e| e.to_string())?;
        let v = figcraft_engine::inspect::node_json(doc, NodeId(id), 1);
        if v.is_null() {
            return Err(format!("no node {id}"));
        }
        serde_json::to_string(&v).map_err(|e| e.to_string())
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

    #[wasm_bindgen(js_name = describePage)]
    pub fn describe_page(&self, depth: u32) -> Result<String, JsValue> {
        self.inner
            .describe_page(depth as usize)
            .map_err(|e| JsValue::from_str(&e))
    }

    #[wasm_bindgen(js_name = describeNode)]
    pub fn describe_node(&self, id: f64) -> Result<String, JsValue> {
        self.inner
            .describe_node(id as u64)
            .map_err(|e| JsValue::from_str(&e))
    }

    #[wasm_bindgen(js_name = hitTest)]
    pub fn hit_test(&self, x: f64, y: f64) -> Result<String, JsValue> {
        self.inner.hit_test(x, y).map_err(|e| JsValue::from_str(&e))
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
    fn hit_test_returns_topmost_and_null() {
        let mut engine = Engine::new();
        let id = rect(&mut engine, 10.0, 10.0);
        let hit = engine.hit_test(60.0, 40.0).expect("hit");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&hit).unwrap()["id"]
                .as_u64()
                .unwrap(),
            id
        );
        let miss = engine.hit_test(500.0, 500.0).expect("miss");
        assert_eq!(miss, "null");
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
    fn describe_page_reports_the_whole_tree() {
        let mut engine = Engine::new();
        let f: u64 = serde_json::from_str::<serde_json::Value>(
            &engine
                .execute("node.create", r#"{"type":"frame","name":"Card","x":0,"y":0,"width":300,"height":200}"#)
                .unwrap(),
        )
        .unwrap()["id"]
            .as_u64()
            .unwrap();
        engine
            .execute(
                "shape.rectangle",
                &format!(r##"{{"x":8,"y":8,"width":40,"height":20,"parent":{f},"props":{{"fill":"#FF0000"}}}}"##),
            )
            .unwrap();
        let tree: serde_json::Value = serde_json::from_str(&engine.describe_page(8).unwrap()).unwrap();
        assert_eq!(tree["type"], "PAGE");
        assert_eq!(tree["children"].as_array().unwrap().len(), 1);
        let frame = &tree["children"][0];
        assert_eq!(frame["name"], "Card");
        assert_eq!(frame["type"], "FRAME");
        assert_eq!(frame["children"].as_array().unwrap().len(), 1);
        let rect = &frame["children"][0];
        assert_eq!(rect["type"], "RECTANGLE");
        assert_eq!(rect["fills"][0]["color"], "#FF0000");
        // Depth 0 reports counts instead of subtrees.
        let shallow: serde_json::Value = serde_json::from_str(&engine.describe_page(0).unwrap()).unwrap();
        assert_eq!(shallow["childCount"], 1);
        assert!(shallow.get("children").is_none());
    }

    #[test]
    fn describe_node_reports_props_and_rejects_unknown_ids() {
        let mut engine = Engine::new();
        let id = rect(&mut engine, 5.0, 6.0);
        let v: serde_json::Value = serde_json::from_str(&engine.describe_node(id).unwrap()).unwrap();
        assert_eq!(v["id"], id);
        assert_eq!(v["x"], 5.0);
        assert_eq!(v["width"], 100.0);
        assert!(engine.describe_node(999_999).is_err());
    }

    /// Mirrors the TypeScript UND→FC converter emission step for step: if the
    /// converter's command sequence ever drifts from what the engine accepts,
    /// this test (and its TS twin) fails first.
    #[test]
    fn migration_script_builds_a_full_page() {
        let mut engine = Engine::new();
        // Pages.
        let pages: serde_json::Value = serde_json::from_str(
            &engine.execute("page.list", "{}").unwrap(),
        )
        .unwrap();
        assert_eq!(pages.as_array().unwrap().len(), 1);
        let p2: u64 = serde_json::from_str::<serde_json::Value>(
            &engine.execute("page.add", r#"{"name":"Second"}"#).unwrap(),
        )
        .unwrap()["id"]
            .as_u64()
            .unwrap();
        engine
            .execute("page.select", &format!(r#"{{"id":{p2}}}"#))
            .unwrap();
        engine
            .execute("page.rename", &format!(r#"{{"id":{p2},"name":"Renamed"}}"#))
            .unwrap();
        // Frame + shapes with props.
        let f: u64 = serde_json::from_str::<serde_json::Value>(
            &engine.execute("node.create", r#"{"type":"frame","name":"Card","x":10,"y":20,"width":300,"height":200,"props":{"fills":[]}}"#).unwrap(),
        )
        .unwrap()["id"]
            .as_u64()
            .unwrap();
        let r: u64 = serde_json::from_str::<serde_json::Value>(
            &engine.execute("shape.rectangle", &format!(r##"{{"x":16,"y":12,"width":80,"height":32,"parent":{f},"props":{{"fill":"#FF4D00","cornerRadius":8}}}}"##)).unwrap(),
        )
        .unwrap()["id"]
            .as_u64()
            .unwrap();
        let e: u64 = serde_json::from_str::<serde_json::Value>(
            &engine.execute("shape.ellipse", &format!(r#"{{"x":16,"y":60,"width":40,"height":40,"parent":{f}}}"#)).unwrap(),
        )
        .unwrap()["id"]
            .as_u64()
            .unwrap();
        // Text with typography.
        let t: u64 = serde_json::from_str::<serde_json::Value>(
            &engine.execute("text.create", &format!(r#"{{"text":"Hello","x":16,"y":110,"parent":{f},"props":{{"fontSize":24}}}}"#)).unwrap(),
        )
        .unwrap()["id"]
            .as_u64()
            .unwrap();
        engine
            .execute("text.set", &format!(r#"{{"id":{t},"characters":"Hello!"}}"#))
            .unwrap();
        engine
            .execute("node.set", &format!(r#"{{"id":{t},"props":{{"fontSize":20,"textAlign":"center"}}}}"#))
            .unwrap();
        // Geometry + style edits.
        engine
            .execute("node.set", &format!(r#"{{"id":{r},"props":{{"name":"Chip","opacity":0.5,"rotation":15}}}}"#))
            .unwrap();
        engine
            .execute("fill.set", &format!(r##"{{"ids":[{r}],"color":"#00FF00"}}"##))
            .unwrap();
        engine
            .execute("stroke.set", &format!(r##"{{"ids":[{r}],"color":"#000000"}}"##))
            .unwrap();
        engine
            .execute("node.set", &format!(r#"{{"id":{r},"props":{{"strokeWeight":2}}}}"#))
            .unwrap();
        // Singular stroke + typed translucent fill (the converter's forms).
        engine
            .execute("node.set", &format!(r##"{{"id":{e},"props":{{"stroke":"#112233","strokeWeight":3}}}}"##))
            .unwrap();
        engine
            .execute(
                "node.set",
                &format!(r##"{{"id":{e},"props":{{"fills":[{{"type":"solid","color":"#445566","opacity":0.5}}]}}}}"##),
            )
            .unwrap();
        engine
            .execute("transform.move", &format!(r#"{{"ids":[{e}],"dx":4,"dy":4}}"#))
            .unwrap();
        engine
            .execute("transform.resize", &format!(r#"{{"ids":[{e}],"width":48,"height":48}}"#))
            .unwrap();
        // Duplicate via copy+paste, then delete the copy.
        engine.execute("edit.copy", &format!(r#"{{"ids":[{r}]}}"#)).unwrap();
        let pasted: u64 = serde_json::from_str::<serde_json::Value>(
            &engine.execute("edit.paste", &format!(r#"{{"parent":{f},"x":200,"y":150}}"#)).unwrap(),
        )
        .unwrap()["ids"][0]
            .as_u64()
            .unwrap();
        assert_ne!(pasted, r);
        engine
            .execute("edit.delete", &format!(r#"{{"ids":[{pasted}]}}"#))
            .unwrap();
        // Visibility / lock toggles with explicit values.
        engine
            .execute("object.toggleVisible", &format!(r#"{{"ids":[{e}],"visible":false}}"#))
            .unwrap();
        engine
            .execute("object.toggleLock", &format!(r#"{{"ids":[{e}],"locked":true}}"#))
            .unwrap();
        // Verify the migrated state through describe.
        let tree: serde_json::Value = serde_json::from_str(&engine.describe_page(8).unwrap()).unwrap();
        assert_eq!(tree["children"].as_array().unwrap().len(), 1);
        let frame = &tree["children"][0];
        assert_eq!(frame["children"].as_array().unwrap().len(), 3);
        let chip = &frame["children"][0];
        assert_eq!(chip["name"], "Chip");
        assert_eq!(chip["fills"][0]["color"], "#00FF00");
        assert_eq!(chip["strokes"][0]["color"], "#000000");
        assert_eq!(chip["strokeWeight"], 2.0);
        assert_eq!(chip["opacity"], 0.5);
        assert_eq!(chip["cornerRadius"], 8.0);
        assert_eq!(chip["rotation"], 15.0);
        let ell = &frame["children"][1];
        assert_eq!(ell["visible"], false);
        assert_eq!(ell["locked"], true);
        assert_eq!(ell["x"], 20.0);
        assert_eq!(ell["width"], 48.0);
        assert_eq!(ell["strokes"][0]["color"], "#112233");
        assert_eq!(ell["strokeWeight"], 3.0);
        assert_eq!(ell["fills"][0]["color"], "#445566");
        assert_eq!(ell["fills"][0]["opacity"], 0.5);
        let txt = &frame["children"][2];
        assert_eq!(txt["characters"], "Hello!");
        assert_eq!(txt["fontSize"], 20.0);
        assert_eq!(txt["textAlign"], "center");
        // Hit-testing and marquee see the migrated layers.
        let hit: serde_json::Value = serde_json::from_str(
            &engine.execute("select.layersAt", r#"{"x":30,"y":40}"#).unwrap(),
        )
        .unwrap();
        assert!(!hit["layers"].as_array().unwrap().is_empty(), "hit finds layers");
        let area: serde_json::Value = serde_json::from_str(
            &engine.execute("select.area", r#"{"x":0,"y":0,"width":500,"height":500}"#).unwrap(),
        )
        .unwrap();
        assert_eq!(area["selection"].as_array().unwrap().len(), 1, "marquee selects the frame");
        // The whole script is undoable.
        assert!(engine.undo_depth().0 > 10);
    }

    #[test]
    fn line_rotation_maps_endpoints_clockwise_in_screen_space() {
        let mut engine = Engine::new();
        // UND line (10,20)->(110,80): the engine rotates
        // counter-clockwise-positive about the line's center, so the
        // converter negates the screen-clockwise UND angle (its exact
        // formula) and centers the unrotated line on the UND midpoint.
        let (x0, y0, x1, y1): (f64, f64, f64, f64) = (10.0, 20.0, 110.0, 80.0);
        let len = ((x1 - x0).powi(2) + (y1 - y0).powi(2)).sqrt();
        let deg = -((y1 - y0).atan2(x1 - x0).to_degrees());
        let (cx, cy) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0);
        let out: serde_json::Value = serde_json::from_str(
            &engine
                .execute(
                    "shape.line",
                    &format!(
                        r#"{{"x":{},"y":{},"width":{},"props":{{"rotation":{}}}}}"#,
                        cx - len / 2.0,
                        cy,
                        len,
                        deg
                    ),
                )
                .unwrap(),
        )
        .unwrap();
        let id = out["id"].as_u64().unwrap();
        let v: serde_json::Value = serde_json::from_str(&engine.describe_node(id).unwrap()).unwrap();
        let b = &v["absoluteBounds"];
        assert!((b["x"].as_f64().unwrap() - 10.0).abs() < 1.0, "box x0, got {b}");
        assert!((b["y"].as_f64().unwrap() - 20.0).abs() < 1.0, "box y0, got {b}");
        assert!((b["width"].as_f64().unwrap() - 100.0).abs() < 1.0, "box w, got {b}");
        assert!((b["height"].as_f64().unwrap() - 60.0).abs() < 1.0, "box h, got {b}");
        // The box alone cannot tell up from down: the transform's b
        // coefficient must be positive so the line descends left-to-right.
        let t = engine
            .session
            .doc()
            .unwrap()
            .node(NodeId(id))
            .unwrap()
            .transform
            .as_coeffs();
        assert!(t[1] > 0.0, "line descends left-to-right, got {t:?}");
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
