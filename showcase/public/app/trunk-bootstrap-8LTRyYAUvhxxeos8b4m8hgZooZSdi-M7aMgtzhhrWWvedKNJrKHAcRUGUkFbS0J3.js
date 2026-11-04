import init, * as bindings from './undesign-web-74ad97c7ec5ce02b.js';
const wasm = await init({ module_or_path: './undesign-web-e4a83e92dabbbf80_bg.wasm' });


window.wasmBindings = bindings;


dispatchEvent(new CustomEvent("TrunkApplicationStarted", {detail: {wasm}}));
