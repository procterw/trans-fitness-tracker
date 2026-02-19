import React from "react";

import MarkdownContent from "./MarkdownContent.jsx";

function renderMessageContent(message) {
  const role = message?.role === "assistant" ? "assistant" : "user";
  const tone = message?.tone === "status" ? "status" : "default";
  const format = role === "assistant" && message?.format !== "plain" && tone !== "status" ? "markdown" : "plain";

  return (
    <div className={`messageContent chatContent ${format} ${tone === "status" ? "status" : ""}`.trim()}>
      {format === "markdown" ? <MarkdownContent content={message?.content} /> : message?.content}
    </div>
  );
}

export default function MessageThread({
  messages = [],
  loading = false,
  loadingText = "Thinking…",
  containerRef = null,
  className = "",
  ariaLabel = "Conversation",
  emptyState = null,
}) {
  const rows = Array.isArray(messages) ? messages : [];
  const isEmpty = rows.length === 0 && !loading;

  return (
    <div ref={containerRef} className={`messageThread chatMessages ${className}`.trim()} aria-label={ariaLabel}>
      {rows.length ? (
        rows.map((message, idx) => {
          const role = message?.role === "assistant" ? "assistant" : "user";
          const tone = message?.tone === "status" ? "status" : "default";
          return (
            <div
              key={message?.id ?? idx}
              className={`messageBubble chatMsg ${role} ${tone === "status" ? "status" : ""}`.trim()}
            >
              {Array.isArray(message?.attachments) && message.attachments.length ? (
                <div className="chatAttachmentRow" aria-label="Attached photos">
                  {message.attachments.map((attachment) => (
                    <figure key={attachment.id ?? attachment.previewUrl ?? attachment.name} className="chatAttachmentCard">
                      <img
                        src={attachment.previewUrl}
                        alt={attachment.name || "Attached photo"}
                        className="chatAttachmentImage"
                      />
                    </figure>
                  ))}
                </div>
              ) : null}
              {renderMessageContent(message)}
            </div>
          );
        })
      ) : (
        emptyState
      )}

      {loading && !isEmpty ? (
        <div className="messageBubble chatMsg assistant thinking">
          <div className="messageContent chatContent plain">{loadingText}</div>
        </div>
      ) : null}
    </div>
  );
}
