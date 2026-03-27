import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { LibraryToolbar } from "../components/LibraryToolbar";
import { BookGrid } from "../components/BookGrid";
import { BookList } from "../components/BookList";
import { ReaderView } from "./ReaderView";
import { useLibraryStore } from "../store/libraryStore";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { getPlatform } from "../platform";
import type { Book } from "@shared/models/book";

const sortBooks = (books: Book[], sort: "recent" | "opened" | "author") => {
  const copy = [...books];
  if (sort === "author") {
    return copy.sort((a, b) => (a.author ?? "").localeCompare(b.author ?? ""));
  }
  if (sort === "opened") {
    return copy.sort((a, b) => {
      const aTime = a.lastOpened ? Date.parse(a.lastOpened) : 0;
      const bTime = b.lastOpened ? Date.parse(b.lastOpened) : 0;
      return bTime - aTime;
    });
  }
  return copy.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
};

export const LibraryPage = () => {
  const {
    books,
    filters,
    loading,
    syncStatus,
    loadBooks,
    importBooks,
    importPaths,
    refreshMetadata,
    setFilter,
    startDriveAuth,
    syncNow
  } = useLibraryStore();

  const debouncedQuery = useDebouncedValue(filters.query, 250);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string[]>("tauri://file-drop", (event) => {
      if (Array.isArray(event.payload)) {
        importPaths(event.payload);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [importPaths]);

  const platform = getPlatform();
  const [selected, setSelected] = useState<Book | null>(null);

  useEffect(() => {
    if (platform === "mobile") {
      syncNow().catch(() => {
        // startup sync failure is fine; user can retry manually
      });
    }
  }, [platform, syncNow]);

  const authors = useMemo(() => {
    return Array.from(new Set(books.map((book) => book.author).filter(Boolean))) as string[];
  }, [books]);

  const genres = useMemo(() => {
    const all = books.flatMap((book) => book.genres ?? []);
    return Array.from(new Set(all));
  }, [books]);

  const filteredBooks = useMemo(() => {
    let result = books;
    if (filters.author !== "all") {
      result = result.filter((book) => book.author === filters.author);
    }
    if (filters.genre !== "all") {
      result = result.filter((book) => book.genres?.includes(filters.genre));
    }
    if (debouncedQuery.trim().length > 0) {
      const query = debouncedQuery.toLowerCase();
      result = result.filter((book) => {
        const haystack = `${book.title} ${book.author ?? ""} ${book.genres.join(" ")}`.toLowerCase();
        return haystack.includes(query);
      });
    }
    return sortBooks(result, filters.sort);
  }, [books, filters.author, filters.genre, filters.sort, debouncedQuery]);

  return (
    <section className="flex h-full flex-col gap-6">
      {platform === "mobile" && (
        <div className="sticky top-0 z-20 border-b border-white/10 bg-graphite-900/80 px-4 py-2 backdrop-blur">
          <div className="flex items-center justify-between">
            <p className="text-base font-semibold text-white">DudeReader Mobile</p>
            <button
              type="button"
              className="rounded-xl bg-white/10 px-3 py-1 text-xs text-white"
              onClick={() => setSelected(null)}
            >
              Library
            </button>
          </div>
        </div>
      )}

      <div className="rounded-3xl bg-gradient-to-r from-white/5 via-transparent to-white/5 p-[1px]">
        <div className="rounded-3xl bg-graphite-900/70 p-6">
          <h1 className="text-2xl font-semibold text-white">Library</h1>
          <p className="mt-2 text-sm text-white/60">
            Keep every book, cover, and stat synchronized across devices.
          </p>
        </div>
      </div>

      <LibraryToolbar
        filters={filters}
        authors={authors}
        genres={genres}
        syncStatus={syncStatus}
        onImport={importBooks}
        onFilterChange={setFilter}
        onConnect={startDriveAuth}
        onSync={syncNow}
      />

      <div className="flex-1 rounded-3xl border border-white/5 bg-graphite-850/70 p-4 shadow-glow">
        {loading ? (
          <div className="flex h-full items-center justify-center text-white/60">Loading your library�</div>
        ) : filteredBooks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-white/60">
            <p className="text-lg font-semibold text-white">No books yet</p>
            <p className="max-w-md text-sm">
              Import EPUB or PDF files to populate your library. Metadata will auto-fill and sync with Drive.
            </p>
            <button
              className="rounded-2xl bg-gradient-to-r from-pink-400 via-purple-400 to-sky-400 px-4 py-2 text-sm font-semibold text-graphite-900"
              type="button"
              onClick={importBooks}
            >
              Import your first book
            </button>
          </div>
        ) : filters.view === "grid" ? (
          <BookGrid
            books={filteredBooks}
            onRefresh={refreshMetadata}
            onOpen={(book) => setSelected(book)}
          />
        ) : (
          <BookList
            books={filteredBooks}
            onRefresh={refreshMetadata}
            onOpen={(book) => setSelected(book)}
          />
        )}
      </div>

      {selected && <ReaderView book={selected} onClose={() => setSelected(null)} />}
    </section>
  );
};
