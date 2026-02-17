import React from "react";

import MarkdownContent from "../components/MarkdownContent.jsx";

export default function SettingsView({
  settingsMessagesRef,
  settingsFormRef,
  settingsInputRef,
  settingsMessages,
  settingsInput,
  settingsLoading,
  settingsError,
  settingsProfiles,
  settingsProfilesDirty,
  settingsProfilesSaving,
  onSubmitSettings,
  onConfirmSettingsProposal,
  onSettingsInputChange,
  onSettingsInputAutoSize,
  onSettingsProfileChange,
}) {
  const profiles = settingsProfiles && typeof settingsProfiles === "object" ? settingsProfiles : {};

  return (
    <section className="chatPanel">
      <div className="chatBox chatBoxFull">
        <div className="settingsChatSplit">
          <aside className="settingsProfilesPanel" aria-label="Settings profiles">
            <div className="settingsProfilesHeader">
              <h3 className="sidebarHeading">Settings profiles</h3>
              <p className="muted settingsProfilesMeta">
                {settingsProfilesSaving
                  ? "Autosaving profile edits..."
                  : settingsProfilesDirty
                    ? "Waiting to autosave profile edits..."
                    : "Profile edits autosave. Chat edits still require confirmation."}
              </p>
            </div>

            <div className="settingsProfilesFields">
              <label className="settingsProfilesField" htmlFor="user_profile_text">
                <span className="settingsLabel">User profile</span>
                <textarea
                  id="user_profile_text"
                  className="onboardingTextarea settingsProfileTextarea"
                  value={typeof profiles.user_profile === "string" ? profiles.user_profile : ""}
                  onChange={(e) => onSettingsProfileChange("user_profile", e.target.value)}
                  placeholder="Overall goals, body/health context, lifestyle, meds/conditions, and key coaching context."
                />
              </label>

              <label className="settingsProfilesField" htmlFor="training_profile_text">
                <span className="settingsLabel">Training profile</span>
                <textarea
                  id="training_profile_text"
                  className="onboardingTextarea settingsProfileTextarea"
                  value={typeof profiles.training_profile === "string" ? profiles.training_profile : ""}
                  onChange={(e) => onSettingsProfileChange("training_profile", e.target.value)}
                  placeholder="Training plan, phases/blocks schedule, fitness goals, injuries, and logging shortcuts."
                />
              </label>

              <label className="settingsProfilesField" htmlFor="diet_profile_text">
                <span className="settingsLabel">Diet profile</span>
                <textarea
                  id="diet_profile_text"
                  className="onboardingTextarea settingsProfileTextarea"
                  value={typeof profiles.diet_profile === "string" ? profiles.diet_profile : ""}
                  onChange={(e) => onSettingsProfileChange("diet_profile", e.target.value)}
                  placeholder="Diet preferences, recipes, caloric targets, and food logging shortcuts."
                />
              </label>

              <label className="settingsProfilesField" htmlFor="agent_profile_text">
                <span className="settingsLabel">Agent profile</span>
                <textarea
                  id="agent_profile_text"
                  className="onboardingTextarea settingsProfileTextarea"
                  value={typeof profiles.agent_profile === "string" ? profiles.agent_profile : ""}
                  onChange={(e) => onSettingsProfileChange("agent_profile", e.target.value)}
                  placeholder="Broad rules for assistant behavior and response style."
                />
              </label>
            </div>

          </aside>

          <div className="settingsChatColumn">
            <div ref={settingsMessagesRef} className="chatMessages settingsChatMessages" aria-label="Settings conversation">
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
                          disabled={settingsLoading || settingsProfilesSaving || settingsProfilesDirty}
                          onClick={() => onConfirmSettingsProposal(m.id, m.proposal)}
                        >
                          Confirm changes
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="muted">
                  Ask to update any profile field. Example: “Rewrite my training profile with a 12-week progression and injury constraints.”
                </div>
              )}

              {settingsLoading && !settingsError ? (
                <div className="chatMsg assistant thinking">
                  <div className="chatContent plain">Thinking…</div>
                </div>
              ) : null}
            </div>

            <form ref={settingsFormRef} onSubmit={onSubmitSettings} className="foodComposerForm chatComposer">
              <div className="composerBar" aria-label="Settings input">
                <textarea
                  ref={settingsInputRef}
                  rows={1}
                  className="composerInput"
                  value={settingsInput}
                  onChange={(e) => onSettingsInputChange(e.target.value)}
                  onInput={(e) => onSettingsInputAutoSize(e.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.shiftKey) return;
                    if (settingsLoading || settingsProfilesSaving) {
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
                  disabled={settingsLoading || settingsProfilesSaving}
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
        </div>
      </div>
    </section>
  );
}
