//! The browser shell: web `Services` and the eframe web runner.

#[cfg(feature = "agent-relay")]
use serde_json::Value;
use undesign_engine::Session;
use undesign_ui_egui::{ContentsFuture, FigApp, Services};
use wasm_bindgen::JsCast as _;
use wasm_bindgen::JsValue;

const CANVAS_ID: &str = "undesign_canvas";
const LOADING_ID: &str = "undesign_loading";
const STATUS_ID: &str = "undesign_runtime_status";
const READY_MESSAGE: &str = "undesign-runtime:ready";
const ERROR_MESSAGE: &str = "undesign-runtime:error";

/// Update the screen-reader status and, when embedded, tell the same-origin shell what happened.
fn report_runtime_status(message: &str, parent_message: &str) {
    if let Some(document) = web_sys::window().and_then(|window| window.document()) {
        if let Some(status) = document.get_element_by_id(STATUS_ID) {
            status.set_text_content(Some(message));
        }
        if let Some(loading) = document.get_element_by_id(LOADING_ID) {
            loading.set_text_content(Some(message));
        }
    }
    let Some(window) = web_sys::window() else { return };
    let Ok(origin) = window.location().origin() else { return };
    if origin.is_empty() || origin == "null" {
        return;
    }
    let Ok(Some(parent)) = window.parent() else { return };
    if let Err(error) = parent.post_message(&JsValue::from_str(parent_message), &origin) {
        log::warn!("could not report editor startup status to its host: {error:?}");
    }
}

pub fn start() {
    eframe::WebLogger::init(log::LevelFilter::Info).ok();
    wasm_bindgen_futures::spawn_local(async {
        let Some(document) = web_sys::window().and_then(|w| w.document()) else {
            log::error!("no document");
            report_runtime_status("The editor could not start.", ERROR_MESSAGE);
            return;
        };
        let Some(canvas) = document.get_element_by_id(CANVAS_ID).and_then(|e| e.dyn_into::<web_sys::HtmlCanvasElement>().ok()) else {
            log::error!("missing <canvas id=\"{CANVAS_ID}\">");
            report_runtime_status("The editor could not start.", ERROR_MESSAGE);
            return;
        };
        let mut options = eframe::WebOptions::default();
        // `?webgl`: force the WebGL2 backend (troubleshooting, and headless browsers whose WebGPU
        // adapter request returns nothing).
        if query().contains("webgl")
            && let eframe::egui_wgpu::WgpuSetup::CreateNew(create) = &mut options.wgpu_options.wgpu_setup
        {
            create.instance_descriptor.backends = eframe::wgpu::Backends::GL;
        }
        let result = eframe::WebRunner::new()
            .start(
                canvas,
                options,
                Box::new(|cc| {
                    if let Some(rs) = &cc.wgpu_render_state {
                        log::info!("undesign-web: wgpu backend {:?}", rs.adapter.get_info().backend);
                    }
                    let reduce_motion = web_sys::window().and_then(|w| w.match_media("(prefers-reduced-motion: reduce)").ok().flatten());
                    let mut session = Session::new();
                    // Live sessions: the browser joins sessions a desktop app hosts; whatever arrives
                    // on the socket wakes the page for a frame.
                    let ctx = cc.egui_ctx.clone();
                    session.live.install(Box::new(undesign_collab_net::NetLink::new(std::sync::Arc::new(move || ctx.request_repaint()))));
                    let mut fig = FigApp::new(
                        session,
                        Box::new(WebServices {
                            reduce_motion,
                            ctx: cc.egui_ctx.clone(),
                            #[cfg(feature = "agent-relay")]
                            agent_provider: None,
                        }),
                    );
                    // `#join=<link>`: join that session, as opening an invite link does on the desktop.
                    let hash = web_sys::window().and_then(|w| w.location().hash().ok()).unwrap_or_default();
                    if let Some(link) = crate::query::join_link(&hash) {
                        let link = js_sys::decode_uri_component(link).ok().and_then(|s| s.as_string()).unwrap_or_else(|| link.to_string());
                        undesign_ui_egui::live::open_invite(&mut fig, &link);
                    } else if let Some(name) = crate::query::example(&query()) {
                        // `?example=<name>`: open that built-in example (a Motion one plays).
                        undesign_ui_egui::home_examples::open(&mut fig, name, true);
                    }
                    Ok(Box::new(WebShell { fig, ready: false }))
                }),
            )
            .await;
        match result {
            Ok(()) => {
                if let Some(loading) = document.get_element_by_id(LOADING_ID) {
                    loading.remove();
                }
            }
            Err(error) => {
                log::error!("Undesign WebAssembly editor failed to start: {error:?}");
                report_runtime_status("The editor could not start. Try reloading the page.", ERROR_MESSAGE);
            }
        }
    });
}

