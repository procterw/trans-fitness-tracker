export function normalizeProfileText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n");
}

export function normalizeSettingsProfiles(value) {
  const safe = value && typeof value === "object" ? value : {};
  return {
    user_profile: normalizeProfileText(safe.user_profile),
    training_profile: normalizeProfileText(safe.training_profile),
    diet_profile: normalizeProfileText(safe.diet_profile),
    agent_profile: normalizeProfileText(safe.agent_profile),
  };
}

export function settingsProfilesEqual(a, b) {
  const left = normalizeSettingsProfiles(a);
  const right = normalizeSettingsProfiles(b);
  return (
    left.user_profile === right.user_profile &&
    left.training_profile === right.training_profile &&
    left.diet_profile === right.diet_profile &&
    left.agent_profile === right.agent_profile
  );
}
