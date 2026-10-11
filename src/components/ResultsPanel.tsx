import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { readRange, base64ToBytes, searchBytes } from "../api";
import { useAppStore } from "../store";
import type { Frame } from "../types";
import {
  HEX_FONT,
  HEX_ROW_H,
  hexCharW,
  hexByteStep,
  hexByteX,
  hexRowWidth,
} from "../hexfont";

const ROW_H = HEX_ROW_H;
const HEADER_H = 24;
const HSCROLL_H = 10;
const CHAR_W = hexCharW();
const BYTE_W = hexByteStep();
const COL_IDX_W = 56;
const COL_LEN_W = 82;
const MAX_RESULTS = 1_000_000;
const CACHE_LIMIT = 500;
const FONT = HEX_FONT;

interface RowCache {
  start: number;
  data: Uint8Array;
}

interface ResultsPanelProps {
  onJumpTo: (offset: number) => void;
  onOpenFrame: (frame: Frame) => void;
}

/**
 * Search results panel. Every match is a row whose length runs to the next
 * match (the last row ends at end of stream). The hex content column is
 * virtually rendered in both directions (vertical native scroll, horizontal
 * custom scrollbar) so a result of any length can be browsed.
 */
export default function ResultsPanel({ onJumpTo, onOpenFrame }: ResultsPanelProps) {
  const {
    findResults,
    findHasMore,
    findPattern,
    findFileId,
    tabs,
    activeTabId,
    searchNonce,
    setFindResults,
    setFindPattern,
  } = useAppStore();

  const [patternText, setPatternText] = useState(findPattern);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hScrollRef = useRef(0);
  const dataRef = useRef(new Map<number, RowCache>());
  const reqIdRef = useRef(0);
  const rafRef = useRef(0);

  // The active tab is the search target; the displayed rows belong to the
  // tab that owns the current results (may differ after switching tabs).
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const file =
    tabs.find((t) => t.fileId === findFileId) ?? activeTab;
  const fileSize = file?.size ?? 0;

  const frames = useMemo<Frame[]>(() => {
    if (!findResults.length || !file) return [];
    return findResults.map((off, i) => ({
      index: i,
      offset: off,
      length:
        (i + 1 < findResults.length ? findResults[i + 1] : fileSize) - off,
    }));
  }, [findResults, fileSize, file]);

  const maxFrameLen = useMemo(
    () => frames.reduce((m, f) => Math.max(m, f.length), 0),
    [frames]
  );

  // Length (in bytes) of the pattern, used to highlight matched bytes.
  const patternLen = useMemo(() => {
    const cleaned = findPattern.replace(/\s+/g, "").replace(/0x/gi, "");
    return Math.max(1, Math.floor(cleaned.length / 2));
  }, [findPattern]);

  const addrDigits = Math.max(
    8,
    Math.ceil(Math.max(1, fileSize).toString(16).length / 2) * 2
  );
  const addrW = addrDigits * CHAR_W + 20;
  const x0 = COL_IDX_W + addrW + COL_LEN_W;
  const maxContentW = hexRowWidth(maxFrameLen, 0, BYTE_W);

  const maxHScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return 0;
    const cw = Math.max(0, container.clientWidth - x0);
    return Math.max(0, maxContentW - cw);
  }, [maxContentW, x0]);

  const renderRef = useRef<() => void>(() => {});
  const ensureRef = useRef<() => void>(() => {});

  /** Fetch data for visible rows' current horizontal window. */
  const ensureData = useCallback(async () => {
    const container = containerRef.current;
    const scroll = scrollRef.current;
    if (!container || !scroll || !file || frames.length === 0) return;

    const h = scroll.clientHeight;
    const w = container.clientWidth;
    const firstRow = Math.floor(scroll.scrollTop / ROW_H);
    const lastRow = Math.min(
      frames.length - 1,
      firstRow + Math.ceil(h / ROW_H) + 1
    );
    if (lastRow < firstRow) return;

    const cw = Math.max(0, w - x0);
    const hs = Math.min(hScrollRef.current, maxHScroll());
    const colStart = Math.max(0, Math.floor(hs / BYTE_W) - 4);
    const colCount = Math.ceil(cw / BYTE_W) + 8;

    const missing: number[] = [];
    for (let r = firstRow; r <= lastRow; r++) {
      const f = frames[r];
      const needEnd = Math.min(f.length, colStart + colCount);
      if (needEnd <= colStart) continue;
      const c = dataRef.current.get(r);
      if (!c || c.start > colStart || c.start + c.data.length < needEnd) {
        missing.push(r);
      }
    }
    if (missing.length === 0) return;

    const myReq = ++reqIdRef.current;
    try {
      const results = await Promise.all(
        missing.map((r) => {
          const f = frames[r];
          const s = Math.min(colStart, Math.max(0, f.length - 1));
          const len = Math.max(1, Math.min(colCount + 8, f.length - s));
          return readRange(file.fileId, f.offset + s, len);
        })
      );
      if (myReq !== reqIdRef.current) return;
      missing.forEach((r, k) => {
        const f = frames[r];
        const s = Math.min(colStart, Math.max(0, f.length - 1));
        dataRef.current.set(r, {
          start: s,
          data: base64ToBytes(results[k].data),
        });
      });
      // Trim cache (Map preserves insertion order).
      const map = dataRef.current;
      if (map.size > CACHE_LIMIT) {
        let del = map.size - CACHE_LIMIT / 2;
        for (const key of map.keys()) {
          if (del-- <= 0) break;
          map.delete(key);
        }
      }
      renderRef.current();
    } catch (e) {
      console.error("read_range failed", e);
    }
  }, [file, frames, x0, maxHScroll]);

  /** Draw the whole table onto the canvas. */
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const scroll = scrollRef.current;
    if (!canvas || !container || !scroll) return;
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
    ctx.font = FONT;
    ctx.textBaseline = "middle";

    const contentH = h - HSCROLL_H;
    const scrollTop = scroll.scrollTop;
    const hs = Math.min(hScrollRef.current, maxHScroll());
    if (hs !== hScrollRef.current) hScrollRef.current = hs;
    const firstRow = Math.floor(scrollTop / ROW_H);
    const visibleRows = Math.ceil((contentH - HEADER_H) / ROW_H) + 1;

    // Background
    ctx.fillStyle = "#1e1e1e";
    ctx.fillRect(0, 0, w, h);

    // Header
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(0, 0, w, HEADER_H);
    ctx.fillStyle = "#9d9d9d";
    ctx.fillText("#", 10, HEADER_H / 2);
    ctx.fillText("偏移", COL_IDX_W + 10, HEADER_H / 2);
    ctx.fillText("长度", COL_IDX_W + addrW + 10, HEADER_H / 2);
    ctx.fillText("内容 (hex)", x0 + 10, HEADER_H / 2);
    ctx.fillStyle = "#3c3c3c";
    ctx.fillRect(0, HEADER_H - 1, w, 1);

    // Content area (clipped)
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, HEADER_H, w - x0, contentH - HEADER_H);
    ctx.clip();
    for (let r = 0; r < visibleRows; r++) {
      const rowIdx = firstRow + r;
      if (rowIdx >= frames.length) break;
      const f = frames[rowIdx];
      const y = HEADER_H + r * ROW_H - (scrollTop % ROW_H);

      if (rowIdx % 2 === 1) {
        ctx.fillStyle = "#1b1b1c";
        ctx.fillRect(x0, y, w - x0, ROW_H);
      }
      if (rowIdx === selected) {
        ctx.fillStyle = "#094771";
        ctx.fillRect(x0, y, w - x0, ROW_H);
      }

      const cache = dataRef.current.get(rowIdx);
      if (!cache) continue;
      for (let c = 0; c < f.length; c++) {
        const bx = hexByteX(c, 0, BYTE_W);
        const x = x0 + bx - hs;
        if (x > w) break;
        if (x + 2 * CHAR_W < x0) continue;
        const dIdx = c - cache.start;
        if (dIdx < 0 || dIdx >= cache.data.length) continue;
        const isHead = c < patternLen;
        if (isHead) {
          ctx.fillStyle = "#5a3a10";
          ctx.fillRect(x - 2, y, BYTE_W + 1, ROW_H);
        }
        ctx.fillStyle = isHead ? "#ffd700" : "#d4d4d4";
        const b = cache.data[dIdx];
        ctx.fillText(
          b.toString(16).toUpperCase().padStart(2, "0"),
          x,
          y + ROW_H / 2
        );
      }
    }
    ctx.restore();

    // Fixed columns (cover content scrolled beneath)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HEADER_H, x0, contentH - HEADER_H);
    ctx.clip();
    for (let r = 0; r < visibleRows; r++) {
      const rowIdx = firstRow + r;
      if (rowIdx >= frames.length) break;
      const f = frames[rowIdx];
      const y = HEADER_H + r * ROW_H - (scrollTop % ROW_H);

      if (rowIdx % 2 === 1) {
        ctx.fillStyle = "#1b1b1c";
        ctx.fillRect(0, y, x0, ROW_H);
      }
      if (rowIdx === selected) {
        ctx.fillStyle = "#094771";
        ctx.fillRect(0, y, x0, ROW_H);
      }
      ctx.fillStyle = "#858585";
      ctx.fillText(String(rowIdx + 1), 10, y + ROW_H / 2);
      ctx.fillStyle = "#6a9955";
      ctx.fillText(
        "0x" + f.offset.toString(16).toUpperCase(),
        COL_IDX_W + 10,
        y + ROW_H / 2
      );
      ctx.fillStyle = "#d4d4d4";
      ctx.fillText(String(f.length), COL_IDX_W + addrW + 10, y + ROW_H / 2);
    }
    ctx.restore();

    // Column separator
    ctx.fillStyle = "#333334";
    ctx.fillRect(x0 - 1, HEADER_H, 1, contentH - HEADER_H);

    // Custom horizontal scrollbar
    ctx.fillStyle = "#252525";
    ctx.fillRect(0, contentH, w, HSCROLL_H);
    const maxScroll = maxHScroll();
    if (maxScroll > 0) {
      const cw = Math.max(0, w - x0);
      const trackW = w - 16;
      const thumbW = Math.max(30, Math.min(trackW, (trackW * cw) / maxContentW));
      const maxThumb = trackW - thumbW;
      const thumbX = 8 + (hs / maxScroll) * maxThumb;
      ctx.fillStyle = "#4a4a4a";
      ctx.fillRect(thumbX, contentH + 2, thumbW, HSCROLL_H - 4);
    }
  }, [frames, selected, patternLen, addrW, x0, maxContentW, maxHScroll]);

  useEffect(() => {
    renderRef.current = render;
  });

  useEffect(() => {
    ensureRef.current = ensureData;
  });

  const scheduleEnsure = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      ensureRef.current();
    });
  }, []);

  // Reset view + cache whenever the result set changes.
  useEffect(() => {
    dataRef.current.clear();
    hScrollRef.current = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setSelected(null);
    renderRef.current();
    scheduleEnsure();
  }, [frames, scheduleEnsure]);

  // Focus the pattern input when requested from the menu.
  useEffect(() => {
    if (searchNonce > 0) inputRef.current?.focus();
  }, [searchNonce]);

  // Vertical scroll
  const onScroll = useCallback(() => {
    renderRef.current();
    scheduleEnsure();
  }, [scheduleEnsure]);

  // Click / double click on rows
  const rowAt = useCallback(
    (e: React.MouseEvent): number | null => {
      const container = containerRef.current;
      const scroll = scrollRef.current;
      if (!container || !scroll) return null;
      const rect = container.getBoundingClientRect();
      const y = e.clientY - rect.top;
      if (y > container.clientHeight - HSCROLL_H) return null; // scrollbar
      const rel = y - HEADER_H + scroll.scrollTop;
      if (rel < 0) return null;
      const rowIdx = Math.floor(rel / ROW_H);
      if (rowIdx < 0 || rowIdx >= frames.length) return null;
      return rowIdx;
    },
    [frames.length]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rowIdx = rowAt(e);
      if (rowIdx === null) return;
      setSelected(rowIdx);
      onJumpTo(frames[rowIdx].offset);
    },
    [rowAt, frames, onJumpTo]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rowIdx = rowAt(e);
      if (rowIdx === null) return;
      onOpenFrame(frames[rowIdx]);
    },
    [rowAt, frames, onOpenFrame]
  );

  // Drag on the custom horizontal scrollbar
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const yIn = e.clientY - rect.top;
      if (yIn < container.clientHeight - HSCROLL_H) return;
      const maxScroll = maxHScroll();
      if (maxScroll <= 0) return;
      e.preventDefault();
      e.stopPropagation();

      const cw = Math.max(0, container.clientWidth - x0);
      const trackW = container.clientWidth - 16;
      const thumbW = Math.max(
        30,
        Math.min(trackW, (trackW * cw) / maxContentW)
      );
      const maxThumb = trackW - thumbW;
      const xIn = e.clientX - rect.left;
      const thumbX = 8 + (hScrollRef.current / maxScroll) * maxThumb;
      const inThumb = xIn >= thumbX && xIn <= thumbX + thumbW;
      const startH = hScrollRef.current;
      const startX = e.clientX;

      const onMove = (ev: MouseEvent) => {
        if (inThumb) {
          const dx = ev.clientX - startX;
          hScrollRef.current = Math.max(
            0,
            Math.min(maxScroll, startH + (dx / maxThumb) * maxScroll)
          );
        } else {
          // Clicked on the track: jump proportionally.
          const ratio = Math.max(
            0,
            Math.min(1, (ev.clientX - rect.left - 8 - thumbW / 2) / maxThumb)
          );
          hScrollRef.current = ratio * maxScroll;
        }
        renderRef.current();
        ensureRef.current();
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [maxHScroll, maxContentW, x0]
  );

  // Wheel: horizontal scroll (native wheel handles vertical)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const maxScroll = maxHScroll();
      if (maxScroll <= 0) return;
      let dx = e.deltaX;
      if (e.shiftKey && e.deltaX === 0) dx = e.deltaY;
      if (dx === 0) return;
      e.preventDefault();
      hScrollRef.current = Math.max(
        0,
        Math.min(maxScroll, hScrollRef.current + dx)
      );
      renderRef.current();
      ensureRef.current();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [maxHScroll]);

  // Redraw on resize / when web fonts become available.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      renderRef.current();
      ensureRef.current();
    });
    ro.observe(container);
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) renderRef.current();
    });
    return () => {
      ro.disconnect();
      cancelled = true;
    };
  }, []);

  const parsePattern = (): number[] | null => {
    const cleaned = patternText.replace(/\s+/g, "").replace(/0x/gi, "");
    if (cleaned.length === 0) return null;
    if (cleaned.length % 2 !== 0) {
      setError("十六进制长度必须为偶数");
      return null;
    }
    const bytes: number[] = [];
    for (let i = 0; i < cleaned.length; i += 2) {
      const b = parseInt(cleaned.substr(i, 2), 16);
      if (isNaN(b)) {
        setError(`无效的十六进制: ${cleaned.substr(i, 2)}`);
        return null;
      }
      bytes.push(b);
    }
    return bytes;
  };

  const handleSearch = async () => {
    if (!activeTab) {
      setError("请先打开文件");
      return;
    }
    const bytes = parsePattern();
    if (!bytes) return;
    setError("");
    setBusy(true);
    try {
      const res = await searchBytes(activeTab.fileId, bytes, 0, MAX_RESULTS);
      setFindResults(res, activeTab.fileId);
      setFindPattern(patternText.trim());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 bg-panel-light border-b border-border text-xs">
        <label className="text-text-secondary">查找:</label>
        <input
          ref={inputRef}
          type="text"
          value={patternText}
          onChange={(e) => {
            setPatternText(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearch();
          }}
          placeholder="AA 55 01"
          spellCheck={false}
          style={{ width: 160, fontFamily: "monospace", height: 22 }}
          autoFocus
        />
        <button
          onClick={handleSearch}
          disabled={busy || !activeTab}
          style={{ height: 22, padding: "1px 12px" }}
        >
          {busy ? "查找中..." : "查找"}
        </button>
        <span className="text-text-secondary">
          {findResults.length > 0 &&
            `命中 ${findResults.length}${findHasMore ? "+" : ""} 处，长度 = 相邻命中间隔${findHasMore ? "（已达上限）" : ""}`}
        </span>
        {error && <span className="text-red-400">{error}</span>}
      </div>

      {/* Virtual table */}
      <div ref={containerRef} className="flex-1 min-h-0 relative bg-panel">
        <div
          ref={scrollRef}
          className="absolute overflow-auto"
          style={{ top: 0, left: 0, right: 0, bottom: HSCROLL_H }}
          onScroll={onScroll}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onMouseDown={handleMouseDown}
        >
          <div style={{ height: frames.length * ROW_H, width: x0 + 16 }} />
        </div>
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 pointer-events-none"
        />
        {frames.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-text-secondary text-sm pointer-events-none">
            {findResults.length === 0 && findPattern
              ? "无查找结果"
              : "输入要查找的十六进制字节序列后回车；单击跳转，双击在上方标签页打开命中区间"}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-2 py-1 text-xxs text-text-secondary border-t border-border">
        <span>单击跳转到该命中位置，双击在上方标签页打开命中区间；内容区 Shift+滚轮或拖动底部滚动条横向查看</span>
        <span>{file ? file.path.split(/[\\/]/).pop() : ""}</span>
      </div>
    </div>
  );
}
