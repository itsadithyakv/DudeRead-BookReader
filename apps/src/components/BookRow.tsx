import { convertFileSrc } from "@tauri-apps/api/core";
import type { Book } from "@shared/models/book";

type Props = {
  book: Book;
  onRefresh: (id: string) => void;
  onOpen: (book: Book) => void;
};

export const BookRow = ({ book, onRefresh, onOpen }: Props) => {
  const coverSrc = book.coverUrl ? convertFileSrc(book.coverUrl) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(book)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(book)}
      className="flex cursor-pointer items-center gap-4 rounded-2xl border border-white/5 bg-graphite-850/80 p-3 shadow-glow"
    >
      <div className="h-16 w-12 overflow-hidden rounded-xl bg-white/5">
        {coverSrc ? (
          <img src={coverSrc} alt={book.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-white/60">No cover</div>
        )}
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-white">{book.title}</p>
        <p className="text-xs text-white/60">{book.author ?? "Unknown author"}</p>
      </div>
      <div className="w-32">
        <div className="h-1.5 w-full rounded-full bg-white/10">
          <div
            className="h-1.5 rounded-full bg-gradient-to-r from-pink-400 via-purple-400 to-sky-400"
            style={{ width: `${Math.min(100, Math.max(0, book.progress * 100))}%` }}
          />
        </div>
      </div>
      <button
        className="text-xs text-white/60 hover:text-white"
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRefresh(book.id);
        }}
      >
        Refresh
      </button>
    </div>
  );
};
