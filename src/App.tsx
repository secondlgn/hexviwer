import { useState, useCallback, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openFile, openFolder, closeFile } from "./api";
import { useAppStore, genTabId } from "./store";
import type { FileTab, Frame } from "./types";
import MenuBar from "./components/MenuBar";
import Toolbar from "./components/Toolbar";
import TabBar from "./components/TabBar";
import ByteView, { type ByteViewHandle } from "./components/ByteView";
import StatusBar from "./components/StatusBar";
import ResultsPanel from "./components/ResultsPanel";
import ExportDialog from "./components/ExportDialog";

export default function App() {
  const {
    tabs,
    activeTabId,
    addTab,
    closeTab: closeTabStore,
    updateTab,
    bottomOpen,
    bottomHeight,
    setBottomOpen,
    setBottomHeight,
    findResults,
    findHasMore,
    findFileId,
    findPattern,
  } = useAppStore();

  const [exportOpen, setExportOpen] = useState(false);

  const byteViewRef = useRef<ByteViewHandle>(null);

  const active = tabs.find((t) => t.id === activeTabId) ?? null;

  const openAndAddTab = useCallback(
    async (path: string, isFolder: boolean) => {
      try {
        const res = isFolder ? await openFolder(path) : await openFile(path);
        const base = path.split(/[\\/]/).pop() || path;
        const name =
          res.files > 1 ? `${base} (${res.files} 个文件)` : base;
        const tab: FileTab = {
          id: genTabId(),
          fileId: res.fileId,
          name,
          path: res.path,
          size: res.size,
          startOffset: 0,
          bytesPerLine: 16,
          scrollTop: 0,
          cursorOffset: 0,
          frameMode: false,
        };
        addTab(tab);
      } catch (e) {
        alert(`打开失败: ${e}`);
      }
    },
    [addTab]
  );

  const handleOpenFile = useCallback(async () => {
    const selected = await open({
      title: "打开文件",
      multiple: false,
      filters: [
        { name: "All Files", extensions: ["*"] },
        { name: "Binary", extensions: ["bin", "dat", "hex", "raw"] },
      ],
    });
    if (typeof selected === "string") {
      openAndAddTab(selected, false);
    }
  }, [openAndAddTab]);

  const handleOpenFolder = useCallback(async () => {
    const selected = await open({
      title: "选择文件夹（按文件名顺序组合为一个数据流）",
      directory: true,
    });
    if (typeof selected === "string") {
      openAndAddTab(selected, true);
    }
  }, [openAndAddTab]);

  const handleCloseTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (tab) {
        closeFile(tab.fileId).catch(() => {});
      }
      closeTabStore(id);
    },
    [tabs, closeTabStore]
  );

  const handleJumpToOffset = useCallback(
    (offset: number) => {
      if (!active) return;
      updateTab(active.id, { cursorOffset: offset });
      byteViewRef.current?.scrollToOffset(offset);
    },
    [active, updateTab]
  );

  const handleOpenFrame = useCallback(
    (frame: Frame) => {
      if (!active) return;
      const tab: FileTab = {
        id: genTabId(),
        fileId: active.fileId,
        name: `命中 #${frame.index + 1} @0x${frame.offset.toString(16).toUpperCase()}`,
        path: active.path,
        size: frame.offset + frame.length,
        startOffset: frame.offset,
        bytesPerLine: active.bytesPerLine,
        scrollTop: 0,
        cursorOffset: frame.offset,
        frameMode: true,
      };
      addTab(tab);
    },
    [active, addTab]
  );

  // Resizer drag for bottom panel
  const onResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = bottomHeight;

    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      setBottomHeight(Math.max(80, Math.min(600, startHeight + delta)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const openResults = useCallback(() => {
    setBottomOpen(true);
  }, [setBottomOpen]);

  const menus = [
    {
      label: "文件",
      items: [
        { label: "打开文件...", onClick: handleOpenFile },
        { label: "打开文件夹...", onClick: handleOpenFolder },
        { separator: true },
        {
          label: "关闭当前标签",
          onClick: () => {
            if (active) handleCloseTab(active.id);
          },
          disabled: !active,
        },
      ],
    },
    {
      label: "查找",
      items: [
        {
          label: "查找...",
          onClick: () => {
            openResults();
            useAppStore.getState().bumpSearchNonce();
          },
          disabled: !active,
        },
      ],
    },
    {
      label: "输出",
      items: [
        {
          label: "导出数据...",
          onClick: () => setExportOpen(true),
          disabled: !active,
        },
      ],
    },
  ];

  const activeFileId = active?.fileId ?? null;
  const highlights = findFileId === activeFileId ? findResults : [];
  const cleaned = findPattern.replace(/\s+/g, "").replace(/0x/gi, "");
  const highlightLength = Math.max(1, Math.floor(cleaned.length / 2));

  return (
    <div className="flex flex-col h-full w-full bg-panel">
      <MenuBar menus={menus} />
      <Toolbar />
      <TabBar />

      <div className="flex-1 min-h-0 flex flex-col">
        {active ? (
          <>
            {/* Byte view fills remaining space; fixed height so canvas renders */}
            <div className="flex-1 min-h-0">
              <ByteView
                ref={byteViewRef}
                tab={active}
                highlights={highlights}
                highlightLength={highlightLength}
                onCursorChange={(off) => updateTab(active.id, { cursorOffset: off })}
              />
            </div>

            {bottomOpen && (
              <>
                <div
                  className="resizer-h"
                  style={{ height: 4, flexShrink: 0 }}
                  onMouseDown={onResizerMouseDown}
                />
                <div
                  className="bg-panel border-t border-border flex flex-col"
                  style={{ height: bottomHeight, flexShrink: 0 }}
                >
                  <div
                    className="flex bg-panel-light border-b border-border"
                    style={{ height: 24 }}
                  >
                    <div className="px-3 flex items-center text-xs bg-panel text-text-primary border-t-2 border-accent">
                      查找结果
                      {findResults.length
                        ? ` (${findResults.length}${findHasMore ? "+" : ""})`
                        : ""}
                    </div>
                    <div className="flex-1" />
                    <div
                      className="px-2 flex items-center cursor-pointer text-text-secondary hover:text-text-hover"
                      onClick={() => setBottomOpen(false)}
                      title="关闭面板"
                    >
                      ×
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <ResultsPanel
                      onJumpTo={handleJumpToOffset}
                      onOpenFrame={handleOpenFrame}
                    />
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-secondary">
            <div className="text-center">
              <div className="text-lg mb-2">HexViwer</div>
              <div>通过 文件 → 打开文件 或 打开文件夹 开始</div>
            </div>
          </div>
        )}
      </div>

      <StatusBar />

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}
