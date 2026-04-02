import Logo from "../assets/DudeReadlogoNobg.png";

const navItems = [
  { label: "Library", icon: "auto_stories" },
  { label: "Collections", icon: "collections_bookmark" },
  { label: "Streak", icon: "local_fire_department" },
  { label: "Settings", icon: "settings" }
];

type SidebarProps = {
  activeItem: string;
  onNavigate: (label: string) => void;
  onStartReading: () => void;
  startDisabled?: boolean;
};

export const Sidebar = ({ activeItem, onNavigate, onStartReading, startDisabled }: SidebarProps) => {
  return (
    <aside className="hidden h-full w-64 flex-col border-r border-primary/10 bg-surface-container-low px-4 py-8 shadow-[10px_0_40px_rgba(0,0,0,0.5)] md:flex">
      <div className="px-2 pb-8">
        <div className="flex items-center gap-3">
          <img src={Logo} alt="DudeReads logo" className="h-10 w-10" />
          <div>
            <p className="text-lg font-headline font-semibold text-on-surface">The Curator</p>
            <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant/70">
              Moonlit Reader
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-2 px-2 text-sm">
        {navItems.map((item) => (
          <button
            key={item.label}
            className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition ${
              item.label === activeItem
                ? "bg-surface-container-high text-primary"
                : "text-on-surface-variant hover:bg-surface-container-high hover:text-primary"
            }`}
            type="button"
            onClick={() => onNavigate(item.label)}
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            <span className={item.label === activeItem ? "font-semibold" : ""}>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="mt-auto px-2">
        <button
          className="w-full rounded-full bg-primary py-4 text-sm font-bold text-on-primary shadow-lg shadow-primary/10 transition hover:scale-[1.02] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          onClick={onStartReading}
          disabled={startDisabled}
        >
          Start Reading
        </button>
      </div>
    </aside>
  );
};
