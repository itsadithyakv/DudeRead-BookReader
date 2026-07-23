import { invoke, isTauri } from "@tauri-apps/api/core";

export const driveSyncService = {
  async startAuth(): Promise<void> {
    if (!isTauri()) {
      throw new Error("Drive sync requires the desktop app. Run `tauri dev` to enable it.");
    }
    const url = await invoke<string>("drive_auth_start");
    window.open(url, "_blank");
  },
  async status(): Promise<{ connected: boolean; expiresAt?: string | null }> {
    if (!isTauri()) {
      return { connected: false, expiresAt: null };
    }
    return invoke<{ connected: boolean; expiresAt?: string | null }>("drive_status");
  },
  async waitForAuth(): Promise<void> {
    if (!isTauri()) {
      return;
    }
    await invoke("drive_auth_wait");
  },
  async syncNow(): Promise<void> {
    if (!isTauri()) {
      throw new Error("Drive sync requires the desktop app. Run `tauri dev` to enable it.");
    }
    await invoke("drive_sync");
  }
};
