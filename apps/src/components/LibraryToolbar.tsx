import type { BookFilter } from "@shared/models/book";
import type { DriveSyncStatus } from "@shared/sync/types";

const viewOptions: Array<{ value: BookFilter["view"]; label: string }> = [
  { value: "grid", label: "Grid" },
  { value: "list", label: "List" }
];

const sortOptions: Array<{ value: BookFilter["sort"]; label: string }> = [
  { value: "recent", label: "Recently Added" },
  { value: "opened", label: "Recently Opened" },
  { value: "author", label: "Author (A-Z)" }
];

type Props = {
  filters: BookFilter;
  authors: string[];
  genres: string[];
  syncStatus: DriveSyncStatus;
  onImport: () => void;
  onFilterChange: (partial: Partial<BookFilter>) => void;
  onSync: () => void;
  onConnect: () => void;
};

export const LibraryToolbar = ({
  filters,
  authors,
  genres,
  syncStatus,
  onImport,
  onFilterChange,
  onSync,
  onConnect
}: Props) => {
  return (
    <div className="paper-surface flex flex-wrap items-center justify-between gap-4 rounded-xl p-5">
      <div className="flex flex-1 flex-wrap items-center gap-3">
        <input
          className="inset-field w-64 px-4 py-2 text-sm"
          placeholder="Search by title, author, genre"
          value={filters.query}
          onChange={(event) => onFilterChange({ query: event.target.value })}
        />
        <select
          className="inset-field px-3 py-2 text-sm"
          value={filters.author}
          onChange={(event) => onFilterChange({ author: event.target.value })}
        >
          <option value="all">All authors</option>
          {authors.map((author) => (
            <option key={author} value={author}>
              {author}
            </option>
          ))}
        </select>
        <select
          className="inset-field px-3 py-2 text-sm"
          value={filters.genre}
          onChange={(event) => onFilterChange({ genre: event.target.value })}
        >
          <option value="all">All genres</option>
          {genres.map((genre) => (
            <option key={genre} value={genre}>
              {genre}
            </option>
          ))}
        </select>
        <select
          className="inset-field px-3 py-2 text-sm"
          value={filters.sort}
          onChange={(event) => onFilterChange({ sort: event.target.value as BookFilter["sort"] })}
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3">
        <div className="inset-field flex items-center gap-1 p-1">
          {viewOptions.map((option) => (
            <button
              key={option.value}
              className={`rounded-xl px-3 py-1 text-xs transition ${
                filters.view === option.value
                  ? "bg-white text-graphite-900"
                  : "text-on-surface-variant"
              }`}
              onClick={() => onFilterChange({ view: option.value })}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          className="tactile-button tactile-button-primary px-4 py-2 text-sm font-semibold"
          type="button"
          onClick={onImport}
        >
          Import books
        </button>
        <button
          className="tactile-button px-4 py-2 text-sm"
          type="button"
          onClick={onConnect}
        >
          Connect Drive
        </button>
        <button
          className="tactile-button px-4 py-2 text-sm"
          type="button"
          onClick={onSync}
        >
          {syncStatus === "syncing" ? "Syncing" : "Sync Now"}
        </button>
      </div>
    </div>
  );
};
