//! Timeline and keyframe data stored with a design document.
//!
//! This module deliberately contains no UI or rendering code. The document format owns the
//! animation data so timeline editing, playback, export and AI-generated motion all share one
//! source of truth.

use crate::NodeId;
use serde::{Deserialize, Serialize};

/// Animation data attached to a design document.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct MotionDocument {
    /// Independent compositions in this file.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub compositions: Vec<Composition>,
}

impl MotionDocument {
    pub fn is_empty(&self) -> bool {
        self.compositions.is_empty()
    }
}

/// A timeline and its animated layer properties.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Composition {
    pub id: u64,
    pub name: String,
    pub width: u32,
    pub height: u32,
    /// Frames per second. Supported range is 1–240.
    #[serde(default = "default_fps")]
    pub fps: u16,
    /// Length of the composition, in frames.
    #[serde(default = "default_duration")]
    pub duration_frames: u32,
    #[serde(default)]
    pub tracks: Vec<AnimationTrack>,
}

/// One track's value at a frame: what playback applies to a render-only document.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SampledTrack {
    pub target: NodeId,
    pub property: AnimatedProperty,
    pub value: f64,
}

impl Composition {
    /// Duration in seconds.
    pub fn duration_seconds(&self) -> f64 {
        f64::from(self.duration_frames) / f64::from(self.fps.max(1))
    }

    /// Every enabled track's value at `frame` (empty when nothing animates there).
    pub fn sample_all(&self, frame: f64) -> Vec<SampledTrack> {
        if !frame.is_finite() {
            return Vec::new();
        }
        self.tracks.iter().filter_map(|t| t.sample(frame).map(|value| SampledTrack { target: t.target, property: t.property, value })).collect()
    }

    /// Check values that must be valid before playback or export.
    pub fn validate(&self) -> Result<(), MotionError> {
        if !(1..=240).contains(&self.fps) {
            return Err(MotionError::InvalidFrameRate(self.fps));
        }
        if self.duration_frames == 0 {
            return Err(MotionError::EmptyDuration);
        }
        if self.width == 0 || self.height == 0 {
            return Err(MotionError::EmptySize);
        }
        for track in &self.tracks {
            let mut previous = None;
            for keyframe in &track.keyframes {
                if !keyframe.value.is_finite() {
                    return Err(MotionError::NonFiniteValue);
                }
                if keyframe.frame > self.duration_frames {
                    return Err(MotionError::KeyframeOutOfRange { frame: keyframe.frame, duration: self.duration_frames });
                }
                if previous.is_some_and(|frame| frame >= keyframe.frame) {
                    return Err(MotionError::UnorderedKeyframes);
                }
                previous = Some(keyframe.frame);
                if let Interpolation::CubicBezier { x1, y1, x2, y2 } = keyframe.interpolation
                    && (![x1, y1, x2, y2].into_iter().all(f64::is_finite) || !(0.0..=1.0).contains(&x1) || !(0.0..=1.0).contains(&x2))
                {
                    return Err(MotionError::InvalidBezier);
                }
            }
        }
        Ok(())
    }
}

fn default_fps() -> u16 {
    30
}

fn default_duration() -> u32 {
    300
}

/// One animated property on one document layer.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AnimationTrack {
    pub id: u64,
    pub target: NodeId,
    pub property: AnimatedProperty,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub keyframes: Vec<Keyframe>,
}

/// Properties supported by the first motion-engine slice.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AnimatedProperty {
    PositionX,
    PositionY,
    Rotation,
    ScaleX,
    ScaleY,
    Opacity,
    Width,
    Height,
}

/// A value at a specific frame. Interpolation controls the segment after this keyframe.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Keyframe {
    pub frame: u32,
    pub value: f64,
    #[serde(default)]
    pub interpolation: Interpolation,
}

/// How values move from one keyframe to the next.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Interpolation {
    Step,
    #[default]
    Linear,
    CubicBezier {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
    },
}

impl AnimationTrack {
    /// Evaluate this track at a frame. Keyframes must be sorted and validated by the composition.
    pub fn sample(&self, frame: f64) -> Option<f64> {
        if !self.enabled || !frame.is_finite() || self.keyframes.is_empty() {
            return None;
        }
        let first = self.keyframes.first()?;
        if frame <= f64::from(first.frame) {
            return Some(first.value);
        }
        let last = self.keyframes.last()?;
        if frame >= f64::from(last.frame) {
            return Some(last.value);
        }
        let pair = self.keyframes.windows(2).find(|pair| frame >= f64::from(pair[0].frame) && frame <= f64::from(pair[1].frame))?;
        let (left, right) = (pair[0], pair[1]);
        let span = f64::from(right.frame - left.frame);
        if span <= 0.0 {
            return Some(right.value);
        }
        let t = ((frame - f64::from(left.frame)) / span).clamp(0.0, 1.0);
        let eased = match left.interpolation {
            Interpolation::Step => 0.0,
            Interpolation::Linear => t,
            Interpolation::CubicBezier { x1, y1, x2, y2 } => cubic_bezier_progress(t, x1, y1, x2, y2),
        };
        Some(left.value + (right.value - left.value) * eased)
    }
}

