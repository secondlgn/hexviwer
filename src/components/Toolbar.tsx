import { useEffect, useState } from "react";
import { useAppStore } from "../store";

export default function Toolbar() {
  const { tabs, activeTabId, updateTab } = useAppStore();
  const active = tabs.find((t) => t.id === activeTabId);

  // Local text state so the user can type freely; committed on Enter / blur.
  const [offsetText, setOffsetText] = useState("0");
  const [bplText, setBplText] = useState("16");

  useEffect(() => {
    if (active) {
      setOffsetText(active.startOffset.toString(16).toUpperCase());
      setBplText(String(active.bytesPerLine));
    }
  }, [active?.id, active?.startOffset, active?.bytesPerLine]);

  if (!active) {
    return (
      <div className="flex items-center gap-3 px-3 bg-panel-light border-b border-border h-8 text-text-secondary">
        起始偏移:
        <input type="text" disabled style={{ width: 110 }} />
        每行字节:
        <input type="text" disabled style={{ width: 80 }} />
      </div>
    );
  }

  const commitOffset = () => {
    const v = parseInt(offsetText.trim(), 16);
    if (!isNaN(v) && v >= 0 && v < active.size) {
      updateTab(active.id, { startOffset: v, scrollTop: 0, cursorOffset: v });
    } else {
      setOffsetText(active.startOffset.toString(16).toUpperCase());
    }
  };

  const commitBpl = () => {
    const v = Math.floor(Number(bplText.trim()));
    if (Number.isFinite(v) && v >= 1 && v <= 1024) {
      updateTab(active.id, { bytesPerLine: v, scrollTop: 0 });
    } else {
      setBplText(String(active.bytesPerLine));
    }
  };

  return (
    <div className="flex items-center gap-3 px-3 bg-panel-light border-b border-border h-8">
      <label className="text-text-secondary">起始偏移:</label>
      <input
        type="text"
        value={offsetText}
        onChange={(e) => setOffsetText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape")
            setOffsetText(active.startOffset.toString(16).toUpperCase());
        }}
        onBlur={commitOffset}
        spellCheck={false}
        style={{ width: 110, fontFamily: "monospace" }}
        placeholder="0"
        title="十六进制起始偏移，回车确认"
      />
      <label className="text-text-secondary">每行字节:</label>
      <input
        type="text"
        value={bplText}
        onChange={(e) => setBplText(e.target.value.replace(/[^\d]/g, ""))}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape")
            setBplText(String(active.bytesPerLine));
        }}
        onBlur={commitBpl}
        spellCheck={false}
        style={{ width: 80, fontFamily: "monospace" }}
        placeholder="16"
        title="每行显示的字节数（1-1024，可自由输入），回车确认"
      />
      <span className="text-text-secondary text-xxs">
        常用: 8 / 16 / 32
      </span>
    </div>
  );
}
