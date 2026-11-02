//! The hackathon agent core: turn a user prompt into a validated plan of engine
//! commands and apply it atomically. Shared by the desktop app and the web build.
//!
//! The model never touches the document: it returns `{"commands": [...]}` (the same
//! shape as `command.batch` steps), the core rejects anything outside a small whitelist,
//! clamps values, and runs the plan through [`command.batch`](undesign_engine) as one
//! undo step, so a failure rolls everything back. Providers (live model, replay cache)
//! plug in behind [`Provider`]; the core pumps them without an async runtime so the same
//! code runs natively and on wasm.
//!
//! Nothing here depends on a UI toolkit or the network.

pub mod context;
pub mod error;
pub mod execute;
pub mod plan;
pub mod provider;
pub mod validate;
pub mod whitelist;

pub use context::ChatContext;
pub use error::{Error, Result};
pub use execute::{ApplyReport, DEFAULT_MAX_TOKENS, TurnReport, apply, build_system_prompt, pump, run_turn};
pub use plan::{Plan, Step, parse_plan};
pub use provider::{
    ChatRequest, ChatResponse, FakeProvider, FallbackProvider, MetaModelApi, ModelRequest, ModelTransport, Poll, Provider, ProviderConfig, Replay,
    RequestId,
};
pub use validate::{MAX_COMMANDS, validate};
pub use whitelist::{WHITELIST, is_whitelisted};
