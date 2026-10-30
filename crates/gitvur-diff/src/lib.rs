//! Structural diff between the extracted structure of two Git revisions.
//!
//! - [`diff`]: pure comparison of two `Structure`s (classification rules in `README.md`).
//! - [`revision`]: reads a commit's tree with `gix` into a temporary directory and indexes
//!   it. The user's working tree, index and refs are never touched.
//! - [`carry_annotations`]: rewrites annotation IDs of moved elements.

mod carry;
mod engine;
pub mod revision;

pub use carry::carry_annotations;
pub use engine::diff;
