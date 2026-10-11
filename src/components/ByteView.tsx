import {
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { readRange, base64ToBytes } from "../api";
import type { FileTab } from "../types";
import {
  HEX_FONT,
  HEX_ROW_H,
  ADDR_PAD,
  hexCharW,
  hexByteStep,
  hexByteX,
  hexRowWidth,
} from "../hexfont";

const ROW_HEIGHT = HEX_ROW_H;
const FONT = HEX_FONT;

export interface ByteViewHandle {
  /** Scroll the view so that the given absolute offset is visible. */
  scrollToOffset: (offset: number) => void;
}

interface ByteViewProps {
  tab: FileTab;
  /** offsets to highlight (search results) */
  highlights?: number[];
  /** highlight length in bytes */
  highlightLength?: number;
  /** on cursor change */
  onCursorChange?: (offset: number) => void;
}

const ByteView = forwardRef<ByteViewHandle, ByteViewProps>(function ByteView(
  { tab, highlights = [], highlightLength = 1, onCursorChange },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dataCacheRef = useRef<{
    startRow: number;
    rows: number;
    data: Uint8Array;
  } | null>(null);
  const reqIdRef = useRef(0);
  const rafRef = useRef(0);

  const bpl = tab.bytesPerLine;
  const startOffset = tab.startOffset;
  const fileSize = tab.size;

  const totalBytes = Math.max(0, fileSize - startOffset);
  const totalRows = Math.ceil(totalBytes / bpl);

  const charW = hexCharW();
  const byteStep = hexByteStep();
  const addrDigits = Math.max(
    8,
    Math.ceil(fileSize.toString(16).length / 2) * 2
  );
  const addrWidth = addrDigits * charW + ADDR_PAD * 2;
  const bytesOrigin = addrWidth + 8;
  const rowWidth = hexRowWidth(bpl, bytesOrigin, byteStep) + 16;

  /** Fetch bytes for the visible window (+buffer) and re-render. */
  const fetchAndRender = useCallback(async () => {
    const scroll = scrollRef.current;
    const container = containerRef.current;
    if (!scroll || !container) return;

    const viewH = container.clientHeight;
    const scrollTop = scroll.scrollTop;
    const firstRow = Math.floor(scrollTop / ROW_HEIGHT);
    const visibleRows = Math.ceil(viewH / ROW_HEIGHT) + 2;
    const bufferRows = 20;
    const fetchFirst = Math.max(0, firstRow - bufferRows);
    const fetchRows = Math.max(1, visibleRows + bufferRows * 2);

    const fileOffset = startOffset + fetchFirst * bpl;
    const fetchLen = fetchRows * bpl;

    const myReq = ++reqIdRef.current;
    try {
      const res = await readRange(tab.fileId, fileOffset, fetchLen);
      if (myReq !== reqIdRef.current) return; // stale response
      dataCacheRef.current = {
        startRow: fetchFirst,
        rows: fetchRows,
        data: base64ToBytes(res.data),
      };
      renderRef.current();
    } catch (e) {
      console.error("read_range failed", e);
    }
  }, [tab.fileId, startOffset, bpl]);

  /** Draw visible rows onto the canvas. */
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const scroll = scrollRef.current;
    const container = containerRef.current;
    if (!canvas || !scroll || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.style.width = w + "px";
    }
    if (canvas.height !== Math.round(h * dpr)) {
      canvas.height = Math.round(h * dpr);
      canvas.style.height = h + "px";
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const scrollTop = scroll.scrollTop;
    const scrollLeft = scroll.scrollLeft;
    // Shift drawing with horizontal scroll; canvas is a fixed viewport.
    ctx.translate(-scrollLeft, 0);
    ctx.font = FONT;
    ctx.textBaseline = "middle";

    const firstRow = Math.floor(scrollTop / ROW_HEIGHT);
    const visibleRows = Math.ceil(h / ROW_HEIGHT) + 1;
    const cache = dataCacheRef.current;

    // Highlight lookup
    const hlSet = new Set<number>();
    if (highlights.length > 0 && highlightLength > 0) {
      for (const off of highlights) {
        for (let i = 0; i < highlightLength; i++) hlSet.add(off + i);
      }
    }

    const cursor = tab.cursorOffset;

    for (let r = 0; r < visibleRows; r++) {
      const rowIdx = firstRow + r;
      if (rowIdx >= totalRows) break;
      const y = r * ROW_HEIGHT - (scrollTop % ROW_HEIGHT);

      // zebra striping (must cover full viewport width incl. scrolled area)
      if (rowIdx % 2 === 1) {
        ctx.fillStyle = "#1b1b1c";
        ctx.fillRect(scrollLeft, y, w, ROW_HEIGHT);
      }
      // hairline row separator
      ctx.fillStyle = "#262626";
      ctx.fillRect(scrollLeft, y + ROW_HEIGHT - 1, w, 1);

      const fileOffset = startOffset + rowIdx * bpl;
      ctx.fillStyle = "#6a9955";
      ctx.fillText(
        fileOffset.toString(16).toUpperCase().padStart(addrDigits, "0"),
        ADDR_PAD,
        y + ROW_HEIGHT / 2
      );

      if (!cache) continue;
      const localRow = rowIdx - cache.startRow;
      if (localRow < 0 || localRow >= cache.rows) continue;

      const rowStart = localRow * bpl;
      const rowEnd = Math.min(rowStart + bpl, cache.data.length);

      for (let c = 0; c < bpl; c++) {
        const absOffset = fileOffset + c;
        if (absOffset >= fileSize) break;

        const dataIdx = rowStart + c;
        const x = hexByteX(c, bytesOrigin, byteStep);
        const isCursor = absOffset === cursor;
        const isHighlight = hlSet.has(absOffset);

        if (isCursor) {
          ctx.fillStyle = "#094771";
          ctx.fillRect(x - 2, y, byteStep + 1, ROW_HEIGHT);
        } else if (isHighlight) {
          ctx.fillStyle = "#5a3a10";
          ctx.fillRect(x - 2, y, byteStep + 1, ROW_HEIGHT);
        }

        if (dataIdx < rowEnd) {
          const b = cache.data[dataIdx];
          ctx.fillStyle = isCursor
            ? "#ffffff"
            : isHighlight
              ? "#ffd700"
              : "#d4d4d4";
          ctx.fillText(
            b.toString(16).toUpperCase().padStart(2, "0"),
            x,
            y + ROW_HEIGHT / 2
          );
        }
      }
    }

    // Address column separator (drawn last so zebra rows don't cover it)
    ctx.fillStyle = "#333334";
    ctx.fillRect(addrWidth - 1, 0, 1, h);
  }, [
    startOffset,
    bpl,
    fileSize,
    totalRows,
    addrDigits,
    addrWidth,
    bytesOrigin,
    byteStep,
    highlights,
    highlightLength,
    tab.cursorOffset,
  ]);

  // Keep a ref to render so async fetch always uses the latest draw fn.
  const renderRef = useRef(render);
  useEffect(() => {
    renderRef.current = render;
  });

  // Initial fetch when file / view params change
  useEffect(() => {
    dataCacheRef.current = null;
    fetchAndRender();
  }, [fetchAndRender]);

  // Redraw whenever highlights or cursor change
  useEffect(() => {
    render();
  }, [render]);

  // Web fonts may load after first paint — remeasure and redraw then.
  useEffect(() => {
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) renderRef.current();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Scroll: redraw immediately, refetch whenever the visible range is not
  // fully covered by the cache (otherwise the bottom of the viewport would
  // render blank until the next fetch).
  const onScroll = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      renderRef.current();
      const cache = dataCacheRef.current;
      const scroll = scrollRef.current;
      const container = containerRef.current;
      if (cache && scroll && container) {
        const firstRow = Math.floor(scroll.scrollTop / ROW_HEIGHT);
        const lastRow =
          firstRow + Math.ceil(container.clientHeight / ROW_HEIGHT);
        if (
          firstRow - 1 < cache.startRow ||
          lastRow + 1 >= cache.startRow + cache.rows
        ) {
          fetchAndRender();
        }
      }
    });
  }, [fetchAndRender]);

  // Redraw on resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      renderRef.current();
      fetchAndRender();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [fetchAndRender]);

  // Click on the scroll area places the cursor
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left + scroll.scrollLeft;
      const y = e.clientY - rect.top;
      const rowIdx = Math.floor((scroll.scrollTop + y) / ROW_HEIGHT);
      // Invert byte column from the grouped layout.
      let colIdx = -1;
      for (let c = 0; c < bpl; c++) {
        const bx = hexByteX(c, bytesOrigin, byteStep);
        if (x >= bx && x < bx + byteStep) {
          colIdx = c;
          break;
        }
      }
      if (colIdx < 0) return;
      const offset = startOffset + rowIdx * bpl + colIdx;
      if (rowIdx >= 0 && offset >= 0 && offset < fileSize) {
        onCursorChange?.(offset);
      }
    },
    [bytesOrigin, byteStep, bpl, startOffset, fileSize, onCursorChange]
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let delta: number | null = null;
      if (e.key === "ArrowRight") delta = 1;
      else if (e.key === "ArrowLeft") delta = -1;
      else if (e.key === "ArrowDown") delta = bpl;
      else if (e.key === "ArrowUp") delta = -bpl;
      else if (e.key === "PageDown") delta = bpl * 16;
      else if (e.key === "PageUp") delta = -bpl * 16;
      else if (e.key === "Home") delta = -tab.cursorOffset;
      else if (e.key === "End") delta = fileSize - 1 - tab.cursorOffset;
      if (delta === null) return;
      e.preventDefault();
      const newOffset = Math.min(
        fileSize - 1,
        Math.max(0, tab.cursorOffset + delta)
      );
      if (newOffset !== tab.cursorOffset) {
        onCursorChange?.(newOffset);
        const row = Math.floor((newOffset - startOffset) / bpl);
        const scroll = scrollRef.current;
        if (scroll) {
          const target = row * ROW_HEIGHT;
          const viewH = scroll.clientHeight;
          if (
            target < scroll.scrollTop ||
            target > scroll.scrollTop + viewH - ROW_HEIGHT
          ) {
            scroll.scrollTop = Math.max(0, target - viewH / 2);
          }
        }
      }
    },
    [bpl, startOffset, fileSize, tab.cursorOffset, onCursorChange]
  );

  // Imperative API for external jump (e.g. from find results)
  useImperativeHandle(ref, () => ({
    scrollToOffset: (offset: number) => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      const rel = offset - startOffset;
      if (rel < 0) return;
      const row = Math.floor(rel / bpl);
      const target = row * ROW_HEIGHT;
      const viewH = scroll.clientHeight;
      scroll.scrollTop = Math.max(0, target - viewH / 2);
      fetchAndRender();
    },
  }));

  return (
    <div
      ref={containerRef}
      className="h-full w-full relative overflow-hidden bg-panel outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-auto"
        onScroll={onScroll}
        onClick={handleClick}
      >
        <div
          style={{
            height: totalRows * ROW_HEIGHT,
            width: rowWidth,
          }}
        />
      </div>
      {/* Canvas overlays the scroll area but never intercepts the wheel */}
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 pointer-events-none"
      />
    </div>
  );
});

export default ByteView;
