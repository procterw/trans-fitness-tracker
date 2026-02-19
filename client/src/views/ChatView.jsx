import React from "react";

import MessageThread from "../components/MessageThread.jsx";
import StatusMessage from "../components/StatusMessage.jsx";

export default function ChatView({
  chatMessagesRef,
  composerMessages,
  composerLoading,
  composerError,
  foodFormRef,
  foodFileInputRef,
  composerInputRef,
  foodAttachments,
  foodDate,
  composerInput,
  onSubmitFood,
  onPickFoodFiles,
  onRemoveFoodAttachment,
  onFoodDateChange,
  onComposerInputChange,
  onComposerInputAutoSize,
}) {
  const isEmptyChat = composerMessages.length === 0 && !composerLoading;

  return (
    <section className={`chatPanel conversationPanel ${isEmptyChat ? "chatPanelEmpty" : ""}`}>
      <div className="chatBox chatBoxFull">
        <MessageThread
          containerRef={chatMessagesRef}
          messages={composerMessages}
          loading={composerLoading && !composerError}
          className={isEmptyChat ? "chatMessagesEmpty" : ""}
          ariaLabel="Conversation"
          emptyState={
            <div className="chatEmptyState">
              <span className="chatEmptyEmojiWrap" aria-hidden="true">
                <span className="chatEmptyEmoji" role="img" aria-label="Peach">
                  🍑
                </span>
                <span className="chatEmptyEmojiReflection" role="presentation" aria-hidden="true">
                  🍑
                </span>
              </span>
            </div>
          }
        />

        <form ref={foodFormRef} onSubmit={onSubmitFood} className="composerForm foodComposerForm chatComposer">
          <input
            ref={foodFileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden composerFileInput"
            hidden
            onChange={(e) => onPickFoodFiles(e.target.files)}
          />

          {foodAttachments.length ? (
            <div className="composerPreviewRow" aria-label="Selected photos">
              {foodAttachments.map((attachment) => (
                <div key={attachment.id} className="composerPreviewCard">
                  <img src={attachment.previewUrl} alt={attachment.name || "Selected photo"} className="composerPreviewImage" />
                  <button
                    type="button"
                    className="composerPreviewRemove"
                    aria-label={`Remove ${attachment.name || "photo"}`}
                    onClick={() => onRemoveFoodAttachment(attachment.id)}
                    disabled={composerLoading}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="composerBar" aria-label="Unified input">
            <div className="composerTopRow">
              <button
                type="button"
                className="iconButton"
                aria-label={foodAttachments.length ? "Add more photos" : "Add photo"}
                onClick={() => foodFileInputRef.current?.click()}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4 7.5A2.5 2.5 0 0 1 6.5 5h2.1l1.1-1.2c.4-.5 1-.8 1.7-.8h1.2c.7 0 1.3.3 1.7.8L15.4 5h2.1A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M9 12.2l2.1 2.1 4.2-4.2"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              <input
                type="date"
                className="datePillInput composerDateInput"
                value={foodDate}
                onChange={(e) => onFoodDateChange(e.target.value)}
                aria-label="Log date"
              />
            </div>

            <div className="composerBottomRow">
              <textarea
                ref={composerInputRef}
                rows={1}
                className="composerInput"
                value={composerInput}
                onChange={(e) => onComposerInputChange(e.target.value)}
                onInput={(e) => onComposerInputAutoSize(e.currentTarget)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.shiftKey) return;
                  if (composerLoading) {
                    e.preventDefault();
                    return;
                  }
                  e.preventDefault();
                  foodFormRef.current?.requestSubmit();
                }}
                placeholder="Ask a question or log food/activity"
                aria-label="Unified input"
              />

              <button
                type="submit"
                className="sendButton"
                disabled={composerLoading}
                aria-label="Send"
                onMouseDown={(e) => e.preventDefault()}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M3 11.2L21 3l-8.2 18-2.2-6.2L3 11.2z"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>

          <StatusMessage error={composerError} className="composerStatus" />
        </form>
      </div>
    </section>
  );
}
