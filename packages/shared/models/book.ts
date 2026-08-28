export type Book = {
  id: string;
  title: string;
  author: string | null;
  genres: string[];
  coverUrl: string | null;
  localPath: string;
  fileHash: string;
  progress: number;
  lastOpened: string | null;
  createdAt: string;
  // Last time metadata enrichment ran for this book, successful or not.
  metadataCheckedAt?: string | null;
};

export type BookFilter = {
  query: string;
  author: string;
  genre: string;
  sort: "recent" | "opened" | "author";
  view: "grid" | "list";
};
