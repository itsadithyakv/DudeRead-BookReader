import { appDataDir } from "@tauri-apps/api/path";
import * as path from "path-browserify";

export async function getAppStorageDir(): Promise<string> {
  const base = await appDataDir();
  return path.join(base, "books");
}

export async function copyToAppStorage(filePath: string): Promise<string> {
  // The Rust import_books command handles storing and hashing, so we pass through.
  return filePath;
}
