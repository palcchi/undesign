//! The agent's command whitelist: the 14 commands that suffice for 2D animation
//! demos (create shapes and text, set properties, build compositions, tracks and
//! keyframes). Everything the model sees about them — labels, parameter docs — is read
//! from the engine registry at runtime, so the registry stays the single source of truth
//! and a renamed command fails closed instead of silently mismatching.

use crate::error::{Error, Result};

/// Engine command ids the agent may run, in prompt order.
pub const WHITELIST: &[&str] = &[
    "shape.rectangle",
    "shape.ellipse",
    "text.create",
    "node.set",
    "node.get",
    "fill.set",
    "transform.moveTo",
    "transform.resize",
    "motion.composition.create",
    "motion.track.add",
    "motion.keyframe.set",
    "motion.keyframe.move",
    "motion.keyframe.remove",
    "motion.track.remove",
];

/// Whether `id` is on the whitelist.
pub fn is_whitelisted(id: &str) -> bool {
    WHITELIST.contains(&id)
}

/// One whitelisted command's registry entry, for the system prompt.
#[derive(Clone, Copy, Debug)]
pub struct CommandDoc {
    /// Engine command id.
    pub id: &'static str,
    /// Human label from the registry.
    pub label: &'static str,
    /// Parameter documentation from the registry, verbatim.
    pub params: &'static str,
}

/// The whitelist resolved against the live registry. Fails closed when a whitelisted
/// id no longer exists, so a registry rename can never desync the prompt.
pub fn registry_docs() -> Result<Vec<CommandDoc>> {
    WHITELIST
        .iter()
        .map(|id| {
            undesign_engine::find_command(id)
                .map(|spec| CommandDoc { id: spec.id, label: spec.label, params: spec.params })
                .ok_or_else(|| Error::Invalid(format!("whitelisted command `{id}` is not in the engine registry")))
        })
        .collect()
}

/// The whitelist rendered for the system prompt: one line per command with its
/// registry parameter docs.
pub fn prompt_section() -> Result<String> {
    let mut out = String::from("You may use ONLY these commands, with these parameters:\n");
    for doc in registry_docs()? {
        out.push_str(&format!("- {} — {}\n  params: {}\n", doc.id, doc.label, doc.params));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_whitelisted_command_resolves_in_the_registry() {
        let docs = registry_docs().unwrap();
        assert_eq!(docs.len(), WHITELIST.len());
        for (id, doc) in WHITELIST.iter().zip(docs.iter()) {
            assert_eq!(id, &doc.id);
            assert!(!doc.label.is_empty(), "{id} has no label");
            assert!(!doc.params.is_empty(), "{id} has no parameter docs");
        }
    }

    #[test]
    fn prompt_section_names_every_command() {
        let section = prompt_section().unwrap();
        for id in WHITELIST {
            assert!(section.contains(id), "prompt omits {id}");
        }
    }
}
