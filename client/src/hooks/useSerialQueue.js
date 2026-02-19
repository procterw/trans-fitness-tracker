import { useMemo, useRef } from "react";

export default function useSerialQueue() {
  const chainRef = useRef(Promise.resolve());

  return useMemo(() => {
    return (fn) => {
      const next = chainRef.current.catch(() => {}).then(fn);
      chainRef.current = next;
      return next;
    };
  }, []);
}
