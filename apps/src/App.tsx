import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { Sidebar } from "./components/Sidebar";
import { LibraryPage } from "./pages/LibraryPage";
import { CollectionsPage } from "./pages/CollectionsPage";
import { StreakPage } from "./pages/StreakPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ReaderView } from "./pages/ReaderView";
import { useLibraryStore } from "./store/libraryStore";
import { bookService } from "./services/bookService";
import { getPlatform } from "./platform";
import Logo from "./assets/DudeReadlogoNobg.png";
import type { Book } from "@shared/models/book";

type Tab = "library" | "collections" | "streak" | "settings";

const tabLabels: Record<Tab, string> = {
  library: "Library",
  collections: "Collections",
  streak: "Streak",
  settings: "Settings"
};

const App = () => {
  const {
    books,
    filters,
    syncStatus,
    driveConnected,
    loadBooks,
    loadStats,
    loadDriveStatus,
    importPaths,
    openBook,
    startDriveAuth,
    syncNow,
    setFilter
  } = useLibraryStore();

  const [activeTab, setActiveTab] = useState<Tab>("library");
  const [selected, setSelected] = useState<Book | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [bookmarks, setBookmarks] = useState<string[]>([]);

  const platform = getPlatform();

  useEffect(() => {
    loadBooks();
    loadStats();
    loadDriveStatus();
  }, [loadBooks, loadStats, loadDriveStatus]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    let unlisten: (() => void) | undefined;
    listen<string[]>("tauri://file-drop", (event) => {
      if (Array.isArray(event.payload)) {
        importPaths(event.payload).catch((error) => {
          showToast(resolveErrorMessage(error, "Import failed. Try again."));
        });
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [importPaths]);

  useEffect(() => {
    if (platform === "mobile" && driveConnected) {
      syncNow().catch(() => {
        // startup sync failure is fine; user can retry manually
      });
    }
  }, [platform, driveConnected, syncNow]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 2600);
  };

  const resolveErrorMessage = (error: unknown, fallback: string) => {
    if (typeof error === "string" && error.trim().length > 0) {
      return error;
    }
    if (error && typeof error === "object") {
      const maybeMessage = (error as { message?: unknown }).message;
      if (typeof maybeMessage === "string" && maybeMessage.trim().length > 0) {
        return maybeMessage;
      }
      if (typeof (error as { toString?: () => string }).toString === "function") {
        const text = (error as { toString: () => string }).toString();
        if (text && text !== "[object Object]") {
          return text;
        }
      }
    }
    return fallback;
  };

  const handleOpenBook = (book: Book) => {
    setSelected(book);
    openBook(book).catch((error) => {
      showToast(resolveErrorMessage(error, "Unable to update reading progress."));
    });
  };

  const toggleBookmark = (bookId: string, title: string) => {
    setBookmarks((prev) => {
      if (prev.includes(bookId)) {
        showToast(`Removed ${title} from bookmarks.`);
        return prev.filter((id) => id !== bookId);
      }
      showToast(`Bookmarked ${title}.`);
      return [...prev, bookId];
    });
  };

  const handleSidebarNavigate = (label: string) => {
    const entry = Object.entries(tabLabels).find(([, value]) => value === label);
    if (entry) {
      setActiveTab(entry[0] as Tab);
    }
  };

  const handleSearchChange = (value: string) => {
    setFilter({ query: value });
    if (value.trim().length > 0 && activeTab !== "library") {
      setActiveTab("library");
    }
  };

  const handleDriveConnect = () => {
    startDriveAuth().catch((error) => {
      showToast(resolveErrorMessage(error, "Drive connection failed. Please retry."));
    });
  };

  const handleSync = () => {
    (driveConnected ? syncNow() : startDriveAuth()).catch((error) => {
      showToast(resolveErrorMessage(error, "Sync failed. Check Drive status."));
    });
  };

  const lastOpenedBook = useMemo(() => {
    if (books.length === 0) {
      return null;
    }
    return [...books].sort((a, b) => {
      const aTime = Date.parse(a.lastOpened ?? a.createdAt);
      const bTime = Date.parse(b.lastOpened ?? b.createdAt);
      return bTime - aTime;
    })[0];
  }, [books]);
  const nowReading = lastOpenedBook ?? books[0] ?? null;
  const [nowReadingFallback, setNowReadingFallback] = useState<string | null>(null);
  const nowReadingCover =
    nowReading?.coverUrl && isTauri() ? convertFileSrc(nowReading.coverUrl) : null;
  const nowBookmarked = nowReading ? bookmarks.includes(nowReading.id) : false;

  useEffect(() => {
    setNowReadingFallback(null);
  }, [nowReading?.id, nowReading?.coverUrl]);

  const handleNowReadingError = () => {
    if (!nowReading) {
      return;
    }
    void bookService.coverData(nowReading.id).then((data) => {
      if (data) {
        setNowReadingFallback(data);
      }
    });
  };

  const resolvedNowReadingCover = nowReadingFallback ?? nowReadingCover;

  return (
    <div className="min-h-screen bg-background font-body text-on-surface selection:bg-primary-container selection:text-on-primary-container">
      <header className="sticky top-0 z-50 flex w-full items-center justify-between border-b border-white/5 bg-background/80 px-4 py-4 shadow-[0_4px_30px_rgba(142,68,173,0.06)] backdrop-blur-xl md:px-8">
        <div className="flex items-center gap-3">
          <img src={Logo} alt="DudeReads Logo" className="h-8 w-auto" />
          <span className="text-2xl font-headline font-bold tracking-tight text-primary">DudeReads</span>
        </div>
        <div className="hidden flex-1 px-6 md:block">
          <div className="relative mx-auto max-w-xl">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant">
              search
            </span>
            <input
              className="w-full rounded-full border border-outline-variant/30 bg-surface-container-lowest py-2.5 pl-12 pr-4 text-sm text-on-surface focus:border-primary/40 focus:outline-none"
              placeholder="Search your archive..."
              type="text"
              value={filters.query}
              onChange={(event) => handleSearchChange(event.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-4">
          <button
            type="button"
            className="hidden items-center gap-2 rounded-full border border-outline-variant/30 px-3 py-2 text-xs text-on-surface-variant transition hover:text-primary md:flex"
            onClick={handleDriveConnect}
          >
            <span className="material-symbols-outlined text-base">cloud</span>
            {driveConnected ? "Drive Connected" : "Connect Drive"}
          </button>
          <button
            type="button"
            className="hidden items-center gap-2 rounded-full border border-outline-variant/30 px-3 py-2 text-xs text-on-surface-variant transition hover:text-primary md:flex"
            onClick={handleSync}
          >
            <span className="material-symbols-outlined text-base">sync</span>
            {syncStatus === "syncing" ? "Syncing" : "Sync Now"}
          </button>
          <button
            className="material-symbols-outlined text-on-surface transition-colors hover:text-primary"
            type="button"
            onClick={() => setActiveTab("settings")}
          >
            person
          </button>
          <div className="h-10 w-10 overflow-hidden rounded-full border border-primary/20 bg-surface-container-high">
            <div className="flex h-full w-full items-center justify-center bg-primary/20 text-xs font-semibold text-on-surface">
              DR
            </div>
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-72px)] overflow-hidden">
        <Sidebar
          activeItem={tabLabels[activeTab]}
          onNavigate={handleSidebarNavigate}
          onStartReading={() => nowReading && handleOpenBook(nowReading)}
          startDisabled={!nowReading}
        />
        <main className="flex-1 overflow-y-auto bg-surface px-4 py-8 pb-28 md:px-8">
          {activeTab === "library" && (
            <LibraryPage onOpenBook={handleOpenBook} onNavigate={setActiveTab} showToast={showToast} />
          )}
          {activeTab === "collections" && (
            <CollectionsPage onNavigate={setActiveTab} showToast={showToast} />
          )}
          {activeTab === "streak" && <StreakPage onNavigate={setActiveTab} />}
          {activeTab === "settings" && <SettingsPage showToast={showToast} />}
        </main>
      </div>

      {nowReading && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 hidden w-full max-w-2xl -translate-x-1/2 px-4 md:block">
          <div className="glass-panel pointer-events-auto flex items-center gap-4 rounded-2xl border border-outline-variant/20 p-3 shadow-2xl">
            <div className="h-12 w-12 overflow-hidden rounded-lg border border-white/10 shadow-lg">
              {resolvedNowReadingCover ? (
                <img
                  src={resolvedNowReadingCover}
                  alt="Now reading"
                  className="h-full w-full object-cover"
                  onError={handleNowReadingError}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-surface-container-high text-[10px] text-on-surface-variant">
                  Cover
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                Currently Reading
              </p>
              <h5 className="truncate text-sm font-headline font-bold">{nowReading.title}</h5>
            </div>
            <div className="flex items-center gap-4 pr-2">
              <button
                className="text-on-surface-variant transition-colors hover:text-on-surface"
                type="button"
                onClick={() => nowReading && toggleBookmark(nowReading.id, nowReading.title)}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontVariationSettings: nowBookmarked ? "'FILL' 1" : "'FILL' 0" }}
                >
                  bookmark
                </span>
              </button>
              <button
                className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg shadow-primary/20 transition hover:scale-110 active:scale-95"
                type="button"
                onClick={() => handleOpenBook(nowReading)}
              >
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                  play_arrow
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-8 right-8 z-50 rounded-2xl border border-outline-variant/30 bg-surface-container-high px-4 py-3 text-sm text-on-surface shadow-2xl">
          {toast}
        </div>
      )}

      {selected && <ReaderView book={selected} onClose={() => setSelected(null)} />}
    </div>
  );
};

export default App;
