declare module "epubjs" {
  type SpineLocation = {
    start?: {
      percentage?: number;
    };
  };

  type TocItem = {
    id?: string;
    label: string;
    href: string;
    subitems?: TocItem[];
  };

  type Navigation = {
    toc: TocItem[];
  };

  type Rendition = {
    display: (target?: string) => Promise<void>;
    flow: (mode: "scrolled" | "scrolled-doc" | "paginated") => void;
    on: (event: "relocated", handler: (location: SpineLocation) => void) => void;
    off: (event: "relocated", handler: (location: SpineLocation) => void) => void;
    prev: () => Promise<void>;
    next: () => Promise<void>;
    destroy: () => void;
    themes: {
      register: (name: string, theme: Record<string, Record<string, string>>) => void;
      select: (name: string) => void;
    };
  };

  type EpubBook = {
    renderTo: (element: HTMLElement, options: { width: string | number; height: string | number }) => Rendition;
    loaded: {
      navigation: Promise<Navigation>;
    };
    destroy: () => void;
  };

  function ePub(data: ArrayBuffer): EpubBook;

  export default ePub;
}
