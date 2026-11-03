//! Import a repository's code-connect mappings into a design file.

use std::ffi::OsStr;
use std::path::Path;
use std::process::ExitCode;

use serde_json::json;
use undesign_engine::Session;

use crate::{CliError, CliResult, files};

/// Apply `mappings` to `design` and save the result as a native `.undesign` file.
pub fn publish(design: &str, mappings: &str, out: &str) -> CliResult<ExitCode> {
    let ext = Path::new(out).extension().and_then(OsStr::to_str).unwrap_or_default();
    if !ext.eq_ignore_ascii_case("undesign") {
        return Err(CliError::Usage(format!("code-connect publish writes a .undesign file, got `{out}`")));
    }
    let source =
        undesign_engine::file_access::allow(design, undesign_engine::file_access::Access::Read).map_err(|e| CliError::Failed(e.to_string()))?;
    let target =
        undesign_engine::file_access::allow(out, undesign_engine::file_access::Access::Write).map_err(|e| CliError::Failed(e.to_string()))?;
    if let (Ok(source), Ok(target)) = (std::fs::canonicalize(source), std::fs::canonicalize(target))
        && source == target
    {
        return Err(CliError::Usage("code-connect publish needs an output file different from the input design".into()));
    }

    let mut session = Session::empty();
    session.execute("file.open", &json!({"path": design})).map_err(|e| CliError::Failed(format!("can't open {design}: {e}")))?;
    let result = session
        .execute("codeConnect.import", &json!({"path": mappings}))
        .map_err(|e| CliError::Failed(format!("can't import mappings from {mappings}: {e}")))?;

    let linked = result["linked"].as_u64().unwrap_or_default();
    let warnings = result["warnings"].as_array().cloned().unwrap_or_default();
    let ds = session.ds().map_err(|e| CliError::Failed(e.to_string()))?;
    let bytes = undesign_engine::cmd::file::file_bytes(ds).map_err(|e| CliError::Failed(e.to_string()))?;
    files::write(out, &bytes)?;

    println!("Applied {linked} code connection{} to {out}.", if linked == 1 { "" } else { "s" });
    for warning in warnings {
        if let Some(warning) = warning.as_str() {
            eprintln!("warning: {warning}");
        }
    }
    Ok(ExitCode::SUCCESS)
}
