import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { exportBinary } from "../api";
import { useAppStore } from "../store";
import type { ColRange, RowRange } from "../types";

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Parse a range string like "1-5, 10, 20-30" into inclusive ranges. */
function parseRangeStr(str: string, max: number): { ranges: RowRange[] | ColRange[]; error: string } {
  const ranges: RowRange[] = [];
  const parts = str.split(",").map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.includes("-")) {
      const [a, b] = part.split("-").map((x) => parseInt(x.trim(), 10));
      if (isNaN(a) || isNaN(b)) {
        return { ranges: [], error: `无效范围: ${part}` };
      }
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      ranges.push({ start: Math.max(0, start), end: Math.min(max, end) });
    } else {
      const v = parseInt(part, 10);
      if (isNaN(v)) {
        return { ranges: [], error: `无效值: ${part}` };
      }
      if (v >= 0 && v <= max) {
        ranges.push({ start: v, end: v });
      }
    }
  }
  return { ranges, error: "" };
}

export default function ExportDialog({ open, onClose }: ExportDialogProps) {
  const { tabs, activeTabId } = useAppStore();
  const [rowStr, setRowStr] = useState("");
  const [colStr, setColStr] = useState("");
  const [invertRows, setInvertRows] = useState(false);
  const [invertCols, setInvertCols] = useState(false);
  const [outputPath, setOutputPath] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");

  if (!open) return null;

  const active = tabs.find((t) => t.id === activeTabId);

  const totalBytes = active ? Math.max(0, active.size - active.startOffset) : 0;
  const totalRows = active ? Math.ceil(totalBytes / active.bytesPerLine) : 0;
  const maxCol = active ? active.bytesPerLine - 1 : 0;

  const handleBrowse = async () => {
    const path = await save({
      title: "导出二进制文件",
      defaultPath: active ? `${active.name}.bin` : "output.bin",
      filters: [{ name: "Binary", extensions: ["bin", "dat"] }],
    });
    if (path) setOutputPath(path);
  };

  const buildRanges = (
    str: string,
    invert: boolean,
    total: number
  ): RowRange[] | null => {
    if (invert) {
      // Invert: parse selection, then invert against [0, total-1]
      const { ranges, error } = parseRangeStr(str, total - 1);
      if (error) {
        setError(error);
        return null;
      }
      if (ranges.length === 0) {
        return [{ start: 0, end: total - 1 }];
      }
      // Merge selected ranges
      const selected = [...ranges].sort((a, b) => a.start - b.start);
      const inverted: RowRange[] = [];
      let cursor = 0;
      for (const r of selected) {
        if (r.start > cursor) {
          inverted.push({ start: cursor, end: r.start - 1 });
        }
        cursor = Math.max(cursor, r.end + 1);
      }
      if (cursor < total) {
        inverted.push({ start: cursor, end: total - 1 });
      }
      return inverted;
    } else {
      const { ranges, error } = parseRangeStr(str, total - 1);
      if (error) {
        setError(error);
        return null;
      }
      return ranges as RowRange[];
    }
  };

  const handleExport = async () => {
    if (!active) {
      setError("请先打开文件");
      return;
    }
    if (!outputPath) {
      setError("请选择输出文件");
      return;
    }
    setError("");
    setResult("");

    const rowRanges = buildRanges(rowStr, invertRows, totalRows);
    if (!rowRanges) return;
    const colRanges = buildRanges(colStr, invertCols, active.bytesPerLine) as ColRange[] | null;
    if (!colRanges) return;

    if (rowRanges.length === 0) {
      setError("行范围为空");
      return;
    }
    if (colRanges.length === 0) {
      setError("列范围为空");
      return;
    }

    setBusy(true);
    try {
      const written = await exportBinary(
        active.fileId,
        rowRanges,
        colRanges,
        active.bytesPerLine,
        active.startOffset,
        outputPath
      );
      setResult(`导出成功！共写入 ${written} 字节到 ${outputPath}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ minWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>输出（二进制导出）</span>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 16 }}>×</button>
        </div>
        <div className="modal-body space-y-3">
          <div className="text-text-secondary text-xs">
            按行和列选择要导出的字节，支持类似打印机打印范围的写法（如 <code>1-5, 10, 20-30</code>）。
          </div>

          <div className="flex gap-2 items-start">
            <label className="w-20 pt-1">行范围:</label>
            <div className="flex-1">
              <input
                type="text"
                value={rowStr}
                onChange={(e) => setRowStr(e.target.value)}
                placeholder={`0-${totalRows - 1}`}
                style={{ width: "100%", fontFamily: "monospace" }}
              />
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="checkbox"
                  checked={invertRows}
                  onChange={(e) => setInvertRows(e.target.checked)}
                  id="inv-rows"
                />
                <label htmlFor="inv-rows" className="text-xs text-text-secondary">
                  反选行
                </label>
                <span className="text-xxs text-text-secondary ml-auto">
                  共 {totalRows} 行
                </span>
              </div>
            </div>
          </div>

          <div className="flex gap-2 items-start">
            <label className="w-20 pt-1">列范围:</label>
            <div className="flex-1">
              <input
                type="text"
                value={colStr}
                onChange={(e) => setColStr(e.target.value)}
                placeholder={`0-${maxCol}`}
                style={{ width: "100%", fontFamily: "monospace" }}
              />
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="checkbox"
                  checked={invertCols}
                  onChange={(e) => setInvertCols(e.target.checked)}
                  id="inv-cols"
                />
                <label htmlFor="inv-cols" className="text-xs text-text-secondary">
                  反选列
                </label>
                <span className="text-xxs text-text-secondary ml-auto">
                  每行 {active?.bytesPerLine ?? 0} 字节
                </span>
              </div>
            </div>
          </div>

          <div className="flex gap-2 items-center">
            <label className="w-20">输出文件:</label>
            <input
              type="text"
              value={outputPath}
              onChange={(e) => setOutputPath(e.target.value)}
              placeholder="选择输出路径..."
              style={{ flex: 1 }}
            />
            <button onClick={handleBrowse}>浏览...</button>
          </div>

          {error && <div className="text-red-400 text-xs">{error}</div>}
          {result && <div className="text-green-400 text-xs">{result}</div>}
        </div>
        <div className="modal-footer">
          <button onClick={onClose}>关闭</button>
          <button onClick={handleExport} disabled={busy || !active}>
            {busy ? "导出中..." : "导出"}
          </button>
        </div>
      </div>
    </div>
  );
}
