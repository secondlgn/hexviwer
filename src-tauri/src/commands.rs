use crate::registry::FileRegistry;
use crate::search;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenResult {
    pub file_id: u64,
    pub path: String,
    pub size: u64,
    /// Number of physical files composing the stream (1 for a single file).
    pub files: usize,
}

#[tauri::command]
pub fn open_file(
    registry: State<'_, FileRegistry>,
    path: String,
) -> Result<OpenResult, String> {
    let pb = PathBuf::from(&path);
    if !pb.exists() {
        return Err(format!("文件不存在: {path}"));
    }
    let id = registry.add_file(pb.clone())?;
    let size = registry.with(id, |f| f.size)?;
    Ok(OpenResult {
        file_id: id,
        path: pb.display().to_string(),
        size,
        files: 1,
    })
}

/// Open every file inside a folder as one concatenated stream
/// (natural filename order, non-recursive).
#[tauri::command]
pub fn open_folder(
    registry: State<'_, FileRegistry>,
    path: String,
) -> Result<OpenResult, String> {
    let pb = PathBuf::from(&path);
    if !pb.is_dir() {
        return Err(format!("不是目录: {path}"));
    }
    let id = registry.add_folder(pb.clone())?;
    let (size, files) = registry.with(id, |f| (f.size, f.part_count()))?;
    Ok(OpenResult {
        file_id: id,
        path: pb.display().to_string(),
        size,
        files,
    })
}

#[tauri::command]
pub fn close_file(registry: State<'_, FileRegistry>, file_id: u64) -> Result<(), String> {
    registry.remove(file_id);
    Ok(())
}

#[derive(Serialize)]
pub struct ReadRangeResult {
    pub data: String, // base64
    pub offset: u64,
    pub length: u64,
}

#[tauri::command]
pub fn read_range(
    registry: State<'_, FileRegistry>,
    file_id: u64,
    offset: u64,
    length: u64,
) -> Result<ReadRangeResult, String> {
    registry.with(file_id, |f| {
        let size = f.size;
        if offset >= size || length == 0 {
            return Ok(ReadRangeResult {
                data: String::new(),
                offset,
                length: 0,
            });
        }
        let len = length.min(size - offset) as usize;
        let mut buf = vec![0u8; len];
        let n = f.read(offset, &mut buf);
        Ok(ReadRangeResult {
            data: B64.encode(&buf[..n]),
            offset,
            length: n as u64,
        })
    })?
}

#[tauri::command]
pub fn list_files(registry: State<'_, FileRegistry>) -> Vec<(u64, String, u64)> {
    registry.list()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub offsets: Vec<u64>,
    pub total_found: usize,
    pub has_more: bool,
}

#[tauri::command]
pub fn search_bytes(
    registry: State<'_, FileRegistry>,
    file_id: u64,
    pattern: Vec<u8>,
    start_offset: u64,
    max_results: u32,
) -> Result<SearchResult, String> {
    registry.with(file_id, |f| {
        let max = max_results as usize;
        let offsets = match f.bytes() {
            // Single file: zero-copy scan of the mmap.
            Some(data) => search::search_all(data, &pattern, start_offset as usize, max),
            // Concatenated folder stream: chunked scan with overlap.
            None => search::search_reader(
                |off, dst| f.read(off, dst),
                f.size,
                &pattern,
                start_offset,
                max,
            ),
        };
        let count = offsets.len();
        Ok(SearchResult {
            offsets,
            total_found: count,
            has_more: count >= max,
        })
    })?
}

/// A row range (inclusive) for export.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowRange {
    pub start: u64,
    pub end: u64, // inclusive
}

/// A column range (inclusive) for export.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColRange {
    pub start: u8,
    pub end: u8, // inclusive
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub file_id: u64,
    pub row_ranges: Vec<RowRange>,
    pub col_ranges: Vec<ColRange>,
    pub bytes_per_line: u64,
    pub start_offset: u64,
    pub output_path: String,
}

#[tauri::command]
pub fn export_binary(
    registry: State<'_, FileRegistry>,
    request: ExportRequest,
) -> Result<u64, String> {
    registry.with(request.file_id, |f| {
        let size = f.size;
        if request.bytes_per_line == 0 {
            return Err("每行字节长度无效".to_string());
        }

        // Flatten column ranges into a sorted list of column indices.
        let mut cols: Vec<u8> = Vec::new();
        for r in &request.col_ranges {
            for c in r.start..=r.end {
                cols.push(c);
            }
        }
        cols.sort();
        cols.dedup();

        if cols.is_empty() {
            return Err("没有选择列".to_string());
        }

        let mut out = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&request.output_path)
            .map_err(|e| format!("无法创建输出文件: {e}"))?;

        let mut written: u64 = 0;
        let bpl = request.bytes_per_line;
        let mut row_buf = vec![0u8; bpl as usize];

        for rr in &request.row_ranges {
            for row in rr.start..=rr.end {
                let row_base = request.start_offset + row * bpl;
                if row_base >= size {
                    break;
                }
                let avail = (size - row_base).min(bpl) as usize;
                let n = f.read(row_base, &mut row_buf[..avail]);
                for &col in &cols {
                    let c = col as usize;
                    if c >= n {
                        break;
                    }
                    out.write_all(&row_buf[c..c + 1])
                        .map_err(|e| format!("写入失败: {e}"))?;
                    written += 1;
                }
            }
        }

        out.flush().map_err(|e| format!("刷新失败: {e}"))?;
        Ok(written)
    })?
}
