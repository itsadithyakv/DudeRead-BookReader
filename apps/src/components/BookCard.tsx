import { convertFileSrc } from "@tauri-apps/api/core";
import type { Book } from "@shared/models/book";

type Props = {
  book: Book;
  onRefresh: (id: string) => void;
  onOpen: (book: Book) => void;
};

export const BookCard = ({ book, onRefresh, onOpen }: Props) => {
  const coverSrc = book.coverUrl ? convertFileSrc(book.coverUrl) : null;

  return (
    <article
      onClick={() => onOpen(book)}
      className="flex h-full w-full flex-col gap-3 rounded-3xl border border-white/5 bg-graphite-850/80 p-0 text-left shadow-glow cursor-pointer"
    >
      <div className="relative h-44 w-full overflow-hidden rounded-t-3xl bg-gradient-to-br from-white/5 to-transparent">
        {coverSrc ? (
          <img src={coverSrc} alt={book.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-pink-400/30 via-purple-400/20 to-sky-400/30 text-xs text-white/70">
            No cover
          </div>
        )}
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-white">{book.title}</p>
        <p className="text-xs text-white/60">{book.author ?? "Unknown author"}</p>
      </div>
      <div>
        <div className="h-1.5 w-full rounded-full bg-white/10">
          <div
            className="h-1.5 rounded-full bg-gradient-to-r from-pink-400 via-purple-400 to-sky-400"
            style={{ width: `${Math.min(100, Math.max(0, book.progress * 100))}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-white/50">
          <span>{Math.round(book.progress * 100)}% read</span>
          <button
            className="text-white/70 hover:text-white"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRefresh(book.id);
            }}
          >
            Refresh metadata
          </button>
        </div>
      </div>
    </article>
  );
};
