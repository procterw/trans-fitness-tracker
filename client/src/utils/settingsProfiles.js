export function normalizeProfileText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n");
}

export function normalizeSettingsProfiles(value) {
  const safe = value && typeof value === "object" ? value : {};
  const general = normalizeProfileText(safe.general ?? safe.user_profile);
  const fitness = normalizeProfileText(safe.fitness ?? safe.training_profile);
  const diet = normalizeProfileText(safe.diet ?? safe.diet_profile);
  const agent = normalizeProfileText(safe.agent ?? safe.agent_profile);
  return {
    general,
    fitness,
    diet,
    agent,
    // Transitional aliases while views are updated.
    user_profile: general,
    training_profile: fitness,
    diet_profile: diet,
    agent_profile: agent,
  };
}

export function settingsProfilesEqual(a, b) {
  const left = normalizeSettingsProfiles(a);
  const right = normalizeSettingsProfiles(b);
  return (
    left.general === right.general &&
    left.fitness === right.fitness &&
    left.diet === right.diet &&
    left.agent === right.agent
  );
}
