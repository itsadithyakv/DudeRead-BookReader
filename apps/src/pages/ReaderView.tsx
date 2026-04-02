import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import type { Book } from "@shared/models/book";
import ePub from "epubjs";
import { bookService } from "../services/bookService";

type ReaderViewProps = {
  book: Book;
  onClose: () => void;
};

type Mode = "scroll" | "flip";

type TocItem = {
  id?: string;
  label: string;
  href: string;
  subitems?: TocItem[];
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

export const ReaderView = ({ book, onClose }: ReaderViewProps) => {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<any>(null);
  const bookRef = useRef<ReturnType<typeof ePub> | null>(null);
  const relocateHandlerRef = useRef<((location: { start?: { percentage?: number } }) => void) | null>(null);
  const lastProgressRef = useRef(0);
  const lastProgressAtRef = useRef(0);
  const nextChapterAtRef = useRef(0);
  const scrollHandlerRef = useRef<((event: Event) => void) | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const storageKey = useMemo(() => `dudereader.reader.${book.id}`, [book.id]);
  const readPrefs = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as {
        mode?: Mode;
        fontSize?: number;
        sidebarOpen?: boolean;
        cfi?: string;
      };
    } catch {
      return null;
    }
  };

  const initialPrefs = readPrefs();
  const [mode, setMode] = useState<Mode>(initialPrefs?.mode ?? "scroll");
  const [sidebarOpen, setSidebarOpen] = useState(initialPrefs?.sidebarOpen ?? true);
  const [fontSize, setFontSize] = useState(initialPrefs?.fontSize ?? 18);
  const modeRef = useRef<Mode>(mode);
  const fontSizeRef = useRef(fontSize);
  const sidebarRef = useRef(sidebarOpen);
  const [fontPanelOpen, setFontPanelOpen] = useState(false);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastCfiRef = useRef<string | null>(initialPrefs?.cfi ?? null);

  const coverSrc = useMemo(() => {
    if (!book.coverUrl) {
      return null;
    }
    if (isTauri()) {
      return convertFileSrc(book.coverUrl);
    }
    return book.coverUrl.startsWith("http") ? book.coverUrl : null;
  }, [book.coverUrl]);

  const [coverFallback, setCoverFallback] = useState<string | null>(null);
  const coverTriedRef = useRef(false);

  useEffect(() => {
    coverTriedRef.current = false;
    setCoverFallback(null);
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

    const ext = localPath.split(".").pop()?.toLowerCase();
    if (ext !== "epub") {
      setLoadError("This reader currently supports EPUB files only.");
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        const source = isTauri() ? convertFileSrc(localPath) : localPath;
        let buffer: ArrayBuffer;
        try {
          const response = await fetch(source);
          if (!response.ok) {
            throw new Error("fetch failed");
          }
          buffer = await response.arrayBuffer();
        } catch {
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
        }

        if (bookRef.current) {
          bookRef.current.destroy();
          bookRef.current = null;
        }

        const epub = ePub(buffer);
        bookRef.current = epub;

        if (!viewerRef.current) {
          throw new Error("Reader container not ready.");
        }

        const rendition = epub.renderTo(viewerRef.current, {
          width: "100%",
          height: "100%"
        });
        renditionRef.current = rendition;

        rendition.themes.register("dudereader-dark", {
          html: {
            background: "#000000",
            color: "#ffffff",
            overflowX: "hidden"
          },
          body: {
            background: "#000000",
            color: "#ffffff",
            lineHeight: "1.8",
            fontFamily: "'Noto Serif', serif",
            margin: "0",
            padding: "0 1rem",
            maxWidth: "100%",
            overflowX: "hidden"
          },
          img: {
            maxWidth: "100%",
            height: "auto"
          },
          pre: {
            whiteSpace: "pre-wrap",
            wordBreak: "break-word"
          },
          p: {
            margin: "0 0 1.4em 0"
          }
        });
        rendition.themes.select("dudereader-dark");
        if (rendition.themes?.fontSize) {
          rendition.themes.fontSize(`${fontSize}px`);
        }
        rendition.flow(mode === "scroll" ? "scrolled-doc" : "paginated");

        const navigation = await epub.loaded.navigation;
        setToc(flattenToc(navigation.toc));

        const onRelocated = (location: any) => {
          const percentage = location?.start?.percentage ?? 0;
          const now = Date.now();

          if (location?.start?.cfi) {
            lastCfiRef.current = location.start.cfi;
            try {
              localStorage.setItem(
                storageKey,
                JSON.stringify({
                  mode: modeRef.current,
                  fontSize: fontSizeRef.current,
                  sidebarOpen: sidebarRef.current,
                  cfi: location.start.cfi
                })
              );
            } catch {
              // ignore storage errors
            }
          }

          if (modeRef.current === "scroll") {
            const end = location?.end;
            const endPage = end?.displayed?.page ?? 0;
            const endTotal = end?.displayed?.total ?? 0;
            const endIsFinalPage = endTotal > 0 && endPage >= endTotal;
            if (endIsFinalPage && now - nextChapterAtRef.current > 1200) {
              nextChapterAtRef.current = now;
              goNextSection();
            } else {
              advanceIfNearEnd();
            }
          }

          const shouldUpdateProgress =
            Math.abs(percentage - lastProgressRef.current) >= 0.005 ||
            now - lastProgressAtRef.current >= 10000;

          if (shouldUpdateProgress) {
            lastProgressRef.current = percentage;
            lastProgressAtRef.current = now;
            void bookService.updateProgress(book.id, percentage);
          }
        };
        relocateHandlerRef.current = onRelocated;
        rendition.on("relocated", onRelocated);

        if (lastCfiRef.current) {
          await rendition.display(lastCfiRef.current);
        } else {
          await rendition.display();
        }
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
    if (!renditionRef.current) {
      return;
    }
    renditionRef.current.flow(mode === "scroll" ? "scrolled-doc" : "paginated");
    void renditionRef.current.display();
  }, [mode]);

  const getScrollContainer = () => {
    const manager = renditionRef.current?.manager as any;
    if (manager?.settings?.fullsize) {
      return document.scrollingElement ?? document.documentElement;
    }
    if (manager?.container) {
      return manager.container as HTMLElement;
    }
    const root = viewerRef.current;
    if (!root) {
      return null;
    }
    const candidates = [
      root,
      root.querySelector(".epub-container"),
      root.querySelector(".epub-view")
    ].filter(Boolean) as HTMLElement[];

    for (const candidate of candidates) {
      const el = candidate as HTMLElement;
      if (el.scrollHeight > el.clientHeight + 2) {
        return el;
      }
    }

    return root;
  };

  const goNextSection = () => {
    const rendition = renditionRef.current;
    const epub = bookRef.current as any;
    const location = rendition?.location;
    const index = location?.start?.index ?? location?.end?.index;
    const spineItems = epub?.spine?.items;
    if (Array.isArray(spineItems) && typeof index === "number") {
      const next = spineItems[index + 1];
      if (next?.href) {
        void rendition.display(next.href);
        return;
      }
    }
    void rendition?.next();
  };

  const advanceIfNearEnd = () => {
    if (!renditionRef.current || modeRef.current !== "scroll") {
      return;
    }
    const now = Date.now();
    if (now - nextChapterAtRef.current < 1200) {
      return;
    }

    const container = getScrollContainer();
    if (!container) {
      return;
    }

    const scrollTop = container.scrollTop;
    const clientHeight = container.clientHeight;
    const scrollHeight = container.scrollHeight;
    if (scrollHeight > 0 && scrollTop + clientHeight >= scrollHeight - 8) {
      nextChapterAtRef.current = now;
      goNextSection();
      return;
    }

    const iframe = viewerRef.current?.querySelector("iframe");
    const win = iframe?.contentWindow;
    const doc = iframe?.contentDocument;
    if (win && doc) {
      const iframeScrollTop = win.scrollY ?? doc.documentElement.scrollTop ?? doc.body.scrollTop ?? 0;
      const iframeClient = doc.documentElement.clientHeight ?? win.innerHeight ?? 0;
      const iframeHeight = doc.documentElement.scrollHeight ?? doc.body.scrollHeight ?? 0;
      if (iframeHeight > 0 && iframeScrollTop + iframeClient >= iframeHeight - 8) {
        nextChapterAtRef.current = now;
        goNextSection();
      }
    }
  };

  useEffect(() => {
    if (!renditionRef.current || mode !== "scroll") {
      return;
    }

    const handler = () => {
      advanceIfNearEnd();
    };

    const attachIframe = () => {
      const iframe = viewerRef.current?.querySelector("iframe");
      const win = iframe?.contentWindow;
      if (win) {
        win.addEventListener("scroll", handler, { passive: true });
      }
      return win;
    };

    const scrollContainer = getScrollContainer();
    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", handler, { passive: true });
    }
    let win = attachIframe();

    const onRendered = () => {
      if (win) {
        win.removeEventListener("scroll", handler);
      }
      win = attachIframe();
      advanceIfNearEnd();
    };

    const manager = renditionRef.current?.manager as any;
    manager?.on?.("scrolled", handler);

    renditionRef.current.on("rendered", onRendered);
    return () => {
      if (scrollContainer) {
        scrollContainer.removeEventListener("scroll", handler);
      }
      if (win) {
        win.removeEventListener("scroll", handler);
      }
      manager?.off?.("scrolled", handler);
      renditionRef.current.off("rendered", onRendered);
    };
  }, [mode]);

  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          mode,
          fontSize,
          sidebarOpen,
          cfi: lastCfiRef.current ?? undefined
        })
      );
    } catch {
      // ignore
    }
  }, [mode, fontSize, sidebarOpen, storageKey]);

  useEffect(() => {
    if (!renditionRef.current?.themes?.fontSize) {
      return;
    }
    renditionRef.current.themes.fontSize(`${fontSize}px`);
  }, [fontSize]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    fontSizeRef.current = fontSize;
  }, [fontSize]);

  useEffect(() => {
    sidebarRef.current = sidebarOpen;
  }, [sidebarOpen]);

  const resolvedCover = coverFallback ?? coverSrc;
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

  return (
    <div className="fixed inset-0 z-50 h-full w-full overflow-hidden bg-black text-white">
      <header className="fixed left-0 right-0 top-0 z-50 flex w-full items-center justify-between bg-black/90 px-6 py-6 md:px-8">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white/70 transition hover:text-white"
            onClick={() => setSidebarOpen((prev) => !prev)}
          >
            <span className="material-symbols-outlined">
              {sidebarOpen ? "dock_to_left" : "dock_to_right"}
            </span>
          </button>
          <button
            type="button"
            className="group flex items-center gap-2 text-white/70 transition-all hover:text-white"
            onClick={onClose}
          >
            <span className="material-symbols-outlined text-primary transition-transform group-hover:-translate-x-1">
              arrow_back
            </span>
            <span className="text-xs uppercase tracking-widest group-hover:text-primary">Back to Library</span>
          </button>
        </div>
        <div className="absolute left-1/2 hidden -translate-x-1/2 flex-col items-center text-center md:flex">
          <h1 className="text-glow font-headline text-xl font-bold text-primary">{book.title}</h1>
          <span className="text-xs uppercase tracking-[0.2em] text-white/60">
            {book.author ?? "Unknown author"}
          </span>
        </div>
        <div className="flex items-center gap-4 md:gap-6">
          <button
            className="text-white/70 transition-colors hover:text-primary"
            type="button"
            onClick={() => setFontPanelOpen((prev) => !prev)}
          >
            <span className="material-symbols-outlined">text_fields</span>
          </button>
          {fontPanelOpen && (
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3 py-1 text-xs uppercase tracking-widest text-white/70">
              <button
                type="button"
                className="rounded-full border border-white/20 px-2 py-1 text-white/80 transition hover:text-white"
                onClick={() => setFontSize((size) => Math.max(14, size - 2))}
              >
                A-
              </button>
              <span className="min-w-[40px] text-center">{fontSize}px</span>
              <button
                type="button"
                className="rounded-full border border-white/20 px-2 py-1 text-white/80 transition hover:text-white"
                onClick={() => setFontSize((size) => Math.min(32, size + 2))}
              >
                A+
              </button>
            </div>
          )}
          <button className="text-white/70 transition-colors hover:text-primary" type="button">
            <span className="material-symbols-outlined">bookmark</span>
          </button>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs uppercase tracking-widest text-white/70">
            <button
              type="button"
              className={`rounded-full px-3 py-1 transition ${mode === "scroll" ? "bg-white text-black" : ""}`}
              onClick={() => setMode("scroll")}
            >
              Scroll
            </button>
            <button
              type="button"
              className={`rounded-full px-3 py-1 transition ${mode === "flip" ? "bg-white text-black" : ""}`}
              onClick={() => setMode("flip")}
            >
              Flip
            </button>
          </div>
        </div>
      </header>

      <div className="flex h-full pt-24">
        <aside
          className={`hidden flex-col border-r border-white/10 bg-black/60 text-sm text-white/80 transition-all duration-200 md:flex ${
            sidebarOpen ? "w-72 px-6 py-6" : "w-0 overflow-hidden px-0 py-0 border-transparent"
          }`}
        >
          <div className="mb-6">
            {resolvedCover && (
              <div className="mb-4 h-44 w-32 overflow-hidden rounded-xl border border-white/10">
                <img src={resolvedCover} alt={book.title} className="h-full w-full object-cover" onError={handleCoverError} />
              </div>
            )}
            <h2 className="font-headline text-lg font-bold text-white">{book.title}</h2>
            <p className="text-xs uppercase tracking-[0.2em] text-white/50">
              {book.author ?? "Unknown author"}
            </p>
          </div>
          <div className="text-xs uppercase tracking-[0.3em] text-white/40">Chapters</div>
          <div className="mt-4 flex-1 overflow-y-auto pr-2">
            {toc.length === 0 && (
              <div className="text-xs text-white/40">
                {loading ? "Loading chapters..." : "No chapters found."}
              </div>
            )}
            {toc.map((item) => (
              <button
                key={`${item.href}-${item.label}`}
                type="button"
                className="mb-2 w-full rounded-lg px-3 py-2 text-left text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
                onClick={() => renditionRef.current?.display(item.href)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </aside>

        <main className={`flex-1 overflow-hidden ${sidebarOpen ? "" : "px-0"}`}>
          {loadError && (
            <div className="mx-auto mt-24 max-w-2xl rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-white/70">
              {loadError}
            </div>
          )}
          {!loadError && (
            <div className="relative h-full">
              {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 text-sm text-white/60">
                  Loading book...
                </div>
              )}
              <div
                ref={viewerRef}
                className={`h-full w-full overflow-y-auto overflow-x-hidden pb-16 ${
                  sidebarOpen ? "px-6 md:px-12" : "px-4 md:px-16"
                }`}
              />
              {mode === "flip" && (
                <div className="pointer-events-none absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-4 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-xs uppercase tracking-widest text-white/60">
                  <button
                    type="button"
                    className="pointer-events-auto rounded-full border border-white/20 px-3 py-1 text-white/80 transition hover:text-white"
                    onClick={() => renditionRef.current?.prev()}
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    className="pointer-events-auto rounded-full border border-white/20 px-3 py-1 text-white/80 transition hover:text-white"
                    onClick={() => renditionRef.current?.next()}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
