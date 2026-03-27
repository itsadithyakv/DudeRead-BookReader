import { invoke } from "@tauri-apps/api/core";

export const driveSyncService = {
  async startAuth(): Promise<void> {
    const url = await invoke<string>("drive_auth_start");
    window.open(url, "_blank");
  },
  async waitForAuth(): Promise<void> {
    await invoke("drive_auth_wait");
  },
  async syncNow(): Promise<void> {
    await invoke("drive_sync");
  }
};
