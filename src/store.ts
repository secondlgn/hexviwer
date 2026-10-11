import { create } from "zustand";
import type { FileTab, SearchResult } from "./types";

export interface AppState {
  tabs: FileTab[];
  activeTabId: string | null;

  // Bottom panel (single merged results panel)
  bottomOpen: boolean;
  bottomHeight: number;

  // Search results — every match is a frame start
  findPattern: string;
  findResults: number[];
  findHasMore: boolean;
  findFileId: number | null;

  /** bumped to make the results panel focus its input */
  searchNonce: number;

  // Actions
  addTab: (tab: FileTab) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, patch: Partial<FileTab>) => void;
  getActiveTab: () => FileTab | null;

  setBottomOpen: (v: boolean) => void;
  setBottomHeight: (h: number) => void;

  setFindPattern: (p: string) => void;
  setFindResults: (r: SearchResult, fileId: number) => void;
  clearFindResults: () => void;
  bumpSearchNonce: () => void;
}

let tabCounter = 0;

export const useAppStore = create<AppState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  bottomOpen: false,
  bottomHeight: 220,
  findPattern: "",
  findResults: [],
  findHasMore: false,
  findFileId: null,
  searchNonce: 0,

  addTab: (tab) =>
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
    })),

  closeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      const tabs = s.tabs.filter((t) => t.id !== id);
      let activeTabId = s.activeTabId;
      if (s.activeTabId === id) {
        activeTabId = tabs.length
          ? tabs[Math.max(0, idx - 1)].id
          : null;
      }
      return { tabs, activeTabId };
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  updateTab: (id, patch) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),

  getActiveTab: () => {
    const s = get();
    return s.tabs.find((t) => t.id === s.activeTabId) ?? null;
  },

  setBottomOpen: (v) => set({ bottomOpen: v }),

  setBottomHeight: (h) => set({ bottomHeight: h }),

  setFindPattern: (p) => set({ findPattern: p }),

  setFindResults: (r, fileId) =>
    set({
      findResults: r.offsets,
      findHasMore: r.hasMore,
      findFileId: fileId,
    }),

  clearFindResults: () =>
    set({ findResults: [], findHasMore: false, findFileId: null }),

  bumpSearchNonce: () => set((s) => ({ searchNonce: s.searchNonce + 1 })),
}));

export function genTabId(): string {
  return `tab_${++tabCounter}_${Date.now()}`;
}
