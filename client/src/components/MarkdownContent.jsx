import React from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

function isSafeHref(href) {
  if (!href) return false;
  if (href.startsWith("#")) return true;
  try {
    const url = new URL(href, "https://example.invalid");
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

export default function MarkdownContent({ content }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{
        a({ href, children }) {
          if (!isSafeHref(href)) return <span>{children}</span>;
          return (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          );
        },
        img() {
          return null;
        },
      }}
    >
      {typeof content === "string" ? content : ""}
    </ReactMarkdown>
  );
}

