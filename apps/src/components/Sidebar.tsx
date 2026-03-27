import Logo from "../assets/DudeReadlogoNobg.png";

const navItems = [
  { label: "Library", active: true },
  { label: "Collections", active: false },
  { label: "Favorites", active: false }
];

export const Sidebar = () => {
  return (
    <aside className="flex h-full w-64 flex-col gap-6 rounded-3xl border border-white/5 bg-graphite-850/80 p-6 shadow-glow">
      <div className="flex items-center gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/5">
          <img src={Logo} alt="DudeReader logo" className="h-9 w-9" />
        </div>
        <div>
          <p className="text-lg font-semibold">DudeReader</p>
          <p className="text-xs text-white/60">Library control center</p>
        </div>
      </div>

      <nav className="flex flex-col gap-2">
        {navItems.map((item) => (
          <button
            key={item.label}
            className={`flex items-center justify-between rounded-2xl px-4 py-3 text-left text-sm transition ${
              item.active
                ? "bg-white/10 text-white shadow-accent"
                : "text-white/60 hover:bg-white/5"
            }`}
            type="button"
          >
            <span>{item.label}</span>
            {item.active && <span className="h-2 w-2 rounded-full bg-white"></span>}
          </button>
        ))}
      </nav>

      <div className="mt-auto rounded-2xl border border-white/10 bg-gradient-to-br from-white/10 to-transparent p-4 text-xs text-white/70">
        Sync keeps your library mirrored on Google Drive. Connect once and keep reading everywhere.
      </div>
    </aside>
  );
};
