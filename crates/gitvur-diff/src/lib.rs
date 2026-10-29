//! Structural diff between the extracted structure of two Git revisions.
//!
//! Phase 10 replaces the placeholder below with the real implementation.

/// Name of this crate.
///
/// Placeholder so the crate has a public item and a test until Phase 10.
pub fn crate_name() -> &'static str {
    env!("CARGO_PKG_NAME")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crate_name_matches_package() {
        assert_eq!(crate_name(), "gitvur-diff");
    }
}
