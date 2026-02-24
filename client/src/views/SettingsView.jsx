import React, { useRef } from "react";

import StatusMessage from "../components/StatusMessage.jsx";

export default function SettingsView({
  settingsError,
  settingsBlocksSaving = false,
  settingsProfiles,
  onSettingsProfileChange,
  blockOptions = [],
  selectedBlockId = "",
  onSelectBlock = () => {},
  onAddBlock = () => {},
  currentBlockName = "",
  currentBlockDescription = "",
  onBlockNameChange = () => {},
  onBlockDescriptionChange = () => {},
  onDeleteBlock = () => {},
  onImportBlock = () => {},
  checklistRows = [],
  onAddChecklistRow = () => {},
  onChecklistRowChange = () => {},
  onDeleteChecklistRow = () => {},
  onReorderChecklistRows = () => {},
}) {
  const profiles = settingsProfiles && typeof settingsProfiles === "object" ? settingsProfiles : {};
  const dragIndexRef = useRef(null);

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
            <div className="sidebarSectionHeader">
              <h2 className="sidebarHeading">Blocks</h2>
            </div>

            <label className="settingsBlockSelectField" htmlFor="settings_block_select">
              <span className="sidebarSectionLabel">Block list</span>
              <select
                id="settings_block_select"
                className="settingsBlockSelect"
                value={selectValue}
                onChange={(e) => onSelectBlock(e.target.value)}
                disabled={settingsBlocksSaving}
              >
                {hasBlocks ? (
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

            <button type="button" className="secondary" onClick={onAddBlock} disabled={settingsBlocksSaving}>
              Add block
            </button>

            <label className="settingsProfilesField" htmlFor="settings_block_name">
              <span className="sidebarSectionLabel">Block name</span>
              <input
                id="settings_block_name"
                type="text"
                value={currentBlockName}
                onChange={(e) => onBlockNameChange(e.target.value)}
                placeholder="Block name"
                disabled={settingsBlocksSaving}
              />
            </label>

            <label className="settingsProfilesField" htmlFor="settings_block_description">
              <span className="sidebarSectionLabel">Block description</span>
              <textarea
                id="settings_block_description"
                value={currentBlockDescription}
                onChange={(e) => onBlockDescriptionChange(e.target.value)}
                placeholder="Block description"
                className="settingsBlockDescription"
                disabled={settingsBlocksSaving}
              />
            </label>

            <button type="button" className="danger" onClick={onDeleteBlock} disabled={!selectValue || settingsBlocksSaving}>
              Delete block
            </button>

            <button type="button" className="secondary" onClick={onImportBlock} disabled={settingsBlocksSaving}>
              Import block JSON
            </button>
          </aside>

          <aside className="settingsChecklistEditorPanel" aria-label="Checklist editor">
            <div className="sidebarSectionHeader">
              <h2 className="sidebarHeading">Checklist</h2>
              <button type="button" className="secondary small" onClick={onAddChecklistRow} disabled={settingsBlocksSaving || !selectValue}>
                Add row
              </button>
            </div>

            <div className="settingsChecklistEditorRows">
              {Array.isArray(checklistRows) && checklistRows.length ? (
                checklistRows.map((row, index) => (
                  <div
                    key={row?.id || index}
                    className="settingsChecklistEditorRow"
                    draggable
                    aria-disabled={settingsBlocksSaving}
                    onDragStart={() => {
                      if (settingsBlocksSaving) return;
                      dragIndexRef.current = index;
                    }}
                    onDragOver={(event) => {
                      if (settingsBlocksSaving) return;
                      event.preventDefault();
                    }}
                    onDrop={(event) => {
                      if (settingsBlocksSaving) return;
                      event.preventDefault();
                      const sourceIndex = dragIndexRef.current;
                      if (!Number.isInteger(sourceIndex)) return;
                      if (sourceIndex === index) return;
                      onReorderChecklistRows(sourceIndex, index);
                      dragIndexRef.current = null;
                    }}
                    onDragEnd={() => {
                      dragIndexRef.current = null;
                    }}
                  >
                    <div className="settingsChecklistEditorRowTop">
                      <span className="settingsDragHandle" aria-hidden="true">::</span>
                      <button
                        type="button"
                        className="secondary small"
                        onClick={() => onDeleteChecklistRow(index)}
                        disabled={settingsBlocksSaving}
                      >
                        Delete
                      </button>
                    </div>

                    <label className="settingsProfilesField" htmlFor={`checklist_name_${index}`}>
                      <span className="sidebarSectionLabel">Name</span>
                      <input
                        id={`checklist_name_${index}`}
                        type="text"
                        value={typeof row?.name === "string" ? row.name : ""}
                        onChange={(e) => onChecklistRowChange(index, "name", e.target.value)}
                        placeholder="Workout name"
                        disabled={settingsBlocksSaving}
                      />
                    </label>

                    <label className="settingsProfilesField" htmlFor={`checklist_description_${index}`}>
                      <span className="sidebarSectionLabel">Description</span>
                      <textarea
                        id={`checklist_description_${index}`}
                        value={typeof row?.description === "string" ? row.description : ""}
                        onChange={(e) => onChecklistRowChange(index, "description", e.target.value)}
                        placeholder="Optional details"
                        className="settingsChecklistDescription"
                        disabled={settingsBlocksSaving}
                      />
                    </label>

                    <label className="settingsProfilesField" htmlFor={`checklist_category_${index}`}>
                      <span className="sidebarSectionLabel">Category</span>
                      <input
                        id={`checklist_category_${index}`}
                        type="text"
                        value={typeof row?.category === "string" ? row.category : ""}
                        onChange={(e) => onChecklistRowChange(index, "category", e.target.value)}
                        placeholder="Category"
                        disabled={settingsBlocksSaving}
                      />
                    </label>

                    <label className="settingsChecklistOptionalField" htmlFor={`checklist_optional_${index}`}>
                      <input
                        id={`checklist_optional_${index}`}
                        type="checkbox"
                        checked={row?.optional === true}
                        onChange={(e) => onChecklistRowChange(index, "optional", e.target.checked)}
                        disabled={settingsBlocksSaving}
                      />
                      <span>Optional</span>
                    </label>
                  </div>
                ))
              ) : (
                <div className="muted">No checklist rows yet.</div>
              )}
            </div>
          </aside>
        </div>

        <StatusMessage error={settingsError} className="composerStatus" />
      </div>
    </section>
  );
}
