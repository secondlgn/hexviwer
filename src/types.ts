export interface FileTab {
  id: string;
  fileId: number;
  name: string;
  path: string;
  size: number;
  startOffset: number;
  bytesPerLine: number;
  /** scrollTop in pixels, computed from row index */
  scrollTop: number;
  /** current selected byte offset (relative to file) */
  cursorOffset: number;
  /** frame view mode (tab opened from a result row) */
  frameMode: boolean;
}

/** One variable-length frame: starts at a match, ends at the next match
 *  (the last frame ends at end-of-stream). */
export interface Frame {
  index: number;
  offset: number;
  length: number;
}

export interface SearchResult {
  offsets: number[];
  totalFound: number;
  hasMore: boolean;
}

export interface RowRange {
  start: number;
  end: number;
}

export interface ColRange {
  start: number;
  end: number;
}
