import { open } from "@tauri-apps/plugin-dialog";

export async function pickBookFiles(): Promise<string[]> {
  const selected = await open({
    multiple: true,
    filters: [
      { name: "Books", extensions: ["epub", "pdf"] }
    ]
  });

  if (!selected) {
    return [];
  }

  if (Array.isArray(selected)) {
    return selected.map((item) => item.toString());
  }

  return [selected.toString()];
}
