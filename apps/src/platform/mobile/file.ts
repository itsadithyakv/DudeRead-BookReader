import { invoke } from "@tauri-apps/api/core";

export async function pickBookFiles(): Promise<string[]> {
  const files = await invoke<string[]>("pick_books");
  return files || [];
}

export async function copyToAppSandbox(filePath: string): Promise<string> {
  // Rust backend handles copying to final app sandbox path. Keep selected file path for import.
  return filePath;
}
