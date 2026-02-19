import { useEffect, useMemo, useRef } from "react";

export default function useDebouncedKeyedCallback(fn, ms) {
  const fnRef = useRef(fn);
  const timeoutMapRef = useRef(new Map());

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(() => {
    return () => {
      for (const t of timeoutMapRef.current.values()) clearTimeout(t);
      timeoutMapRef.current.clear();
    };
  }, []);

  return useMemo(() => {
    return (key, ...args) => {
      const map = timeoutMapRef.current;
      const prev = map.get(key);
      if (prev) clearTimeout(prev);
      map.set(
        key,
        setTimeout(() => {
          map.delete(key);
          fnRef.current(...args);
        }, ms),
      );
    };
  }, [ms]);
}
