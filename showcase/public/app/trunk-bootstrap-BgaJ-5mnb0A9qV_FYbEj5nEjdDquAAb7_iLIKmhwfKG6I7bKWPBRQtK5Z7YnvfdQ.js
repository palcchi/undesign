import init, * as bindings from './undesign-web-1b88d857c5225d1.js';
const wasm = await init({ module_or_path: './undesign-web-f24e125d8cd5aaa3_bg.wasm' });


window.wasmBindings = bindings;


dispatchEvent(new CustomEvent("TrunkApplicationStarted", {detail: {wasm}}));
