//! Boundary-safe text helpers shared by the import and JD parsers.
//!
//! `str::to_lowercase()` can change a string's byte length (e.g. `İ` expands
//! to `i` + combining dot), so byte offsets taken from a lowercased copy must
//! never be applied to the original string — that class of slicing panics with
//! "byte index is not a char boundary" and, inside a Tauri command, takes the
//! whole app down. These helpers fold ASCII case directly over the original
//! string and always return char-boundary-aligned offsets.

/// Finds the first case-insensitive (ASCII folding) occurrence of `needle` in
/// `haystack`, returning the byte `(start, end)` range of the match inside
/// `haystack`. `end` is the offset just past the matched characters, which is
/// not always `start + needle.len()` once non-ASCII characters are involved.
pub fn find_ci(haystack: &str, needle: &str) -> Option<(usize, usize)> {
    let target: Vec<char> = needle.chars().collect();
    if target.is_empty() {
        return None;
    }
    let chars: Vec<(usize, char)> = haystack.char_indices().collect();
    if target.len() > chars.len() {
        return None;
    }
    for pos in 0..=chars.len() - target.len() {
        let window = &chars[pos..pos + target.len()];
        if window
            .iter()
            .zip(&target)
            .all(|((_, got), want)| got.eq_ignore_ascii_case(want))
        {
            let start = window[0].0;
            let end = chars
                .get(pos + target.len())
                .map_or(haystack.len(), |(i, _)| *i);
            return Some((start, end));
        }
    }
    None
}

/// Case-insensitive ASCII prefix match: returns the remainder of `line` just
/// past the matched `label`, or `None` when `line` does not start with it.
pub fn strip_ci_prefix<'a>(line: &'a str, label: &str) -> Option<&'a str> {
    let mut remaining = line;
    for want in label.chars() {
        let got = remaining.chars().next()?;
        if !got.eq_ignore_ascii_case(&want) {
            return None;
        }
        remaining = &remaining[got.len_utf8()..];
    }
    Some(remaining)
}

/// Like [`find_ci`] but returns the last occurrence (mirrors `str::rfind`).
pub fn rfind_ci(haystack: &str, needle: &str) -> Option<(usize, usize)> {
    let target: Vec<char> = needle.chars().collect();
    if target.is_empty() {
        return None;
    }
    let chars: Vec<(usize, char)> = haystack.char_indices().collect();
    if target.len() > chars.len() {
        return None;
    }
    for pos in (0..=chars.len() - target.len()).rev() {
        let window = &chars[pos..pos + target.len()];
        if window
            .iter()
            .zip(&target)
            .all(|((_, got), want)| got.eq_ignore_ascii_case(want))
        {
            let start = window[0].0;
            let end = chars
                .get(pos + target.len())
                .map_or(haystack.len(), |(i, _)| *i);
            return Some((start, end));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_ci_matches_ascii_case_variants() {
        assert_eq!(find_ci("Engineer at NextLabs", " at "), Some((8, 12)));
        assert_eq!(find_ci("Engineer AT NextLabs", " at "), Some((8, 12)));
        assert_eq!(find_ci("no marker here", " at "), None);
        assert_eq!(find_ci("ends with at ", " at "), Some((9, 13)));
        assert_eq!(find_ci("", " at "), None);
    }

    #[test]
    fn find_ci_offsets_stay_on_char_boundaries_with_multibyte_text() {
        // `İ` expands under to_lowercase(); offsets from a lowercased copy
        // would slice inside the combining sequence.
        let line = "İş Engineer at NextLabs";
        let (start, end) = find_ci(line, " at ").expect("marker found");
        assert!(line.is_char_boundary(start));
        assert!(line.is_char_boundary(end));
        assert_eq!(&line[end..], "NextLabs");

        // Needle directly after a multi-byte character.
        let line = "İn at X";
        let (start, end) = find_ci(line, " at ").expect("marker found");
        assert!(line.is_char_boundary(start) && line.is_char_boundary(end));
    }

    #[test]
    fn strip_ci_prefix_folds_case_and_keeps_boundaries() {
        assert_eq!(strip_ci_prefix("Location: Berlin", "location"), Some(": Berlin"));
        assert_eq!(strip_ci_prefix("LOCATION Berlin", "location"), Some(" Berlin"));
        assert_eq!(strip_ci_prefix("relocate now", "location"), None);
        // ASCII folding only: `İ` is not `i`, so this never matches.
        assert_eq!(strip_ci_prefix("İstanbul", "i"), None);
    }

    #[test]
    fn strip_ci_prefix_handles_multibyte_first_char() {
        let line = "İssued by ACME";
        assert_eq!(strip_ci_prefix(line, "issued by"), None);
        // Non-ASCII characters pass through unchanged and still match exactly.
        assert_eq!(strip_ci_prefix("École Polytechnique", "École"), Some(" Polytechnique"));
    }

    #[test]
    fn rfind_ci_returns_the_last_occurrence_on_boundaries() {
        assert_eq!(
            rfind_ci("Lead at Acme at Scale", " at "),
            Some(("Lead at Acme".len(), "Lead at Acme at ".len()))
        );
        assert_eq!(rfind_ci("no marker", " at "), None);
        let line = "İİ at X";
        let (start, end) = rfind_ci(line, " at ").expect("marker found");
        assert!(line.is_char_boundary(start) && line.is_char_boundary(end));
    }
}
