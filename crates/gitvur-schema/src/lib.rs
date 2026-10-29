//! Gitvur data contract v0.2: Rust types for `.gitvur/*.json` and their JSON Schema.
//!
//! Phase 01 replaces the placeholder below with the real contract types.

/// Version of the data contract this crate describes.
///
/// Placeholder until Phase 01 adds the contract types.
pub fn schema_version() -> &'static str {
    "0.2"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_version_is_0_2() {
        assert_eq!(schema_version(), "0.2");
    }
}
