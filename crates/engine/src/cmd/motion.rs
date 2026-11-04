//! Motion compositions, tracks and keyframes.
use std::collections::BTreeMap;

use serde_json::{Map, Value, json};
use undesign_doc::{
    AnimatedProperty, AnimationTrack, Composition, Document, Interpolation, Keyframe, MotionDocument, MotionError, NodeId, SampledTrack,
};

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
        spec!("motion.keyframe.move", "Move keyframe", "{compositionId, trackId, fromFrame, toFrame}", true, |s, p| {
            let cmd = "motion.keyframe.move";
            let composition_id = required_u64(cmd, p, "compositionId")?;
            let track_id = required_u64(cmd, p, "trackId")?;
            let from_frame = required_u32(cmd, p, "fromFrame")?;
            let to_frame = required_u32(cmd, p, "toFrame")?;
            let doc = s.doc_mut()?;
            let composition = doc.motion.compositions.iter_mut().find(|c| c.id == composition_id).ok_or_else(|| bad(cmd, "no such composition"))?;
            let track = composition.tracks.iter_mut().find(|t| t.id == track_id).ok_or_else(|| bad(cmd, "no such track"))?;
            let index = track.keyframes.iter().position(|k| k.frame == from_frame).ok_or_else(|| bad(cmd, "no keyframe at the source frame"))?;
            if from_frame == to_frame {
                return Ok(json!({"fromFrame": from_frame, "toFrame": to_frame, "trackId": track_id}));
            }
            if track.keyframes.iter().any(|k| k.frame == to_frame) {
                return Err(bad(cmd, "a keyframe already exists at the destination frame"));
            }
            let mut keyframe = track.keyframes.remove(index);
            keyframe.frame = to_frame;
            track.keyframes.push(keyframe);
            track.keyframes.sort_by_key(|k| k.frame);
            composition.validate().map_err(|e| motion_error(cmd, e))?;
            Ok(json!({"fromFrame": from_frame, "toFrame": to_frame, "trackId": track_id}))
        }),
        spec!("motion.keyframe.duplicate", "Duplicate keyframe", "{compositionId, trackId, fromFrame, toFrame}", true, |s, p| {
            let cmd = "motion.keyframe.duplicate";
            let composition_id = required_u64(cmd, p, "compositionId")?;
            let track_id = required_u64(cmd, p, "trackId")?;
            let from_frame = required_u32(cmd, p, "fromFrame")?;
            let to_frame = required_u32(cmd, p, "toFrame")?;
            let doc = s.doc_mut()?;
            let composition = doc.motion.compositions.iter_mut().find(|c| c.id == composition_id).ok_or_else(|| bad(cmd, "no such composition"))?;
            let track = composition.tracks.iter_mut().find(|t| t.id == track_id).ok_or_else(|| bad(cmd, "no such track"))?;
            let mut keyframe =
                track.keyframes.iter().find(|k| k.frame == from_frame).copied().ok_or_else(|| bad(cmd, "no keyframe at the source frame"))?;
            if track.keyframes.iter().any(|k| k.frame == to_frame) {
                return Err(bad(cmd, "a keyframe already exists at the destination frame"));
            }
            keyframe.frame = to_frame;
            track.keyframes.push(keyframe);
            track.keyframes.sort_by_key(|k| k.frame);
            composition.validate().map_err(|e| motion_error(cmd, e))?;
            Ok(json!({"fromFrame": from_frame, "toFrame": to_frame, "trackId": track_id}))
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

/// A render-only document with `composition_id` evaluated at `frame`: every enabled track's
/// sampled value applied the same way a manual edit applies it (group-relative X/Y, rotation
/// about the centre, clamped opacity, constraint-aware resize). Returns `None` when the
/// composition is missing or nothing animates, so callers keep the base document. Never fails:
/// unknown targets and failed applications are skipped, and the input is never mutated.
pub fn preview_document(doc: &Document, composition_id: u64, frame: f64) -> Option<Document> {
    let composition = doc.motion.compositions.iter().find(|c| c.id == composition_id)?;
    if composition.tracks.is_empty() || !frame.is_finite() {
        return None;
    }
    let samples = composition.sample_all(frame);
    if samples.is_empty() {
        return None;
    }
    let mut out = doc.clone();
    let mut by_node: BTreeMap<NodeId, Vec<SampledTrack>> = BTreeMap::new();
    for sample in samples {
        by_node.entry(sample.target).or_default().push(sample);
    }
    for (target, samples) in by_node {
        let mut props = Map::new();
        let mut scale = (None, None);
        for sample in samples {
            if !sample.value.is_finite() {
                continue;
            }
            let key = match sample.property {
                AnimatedProperty::PositionX => "x",
                AnimatedProperty::PositionY => "y",
                AnimatedProperty::Rotation => "rotation",
                AnimatedProperty::ScaleX => {
                    scale.0 = Some(sample.value);
                    continue;
                }
                AnimatedProperty::ScaleY => {
                    scale.1 = Some(sample.value);
                    continue;
                }
                AnimatedProperty::Opacity => "opacity",
                AnimatedProperty::Width => "width",
                AnimatedProperty::Height => "height",
            };
            props.insert(key.to_string(), json!(sample.value));
        }
        // One call keeps manual multi-property order; scale last since setting rotation rebuilds
        // the linear part without scale.
        let _ = super::props::apply("motion.preview", &mut out, target, &props);
        if scale.0.is_some() || scale.1.is_some() {
            let Ok(node) = out.get_mut(target) else { continue };
            let (current_x, current_y) = undesign_geom::scales(node.transform);
            node.transform = undesign_geom::set_scale_about_center(
                node.transform,
                node.width,
                node.height,
                scale.0.unwrap_or(current_x),
                scale.1.unwrap_or(current_y),
            );
        }
    }
    Some(out)
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

    #[test]
    fn moving_keyframe_preserves_data_and_is_undoable() {
        let mut session = Session::new();
        let frame = session.page().unwrap();
        let created = session.execute("motion.composition.create", &json!({"durationFrames":60})).unwrap();
        let composition_id = created["compositionId"].as_u64().unwrap();
        let track = session.execute("motion.track.add", &json!({"compositionId":composition_id,"target":frame.0,"property":"opacity"})).unwrap();
        let track_id = track["trackId"].as_u64().unwrap();
        session.execute("motion.keyframe.set", &json!({"compositionId":composition_id,"trackId":track_id,"frame":10,"value":0.25})).unwrap();
        session
            .execute(
                "motion.keyframe.set",
                &json!({
                    "compositionId":composition_id,
                    "trackId":track_id,
                    "frame":30,
                    "value":0.75,
                    "interpolation":{"type":"cubicBezier","x1":0.2,"y1":0.3,"x2":0.8,"y2":0.9}
                }),
            )
            .unwrap();
        session.execute("motion.keyframe.set", &json!({"compositionId":composition_id,"trackId":track_id,"frame":50,"value":1.0})).unwrap();
        let source = session.doc().unwrap().motion.compositions[0].tracks[0].keyframes[1];
        let undo_before = session.undo_depth().0;

        session.execute("motion.keyframe.move", &json!({"compositionId":composition_id,"trackId":track_id,"fromFrame":30,"toFrame":40})).unwrap();
        let keyframes = &session.doc().unwrap().motion.compositions[0].tracks[0].keyframes;
        assert_eq!(keyframes.iter().map(|k| k.frame).collect::<Vec<_>>(), vec![10, 40, 50]);
        assert_eq!(keyframes[1], Keyframe { frame: 40, ..source });
        assert_eq!(session.undo_depth().0, undo_before + 1);

        assert!(session.undo().unwrap());
        let keyframes = &session.doc().unwrap().motion.compositions[0].tracks[0].keyframes;
        assert_eq!(keyframes.iter().map(|k| k.frame).collect::<Vec<_>>(), vec![10, 30, 50]);
        assert_eq!(keyframes[1], source);
        assert!(session.redo().unwrap());
        let keyframes = &session.doc().unwrap().motion.compositions[0].tracks[0].keyframes;
        assert_eq!(keyframes.iter().map(|k| k.frame).collect::<Vec<_>>(), vec![10, 40, 50]);
        assert_eq!(keyframes[1], Keyframe { frame: 40, ..source });
    }

    #[test]
    fn moving_keyframe_rejects_missing_or_occupied_frames_and_out_of_range_destinations() {
        let mut session = Session::new();
        let frame = session.page().unwrap();
        let created = session.execute("motion.composition.create", &json!({"durationFrames":60})).unwrap();
        let composition_id = created["compositionId"].as_u64().unwrap();
        let track = session.execute("motion.track.add", &json!({"compositionId":composition_id,"target":frame.0,"property":"opacity"})).unwrap();
        let track_id = track["trackId"].as_u64().unwrap();
        session.execute("motion.keyframe.set", &json!({"compositionId":composition_id,"trackId":track_id,"frame":10,"value":0.25})).unwrap();
        session.execute("motion.keyframe.set", &json!({"compositionId":composition_id,"trackId":track_id,"frame":30,"value":0.75})).unwrap();
        let before = session.doc().unwrap().motion.clone();
        let undo_before = session.undo_depth().0;

        for (from_frame, to_frame) in [(20, 40), (10, 30), (10, 61)] {
            assert!(
                session
                    .execute(
                        "motion.keyframe.move",
                        &json!({"compositionId":composition_id,"trackId":track_id,"fromFrame":from_frame,"toFrame":to_frame})
                    )
                    .is_err()
            );
            assert_eq!(session.doc().unwrap().motion, before);
            assert_eq!(session.undo_depth().0, undo_before);
        }
    }

    #[test]
    fn duplicating_keyframe_preserves_data_and_is_undoable() {
        let mut session = Session::new();
        let frame = session.page().unwrap();
        let created = session.execute("motion.composition.create", &json!({"durationFrames":60})).unwrap();
        let composition_id = created["compositionId"].as_u64().unwrap();
        let track = session.execute("motion.track.add", &json!({"compositionId":composition_id,"target":frame.0,"property":"opacity"})).unwrap();
        let track_id = track["trackId"].as_u64().unwrap();
        session.execute("motion.keyframe.set", &json!({"compositionId":composition_id,"trackId":track_id,"frame":10,"value":0.25})).unwrap();
        session
            .execute(
                "motion.keyframe.set",
                &json!({
                    "compositionId":composition_id,
                    "trackId":track_id,
                    "frame":30,
                    "value":0.75,
                    "interpolation":{"type":"cubicBezier","x1":0.2,"y1":0.3,"x2":0.8,"y2":0.9}
                }),
            )
            .unwrap();
        session.execute("motion.keyframe.set", &json!({"compositionId":composition_id,"trackId":track_id,"frame":50,"value":1.0})).unwrap();
        let source = session.doc().unwrap().motion.compositions[0].tracks[0].keyframes[1];
        let undo_before = session.undo_depth().0;

        session
            .execute("motion.keyframe.duplicate", &json!({"compositionId":composition_id,"trackId":track_id,"fromFrame":30,"toFrame":40}))
            .unwrap();
        let keyframes = &session.doc().unwrap().motion.compositions[0].tracks[0].keyframes;
        assert_eq!(keyframes.iter().map(|k| k.frame).collect::<Vec<_>>(), vec![10, 30, 40, 50]);
        assert_eq!(keyframes[1], source, "the source keyframe remains unchanged");
        assert_eq!(keyframes[2], Keyframe { frame: 40, ..source });
        assert_eq!(session.undo_depth().0, undo_before + 1);

        assert!(session.undo().unwrap());
        let keyframes = &session.doc().unwrap().motion.compositions[0].tracks[0].keyframes;
        assert_eq!(keyframes.iter().map(|k| k.frame).collect::<Vec<_>>(), vec![10, 30, 50]);
        assert_eq!(keyframes[1], source);
        assert!(session.redo().unwrap());
        let keyframes = &session.doc().unwrap().motion.compositions[0].tracks[0].keyframes;
        assert_eq!(keyframes.iter().map(|k| k.frame).collect::<Vec<_>>(), vec![10, 30, 40, 50]);
        assert_eq!(keyframes[2], Keyframe { frame: 40, ..source });
    }

    #[test]
    fn duplicating_keyframe_rejects_missing_or_occupied_frames_and_out_of_range_destinations() {
        let mut session = Session::new();
        let frame = session.page().unwrap();
        let created = session.execute("motion.composition.create", &json!({"durationFrames":60})).unwrap();
        let composition_id = created["compositionId"].as_u64().unwrap();
        let track = session.execute("motion.track.add", &json!({"compositionId":composition_id,"target":frame.0,"property":"opacity"})).unwrap();
        let track_id = track["trackId"].as_u64().unwrap();
        session.execute("motion.keyframe.set", &json!({"compositionId":composition_id,"trackId":track_id,"frame":10,"value":0.25})).unwrap();
        session.execute("motion.keyframe.set", &json!({"compositionId":composition_id,"trackId":track_id,"frame":30,"value":0.75})).unwrap();
        let before = session.doc().unwrap().motion.clone();
        let undo_before = session.undo_depth().0;

        for (from_frame, to_frame) in [(20, 40), (10, 30), (10, 10), (10, 61)] {
            assert!(
                session
                    .execute(
                        "motion.keyframe.duplicate",
                        &json!({"compositionId":composition_id,"trackId":track_id,"fromFrame":from_frame,"toFrame":to_frame})
                    )
                    .is_err()
            );
            assert_eq!(session.doc().unwrap().motion, before);
            assert_eq!(session.undo_depth().0, undo_before);
        }
    }

    #[test]
    fn duplicating_keyframe_rejects_missing_or_malformed_parameters() {
        let mut session = Session::new();
        let frame = session.page().unwrap();
        let created = session.execute("motion.composition.create", &json!({"durationFrames":60})).unwrap();
        let composition_id = created["compositionId"].as_u64().unwrap();
        let track = session.execute("motion.track.add", &json!({"compositionId":composition_id,"target":frame.0,"property":"opacity"})).unwrap();
        let track_id = track["trackId"].as_u64().unwrap();
        session.execute("motion.keyframe.set", &json!({"compositionId":composition_id,"trackId":track_id,"frame":10,"value":0.25})).unwrap();
        let before = session.doc().unwrap().motion.clone();
        let undo_before = session.undo_depth().0;
        let valid = json!({"compositionId":composition_id,"trackId":track_id,"fromFrame":10,"toFrame":20});

        for key in ["compositionId", "trackId", "fromFrame", "toFrame"] {
            let mut params = valid.clone();
            params.as_object_mut().unwrap().remove(key);
            assert!(session.execute("motion.keyframe.duplicate", &params).is_err(), "missing {key}");
        }
        for (key, value) in [("compositionId", json!(-1)), ("trackId", json!("not-an-id")), ("fromFrame", json!(-1)), ("toFrame", json!(u64::MAX))] {
            let mut params = valid.clone();
            params[key] = value;
            assert!(session.execute("motion.keyframe.duplicate", &params).is_err(), "malformed {key}");
        }

        assert_eq!(session.doc().unwrap().motion, before);
        assert_eq!(session.undo_depth().0, undo_before);
    }

    #[test]
    fn duplicating_keyframe_rejects_unknown_composition_or_track_ids() {
        let mut session = Session::new();
        let frame = session.page().unwrap();
        let created = session.execute("motion.composition.create", &json!({"durationFrames":60})).unwrap();
        let composition_id = created["compositionId"].as_u64().unwrap();
        let track = session.execute("motion.track.add", &json!({"compositionId":composition_id,"target":frame.0,"property":"opacity"})).unwrap();
        let track_id = track["trackId"].as_u64().unwrap();
        session.execute("motion.keyframe.set", &json!({"compositionId":composition_id,"trackId":track_id,"frame":10,"value":0.25})).unwrap();
        let before = session.doc().unwrap().motion.clone();
        let undo_before = session.undo_depth().0;

        for params in [
            json!({"compositionId":composition_id + 1,"trackId":track_id,"fromFrame":10,"toFrame":20}),
            json!({"compositionId":composition_id,"trackId":track_id + 1,"fromFrame":10,"toFrame":20}),
        ] {
            assert!(session.execute("motion.keyframe.duplicate", &params).is_err());
            assert_eq!(session.doc().unwrap().motion, before);
            assert_eq!(session.undo_depth().0, undo_before);
        }
    }

    #[test]
    fn duplicating_keyframe_supports_boundary_and_backward_frames_and_preserves_step() {
        let mut session = Session::new();
        let frame = session.page().unwrap();
        let created = session.execute("motion.composition.create", &json!({"durationFrames":60})).unwrap();
        let composition_id = created["compositionId"].as_u64().unwrap();
        let track = session.execute("motion.track.add", &json!({"compositionId":composition_id,"target":frame.0,"property":"opacity"})).unwrap();
        let track_id = track["trackId"].as_u64().unwrap();
        session
            .execute("motion.keyframe.set", &json!({"compositionId":composition_id,"trackId":track_id,"frame":0,"value":0.25,"interpolation":"step"}))
            .unwrap();
        let source = session.doc().unwrap().motion.compositions[0].tracks[0].keyframes[0];

        let result = session
            .execute("motion.keyframe.duplicate", &json!({"compositionId":composition_id,"trackId":track_id,"fromFrame":0,"toFrame":60}))
            .unwrap();
        assert_eq!(result, json!({"fromFrame":0,"toFrame":60,"trackId":track_id}));
        let at_duration = session.doc().unwrap().motion.compositions[0].tracks[0].keyframes[1];
        assert_eq!(at_duration, Keyframe { frame: 60, ..source });

        let result = session
            .execute("motion.keyframe.duplicate", &json!({"compositionId":composition_id,"trackId":track_id,"fromFrame":60,"toFrame":5}))
            .unwrap();
        assert_eq!(result, json!({"fromFrame":60,"toFrame":5,"trackId":track_id}));
        let keyframes = &session.doc().unwrap().motion.compositions[0].tracks[0].keyframes;
        assert_eq!(keyframes.iter().map(|k| k.frame).collect::<Vec<_>>(), vec![0, 5, 60]);
        assert_eq!(keyframes[1], Keyframe { frame: 5, ..source });
        assert_eq!(keyframes[2], at_duration);
    }

    #[test]
    fn preview_applies_samples_without_mutating_the_base_document() {
        let mut session = Session::new();
        let frame = session.page().unwrap();
        let created = session.execute("motion.composition.create", &json!({"durationFrames":60})).unwrap();
        let composition_id = created["compositionId"].as_u64().unwrap();
        let track = session.execute("motion.track.add", &json!({"compositionId":composition_id,"target":frame.0,"property":"opacity"})).unwrap();
        let track_id = track["trackId"].as_u64().unwrap();
        session.execute("motion.keyframe.set", &json!({"compositionId":composition_id,"trackId":track_id,"frame":0,"value":1.0})).unwrap();
        session.execute("motion.keyframe.set", &json!({"compositionId":composition_id,"trackId":track_id,"frame":30,"value":0.0})).unwrap();
        let doc = session.doc().unwrap().clone();
        let base = doc.node(frame).unwrap().opacity;
        let preview = preview_document(&doc, composition_id, 15.0).unwrap();
        assert_eq!(preview.node(frame).unwrap().opacity, 0.5);
        assert_eq!(doc.node(frame).unwrap().opacity, base);
    }

    #[test]
    fn preview_returns_none_without_samples() {
        let mut session = Session::new();
        let frame = session.page().unwrap();
        let created = session.execute("motion.composition.create", &json!({})).unwrap();
        let composition_id = created["compositionId"].as_u64().unwrap();
        let doc = session.doc().unwrap().clone();
        assert!(preview_document(&doc, composition_id + 1, 0.0).is_none());
        assert!(preview_document(&doc, composition_id, 0.0).is_none());
        assert!(preview_document(&doc, composition_id, f64::NAN).is_none());
        let track = session
            .execute("motion.track.add", &json!({"compositionId":composition_id,"target":frame.0,"property":"opacity","enabled":false}))
            .unwrap();
        let track_id = track["trackId"].as_u64().unwrap();
        session.execute("motion.keyframe.set", &json!({"compositionId":composition_id,"trackId":track_id,"frame":0,"value":0.0})).unwrap();
        let doc = session.doc().unwrap().clone();
        assert!(preview_document(&doc, composition_id, 0.0).is_none());
    }

    #[test]
    fn preview_keeps_scale_when_rotation_animates_too() {
        let mut session = Session::new();
        let frame = session.page().unwrap();
        let created = session.execute("motion.composition.create", &json!({"durationFrames":30})).unwrap();
        let composition_id = created["compositionId"].as_u64().unwrap();
        for (property, end) in [("rotation", 30.0), ("scaleX", 2.0)] {
            let track = session.execute("motion.track.add", &json!({"compositionId":composition_id,"target":frame.0,"property":property})).unwrap();
            let track_id = track["trackId"].as_u64().unwrap();
            let start = if property == "rotation" { 0.0 } else { 1.0 };
            session.execute("motion.keyframe.set", &json!({"compositionId":composition_id,"trackId":track_id,"frame":0,"value":start})).unwrap();
            session.execute("motion.keyframe.set", &json!({"compositionId":composition_id,"trackId":track_id,"frame":30,"value":end})).unwrap();
        }
        let doc = session.doc().unwrap().clone();
        let preview = preview_document(&doc, composition_id, 30.0).unwrap();
        let node = preview.node(frame).unwrap();
        assert!((undesign_geom::rotation_degrees(node.transform) - 30.0).abs() < 1e-9);
        let c = node.transform.as_coeffs();
        assert!((c[0].hypot(c[2]) - 2.0).abs() < 1e-9);
        assert!((c[1].hypot(c[3]) - 1.0).abs() < 1e-9);
    }
}
