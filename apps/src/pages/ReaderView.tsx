import { useEffect } from "react";
import type { Book } from "@shared/models/book";

type ReaderViewProps = {
  book: Book;
  onClose: () => void;
};

export const ReaderView = ({ book, onClose }: ReaderViewProps) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex h-full w-full flex-col bg-black text-white">
      <div className="flex items-center justify-between border-b border-white/20 p-3">
        <div>
          <h2 className="text-lg font-semibold">{book.title}</h2>
          <p className="text-xs text-white/70">{book.author ?? "Unknown"}</p>
        </div>
        <button onClick={onClose} className="rounded-lg bg-white/10 px-3 py-1 text-sm">
          Close
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <p className="text-sm text-white/80">Reader shells are not implemented yet in this branch.</p>
        <p className="mt-4 text-xs text-white/60">TODO: integrate epub.js/pdf.js renderer here by referencing the shared renderer module.</p>
      </div>

      <div className="border-t border-white/20 p-3 text-sm text-white/80">
        Swipe left/right in the real app to navigate pages. Tap center to toggle controls.
      </div>
    </div>
  );
};