use memchr::memchr;

/// Search for all occurrences of `pattern` in `data` starting at `start_offset`.
/// Returns up to `max_results` absolute offsets.
pub fn search_all(data: &[u8], pattern: &[u8], start_offset: usize, max_results: usize) -> Vec<u64> {
    if pattern.is_empty() || start_offset >= data.len() {
        return Vec::new();
    }

    let mut results = Vec::new();
    let haystack = &data[start_offset..];

    if pattern.len() == 1 {
        // Fast path for single byte.
        let byte = pattern[0];
        let mut search_from = 0;
        while let Some(pos) = memchr(byte, &haystack[search_from..]) {
            let abs = (start_offset + search_from + pos) as u64;
            results.push(abs);
            if results.len() >= max_results {
                break;
            }
            search_from += pos + 1;
        }
        return results;
    }

    // Multi-byte: use first byte as a fast filter.
    let first = pattern[0];
    let mut search_from = 0;
    while let Some(pos) = memchr(first, &haystack[search_from..]) {
        let abs = start_offset + search_from + pos;
        if abs + pattern.len() > data.len() {
            break;
        }
        if &data[abs..abs + pattern.len()] == pattern {
            results.push(abs as u64);
            if results.len() >= max_results {
                break;
            }
        }
        search_from += pos + 1;
    }

    results
}

/// Count occurrences (bounded) — returns up to limit.
#[allow(dead_code)]
pub fn count_occurrences(data: &[u8], pattern: &[u8], limit: usize) -> usize {
    search_all(data, pattern, 0, limit).len()
}

/// Search a virtual stream via a chunked reader (for concatenated folders).
/// Reads 4MB chunks with pattern-length overlap so matches spanning chunk
/// boundaries are found exactly once. Returns absolute offsets.
pub fn search_reader(
    mut read: impl FnMut(u64, &mut [u8]) -> usize,
    size: u64,
    pattern: &[u8],
    start: u64,
    max: usize,
) -> Vec<u64> {
    const CHUNK: usize = 4 * 1024 * 1024;
    let mut results = Vec::new();
    if pattern.is_empty() || start >= size || max == 0 {
        return results;
    }

    let overlap = pattern.len() - 1;
    let mut abs = start;
    let mut prefix: Vec<u8> = Vec::new();
    let mut chunk = vec![0u8; CHUNK];

    while results.len() < max {
        let want = ((size - abs) as usize).min(CHUNK);
        if want == 0 {
            break;
        }
        let n = read(abs, &mut chunk[..want]);
        if n == 0 {
            break;
        }
        let mut buf = Vec::with_capacity(prefix.len() + n);
        buf.extend_from_slice(&prefix);
        buf.extend_from_slice(&chunk[..n]);
        let base = abs - prefix.len() as u64;

        // Matches inside `buf` start at >= base; any match fully confirmable
        // in the previous chunk started < base, so no de-dup needed.
        for rel in search_all(&buf, pattern, 0, max - results.len()) {
            results.push(base + rel as u64);
        }

        if n < want {
            break; // EOF
        }
        let keep = overlap.min(buf.len());
        prefix.clear();
        prefix.extend_from_slice(&buf[buf.len() - keep..]);
        abs += n as u64;
    }
    results
}
