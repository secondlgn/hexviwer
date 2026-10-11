use memmap2::Mmap;
use parking_lot::RwLock;
use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};

/// One physical file mapped into the virtual stream.
pub struct FilePart {
    #[allow(dead_code)]
    pub name: String,
    #[allow(dead_code)]
    pub file: File,
    pub mmap: Mmap,
    /// Start offset of this part within the virtual stream.
    pub start: u64,
    pub len: u64,
}

/// A virtual byte stream: either a single file or a folder's files
/// concatenated in filename order.
pub struct OpenedFile {
    pub path: PathBuf,
    pub parts: Vec<FilePart>,
    pub size: u64,
}

fn map_file(path: &Path) -> Result<(File, Mmap, u64), String> {
    let file = File::open(path)
        .map_err(|e| format!("无法打开文件 {}: {e}", path.display()))?;
    let size = file
        .metadata()
        .map_err(|e| format!("无法读取元数据 {}: {e}", path.display()))?
        .len();
    // Safe: read-only mapping, file is never modified by this process.
    let mmap = unsafe { Mmap::map(&file) }
        .map_err(|e| format!("无法映射文件 {}: {e}", path.display()))?;
    Ok((file, mmap, size))
}

impl OpenedFile {
    pub fn open_single(path: PathBuf) -> Result<Self, String> {
        let (file, mmap, size) = map_file(&path)?;
        let name = path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        Ok(Self {
            path,
            parts: vec![FilePart {
                name,
                file,
                mmap,
                start: 0,
                len: size,
            }],
            size,
        })
    }

    /// Open every regular file directly inside `dir` (non-recursive),
    /// concatenated in natural filename order.
    pub fn open_folder(dir: PathBuf) -> Result<Self, String> {
        if !dir.is_dir() {
            return Err(format!("不是目录: {}", dir.display()));
        }
        let mut entries: Vec<PathBuf> = std::fs::read_dir(&dir)
            .map_err(|e| format!("无法读取目录: {e}"))?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.is_file())
            .collect();
        entries.sort_by(|a, b| {
            let an = file_name_of(a);
            let bn = file_name_of(b);
            natural_cmp(&an, &bn).then_with(|| an.cmp(&bn))
        });
        if entries.is_empty() {
            return Err("文件夹中没有文件".to_string());
        }
        let mut parts = Vec::with_capacity(entries.len());
        let mut start = 0u64;
        for p in &entries {
            let (file, mmap, size) = map_file(p)?;
            parts.push(FilePart {
                name: file_name_of(p),
                file,
                mmap,
                start,
                len: size,
            });
            start += size;
        }
        Ok(Self {
            path: dir,
            parts,
            size: start,
        })
    }

    /// Copy bytes from the virtual stream into `buf`.
    /// Returns the number of bytes actually read.
    pub fn read(&self, offset: u64, buf: &mut [u8]) -> usize {
        if offset >= self.size || buf.is_empty() {
            return 0;
        }
        let mut written = 0usize;
        let mut off = offset;
        for p in &self.parts {
            if written >= buf.len() {
                break;
            }
            let p_end = p.start + p.len;
            if off >= p_end {
                continue;
            }
            if off < p.start {
                break; // gap — parts are contiguous, so this shouldn't happen
            }
            let within = (off - p.start) as usize;
            let avail = p.len as usize - within;
            let need = buf.len() - written;
            let n = avail.min(need);
            buf[written..written + n].copy_from_slice(&p.mmap[within..within + n]);
            written += n;
            off += n as u64;
        }
        written
    }

    /// Contiguous slice when the stream is a single file (fast paths).
    pub fn bytes(&self) -> Option<&[u8]> {
        if self.parts.len() == 1 {
            Some(&self.parts[0].mmap)
        } else {
            None
        }
    }

    pub fn part_count(&self) -> usize {
        self.parts.len()
    }
}

fn file_name_of(p: &Path) -> String {
    p.file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Natural sort: case-insensitive, digit runs compared numerically
/// (so file2 < file10).
fn natural_cmp(a: &str, b: &str) -> Ordering {
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    let (mut i, mut j) = (0usize, 0usize);
    while i < ab.len() && j < bb.len() {
        let ca = ab[i];
        let cb = bb[j];
        if ca.is_ascii_digit() && cb.is_ascii_digit() {
            let si = i;
            while i < ab.len() && ab[i].is_ascii_digit() {
                i += 1;
            }
            let sj = j;
            while j < bb.len() && bb[j].is_ascii_digit() {
                j += 1;
            }
            let na = trim_leading_zeros(&ab[si..i]);
            let nb = trim_leading_zeros(&bb[sj..j]);
            let ord = na
                .len()
                .cmp(&nb.len())
                .then_with(|| na.cmp(nb));
            if ord != Ordering::Equal {
                return ord;
            }
        } else {
            let ord = ca.to_ascii_lowercase().cmp(&cb.to_ascii_lowercase());
            if ord != Ordering::Equal {
                return ord;
            }
            i += 1;
            j += 1;
        }
    }
    (ab.len() - i).cmp(&(bb.len() - j))
}

fn trim_leading_zeros(mut s: &[u8]) -> &[u8] {
    while s.len() > 1 && s[0] == b'0' {
        s = &s[1..];
    }
    s
}

/// Registry of all opened virtual streams, keyed by an incrementing id.
pub struct FileRegistry {
    files: RwLock<HashMap<u64, OpenedFile>>,
    next_id: AtomicU64,
}

impl FileRegistry {
    pub fn new() -> Self {
        Self {
            files: RwLock::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }

    pub fn add_file(&self, path: PathBuf) -> Result<u64, String> {
        let opened = OpenedFile::open_single(path)?;
        Ok(self.insert(opened))
    }

    pub fn add_folder(&self, path: PathBuf) -> Result<u64, String> {
        let opened = OpenedFile::open_folder(path)?;
        Ok(self.insert(opened))
    }

    fn insert(&self, opened: OpenedFile) -> u64 {
        let id = self.next_id.fetch_add(1, AtomicOrdering::SeqCst);
        self.files.write().insert(id, opened);
        id
    }

    pub fn remove(&self, id: u64) {
        self.files.write().remove(&id);
    }

    pub fn with<R>(&self, id: u64, f: impl FnOnce(&OpenedFile) -> R) -> Result<R, String> {
        let files = self.files.read();
        let file = files
            .get(&id)
            .ok_or_else(|| format!("文件未打开 (id={id})"))?;
        Ok(f(file))
    }

    pub fn list(&self) -> Vec<(u64, String, u64)> {
        let files = self.files.read();
        files
            .iter()
            .map(|(id, f)| (*id, f.path.display().to_string(), f.size))
            .collect()
    }
}

impl Default for FileRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_natural_sort() {
        let mut names = vec!["file10.bin", "file2.bin", "file1.bin", "File3.bin"];
        names.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(names, vec!["file1.bin", "file2.bin", "File3.bin", "file10.bin"]);
    }
}
