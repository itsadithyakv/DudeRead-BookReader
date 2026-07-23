export type Platform = "mobile" | "desktop";

export const isMobilePlatform = () => {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /Android|iPhone|iPad|iPod/.test(navigator.userAgent);
};

export const getPlatform = (): Platform => (isMobilePlatform() ? "mobile" : "desktop");

export async function pickBookFiles(): Promise<string[]> {
  if (getPlatform() === "mobile") {
    const module = await import("./mobile/file");
    return module.pickBookFiles();
  }
  const module = await import("./desktop/file");
  return module.pickBookFiles();
}

export async function ensureBookPermissions(): Promise<boolean> {
  if (getPlatform() === "mobile") {
    const module = await import("./mobile/permissions");
    return module.ensureBookPermissions();
  }
  const module = await import("./desktop/permissions");
  return module.ensureBookPermissions();
}

export async function getLibraryPath(): Promise<string> {
  if (getPlatform() === "mobile") {
    const module = await import("./mobile/storage");
    return module.getMobileLibraryDir();
  }
  const module = await import("./desktop/storage");
  return module.getAppStorageDir();
}
