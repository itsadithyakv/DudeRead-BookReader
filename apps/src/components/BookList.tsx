import { FixedSizeList } from "react-window";
import type { Book } from "@shared/models/book";
import { BookRow } from "./BookRow";
import { useElementSize } from "../hooks/useElementSize";

const ROW_HEIGHT = 88;

type Props = {
  books: Book[];
  onRefresh: (id: string) => void;
  onOpen: (book: Book) => void;
};

export const BookList = ({ books, onRefresh, onOpen }: Props) => {
  const { ref, size } = useElementSize<HTMLDivElement>();

  return (
    <div ref={ref} className="h-full">
      {size.height > 0 && (
        <FixedSizeList
          height={size.height}
          itemCount={books.length}
          itemSize={ROW_HEIGHT}
          width={size.width}
        >
          {({ index, style }) => (
            <div style={style} className="px-2 py-1">
              <BookRow book={books[index]} onRefresh={onRefresh} onOpen={onOpen} />
            </div>
          )}
        </FixedSizeList>
      )}
    </div>
  );
};
