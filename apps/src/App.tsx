import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar } from "./components/Sidebar";
import { AccountBadge } from "./components/AccountBadge";
import { AccountPanel } from "./components/AccountPanel";
import { LoginModal } from "./components/LoginModal";
import { UiIcon } from "./components/UiIcon";
import { LibraryPage } from "./pages/LibraryPage";
import { CollectionsPage } from "./pages/CollectionsPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useLibraryStore } from "./store/libraryStore";
import { useAccountStore } from "./store/accountStore";
import { useHabitStore } from "./store/habitStore";
import { useAppearanceStore, watchSystemTheme } from "./store/appearanceStore";
import { bookService } from "./services/bookService";
import { converterService } from "./services/converterService";
import { getPlatform } from "./platform";
import Logo from "./assets/logoLeaflet500x500.png";
import type { Book } from "@shared/models/book";

type Tab = "library" | "collections" | "analytics" | "settings";

const ReaderView = lazy(() =>
  import("./pages/ReaderView").then((module) => ({ default: module.ReaderView }))
);

const tabLabels: Record<Tab, string> = {
  library: "Library",
  collections: "Collections",
  analytics: "Analytics",
  settings: "Settings"
};

const App = () => {
  const {
    books,
    filters,
    syncStatus,
    driveConnected,
    metadataRefreshing,
    metadataTotal,
    metadataDone,
    loadBooks,
    loadStats,
    loadDriveStatus,
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
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [converterPromptBook, setConverterPromptBook] = useState<Book | null>(null);
  const [converterBusy, setConverterBusy] = useState(false);

  const {
    loggedIn,
    email,
    premium,
    lastSyncedAt,
    syncState,
    load: loadAccount,
    signIn,
    signOut,
    upgradePremium,
    restorePremium,
    setLastSyncedAt,
    setSyncState,
    tier
  } = useAccountStore();

  const { activeSession, focusSettings, goal, startSession, stopSession, clearSessionShelf } =
    useHabitStore();
  const fullscreenLockRef = useRef(false);
  const theme = useAppearanceStore((state) => state.theme);
  const toggleTheme = useAppearanceStore((state) => state.toggleTheme);

  const platform = getPlatform();

  useEffect(() => {
    loadBooks();
    loadStats();
    loadDriveStatus();
    loadAccount();
  }, [loadBooks, loadStats, loadDriveStatus, loadAccount]);

  useEffect(() => watchSystemTheme(), []);

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

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 2600);
  }, []);

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

  const openPreparedBook = (book: Book) => {
    setSelected(book);
    if (focusSettings.goalBinding && !activeSession) {
      const duration = goal.mode === "minutes" && goal.target > 0 ? goal.target : 20;
      startSession({
        startedAt: new Date().toISOString(),
        durationMinutes: duration,
        bookId: book.id,
        title: book.title
      });
    }
    openBook(book).catch((error) => {
      showToast(resolveErrorMessage(error, "Unable to update reading progress."));
    });
  };

  const handleOpenBook = (book: Book) => {
    const extension = book.localPath.split(".").pop()?.toLowerCase() ?? "";
    if (extension !== "azw3" && extension !== "mobi") {
      openPreparedBook(book);
      return;
    }

    converterService
      .status()
      .then((installed) => {
        if (installed) {
          openPreparedBook(book);
        } else {
          setConverterPromptBook(book);
        }
      })
      .catch(() => {
        setConverterPromptBook(book);
      });
  };

  const handleConverterDownload = () => {
    if (!converterPromptBook || converterBusy) {
      return;
    }
    const book = converterPromptBook;
    setConverterBusy(true);
    converterService
      .install()
      .then(() => {
        setConverterPromptBook(null);
        showToast("Book converter ready.");
        openPreparedBook(book);
      })
      .catch((error) => {
        showToast(resolveErrorMessage(error, "Converter download failed. Check your connection and retry."));
      })
      .finally(() => {
        setConverterBusy(false);
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

  useEffect(() => {
    if (!loggedIn || !driveConnected) {
      setSyncState("offline");
      return;
    }
    if (syncStatus === "syncing") {
      setSyncState("pending");
    } else if (syncStatus === "success") {
      setSyncState("synced");
    } else if (syncStatus === "error") {
      setSyncState("error");
    }
  }, [syncStatus, driveConnected, loggedIn, setSyncState]);

  useEffect(() => {
    if (!focusSettings.kioskMode) {
      fullscreenLockRef.current = false;
      return;
    }

    if (activeSession) {
      fullscreenLockRef.current = true;
      if (isTauri()) {
        getCurrentWindow().setFullscreen(true).catch(() => {
          // ignore fullscreen errors
        });
      } else if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {
          // ignore
        });
      }
      return;
    }

    if (!fullscreenLockRef.current) {
      return;
    }
    fullscreenLockRef.current = false;
    if (isTauri()) {
      getCurrentWindow().setFullscreen(false).catch(() => {
        // ignore
      });
    } else if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {
        // ignore
      });
    }
  }, [activeSession, focusSettings.kioskMode]);

  useEffect(() => {
    if (!focusSettings.kioskMode) {
      return;
    }
    if (!isTauri()) {
      const onFullscreenChange = () => {
        if (activeSession && fullscreenLockRef.current && !document.fullscreenElement) {
          fullscreenLockRef.current = false;
          const confirmed = window.confirm(
            "Exiting fullscreen will clear your sessions bookshelf progress. Continue?"
          );
          if (!confirmed) {
            fullscreenLockRef.current = true;
            document.documentElement.requestFullscreen().catch(() => {
              // ignore
            });
            return;
          }
          stopSession({ reason: "manual_end", cleanSession: false });
          clearSessionShelf();
          showToast("Focus paused");
        }
      };
      document.addEventListener("fullscreenchange", onFullscreenChange);
      return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
    }
    const windowHandle = getCurrentWindow();
    const onResize = () => {
      if (!activeSession || !fullscreenLockRef.current) {
        return;
      }
      windowHandle
        .isFullscreen()
        .then((isFullscreen) => {
          if (!isFullscreen) {
            fullscreenLockRef.current = false;
            const confirmed = window.confirm(
              "Exiting fullscreen will clear your sessions bookshelf progress. Continue?"
            );
            if (!confirmed) {
              fullscreenLockRef.current = true;
              windowHandle.setFullscreen(true).catch(() => {
                // ignore
              });
              return;
            }
            stopSession({ reason: "manual_end", cleanSession: false });
            clearSessionShelf();
            showToast("Focus paused");
          }
        })
        .catch(() => {
          // ignore
        });
    };
    const unlistenPromise = windowHandle.onResized(onResize);
    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {
        // ignore
      });
    };
  }, [activeSession, focusSettings.kioskMode, stopSession]);

  const handleSync = () => {
    setSyncState("pending");
    (driveConnected ? syncNow() : startDriveAuth())
      .then(() => {
        setLastSyncedAt(new Date().toISOString());
        setSyncState("synced");
      })
      .catch((error) => {
        setSyncState("error");
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
    nowReading?.coverUrl && nowReading.coverUrl.startsWith("http") ? nowReading.coverUrl : null;
  const nowBookmarked = nowReading ? bookmarks.includes(nowReading.id) : false;

  useEffect(() => {
    setNowReadingFallback(null);
  }, [nowReading?.id, nowReading?.coverUrl]);

  useEffect(() => {
    if (!isTauri() || !nowReading?.coverUrl || nowReading.coverUrl.startsWith("http")) {
      return;
    }
    void bookService.coverData(nowReading.id).then((data) => {
      if (data) {
        setNowReadingFallback(data);
      }
    });
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
  const accountTier = tier();
  const badgeAnimateRef = useRef<string | null>(null);
  const [badgeAnimate, setBadgeAnimate] = useState(false);

  useEffect(() => {
    if (badgeAnimateRef.current === accountTier) {
      return;
    }
    badgeAnimateRef.current = accountTier;
    setBadgeAnimate(true);
    const timer = window.setTimeout(() => setBadgeAnimate(false), 320);
    return () => window.clearTimeout(timer);
  }, [accountTier]);

  return (
    <div className="app-shell min-h-screen font-body text-on-surface selection:bg-primary-container selection:text-on-primary-container">
      <header className="paper-toolbar sticky top-0 z-50 flex w-full items-center justify-between border-x-0 border-t-0 px-4 py-3 md:px-7">
        <div className="flex items-center gap-3">
          <img src={Logo} alt="Leaflet Logo" className="h-10 w-10 object-contain" />
          <span className="leaflet-wordmark text-3xl">
            Leaflet
          </span>
        </div>
        <div className="hidden flex-1 px-6 md:block">
          <div className="relative mx-auto max-w-xl">
            <UiIcon
              name="search"
              size={19}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant"
            />
            <input
              className="inset-field w-full py-2.5 pl-12 pr-4 text-sm text-on-surface focus:border-primary/50 focus:outline-none"
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
            className="tactile-button hidden items-center gap-2 px-3 py-2 text-xs xl:flex"
            onClick={handleDriveConnect}
          >
            <UiIcon name="cloud" size={17} />
            {driveConnected ? "Drive Connected" : "Connect Drive"}
          </button>
          <button
            type="button"
            className="tactile-button hidden items-center gap-2 px-3 py-2 text-xs xl:flex"
            onClick={handleSync}
          >
            <UiIcon name="sync" size={17} />
            {syncStatus === "syncing" ? "Syncing" : "Sync Now"}
          </button>
          <button
            type="button"
            className="key-button"
            onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            <UiIcon name={theme === "dark" ? "sun" : "moon"} size={19} />
          </button>
          <div className="relative">
            <AccountBadge
              tier={accountTier}
              syncState={loggedIn ? (driveConnected ? syncState : "offline") : "offline"}
              onClick={() => setAccountPanelOpen((prev) => !prev)}
              animate={badgeAnimate}
            />
            <AccountPanel
              open={accountPanelOpen}
              tier={accountTier}
              syncState={loggedIn ? (driveConnected ? syncState : "offline") : "offline"}
              email={email}
              lastSyncedAt={lastSyncedAt}
              onSignIn={() => setLoginModalOpen(true)}
              onSignOut={() => {
                signOut();
                setAccountPanelOpen(false);
              }}
              onUpgrade={() => {
                upgradePremium();
                showToast("Premium unlocked — thank you for supporting Leaflet.");
              }}
              onRestore={() => {
                restorePremium();
                showToast("Premium restored.");
              }}
              onSyncNow={handleSync}
            />
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-72px)] overflow-hidden">
        <div className="sidebar-stage relative hidden h-full w-[78px] shrink-0 md:block">
          <Sidebar
            activeItem={tabLabels[activeTab]}
            onNavigate={handleSidebarNavigate}
            onStartReading={() => nowReading && handleOpenBook(nowReading)}
            startDisabled={!nowReading}
          />
        </div>
        <main className="min-w-0 flex-1 overflow-y-auto bg-transparent px-4 py-8 pb-28 md:px-8">
          {activeTab === "library" && (
            <LibraryPage onOpenBook={handleOpenBook} onNavigate={setActiveTab} showToast={showToast} />
          )}
          {activeTab === "collections" && (
            <CollectionsPage onNavigate={setActiveTab} showToast={showToast} />
          )}
          {activeTab === "analytics" && <AnalyticsPage />}
          {activeTab === "settings" && <SettingsPage showToast={showToast} />}
        </main>
      </div>

      {nowReading && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 hidden w-full max-w-2xl -translate-x-1/2 px-4 md:block">
          <div className="now-reading-bar pointer-events-auto flex items-center gap-4 p-3">
            <div className="book-cover-frame h-12 w-10 overflow-hidden">
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
                className="key-button"
                type="button"
                onClick={() => nowReading && toggleBookmark(nowReading.id, nowReading.title)}
                aria-label={nowBookmarked ? "Remove bookmark" : "Bookmark book"}
              >
                <UiIcon name="bookmark" size={18} fill={nowBookmarked ? "currentColor" : "none"} />
              </button>
              <button
                className="key-button tactile-button-primary"
                type="button"
                onClick={() => handleOpenBook(nowReading)}
              >
                <UiIcon name="play" size={18} fill="currentColor" />
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="paper-surface fixed bottom-8 right-8 z-50 rounded-lg px-4 py-3 text-sm text-on-surface">
          {toast}
        </div>
      )}

      {metadataRefreshing && books.length >= 60 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="modal-surface flex flex-col items-center gap-3 rounded-xl px-6 py-4 text-sm text-on-surface">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <div className="text-center">
              <p className="text-sm font-semibold text-on-surface">Refreshing library metadata</p>
              <p className="text-xs text-on-surface-variant">
                {metadataDone}/{metadataTotal} books
              </p>
            </div>
          </div>
        </div>
      )}

      {converterPromptBook && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 px-6">
          <div
            className="modal-surface w-full max-w-md p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="converter-dialog-title"
          >
            <div className="flex items-start gap-4">
              <div className="paper-surface-raised flex h-12 w-12 shrink-0 items-center justify-center text-primary">
                <UiIcon name="book-open" size={23} />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
                  Optional download
                </p>
                <h2 id="converter-dialog-title" className="page-title mt-1 text-2xl">
                  Open Kindle-format books
                </h2>
              </div>
            </div>
            <p className="mt-5 text-sm leading-6 text-on-surface-variant">
              “{converterPromptBook.title}” needs the Calibre conversion tools. Downloading them
              uses about 200 MB plus installation space. Leaflet will keep the installer out of
              the app package and remove the downloaded installer after setup.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className="tactile-button px-4 py-2 text-sm"
                onClick={() => setConverterPromptBook(null)}
                disabled={converterBusy}
              >
                Not now
              </button>
              <button
                type="button"
                className="tactile-button tactile-button-primary min-w-36 px-4 py-2 text-sm font-bold"
                onClick={handleConverterDownload}
                disabled={converterBusy}
              >
                {converterBusy ? "Downloading…" : "Download & install"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90">
              <div className="paper-surface flex items-center gap-3 rounded-xl px-5 py-4 text-sm">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                Opening book…
              </div>
            </div>
          }
        >
          <ReaderView book={selected} onClose={() => setSelected(null)} />
        </Suspense>
      )}

      <LoginModal
        open={loginModalOpen}
        onClose={() => setLoginModalOpen(false)}
        onLogin={(value) => {
          signIn(value);
          setSyncState("pending");
          setLoginModalOpen(false);
          setAccountPanelOpen(false);
          showToast("Your reading is now synced.");
          handleSync();
        }}
        onContinueOffline={() => {
          setLoginModalOpen(false);
          setAccountPanelOpen(false);
        }}
      />
    </div>
  );
};

export default App;
