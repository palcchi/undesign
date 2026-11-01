//! Structural validation and clamping. The engine remains the semantic backstop (it
//! refuses bad values and the batch rolls back); this layer only guarantees shape:
//! whitelisted ids, object params, capped sizes and counts, finite numbers, and a few
//! clamped fields with global meaning (`opacity`). Step references (`{"$step": n}`)
//! pass through untouched so later steps can reuse ids earlier steps created.

use serde_json::Value;

use crate::error::{Error, Result};
use crate::plan::Plan;
use crate::whitelist::{WHITELIST, is_whitelisted};

/// Most steps a plan may hold (the model is told the same cap).
pub const MAX_COMMANDS: usize = 40;
/// Longest string kept anywhere in a plan (layer text, names); longer ones truncate.
pub const MAX_STRING: usize = 2000;

/// Check a parsed plan and clamp its values. Returns the plan ready for
/// [`crate::apply`], or the first problem found.
pub fn validate(mut plan: Plan) -> Result<Plan> {
    if plan.steps.is_empty() {
        return Err(Error::Invalid("the plan holds no commands".into()));
    }
    if plan.steps.len() > MAX_COMMANDS {
        return Err(Error::Invalid(format!("{} steps exceed the cap of {MAX_COMMANDS}", plan.steps.len())));
    }
    for (i, step) in plan.steps.iter_mut().enumerate() {
        if !is_whitelisted(&step.command) {
            return Err(Error::RejectedCommand { id: step.command.clone(), allowed: WHITELIST.join(", ") });
        }
        clamp_value(&mut step.params).map_err(|why| Error::Invalid(format!("step {i} (\"{}\"): {why}", step.command)))?;
    }
    Ok(plan)
}

/// Clamp one parameter tree in place: truncate long strings, clamp `opacity` into
/// 0–1, and reject non-finite numbers.
fn clamp_value(value: &mut Value) -> std::result::Result<(), String> {
    match value {
        Value::Null | Value::Bool(_) => Ok(()),
        Value::Number(n) => {
            if n.as_f64().is_some_and(f64::is_finite) || n.as_u64().is_some() || n.as_i64().is_some() {
                Ok(())
            } else {
                Err("a number is not finite".into())
            }
        }
        Value::String(s) => {
            truncate(s);
            Ok(())
        }
        Value::Array(items) => items.iter_mut().try_for_each(clamp_value),
        Value::Object(map) => {
            if let Some(opacity) = map.get_mut("opacity")
                && let Some(n) = opacity.as_f64()
            {
                *opacity = Value::from(n.clamp(0.0, 1.0));
            }
            map.values_mut().try_for_each(clamp_value)
        }
    }
}

/// Shorten `s` to [`MAX_STRING`] characters (a char boundary, never mid-character).
fn truncate(s: &mut String) {
    if s.len() > MAX_STRING {
        let mut end = MAX_STRING;
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        s.truncate(end);
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::plan::Step;

    fn plan_of(steps: Vec<Step>) -> Plan {
        Plan { steps }
    }

    fn step(command: &str, params: Value) -> Step {
        Step { command: command.into(), params }
    }

    #[test]
    fn accepts_a_whitelisted_plan() {
        let plan = plan_of(vec![step("shape.rectangle", json!({"x": 1, "y": 2, "width": 3, "height": 4}))]);
        assert_eq!(validate(plan).unwrap().steps.len(), 1);
    }

    #[test]
    fn rejects_foreign_commands_empty_and_oversized_plans() {
        let foreign = plan_of(vec![step("edit.delete", json!({}))]);
        assert!(matches!(validate(foreign), Err(Error::RejectedCommand { .. })));
        assert!(validate(plan_of(vec![])).is_err());
        let big = plan_of((0..MAX_COMMANDS + 1).map(|_| step("node.get", json!({}))).collect());
        assert!(validate(big).is_err());
    }

    #[test]
    fn step_refs_survive_and_values_clamp() {
        let plan = plan_of(vec![
            step("shape.rectangle", json!({"x": 0, "y": 0, "width": 10, "height": 10})),
            step("motion.track.add", json!({"compositionId": {"$step": 0}, "target": {"$step": 0}, "property": "opacity"})),
            step("node.set", json!({"ids": [], "props": {"opacity": 2.5}})),
        ]);
        let checked = validate(plan).unwrap();
        assert_eq!(checked.steps[1].params["target"], json!({"$step": 0}));
        assert_eq!(checked.steps[2].params["props"]["opacity"], json!(1.0));
    }

    #[test]
    fn overlong_strings_truncate_at_a_char_boundary() {
        let long = "x".repeat(MAX_STRING + 100);
        let plan = plan_of(vec![step("text.create", json!({"text": long, "x": 0, "y": 0}))]);
        let checked = validate(plan).unwrap();
        assert_eq!(checked.steps[0].params["text"].as_str().unwrap().len(), MAX_STRING);
        let wide = "é".repeat(MAX_STRING + 100);
        let plan = plan_of(vec![step("text.create", json!({"text": wide, "x": 0, "y": 0}))]);
        let checked = validate(plan).unwrap();
        let text = checked.steps[0].params["text"].as_str().unwrap();
        assert!(text.len() <= MAX_STRING);
        assert!(text.chars().all(|c| c == 'é'));
    }
}
