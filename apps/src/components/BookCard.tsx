import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { Book } from "@shared/models/book";
import { bookService } from "../services/bookService";

type Props = {
  book: Book;
  onRefresh: (id: string) => void;
  onOpen: (book: Book) => void;
};

export const BookCard = ({ book, onRefresh, onOpen }: Props) => {
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);
  const triedFallback = useRef(false);

  const coverSrc = book.coverUrl
    ? isTauri()
      ? convertFileSrc(book.coverUrl)
      : book.coverUrl.startsWith("http")
        ? book.coverUrl
        : null
    : null;

  useEffect(() => {
    triedFallback.current = false;
    setFallbackSrc(null);
  }, [book.id, book.coverUrl]);

  const handleCoverError = () => {
    if (triedFallback.current) {
      return;
    }
    triedFallback.current = true;
    void bookService.coverData(book.id).then((data) => {
      if (data) {
        setFallbackSrc(data);
      }
    });
  };

  const resolvedCover = fallbackSrc ?? coverSrc;
  const progressPercent = Math.round(Math.min(1, Math.max(0, book.progress)) * 100);
  const isFinished = progressPercent >= 100;

  return (
    <article
      onClick={() => onOpen(book)}
      className="group flex h-full w-full cursor-pointer flex-col text-left"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl shadow-2xl transition-transform group-hover:-translate-y-2">
        {resolvedCover ? (
          <img src={resolvedCover} alt={book.title} className="h-full w-full object-cover" onError={handleCoverError} />
        ) : (
          <div className="flex h-full items-center justify-center bg-surface-container-high text-xs text-on-surface-variant">
            No cover yet
          </div>
        )}
        <div className="absolute inset-0 flex items-end bg-black/70 p-4 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            className="w-full rounded-lg bg-white/20 py-2 text-sm font-bold text-white backdrop-blur-md"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(book);
            }}
          >
            Resume Reading
          </button>
        </div>
      </div>
      <div className="flex-1 pt-4">
        <p className="truncate font-headline text-base font-bold text-on-surface">{book.title}</p>
        <p className="text-xs text-on-surface-variant">{book.author ?? "Unknown author"}</p>
      </div>
      <div>
        <div className="h-1.5 w-full rounded-full bg-surface-container-highest">
          <div
            className={`h-1.5 rounded-full ${isFinished ? "bg-tertiary" : "bg-primary"} shadow-[0_0_8px_rgba(106,183,255,0.6)]`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p className={`mt-2 text-right text-[10px] font-bold uppercase tracking-tighter ${isFinished ? "text-tertiary" : "text-on-surface-variant"}`}>
          {isFinished ? "Finished" : `${progressPercent}%`}
        </p>
      </div>
    </article>
  );
};