fn query() -> String {
    web_sys::window().and_then(|w| w.location().search().ok()).unwrap_or_default()
}

struct WebShell {
    fig: FigApp,
    ready: bool,
}

impl eframe::App for WebShell {
    // `FigApp::ui` runs its own per-frame logic first (fonts, theme), like the desktop app.
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.fig.ui(ui);
        if !self.ready {
            self.ready = true;
            report_runtime_status("Undesign editor ready.", READY_MESSAGE);
            if let Some(loading) = web_sys::window().and_then(|window| window.document()).and_then(|document| document.get_element_by_id(LOADING_ID))
            {
                loading.remove();
            }
        }
    }
}

/// Browser services. Files are opened and imported through the browser's file picker, which hands
/// over their contents (pickers that need a path return nothing, the trait's defaults); files are
/// saved as downloads. Copies go to the system clipboard through egui's output; pastes arrive as
/// paste events with their text (a page can't read the clipboard when it likes).
struct WebServices {
    /// `prefers-reduced-motion: reduce` (it follows the setting while the page is open).
    reduce_motion: Option<web_sys::MediaQueryList>,
    ctx: egui::Context,
    #[cfg(feature = "agent-relay")]
    agent_provider: Option<undesign_ui_egui::agent_provider::AgentProviderConfig>,
}

