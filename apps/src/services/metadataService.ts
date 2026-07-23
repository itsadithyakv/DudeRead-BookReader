import { invoke } from "@tauri-apps/api/core";
import type { Book } from "@shared/models/book";

export const metadataService = {
  async refresh(bookId: string): Promise<Book> {
    return invoke<Book>("refresh_metadata", { bookId });
  }
};
