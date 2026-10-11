import { useAppStore } from "../store";

export default function StatusBar() {
  const { tabs, activeTabId } = useAppStore();
  const active = tabs.find((t) => t.id === activeTabId);

  const cursorOffset = active?.cursorOffset ?? 0;
  const size = active?.size ?? 0;
  const row = active ? Math.floor((cursorOffset - active.startOffset) / active.bytesPerLine) : 0;
  const col = active ? (cursorOffset - active.startOffset) % active.bytesPerLine : 0;

  return (
    <div className="flex items-center justify-between px-3 bg-accent text-white text-xs h-6 flex-shrink-0">
      <div className="flex gap-4">
        <span>文件: {active ? active.name : "无"}</span>
        <span>大小: {formatSize(size)}</span>
        <span>偏移: 0x{cursorOffset.toString(16).toUpperCase()}</span>
        <span>行: {row}  列: {col}</span>
      </div>
      <div className="flex gap-4">
        <span>{active ? `${active.bytesPerLine} 字节/行` : ""}</span>
        <span>HexViwer</span>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
