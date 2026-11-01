//! Motion compositions, tracks and keyframes.
use serde_json::{Value, json};
use undesign_doc::{AnimatedProperty, AnimationTrack, Composition, Interpolation, Keyframe, MotionDocument, MotionError, NodeId};

use super::CommandSpec;
use crate::cmd::props::enum_of;
use crate::{Result, bad, spec};

fn required_u64(cmd: &str, p: &Value, key: &str) -> Result<u64> {
    p.get(key).and_then(Value::as_u64).ok_or_else(|| bad(cmd, format!("`{key}` must be a non-negative integer")))
}

fn required_u32(cmd: &str, p: &Value, key: &str) -> Result<u32> {
    p.get(key)
        .and_then(Value::as_u64)
        .and_then(|v| u32::try_from(v).ok())
        .ok_or_else(|| bad(cmd, format!("`{key}` must be an integer from 0 to {}", u32::MAX)))
}

fn required_f64(cmd: &str, p: &Value, key: &str) -> Result<f64> {
    p.get(key).and_then(Value::as_f64).filter(|v| v.is_finite()).ok_or_else(|| bad(cmd, format!("`{key}` must be a finite number")))
}

fn composition_index(doc: &MotionDocument, id: u64) -> Option<usize> {
    doc.compositions.iter().position(|c| c.id == id)
}

fn motion_error(cmd: &str, error: MotionError) -> crate::EngineError {
    bad(cmd, error.to_string())
}

