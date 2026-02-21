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
  blockOptions = [],
  selectedBlockJson = null,
  selectedBlockId = "",
  onSelectBlock = () => {},
}) {
  const profiles = settingsProfiles && typeof settingsProfiles === "object" ? settingsProfiles : {};
  const groupedChecklistCategories = (() => {
    const rows = Array.isArray(checklistCategories) ? checklistCategories : [];
    const byKey = new Map();

    const ensureGroup = (key, label) => {
      if (!byKey.has(key)) {
        byKey.set(key, { key, label, items: [] });
      }
      return byKey.get(key);
    };

    let receivedGrouped = false;
    for (const row of rows) {
      const hasItems = Array.isArray(row?.items);
      if (hasItems) {
        receivedGrouped = true;
        const key = typeof row?.key === "string" && row.key.trim() ? row.key.trim() : "workouts";
        const label = typeof row?.label === "string" && row.label.trim() ? row.label.trim() : "Workouts";
        const group = ensureGroup(key, label);
        const items = row.items;
        for (const item of items) {
          const itemLabel = typeof item?.item === "string" ? item.item : "";
          if (!itemLabel) continue;
          group.items.push({
            item: itemLabel,
            description: typeof item?.description === "string" ? item.description : "",
            checked: item?.checked === true,
            category: typeof row?.label === "string" && row.label.trim() ? row.label.trim() : "",
          });
        }
      } else if (row && typeof row === "object") {
        const itemLabel = typeof row?.item === "string" ? row.item : "";
        if (!itemLabel) continue;
        const categoryLabel =
          typeof row?.category === "string" && row.category.trim() ? row.category.trim() : "Workouts";
        const key = categoryLabel.toLowerCase().trim();
        const group = ensureGroup(key, categoryLabel);
        group.items.push({
          item: itemLabel,
          description: typeof row?.description === "string" ? row.description : "",
          checked: row?.checked === true,
          category: categoryLabel,
        });
      }
    }

    if (!rows.length) return [];
    if (!receivedGrouped) {
      return Array.from(byKey.values());
    }

    const grouped = rows
      .map((row) => {
        const key = typeof row?.key === "string" && row.key.trim() ? row.key.trim() : "workouts";
        const label = typeof row?.label === "string" && row.label.trim() ? row.label.trim() : "Category";
        const items = Array.isArray(row?.items) ? row.items : [];
        return { key, label, items };
      })
      .filter((row) => row.items.length);
    return grouped.length ? grouped : Array.from(byKey.values());
  })();

  return (
    <section className="chatPanel">
      <div className="chatBox chatBoxFull">
        <div className="settingsChatSplit">
          <aside className="settingsProfilesPanel" aria-label="Settings profiles">
            <div className="settingsProfilesHeader sidebarSectionHeader">
              <h2 className="sidebarHeading">Settings profiles</h2>
            </div>
            <div className="settingsProfilesFields">
              <label className="settingsProfilesField" htmlFor="general_text">
                <span className="sidebarSectionLabel">General profile</span>
                <textarea
                  id="general_text"
                  className="settingsProfileTextarea"
                  value={typeof profiles.general === "string" ? profiles.general : ""}
                  onChange={(e) => onSettingsProfileChange("general", e.target.value)}
                  placeholder="Overall goals, body/health context, lifestyle, meds/conditions, and key coaching context."
                />
              </label>
              <label className="settingsProfilesField" htmlFor="fitness_text">
                <span className="sidebarSectionLabel">Fitness profile</span>
                <textarea
                  id="fitness_text"
                  className="settingsProfileTextarea"
                  value={typeof profiles.fitness === "string" ? profiles.fitness : ""}
                  onChange={(e) => onSettingsProfileChange("fitness", e.target.value)}
                  placeholder="Training plan, phases/blocks schedule, fitness goals, injuries, and logging shortcuts."
                />
              </label>
              <label className="settingsProfilesField" htmlFor="diet_text">
                <span className="sidebarSectionLabel">Diet profile</span>
                <textarea
                  id="diet_text"
                  className="settingsProfileTextarea"
                  value={typeof profiles.diet === "string" ? profiles.diet : ""}
                  onChange={(e) => onSettingsProfileChange("diet", e.target.value)}
                  placeholder="Diet preferences, recipes, caloric targets, and food logging shortcuts."
                />
              </label>
              <label className="settingsProfilesField" htmlFor="agent_text">
                <span className="sidebarSectionLabel">Agent profile</span>
                <textarea
                  id="agent_text"
                  className="settingsProfileTextarea"
                  value={typeof profiles.agent === "string" ? profiles.agent : ""}
                  onChange={(e) => onSettingsProfileChange("agent", e.target.value)}
                  placeholder="Broad rules for assistant behavior and response style."
                />
              </label>
            </div>
          </aside>

          <aside className="settingsChecklistPanel" aria-label="Blocks">
            <div className="sidebarSectionHeader">
              <h2 className="sidebarHeading">Blocks</h2>
              {checklistWeekLabel ? <span className="sidebarDate">{checklistWeekLabel}</span> : null}
            </div>
            <label className="settingsBlockSelectField" htmlFor="settings_block_select">
              <span className="sidebarSectionLabel">Current block</span>
              <select
                id="settings_block_select"
                className="settingsBlockSelect"
                value={selectedBlockId}
                onChange={(e) => onSelectBlock(e.target.value)}
              >
                {Array.isArray(blockOptions) && blockOptions.length ? (
                  blockOptions.map((block) => (
                    <option key={block.id || block.label} value={block.id || ""}>
                      {typeof block?.label === "string" && block.label ? block.label : "Block"}
                    </option>
                  ))
                ) : (
                  <option value="">No blocks yet</option>
                )}
              </select>
            </label>
            {checklistPhaseName ? (
              <div className="muted" style={{ marginBottom: 8 }}>
                <strong>{checklistPhaseName}</strong>
                {checklistPhaseDescription ? ` — ${checklistPhaseDescription}` : ""}
              </div>
            ) : null}
            <div className="settingsChecklistBody">
              {Array.isArray(groupedChecklistCategories) && groupedChecklistCategories.length ? (
                <div className="sidebarChecklist">
                  {groupedChecklistCategories.map((category) => {
                    const key = typeof category?.key === "string" ? category.key : "";
                    const label = typeof category?.label === "string" && category.label.trim() ? category.label.trim() : key || "Category";
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
                                <div key={idx} className={`sidebarChecklistItem ${checked ? "done" : ""}`}>
                                  <span
                                    className={checked ? "sidebarChecklistMark checked" : ""}
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
