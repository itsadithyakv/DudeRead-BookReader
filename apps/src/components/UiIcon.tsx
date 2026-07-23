import {
  BookCopy,
  BookOpenText,
  Bookmark,
  ChartNoAxesCombined,
  Cloud,
  Grid2X2,
  LibraryBig,
  List,
  Moon,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Sun,
  Upload,
  type LucideIcon,
  type LucideProps
} from "lucide-react";

export type UiIconName =
  | "analytics"
  | "book-open"
  | "bookmark"
  | "cloud"
  | "collections"
  | "grid"
  | "library"
  | "list"
  | "moon"
  | "play"
  | "search"
  | "settings"
  | "sparkle"
  | "sun"
  | "sync"
  | "upload";

type UiIconProps = Omit<LucideProps, "ref"> & {
  name: UiIconName;
  size?: number;
};

const icons: Record<UiIconName, LucideIcon> = {
  analytics: ChartNoAxesCombined,
  "book-open": BookOpenText,
  bookmark: Bookmark,
  cloud: Cloud,
  collections: BookCopy,
  grid: Grid2X2,
  library: LibraryBig,
  list: List,
  moon: Moon,
  play: Play,
  search: Search,
  settings: Settings2,
  sparkle: Sparkles,
  sun: Sun,
  sync: RefreshCw,
  upload: Upload
};

export const UiIcon = ({ name, size = 20, ...props }: UiIconProps) => {
  const Icon = icons[name];
  return <Icon aria-hidden="true" size={size} strokeWidth={2} {...props} />;
};
