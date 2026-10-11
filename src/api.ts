import { invoke } from "@tauri-apps/api/core";
import type {
  SearchResult,
} from "./types";

export interface OpenResult {
  fileId: number;
  path: string;
  size: number;
  /** 物理文件数（单文件为 1，文件夹组合为实际文件数） */
  files: number;
}

export async function openFile(path: string): Promise<OpenResult> {
  return invoke<OpenResult>("open_file", { path });
}

export async function openFolder(path: string): Promise<OpenResult> {
  return invoke<OpenResult>("open_folder", { path });
}

export async function closeFile(fileId: number): Promise<void> {
  return invoke("close_file", { fileId });
}

export interface ReadRangeResult {
  data: string; // base64
  offset: number;
  length: number;
}

export async function readRange(
  fileId: number,
  offset: number,
  length: number
): Promise<ReadRangeResult> {
  return invoke<ReadRangeResult>("read_range", { fileId, offset, length });
}

export async function listFiles(): Promise<[number, string, number][]> {
  return invoke("list_files");
}

export async function searchBytes(
  fileId: number,
  pattern: number[],
  startOffset: number,
  maxResults: number
): Promise<SearchResult> {
  return invoke<SearchResult>("search_bytes", {
    fileId,
    pattern,
    startOffset,
    maxResults,
  });
}

export async function exportBinary(
  fileId: number,
  rowRanges: { start: number; end: number }[],
  colRanges: { start: number; end: number }[],
  bytesPerLine: number,
  startOffset: number,
  outputPath: string
): Promise<number> {
  return invoke<number>("export_binary", {
    request: {
      fileId,
      rowRanges,
      colRanges,
      bytesPerLine,
      startOffset,
      outputPath,
    },
  });
}

/** Decode a base64 string into a Uint8Array. */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