pub fn specs() -> Vec<CommandSpec> {
    vec![
        spec!("motion.composition.create", "Create motion composition", "{name?, width?, height?, fps?, durationFrames?}", true, |s, p| {
            let cmd = "motion.composition.create";
            let doc = s.doc_mut()?;
            let id = doc.motion.compositions.iter().map(|c| c.id).max().unwrap_or(0).saturating_add(1);
            let composition = Composition {
                id,
                name: p.get("name").and_then(Value::as_str).unwrap_or("Main").trim().to_string(),
                width: p.get("width").and_then(Value::as_u64).and_then(|v| u32::try_from(v).ok()).unwrap_or(1920),
                height: p.get("height").and_then(Value::as_u64).and_then(|v| u32::try_from(v).ok()).unwrap_or(1080),
                fps: p.get("fps").and_then(Value::as_u64).and_then(|v| u16::try_from(v).ok()).unwrap_or(30),
                duration_frames: p.get("durationFrames").and_then(Value::as_u64).and_then(|v| u32::try_from(v).ok()).unwrap_or(300),
                tracks: Vec::new(),
            };
            if composition.name.is_empty() {
                return Err(bad(cmd, "composition name cannot be empty"));
            }
            composition.validate().map_err(|e| motion_error(cmd, e))?;
            doc.motion.compositions.push(composition);
            Ok(json!({"compositionId": id}))
        }),
        spec!("motion.composition.delete", "Delete motion composition", "{compositionId}", true, |s, p| {
            let cmd = "motion.composition.delete";
            let id = required_u64(cmd, p, "compositionId")?;
            let doc = s.doc_mut()?;
            let index = composition_index(&doc.motion, id).ok_or_else(|| bad(cmd, "no such composition"))?;
            doc.motion.compositions.remove(index);
            Ok(json!({"deleted": id}))
        }),
        spec!("motion.track.add", "Add animation track", "{compositionId, target, property, enabled?}", true, |s, p| {
            let cmd = "motion.track.add";
            let composition_id = required_u64(cmd, p, "compositionId")?;
            let target = NodeId(required_u64(cmd, p, "target")?);
            let property_name = p.get("property").and_then(Value::as_str).ok_or_else(|| bad(cmd, "`property` is required"))?;
            let property: AnimatedProperty =
                enum_of(&Value::String(property_name.to_string())).ok_or_else(|| bad(cmd, "unknown animated property"))?;
            let doc = s.doc_mut()?;
            if !doc.contains(target) {
                return Err(bad(cmd, format!("no such target layer {target}")));
            }
            let composition = doc.motion.compositions.iter_mut().find(|c| c.id == composition_id).ok_or_else(|| bad(cmd, "no such composition"))?;
            if composition.tracks.iter().any(|t| t.target == target && t.property == property) {
                return Err(bad(cmd, "that layer property already has a track"));
            }
            let id = composition.tracks.iter().map(|t| t.id).max().unwrap_or(0).saturating_add(1);
            composition.tracks.push(AnimationTrack {
                id,
                target,
                property,
                enabled: p.get("enabled").and_then(Value::as_bool).unwrap_or(true),
                keyframes: Vec::new(),
            });
            Ok(json!({"trackId": id}))
        }),
        spec!("motion.track.remove", "Remove animation track", "{compositionId, trackId}", true, |s, p| {
            let cmd = "motion.track.remove";
            let composition_id = required_u64(cmd, p, "compositionId")?;
            let track_id = required_u64(cmd, p, "trackId")?;
            let doc = s.doc_mut()?;
            let composition = doc.motion.compositions.iter_mut().find(|c| c.id == composition_id).ok_or_else(|| bad(cmd, "no such composition"))?;
            let index = composition.tracks.iter().position(|t| t.id == track_id).ok_or_else(|| bad(cmd, "no such track"))?;
            composition.tracks.remove(index);
            Ok(json!({"deleted": track_id}))
        }),
        spec!("motion.keyframe.set", "Set keyframe", "{compositionId, trackId, frame, value, interpolation?}", true, |s, p| {
            let cmd = "motion.keyframe.set";
            let composition_id = required_u64(cmd, p, "compositionId")?;
            let track_id = required_u64(cmd, p, "trackId")?;
            let frame = required_u32(cmd, p, "frame")?;
            let value = required_f64(cmd, p, "value")?;
            let interpolation = match p.get("interpolation") {
                None | Some(Value::Null) => Interpolation::Linear,
                Some(Value::String(name)) if name.eq_ignore_ascii_case("step") => Interpolation::Step,
                Some(Value::String(name)) if name.eq_ignore_ascii_case("linear") => Interpolation::Linear,
                Some(v) => serde_json::from_value::<Interpolation>(v.clone()).map_err(|e| bad(cmd, format!("invalid interpolation: {e}")))?,
            };
            let doc = s.doc_mut()?;
            let composition = doc.motion.compositions.iter_mut().find(|c| c.id == composition_id).ok_or_else(|| bad(cmd, "no such composition"))?;
            let track = composition.tracks.iter_mut().find(|t| t.id == track_id).ok_or_else(|| bad(cmd, "no such track"))?;
            let keyframe = Keyframe { frame, value, interpolation };
            if let Some(existing) = track.keyframes.iter_mut().find(|k| k.frame == frame) {
                *existing = keyframe;
            } else {
                track.keyframes.push(keyframe);
                track.keyframes.sort_by_key(|k| k.frame);
            }
            composition.validate().map_err(|e| motion_error(cmd, e))?;
            Ok(json!({"frame": frame, "trackId": track_id}))
        }),
        spec!("motion.keyframe.remove", "Remove keyframe", "{compositionId, trackId, frame}", true, |s, p| {
            let cmd = "motion.keyframe.remove";
            let composition_id = required_u64(cmd, p, "compositionId")?;
            let track_id = required_u64(cmd, p, "trackId")?;
            let frame = required_u32(cmd, p, "frame")?;
            let doc = s.doc_mut()?;
            let composition = doc.motion.compositions.iter_mut().find(|c| c.id == composition_id).ok_or_else(|| bad(cmd, "no such composition"))?;
            let track = composition.tracks.iter_mut().find(|t| t.id == track_id).ok_or_else(|| bad(cmd, "no such track"))?;
            let before = track.keyframes.len();
            track.keyframes.retain(|k| k.frame != frame);
            if before == track.keyframes.len() {
                return Err(bad(cmd, "no keyframe at that frame"));
            }
            Ok(json!({"frame": frame, "trackId": track_id}))
        }),
        spec!("motion.inspect", "Inspect motion composition", "{compositionId?}", false, |s, p| {
            let doc = s.doc()?;
            let Some(id) = p.get("compositionId").and_then(Value::as_u64) else {
                return Ok(serde_json::to_value(&doc.motion).unwrap_or(Value::Null));
            };
            let composition = doc.motion.compositions.iter().find(|c| c.id == id).ok_or_else(|| bad("motion.inspect", "no such composition"))?;
            Ok(serde_json::to_value(composition).unwrap_or(Value::Null))
        }),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Session;

    #[test]
    fn motion_commands_create_and_undo_composition() {
        let mut session = Session::new();
        let before = session.undo_depth().0;
        let result =
            session.execute("motion.composition.create", &json!({"name":"Intro","width":1080,"height":1920,"fps":30,"durationFrames":150})).unwrap();
        assert_eq!(result["compositionId"], 1);
        assert_eq!(session.doc().unwrap().motion.compositions[0].name, "Intro");
        assert_eq!(session.undo_depth().0, before + 1);
        assert!(session.undo().unwrap());
        assert!(session.doc().unwrap().motion.is_empty());
    }

    #[test]
    fn keyframe_commands_keep_frames_sorted_and_validate_bounds() {
        let mut session = Session::new();
        let frame = session.page().unwrap();
        let created = session.execute("motion.composition.create", &json!({"durationFrames":60})).unwrap();
        let composition_id = created["compositionId"].as_u64().unwrap();
        let track = session.execute("motion.track.add", &json!({"compositionId":composition_id,"target":frame.0,"property":"opacity"})).unwrap();
        let track_id = track["trackId"].as_u64().unwrap();
        session.execute("motion.keyframe.set", &json!({"compositionId":composition_id,"trackId":track_id,"frame":30,"value":0.5})).unwrap();
        session.execute("motion.keyframe.set", &json!({"compositionId":composition_id,"trackId":track_id,"frame":0,"value":1.0})).unwrap();
        let keyframes = &session.doc().unwrap().motion.compositions[0].tracks[0].keyframes;
        assert_eq!(keyframes.iter().map(|k| k.frame).collect::<Vec<_>>(), vec![0, 30]);
        assert!(session.execute("motion.keyframe.set", &json!({"compositionId":composition_id,"trackId":track_id,"frame":61,"value":0.0})).is_err());
    }
}
