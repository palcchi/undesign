//! Agent errors. Everything is data: no panics, so a bad model reply or a refused
//! plan is always a message the UI can show.

/// The agent core's result type.
pub type Result<T> = std::result::Result<T, Error>;

/// What can go wrong between a prompt and an applied plan.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The provider's text is not a usable plan (not JSON, wrong shape, empty).
    #[error("the model did not return a plan: {0}")]
    BadPlan(String),
    /// A step names a command outside [`crate::WHITELIST`].
    #[error("rejected command `{id}` (allowed: {allowed})")]
    RejectedCommand {
        /// The offending command id.
        id: String,
        /// The whitelist, comma-separated, for the retry message.
        allowed: String,
    },
    /// A value fails structural validation (too many steps, bad frame, overlong text…).
    #[error("invalid plan: {0}")]
    Invalid(String),
    /// The provider failed or never answered.
    #[error("provider failed: {0}")]
    Provider(String),
    /// The engine refused the batch. `command.batch` already rolled the document back.
    #[error("the engine refused the plan: {0}")]
    Engine(#[from] undesign_engine::EngineError),
}
