import React, { useMemo, useRef } from "react";

import StatusMessage from "../components/StatusMessage.jsx";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function highlightJson(value) {
  const escaped = escapeHtml(value);
  const tokenPattern = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g;
  return escaped.replace(tokenPattern, (token) => {
    let className = "jsonTokenNumber";
    if (/^"/.test(token)) {
      className = /:$/.test(token) ? "jsonTokenKey" : "jsonTokenString";
    } else if (token === "true" || token === "false") {
      className = "jsonTokenBoolean";
    } else if (token === "null") {
      className = "jsonTokenNull";
    }
    return `<span class="${className}">${token}</span>`;
  });
}

export default function SettingsView({
  settingsError,
  settingsBlocksSaving = false,
  settingsProfiles,
  onSettingsProfileChange,
  blockOptions = [],
  selectedBlockId = "",
  onSelectBlock = () => {},
  onAddBlock = () => {},
  onDeleteBlock = () => {},
  onOpenTrainingImport = () => {},
  checklistJsonValue = "{}",
  checklistJsonError = "",
  onChecklistJsonChange = () => {},
}) {
  const profiles = settingsProfiles && typeof settingsProfiles === "object" ? settingsProfiles : {};
  const checklistJsonText = typeof checklistJsonValue === "string" ? checklistJsonValue : "{}";
  const checklistJsonHighlighted = useMemo(() => highlightJson(checklistJsonText), [checklistJsonText]);
  const checklistJsonHighlightRef = useRef(null);
  const hasBlocks = Array.isArray(blockOptions) && blockOptions.length > 0;
  const selectedExists = hasBlocks && blockOptions.some((block) => block?.id === selectedBlockId);
  const selectValue = selectedExists ? selectedBlockId : hasBlocks ? blockOptions[0].id : "";

  return (
    <section className="chatPanel">
      <div className="chatBox chatBoxFull">
        <div className="settingsEditorSplit">
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

          <aside className="settingsBlocksPanel" aria-label="Blocks editor">
            <div className="settingsBlockHeaderRow">
              <h2 className="sidebarHeading">Blocks</h2>
              <div className="settingsBlockHeaderActions">
                <button type="button" className="secondary small" onClick={onAddBlock} disabled={settingsBlocksSaving}>
                  Add block
                </button>
                <button
                  type="button"
                  className="secondary small"
                  onClick={onOpenTrainingImport}
                  disabled={settingsBlocksSaving}
                >
                  Import
                </button>
              </div>
            </div>

            <div className="settingsBlockSelectField">
              {hasBlocks ? (
                <div className="settingsBlockList" role="listbox" aria-label="Block list">
                  {blockOptions.map((block) => {
                    const blockId = block?.id || "";
                    const isSelected = blockId === selectValue;
                    return (
                      <button
                        key={block.id || block.label}
                        type="button"
                        className={`settingsBlockListButton ${isSelected ? "active" : ""}`}
                        onClick={() => onSelectBlock(blockId)}
                        disabled={settingsBlocksSaving}
                        aria-pressed={isSelected}
                      >
                        <span className="settingsBlockListTitle">
                          {typeof block?.label === "string" && block.label ? block.label : "Block"}
                        </span>
                        {typeof block?.dateRangeLabel === "string" && block.dateRangeLabel ? (
                          <span className="settingsBlockListDateRange">{block.dateRangeLabel}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="muted">No blocks yet</div>
              )}
            </div>

            <button type="button" className="danger" onClick={onDeleteBlock} disabled={!selectValue || settingsBlocksSaving}>
              Delete block
            </button>
          </aside>

          <aside className="settingsChecklistEditorPanel" aria-label="Block JSON editor">

            <label className="settingsProfilesField settingsChecklistJsonField" htmlFor="settings_checklist_json">
              <div className="settingsChecklistJsonEditor">
                <pre
                  ref={checklistJsonHighlightRef}
                  className="settingsChecklistJsonHighlight"
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: checklistJsonHighlighted }}
                />
                <textarea
                  id="settings_checklist_json"
                  className="settingsChecklistJsonTextarea"
                  value={checklistJsonText}
                  onChange={(e) => onChecklistJsonChange(e.target.value)}
                  onScroll={(event) => {
                    const highlightEl = checklistJsonHighlightRef.current;
                    if (!highlightEl) return;
                    highlightEl.scrollTop = event.currentTarget.scrollTop;
                    highlightEl.scrollLeft = event.currentTarget.scrollLeft;
                  }}
                  placeholder='{"id":"...","name":"Block name","description":"...","block_start":"YYYY-MM-DD","block_end":"","workouts":[{"name":"Workout","description":"","category":"Workouts","optional":false}]}'
                  spellCheck={false}
                />
              </div>
            </label>
            {checklistJsonError ? (
              <div className="error">{checklistJsonError}</div>
            ) : (
              <div className="muted">Edit the block as JSON. Save runs automatically after valid edits.</div>
            )}
          </aside>
        </div>

        <StatusMessage error={settingsError} className="composerStatus" />
      </div>
    </section>
  );
}
