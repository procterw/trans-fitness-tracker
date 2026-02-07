import React, { useEffect, useRef } from "react";

export default function AutoGrowTextarea({ value, onChange, className = "", maxHeight = 220, ...props }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
  }, [value, maxHeight]);

  return <textarea ref={ref} value={value} onChange={onChange} className={className} {...props} />;
}
