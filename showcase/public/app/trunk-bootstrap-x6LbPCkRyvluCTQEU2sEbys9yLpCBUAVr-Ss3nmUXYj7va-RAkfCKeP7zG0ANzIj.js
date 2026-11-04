import init, * as bindings from './undesign-web-66fd50dd09cfe65.js';
const wasm = await init({ module_or_path: './undesign-web-c5976d84b6aea67c_bg.wasm' });


window.wasmBindings = bindings;


dispatchEvent(new CustomEvent("TrunkApplicationStarted", {detail: {wasm}}));
