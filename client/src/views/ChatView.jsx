import React from "react";

import MarkdownContent from "../components/MarkdownContent.jsx";

export default function ChatView({
  chatMessagesRef,
  composerMessages,
  composerLoading,
  composerError,
  foodFormRef,
  foodFileInputRef,
  composerInputRef,
  foodFile,
  foodDate,
  composerInput,
  onSubmitFood,
  onPickFoodFile,
  onFoodDateChange,
  onComposerInputChange,
  onComposerInputAutoSize,
  onClearFoodFile,
}) {
  return (
    <section className="chatPanel">
      <div className="chatBox chatBoxFull">
        <div ref={chatMessagesRef} className="chatMessages" aria-label="Conversation">
          {composerMessages.length ? (
            composerMessages.map((m, idx) => (
              <div
                key={m.id ?? idx}
                className={`chatMsg ${m.role === "assistant" ? "assistant" : "user"} ${m.tone === "status" ? "status" : ""}`}
              >
                <div
                  className={`chatContent ${
                    m.role === "assistant" && m.format !== "plain" && m.tone !== "status" ? "markdown" : "plain"
                  }`}
                >
                  {m.role === "assistant" && m.format !== "plain" && m.tone !== "status" ? (
                    <MarkdownContent content={m.content} />
                  ) : (
                    m.content
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="muted">No messages yet.</div>
          )}

          {composerLoading && !composerError ? (
            <div className="chatMsg assistant thinking">
              <div className="chatContent plain">Thinking…</div>
            </div>
          ) : null}
        </div>

        <form ref={foodFormRef} onSubmit={onSubmitFood} className="foodComposerForm chatComposer">
          <input
            ref={foodFileInputRef}
            type="file"
            accept="image/*"
            className="hidden composerFileInput"
            hidden
            onChange={(e) => onPickFoodFile(e.target.files?.[0] ?? null)}
          />

          <div className="composerBar" aria-label="Unified input">
            <button
              type="button"
              className="iconButton"
              aria-label={foodFile ? "Change photo" : "Add photo"}
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

          <div className="composerMetaRow">
            <div className="composerMetaLeft">
              {foodFile ? (
                <span className="filePill" title={foodFile.name}>
                  <span className="filePillLabel">Photo:</span> {foodFile.name}
                  <button
                    type="button"
                    className="filePillRemove"
                    aria-label="Remove photo"
                    onClick={onClearFoodFile}
                    disabled={composerLoading}
                  >
                    ×
                  </button>
                </span>
              ) : null}
            </div>

            <div className="composerMetaRight" />
          </div>

          {composerError ? (
            <div className="status composerStatus">
              <span className="error">{composerError}</span>
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}
