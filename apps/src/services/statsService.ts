import { invoke, isTauri } from "@tauri-apps/api/core";

export type ReadingStats = {
  streakDays: number;
  totalDays: number;
  lastReadAt: string | null;
  daysLast7: number;
};

export const statsService = {
  async getReadingStats(): Promise<ReadingStats> {
    if (!isTauri()) {
      return {
        streakDays: 0,
        totalDays: 0,
        lastReadAt: null,
        daysLast7: 0
      };
    }
    return invoke<ReadingStats>("reading_stats");
  }
};
