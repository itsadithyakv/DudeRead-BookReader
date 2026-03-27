import { FixedSizeGrid } from "react-window";
import type { Book } from "@shared/models/book";
import { BookCard } from "./BookCard";
import { useElementSize } from "../hooks/useElementSize";
import { getPlatform } from "../platform";

const DEFAULT_CARD_WIDTH = 220;
const DEFAULT_CARD_HEIGHT = 300;

type Props = {
  books: Book[];
  onRefresh: (id: string) => void;
  onOpen: (book: Book) => void;
};

export const BookGrid = ({ books, onRefresh }: Props) => {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const platform = getPlatform();
  const cardWidth = platform === "mobile" ? 160 : DEFAULT_CARD_WIDTH;
  const cardHeight = platform === "mobile" ? 220 : DEFAULT_CARD_HEIGHT;
  const columnCount = Math.max(1, Math.floor(size.width / (cardWidth + 16)));
  const rowCount = Math.ceil(books.length / columnCount);

  return (
    <div ref={ref} className="h-full">
      {size.width > 0 && (
        <FixedSizeGrid
          columnCount={columnCount}
          columnWidth={cardWidth + 16}
          height={size.height}
          rowCount={rowCount}
          rowHeight={cardHeight + 16}
          width={size.width}
        >
          {({ columnIndex, rowIndex, style }) => {
            const index = rowIndex * columnCount + columnIndex;
            const book = books[index];
            if (!book) {
              return null;
            }
            return (
              <div style={style} className="p-2">
                <BookCard book={book} onRefresh={onRefresh} onOpen={onOpen} />
              </div>
            );
          }}
        </FixedSizeGrid>
      )}
    </div>
  );
};