impl Services for WebServices {
    /// An `<input type="file">` taking `exts`, clicked; its file is read once picked.
    fn pick_open_contents(&mut self, _title: &str, exts: &[&str]) -> Option<ContentsFuture> {
        let accept = exts.iter().map(|e| format!(".{e}")).collect::<Vec<_>>().join(",");
        Some(Box::pin(async move {
            pick_file(&accept).await.unwrap_or_else(|e| {
                log::error!("couldn't open a file: {e:?}");
                None
            })
        }))
    }
    fn downloads(&self) -> bool {
        true
    }
    /// A Blob behind a temporary `<a download>` link, clicked and removed.
    fn download(&mut self, name: &str, bytes: &[u8]) -> bool {
        match download(name, bytes) {
            Ok(()) => true,
            Err(e) => {
                log::error!("couldn't download {name}: {e:?}");
                false
            }
        }
    }
    fn clipboard_set_text(&mut self, s: &str) {
        undesign_ui_egui::egui_copy_text(&self.ctx, s);
    }
    fn clipboard_set_png(&mut self, w: u32, h: u32, rgba: &[u8]) {
        undesign_ui_egui::egui_copy_png(&self.ctx, w, h, rgba);
    }
    fn open_url(&mut self, url: &str) {
        let Some(window) = web_sys::window() else { return };
        if let Err(e) = window.open_with_url_and_target_and_features(url, "_blank", "noopener,noreferrer") {
            log::error!("couldn't open {url}: {e:?}");
        }
    }
    fn reduce_motion(&self) -> bool {
        self.reduce_motion.as_ref().is_some_and(web_sys::MediaQueryList::matches)
    }
    /// The browser's language (`navigator.language`).
    fn system_language(&self) -> Option<String> {
        web_sys::window().and_then(|w| w.navigator().language())
    }
    /// The Gamepad API's controllers with the standard mapping (its button order is the layout's;
    /// others are skipped). Browsers list controllers once one of their buttons is pressed.
    fn gamepad_held(&mut self) -> u32 {
        let Some(pads) = web_sys::window().and_then(|w| w.navigator().get_gamepads().ok()) else { return 0 };
        let mut held = 0;
        for pad in pads.iter().filter_map(|p| p.dyn_into::<web_sys::Gamepad>().ok()) {
            if pad.mapping() != web_sys::GamepadMappingType::Standard {
                continue;
            }
            for (i, b) in pad.buttons().iter().take(32).enumerate() {
                if b.dyn_into::<web_sys::GamepadButton>().is_ok_and(|b| b.pressed()) {
                    held |= 1 << i;
                }
            }
        }
        held
    }
    fn agent_provider_availability(&self) -> undesign_ui_egui::agent_provider::AgentProviderAvailability {
        #[cfg(feature = "agent-relay")]
        {
            undesign_ui_egui::agent_provider::AgentProviderAvailability::BrowserMetaRelay
        }
        #[cfg(not(feature = "agent-relay"))]
        {
            undesign_ui_egui::agent_provider::AgentProviderAvailability::BrowserRelayRequired
        }
    }
    #[cfg(feature = "agent-relay")]
    fn agent_provider_connected(&self) -> bool {
        self.agent_provider.is_some()
    }
    #[cfg(feature = "agent-relay")]
    fn agent_provider_model(&self) -> Option<&str> {
        self.agent_provider.as_ref().map(undesign_ui_egui::agent_provider::AgentProviderConfig::model)
    }
    #[cfg(feature = "agent-relay")]
    fn connect_agent_provider(&mut self, config: undesign_ui_egui::agent_provider::AgentProviderConfig) -> Result<(), String> {
        if config.endpoint() != undesign_ui_egui::agent_provider::META_RELAY_ENDPOINT {
            return Err("The browser relay uses a fixed Meta API endpoint.".to_string());
        }
        undesign_ui_egui::agent_provider::validate_model_id(config.model())?;
        self.agent_provider = Some(config);
        Ok(())
    }
    #[cfg(feature = "agent-relay")]
    fn disconnect_agent_provider(&mut self) {
        self.agent_provider = None;
    }
    #[cfg(feature = "agent-relay")]
    fn request_agent_completion(&mut self, request: Value) -> Result<undesign_ui_egui::agent_provider::AgentProviderTask, String> {
        use undesign_ui_egui::agent_provider::{AgentProviderTask, MAX_PROVIDER_REQUEST_BYTES};

        let config = self.agent_provider.as_ref().ok_or_else(|| "Connect your own Meta API key before sending.".to_string())?;
        if request.get("model").and_then(Value::as_str) != Some(config.model()) {
            return Err("The request model does not match the connected Meta model ID.".to_string());
        }
        let body = serde_json::to_string(&request).map_err(|_| "Could not encode the relay request.".to_string())?;
        if body.len() > MAX_PROVIDER_REQUEST_BYTES {
            return Err("The chat and current-page context exceed the relay request limit.".to_string());
        }
        let secret = config.duplicate_secret_for_request();
        let (sender, receiver) = std::sync::mpsc::channel();
        wasm_bindgen_futures::spawn_local(async move {
            let result = browser_relay_completion(body, secret).await;
            let _ = sender.send(result);
        });
        Ok(AgentProviderTask::new(receiver))
    }
}

