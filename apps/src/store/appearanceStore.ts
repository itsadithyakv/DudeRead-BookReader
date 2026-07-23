import { create } from "zustand";

export type ThemeMode = "light" | "dark";

type AppearanceState = {
  theme: ThemeMode;
  hasUserPreference: boolean;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  resetTheme: () => void;
};

const STORAGE_KEY = "leaflet.appearance.v1";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const systemTheme = (): ThemeMode =>
  typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches ? "dark" : "light";

const readPreference = (): ThemeMode | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { theme?: unknown };
    return parsed.theme === "light" || parsed.theme === "dark" ? parsed.theme : null;
  } catch {
    return null;
  }
};

const applyTheme = (theme: ThemeMode) => {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#141311" : "#e8dfcb");
};

const savedTheme = readPreference();
const initialTheme = savedTheme ?? systemTheme();
applyTheme(initialTheme);

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  theme: initialTheme,
  hasUserPreference: savedTheme !== null,
  setTheme(theme) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme }));
    applyTheme(theme);
    set({ theme, hasUserPreference: true });
  },
  toggleTheme() {
    get().setTheme(get().theme === "dark" ? "light" : "dark");
  },
  resetTheme() {
    localStorage.removeItem(STORAGE_KEY);
    const theme = systemTheme();
    applyTheme(theme);
    set({ theme, hasUserPreference: false });
  }
}));

export const watchSystemTheme = () => {
  if (typeof window === "undefined") return () => undefined;
  const media = window.matchMedia(DARK_QUERY);
  const onChange = (event: MediaQueryListEvent) => {
    if (useAppearanceStore.getState().hasUserPreference) return;
    const theme: ThemeMode = event.matches ? "dark" : "light";
    applyTheme(theme);
    useAppearanceStore.setState({ theme });
  };
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
