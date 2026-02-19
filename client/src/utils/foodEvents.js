function toEventRow(event, date, index) {
  return {
    key: event?.id ?? `${date}_${index}`,
    date,
    description: event?.description ?? "(no description)",
    nutrients: event?.nutrients ?? {},
    logged_at: event?.logged_at ?? "",
  };
}

export async function fetchFlattenedFoodEventsByDate(dates, getFoodForDate) {
  const perDay = await Promise.all(
    dates.map(async (date) => {
      const json = await getFoodForDate(date);
      const events = Array.isArray(json?.events) ? json.events : [];
      return events.map((event, index) => toEventRow(event, date, index));
    }),
  );

  // Keep newest events first for both "today" and "weekly" summaries.
  return perDay.flat().sort((a, b) => {
    if (a.date !== b.date) return String(b.date).localeCompare(String(a.date));
    return String(b.logged_at).localeCompare(String(a.logged_at));
  });
}
