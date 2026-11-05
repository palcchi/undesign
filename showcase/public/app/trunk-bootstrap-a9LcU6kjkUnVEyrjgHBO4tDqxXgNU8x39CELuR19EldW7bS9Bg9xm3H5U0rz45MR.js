import init, * as bindings from '/app/undesign-web-4483d51a051a4d9b.js';
const wasm = await init({ module_or_path: '/app/undesign-web-505fa4e758ce105c_bg.wasm' });


window.wasmBindings = bindings;


dispatchEvent(new CustomEvent("TrunkApplicationStarted", {detail: {wasm}}));
