import { useState, useRef, useEffect } from "react";

interface MenuItem {
  label?: string;
  onClick?: () => void;
  separator?: boolean;
  disabled?: boolean;
}

interface Menu {
  label: string;
  items: MenuItem[];
}

interface MenuBarProps {
  menus: Menu[];
}

export default function MenuBar({ menus }: MenuBarProps) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpenIdx(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div
      ref={ref}
      className="flex bg-panel-light border-b border-border select-none"
      style={{ height: 24 }}
    >
      {menus.map((m, i) => (
        <div key={i} className="relative">
          <button
            className="h-full px-3 text-text-primary hover:bg-panel-lighter border-0"
            style={{ background: openIdx === i ? "#3c3c3c" : undefined }}
            onMouseDown={(e) => {
              e.preventDefault();
              setOpenIdx(openIdx === i ? null : i);
            }}
            onMouseEnter={() => {
              if (openIdx !== null) setOpenIdx(i);
            }}
          >
            {m.label}
          </button>
          {openIdx === i && (
            <div className="dropdown-menu" style={{ top: 24, left: 0 }}>
              {m.items.map((item, j) =>
                item.separator ? (
                  <div key={j} className="dropdown-separator" />
                ) : (
                  <div
                    key={j}
                    className={`dropdown-item ${
                      item.disabled ? "opacity-40 pointer-events-none" : ""
                    }`}
                    onClick={() => {
                      if (!item.disabled) {
                        item.onClick?.();
                        setOpenIdx(null);
                      }
                    }}
                  >
                    {item.label}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
