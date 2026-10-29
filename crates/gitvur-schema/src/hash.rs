//! Content hashing and line handling, shared by the extractor and the validator.
//!
//! Rule: `sha256` over the UTF-8 bytes of the element's lines, after converting
//! `\r\n` and `\r` to `\n`, with exactly one trailing `\n` added if missing.

use std::borrow::Cow;
use std::fmt::Write as _;

use sha2::{Digest, Sha256};

/// Hashes the given text as `sha256:<64 lowercase hex>` after normalising line
/// endings and ensuring a trailing `\n`.
pub fn content_hash(lines: &str) -> String {
    let mut text = normalize_newlines(lines).into_owned();
    if !text.ends_with('\n') {
        text.push('\n');
    }
    let digest = Sha256::digest(text.as_bytes());
    let mut out = String::with_capacity(7 + 64);
    out.push_str("sha256:");
    for byte in digest {
        // Writing to a String cannot fail.
        let _ = write!(out, "{byte:02x}");
    }
    out
}

/// Number of lines in `text`. A trailing `\n` does not start a new line, and an
/// empty file counts as one empty line, so every file has `endLine >= 1`.
pub fn line_count(text: &str) -> u32 {
    let count = split_lines(&normalize_newlines(text)).len();
    u32::try_from(count).unwrap_or(u32::MAX)
}

/// Returns lines `start..=end` (1-based, inclusive) of `text`, each terminated by
/// `\n`, with line endings normalised. This is exactly the input [`content_hash`]
/// hashes for an element. Returns `None` if the range is empty or out of bounds.
pub fn extract_lines(text: &str, start: u32, end: u32) -> Option<String> {
    let normalized = normalize_newlines(text);
    let lines = split_lines(&normalized);
    let start = usize::try_from(start).ok()?;
    let end = usize::try_from(end).ok()?;
    if start == 0 || start > end || end > lines.len() {
        return None;
    }
    let mut out = String::new();
    for line in &lines[start - 1..end] {
        out.push_str(line);
        out.push('\n');
    }
    Some(out)
}

fn normalize_newlines(text: &str) -> Cow<'_, str> {
    if text.contains('\r') {
        Cow::Owned(text.replace("\r\n", "\n").replace('\r', "\n"))
    } else {
        Cow::Borrowed(text)
    }
}

fn split_lines(normalized: &str) -> Vec<&str> {
    let body = normalized.strip_suffix('\n').unwrap_or(normalized);
    body.split('\n').collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crlf_and_cr_hash_like_lf() {
        assert_eq!(content_hash("a\r\nb"), content_hash("a\nb"));
        assert_eq!(content_hash("a\rb"), content_hash("a\nb"));
    }

    #[test]
    fn trailing_newline_is_implied() {
        assert_eq!(content_hash("a\nb"), content_hash("a\nb\n"));
    }

    #[test]
    fn known_value() {
        // printf 'a\nb\n' | sha256sum
        assert_eq!(
            content_hash("a\nb"),
            "sha256:911169ddaaf146aff539f58c26c489af3b892dff0fe283c1c264c65ae5aa59a2"
        );
    }

    #[test]
    fn line_count_rules() {
        assert_eq!(line_count(""), 1);
        assert_eq!(line_count("a"), 1);
        assert_eq!(line_count("a\n"), 1);
        assert_eq!(line_count("a\n\n"), 2);
        assert_eq!(line_count("a\r\nb\r\n"), 2);
    }

    #[test]
    fn extract_lines_is_inclusive_and_bounded() {
        let text = "one\r\ntwo\nthree\n";
        assert_eq!(extract_lines(text, 2, 3).as_deref(), Some("two\nthree\n"));
        assert_eq!(extract_lines(text, 1, 1).as_deref(), Some("one\n"));
        assert_eq!(extract_lines(text, 0, 1), None);
        assert_eq!(extract_lines(text, 3, 4), None);
        assert_eq!(extract_lines(text, 3, 2), None);
    }

    #[test]
    fn whole_file_hash_equals_full_range_hash() {
        for text in ["a\nb\n", "a\nb", "a\n\n", "x\r\ny\r\n"] {
            let n = line_count(text);
            let range = extract_lines(text, 1, n).unwrap();
            assert_eq!(content_hash(text), content_hash(&range), "{text:?}");
        }
    }
}
