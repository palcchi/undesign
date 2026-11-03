//! End-to-end tests for publishing repository code-connect mappings into a design file.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn bin() -> Command {
    let mut path = std::env::current_exe().unwrap();
    path.pop();
    path.pop();
    path.push(format!("undesign-cli{}", std::env::consts::EXE_SUFFIX));
    Command::new(path)
}

fn temp_dir(tag: &str) -> PathBuf {
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("undesign-cli-code-connect-{tag}-{}-{stamp}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn make_design(dir: &Path) -> PathBuf {
    let script = dir.join("make.json");
    let design = dir.join("design.undesign");
    std::fs::write(
        &script,
        r#"[
            {"command":"frame.create","params":{"x":0,"y":0,"width":120,"height":48,"name":"Card"}},
            {"command":"component.create","params":{"ids":[2]}}
        ]"#,
    )
    .unwrap();
    let out = bin().arg("run").arg(&script).arg("--out").arg(&design).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    design
}

fn valid_mappings(dir: &Path) -> PathBuf {
    let mappings = dir.join("undesign.connect.json");
    std::fs::write(
        &mappings,
        r#"{
            "version": 1,
            "links": [
                {"component":"Card","language":"react","importPath":"@acme/ui","name":"Card","template":"<Card />"},
                {"component":"Missing","language":"react","name":"Missing","template":"<Missing />"},
                {"component":"Card","language":"html","name":"Card","template":"<Card />"}
            ]
        }"#,
    )
    .unwrap();
    mappings
}

fn run_publish(design: &Path, mappings: &Path, out: &Path) -> Output {
    bin().arg("code-connect").arg("publish").arg(design).arg("--mappings").arg(mappings).arg("-o").arg(out).output().unwrap()
}

#[test]
fn publish_applies_saves_and_reports_count_and_invalid_or_unknown_mappings() {
    let dir = temp_dir("success");
    let design = make_design(&dir);
    let mappings = valid_mappings(&dir);
    let out = dir.join("connected.undesign");

    let result = run_publish(&design, &mappings, &out);
    assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
    assert!(String::from_utf8_lossy(&result.stdout).contains("Applied 1 code connection to"));
    let warnings = String::from_utf8_lossy(&result.stderr);
    assert!(warnings.contains("no component named \"Missing\""), "{warnings}");
    assert!(warnings.contains("needs component, language"), "{warnings}");
    assert!(out.is_file(), "the new native design was saved");

    let mut saved = undesign_engine::Session::empty();
    saved.execute("file.open", &serde_json::json!({"path": text(&out)})).unwrap();
    let card = saved.doc().unwrap().nodes().find(|n| n.name == "Card").unwrap();
    assert_eq!(card.code_links.len(), 1);
    assert_eq!(card.code_links[0].language, "react");
    assert_eq!(card.code_links[0].import_path, "@acme/ui");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn malformed_or_unsupported_mappings_fail_without_writing_output() {
    let dir = temp_dir("bad-mappings");
    let design = make_design(&dir);
    let mappings = dir.join("bad.json");
    let out = dir.join("must-not-exist.undesign");
    let original = std::fs::read(&design).unwrap();

    let same_path = run_publish(&design, &valid_mappings(&dir), &design);
    assert_eq!(same_path.status.code(), Some(2), "publishing must not replace its input");
    assert_eq!(std::fs::read(&design).unwrap(), original);

    for contents in ["{", r#"{"version":2,"links":[]}"#] {
        std::fs::write(&mappings, contents).unwrap();
        let result = run_publish(&design, &mappings, &out);
        assert_eq!(result.status.code(), Some(1), "{}", String::from_utf8_lossy(&result.stderr));
        assert!(!out.exists(), "invalid mappings must not leave an output file");
    }
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn publish_obeys_automation_read_and_write_roots() {
    let dir = temp_dir("roots");
    let read = dir.join("read");
    let write = dir.join("write");
    std::fs::create_dir_all(&read).unwrap();
    std::fs::create_dir_all(&write).unwrap();
    let design = make_design(&read);
    let mappings = valid_mappings(&read);
    let inside_out = write.join("connected.undesign");

    let ok = bin()
        .arg("code-connect")
        .arg("publish")
        .arg(&design)
        .arg("--mappings")
        .arg(&mappings)
        .arg("-o")
        .arg(&inside_out)
        .arg("--automation-read-root")
        .arg(&read)
        .arg("--automation-write-root")
        .arg(&write)
        .output()
        .unwrap();
    assert!(ok.status.success(), "{}", String::from_utf8_lossy(&ok.stderr));
    assert!(inside_out.is_file());

    let outside_read = dir.join("outside.connect.json");
    std::fs::copy(&mappings, &outside_read).unwrap();
    let refused_read = write.join("refused-read.undesign");
    let read_result = bin()
        .arg("code-connect")
        .arg("publish")
        .arg(&design)
        .arg("--mappings")
        .arg(&outside_read)
        .arg("-o")
        .arg(&refused_read)
        .arg("--automation-read-root")
        .arg(&read)
        .arg("--automation-write-root")
        .arg(&write)
        .output()
        .unwrap();
    assert!(!read_result.status.success());
    assert!(String::from_utf8_lossy(&read_result.stderr).contains("may be read"));
    assert!(!refused_read.exists());

    let outside_write = dir.join("refused-write.undesign");
    let write_result = bin()
        .arg("code-connect")
        .arg("publish")
        .arg(&design)
        .arg("--mappings")
        .arg(&mappings)
        .arg("-o")
        .arg(&outside_write)
        .arg("--automation-read-root")
        .arg(&read)
        .arg("--automation-write-root")
        .arg(&write)
        .output()
        .unwrap();
    assert!(!write_result.status.success());
    assert!(String::from_utf8_lossy(&write_result.stderr).contains("may be written"));
    assert!(!outside_write.exists());
    let _ = std::fs::remove_dir_all(dir);
}
