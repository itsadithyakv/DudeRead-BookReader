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

const systemThemeQuery = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

const readSystemTheme = (): ThemeMode => (systemThemeQuery()?.matches === false ? "light" : "dark");

const applyTheme = (theme: ThemeMode) => {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#141311" : "#e8dfcb");
};

const savedTheme = readPreference();
const initialTheme = savedTheme ?? readSystemTheme();
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
    const theme = readSystemTheme();
    applyTheme(theme);
    set({ theme, hasUserPreference: false });
  }
}));

export const watchSystemTheme = () => {
  const query = systemThemeQuery();
  if (!query) {
    return () => undefined;
  }
  const onChange = () => {
    if (useAppearanceStore.getState().hasUserPreference) {
      return;
    }
    const theme = readSystemTheme();
    applyTheme(theme);
    useAppearanceStore.setState({ theme });
  };
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