#[cfg(feature = "agent-relay")]
async fn browser_relay_completion(
    body: String,
    secret: undesign_ui_egui::agent_provider::AgentSecret,
) -> Result<undesign_ui_egui::agent_provider::AgentProviderReply, String> {
    use undesign_ui_egui::agent_provider::{MAX_PROVIDER_RESPONSE_BYTES, parse_openai_response};
    use wasm_bindgen_futures::JsFuture;
    use zeroize::Zeroizing;

    let window = web_sys::window().ok_or_else(|| "The browser relay is unavailable.".to_string())?;
    let session_init = web_sys::RequestInit::new();
    session_init.set_method("POST");
    session_init.set_credentials(web_sys::RequestCredentials::SameOrigin);
    session_init.set_redirect(web_sys::RequestRedirect::Error);
    let session_request =
        web_sys::Request::new_with_str_and_init("/api/session", &session_init).map_err(|_| "Could not start a secure relay session.".to_string())?;
    let session_response = JsFuture::from(window.fetch_with_request(&session_request))
        .await
        .map_err(|_| "Could not start a secure relay session.".to_string())?
        .dyn_into::<web_sys::Response>()
        .map_err(|_| "The secure relay returned an invalid session response.".to_string())?;
    if !session_response.ok() {
        return Err("Could not start a secure relay session.".to_string());
    }
    let session_text = JsFuture::from(session_response.text().map_err(|_| "Could not read the secure relay session.".to_string())?)
        .await
        .map_err(|_| "Could not read the secure relay session.".to_string())?
        .as_string()
        .ok_or_else(|| "The secure relay returned an invalid session response.".to_string())?;
    if session_text.len() > 16 * 1024 {
        return Err("The secure relay session response is too large.".to_string());
    }
    let session: Value = serde_json::from_str(&session_text).map_err(|_| "The secure relay returned an invalid session response.".to_string())?;
    let csrf_token = session
        .get("csrfToken")
        .and_then(Value::as_str)
        .filter(|token| !token.is_empty() && token.len() <= 4096)
        .ok_or_else(|| "The secure relay returned an invalid session token.".to_string())?;

    let key = Zeroizing::new(String::from_utf8(secret.expose_bytes().to_vec()).map_err(|_| "The API key is invalid.".to_string())?);
    let headers = web_sys::Headers::new().map_err(|_| "Could not prepare the secure relay request.".to_string())?;
    headers
        .set("Content-Type", "application/json")
        .and_then(|_| headers.set("X-CSRF-Token", csrf_token))
        .and_then(|_| headers.set("X-User-Key", key.as_str()))
        .map_err(|_| "Could not prepare the secure relay request.".to_string())?;
    let agent_init = web_sys::RequestInit::new();
    agent_init.set_method("POST");
    agent_init.set_credentials(web_sys::RequestCredentials::SameOrigin);
    agent_init.set_redirect(web_sys::RequestRedirect::Error);
    agent_init.set_headers(&headers);
    agent_init.set_body(&wasm_bindgen::JsValue::from_str(&body));
    let agent_request = match web_sys::Request::new_with_str_and_init("/api/agent", &agent_init) {
        Ok(request) => request,
        Err(_) => {
            let _ = headers.delete("X-User-Key");
            let _ = headers.delete("X-CSRF-Token");
            return Err("Could not prepare the secure relay request.".to_string());
        }
    };
    let response_result = JsFuture::from(window.fetch_with_request(&agent_request)).await;
    // Headers are copied into Request by the web platform; clear both JS header maps promptly.
    let _ = headers.delete("X-User-Key");
    let _ = agent_request.headers().delete("X-User-Key");
    let _ = headers.delete("X-CSRF-Token");
    let _ = agent_request.headers().delete("X-CSRF-Token");
    drop(key);
    let response = response_result
        .map_err(|_| "The secure relay request failed.".to_string())?
        .dyn_into::<web_sys::Response>()
        .map_err(|_| "The secure relay returned an invalid response.".to_string())?;
    if !response.ok() {
        return Err("The secure relay could not complete the request.".to_string());
    }
    let text = JsFuture::from(response.text().map_err(|_| "Could not read the relay response.".to_string())?)
        .await
        .map_err(|_| "Could not read the relay response.".to_string())?
        .as_string()
        .ok_or_else(|| "The relay returned an invalid response.".to_string())?;
    if text.len() > MAX_PROVIDER_RESPONSE_BYTES {
        return Err("The provider response exceeds the size limit.".to_string());
    }
    parse_openai_response(&text)
}

/// The file picked in the browser's file picker (`accept`: the extensions it offers), with its
/// name; `None` when the picker is cancelled, `Some(Err)` with what to tell the user when the file
/// can't be read.
async fn pick_file(accept: &str) -> Result<Option<Result<(String, Vec<u8>), String>>, wasm_bindgen::JsValue> {
    let window = web_sys::window().ok_or("no window")?;
    let document = window.document().ok_or("no document")?;
    let body = document.body().ok_or("no body")?;
    let input: web_sys::HtmlInputElement = document.create_element("input")?.dyn_into()?;
    input.set_type("file");
    input.set_accept(accept);
    input.set_hidden(true);
    // Some browsers (older Safari) open the picker only for an input in the page.
    body.append_child(&input)?;
    let (closed, picker) = PickerClosed::new(&window, input.clone());
    input.click();
    let result = wasm_bindgen_futures::JsFuture::from(closed).await;
    let file = input.files().and_then(|files| files.get(0));
    drop(picker);
    result?;
    let Some(file) = file else { return Ok(None) };
    let name = file.name();
    if let Err(why) = undesign_ui_egui::browser_can_read(&name, file.size()) {
        return Ok(Some(Err(why)));
    }
    Ok(Some(match wasm_bindgen_futures::JsFuture::from(file.array_buffer()).await {
        Ok(buffer) => Ok((name, js_sys::Uint8Array::new(&buffer).to_vec())),
        Err(e) => {
            log::error!("couldn't read {name}: {e:?}");
            Err(undesign_ui_egui::unreadable(&name))
        }
    }))
}

