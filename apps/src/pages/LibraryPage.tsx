import { useEffect, useMemo, useRef } from "react";
import { BookGrid } from "../components/BookGrid";
import { BookList } from "../components/BookList";
import { useLibraryStore } from "../store/libraryStore";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import type { Book, BookFilter } from "@shared/models/book";

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

const sortOptions: Array<{ value: BookFilter["sort"]; label: string }> = [
  { value: "recent", label: "Recently Added" },
  { value: "opened", label: "Recently Opened" },
  { value: "author", label: "Author (A-Z)" }
];

export type LibraryPageProps = {
  onOpenBook: (book: Book) => void;
  onNavigate: (tab: "library" | "collections" | "streak" | "settings") => void;
  showToast: (message: string) => void;
};

const resolveErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim().length > 0) {
      return maybeMessage;
    }
    if (typeof (error as { toString?: () => string }).toString === "function") {
      const text = (error as { toString: () => string }).toString();
      if (text && text !== "[object Object]") {
        return text;
      }
    }
  }
  return fallback;
};

export const LibraryPage = ({ onOpenBook, onNavigate, showToast }: LibraryPageProps) => {
  const { books, filters, loading, stats, importBooks, refreshMetadata, fetchCover, setFilter } =
    useLibraryStore();
  const debouncedQuery = useDebouncedValue(filters.query, 250);

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

  const totalBooks = books.length;
  const finishedBooks = books.filter((book) => book.progress >= 1).length;
  const lastOpenedBook = useMemo(() => {
    if (books.length === 0) {
      return null;
    }
    return [...books].sort((a, b) => {
      const aTime = Date.parse(a.lastOpened ?? a.createdAt);
      const bTime = Date.parse(b.lastOpened ?? b.createdAt);
      return bTime - aTime;
    })[0];
  }, [books]);
  const nowReading = lastOpenedBook ?? books[0] ?? null;

  const streakTitle = stats.streakDays > 0 ? `${stats.streakDays} Day Streak!` : "Start Your Streak";
  const streakSubtitle =
    stats.streakDays > 0
      ? `You've read on ${stats.daysLast7} of the last 7 days. Keep the ritual alive tonight.`
      : "Import a book and read a few pages to begin your first streak.";
  const streakBadge = stats.streakDays > 0 ? "Streak Active" : "Ritual Ready";

  const handleImport = () => {
    importBooks().catch((error) => {
      showToast(resolveErrorMessage(error, "Import failed. Try again."));
    });
  };

  const requestedCovers = useRef(new Set<string>());

  useEffect(() => {
    const missing = books.filter((book) => !book.coverUrl && !requestedCovers.current.has(book.id));
    missing.slice(0, 3).forEach((book) => {
      requestedCovers.current.add(book.id);
      fetchCover(book.id).catch(() => {
        // offline or unavailable; will retry on next launch
      });
    });
  }, [books, fetchCover]);

  return (
    <div className="flex min-h-full flex-col gap-10">
      <div className="md:hidden">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant">
            search
          </span>
          <input
            className="w-full rounded-full border border-outline-variant/30 bg-surface-container-lowest py-2.5 pl-12 pr-4 text-sm text-on-surface focus:border-primary/40 focus:outline-none"
            placeholder="Search your archive..."
            type="text"
            value={filters.query}
            onChange={(event) => setFilter({ query: event.target.value })}
          />
        </div>
      </div>

      <section className="grid gap-6 lg:grid-cols-12">
        <div className="relative overflow-hidden rounded-3xl border border-outline-variant/10 bg-surface-container-low p-8 lg:col-span-8">
          <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/5 blur-[80px]"></div>
          <div className="relative z-10">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-tertiary-container/20 px-3 py-1 text-xs font-bold uppercase tracking-widest text-tertiary">
              {streakBadge}
            </div>
            <h1 className="text-4xl font-headline font-bold md:text-5xl">{streakTitle}</h1>
            <p className="mt-4 max-w-md text-sm text-on-surface-variant md:text-base">{streakSubtitle}</p>
            <div className="mt-8 flex flex-wrap gap-4">
              <button
                type="button"
                className="rounded-full bg-primary px-8 py-3 font-bold text-on-primary transition hover:shadow-[0_0_20px_rgba(106,183,255,0.4)] disabled:opacity-40"
                onClick={() => nowReading && onOpenBook(nowReading)}
                disabled={!nowReading}
              >
                Continue Last Read
              </button>
              <button
                type="button"
                className="rounded-full border border-outline-variant/30 bg-surface-container-high px-8 py-3 font-semibold transition hover:bg-surface-container-highest"
                onClick={() => onNavigate("streak")}
              >
                View Analytics
              </button>
            </div>
          </div>
        </div>

        <button
          type="button"
          className="flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-outline-variant/40 bg-surface-container-lowest/50 p-8 transition hover:border-primary/40 hover:bg-surface-container-low lg:col-span-4"
          onClick={handleImport}
        >
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-container-high transition-transform hover:scale-110">
            <span className="material-symbols-outlined text-3xl text-primary">upload_file</span>
          </div>
          <h3 className="text-xl font-headline font-bold">Import Books</h3>
          <p className="mt-2 text-center text-sm text-on-surface-variant">
            Drag and drop folders or click to browse local archive
          </p>
        </button>
      </section>

      <section className="flex flex-1 flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h2 className="text-3xl font-headline font-bold">The Archive</h2>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-on-surface-variant">
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-primary"></span>
                {totalBooks} Total Books
              </span>
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-tertiary"></span>
                {finishedBooks} Finished
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={`rounded-lg p-2 transition ${
                  filters.view === "grid"
                    ? "bg-surface-container-high text-primary"
                    : "bg-surface-container-low text-on-surface-variant hover:text-primary"
                }`}
                onClick={() => setFilter({ view: "grid" })}
              >
                <span className="material-symbols-outlined">grid_view</span>
              </button>
              <button
                type="button"
                className={`rounded-lg p-2 transition ${
                  filters.view === "list"
                    ? "bg-surface-container-high text-primary"
                    : "bg-surface-container-low text-on-surface-variant hover:text-primary"
                }`}
                onClick={() => setFilter({ view: "list" })}
              >
                <span className="material-symbols-outlined">list</span>
              </button>
            </div>
            <select
              className="rounded-full border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant"
              value={filters.author}
              onChange={(event) => setFilter({ author: event.target.value })}
            >
              <option value="all">All authors</option>
              {authors.map((author) => (
                <option key={author} value={author}>
                  {author}
                </option>
              ))}
            </select>
            <select
              className="rounded-full border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant"
              value={filters.genre}
              onChange={(event) => setFilter({ genre: event.target.value })}
            >
              <option value="all">All genres</option>
              {genres.map((genre) => (
                <option key={genre} value={genre}>
                  {genre}
                </option>
              ))}
            </select>
            <select
              className="rounded-full border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant"
              value={filters.sort}
              onChange={(event) => setFilter({ sort: event.target.value as BookFilter["sort"] })}
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex-1 min-h-[480px]">
          {loading ? (
            <div className="flex h-full items-center justify-center text-on-surface-variant">
              Loading your library...
            </div>
          ) : filteredBooks.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 rounded-3xl border border-outline-variant/20 bg-surface-container-low p-8 text-center text-on-surface-variant">
              <p className="text-lg font-semibold text-on-surface">No books yet</p>
              <p className="max-w-md text-sm">
                Import EPUB or PDF files to populate your library. Metadata will auto-fill and sync with
                Drive.
              </p>
              <button
                className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary"
                type="button"
                onClick={handleImport}
              >
                Import your first book
              </button>
            </div>
          ) : filters.view === "grid" ? (
            <BookGrid books={filteredBooks} onRefresh={refreshMetadata} onOpen={onOpenBook} />
          ) : (
            <BookList books={filteredBooks} onRefresh={refreshMetadata} onOpen={onOpenBook} />
          )}
        </div>
      </section>
    </div>
  );
};
