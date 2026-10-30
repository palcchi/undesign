//! Command-line parsing: files, the control port and invite links.

use crate::args::{Args, file_url_path, is_invite, parse};

fn args(a: &[&str]) -> Vec<String> {
    a.iter().map(ToString::to_string).collect()
}

#[test]
fn files_and_the_control_port() {
    assert_eq!(parse(&args(&[])), Args::default());
    let a = parse(&args(&["--control", "4242", "a.undesign", "b.svg"]));
    assert_eq!(a, Args { control: Some(4242), files: args(&["a.undesign", "b.svg"]), ..Args::default() });
    // A missing or bad port is ignored, not taken as a file.
    assert_eq!(parse(&args(&["--control"])), Args::default());
    assert_eq!(parse(&args(&["--control", "nope"])).control, None);
}

#[test]
fn the_control_port_accepts_the_equals_form() {
    let a = parse(&args(&["--control=7980", "a.undesign"]));
    assert_eq!(a, Args { control: Some(7980), files: args(&["a.undesign"]), ..Args::default() });
    // A bad port is ignored, not taken as a file.
    assert_eq!(parse(&args(&["--control=nope"])), Args::default());
}

#[test]
fn automation_roots_repeat_and_are_never_files() {
    let a = parse(&args(&["--automation-read-root", "in", "--automation-write-root=out", "--automation-read-root=more", "a.undesign"]));
    assert_eq!(a.read_roots, args(&["in", "more"]));
    assert_eq!(a.write_roots, args(&["out"]));
    assert_eq!(a.files, args(&["a.undesign"]));
    // A flag without its folder is kept as an empty one, which startup refuses.
    assert_eq!(parse(&args(&["--automation-write-root"])).write_roots, args(&[""]));
}

#[test]
fn unknown_flags_are_refused_never_ignored() {
    // #836: a mistyped root flag (or one an older release lacks) must stop the app, not start it
    // unconfined. Both forms, with and without `=`.
    let a = parse(&args(&["--automation-write-roots", "out", "--automation-write-dir=out", "--verbose", "a.undesign"]));
    assert_eq!(a.unknown, args(&["--automation-write-roots", "--automation-write-dir=out", "--verbose"]));
    assert!(a.write_roots.is_empty());
    // Single-dash arguments are left as they were (files); after `--` everything is a file.
    let a = parse(&args(&["--control", "1", "--", "--odd.undesign", "--automation-write-root=x"]));
    assert_eq!(a.files, args(&["--odd.undesign", "--automation-write-root=x"]));
    assert!(a.unknown.is_empty() && a.write_roots.is_empty());
}

#[test]
fn invite_links_join_instead_of_opening() {
    let link = "undesign://join?host=192.168.1.20:47900&file=abc&token=AbCdEfGhIjKlMnOpQrStUv";
    let a = parse(&args(&[link]));
    assert_eq!(a.join.as_deref(), Some(link));
    assert!(a.files.is_empty(), "a link is never opened as a file");
    // How browsers and shells pass it: any case, a slash after `join`, alongside files.
    let a = parse(&args(&["design.undesign", "UNDESIGN://join/?host=h:1&file=f&token=t"]));
    assert_eq!(a.files, args(&["design.undesign"]));
    assert_eq!(a.join.as_deref(), Some("UNDESIGN://join/?host=h:1&file=f&token=t"));
    assert!(is_invite("undesign:join") && !is_invite("undesign.svg") && !is_invite("fig") && !is_invite("ü€undesign:"));
}

#[test]
fn file_urls_are_paths() {
    // What a Linux desktop passes for `%U`.
    let a = parse(&args(&["file:///home/ada/My%20Designs/a+b.undesign", "FILE://localhost/tmp/x.svg"]));
    assert_eq!(a.files, args(&["/home/ada/My Designs/a+b.undesign", "/tmp/x.svg"]), "spaces decoded, plus signs kept");
    assert_eq!(file_url_path("file:///%E2%82%AC.png").as_deref(), Some("/€.png"));
    let win = file_url_path("file:///C:/Designs/a.undesign");
    assert_eq!(win.as_deref(), Some(if cfg!(windows) { "C:/Designs/a.undesign" } else { "/C:/Designs/a.undesign" }));
    for bad in ["file://server/share/a.svg", "file:///broken%2", "file:///bad%zz", "file:///%FF", "file:", "fi", "ü€file:///x"] {
        assert_eq!(file_url_path(bad), None, "{bad}");
    }
}