fn cubic_bezier_progress(x: f64, x1: f64, y1: f64, x2: f64, y2: f64) -> f64 {
    let sample = |t: f64, a: f64, b: f64| 3.0 * (1.0 - t).powi(2) * t * a + 3.0 * (1.0 - t) * t.powi(2) * b + t.powi(3);
    let mut low = 0.0;
    let mut high = 1.0;
    for _ in 0..24 {
        let middle = (low + high) * 0.5;
        if sample(middle, x1, x2) < x {
            low = middle;
        } else {
            high = middle;
        }
    }
    sample((low + high) * 0.5, y1, y2)
}

fn yes() -> bool {
    true
}

#[derive(Clone, Debug, PartialEq, thiserror::Error)]
pub enum MotionError {
    #[error("frame rate {0} is outside the supported range 1–240")]
    InvalidFrameRate(u16),
    #[error("composition duration must be greater than zero")]
    EmptyDuration,
    #[error("composition width and height must be greater than zero")]
    EmptySize,
    #[error("keyframe values must be finite numbers")]
    NonFiniteValue,
    #[error("keyframe at frame {frame} exceeds composition duration {duration}")]
    KeyframeOutOfRange { frame: u32, duration: u32 },
    #[error("keyframes must be strictly ordered by frame")]
    UnorderedKeyframes,
    #[error("cubic bezier control points are invalid")]
    InvalidBezier,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(interpolation: Interpolation) -> AnimationTrack {
        AnimationTrack {
            id: 1,
            target: NodeId(7),
            property: AnimatedProperty::PositionX,
            enabled: true,
            keyframes: vec![
                Keyframe { frame: 0, value: 0.0, interpolation },
                Keyframe { frame: 30, value: 100.0, interpolation: Interpolation::Linear },
            ],
        }
    }

    #[test]
    fn samples_linear_track_and_holds_end_values() {
        let track = track(Interpolation::Linear);
        assert_eq!(track.sample(-2.0), Some(0.0));
        assert_eq!(track.sample(15.0), Some(50.0));
        assert_eq!(track.sample(40.0), Some(100.0));
    }

    #[test]
    fn step_interpolation_holds_until_next_keyframe() {
        let track = track(Interpolation::Step);
        assert_eq!(track.sample(29.0), Some(0.0));
        assert_eq!(track.sample(30.0), Some(100.0));
    }

    #[test]
    fn sample_all_collects_enabled_tracks_and_skips_the_rest() {
        let mut opacity = track(Interpolation::Linear);
        opacity.id = 2;
        opacity.target = NodeId(9);
        opacity.property = AnimatedProperty::Opacity;
        opacity.enabled = false;
        let empty = AnimationTrack { id: 3, target: NodeId(11), property: AnimatedProperty::Rotation, enabled: true, keyframes: Vec::new() };
        let composition = Composition {
            id: 1,
            name: "Main".into(),
            width: 1920,
            height: 1080,
            fps: 30,
            duration_frames: 90,
            tracks: vec![track(Interpolation::Linear), opacity, empty],
        };
        assert_eq!(composition.sample_all(15.0), vec![SampledTrack { target: NodeId(7), property: AnimatedProperty::PositionX, value: 50.0 }]);
        assert!(composition.sample_all(f64::NAN).is_empty());
    }

    #[test]
    fn disabled_or_empty_tracks_do_not_sample() {
        let mut track = track(Interpolation::Linear);
        track.enabled = false;
        assert_eq!(track.sample(10.0), None);
        track.enabled = true;
        track.keyframes.clear();
        assert_eq!(track.sample(10.0), None);
    }

    #[test]
    fn composition_rejects_unordered_keyframes() {
        let mut composition = Composition {
            id: 1,
            name: "Main".into(),
            width: 1920,
            height: 1080,
            fps: 30,
            duration_frames: 90,
            tracks: vec![track(Interpolation::Linear)],
        };
        composition.tracks[0].keyframes.reverse();
        assert_eq!(composition.validate(), Err(MotionError::UnorderedKeyframes));
    }

    #[test]
    fn motion_document_defaults_to_empty() {
        let decoded: MotionDocument = serde_json::from_str("{}").unwrap();
        assert!(decoded.is_empty());
    }

    #[test]
    fn older_documents_decode_without_motion_data() {
        let mut value = serde_json::to_value(crate::Document::default()).unwrap();
        let object = value.as_object_mut().unwrap();
        object.remove("motion");
        let decoded: crate::Document = serde_json::from_value(value).unwrap();
        assert!(decoded.motion.is_empty());
    }
}
