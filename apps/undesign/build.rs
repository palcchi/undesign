//! Windows: embed the icon and version info in undesign.exe and size its main thread's stack
//! (no-op elsewhere).
fn main() {
    println!("cargo::rerun-if-changed=../../assets/app-icon/undesign.ico");
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "windows" {
        let mut res = winresource::WindowsResource::new();
        let ico = "../../assets/app-icon/undesign.ico";
        if std::path::Path::new(ico).exists() {
            res.set_icon(ico);
        }
        res.set("ProductName", "Undesign");
        res.set("FileDescription", "Undesign");
        res.set("CompanyName", "Undesign");
        if let Err(e) = res.compile() {
            println!("cargo::warning=winresource: {e}");
        }
        // Windows starts the main thread with 1 MB of stack, Linux and macOS with 8 MB. Layers
        // nest up to 256 deep in an export, and that recursion needs the same room everywhere.
        let msvc = std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
        println!("cargo::rustc-link-arg-bins={}", if msvc { "/STACK:8388608" } else { "-Wl,--stack,8388608" });
    }
    let sha = std::env::var("UNDESIGN_BUILD_SHA").unwrap_or_default();
    println!("cargo::rustc-env=UNDESIGN_BUILD_SHA={sha}");
    println!("cargo::rerun-if-env-changed=UNDESIGN_BUILD_SHA");
}
