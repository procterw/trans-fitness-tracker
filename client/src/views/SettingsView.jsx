import React from "react";

import MessageThread from "../components/MessageThread.jsx";
import StatusMessage from "../components/StatusMessage.jsx";

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
  onSettingsInputChange,
  onSettingsInputAutoSize,
  onSettingsProfileChange,
  checklistCategories = [],
  checklistWeekLabel = "",
  checklistPhaseName = "",
  checklistPhaseDescription = "",
}) {
  const profiles = settingsProfiles && typeof settingsProfiles === "object" ? settingsProfiles : {};

  return (
    <section className="chatPanel">
      <div className="chatBox chatBoxFull">
        <div className="settingsChatSplit">
          <aside className="settingsProfilesPanel" aria-label="Settings profiles">
            <div className="settingsProfilesHeader sidebarSectionHeader">
              <h2 className="sidebarHeading">Settings profiles</h2>
              <p className="settingsProfilesMeta sidebarDate">
                {settingsProfilesSaving || settingsProfilesDirty ? (
                  <span className="settingsSaveStatus">
                    <span className="settingsSaveSpinner" aria-hidden="true" />
                    <span className="settingsSaveLabel">Saving…</span>
                  </span>
                ) : (
                  <span className="settingsSaveStatus settingsSaveStatusSaved">
                    <span className="settingsSaveCheck" aria-hidden="true">
                      ✓
                    </span>
                    <span className="settingsSaveLabel">Saved</span>
                  </span>
                )}
              </p>
            </div>
            <div className="settingsProfilesFields">
              <label className="settingsProfilesField" htmlFor="general_profile_text">
                <span className="sidebarSectionLabel">General profile</span>
                <textarea
                  id="general_profile_text"
                  className="settingsProfileTextarea"
                  value={typeof profiles.general === "string" ? profiles.general : ""}
                  onChange={(e) => onSettingsProfileChange("general", e.target.value)}
                  placeholder="Overall goals, body/health context, lifestyle, meds/conditions, and key coaching context."
                />
              </label>
              <label className="settingsProfilesField" htmlFor="fitness_profile_text">
                <span className="sidebarSectionLabel">Fitness profile</span>
                <textarea
                  id="fitness_profile_text"
                  className="settingsProfileTextarea"
                  value={typeof profiles.fitness === "string" ? profiles.fitness : ""}
                  onChange={(e) => onSettingsProfileChange("fitness", e.target.value)}
                  placeholder="Training plan, phases/blocks schedule, fitness goals, injuries, and logging shortcuts."
                />
              </label>
              <label className="settingsProfilesField" htmlFor="diet_profile_text">
                <span className="sidebarSectionLabel">Diet profile</span>
                <textarea
                  id="diet_profile_text"
                  className="settingsProfileTextarea"
                  value={typeof profiles.diet === "string" ? profiles.diet : ""}
                  onChange={(e) => onSettingsProfileChange("diet", e.target.value)}
                  placeholder="Diet preferences, recipes, caloric targets, and food logging shortcuts."
                />
              </label>
              <label className="settingsProfilesField" htmlFor="agent_profile_text">
                <span className="sidebarSectionLabel">Agent profile</span>
                <textarea
                  id="agent_profile_text"
                  className="settingsProfileTextarea"
                  value={typeof profiles.agent === "string" ? profiles.agent : ""}
                  onChange={(e) => onSettingsProfileChange("agent", e.target.value)}
                  placeholder="Broad rules for assistant behavior and response style."
                />
              </label>
            </div>
          </aside>

          <aside className="settingsChecklistPanel" aria-label="Current checklist">
            <div className="sidebarSectionHeader">
              <h2 className="sidebarHeading">Current checklist</h2>
              {checklistWeekLabel ? <span className="sidebarDate">{checklistWeekLabel}</span> : null}
            </div>
            {checklistPhaseName ? (
              <div className="muted" style={{ marginBottom: 8 }}>
                <strong>{checklistPhaseName}</strong>
                {checklistPhaseDescription ? ` — ${checklistPhaseDescription}` : ""}
              </div>
            ) : null}

            <div className="settingsChecklistBody">
              {Array.isArray(checklistCategories) && checklistCategories.length ? (
                <div className="sidebarChecklist">
                  {checklistCategories.map((category) => {
                    const key = typeof category?.key === "string" ? category.key : "";
                    const label =
                      typeof category?.label === "string" && category.label.trim() ? category.label.trim() : key || "Category";
                    const items = Array.isArray(category?.items) ? category.items : [];

                    return (
                      <div key={key || label} className="settingsChecklistGroup">
                        <h3 className="sidebarSectionLabel">{label}</h3>
                        <div className="sidebarChecklistItems">
                          {items.length ? (
                            items.map((it, idx) => {
                              const itemLabel = typeof it?.item === "string" ? it.item : "";
                              const itemDescription = typeof it?.description === "string" ? it.description.trim() : "";
                              const checked = it?.checked === true;

                              return (
                                <div key={idx} className={`sidebarChecklistItem ${checked ? "done" : "todo"}`}>
                                  <span
                                    className={`sidebarChecklistMark ${checked ? "checked" : "unchecked"}`}
                                    aria-hidden="true"
                                  >
                                    {checked ? "✓" : ""}
                                  </span>
                                  <span className="sidebarChecklistText">
                                    <span>{itemLabel}</span>
                                    {itemDescription ? <span className="sidebarChecklistDescription">{itemDescription}</span> : null}
                                  </span>
                                </div>
                              );
                            })
                          ) : (
                            <div className="sidebarChecklistItem muted">No items.</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="muted">No checklist categories yet.</div>
              )}
            </div>
          </aside>

          <div className="settingsChatColumn">
            <MessageThread
              containerRef={settingsMessagesRef}
              messages={settingsMessages}
              loading={settingsLoading && !settingsError}
              className="settingsChatMessages"
              ariaLabel="Settings conversation"
              emptyState={
                <div className="muted">
                  Ask to update any profile field. Example: “Rewrite my training profile with a 12-week progression and injury constraints.”
                </div>
              }
            />

            <form ref={settingsFormRef} onSubmit={onSubmitSettings} className="composerForm foodComposerForm chatComposer">
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

              <StatusMessage error={settingsError} className="composerStatus" />
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
