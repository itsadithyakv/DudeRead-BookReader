import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { Book } from "@shared/models/book";
import ePub from "epubjs";
import { bookService } from "../services/bookService";
import { useLibraryStore } from "../store/libraryStore";
import { getSessionProgress, useHabitStore } from "../store/habitStore";
import { converterService } from "../services/converterService";
import { useAppearanceStore, type ThemeMode } from "../store/appearanceStore";
import { useAccountStore } from "../store/accountStore";
import {
  estimateWordDifficulty,
  estimateRsvpPauseMultiplier,
  getAdaptiveWpm,
  getReadingTimeBand,
  loadSmartReadCalibration,
  loadSmartReadProfile,
  recordSmartReadSample,
  saveSmartReadProfile,
  type SmartReadCalibration,
  type SmartReadProfile
} from "../services/smartReadService";
import paperLightTexture from "../assets/paper-light.webp";
import paperDarkTexture from "../assets/paper-dark.webp";
import ztNatureBoldWoff2 from "../assets/fonts/ZTNature-Bold.woff2";
import {
  READABLE_EXTENSIONS,
  formatDisplayList,
  getBookExtension
} from "../constants/bookFormats";

type ReaderViewProps = {
  book: Book;
  onClose: () => void;
};

type TocItem = {
  id?: string;
  label: string;
  href: string;
  subitems?: TocItem[];
};

type ReaderDisplayMode = "paper" | "dark-paper" | "true-white" | "true-black" | "app";
type ReadingMode = "standard" | "smart" | "speed";

const getReaderFinish = (displayMode: ReaderDisplayMode, theme: ThemeMode) => {
  if (displayMode === "paper") {
    return {
      themeName: "leaflet-light",
      background: "#f0eadc",
      text: "#30291f",
      texture: paperLightTexture,
      textureOpacity: "e0"
    };
  }
  if (displayMode === "dark-paper") {
    return {
      themeName: "leaflet-dark",
      background: "#191b1a",
      text: "#eeeae0",
      texture: paperDarkTexture,
      textureOpacity: "d4"
    };
  }
  if (displayMode === "true-white") {
    return {
      themeName: "leaflet-light",
      background: "#f8f8f4",
      text: "#090a09",
      texture: null,
      textureOpacity: "ff"
    };
  }
  if (displayMode === "true-black") {
    return {
      themeName: "leaflet-dark",
      background: "#000000",
      text: "#f2f1eb",
      texture: null,
      textureOpacity: "ff"
    };
  }
  return theme === "light"
    ? {
        themeName: "leaflet-light",
        background: "#edeae2",
        text: "#16191e",
        texture: paperLightTexture,
        textureOpacity: "e8"
      }
    : {
        themeName: "leaflet-dark",
        background: "#202227",
        text: "#f7f9fc",
        texture: paperDarkTexture,
        textureOpacity: "e8"
      };
};

const getReaderFinishBackground = (finish: ReturnType<typeof getReaderFinish>) =>
  finish.texture
    ? `linear-gradient(${finish.background}${finish.textureOpacity}, ${finish.background}${finish.textureOpacity}), url("${finish.texture}")`
    : "none";

type ReaderWord = {
  text: string;
  trailing: string;
  node: Text;
  start: number;
  end: number;
  difficulty: number;
  rsvpPauseMultiplier: number;
  sentenceEnd: boolean;
  paragraphEnd: boolean;
  iframe: HTMLIFrameElement;
};

type ReadingWordState = {
  index: number;
  total: number;
  text: string;
  contextStart: number;
  context: Array<{ text: string; trailing: string; index: number }>;
};

type SmartSession = {
  startedAt: number;
  activeMs: number;
  lastTickAt: number;
  startIndex: number;
  furthestIndex: number;
  difficultyTotal: number;
  difficultySamples: number;
  rereads: number;
};

const flattenToc = (items: TocItem[]) => {
  const result: TocItem[] = [];
  const walk = (list: TocItem[]) => {
    list.forEach((item) => {
      result.push(item);
      if (item.subitems && item.subitems.length > 0) {
        walk(item.subitems);
      }
    });
  };
  walk(items);
  return result;
};

const normalizeLabel = (label: string) => label.toLowerCase().replace(/\s+/g, " ").trim();

const isFrontMatter = (label: string) => {
  const text = normalizeLabel(label);
  const blocked = [
    "title page",
    "copyright",
    "contents",
    "table of contents",
    "dedication",
    "acknowledgments",
    "acknowledgements",
    "foreword",
    "introduction",
    "preface",
    "glossary",
    "index",
    "about the author",
    "maps",
    "map"
  ];
  return blocked.some((entry) => text === entry || text.startsWith(`${entry} `));
};

const isChapterLike = (label: string) => {
  const text = normalizeLabel(label);
  if (isFrontMatter(text)) {
    return false;
  }
  if (/(chapter|book|section)\b/.test(text)) {
    return true;
  }
  if (/^(prologue|epilogue)\b/.test(text)) {
    return true;
  }
  if (/^[ivxlcdm]+\.?$/.test(text)) {
    return true;
  }
  return false;
};

