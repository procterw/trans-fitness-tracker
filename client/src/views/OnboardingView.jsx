import React from "react";

import GoalChecklistSidebar from "../components/GoalChecklistSidebar.jsx";
import MarkdownContent from "../components/MarkdownContent.jsx";

export default function OnboardingView({
  onboardingMessagesRef,
  onboardingFormRef,
  onboardingInputRef,
  onboardingMessages,
  onboardingInput,
  onboardingLoading,
  onboardingError,
  onboardingStage,
  onboardingStepIndex,
  onboardingStepTotal,
  onboardingGoalSummary,
  onboardingWorkingChecklist,
  onSubmitOnboarding,
  canExitOnboarding,
  onExitOnboarding,
  onOnboardingInputChange,
}) {
  const stageLabel = onboardingStage === "checklist" ? "Refine goals and checklist" : "Initial intake";

  const stepIndex = typeof onboardingStepIndex === "number" ? onboardingStepIndex : 1;
  const stepTotal = typeof onboardingStepTotal === "number" ? onboardingStepTotal : 2;

  return (
    <section className="chatPanel onboardingPanel">
      <div className="onboardingHeader">
        <h1 className="onboardingTitle">Quick setup</h1>
        <p className="onboardingMeta">{`Step ${stepIndex}/${stepTotal}: ${stageLabel}`}</p>
        <p className="onboardingHint">After your first message, a starter goals + checklist draft appears for live refinement.</p>
        {canExitOnboarding ? (
          <button type="button" className="onboardingExitButton" disabled={onboardingLoading} onClick={onExitOnboarding}>
            Exit onboarding
          </button>
        ) : null}
      </div>

      <div className="chatBox chatBoxFull">
        <div className="chatBodySplit">
          <div ref={onboardingMessagesRef} className="chatMessages" aria-label="Onboarding conversation">
            {onboardingMessages.length ? (
              onboardingMessages.map((m, idx) => (
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
              <div className="muted">I will ask a few questions to personalize your tracker.</div>
            )}

            {onboardingLoading && !onboardingError ? (
              <div className="chatMsg assistant thinking">
                <div className="chatContent plain">Thinking…</div>
              </div>
            ) : null}
          </div>

          <GoalChecklistSidebar
            className="chatContextPanel"
            goalSummary={onboardingGoalSummary}
            checklistCategories={onboardingWorkingChecklist}
          />
        </div>

        <form ref={onboardingFormRef} onSubmit={onSubmitOnboarding} className="foodComposerForm chatComposer">
          <div className="composerBar settingsComposerBar" aria-label="Onboarding input">
            <textarea
              ref={onboardingInputRef}
              className="composerInput onboardingTextarea"
              value={onboardingInput}
              rows={3}
              onChange={(e) => onOnboardingInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                if (!(e.metaKey || e.ctrlKey)) return;
                if (onboardingLoading || !onboardingInput.trim()) {
                  e.preventDefault();
                  return;
                }
                e.preventDefault();
                onboardingFormRef.current?.requestSubmit();
              }}
              placeholder="Write as much as you want. Use Cmd/Ctrl+Enter to send."
              aria-label="Onboarding input"
            />

            <button
              type="submit"
              className="sendButton"
              disabled={onboardingLoading}
              aria-label="Send onboarding message"
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

          {onboardingError ? (
            <div className="status composerStatus">
              <span className="error">{onboardingError}</span>
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}
