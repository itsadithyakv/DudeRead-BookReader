import { useEffect, useState } from "react";

export const useDebouncedValue = <T,>(value: T, delay = 200) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);

  return debounced;
};