export const ReaderView = ({ book, onClose }: ReaderViewProps) => {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<any>(null);
  const bookRef = useRef<ReturnType<typeof ePub> | null>(null);
  const relocateHandlerRef = useRef<((location: { start?: { percentage?: number } }) => void) | null>(null);
  const lastProgressRef = useRef(0);
  const lastProgressAtRef = useRef(0);
  const lastComputedProgressRef = useRef(-1);
  const lastMarkerRef = useRef<string | null>(null);
  const scrollAdvanceLockRef = useRef(false);
  const scrollAdvanceTimerRef = useRef<number | null>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const lastWheelDownAtRef = useRef(0);
  const lastScrollTopRef = useRef<number | null>(null);
  const autoScrollLastTimeRef = useRef<number | null>(null);
  const autoScrollCarryRef = useRef(0);
  const readerDotTimerRef = useRef<number | null>(null);
  const readerDotRetryTimerRef = useRef<number | null>(null);
  const wordIndexTimerRef = useRef<number | null>(null);
  const sidebarOpenTimerRef = useRef<number | null>(null);
  const sidebarCloseTimerRef = useRef<number | null>(null);
  const manualScrollTimerRef = useRef<number | null>(null);
  const readerDotDragFrameRef = useRef<number | null>(null);
  const readerDotOffscreenTimerRef = useRef<number | null>(null);
  const readerDotRetryRef = useRef<{ cfi: string; count: number }>({ cfi: "", count: 0 });
  const readerDotElementRef = useRef<HTMLElement | null>(null);
  const readerDotEnabledRef = useRef(true);
  const readingEngineTimerRef = useRef<number | null>(null);
  const readingModeRef = useRef<ReadingMode>("standard");
  const readingPausedRef = useRef(false);
  const speedReadWpmRef = useRef(260);
  const readerWordsRef = useRef<ReaderWord[]>([]);
  const activeWordIndexRef = useRef(0);
  const readerDotAnchorIndexRef = useRef<number | null>(null);
  const readerDotUserAnchorUntilRef = useRef(0);
  const requestedStartIndexRef = useRef<number | null>(null);
  const programmaticScrollUntilRef = useRef(0);
  const smartManualOverrideUntilRef = useRef(0);
  const smartPaceBiasRef = useRef(1);
  const smartAheadTimerRef = useRef<number | null>(null);
  const smartAheadTargetIndexRef = useRef<number | null>(null);
  const smartSessionRef = useRef<SmartSession | null>(null);
  const manualReadingRef = useRef<{ index: number; at: number } | null>(null);
  const activeSession = useHabitStore((state) => state.activeSession);
  const focusSettings = useHabitStore((state) => state.focusSettings);
  const stopSession = useHabitStore((state) => state.stopSession);
  const clearSessionShelf = useHabitStore((state) => state.clearSessionShelf);
  const extendSession = useHabitStore((state) => state.extendSession);
  const addSessionNote = useHabitStore((state) => state.addSessionNote);
  const [coffeeProgress, setCoffeeProgress] = useState(0);
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [checkpointLevel, setCheckpointLevel] = useState<0.5 | 0.9 | 1 | null>(null);
  const checkpointTimerRef = useRef<number | null>(null);
  const [focusToast, setFocusToast] = useState<string | null>(null);
  const focusToastTimerRef = useRef<number | null>(null);
  const checkpointRef = useRef(0);
  const sessionStartRef = useRef<string | null>(null);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteSessionId, setNoteSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeSession) {
      setCoffeeProgress(0);
      return undefined;
    }
    const timer = window.setInterval(() => {
      setCoffeeProgress(getSessionProgress(activeSession));
    }, 1200);
    return () => window.clearInterval(timer);
  }, [activeSession]);

  useEffect(() => {
    const startedAt = activeSession?.startedAt ?? null;
    if (sessionStartRef.current !== startedAt) {
      sessionStartRef.current = startedAt;
      checkpointRef.current = 0;
      setCheckpointOpen(false);
      setCheckpointLevel(null);
      if (checkpointTimerRef.current) {
        window.clearTimeout(checkpointTimerRef.current);
        checkpointTimerRef.current = null;
      }
    }
  }, [activeSession?.startedAt]);

  useEffect(() => {
    if (!activeSession || !focusSettings.checkpointPrompts) {
      if (checkpointTimerRef.current) {
        window.clearTimeout(checkpointTimerRef.current);
        checkpointTimerRef.current = null;
      }
      return;
    }
    const progress = getSessionProgress(activeSession);
    const nextCheckpoint =
      checkpointRef.current < 0.5 && progress >= 0.5
        ? 0.5
        : checkpointRef.current < 0.9 && progress >= 0.9
          ? 0.9
          : checkpointRef.current < 1 && progress >= 1
            ? 1
            : null;

    if (nextCheckpoint) {
      checkpointRef.current = nextCheckpoint;
      setCheckpointLevel(nextCheckpoint);
      setCheckpointOpen(true);
      if (checkpointTimerRef.current) {
        window.clearTimeout(checkpointTimerRef.current);
      }
      const timeout = nextCheckpoint === 1 ? 10000 : 8000;
      checkpointTimerRef.current = window.setTimeout(() => {
        setCheckpointOpen(false);
        if (nextCheckpoint === 1 && activeSession) {
          const progressNow = getSessionProgress(activeSession);
          if (progressNow >= 0.999) {
            handleStopSession({ reason: "completed", cleanSession: true });
          }
        }
        checkpointTimerRef.current = null;
      }, timeout);
    }
  }, [activeSession, focusSettings.checkpointPrompts, coffeeProgress]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }
    if (checkpointOpen && checkpointLevel === 1) {
      return;
    }
    const totalSeconds = activeSession.durationMinutes * 60;
    const elapsedSeconds = Math.max(0, Math.round((Date.now() - Date.parse(activeSession.startedAt)) / 1000));
    if (elapsedSeconds >= totalSeconds) {
      handleStopSession({ reason: "completed", cleanSession: true });
    }
  }, [activeSession, checkpointOpen, checkpointLevel, coffeeProgress]);

  const handleStopSession = (options?: { reason?: "completed" | "manual_end"; cleanSession?: boolean }) => {
    if (options?.reason === "manual_end") {
      const confirmed = window.confirm(
        "Ending focus now will clear your sessions bookshelf progress. Continue?"
      );
      if (!confirmed) {
        return;
      }
    }
    const sessionId = stopSession(options);
    if (options?.reason === "manual_end") {
      clearSessionShelf();
    }
    if (sessionId && focusSettings.sessionNotes) {
      setNoteSessionId(sessionId);
      setNoteText("");
      setNoteModalOpen(true);
    }
  };

  const handleCheckpointContinue = () => {
    if (checkpointLevel === 1) {
      extendSession(10);
      checkpointRef.current = 0.9;
    }
    if (checkpointTimerRef.current) {
      window.clearTimeout(checkpointTimerRef.current);
      checkpointTimerRef.current = null;
    }
    setCheckpointOpen(false);
  };

  const handleCheckpointEnd = () => {
    if (checkpointTimerRef.current) {
      window.clearTimeout(checkpointTimerRef.current);
      checkpointTimerRef.current = null;
    }
    setCheckpointOpen(false);
    handleStopSession({ reason: "completed", cleanSession: true });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "ArrowRight") {
        if (event.repeat) {
          return;
        }
        event.preventDefault();
        goNextSection();
        return;
      }
      if (event.key === "ArrowLeft") {
        if (event.repeat) {
          return;
        }
        event.preventDefault();
        goPrevSection();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const container = getScrollContainer();
        if (!container) {
          return;
        }
        if (event.key === "ArrowDown") {
          const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 2;
          if (atBottom) {
            goNextSection();
            event.preventDefault();
            return;
          }
        }
        const delta = Math.max(120, Math.round(container.clientHeight * 0.2));
        const direction = event.key === "ArrowDown" ? 1 : -1;
        smoothScrollBy(container, delta * direction);
        event.preventDefault();
      }
      if (event.code === "Space") {
        if ((event.target as HTMLElement | null)?.tagName === "INPUT") {
          return;
        }
        event.preventDefault();
        if (readingModeRef.current === "standard") {
          setAutoScrollActive((prev) => !prev);
        } else {
          setReadingPaused((prev) => !prev);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (scrollAdvanceTimerRef.current) {
        window.clearTimeout(scrollAdvanceTimerRef.current);
      }
      if (readingEngineTimerRef.current) {
        window.clearTimeout(readingEngineTimerRef.current);
      }
      if (wordIndexTimerRef.current) {
        window.clearTimeout(wordIndexTimerRef.current);
      }
      if (sidebarOpenTimerRef.current) {
        window.clearTimeout(sidebarOpenTimerRef.current);
      }
      if (sidebarCloseTimerRef.current) {
        window.clearTimeout(sidebarCloseTimerRef.current);
      }
      if (manualScrollTimerRef.current) {
        window.clearTimeout(manualScrollTimerRef.current);
      }
      if (readerDotDragFrameRef.current) {
        window.cancelAnimationFrame(readerDotDragFrameRef.current);
      }
      if (readerDotOffscreenTimerRef.current) {
        window.clearTimeout(readerDotOffscreenTimerRef.current);
      }
      if (smartAheadTimerRef.current) {
        window.clearTimeout(smartAheadTimerRef.current);
      }
      if (checkpointTimerRef.current) {
        window.clearTimeout(checkpointTimerRef.current);
      }
      if (focusToastTimerRef.current) {
        window.clearTimeout(focusToastTimerRef.current);
      }
      if (lastComputedProgressRef.current >= 0) {
        const progress = Math.min(1, Math.max(0, lastComputedProgressRef.current));
        void bookService.updateProgress(book.id, progress);
        updateBookProgress(book.id, progress);
      }
    };
  }, []);

  const storageKey = useMemo(() => `leaflet.reader.${book.id}`, [book.id]);
  const bookmarksKey = useMemo(() => `leaflet.bookmarks.${book.id}`, [book.id]);
  const readPrefs = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as {
        fontSize?: number;
        sidebarOpen?: boolean;
        displayMode?: ReaderDisplayMode;
        autoScrollSpeed?: number;
        speedReadWpm?: number;
        cfi?: string;
        chapterPositions?: Record<string, string>;
      };
    } catch {
      return null;
    }
  };

  const initialPrefs = readPrefs();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [fontSize, setFontSize] = useState(initialPrefs?.fontSize ?? 18);
  const fontSizeRef = useRef(fontSize);
  const sidebarRef = useRef(sidebarOpen);
  const [fontPanelOpen, setFontPanelOpen] = useState(false);
  const [autoScrollActive, setAutoScrollActive] = useState(false);
  const [autoScrollSpeed, setAutoScrollSpeed] = useState(initialPrefs?.autoScrollSpeed ?? 35);
  const [displayMode, setDisplayMode] = useState<ReaderDisplayMode>(
    initialPrefs?.displayMode ?? "paper"
  );
  const [readingMode, setReadingMode] = useState<ReadingMode>("standard");
  const [pendingReadingMode, setPendingReadingMode] = useState<Exclude<ReadingMode, "standard"> | null>(
    null
  );
  const [readingPaused, setReadingPaused] = useState(false);
  const [speedReadWpm, setSpeedReadWpm] = useState(
    Math.min(1000, Math.max(120, initialPrefs?.speedReadWpm ?? 260))
  );
  const [readingWord, setReadingWord] = useState<ReadingWordState | null>(null);
  const [adaptiveWpm, setAdaptiveWpm] = useState(185);
  const readerTheme = useAppearanceStore((state) => state.theme);
  const displayModeRef = useRef<ReaderDisplayMode>(displayMode);
  const readerThemeRef = useRef(readerTheme);
  const autoScrollSpeedRef = useRef(autoScrollSpeed);
  // Keep the mirrors current during render so long-lived callbacks created inside
  // the load effect (relocation handler, epub content hook) never read stale prefs.
  displayModeRef.current = displayMode;
  readerThemeRef.current = readerTheme;
  autoScrollSpeedRef.current = autoScrollSpeed;
  speedReadWpmRef.current = speedReadWpm;
  const toggleTheme = useAppearanceStore((state) => state.toggleTheme);
  const accountEmail = useAccountStore((state) => state.email);
  const smartProfileRef = useRef<SmartReadProfile>(loadSmartReadProfile(accountEmail));
  const smartCalibrationRef = useRef<SmartReadCalibration>(
    loadSmartReadCalibration(accountEmail)
  );
  const [morePanelOpen, setMorePanelOpen] = useState(false);
  const morePanelRef = useRef<HTMLDivElement | null>(null);
  const morePanelCloseRef = useRef<number | null>(null);
  const [readerDotEnabled, setReaderDotEnabled] = useState(true);
  const [bookmarkPanelOpen, setBookmarkPanelOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<
    Array<{ id: string; cfi: string; label: string; createdAt: string }>
  >([]);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [tocIndexByHref, setTocIndexByHref] = useState<Record<string, number>>({});
  const [tocLabelByHref, setTocLabelByHref] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastCfiRef = useRef<string | null>(initialPrefs?.cfi ?? null);
  const chapterPositionsRef = useRef<Record<string, string>>(initialPrefs?.chapterPositions ?? {});
  const [chapterIndex, setChapterIndex] = useState<number>(0);
  const [chapterLabel, setChapterLabel] = useState<string>("Chapter");
  const [currentHref, setCurrentHref] = useState<string | null>(null);
  const chapterLabelHasNumber = (label: string) => /(?:^|\s)(\d+|[ivxlcdm]+)\b/i.test(label);
  const formatChapterDisplay = () => {
    if (!chapterLabel) {
      return `Chapter ${chapterIndex + 1}`;
    }
    if (chapterLabelHasNumber(chapterLabel)) {
      return chapterLabel;
    }
    return `${chapterLabel} ${chapterIndex + 1}`;
  };

  const coverSrc = useMemo(() => {
    if (!book.coverUrl) {
      return null;
    }
    return book.coverUrl.startsWith("http") ? book.coverUrl : null;
  }, [book.coverUrl]);

  const [coverFallback, setCoverFallback] = useState<string | null>(null);
  const coverTriedRef = useRef(false);
  const updateBookProgress = useLibraryStore((state) => state.updateBookProgress);
  const spineIndexByHrefRef = useRef<Record<string, number>>({});
  const chapterSpineIndicesRef = useRef<number[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(bookmarksKey);
      if (!raw) {
        setBookmarks([]);
        return;
      }
      const parsed = JSON.parse(raw) as Array<{ id: string; cfi: string; label: string; createdAt: string }>;
      setBookmarks(Array.isArray(parsed) ? parsed : []);
    } catch {
      setBookmarks([]);
    }
  }, [bookmarksKey]);

  useEffect(() => {
    setBookmarkPanelOpen(false);
    setFontPanelOpen(false);
    setAutoScrollActive(false);
    setReadingMode("standard");
    setPendingReadingMode(null);
    setReadingPaused(false);
    setReadingWord(null);
    readerDotAnchorIndexRef.current = null;
    readerDotUserAnchorUntilRef.current = 0;
    if (readerDotOffscreenTimerRef.current) {
      window.clearTimeout(readerDotOffscreenTimerRef.current);
      readerDotOffscreenTimerRef.current = null;
    }
    requestedStartIndexRef.current = null;
    smartPaceBiasRef.current = 1;
    smartAheadTargetIndexRef.current = null;
    if (smartAheadTimerRef.current) {
      window.clearTimeout(smartAheadTimerRef.current);
      smartAheadTimerRef.current = null;
    }
    setMorePanelOpen(false);
  }, [book.id]);

  useEffect(() => {
    smartProfileRef.current = loadSmartReadProfile(accountEmail);
    smartCalibrationRef.current = loadSmartReadCalibration(accountEmail);
  }, [accountEmail]);

  useEffect(() => {
    if (!morePanelOpen) {
      return;
    }
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (morePanelRef.current && target && !morePanelRef.current.contains(target)) {
        setMorePanelOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [morePanelOpen]);

  useEffect(() => {
    return () => {
      if (morePanelCloseRef.current) {
        window.clearTimeout(morePanelCloseRef.current);
      }
    };
  }, []);


  const applyReaderInsets = () => {
    const rendition = renditionRef.current;
    if (!rendition?.themes) {
      return;
    }
    rendition.themes.override("padding-left", "var(--reader-content-pad, 24px)");
    rendition.themes.override("padding-right", "var(--reader-content-pad, 24px)");
    rendition.themes.override("margin-left", "0px");
    rendition.themes.override("margin-right", "0px");
    rendition.themes.override("max-width", "100%");
    rendition.themes.override("width", "100%");
    rendition.themes.override("box-sizing", "border-box");
  };

  const openReaderSidebar = () => {
    if (sidebarOpenTimerRef.current) {
      window.clearTimeout(sidebarOpenTimerRef.current);
      sidebarOpenTimerRef.current = null;
    }
    if (sidebarCloseTimerRef.current) {
      window.clearTimeout(sidebarCloseTimerRef.current);
      sidebarCloseTimerRef.current = null;
    }
    setSidebarOpen(true);
  };

  const scheduleReaderSidebarOpen = () => {
    if (sidebarOpen || sidebarOpenTimerRef.current) {
      return;
    }
    sidebarOpenTimerRef.current = window.setTimeout(() => {
      sidebarOpenTimerRef.current = null;
      openReaderSidebar();
    }, 240);
  };

  const cancelReaderSidebarOpen = () => {
    if (!sidebarOpenTimerRef.current) {
      return;
    }
    window.clearTimeout(sidebarOpenTimerRef.current);
    sidebarOpenTimerRef.current = null;
  };

  const scheduleReaderSidebarClose = () => {
    cancelReaderSidebarOpen();
    if (sidebarCloseTimerRef.current) {
      window.clearTimeout(sidebarCloseTimerRef.current);
    }
    sidebarCloseTimerRef.current = window.setTimeout(() => {
      setSidebarOpen(false);
      sidebarCloseTimerRef.current = null;
    }, 220);
  };

  const ensureSingleScrollContainer = () => {
    const manager = renditionRef.current?.manager as any;
    const container = manager?.container as HTMLElement | undefined;
    if (container) {
      container.style.overflowY = "auto";
      container.style.overflowX = "hidden";
      container.style.height = "100%";
      container.style.width = "100%";
      container.style.position = "relative";
    }
    if (viewerRef.current) {
      viewerRef.current.style.overflowY = "hidden";
      viewerRef.current.style.overflowX = "hidden";
    }
  };

  const applyReaderTypography = () => {
    const rendition = renditionRef.current;
    if (!rendition?.themes) {
      return;
    }
    rendition.themes.override("line-height", "1.8");
    rendition.themes.override("font-weight", "400");

    const contentsList = rendition.getContents?.() ?? [];
    contentsList.forEach((contents: any) => {
      const doc = contents?.document;
      if (!doc) {
        return;
      }
      doc.documentElement.style.setProperty("--reader-font-size", `${fontSizeRef.current}px`);
    });
  };

  const applyContentFlowStyles = () => {
    const rendition = renditionRef.current;
    const contentsList = rendition?.getContents?.() ?? [];
    contentsList.forEach((contents: any) => {
      const doc = contents?.document;
      if (!doc) {
        return;
      }
      doc.documentElement.style.overflow = "visible";
      doc.body.style.overflow = "visible";
      doc.documentElement.style.overflowX = "hidden";
      doc.body.style.overflowX = "hidden";
    });
  };

  const getReaderWordRect = (word: ReaderWord) => {
    try {
      const range = word.node.ownerDocument.createRange();
      range.setStart(word.node, word.start);
      range.setEnd(word.node, word.end);
      const rects = range.getClientRects();
      const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) {
        return null;
      }
      const iframeRect = word.iframe.getBoundingClientRect();
      return {
        top: iframeRect.top + rect.top,
        left: iframeRect.left + rect.left,
        width: rect.width,
        height: rect.height
      };
    } catch {
      return null;
    }
  };

  const findNearestWordIndex = (targetRatio = 0.38) => {
    const words = readerWordsRef.current;
    const container = ensureScrollContainer();
    if (!container || words.length === 0) {
      return 0;
    }
    const containerRect = container.getBoundingClientRect();
    const targetTop = containerRect.top + containerRect.height * targetRatio;
    let nearestIndex = activeWordIndexRef.current;
    let nearestDistance = Number.POSITIVE_INFINITY;
    let low = 0;
    let high = words.length - 1;
    while (low <= high) {
      const index = Math.floor((low + high) / 2);
      const rect = getReaderWordRect(words[index]);
      if (!rect) {
        low = index + 1;
        continue;
      }
      const distance = Math.abs(rect.top + rect.height / 2 - targetTop);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
      if (rect.top + rect.height / 2 < targetTop) {
        low = index + 1;
      } else {
        high = index - 1;
      }
    }
    return nearestIndex;
  };

  const buildReadingWordState = (index: number): ReadingWordState | null => {
    const words = readerWordsRef.current;
    const word = words[index];
    if (!word) return null;
    const contextStart = Math.floor(index / 42) * 42;
    return {
      index,
      total: words.length,
      text: word.text,
      contextStart,
      context: words.slice(contextStart, contextStart + 42).map((entry, offset) => ({
        text: entry.text,
        trailing: entry.trailing,
        index: contextStart + offset
      }))
    };
  };

  const applyUserReadingAnchor = (index: number) => {
    const words = readerWordsRef.current;
    if (words.length === 0) return;
    if (readerDotOffscreenTimerRef.current) {
      window.clearTimeout(readerDotOffscreenTimerRef.current);
      readerDotOffscreenTimerRef.current = null;
    }
    const clampedIndex = Math.min(words.length - 1, Math.max(0, index));
    const previousIndex = activeWordIndexRef.current;
    const delta = clampedIndex - previousIndex;
    readerDotAnchorIndexRef.current = clampedIndex;
    readerDotUserAnchorUntilRef.current = Number.POSITIVE_INFINITY;
    activeWordIndexRef.current = clampedIndex;
    programmaticScrollUntilRef.current = 0;
    smartManualOverrideUntilRef.current = Date.now() + 2200;
    if (readingModeRef.current === "smart" && Math.abs(delta) >= 8) {
      const adjustment = Math.min(0.08, Math.max(0.012, Math.abs(delta) / 1400));
      smartPaceBiasRef.current = Math.min(
        1.3,
        Math.max(0.72, smartPaceBiasRef.current + (delta > 0 ? adjustment : -adjustment))
      );
      if (delta < 0 && smartSessionRef.current) {
        smartSessionRef.current.rereads += Math.max(1, Math.round(Math.abs(delta) / 80));
      }
    }
    if (readingModeRef.current !== "standard") {
      setReadingWord(buildReadingWordState(clampedIndex));
    }
    positionReaderDotAtWord(clampedIndex);
  };

  const makeReaderDotInteractive = (element: HTMLElement, container: HTMLElement) => {
    if (!element.querySelector(".reader-dot-sparks")) {
      const sparks = element.ownerDocument.createElement("span");
      sparks.className = "reader-dot-sparks";
      sparks.setAttribute("aria-hidden", "true");
      for (let index = 1; index <= 5; index += 1) {
        const spark = element.ownerDocument.createElement("span");
        spark.className = `reader-dot-spark reader-dot-spark-${index}`;
        sparks.appendChild(spark);
      }
      element.appendChild(sparks);
    }
    if (element.dataset.interactive === "true") return;
    element.dataset.interactive = "true";
    element.tabIndex = 0;
    element.setAttribute("role", "slider");
    element.setAttribute("aria-label", "Dotty reading position");
    element.setAttribute("aria-orientation", "vertical");
    element.setAttribute("aria-valuemin", "1");
    element.title = "Drag Dotty to choose your reading start line";
    element.style.pointerEvents = "auto";

    let dragging = false;
    let pendingClientY = 0;
    const moveToClientY = (clientY: number) => {
      const rect = container.getBoundingClientRect();
      const ratio = Math.min(0.98, Math.max(0.02, (clientY - rect.top) / Math.max(1, rect.height)));
      applyUserReadingAnchor(findNearestWordIndex(ratio));
    };
    element.onpointerdown = (event) => {
      dragging = true;
      pendingClientY = event.clientY;
      element.classList.add("reader-dot-dragging");
      element.dataset.dragging = "true";
      element.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    element.onpointermove = (event) => {
      if (!dragging) return;
      pendingClientY = event.clientY;
      if (readerDotDragFrameRef.current) return;
      readerDotDragFrameRef.current = window.requestAnimationFrame(() => {
        readerDotDragFrameRef.current = null;
        moveToClientY(pendingClientY);
      });
    };
    element.onpointerup = (event) => {
      if (!dragging) return;
      dragging = false;
      element.classList.remove("reader-dot-dragging");
      delete element.dataset.dragging;
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
      moveToClientY(event.clientY);
    };
    element.onpointercancel = () => {
      dragging = false;
      element.classList.remove("reader-dot-dragging");
      delete element.dataset.dragging;
    };
    element.onkeydown = (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 8 : -8;
      applyUserReadingAnchor((readerDotAnchorIndexRef.current ?? activeWordIndexRef.current) + step);
    };
  };

  const positionReaderDotAtWord = (index: number) => {
    if (!readerDotEnabledRef.current) return;
    const word = readerWordsRef.current[index];
    const container = ensureScrollContainer();
    if (!word || !container) return;
    const rect = getReaderWordRect(word);
    if (!rect) return;
    const containerRect = container.getBoundingClientRect();
    const documentTop = rect.top - containerRect.top + container.scrollTop;
    const iframeRect = word.iframe.getBoundingClientRect();
    const body = word.node.ownerDocument.body;
    const computedPadding = Number.parseFloat(
      body ? word.node.ownerDocument.defaultView?.getComputedStyle(body).paddingLeft || "0" : "0"
    );
    const textLeft =
      iframeRect.left + (Number.isFinite(computedPadding) ? computedPadding : 24);
    const left = Math.max(7, textLeft - containerRect.left - 18);
    const dot =
      readerDotElementRef.current && container.contains(readerDotElementRef.current)
        ? readerDotElementRef.current
        : (() => {
            const element = document.createElement("div");
            element.id = "reader-lastline-dot";
            element.className = "reader-dot";
            element.style.position = "absolute";
            element.style.width = "10px";
            element.style.height = "10px";
            element.style.borderRadius = "9999px";
            element.style.pointerEvents = "none";
            element.style.opacity = "0";
            element.style.transition =
              "top 0.32s ease, left 0.32s ease, opacity 0.2s ease, transform 0.16s ease";
            element.style.zIndex = "50";
            container.appendChild(element);
            readerDotElementRef.current = element;
            makeReaderDotInteractive(element, container);
            return element;
          })();
    makeReaderDotInteractive(dot, container);
    dot.style.left = `${left}px`;
    dot.style.top = `${Math.max(6, documentTop + rect.height / 2 - 5)}px`;
    dot.style.opacity = "1";
    dot.setAttribute("aria-valuenow", `${index + 1}`);
    dot.setAttribute("aria-valuemax", `${readerWordsRef.current.length}`);
    readerDotAnchorIndexRef.current = index;
  };

  const monitorUserReaderDotVisibility = (container: HTMLElement) => {
    if (
      readingModeRef.current !== "standard" ||
      Date.now() >= readerDotUserAnchorUntilRef.current
    ) {
      if (readerDotOffscreenTimerRef.current) {
        window.clearTimeout(readerDotOffscreenTimerRef.current);
        readerDotOffscreenTimerRef.current = null;
      }
      return false;
    }
    const dot = readerDotElementRef.current;
    if (!dot || !container.contains(dot)) {
      if (readerDotOffscreenTimerRef.current) {
        window.clearTimeout(readerDotOffscreenTimerRef.current);
        readerDotOffscreenTimerRef.current = null;
      }
      return false;
    }
    if (dot.dataset.dragging === "true") {
      if (readerDotOffscreenTimerRef.current) {
        window.clearTimeout(readerDotOffscreenTimerRef.current);
        readerDotOffscreenTimerRef.current = null;
      }
      return true;
    }
    const dotRect = dot.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const edgeTolerance = 2;
    const isOffscreen =
      dotRect.bottom < containerRect.top - edgeTolerance ||
      dotRect.top > containerRect.bottom + edgeTolerance;
    if (!isOffscreen) {
      if (readerDotOffscreenTimerRef.current) {
        window.clearTimeout(readerDotOffscreenTimerRef.current);
        readerDotOffscreenTimerRef.current = null;
      }
      return true;
    }

    if (!readerDotOffscreenTimerRef.current) {
      readerDotOffscreenTimerRef.current = window.setTimeout(() => {
        readerDotOffscreenTimerRef.current = null;
        if (
          readingModeRef.current !== "standard" ||
          !readerDotEnabledRef.current ||
          Date.now() >= readerDotUserAnchorUntilRef.current
        ) {
          return;
        }
        const currentDot = readerDotElementRef.current;
        const currentContainer = scrollContainerRef.current;
        if (!currentDot || !currentContainer || !currentContainer.contains(currentDot)) {
          return;
        }
        const currentDotRect = currentDot.getBoundingClientRect();
        const currentContainerRect = currentContainer.getBoundingClientRect();
        const stillOffscreen =
          currentDotRect.bottom < currentContainerRect.top - edgeTolerance ||
          currentDotRect.top > currentContainerRect.bottom + edgeTolerance;
        if (!stillOffscreen) {
          return;
        }

        readerDotUserAnchorUntilRef.current = 0;
        readerDotAnchorIndexRef.current = null;
        const location = renditionRef.current?.location;
        const cfi = location?.end?.cfi ?? location?.start?.cfi;
        if (!cfi) {
          return;
        }
        updateLastReadMarker(cfi);
        const resetDot = readerDotElementRef.current;
        if (!resetDot) {
          return;
        }
        resetDot.classList.remove("reader-dot-reacquired");
        void resetDot.offsetWidth;
        resetDot.classList.add("reader-dot-reacquired");
        resetDot.title = "Dotty is following the last visible line";
        const onResetAnimationEnd = (event: AnimationEvent) => {
          if (event.target !== resetDot || event.animationName !== "readerDotReacquire") {
            return;
          }
          resetDot.classList.remove("reader-dot-reacquired");
          resetDot.removeEventListener("animationend", onResetAnimationEnd);
        };
        resetDot.addEventListener("animationend", onResetAnimationEnd);
      }, 5000);
    }
    return true;
  };

  const scrollWordIntoReadingBand = (index: number) => {
    if (
      readingModeRef.current === "smart" &&
      (Date.now() < smartManualOverrideUntilRef.current ||
        (smartAheadTargetIndexRef.current !== null &&
          index < smartAheadTargetIndexRef.current - 6))
    ) {
      return;
    }
    const word = readerWordsRef.current[index];
    const container = ensureScrollContainer();
    if (!word || !container) return;
    const rect = getReaderWordRect(word);
    if (!rect) return;
    const containerRect = container.getBoundingClientRect();
    const relativeTop = rect.top - containerRect.top;
    const lowerBand = container.clientHeight * (readingModeRef.current === "speed" ? 0.7 : 0.64);
    if (relativeTop > lowerBand) {
      programmaticScrollUntilRef.current = Date.now() + 850;
      container.scrollTo({
        top: Math.max(0, container.scrollTop + relativeTop - container.clientHeight * 0.38),
        behavior: "smooth"
      });
    }
  };

  const prepareReaderWords = (startAtViewport = false) => {
    const rendition = renditionRef.current;
    const previousWordCount = readerWordsRef.current.length;
    const previousAnchor = readerDotAnchorIndexRef.current;
    const preserveUserAnchor =
      Date.now() < readerDotUserAnchorUntilRef.current &&
      previousAnchor !== null &&
      previousWordCount > 0;
    const words: ReaderWord[] = [];
    const contentsList = rendition?.getContents?.() ?? [];
    contentsList.forEach((contents: any) => {
      const doc = contents?.document as Document | undefined;
      const iframe =
        (contents?.iframe as HTMLIFrameElement | undefined) ??
        (doc?.defaultView?.frameElement as HTMLIFrameElement | null);
      if (!doc?.body || !iframe) return;
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && words.length < 30000) {
        const textNode = node as Text;
        const parent = textNode.parentElement;
        const hidden =
          !parent ||
          Boolean(parent.closest("script, style, noscript, svg, [aria-hidden='true']")) ||
          parent.hidden;
        if (!hidden && textNode.data.trim()) {
          const matches = Array.from(
            textNode.data.matchAll(/[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*/gu)
          );
          matches.forEach((match, matchIndex) => {
            const start = match.index ?? 0;
            const text = match[0];
            const end = start + text.length;
            const nextStart = matches[matchIndex + 1]?.index ?? textNode.data.length;
            const trailing = textNode.data.slice(end, nextStart);
            const sentenceEnd = /[.!?][”"')\]]*\s*$/.test(`${text}${trailing}`);
            const paragraphEnd =
              matchIndex === matches.length - 1 &&
              !textNode.nextSibling &&
              Boolean(parent.closest("p, li, blockquote, pre"));
            words.push({
              text,
              trailing,
              node: textNode,
              start,
              end,
              difficulty: estimateWordDifficulty(text),
              rsvpPauseMultiplier: 1,
              sentenceEnd,
              paragraphEnd,
              iframe
            });
          });
        }
        node = walker.nextNode();
      }
    });
    const localFrequency = new Map<string, number>();
    words.forEach((word) => {
      const normalized = word.text.toLocaleLowerCase();
      localFrequency.set(normalized, (localFrequency.get(normalized) ?? 0) + 1);
    });
    words.forEach((word) => {
      word.rsvpPauseMultiplier = estimateRsvpPauseMultiplier(
        word.text,
        localFrequency.get(word.text.toLocaleLowerCase()) ?? 1
      );
    });
    readerWordsRef.current = words;
    manualReadingRef.current = null;
    const nextIndex = preserveUserAnchor
      ? Math.round((previousAnchor / Math.max(1, previousWordCount - 1)) * Math.max(0, words.length - 1))
      : startAtViewport && words.length > 0
        ? findNearestWordIndex()
        : Math.min(activeWordIndexRef.current, Math.max(0, words.length - 1));
    activeWordIndexRef.current = Math.min(Math.max(0, nextIndex), Math.max(0, words.length - 1));
    readerDotAnchorIndexRef.current = activeWordIndexRef.current;
    if (readingModeRef.current !== "standard" && words.length > 0) {
      setReadingWord(buildReadingWordState(activeWordIndexRef.current));
    } else if (readerDotEnabledRef.current && words.length > 0) {
      window.requestAnimationFrame(() => positionReaderDotAtWord(activeWordIndexRef.current));
    }
  };

  const scheduleReaderWordIndex = (startAtViewport = false, delay = 180) => {
    if (wordIndexTimerRef.current) {
      window.clearTimeout(wordIndexTimerRef.current);
    }
    wordIndexTimerRef.current = window.setTimeout(() => {
      wordIndexTimerRef.current = null;
      try {
        prepareReaderWords(startAtViewport);
      } catch {
        readerWordsRef.current = [];
      }
    }, delay);
  };

  const saveObservedReading = (fromIndex: number, toIndex: number, elapsedMs: number, rereads = 0) => {
    const words = readerWordsRef.current;
    const count = Math.abs(toIndex - fromIndex);
    if (count < 18 || elapsedMs < 5000 || words.length === 0) return;
    const start = Math.min(fromIndex, toIndex);
    const end = Math.min(words.length, Math.max(fromIndex, toIndex));
    const sampleWords = words.slice(start, end);
    const difficulty =
      sampleWords.reduce((sum, word) => sum + word.difficulty, 0) / Math.max(1, sampleWords.length);
    const next = recordSmartReadSample(smartProfileRef.current, {
      words: count,
      elapsedMs,
      genres: book.genres,
      timeBand: getReadingTimeBand(),
      difficulty,
      rereads
    });
    smartProfileRef.current = next;
    saveSmartReadProfile(accountEmail, next);
  };

  const cancelSmartAheadTracking = () => {
    if (smartAheadTimerRef.current) {
      window.clearTimeout(smartAheadTimerRef.current);
      smartAheadTimerRef.current = null;
    }
    smartAheadTargetIndexRef.current = null;
    smartManualOverrideUntilRef.current = Date.now() + 650;
  };

  const scheduleSmartAheadBoost = (viewportIndex: number) => {
    smartAheadTargetIndexRef.current = Math.max(
      smartAheadTargetIndexRef.current ?? viewportIndex,
      viewportIndex
    );
    smartManualOverrideUntilRef.current = Number.POSITIVE_INFINITY;
    if (smartAheadTimerRef.current) {
      return;
    }
    smartAheadTimerRef.current = window.setTimeout(() => {
      smartAheadTimerRef.current = null;
      if (readingModeRef.current !== "smart") {
        smartAheadTargetIndexRef.current = null;
        return;
      }
      const currentViewportIndex = findNearestWordIndex();
      const currentDotIndex = activeWordIndexRef.current;
      const lead = currentViewportIndex - currentDotIndex;
      if (lead < 12) {
        cancelSmartAheadTracking();
        return;
      }
      smartAheadTargetIndexRef.current = currentViewportIndex;
      const words = readerWordsRef.current;
      const calibration = smartCalibrationRef.current;
      const difficulty = words[currentDotIndex]?.difficulty ?? 1;
      const baseWpm = getAdaptiveWpm(
        smartProfileRef.current,
        book.genres,
        getReadingTimeBand(),
        difficulty,
        calibration
      );
      const catchUpWpm = Math.min(
        calibration.maxWpm,
        Math.max(baseWpm * 1.3, baseWpm + Math.min(150, lead * 0.85))
      );
      smartPaceBiasRef.current = Math.max(
        1,
        Math.min(2.2, catchUpWpm / Math.max(1, baseWpm))
      );
      setAdaptiveWpm(Math.round(catchUpWpm));
    }, 2200);
  };

  const observeManualReadingPosition = () => {
    if (Date.now() < programmaticScrollUntilRef.current || readerWordsRef.current.length === 0) {
      return;
    }
    const now = Date.now();
    const index = findNearestWordIndex();
    const previous = manualReadingRef.current;
    if (previous && now - previous.at >= 4500) {
      if (index >= previous.index) {
        saveObservedReading(previous.index, index, now - previous.at);
      } else {
        const session = smartSessionRef.current;
        if (session) {
          session.rereads += Math.max(1, Math.round((previous.index - index) / 80));
          activeWordIndexRef.current = index;
        }
      }
    }
    if (readingModeRef.current === "smart") {
      const lead = index - activeWordIndexRef.current;
      if (lead >= 12) {
        scheduleSmartAheadBoost(index);
      } else if (
        smartAheadTargetIndexRef.current !== null &&
        lead <= 6
      ) {
        cancelSmartAheadTracking();
      } else if (lead <= -12) {
        cancelSmartAheadTracking();
        smartPaceBiasRef.current = Math.max(0.72, smartPaceBiasRef.current * 0.9);
      }
    } else if (readingModeRef.current === "speed") {
      activeWordIndexRef.current = index;
      setReadingWord(buildReadingWordState(index));
    }
    manualReadingRef.current = { index, at: now };
  };

  const updateLastReadMarker = (cfi: string) => {
    if (!readerDotEnabledRef.current) {
      return;
    }
    if (Date.now() < readerDotUserAnchorUntilRef.current) {
      return;
    }
    const rendition = renditionRef.current;
    if (!rendition?.getContents) {
      return;
    }
    const contentsList = rendition.getContents();
    if (readerDotRetryRef.current.cfi !== cfi) {
      readerDotRetryRef.current = { cfi, count: 0 };
    }
    let found = false;

    for (const contents of contentsList) {
      try {
        const container = ensureScrollContainer();
        if (!container) {
          continue;
        }
        const range = contents.range(cfi);
        if (!range) {
          continue;
        }
        const rects = range.getClientRects();
        const rect =
          rects && rects.length > 0
            ? rects[rects.length - 1]
            : range.getBoundingClientRect();
        if (!rect || rect.height === 0) {
          continue;
        }
        const iframe =
          (contents?.iframe as HTMLIFrameElement | undefined) ??
          (contents?.document?.defaultView?.frameElement as HTMLIFrameElement | undefined);
        if (!iframe) {
          continue;
        }
        const iframeRect = iframe.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const lineTop = iframeRect.top + rect.top - containerRect.top;
        const doc = contents?.document;
        const computedPad = doc?.body
          ? Number.parseFloat(doc.defaultView?.getComputedStyle(doc.body).paddingLeft || "0")
          : 0;
        const pad = Number.isFinite(computedPad) && computedPad > 0 ? computedPad : 24;
        const clamp = (value: number, min: number, max: number) =>
          Math.min(max, Math.max(min, value));
        const containerWidth = container.clientWidth || containerRect.width;
        const textLeft = iframeRect.left - containerRect.left + pad;
        const trackLeft = clamp(textLeft - 18, 6, Math.max(6, containerWidth - 10));
        const target = {
          top: clamp(
            lineTop + container.scrollTop + rect.height / 2 - 6,
            6,
            Math.max(6, container.scrollHeight - 10)
          ),
          left: trackLeft
        };

        const existing = readerDotElementRef.current;
        const dot =
          existing && container.contains(existing)
            ? existing
            : (() => {
                const el = document.createElement("div");
                el.id = "reader-lastline-dot";
                el.className = "reader-dot";
                el.style.position = "absolute";
                el.style.width = "10px";
                el.style.height = "10px";
                el.style.borderRadius = "9999px";
                el.style.pointerEvents = "none";
                el.style.opacity = "0";
                el.style.transition =
                  "top 0.4s ease, left 0.4s ease, opacity 0.3s ease, transform 0.16s ease";
                el.style.zIndex = "50";
                el.style.transform = "translateX(0)";
                container.appendChild(el);
                readerDotElementRef.current = el;
                makeReaderDotInteractive(el, container);
                return el;
              })();
        makeReaderDotInteractive(dot, container);

        if (!dot.dataset.fixedLeft) {
          dot.style.left = `${target.left}px`;
          dot.dataset.fixedLeft = `${target.left}`;
        } else if (dot.dataset.fixedLeft !== `${target.left}`) {
          dot.style.left = `${target.left}px`;
          dot.dataset.fixedLeft = `${target.left}`;
        }
        dot.style.top = `${target.top}px`;
        dot.style.opacity = "1";
        lastMarkerRef.current = cfi;
        readerDotRetryRef.current = { cfi, count: 0 };
        found = true;
        break;
      } catch {
        // ignore range errors
      }
    }

    if (!found && readerDotRetryRef.current.count < 3) {
      readerDotRetryRef.current.count += 1;
      if (readerDotRetryTimerRef.current) {
        window.clearTimeout(readerDotRetryTimerRef.current);
      }
      readerDotRetryTimerRef.current = window.setTimeout(() => {
        readerDotRetryTimerRef.current = null;
        updateLastReadMarker(cfi);
      }, 260);
    }
  };

  const removeLastReadMarker = () => {
    if (readerDotTimerRef.current) {
      window.clearTimeout(readerDotTimerRef.current);
    }
    if (readerDotRetryTimerRef.current) {
      window.clearTimeout(readerDotRetryTimerRef.current);
      readerDotRetryTimerRef.current = null;
    }
    if (readerDotOffscreenTimerRef.current) {
      window.clearTimeout(readerDotOffscreenTimerRef.current);
      readerDotOffscreenTimerRef.current = null;
    }
    readerDotTimerRef.current = null;
    readerDotRetryRef.current = { cfi: "", count: 0 };
    if (readerDotElementRef.current) {
      readerDotElementRef.current.remove();
      readerDotElementRef.current = null;
    }
    lastMarkerRef.current = null;
  };

  const smoothScrollBy = (element: HTMLElement, delta: number) => {
    const start = element.scrollTop;
    const target = start + delta;
    const duration = 220;
    let startTime: number | null = null;

    const tick = (time: number) => {
      if (startTime === null) {
        startTime = time;
      }
      const progress = Math.min(1, (time - startTime) / duration);
      const eased = progress < 0.5
        ? 2 * progress * progress
        : -1 + (4 - 2 * progress) * progress;
      element.scrollTop = start + (target - start) * eased;
      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    };

    requestAnimationFrame(tick);
  };

  const isAtScrollBottom = (element: HTMLElement, padding = 6) =>
    element.scrollTop + element.clientHeight >= element.scrollHeight - padding;

  const ensureScrollSpacer = (container: HTMLElement) => {
    const existing = container.querySelector<HTMLElement>("#reader-scroll-spacer");
    if (existing) {
      existing.remove();
    }
  };

  const ensureScrollContainer = () => {
    const container = getScrollContainer();
    if (!container) {
      return null;
    }
    scrollContainerRef.current = container;
    ensureScrollSpacer(container);
    if (readerDotElementRef.current && !container.contains(readerDotElementRef.current)) {
      readerDotElementRef.current.remove();
      readerDotElementRef.current = null;
    }
    // The dot's horizontal position is owned by positionReaderDotAtWord /
    // updateLastReadMarker; resetting it here made it snap on every scroll tick.
    return container;
  };

  const scheduleReaderDotUpdate = () => {
    if (!readerDotEnabledRef.current || readingModeRef.current !== "standard") {
      return;
    }
    if (readerDotTimerRef.current) {
      window.clearTimeout(readerDotTimerRef.current);
    }
    readerDotTimerRef.current = window.setTimeout(() => {
      const location = renditionRef.current?.location;
      const cfi = location?.end?.cfi ?? location?.start?.cfi;
      if (cfi) {
        updateLastReadMarker(cfi);
      }
    }, 2000);
  };

  const triggerScrollAdvance = () => {
    if (scrollAdvanceLockRef.current) {
      return;
    }
    scrollAdvanceLockRef.current = true;
    if (scrollAdvanceTimerRef.current) {
      window.clearTimeout(scrollAdvanceTimerRef.current);
    }
    scrollAdvanceTimerRef.current = window.setTimeout(() => {
      scrollAdvanceLockRef.current = false;
    }, 900);
    goNextSection();
  };

  const persistReaderState = (override?: Partial<{
    cfi: string;
    chapterPositions: Record<string, string>;
  }>) => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          fontSize: fontSizeRef.current,
          sidebarOpen: sidebarRef.current,
          displayMode: displayModeRef.current,
          autoScrollSpeed: autoScrollSpeedRef.current,
          speedReadWpm: speedReadWpmRef.current,
          cfi: override?.cfi ?? lastCfiRef.current ?? undefined,
          chapterPositions: override?.chapterPositions ?? chapterPositionsRef.current
        })
      );
    } catch {
      // ignore
    }
  };

  const saveBookmarks = (next: Array<{ id: string; cfi: string; label: string; createdAt: string }>) => {
    setBookmarks(next);
    try {
      localStorage.setItem(bookmarksKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const addBookmark = () => {
    const location = renditionRef.current?.location;
    const cfi = location?.start?.cfi;
    if (!cfi) {
      return;
    }
    const href = location?.start?.href;
    const label = href ? tocLabelByHref[href] ?? chapterLabel : chapterLabel;
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      cfi,
      label: label || "Bookmark",
      createdAt: new Date().toISOString()
    };
    saveBookmarks([entry, ...bookmarks]);
  };

  const openBookmark = (cfi: string) => {
    if (!renditionRef.current) {
      return;
    }
    setBookmarkPanelOpen(false);
    void renditionRef.current.display(cfi);
  };

  const displayChapter = (href: string, options?: { useSaved?: boolean }) => {
    const rendition = renditionRef.current;
    if (!rendition) {
      return;
    }
    const useSaved = options?.useSaved ?? true;
    readerDotUserAnchorUntilRef.current = 0;
    readerDotAnchorIndexRef.current = null;
    if (readerDotOffscreenTimerRef.current) {
      window.clearTimeout(readerDotOffscreenTimerRef.current);
      readerDotOffscreenTimerRef.current = null;
    }
    const saved = chapterPositionsRef.current[href];
    const target = useSaved && saved ? saved : href;
    void rendition.display(target).then(() => {
      if (!useSaved) {
        const container = ensureScrollContainer();
        if (container) {
          container.scrollTop = 0;
        }
      }
    });
  };

  useEffect(() => {
    coverTriedRef.current = false;
    setCoverFallback(null);
  }, [book.id, book.coverUrl]);

  useEffect(() => {
    if (!isTauri() || !book.coverUrl || book.coverUrl.startsWith("http")) {
      return;
    }
    void bookService.coverData(book.id).then((data) => {
      if (data) {
        setCoverFallback(data);
      }
    });
  }, [book.id, book.coverUrl]);

  const localPath =
    (book as { localPath?: string; local_path?: string }).localPath ??
    (book as { localPath?: string; local_path?: string }).local_path ??
    "";

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    setToc([]);

    if (!localPath) {
      setLoadError("Missing book file.");
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        const ext = getBookExtension(localPath);
        if (ext && !READABLE_EXTENSIONS.includes(ext) && ext !== "mobi" && ext !== "azw3") {
          const supported = formatDisplayList(READABLE_EXTENSIONS);
          setLoadError(`This reader supports ${supported} files only.`);
          setLoading(false);
          return;
        }
        if (isTauri() && ext !== "epub") {
          const installed = await converterService.status().catch(() => false);
          if (!installed) {
            setLoadError("Converter not installed. Install it in Settings to open this file.");
            setLoading(false);
            return;
          }
        }
        let buffer: ArrayBuffer;
        if (isTauri()) {
          const base64 = await bookService.readBookBytes(book.id);
          if (!base64) {
            throw new Error("Unable to read the book file. Make sure you're running the desktop app.");
          }
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
          }
          buffer = bytes.buffer;
        } else {
          const source = localPath;
          const response = await fetch(source);
          if (!response.ok) {
            throw new Error("fetch failed");
          }
          buffer = await response.arrayBuffer();
        }

        if (bookRef.current) {
          bookRef.current.destroy();
          bookRef.current = null;
        }

        let epub: ReturnType<typeof ePub>;
        try {
          epub = ePub(buffer);
        } catch (error) {
          const supported = formatDisplayList(READABLE_EXTENSIONS);
          if (ext && ext !== "epub") {
            setLoadError(
              `Conversion failed for ${ext.toUpperCase()}. Reinstall the converter in Settings and try again.`
            );
          } else {
            const suffix = ext ? ` ${ext.toUpperCase()} files can be imported, but aren't readable yet.` : "";
            setLoadError(`This reader currently supports ${supported} files only.${suffix}`);
          }
          setLoading(false);
          return;
        }
        bookRef.current = epub;
        if (epub.locations && typeof epub.locations.generate === "function") {
          void epub.locations.generate(1600);
        }

        if (!viewerRef.current) {
          throw new Error("Reader container not ready.");
        }

        const rendition = epub.renderTo(viewerRef.current, {
          width: "100%",
          height: "100%"
        });
        renditionRef.current = rendition;

        rendition.hooks?.content?.register((contents: any) => {
          const doc = contents?.document;
          if (!doc) {
            return;
          }
          const pad = 24;
          doc.documentElement.style.setProperty("--reader-content-pad", `${pad}px`);
          if (!doc.getElementById("reader-font-scale")) {
            const style = doc.createElement("style");
            style.id = "reader-font-scale";
            style.textContent = `
              @font-face { font-family: "ZT Nature"; src: url("${ztNatureBoldWoff2}") format("woff2"); font-display: swap; font-weight: 700; }
              :root { --reader-font-size: ${fontSizeRef.current}px; }
              html { font-size: var(--reader-font-size) !important; width: 100% !important; max-width: 100% !important; transition: padding 0.25s ease; }
              body { font-size: 1em !important; margin: 0 !important; padding-left: var(--reader-content-pad, 24px) !important; padding-right: var(--reader-content-pad, 24px) !important; text-align: justify !important; text-justify: inter-word !important; hyphens: auto; width: 100% !important; max-width: 100% !important; box-sizing: border-box; transition: padding 0.25s ease; }
              body > *:first-child { margin-top: 0 !important; padding-top: 0 !important; }
              body * { font-size: inherit !important; line-height: inherit; box-sizing: border-box; max-width: 100% !important; }
              body > * { max-width: 100% !important; }
              p { text-align: justify !important; text-justify: inter-word !important; hyphens: auto; text-indent: 0 !important; margin-left: 0 !important; margin-bottom: 1.6em !important; }
              p, div, section, article, blockquote, li { text-indent: 0 !important; margin-left: 0 !important; }
              h1, h2, h3, h4, h5, h6 { font-family: "ZT Nature", "Segoe UI", sans-serif !important; font-weight: 700 !important; letter-spacing: -0.01em; }
              html[data-reader-finish="paper"] body { color: #30291f !important; }
              html[data-reader-finish="paper"] p,
              html[data-reader-finish="paper"] li,
              html[data-reader-finish="paper"] blockquote,
              html[data-reader-finish="paper"] td,
              html[data-reader-finish="paper"] dd {
                color: rgba(43, 36, 27, 0.96) !important;
                text-shadow:
                  0.18px 0 rgba(32, 25, 18, 0.42),
                  -0.12px 0.16px rgba(82, 65, 43, 0.2);
                filter: contrast(1.035);
              }
              html[data-reader-finish="paper"] h1,
              html[data-reader-finish="paper"] h2,
              html[data-reader-finish="paper"] h3,
              html[data-reader-finish="paper"] h4,
              html[data-reader-finish="paper"] h5,
              html[data-reader-finish="paper"] h6 {
                color: #2b3a2c !important;
                text-shadow: 0.22px 0.18px rgba(45, 35, 24, 0.28);
              }
              html[data-reader-finish="paper"] ::selection { background: rgba(30, 111, 66, 0.25); }
              html[data-reader-finish="dark-paper"] body { color: #eeeae0 !important; }
              html[data-reader-finish="dark-paper"] p,
              html[data-reader-finish="dark-paper"] li,
              html[data-reader-finish="dark-paper"] blockquote,
              html[data-reader-finish="dark-paper"] td,
              html[data-reader-finish="dark-paper"] dd {
                color: rgba(238, 234, 224, 0.96) !important;
                text-shadow:
                  0.16px 0 rgba(255, 255, 255, 0.12),
                  -0.12px 0.16px rgba(0, 0, 0, 0.46);
                filter: contrast(1.04);
              }
              html[data-reader-finish="dark-paper"] h1,
              html[data-reader-finish="dark-paper"] h2,
              html[data-reader-finish="dark-paper"] h3,
              html[data-reader-finish="dark-paper"] h4,
              html[data-reader-finish="dark-paper"] h5,
              html[data-reader-finish="dark-paper"] h6 {
                color: #d9f4e2 !important;
                text-shadow: 0.2px 0.18px rgba(0, 0, 0, 0.55);
              }
              html[data-reader-finish="dark-paper"] ::selection { background: rgba(114, 171, 68, 0.34); }
              html[data-reader-finish="true-white"] body,
              html[data-reader-finish="true-white"] p,
              html[data-reader-finish="true-white"] li,
              html[data-reader-finish="true-white"] blockquote,
              html[data-reader-finish="true-white"] td,
              html[data-reader-finish="true-white"] dd {
                color: #090a09 !important;
                text-shadow: none !important;
                filter: none !important;
              }
              html[data-reader-finish="true-white"] h1,
              html[data-reader-finish="true-white"] h2,
              html[data-reader-finish="true-white"] h3,
              html[data-reader-finish="true-white"] h4,
              html[data-reader-finish="true-white"] h5,
              html[data-reader-finish="true-white"] h6 {
                color: #090a09 !important;
                text-shadow: none !important;
              }
              html[data-reader-finish="true-white"] ::selection { background: rgba(79, 123, 55, 0.24); }
              html[data-reader-finish="true-black"] body,
              html[data-reader-finish="true-black"] p,
              html[data-reader-finish="true-black"] li,
              html[data-reader-finish="true-black"] blockquote,
              html[data-reader-finish="true-black"] td,
              html[data-reader-finish="true-black"] dd {
                color: #f2f1eb !important;
                text-shadow: none !important;
                filter: none !important;
              }
              html[data-reader-finish="true-black"] h1,
              html[data-reader-finish="true-black"] h2,
              html[data-reader-finish="true-black"] h3,
              html[data-reader-finish="true-black"] h4,
              html[data-reader-finish="true-black"] h5,
              html[data-reader-finish="true-black"] h6 {
                color: #f2f1eb !important;
                text-shadow: none !important;
              }
              html[data-reader-finish="true-black"] ::selection { background: rgba(114, 171, 68, 0.42); }
            `;
            doc.head.appendChild(style);
          } else {
            doc.documentElement.style.setProperty("--reader-font-size", `${fontSizeRef.current}px`);
            doc.documentElement.style.setProperty("--reader-content-pad", `${pad}px`);
          }
          doc.documentElement.style.overflow = "visible";
          doc.body.style.overflow = "visible";
          doc.documentElement.style.overflowX = "hidden";
          doc.body.style.overflowX = "hidden";
          const currentDisplayMode = displayModeRef.current;
          const currentReaderTheme = readerThemeRef.current;
          const finish = getReaderFinish(currentDisplayMode, currentReaderTheme);
          const finishBackground = getReaderFinishBackground(finish);
          doc.documentElement.dataset.readerFinish = currentDisplayMode;
          doc.documentElement.style.backgroundColor = finish.background;
          doc.body.style.backgroundColor = finish.background;
          doc.documentElement.style.backgroundImage = finishBackground;
          doc.body.style.backgroundImage = finishBackground;
          doc.documentElement.style.backgroundSize = finish.texture ? "cover" : "auto";
          doc.body.style.backgroundSize = finish.texture ? "cover" : "auto";
        });

        rendition.themes.register("leaflet-dark", {
          html: {
            background: "#202227",
            color: "#f7f9fc",
            overflowX: "hidden"
          },
          body: {
            background: "#202227",
            color: "#f7f9fc",
            lineHeight: "1.8",
            fontFamily: "Georgia, Cambria, 'Times New Roman', serif",
            margin: "0 auto",
            width: "100%",
            padding: "0",
            maxWidth: "100%",
            overflowX: "hidden"
          },
          "*": {
            boxSizing: "border-box",
            maxWidth: "100%"
          },
          p: {
            margin: "0 0 1.6em 0",
            textAlign: "justify",
            textIndent: "0"
          },
          span: {
            fontSize: "inherit"
          },
          div: {
            fontSize: "inherit"
          },
          li: {
            marginBottom: "0.6em"
          },
          h1: { fontSize: "1.6em", margin: "2.2em 0 0.6em 0", paddingTop: "0.4em", borderTop: "1px solid rgba(255,255,255,0.08)" },
          h2: { fontSize: "1.45em", margin: "2em 0 0.6em 0", paddingTop: "0.4em", borderTop: "1px solid rgba(255,255,255,0.08)" },
          h3: { fontSize: "1.3em", margin: "1.6em 0 0.5em 0" },
          h4: { fontSize: "1.2em", margin: "0 0 0.5em 0" },
          h5: { fontSize: "1.1em", margin: "0 0 0.4em 0" },
          h6: { fontSize: "1.05em", margin: "0 0 0.4em 0" },
          hr: { border: "none", borderTop: "1px solid rgba(255,255,255,0.08)", margin: "2em 0" },
          img: {
            maxWidth: "100%",
            height: "auto"
          },
          svg: {
            maxWidth: "100%",
            height: "auto"
          },
          table: {
            width: "100%",
            maxWidth: "100%",
            display: "block",
            overflowX: "auto"
          },
          pre: {
            whiteSpace: "pre-wrap",
            wordBreak: "break-word"
          },
          code: {
            whiteSpace: "pre-wrap",
            wordBreak: "break-word"
          }
        });
        rendition.themes.register("leaflet-light", {
          html: {
            background: "#edeae2",
            color: "#16191e",
            overflowX: "hidden"
          },
          body: {
            background: "#edeae2",
            color: "#16191e",
            lineHeight: "1.8",
            fontFamily: "Georgia, Cambria, 'Times New Roman', serif",
            margin: "0 auto",
            width: "100%",
            padding: "0",
            maxWidth: "100%",
            overflowX: "hidden"
          },
          "*": {
            boxSizing: "border-box",
            maxWidth: "100%"
          },
          p: {
            margin: "0 0 1.6em 0",
            textAlign: "justify",
            textIndent: "0"
          },
          span: {
            fontSize: "inherit"
          },
          div: {
            fontSize: "inherit"
          },
          li: {
            marginBottom: "0.6em"
          },
          h1: { fontSize: "1.6em", margin: "2.2em 0 0.6em 0", paddingTop: "0.4em", borderTop: "1px solid rgba(15,15,16,0.12)" },
          h2: { fontSize: "1.45em", margin: "2em 0 0.6em 0", paddingTop: "0.4em", borderTop: "1px solid rgba(15,15,16,0.12)" },
          h3: { fontSize: "1.3em", margin: "1.6em 0 0.5em 0" },
          h4: { fontSize: "1.2em", margin: "0 0 0.5em 0" },
          h5: { fontSize: "1.1em", margin: "0 0 0.4em 0" },
          h6: { fontSize: "1.05em", margin: "0 0 0.4em 0" },
          hr: { border: "none", borderTop: "1px solid rgba(15,15,16,0.12)", margin: "2em 0" },
          img: {
            maxWidth: "100%",
            height: "auto"
          },
          svg: {
            maxWidth: "100%",
            height: "auto"
          },
          table: {
            width: "100%",
            maxWidth: "100%",
            display: "block",
            overflowX: "auto"
          },
          pre: {
            whiteSpace: "pre-wrap",
            wordBreak: "break-word"
          },
          code: {
            whiteSpace: "pre-wrap",
            wordBreak: "break-word"
          }
        });
        const initialFinish = getReaderFinish(displayModeRef.current, readerThemeRef.current);
        rendition.themes.select(initialFinish.themeName);
        rendition.themes.override("background", initialFinish.background);
        rendition.themes.override("color", initialFinish.text);
        applyReaderTypography();
        applyReaderInsets();
        const initialFlow = "scrolled-doc";
        const initialSpread = "none";
        rendition.flow(initialFlow);
        const manager = rendition.manager as any;
        if (manager?.settings) {
          manager.settings.flow = initialFlow;
          manager.settings.spread = initialSpread;
        }
        if (typeof rendition.spread === "function") {
          rendition.spread(initialSpread);
        }
        ensureSingleScrollContainer();

        const navigation = await epub.loaded.navigation;
        const flatToc = flattenToc(navigation.toc);
        setToc(flatToc);
        const chapterToc = flatToc.filter((item) => isChapterLike(item.label));
        const indexMap: Record<string, number> = {};
        const labelMap: Record<string, string> = {};
        const spineIndexByHref: Record<string, number> = {};
        const spineItems = epub.spine?.items ?? [];
        spineItems.forEach((item: any, idx: number) => {
          if (item?.href) {
            spineIndexByHref[item.href] = idx;
          }
        });
        let dedupIndex = 0;
        const seenHrefs = new Set<string>();
        chapterToc.forEach((item) => {
          if (seenHrefs.has(item.href)) {
            return;
          }
          seenHrefs.add(item.href);
          indexMap[item.href] = dedupIndex;
          labelMap[item.href] = item.label;
          dedupIndex += 1;
        });
        setTocIndexByHref(indexMap);
        setTocLabelByHref(labelMap);
        spineIndexByHrefRef.current = spineIndexByHref;
        chapterSpineIndicesRef.current = Object.keys(indexMap)
          .map((href) => spineIndexByHref[href])
          .filter((value) => typeof value === "number")
          .sort((a, b) => (a as number) - (b as number)) as number[];

        const onRelocated = (location: any) => {
          const resolveProgress = () => {
            const href = location?.start?.href ?? location?.end?.href;
            const spineIndex = typeof location?.start?.index === "number"
              ? location.start.index
              : typeof location?.end?.index === "number"
                ? location.end.index
                : href
                  ? spineIndexByHrefRef.current[href]
                  : undefined;

            const chapterSpineIndices = chapterSpineIndicesRef.current;
            const chapterTotal = chapterSpineIndices.length;
            const firstChapterSpine = chapterTotal > 0 ? chapterSpineIndices[0] : undefined;
            const lastChapterSpine = chapterTotal > 0 ? chapterSpineIndices[chapterTotal - 1] : undefined;

            if (chapterTotal > 0 && typeof spineIndex === "number" && typeof firstChapterSpine === "number") {
              if (spineIndex < firstChapterSpine) {
                return 0;
              }
            }

            let chapterIndex = href && indexMap[href] !== undefined ? indexMap[href] : undefined;
            if (chapterIndex === undefined && typeof spineIndex === "number" && chapterTotal > 0) {
              for (let i = 0; i < chapterSpineIndices.length; i += 1) {
                if (spineIndex >= chapterSpineIndices[i]) {
                  chapterIndex = i;
                } else {
                  break;
                }
              }
            }

            const sectionProgress = () => {
              const displayed = location?.start?.displayed ?? location?.end?.displayed;
              if (displayed?.page && displayed?.total && displayed.total > 1) {
                const ratio = displayed.page / displayed.total;
                if (Number.isFinite(ratio)) {
                  return Math.min(1, Math.max(0, ratio));
                }
              }
              return 0;
            };

            if (chapterTotal > 0 && typeof chapterIndex === "number") {
              if (typeof spineIndex === "number" && typeof lastChapterSpine === "number" && spineIndex > lastChapterSpine) {
                return 1;
              }
              const within = sectionProgress();
              if (chapterIndex >= chapterTotal - 1 && within >= 0.98) {
                return 1;
              }
              const progress = (chapterIndex + within) / chapterTotal;
              return Math.min(1, Math.max(0, progress));
            }

            const cfi = location?.start?.cfi ?? location?.end?.cfi;
            const locations = bookRef.current?.locations;
            if (cfi && locations?.percentageFromCfi) {
              const percent = locations.percentageFromCfi(cfi);
              if (typeof percent === "number" && Number.isFinite(percent)) {
                return Math.min(1, Math.max(0, percent));
              }
            }

            const direct = location?.start?.percentage ?? location?.end?.percentage;
            if (typeof direct === "number" && Number.isFinite(direct)) {
              return Math.min(1, Math.max(0, direct));
            }

            return 0;
          };

          const percentage = resolveProgress();
          const now = Date.now();
          if (location?.start?.cfi) {
            lastCfiRef.current = location.start.cfi;
            const href = location?.start?.href;
            if (href) {
              chapterPositionsRef.current = {
                ...chapterPositionsRef.current,
                [href]: location.start.cfi
              };
            }
            persistReaderState({
              cfi: location.start.cfi,
              chapterPositions: chapterPositionsRef.current
            });
          }

          // no auto-advance in scroll mode

          const shouldUpdateProgress =
            Math.abs(percentage - lastProgressRef.current) >= 0.005 ||
            now - lastProgressAtRef.current >= 10000;

          if (shouldUpdateProgress) {
            lastProgressRef.current = percentage;
            lastProgressAtRef.current = now;
            void bookService.updateProgress(book.id, percentage);
            updateBookProgress(book.id, percentage);
            lastComputedProgressRef.current = percentage;
          }

          const href = location?.start?.href;
          if (href && indexMap[href] !== undefined) {
            setChapterIndex(indexMap[href]);
            setChapterLabel(labelMap[href] ?? "Chapter");
          }
          if (href) {
            setCurrentHref(href);
          }

          scheduleReaderDotUpdate();
          scrollAdvanceLockRef.current = false;

        };
        relocateHandlerRef.current = onRelocated;
        rendition.on("relocated", onRelocated);
        rendition.on?.("rendered", () => {
          applyReaderTypography();
          ensureSingleScrollContainer();
          ensureScrollContainer();
          scheduleReaderWordIndex(true);
        });

        if (lastCfiRef.current) {
          await rendition.display(lastCfiRef.current);
        } else {
          await rendition.display();
        }
        applyReaderInsets();
        scheduleReaderWordIndex(true);
        setLoading(false);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Failed to load book.");
        setLoading(false);
      }
    };

    load();

    return () => {
      if (renditionRef.current && relocateHandlerRef.current) {
        renditionRef.current.off("relocated", relocateHandlerRef.current);
      }
      removeLastReadMarker();
      if (renditionRef.current) {
        renditionRef.current.destroy();
        renditionRef.current = null;
      }
      if (bookRef.current) {
        bookRef.current.destroy();
        bookRef.current = null;
      }
    };
  }, [book.id, localPath]);

  useEffect(() => {
    if (loading) return;
    const viewer = viewerRef.current;
    const rendition = renditionRef.current;
    if (!viewer || !rendition?.resize) return;

    let frame = 0;
    const syncViewport = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const width = Math.max(1, Math.round(viewer.clientWidth));
        const height = Math.max(1, Math.round(viewer.clientHeight));
        rendition.resize(width, height);
        ensureSingleScrollContainer();
      });
    };
    const observer = new ResizeObserver(syncViewport);
    observer.observe(viewer);
    syncViewport();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [book.id, loading]);

  // flip mode removed; scroll flow is initialized during load

  useEffect(() => {
    displayModeRef.current = displayMode;
    readerThemeRef.current = readerTheme;
    if (!renditionRef.current?.themes) {
      return;
    }
    const finish = getReaderFinish(displayMode, readerTheme);
    renditionRef.current.themes.select(finish.themeName);
    renditionRef.current.themes.override("background", finish.background);
    renditionRef.current.themes.override("color", finish.text);
    const finishBackground = getReaderFinishBackground(finish);
    const contentsList = renditionRef.current.getContents?.() ?? [];
    contentsList.forEach((contents: any) => {
      const doc = contents?.document;
      if (!doc) {
        return;
      }
      doc.documentElement.style.backgroundColor = finish.background;
      doc.body.style.backgroundColor = finish.background;
      doc.documentElement.dataset.readerFinish = displayMode;
      doc.documentElement.style.backgroundImage = finishBackground;
      doc.body.style.backgroundImage = finishBackground;
      doc.documentElement.style.backgroundSize = finish.texture ? "cover" : "auto";
      doc.body.style.backgroundSize = finish.texture ? "cover" : "auto";
      doc.documentElement.style.color = finish.text;
      doc.body.style.color = finish.text;
    });
    if (readerDotEnabled) {
      ensureScrollContainer();
      scheduleReaderDotUpdate();
    }
    persistReaderState();
  }, [readerTheme, displayMode]);

  useEffect(() => {
    let activeContainer: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const queueManualObservation = (delay = 160) => {
      if (manualScrollTimerRef.current) {
        window.clearTimeout(manualScrollTimerRef.current);
      }
      manualScrollTimerRef.current = window.setTimeout(() => {
        manualScrollTimerRef.current = null;
        observeManualReadingPosition();
      }, delay);
    };

    const onWheel = (event: WheelEvent) => {
      // scroll-only mode
      const target = event.currentTarget as HTMLElement;
      if (!target) {
        return;
      }
      programmaticScrollUntilRef.current = 0;
      if (readingModeRef.current === "smart") {
        smartManualOverrideUntilRef.current = Date.now() + 2200;
      }
      if (event.deltaY > 0) {
        lastWheelDownAtRef.current = Date.now();
        if (isAtScrollBottom(target, 2)) {
          triggerScrollAdvance();
        }
      }
      queueManualObservation(120);
      scheduleReaderDotUpdate();
    };

    const onScroll = (event: Event) => {
      // scroll-only mode
      const target = event.currentTarget as HTMLElement;
      if (!target) {
        return;
      }
      const now = Date.now();
      const last = lastScrollTopRef.current ?? target.scrollTop;
      const delta = target.scrollTop - last;
      lastScrollTopRef.current = target.scrollTop;
      if (delta > 0) {
        lastWheelDownAtRef.current = now;
      }
      if (isAtScrollBottom(target, 2) && now - lastWheelDownAtRef.current < 700) {
        triggerScrollAdvance();
      }
      if (now >= programmaticScrollUntilRef.current) {
        if (readingModeRef.current === "smart") {
          smartManualOverrideUntilRef.current = now + 2200;
        }
        queueManualObservation();
      }
      const manualDotActive = monitorUserReaderDotVisibility(target);
      if (!manualDotActive) {
        scheduleReaderDotUpdate();
      }
    };

    const attach = (container: HTMLElement) => {
      activeContainer = container;
      ensureScrollSpacer(container);
      resizeObserver = new ResizeObserver(() => {
        ensureScrollSpacer(container);
      });
      resizeObserver.observe(container);
      container.addEventListener("wheel", onWheel, { passive: true });
      container.addEventListener("scroll", onScroll, { passive: true });
    };

    const detach = () => {
      if (!activeContainer) {
        return;
      }
      activeContainer.removeEventListener("wheel", onWheel);
      activeContainer.removeEventListener("scroll", onScroll);
      resizeObserver?.disconnect();
      resizeObserver = null;
      activeContainer = null;
      lastScrollTopRef.current = null;
      if (manualScrollTimerRef.current) {
        window.clearTimeout(manualScrollTimerRef.current);
        manualScrollTimerRef.current = null;
      }
    };

    const onRendered = () => {
      const next = ensureScrollContainer();
      if (!next) {
        return;
      }
      if (activeContainer !== next) {
        detach();
        attach(next);
      } else {
        ensureScrollSpacer(next);
      }
      scheduleReaderWordIndex(true);
    };

    // The rendition is created asynchronously by the load effect, so this must wait
    // for `loading` to clear — otherwise no scroll/wheel listener is ever attached.
    const rendition = renditionRef.current;
    if (loading || !rendition) {
      return;
    }

    const initial = ensureScrollContainer();
    if (initial) {
      attach(initial);
    }
    rendition.on?.("rendered", onRendered);

    return () => {
      rendition.off?.("rendered", onRendered);
      detach();
    };
  }, [book.id, loading]);

  useEffect(() => {
    if (!autoScrollActive) {
      if (autoScrollRafRef.current) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
      autoScrollLastTimeRef.current = null;
      autoScrollCarryRef.current = 0;
      return;
    }

    const container = ensureScrollContainer();
    if (!container) {
      return;
    }

    autoScrollLastTimeRef.current = null;

    const tick = (time: number) => {
      if (!autoScrollActive) {
        return;
      }
      if (autoScrollLastTimeRef.current === null) {
        autoScrollLastTimeRef.current = time;
      }
      const deltaSeconds = Math.min(0.2, (time - autoScrollLastTimeRef.current) / 1000);
      autoScrollLastTimeRef.current = time;
      const before = container.scrollTop;
      const normalized = Math.min(100, Math.max(0, autoScrollSpeed)) / 100;
      const speedPxPerSecond = 3 + normalized * 45;
      autoScrollCarryRef.current += speedPxPerSecond * deltaSeconds;
      const move = Math.floor(autoScrollCarryRef.current);
      if (move > 0) {
        autoScrollCarryRef.current -= move;
        container.scrollTop = before + move;
      }
      if (container.scrollTop === before && isAtScrollBottom(container, 2)) {
        triggerScrollAdvance();
      }
      autoScrollRafRef.current = requestAnimationFrame(tick);
    };

    autoScrollRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (autoScrollRafRef.current) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
      autoScrollLastTimeRef.current = null;
      autoScrollCarryRef.current = 0;
    };
  }, [autoScrollActive, autoScrollSpeed, book.id]);

  const finishSmartSession = () => {
    const session = smartSessionRef.current;
    smartSessionRef.current = null;
    if (!session) return;
    const wordsRead = Math.max(0, session.furthestIndex - session.startIndex);
    const averageDifficulty =
      session.difficultyTotal / Math.max(1, session.difficultySamples);
    const next = recordSmartReadSample(smartProfileRef.current, {
      words: wordsRead,
      elapsedMs: session.activeMs,
      genres: book.genres,
      timeBand: getReadingTimeBand(new Date(session.startedAt)),
      difficulty: averageDifficulty || 1,
      rereads: session.rereads
    });
    smartProfileRef.current = next;
    saveSmartReadProfile(accountEmail, next);
  };

  useEffect(() => {
    readingPausedRef.current = readingPaused;
  }, [readingPaused]);

  useEffect(() => {
    speedReadWpmRef.current = speedReadWpm;
    persistReaderState();
  }, [speedReadWpm]);

  useEffect(() => {
    readingModeRef.current = readingMode;
    if (readingMode !== "smart") {
      if (smartAheadTimerRef.current) {
        window.clearTimeout(smartAheadTimerRef.current);
        smartAheadTimerRef.current = null;
      }
      smartAheadTargetIndexRef.current = null;
      smartManualOverrideUntilRef.current = 0;
    }
    if (readingMode !== "standard" && readerDotOffscreenTimerRef.current) {
      window.clearTimeout(readerDotOffscreenTimerRef.current);
      readerDotOffscreenTimerRef.current = null;
    }
    setAutoScrollActive(false);
    setReadingPaused(false);
    readingPausedRef.current = false;
    if (readingEngineTimerRef.current) {
      window.clearTimeout(readingEngineTimerRef.current);
      readingEngineTimerRef.current = null;
    }
    if (readingMode === "standard") {
      finishSmartSession();
      setReadingWord(null);
      const cfi = renditionRef.current?.location?.end?.cfi ?? renditionRef.current?.location?.start?.cfi;
      if (readerDotEnabled && cfi) updateLastReadMarker(cfi);
      return;
    }

    prepareReaderWords(false);
    const requestedStart = requestedStartIndexRef.current;
    const anchoredStart = readerDotAnchorIndexRef.current;
    const availableWords = readerWordsRef.current.length;
    activeWordIndexRef.current = Math.min(
      Math.max(
        0,
        requestedStart ?? anchoredStart ?? (availableWords > 0 ? findNearestWordIndex() : 0)
      ),
      Math.max(0, availableWords - 1)
    );
    requestedStartIndexRef.current = null;
    readerDotAnchorIndexRef.current = activeWordIndexRef.current;
    setReadingWord(buildReadingWordState(activeWordIndexRef.current));
    if (readingMode === "smart") {
      smartPaceBiasRef.current = 1;
      smartAheadTargetIndexRef.current = null;
      const now = Date.now();
      smartSessionRef.current = {
        startedAt: now,
        activeMs: 0,
        lastTickAt: now,
        startIndex: activeWordIndexRef.current,
        furthestIndex: activeWordIndexRef.current,
        difficultyTotal: 0,
        difficultySamples: 0,
        rereads: 0
      };
    } else {
      finishSmartSession();
      removeLastReadMarker();
    }

    let stopped = false;
    const schedule = (delay: number) => {
      if (stopped) return;
      readingEngineTimerRef.current = window.setTimeout(() => {
        if (stopped || readingModeRef.current === "standard") return;
        if (readingPausedRef.current) {
          if (smartSessionRef.current) {
            smartSessionRef.current.lastTickAt = Date.now();
          }
          schedule(180);
          return;
        }
        const words = readerWordsRef.current;
        if (words.length === 0) {
          prepareReaderWords(true);
          schedule(500);
          return;
        }
        const index = Math.min(activeWordIndexRef.current, words.length - 1);
        const word = words[index];
        const now = Date.now();
        const mode = readingModeRef.current;
        let wpm = speedReadWpmRef.current;
        if (mode === "smart") {
          const calibration = smartCalibrationRef.current;
          const baseWpm = getAdaptiveWpm(
            smartProfileRef.current,
            book.genres,
            getReadingTimeBand(),
            word.difficulty,
            calibration
          );
          wpm = Math.min(
            calibration.maxWpm,
            Math.max(calibration.minWpm, baseWpm * smartPaceBiasRef.current)
          );
          const aheadTarget = smartAheadTargetIndexRef.current;
          if (aheadTarget !== null && index >= aheadTarget - 6) {
            cancelSmartAheadTracking();
            smartPaceBiasRef.current = Math.max(1, smartPaceBiasRef.current * 0.82);
          } else if (aheadTarget === null && smartPaceBiasRef.current > 1) {
            smartPaceBiasRef.current =
              1 + (smartPaceBiasRef.current - 1) * 0.985;
          }
          if (index % 8 === 0) setAdaptiveWpm(Math.round(wpm));
          const session = smartSessionRef.current;
          if (session) {
            session.activeMs += Math.min(2500, Math.max(0, now - session.lastTickAt));
            session.lastTickAt = now;
            session.furthestIndex = Math.max(session.furthestIndex, index);
            session.difficultyTotal += word.difficulty;
            session.difficultySamples += 1;
          }
          positionReaderDotAtWord(index);
        }
        setReadingWord(buildReadingWordState(index));
        scrollWordIntoReadingBand(index);

        if (index >= words.length - 1) {
          finishSmartSession();
          goNextSection();
          setReadingWord(null);
          readingEngineTimerRef.current = window.setTimeout(() => {
            prepareReaderWords(true);
            activeWordIndexRef.current = findNearestWordIndex();
            if (readingModeRef.current === "smart") {
              const startedAt = Date.now();
              smartSessionRef.current = {
                startedAt,
                activeMs: 0,
                lastTickAt: startedAt,
                startIndex: activeWordIndexRef.current,
                furthestIndex: activeWordIndexRef.current,
                difficultyTotal: 0,
                difficultySamples: 0,
                rereads: 0
              };
            }
            schedule(mode === "smart" ? 2200 : 700);
          }, 1100);
          return;
        }

        activeWordIndexRef.current = index + 1;
        const punctuationPause = word.paragraphEnd ? 620 : word.sentenceEnd ? 280 : /[,;:]$/.test(word.trailing.trim()) ? 120 : 0;
        const paceDelay =
          (60000 / Math.max(70, wpm)) *
          (mode === "speed" ? word.rsvpPauseMultiplier : 1);
        schedule(Math.round(paceDelay + punctuationPause));
      }, delay);
    };

    schedule(readingMode === "smart" ? 2400 : 650);
    return () => {
      stopped = true;
      if (readingEngineTimerRef.current) {
        window.clearTimeout(readingEngineTimerRef.current);
        readingEngineTimerRef.current = null;
      }
      if (readingMode === "smart") finishSmartSession();
    };
  }, [readingMode, book.id]);

  const getScrollContainer = (): HTMLElement | null => {
    const cached = scrollContainerRef.current;
    if (cached && cached.isConnected) {
      return cached;
    }
    const manager = renditionRef.current?.manager as any;
    if (manager?.settings?.fullsize) {
      return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
    }
    if (manager?.container) {
      return manager.container as HTMLElement;
    }
    const root = viewerRef.current;
    if (!root) {
      return null;
    }
    const candidate =
      root.querySelector(".epub-container") ||
      root.querySelector(".epub-view");
    if (candidate) {
      return candidate as HTMLElement;
    }
    if (root.scrollHeight > root.clientHeight + 2) {
      return root;
    }
    return null;
  };

  const isSkippableSpine = (item: any) => {
    if (!item) {
      return true;
    }
    if (item.linear === "no") {
      return true;
    }
    const rawProps = item.properties ?? [];
    const props = Array.isArray(rawProps)
      ? rawProps
      : typeof rawProps === "string"
        ? rawProps.split(" ")
        : [];
    if (props.some((prop: string) => ["nav", "cover", "cover-image"].includes(prop))) {
      return true;
    }
    const media = item?.mime ?? item?.mediaType ?? "";
    if (media && !media.includes("xhtml") && !media.includes("html") && !media.includes("svg+xml")) {
      return true;
    }
    return !item.href;
  };

  const getLocationIndex = (href?: string) => {
    const location = renditionRef.current?.location;
    if (typeof location?.start?.index === "number") {
      return location.start.index;
    }
    if (typeof location?.end?.index === "number") {
      return location.end.index;
    }
    if (href && spineIndexByHrefRef.current[href] !== undefined) {
      return spineIndexByHrefRef.current[href];
    }
    return undefined;
  };

  const getSpineIndex = (href?: string) => {
    const location = renditionRef.current?.location;
    const key = href ?? location?.start?.href ?? location?.end?.href;
    return getLocationIndex(key);
  };

  const displaySpine = (startIndex: number, direction: 1 | -1) => {
    const rendition = renditionRef.current;
    const epub = bookRef.current as any;
    const spineItems = epub?.spine?.items;
    if (!rendition || !Array.isArray(spineItems)) {
      return false;
    }
    let index = startIndex;
    while (index >= 0 && index < spineItems.length) {
      const item = spineItems[index];
      if (!isSkippableSpine(item)) {
        void rendition.display(item.href);
        return true;
      }
      index += direction;
    }
    return false;
  };

  const displayNextSpine = (href?: string) => {
    const index = getSpineIndex(href);
    if (typeof index !== "number") {
      return false;
    }
    return displaySpine(index + 1, 1);
  };

  const displayPrevSpine = (href?: string) => {
    const index = getSpineIndex(href);
    if (typeof index !== "number") {
      return false;
    }
    return displaySpine(index - 1, -1);
  };

  const goNextSection = () => {
    const rendition = renditionRef.current;
    const epub = bookRef.current as any;
    const location = rendition?.location;
    const index = location?.start?.index ?? location?.end?.index;
    const href = location?.start?.href ?? location?.end?.href;
    if (href && epub?.spine?.get) {
      const current = epub.spine.get(href);
      const next = current?.next ? current.next() : null;
      if (next?.href) {
        displayChapter(next.href, { useSaved: false });
        return;
      }
    }
    if (typeof index === "number" && displaySpine(index + 1, 1)) {
      return;
    }
    void rendition?.next();
  };

  const goPrevSection = () => {
    const rendition = renditionRef.current;
    const epub = bookRef.current as any;
    const location = rendition?.location;
    const index = location?.start?.index ?? location?.end?.index;
    const href = location?.start?.href ?? location?.end?.href;
    if (href && epub?.spine?.get) {
      const current = epub.spine.get(href);
      const prev = current?.prev ? current.prev() : null;
      if (prev?.href) {
        displayChapter(prev.href, { useSaved: false });
        return;
      }
    }
    if (typeof index === "number" && displaySpine(index - 1, -1)) {
      return;
    }
    void rendition?.prev();
  };

  // no auto-advance listeners in scroll mode

  useEffect(() => {
    try {
      fontSizeRef.current = fontSize;
      sidebarRef.current = sidebarOpen;
      persistReaderState();
    } catch {
      // ignore
    }
  }, [fontSize, sidebarOpen, displayMode, autoScrollSpeed, speedReadWpm, storageKey]);

  useEffect(() => {
    if (!renditionRef.current?.themes?.fontSize) {
      applyReaderTypography();
      return;
    }
    fontSizeRef.current = fontSize;
    applyReaderTypography();
    applyReaderInsets();
    scheduleReaderWordIndex(true);
    persistReaderState();
  }, [fontSize]);

  useEffect(() => {
    readerDotEnabledRef.current = readerDotEnabled;
    if (!readerDotEnabled) {
      removeLastReadMarker();
      return;
    }
    if (readingModeRef.current === "smart") {
      positionReaderDotAtWord(activeWordIndexRef.current);
      return;
    }
    if (readingModeRef.current === "speed") {
      removeLastReadMarker();
      return;
    }
    const location = renditionRef.current?.location;
    const cfi = location?.end?.cfi ?? location?.start?.cfi;
    if (cfi) {
      updateLastReadMarker(cfi);
    }
    scheduleReaderDotUpdate();
  }, [readerDotEnabled]);

  const resolvedCover = coverFallback ?? coverSrc;
  const requestReadingMode = (nextMode: ReadingMode) => {
    if (nextMode === "standard") {
      readerDotUserAnchorUntilRef.current = 0;
      readerDotAnchorIndexRef.current = null;
      if (readerDotOffscreenTimerRef.current) {
        window.clearTimeout(readerDotOffscreenTimerRef.current);
        readerDotOffscreenTimerRef.current = null;
      }
      setPendingReadingMode(null);
      setReadingMode("standard");
      return;
    }
    scheduleReaderWordIndex(true, 0);
    setReadingPaused(true);
    setPendingReadingMode(nextMode);
    setMorePanelOpen(false);
  };

  const beginReadingMode = (
    mode: Exclude<ReadingMode, "standard">,
    source: "dot" | "viewport" | "chapter"
  ) => {
    prepareReaderWords(false);
    const wordCount = readerWordsRef.current.length;
    let startIndex = 0;
    if (source === "dot") {
      startIndex = readerDotAnchorIndexRef.current ?? findNearestWordIndex();
    } else if (source === "viewport") {
      startIndex = findNearestWordIndex();
    }
    startIndex = Math.min(Math.max(0, startIndex), Math.max(0, wordCount - 1));
    requestedStartIndexRef.current = startIndex;
    activeWordIndexRef.current = startIndex;
    readerDotAnchorIndexRef.current = startIndex;
    readerDotUserAnchorUntilRef.current = Date.now() + 5 * 60 * 1000;
    if (readerDotEnabledRef.current && wordCount > 0) {
      positionReaderDotAtWord(startIndex);
    }
    setPendingReadingMode(null);
    setReadingMode(mode);
  };

  const handleCoverError = () => {
    if (coverTriedRef.current) {
      return;
    }
    coverTriedRef.current = true;
    void bookService.coverData(book.id).then((data) => {
      if (data) {
        setCoverFallback(data);
      }
    });
  };
  const isLight = readerTheme === "light";
  const rsvpPivot = readingWord
    ? Math.min(readingWord.text.length - 1, Math.max(0, Math.floor(readingWord.text.length * 0.36)))
    : 0;
  const showFocusToast = (message: string) => {
    setFocusToast(message);
    if (focusToastTimerRef.current) {
      window.clearTimeout(focusToastTimerRef.current);
    }
    focusToastTimerRef.current = window.setTimeout(() => {
      setFocusToast(null);
    }, 2400);
  };

  return (
    <div
      className={`reader-scope fixed inset-0 z-50 h-full w-full overflow-hidden reader-bg ${
        isLight ? "reader-light" : ""
      } ${displayMode === "paper" ? "reader-paper-finish" : ""} ${
        displayMode === "dark-paper" ? "reader-dark-paper-finish" : ""
      } ${
        displayMode === "true-white" ? "reader-true-white-finish" : ""
      } ${
        displayMode === "true-black" ? "reader-true-black-finish" : ""
      } ${
        readingMode === "speed" ? "reader-speed-active" : ""
      }`}
    >
      <header className="reader-toolbar fixed left-0 right-0 top-0 z-50 flex w-full items-center justify-between px-6 py-5 md:px-8 transition-all duration-300">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="group flex items-center gap-2 transition-all reader-icon reader-hover-accent"
            onClick={onClose}
          >
            <span className="material-symbols-outlined transition-transform group-hover:-translate-x-1 reader-accent">
              arrow_back
            </span>
            <span className="text-xs uppercase tracking-widest reader-accent">Back to Library</span>
          </button>
        </div>
        <div className="absolute left-1/2 hidden -translate-x-1/2 flex-col items-center text-center md:flex">
          <h1 className="font-headline text-xl font-bold reader-accent">{book.title}</h1>
          <span className="text-xs uppercase tracking-[0.2em] reader-muted">
            {book.author ?? "Unknown author"}
          </span>
        </div>
        <div className="flex items-center gap-4 md:gap-6">
          <button
            className="reader-icon transition-colors reader-hover-accent"
            type="button"
            onClick={() => setFontPanelOpen((prev) => !prev)}
          >
            <span className="material-symbols-outlined">text_fields</span>
          </button>
          {fontPanelOpen && (
            <div className="flex items-center gap-2 rounded-lg border px-3 py-1 text-xs uppercase tracking-widest reader-panel-soft reader-border">
              <button
                type="button"
                className="rounded-md border px-2 py-1 transition reader-border reader-icon reader-hover-accent"
                onClick={() => setFontSize((size) => Math.max(14, size - 2))}
              >
                A-
              </button>
              <span className="min-w-[40px] text-center">{fontSize}px</span>
              <button
                type="button"
                className="rounded-md border px-2 py-1 transition reader-border reader-icon reader-hover-accent"
                onClick={() => setFontSize((size) => Math.min(32, size + 2))}
              >
                A+
              </button>
            </div>
          )}
          <div className="relative">
            <button
              className="reader-icon transition-colors reader-hover-accent"
              type="button"
              onClick={() => setBookmarkPanelOpen((prev) => !prev)}
            >
              <span className="material-symbols-outlined">bookmark</span>
            </button>
            {bookmarkPanelOpen && (
              <div className="absolute right-0 mt-3 w-64 rounded-xl border p-4 text-xs shadow-2xl reader-panel reader-border">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-widest reader-muted">Bookmarks</span>
                  <button
                    type="button"
                    className="rounded-md border px-2 py-1 text-[10px] uppercase tracking-widest transition reader-border reader-icon reader-hover-accent"
                    onClick={addBookmark}
                  >
                    Add
                  </button>
                </div>
                <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                  {bookmarks.length === 0 && (
                    <div className="rounded-lg border px-3 py-2 text-[11px] reader-border reader-muted reader-pill">
                      No bookmarks yet.
                    </div>
                  )}
                  {bookmarks.map((bookmark) => (
                    <button
                      key={bookmark.id}
                      type="button"
                      className="w-full rounded-lg border px-3 py-2 text-left text-[11px] transition reader-border reader-pill reader-icon reader-hover-accent"
                      onClick={() => openBookmark(bookmark.cfi)}
                    >
                      <div className="text-xs font-semibold reader-text-color">{bookmark.label}</div>
                      <div className="text-[10px] uppercase tracking-widest reader-muted">
                        {new Date(bookmark.createdAt).toLocaleDateString()}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div
            className="relative"
            ref={morePanelRef}
            onMouseEnter={() => {
              if (morePanelCloseRef.current) {
                window.clearTimeout(morePanelCloseRef.current);
                morePanelCloseRef.current = null;
              }
              setMorePanelOpen(true);
            }}
            onMouseLeave={() => {
              if (morePanelCloseRef.current) {
                window.clearTimeout(morePanelCloseRef.current);
              }
              morePanelCloseRef.current = window.setTimeout(() => {
                setMorePanelOpen(false);
              }, 180);
            }}
          >
            <button
              className="reader-icon transition-colors reader-hover-accent"
              type="button"
              onClick={() => setMorePanelOpen((prev) => !prev)}
            >
              <span className="material-symbols-outlined">more_horiz</span>
            </button>
            {morePanelOpen && (
              <div
                className="absolute right-0 mt-3 w-72 rounded-xl border p-4 text-xs shadow-2xl reader-panel reader-border"
                onMouseEnter={() => {
                  if (morePanelCloseRef.current) {
                    window.clearTimeout(morePanelCloseRef.current);
                    morePanelCloseRef.current = null;
                  }
                }}
                onMouseLeave={() => {
                  if (morePanelCloseRef.current) {
                    window.clearTimeout(morePanelCloseRef.current);
                  }
                  morePanelCloseRef.current = window.setTimeout(() => {
                    setMorePanelOpen(false);
                  }, 180);
                }}
              >
                <div className="text-xs uppercase tracking-widest reader-muted">Reader</div>
                <label className="mt-3 block">
                  <span className="text-[10px] uppercase tracking-widest reader-muted">Page finish</span>
                  <select
                    className="reader-select mt-1.5 w-full"
                    value={displayMode}
                    onChange={(event) => setDisplayMode(event.target.value as ReaderDisplayMode)}
                  >
                    <option value="paper">Warm paper</option>
                    <option value="dark-paper">Dark paper</option>
                    <option value="true-white">True white</option>
                    <option value="true-black">True black</option>
                    <option value="app">Match app theme</option>
                  </select>
                </label>
                <label className="mt-3 block">
                  <span className="text-[10px] uppercase tracking-widest reader-muted">Reading mode</span>
                  <select
                    className="reader-select mt-1.5 w-full"
                    value={readingMode}
                    onChange={(event) => requestReadingMode(event.target.value as ReadingMode)}
                  >
                    <option value="standard">Standard</option>
                    <option value="smart">Smart Read</option>
                    <option value="speed">SpeedRead (RSVP)</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition reader-border reader-pill reader-icon"
                  onClick={toggleTheme}
                >
                  <span>App theme</span>
                  <span className="reader-toggle" data-on={readerTheme === "light"} />
                </button>
                {readingMode === "standard" && (
                <div className="mt-3 rounded-lg border px-3 py-2 reader-border reader-pill">
                  <div className="text-[10px] uppercase tracking-widest reader-muted">Auto scroll</div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded-full border transition reader-border reader-icon reader-hover-accent"
                      onClick={() => setAutoScrollActive((prev) => !prev)}
                      title={autoScrollActive ? "Pause auto scroll" : "Start auto scroll"}
                    >
                      <span className="material-symbols-outlined text-sm">
                        {autoScrollActive ? "pause" : "play_arrow"}
                      </span>
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={autoScrollSpeed}
                      onChange={(event) => setAutoScrollSpeed(Number(event.target.value))}
                      className="h-1 w-24 cursor-pointer accent-current"
                      title={`Auto scroll speed ${Math.round(3 + autoScrollSpeed * 0.45)} pixels per second`}
                    />
                    <span className="ml-auto tabular-nums reader-muted">
                      {Math.round(3 + autoScrollSpeed * 0.45)} px/s
                    </span>
                  </div>
                </div>
                )}
                {readingMode === "smart" && (
                  <div className="mt-3 rounded-lg border px-3 py-3 reader-border reader-pill">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[10px] uppercase tracking-widest reader-muted">Adaptive pace</div>
                        <div className="mt-1 text-sm font-semibold reader-text-color">~{adaptiveWpm} WPM</div>
                      </div>
                      <button
                        type="button"
                        className="reader-mini-control"
                        onClick={() => setReadingPaused((paused) => !paused)}
                      >
                        <span className="material-symbols-outlined text-base">
                          {readingPaused ? "play_arrow" : "pause"}
                        </span>
                      </button>
                    </div>
                    <p className="mt-2 text-[10px] leading-relaxed reader-muted">
                      Learns from page timing, pauses, rereading, genre, time of day and word difficulty.
                    </p>
                  </div>
                )}
                {readingMode === "speed" && (
                  <div className="mt-3 rounded-lg border px-3 py-3 reader-border reader-pill">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] uppercase tracking-widest reader-muted">RSVP speed</div>
                      <button
                        type="button"
                        className="reader-mini-control"
                        onClick={() => setReadingPaused((paused) => !paused)}
                      >
                        <span className="material-symbols-outlined text-base">
                          {readingPaused ? "play_arrow" : "pause"}
                        </span>
                      </button>
                    </div>
                    <input
                      type="range"
                      min={120}
                      max={1000}
                      step={10}
                      value={speedReadWpm}
                      onChange={(event) => setSpeedReadWpm(Number(event.target.value))}
                      className="mt-3 h-1 w-full cursor-pointer accent-current"
                      title={`SpeedRead ${speedReadWpm} words per minute`}
                    />
                    <div className="mt-2 text-right text-[10px] tabular-nums reader-muted">{speedReadWpm} WPM</div>
                    <p className="mt-2 text-[10px] leading-relaxed reader-muted">
                      Timing automatically eases for uncommon, technical and unfamiliar words.
                    </p>
                  </div>
                )}
                <button
                  type="button"
                  className="mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition reader-border reader-pill reader-icon"
                  onClick={() => setReaderDotEnabled((prev) => !prev)}
                >
                  <span>Dotty</span>
                  <span className="reader-toggle" data-on={readerDotEnabled} />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="reader-shell">
        <div
          className="reader-sidebar-hot-zone"
          onMouseEnter={scheduleReaderSidebarOpen}
          onMouseLeave={cancelReaderSidebarOpen}
          aria-hidden="true"
        />
        <aside
          aria-hidden={!sidebarOpen}
          onMouseEnter={openReaderSidebar}
          onMouseLeave={scheduleReaderSidebarClose}
          onFocus={openReaderSidebar}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              scheduleReaderSidebarClose();
            }
          }}
          className={`reader-sidebar leather-surface hidden w-72 flex-col border-r px-6 py-6 text-sm md:flex reader-border ${
            sidebarOpen
              ? "reader-sidebar-open"
              : "reader-sidebar-closed pointer-events-none"
          }`}
        >
          <div className="mb-6">
            <div>
            {resolvedCover && (
              <div className="book-cover-frame mb-4 h-44 w-32 overflow-hidden border reader-border">
                <img src={resolvedCover} alt={book.title} className="h-full w-full object-cover" onError={handleCoverError} />
              </div>
            )}
            <h2 className="font-headline text-lg font-bold reader-text-color">{book.title}</h2>
            <p className="text-xs uppercase tracking-[0.2em] reader-muted">
              {book.author ?? "Unknown author"}
            </p>
            </div>
          </div>
          <div className="text-xs uppercase tracking-[0.3em] reader-muted">Chapters</div>
          <div className="mt-4 flex-1 overflow-y-auto pr-2">
            {toc.length === 0 && (
              <div className="text-xs reader-muted">
                {loading ? "Loading chapters..." : "No chapters found."}
              </div>
            )}
            {toc.map((item) => {
              const active = currentHref ? item.href === currentHref : false;
              return (
              <button
                key={`${item.href}-${item.label}`}
                type="button"
                className={`reader-chapter-link mb-2 w-full rounded-lg px-3 py-2 text-left text-sm transition reader-icon ${
                  active ? "reader-chapter-active font-semibold" : ""
                }`}
                onClick={() => {
                  displayChapter(item.href, { useSaved: false });
                  setSidebarOpen(false);
                }}
              >
                <span>{item.label}</span>
              </button>
              );
            })}
          </div>
        </aside>

        <main className="reader-main overflow-hidden">
          {loadError && (
            <div className="mx-auto mt-24 max-w-2xl rounded-xl border reader-border reader-panel p-6 text-center reader-muted">
              {loadError}
            </div>
          )}
          {!loadError && (
            <div className="reader-page-frame relative h-full overflow-hidden">
              {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center text-sm reader-panel-soft reader-muted">
                  Loading book...
                </div>
              )}
              <div
                ref={viewerRef}
                className="reader-container reader-scroll h-full w-full overflow-hidden overscroll-x-none"
              />
              {readingMode === "speed" && readingWord && (
                <div className="reader-speedread-overlay pointer-events-none absolute inset-0 z-20">
                  <div className="reader-rsvp-word absolute left-1/2 top-[10%] -translate-x-1/2" aria-hidden="true">
                    <span>{readingWord.text.slice(0, rsvpPivot)}</span>
                    <span className="reader-rsvp-focus">{readingWord.text[rsvpPivot]}</span>
                    <span>{readingWord.text.slice(rsvpPivot + 1)}</span>
                  </div>
                  <div
                    key={readingWord.contextStart}
                    className="reader-rsvp-context absolute bottom-20 left-1/2 w-[min(820px,76vw)] -translate-x-1/2"
                  >
                    {readingWord.context.map((word) => (
                      <span
                        key={`${word.index}-${word.text}`}
                        className={word.index === readingWord.index ? "reader-rsvp-current" : ""}
                      >
                        {word.text}
                        {word.trailing || " "}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="reader-chapter-dock pointer-events-none absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center">
                <div className="pointer-events-auto flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs uppercase tracking-widest reader-pill reader-border">
                  <button
                    type="button"
                    className="reader-mini-control"
                    onClick={goPrevSection}
                    title="Previous chapter"
                  >
                    <span className="material-symbols-outlined text-base">chevron_left</span>
                  </button>
                  <span className="text-[10px] reader-muted">
                    {formatChapterDisplay()}
                  </span>
                  <button
                    type="button"
                    className="reader-mini-control"
                    onClick={goNextSection}
                    title="Next chapter"
                  >
                    <span className="material-symbols-outlined text-base">chevron_right</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {pendingReadingMode && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-6">
          <div className="reader-panel reader-border w-full max-w-md rounded-2xl border p-6 shadow-2xl">
            <div className="text-[10px] uppercase tracking-[0.22em] reader-muted">
              {pendingReadingMode === "speed" ? "SpeedRead" : "Smart Read"}
            </div>
            <h2 className="mt-2 font-headline text-xl font-bold reader-text-color">
              Where should reading begin?
            </h2>
            <p className="mt-2 text-sm leading-relaxed reader-muted">
              Drag Dotty beside any line, then start from that exact position.
            </p>
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                className="reader-start-choice reader-start-choice-primary"
                onClick={() => beginReadingMode(pendingReadingMode, "dot")}
              >
                <span className="material-symbols-outlined">adjust</span>
                <span>
                  <strong>Start at Dotty</strong>
                  <small>Use the line currently marked in the book</small>
                </span>
              </button>
              <button
                type="button"
                className="reader-start-choice"
                onClick={() => beginReadingMode(pendingReadingMode, "viewport")}
              >
                <span className="material-symbols-outlined">center_focus_strong</span>
                <span>
                  <strong>Start at current view</strong>
                  <small>Use the line near the centre of the page</small>
                </span>
              </button>
              <button
                type="button"
                className="reader-start-choice"
                onClick={() => beginReadingMode(pendingReadingMode, "chapter")}
              >
                <span className="material-symbols-outlined">first_page</span>
                <span>
                  <strong>Start at chapter beginning</strong>
                  <small>Begin from the first indexed word</small>
                </span>
              </button>
            </div>
            <button
              type="button"
              className="reader-start-cancel mt-4 w-full py-2 text-xs uppercase tracking-widest reader-muted transition"
              onClick={() => {
                setPendingReadingMode(null);
                setReadingPaused(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {activeSession && (
        <div className={`leaflet-mug ${coffeeProgress >= 0.99 ? "leaflet-mug-done" : ""}`}>
          <div className="leaflet-mug-cup">
            <div
              className="leaflet-mug-coffee"
              style={{ height: `${Math.min(100, Math.round(coffeeProgress * 100))}%` }}
            />
            <div className="leaflet-mug-handle" />
          </div>
          {coffeeProgress > 0.2 && (
            <div className="leaflet-mug-steam" />
          )}
          {coffeeProgress > 0.5 && (
            <div className="leaflet-mug-steam" />
          )}
          {coffeeProgress > 0.75 && (
            <div className="leaflet-mug-steam" />
          )}
        </div>
      )}

      {checkpointOpen && checkpointLevel && (
        <div className="fixed bottom-6 right-6 z-[70] w-full max-w-xs">
          <div
            className="rounded-xl border p-4 text-left shadow-2xl reader-panel reader-border"
            onMouseEnter={() => {
              if (checkpointTimerRef.current) {
                window.clearTimeout(checkpointTimerRef.current);
                checkpointTimerRef.current = null;
              }
            }}
            onMouseLeave={() => {
              if (!checkpointTimerRef.current) {
                checkpointTimerRef.current = window.setTimeout(() => {
                  setCheckpointOpen(false);
                }, 6000);
              }
            }}
          >
            <div className="text-[10px] uppercase tracking-widest reader-muted">Focus Checkpoint</div>
            <h3 className="mt-2 text-sm font-headline font-bold reader-text-color">
              {checkpointLevel === 0.5
                ? "Halfway There"
                : checkpointLevel === 0.9
                  ? "Almost Done"
                  : "Session Complete"}
            </h3>
            <p className="mt-1 text-xs reader-muted">
              {checkpointLevel === 1
                ? "Great session. Continue or end and save your progress."
                : "Nice work. Keep the momentum going."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {checkpointLevel === 1 && (
                <button
                  type="button"
                  className="rounded-md border px-3 py-1 text-[10px] uppercase tracking-widest transition reader-border reader-icon reader-hover-accent"
                  onClick={handleCheckpointContinue}
                >
                  Continue +10 min
                </button>
              )}
              {checkpointLevel === 1 ? (
                <button
                  type="button"
                  className="rounded-md bg-primary px-3 py-1 text-[10px] font-semibold text-on-primary"
                  onClick={handleCheckpointEnd}
                >
                  End Session
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-md border px-3 py-1 text-[10px] uppercase tracking-widest transition reader-border reader-icon reader-hover-accent"
                  onClick={() => {
                    if (checkpointTimerRef.current) {
                      window.clearTimeout(checkpointTimerRef.current);
                      checkpointTimerRef.current = null;
                    }
                    setCheckpointOpen(false);
                  }}
                >
                  Keep Reading
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {focusToast && (
        <div className="fixed bottom-6 right-6 z-[60]">
          <div className="rounded-full border px-4 py-2 text-[10px] uppercase tracking-widest shadow-xl reader-panel reader-border reader-muted">
            {focusToast}
          </div>
        </div>
      )}

      {noteModalOpen && noteSessionId && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-6">
          <div className="w-full max-w-sm rounded-xl border p-6 reader-panel reader-border">
            <div className="text-xs uppercase tracking-widest reader-muted">Session Notes</div>
            <h3 className="mt-2 text-lg font-headline font-bold reader-text-color">Add a quick note</h3>
            <textarea
              className="mt-4 h-28 w-full resize-none rounded-xl border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
              placeholder="What did you read or learn?"
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
            />
            <div className="mt-5 flex items-center justify-between">
              <button
                type="button"
                className="rounded-md border px-4 py-2 text-xs uppercase tracking-widest transition reader-border reader-icon reader-hover-accent"
                onClick={() => {
                  setNoteModalOpen(false);
                  setNoteSessionId(null);
                  setNoteText("");
                }}
              >
                Skip
              </button>
              <button
                type="button"
                className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-on-primary"
                onClick={() => {
                  if (noteText.trim()) {
                    addSessionNote(noteSessionId, noteText.trim());
                  }
                  setNoteModalOpen(false);
                  setNoteSessionId(null);
                  setNoteText("");
                }}
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