/// How long after the page gets focus back the file picker counts as closed (milliseconds): a
/// picked file's `change` can come just after the focus, and must win. A `change` later than this
/// (a slow cloud-backed file in a browser that never sends `cancel`) counts as a cancel.
const PICKER_FOCUS_SETTLE_MS: i32 = 1_000;

/// Settles a file picker's promise once: on `change` (a file was picked), on `cancel` (closed
/// without one) or shortly after the page gets focus back, for browsers that never send `cancel`
/// (Safari before 16.4), where the pick would otherwise stay pending and block every later one.
/// Dropping it (also when the pick is abandoned) removes the input, the focus listener and its timer.
struct PickerClosed {
    window: web_sys::Window,
    input: web_sys::HtmlInputElement,
    _settle: wasm_bindgen::closure::Closure<dyn FnMut()>,
    on_focus: wasm_bindgen::closure::Closure<dyn FnMut()>,
    timer: std::rc::Rc<std::cell::Cell<Option<i32>>>,
}

impl PickerClosed {
    fn new(window: &web_sys::Window, input: web_sys::HtmlInputElement) -> (js_sys::Promise, Self) {
        let resolve = std::rc::Rc::new(std::cell::RefCell::new(None::<js_sys::Function>));
        let slot = resolve.clone();
        let closed = js_sys::Promise::new(&mut |res, _rej| *slot.borrow_mut() = Some(res));
        let settle = wasm_bindgen::closure::Closure::<dyn FnMut()>::new(move || {
            if let Some(res) = resolve.borrow_mut().take() {
                let _ = res.call0(&wasm_bindgen::JsValue::NULL);
            }
        });
        let _ = input.add_event_listener_with_callback("change", settle.as_ref().unchecked_ref());
        let _ = input.add_event_listener_with_callback("cancel", settle.as_ref().unchecked_ref());
        let timer = std::rc::Rc::new(std::cell::Cell::new(None));
        let (w, t, f) = (window.clone(), timer.clone(), settle.as_ref().unchecked_ref::<js_sys::Function>().clone());
        let on_focus = wasm_bindgen::closure::Closure::<dyn FnMut()>::new(move || {
            if t.get().is_none() {
                t.set(w.set_timeout_with_callback_and_timeout_and_arguments_0(&f, PICKER_FOCUS_SETTLE_MS).ok());
            }
        });
        let _ = window.add_event_listener_with_callback("focus", on_focus.as_ref().unchecked_ref());
        (closed, Self { window: window.clone(), input, _settle: settle, on_focus, timer })
    }
}

impl Drop for PickerClosed {
    fn drop(&mut self) {
        if let Some(t) = self.timer.take() {
            self.window.clear_timeout_with_handle(t);
        }
        let _ = self.window.remove_event_listener_with_callback("focus", self.on_focus.as_ref().unchecked_ref());
        self.input.remove();
    }
}

fn download(name: &str, bytes: &[u8]) -> Result<(), wasm_bindgen::JsValue> {
    let window = web_sys::window().ok_or("no window")?;
    let document = window.document().ok_or("no document")?;
    let body = document.body().ok_or("no body")?;
    let parts = js_sys::Array::of1(&js_sys::Uint8Array::from(bytes));
    let blob = web_sys::Blob::new_with_u8_array_sequence_and_options(&parts, &{
        let o = web_sys::BlobPropertyBag::new();
        o.set_type("application/octet-stream");
        o
    })?;
    let url = web_sys::Url::create_object_url_with_blob(&blob)?;
    let a: web_sys::HtmlAnchorElement = document.create_element("a")?.dyn_into()?;
    a.set_href(&url);
    a.set_download(name);
    body.append_child(&a)?;
    a.click();
    a.remove();
    // Revoked later, not at once: some browsers cancel a download whose URL goes before it starts.
    let revoke = wasm_bindgen::closure::Closure::once_into_js(move || {
        let _ = web_sys::Url::revoke_object_url(&url);
    });
    // Without the timer the URL just stays until the page closes.
    let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(revoke.unchecked_ref(), REVOKE_DOWNLOAD_MS);
    Ok(())
}

/// How long a download's object URL is kept (milliseconds).
const REVOKE_DOWNLOAD_MS: i32 = 40_000;
