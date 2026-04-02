import { useMemo } from "react";
import { useLibraryStore } from "../store/libraryStore";

export type SettingsPageProps = {
  showToast: (message: string) => void;
};

export const SettingsPage = ({ showToast }: SettingsPageProps) => {
  const { driveConnected, syncStatus, startDriveAuth, syncNow, filters, setFilter } = useLibraryStore();

  const driveHelper =
    syncStatus === "syncing"
      ? "Syncing now..."
      : syncStatus === "error"
        ? "Last sync failed. Try again."
        : "Ready when you are.";

  const activeFilters = useMemo(() => {
    const items: string[] = [];
    if (filters.query.trim().length > 0) {
      items.push(`Search: "${filters.query.trim()}"`);
    }
    if (filters.author !== "all") {
      items.push(`Author: ${filters.author}`);
    }
    if (filters.genre !== "all") {
      items.push(`Genre: ${filters.genre}`);
    }
    return items;
  }, [filters.author, filters.genre, filters.query]);

  const resetFilters = () => {
    setFilter({ query: "", author: "all", genre: "all", sort: "recent", view: "grid" });
    showToast("Filters reset.");
  };

  const handleDriveAuth = () => {
    startDriveAuth().catch((error) => {
      if (error instanceof Error && error.message.trim().length > 0) {
        showToast(error.message);
        return;
      }
      showToast("Drive connection failed. Please retry.");
    });
  };

  const handleSync = () => {
    syncNow().catch((error) => {
      if (error instanceof Error && error.message.trim().length > 0) {
        showToast(error.message);
        return;
      }
      showToast("Sync failed. Check Drive status.");
    });
  };

  return (
    <div className="flex min-h-full flex-col gap-6">
      <div>
        <h2 className="text-3xl font-headline font-bold">Settings</h2>
        <p className="mt-2 text-sm text-on-surface-variant">
          Manage sync and keep your archive tidy.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-5">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">Drive Sync</p>
          <p className="mt-3 font-headline text-2xl font-bold text-on-surface">
            {driveConnected ? "Connected" : "Not Connected"}
          </p>
          <p className="mt-2 text-xs text-on-surface-variant">{driveHelper}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded-full border border-outline-variant/30 px-4 py-2 text-xs text-on-surface-variant transition hover:text-primary"
              onClick={handleDriveAuth}
            >
              {driveConnected ? "Reconnect Drive" : "Connect Drive"}
            </button>
            <button
              type="button"
              className="rounded-full border border-outline-variant/30 px-4 py-2 text-xs text-on-surface-variant transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleSync}
              disabled={!driveConnected}
            >
              Sync Now
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-5">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">Library Filters</p>
          <p className="mt-3 text-sm text-on-surface-variant">
            {activeFilters.length === 0 ? "No filters applied." : activeFilters.join(" | ")}
          </p>
          <button
            type="button"
            className="mt-4 rounded-full border border-outline-variant/30 px-4 py-2 text-xs text-on-surface-variant transition hover:text-primary"
            onClick={resetFilters}
          >
            Reset Filters
          </button>
        </div>
      </div>
    </div>
  );
};
