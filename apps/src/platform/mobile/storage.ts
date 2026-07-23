import { appDataDir } from "@tauri-apps/api/path";
import * as path from "path-browserify";

export async function getMobileLibraryDir(): Promise<string> {
  const root = await appDataDir();
  return path.join(root, "books");
}

export async function listStoredBooks(): Promise<string[]> {
  // Implementation depends on low-level FS APIs not currently available in this bundle.
  return [];
}
