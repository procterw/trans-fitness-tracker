import React from "react";

import GoalChecklistSidebar from "../components/GoalChecklistSidebar.jsx";
import MarkdownContent from "../components/MarkdownContent.jsx";

export default function SettingsView({
  settingsMessagesRef,
  settingsFormRef,
  settingsInputRef,
  settingsMessages,
  settingsInput,
  settingsLoading,
  settingsError,
  settingsGoalSummary,
  settingsWorkingChecklist,
  onSubmitSettings,
  onConfirmSettingsProposal,
  onSettingsInputChange,
}) {
  return (
    <section className="chatPanel">
      <div className="chatBox chatBoxFull">
        <div className="chatBodySplit">
          <div ref={settingsMessagesRef} className="chatMessages" aria-label="Settings conversation">
            {settingsMessages.length ? (
              settingsMessages.map((m, idx) => (
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
                  {m.role === "assistant" && m.requiresConfirmation && m.proposal ? (
                    <div className="settingsConfirmRow">
                      <button
                        type="button"
                        className="small"
                        disabled={settingsLoading}
                        onClick={() => onConfirmSettingsProposal(m.id, "now")}
                      >
                        Confirm changes
                      </button>
                      {Array.isArray(m.proposal?.checklist_categories) ? (
                        <button
                          type="button"
                          className="secondary small"
                          disabled={settingsLoading}
                          onClick={() => onConfirmSettingsProposal(m.id, "next_week")}
                        >
                          Apply checklist next week
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="muted">
                Ask GPT-5 to edit checklist items, diet/fitness goals, or profile context. Example: “Replace mobility
                checklist with two 10-minute hip sessions and one ankle session.”
              </div>
            )}

            {settingsLoading && !settingsError ? (
              <div className="chatMsg assistant thinking">
                <div className="chatContent plain">Thinking…</div>
              </div>
            ) : null}
          </div>

          <GoalChecklistSidebar
            className="chatContextPanel"
            goalSummary={settingsGoalSummary}
            checklistCategories={settingsWorkingChecklist}
          />
        </div>

        <form ref={settingsFormRef} onSubmit={onSubmitSettings} className="foodComposerForm chatComposer">
          <div className="composerBar settingsComposerBar" aria-label="Settings input">
            <input
              ref={settingsInputRef}
              type="text"
              className="composerInput settingsInputSingleLine"
              value={settingsInput}
              onChange={(e) => onSettingsInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey) return;
                if (settingsLoading) {
                  e.preventDefault();
                  return;
                }
                e.preventDefault();
                settingsFormRef.current?.requestSubmit();
              }}
              placeholder="Update settings via chat…"
              aria-label="Settings input"
            />

            <button
              type="submit"
              className="sendButton"
              disabled={settingsLoading}
              aria-label="Send settings message"
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

          {settingsError ? (
            <div className="status composerStatus">
              <span className="error">{settingsError}</span>
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}
