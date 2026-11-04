import init, * as bindings from './undesign-web-7cb74b22ae625613.js';
const wasm = await init({ module_or_path: './undesign-web-51f086defd6770e8_bg.wasm' });


window.wasmBindings = bindings;


dispatchEvent(new CustomEvent("TrunkApplicationStarted", {detail: {wasm}}));
