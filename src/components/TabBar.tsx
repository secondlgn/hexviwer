import { useAppStore } from "../store";

export default function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useAppStore();

  if (tabs.length === 0) return null;

  return (
    <div className="flex bg-panel-lighter border-b border-border overflow-x-auto" style={{ height: 30 }}>
      {tabs.map((t) => (
        <div
          key={t.id}
          className={`tab ${t.id === activeTabId ? "active" : ""}`}
          onClick={() => setActiveTab(t.id)}
        >
          <span className="truncate text-xs">{t.name}</span>
          <span
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(t.id);
            }}
          >
            ×
          </span>
        </div>
      ))}
    </div>
  );
}
