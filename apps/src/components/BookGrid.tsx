import type { Book } from "@shared/models/book";
import { BookCard } from "./BookCard";
import { getPlatform } from "../platform";

const GRID_CLASSES =
  "grid gap-8 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5";

const MOBILE_GRID_CLASSES = "grid gap-6 grid-cols-2 sm:grid-cols-3";

type Props = {
  books: Book[];
  onRefresh: (id: string) => void;
  onOpen: (book: Book) => void;
};

export const BookGrid = ({ books, onRefresh, onOpen }: Props) => {
  const platform = getPlatform();
  const gridClass = platform === "mobile" ? MOBILE_GRID_CLASSES : GRID_CLASSES;

  return (
    <div className={gridClass}>
      {books.map((book) => (
        <BookCard key={book.id} book={book} onRefresh={onRefresh} onOpen={onOpen} />
      ))}
    </div>
  );
};
