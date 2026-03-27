import { create } from "zustand";
import type { Book, BookFilter } from "@shared/models/book";
import type { DriveSyncStatus } from "@shared/sync/types";
import { bookService } from "../services/bookService";
import { driveSyncService } from "../services/driveSyncService";

const defaultFilters: BookFilter = {
  query: "",
  author: "all",
  genre: "all",
  sort: "recent",
  view: "grid"
};

type LibraryState = {
  books: Book[];
  filters: BookFilter;
  loading: boolean;
  syncStatus: DriveSyncStatus;
  loadBooks: () => Promise<void>;
  importBooks: () => Promise<void>;
  importPaths: (paths: string[]) => Promise<void>;
  refreshMetadata: (id: string) => Promise<void>;
  setFilter: (partial: Partial<BookFilter>) => void;
  startDriveAuth: () => Promise<void>;
  syncNow: () => Promise<void>;
};

let syncTimer: ReturnType<typeof setTimeout> | null = null;

export const useLibraryStore = create<LibraryState>((set, get) => ({
  books: [],
  filters: defaultFilters,
  loading: false,
  syncStatus: "idle",
  async loadBooks() {
    set({ loading: true });
    const books = await bookService.list();
    set({ books, loading: false });
  },
  async importBooks() {
    const imported = await bookService.importFromDialog();
    if (imported.length === 0) {
      return;
    }
    const books = [...get().books, ...imported];
    set({ books });
    scheduleSync(set);
  },
  async importPaths(paths) {
    const imported = await bookService.importPaths(paths);
    if (imported.length === 0) {
      return;
    }
    const books = [...get().books, ...imported];
    set({ books });
    scheduleSync(set);
  },
  async refreshMetadata(id: string) {
    const updated = await bookService.refreshMetadata(id);
    set({
      books: get().books.map((book) => (book.id === updated.id ? updated : book))
    });
    scheduleSync(set);
  },
  setFilter(partial) {
    set({ filters: { ...get().filters, ...partial } });
  },
  async startDriveAuth() {
    await driveSyncService.startAuth();
    await driveSyncService.waitForAuth();
  },
  async syncNow() {
    set({ syncStatus: "syncing" });
    try {
      await driveSyncService.syncNow();
      set({ syncStatus: "success" });
    } catch {
      set({ syncStatus: "error" });
    }
  }
}));

function scheduleSync(set: (state: Partial<LibraryState>) => void) {
  if (syncTimer) {
    clearTimeout(syncTimer);
  }
  syncTimer = setTimeout(async () => {
    set({ syncStatus: "syncing" });
    try {
      await driveSyncService.syncNow();
      set({ syncStatus: "success" });
    } catch {
      set({ syncStatus: "error" });
    }
  }, 1500);
}
