import { invoke } from "@tauri-apps/api/core";
import type { Book } from "@shared/models/book";
import { ensureBookPermissions, pickBookFiles } from "../platform";

export const bookService = {
  async list(): Promise<Book[]> {
    return invoke<Book[]>("list_books");
  },
  async importFromDialog(): Promise<Book[]> {
    const ok = await ensureBookPermissions();
    if (!ok) {
      throw new Error("Storage permission denied");
    }

    const paths = await pickBookFiles();
    if (!paths || paths.length === 0) {
      return [];
    }

    return invoke<Book[]>("import_books", { paths });
  },
  async importPaths(paths: string[]): Promise<Book[]> {
    if (paths.length === 0) {
      return [];
    }
    const ok = await ensureBookPermissions();
    if (!ok) {
      throw new Error("Storage permission denied");
    }
    return invoke<Book[]>("import_books", { paths });
  },
  async refreshMetadata(bookId: string): Promise<Book> {
    return invoke<Book>("refresh_metadata", { bookId });
  },
  async updateProgress(bookId: string, progress: number): Promise<void> {
    return invoke("update_progress", {
      bookId,
      progress,
      lastOpened: new Date().toISOString()
    });
  }
};
