import React from "react";

export default function StatusMessage({ error = "", className = "" }) {
  const text = typeof error === "string" ? error.trim() : "";
  if (!text) return null;

  return (
    <div className={`statusMessage status ${className}`.trim()}>
      <span className="statusMessageText error">{text}</span>
    </div>
  );
}
