export function normalizeProfileText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n");
}

export function normalizeSettingsProfiles(value) {
  const safe = value && typeof value === "object" ? value : {};
  const general = normalizeProfileText(safe.general);
  const fitness = normalizeProfileText(safe.fitness);
  const diet = normalizeProfileText(safe.diet);
  const agent = normalizeProfileText(safe.agent);
  return {
    general,
    fitness,
    diet,
    agent,
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
