//! A plan: the model's reply parsed into batch steps. The JSON shape is the same as
//! `command.batch` takes, so a validated plan applies unchanged.

use serde_json::Value;

use crate::error::{Error, Result};

/// One whitelisted engine command with its parameters.
#[derive(Clone, Debug)]
pub struct Step {
    /// Engine command id (checked against the whitelist by [`crate::validate`]).
    pub command: String,
    /// Its parameters (an object; `{"$step": n}` refs survive validation).
    pub params: Value,
}

/// The model's reply: an ordered list of steps.
#[derive(Clone, Debug, Default)]
pub struct Plan {
    /// Steps in run order.
    pub steps: Vec<Step>,
}

/// Parse provider text into a plan. Accepts raw JSON or one ```json fenced block;
/// anything else is [`Error::BadPlan`] (the turn driver retries once with the message).
pub fn parse_plan(text: &str) -> Result<Plan> {
    let json = unfenced(text.trim());
    let value: Value = serde_json::from_str(json).map_err(|e| Error::BadPlan(format!("not JSON: {e}")))?;
    let steps = value.get("commands").and_then(Value::as_array).ok_or_else(|| Error::BadPlan("want {\"commands\": [...]}".into()))?;
    let mut out = Vec::with_capacity(steps.len());
    for (i, step) in steps.iter().enumerate() {
        let command = step.get("command").and_then(Value::as_str).ok_or_else(|| Error::BadPlan(format!("step {i} has no \"command\" string")))?;
        let params = step.get("params").cloned().unwrap_or_else(|| Value::Object(Default::default()));
        if !params.is_object() {
            return Err(Error::BadPlan(format!("step {i} (\"{command}\"): \"params\" must be an object")));
        }
        out.push(Step { command: command.to_string(), params });
    }
    Ok(Plan { steps: out })
}

/// Strip one optional Markdown fence; anything else passes through untouched.
fn unfenced(text: &str) -> &str {
    let mut rest = text;
    if let Some(after) = rest.strip_prefix("```") {
        rest = after.split_once('\n').map(|(_, body)| body).unwrap_or("");
    }
    rest.trim().strip_suffix("```").map(str::trim).unwrap_or(rest.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_raw_and_fenced_plans() {
        let raw = r#"{"commands": [{"command": "shape.rectangle", "params": {"x": 1}}]}"#;
        assert_eq!(parse_plan(raw).unwrap().steps.len(), 1);
        let fenced = "```json\n{\"commands\": []}\n```";
        assert!(parse_plan(fenced).unwrap().steps.is_empty());
        let bare = "```\n{\"commands\": []}\n```";
        assert!(parse_plan(bare).unwrap().steps.is_empty());
    }

    #[test]
    fn rejects_non_json_and_bad_shapes() {
        assert!(parse_plan("hello").is_err());
        assert!(parse_plan("{}").is_err());
        assert!(parse_plan(r#"{"commands": [{"params": {}}]}"#).is_err());
        assert!(parse_plan(r#"{"commands": [{"command": "x", "params": []}]}"#).is_err());
    }

    #[test]
    fn missing_params_default_to_an_empty_object() {
        let plan = parse_plan(r#"{"commands": [{"command": "motion.timeline"}]}"#).unwrap();
        assert_eq!(plan.steps[0].params, serde_json::json!({}));
    }
}
