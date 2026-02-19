const tabs = Array.from(document.querySelectorAll(".tab"));
const tabSections = {
  photo: document.querySelector("#tab-photo"),
  manual: document.querySelector("#tab-manual"),
  fitness: document.querySelector("#tab-fitness"),
  dashboard: document.querySelector("#tab-dashboard"),
};

const photoForm = document.querySelector("#photoForm");
const photoSubmitBtn = document.querySelector("#submitBtn");
const photoStatusEl = document.querySelector("#photoStatus");
const photoResultEl = document.querySelector("#photoResult");
const photoDateInput = document.querySelector("#photoDateInput");

const manualForm = document.querySelector("#manualForm");
const manualSubmitBtn = document.querySelector("#manualSubmitBtn");
const manualStatusEl = document.querySelector("#manualStatus");
const manualResultEl = document.querySelector("#manualResult");
const manualDateInput = document.querySelector("#manualDateInput");

const dashboardDateInput = document.querySelector("#dashboardDateInput");
const dashboardRefreshBtn = document.querySelector("#dashboardRefreshBtn");
const dashboardRollupBtn = document.querySelector("#dashboardRollupBtn");
const dashboardStatusEl = document.querySelector("#dashboardStatus");
const dashboardResultEl = document.querySelector("#dashboardResult");

const fitnessStatusEl = document.querySelector("#fitnessStatus");
const fitnessContentEl = document.querySelector("#fitnessContent");

function setStatus(el, msg) {
  if (!el) return;
  el.textContent = msg;
}

function showSection(name) {
  for (const [key, section] of Object.entries(tabSections)) {
    if (!section) continue;
    section.classList.toggle("hidden", key !== name);
  }
  for (const btn of tabs) {
    btn.classList.toggle("active", btn.dataset.tab === name);
  }
}

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmt(n) {
  if (n === null || n === undefined) return "—";
  if (typeof n !== "number") return String(n);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function nutrientsTable(n) {
  return `
    <table>
      <tbody>
        <tr><th>Calories</th><td>${fmt(n.calories)}</td></tr>
        <tr><th>Protein (g)</th><td>${fmt(n.protein_g)}</td></tr>
        <tr><th>Carbs (g)</th><td>${fmt(n.carbs_g)}</td></tr>
        <tr><th>Fat (g)</th><td>${fmt(n.fat_g)}</td></tr>
        <tr><th>Fiber (g)</th><td>${fmt(n.fiber_g)}</td></tr>
        <tr><th>Potassium (mg)</th><td>${fmt(n.potassium_mg)}</td></tr>
        <tr><th>Magnesium (mg)</th><td>${fmt(n.magnesium_mg)}</td></tr>
        <tr><th>Omega‑3 (mg)</th><td>${fmt(n.omega3_mg)}</td></tr>
        <tr><th>Calcium (mg)</th><td>${fmt(n.calcium_mg)}</td></tr>
        <tr><th>Iron (mg)</th><td>${fmt(n.iron_mg)}</td></tr>
      </tbody>
    </table>
  `;
}

function renderEstimateResult(containerEl, payload) {
  const { estimate, day_totals_from_events: dayTotals, event } = payload;

  const itemsHtml =
    estimate.items?.length > 0
      ? `
        <h3>Items</h3>
        <ul>
          ${estimate.items
            .map((it) => {
              const notes = it.notes ? `<div class="muted">${escapeHtml(it.notes)}</div>` : "";
              return `<li><strong>${escapeHtml(it.name)}</strong> — ${escapeHtml(it.portion)}${notes}<br/>${nutrientsTable(
                it.nutrients,
              )}</li>`;
            })
            .join("")}
        </ul>
      `
      : "";

  const warnings = (estimate.warnings ?? []).length
    ? `<h3>Warnings</h3><ul>${estimate.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>`
    : "";

  const followups = (estimate.followup_questions ?? []).length
    ? `<h3>Follow‑ups</h3><ul>${estimate.followup_questions.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ul>`
    : "";

  containerEl.innerHTML = `
    <h2>Logged</h2>
    <p class="muted">Event: <code>${escapeHtml(event.id)}</code> • Date: <code>${escapeHtml(event.date)}</code> • Source: <code>${escapeHtml(event.source)}</code></p>

    <h3>Estimate: ${escapeHtml(estimate.meal_title)}</h3>
    <p class="muted">Confidence: ${(estimate.confidence?.overall ?? 0).toFixed(2)} — ${escapeHtml(
    estimate.confidence?.notes ?? "",
  )}</p>

    <h3>Meal totals</h3>
    ${nutrientsTable(estimate.totals)}

    ${itemsHtml}

    <h3>Running totals for ${escapeHtml(event.date)} (from events)</h3>
    ${nutrientsTable(dayTotals)}

    ${warnings}
    ${followups}
  `;
  containerEl.classList.remove("hidden");
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    const msg = json?.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

async function loadContext() {
  const json = await fetchJson("/api/context");
  if (json?.suggested_date) {
    if (photoDateInput && !photoDateInput.value) photoDateInput.value = json.suggested_date;
    if (manualDateInput && !manualDateInput.value) manualDateInput.value = json.suggested_date;
    if (dashboardDateInput && !dashboardDateInput.value) dashboardDateInput.value = json.suggested_date;
  }
}

photoForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus(photoStatusEl, "");
  photoResultEl.classList.add("hidden");

  const fd = new FormData(photoForm);
  if (!fd.get("date")) fd.delete("date");

  photoSubmitBtn.disabled = true;
  setStatus(photoStatusEl, "Analyzing…");

  try {
    const json = await fetchJson("/api/food/photo", { method: "POST", body: fd });
    renderEstimateResult(photoResultEl, json);
    setStatus(photoStatusEl, "Done.");
  } catch (err) {
    setStatus(photoStatusEl, err instanceof Error ? err.message : String(err));
  } finally {
    photoSubmitBtn.disabled = false;
  }
});

manualForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus(manualStatusEl, "");
  manualResultEl.classList.add("hidden");

  const fd = new FormData(manualForm);
  const description = String(fd.get("description") ?? "").trim();
  const date = String(fd.get("date") ?? "").trim();
  const notes = String(fd.get("notes") ?? "").trim();

  manualSubmitBtn.disabled = true;
  setStatus(manualStatusEl, "Estimating…");

  try {
    const body = { description, notes };
    if (date) body.date = date;
    const json = await fetchJson("/api/food/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    renderEstimateResult(manualResultEl, json);
    setStatus(manualStatusEl, "Done.");
  } catch (err) {
    setStatus(manualStatusEl, err instanceof Error ? err.message : String(err));
  } finally {
    manualSubmitBtn.disabled = false;
  }
});

function renderEventList(events) {
  if (!events?.length) return `<p class="muted">No food events for this date yet.</p>`;
  return `
    <ul>
      ${events
        .map((e) => {
          const calories = e?.nutrients?.calories ?? null;
          const label = calories === null ? "" : ` — ${escapeHtml(String(calories))} kcal`;
          return `<li><strong>${escapeHtml(e.description ?? "(no description)")}</strong>${label}<br/>
            <span class="muted"><code>${escapeHtml(e.source ?? "")}</code> • <code>${escapeHtml(
            e.logged_at ?? "",
          )}</code></span></li>`;
        })
        .join("")}
    </ul>
  `;
}

async function loadDashboard() {
  const date = dashboardDateInput?.value?.trim();
  if (!date) return;

  setStatus(dashboardStatusEl, "Loading…");
  dashboardResultEl.classList.add("hidden");
  try {
    const json = await fetchJson(`/api/food/events?date=${encodeURIComponent(date)}`);
    const eventsHtml = renderEventList(json.events);
    const foodLogHtml = json.food_log
      ? `
        <h3>Daily log row</h3>
        <p class="muted">Status: <code>${escapeHtml(json.food_log.status ?? "")}</code></p>
        ${nutrientsTable(json.food_log)}
        <p class="muted">${escapeHtml(json.food_log.notes ?? "")}</p>
      `
      : `<p class="muted">No <code>food_log</code> row for this date yet.</p>`;

    dashboardResultEl.innerHTML = `
      <h3>Totals (from food_events)</h3>
      ${nutrientsTable(json.day_totals_from_events)}

      <h3>Events</h3>
      ${eventsHtml}

      ${foodLogHtml}
    `;
    dashboardResultEl.classList.remove("hidden");
    setStatus(dashboardStatusEl, "Loaded.");
  } catch (err) {
    setStatus(dashboardStatusEl, err instanceof Error ? err.message : String(err));
  }
}

dashboardRefreshBtn?.addEventListener("click", () => {
  loadDashboard().catch(() => {});
});

dashboardRollupBtn?.addEventListener("click", async () => {
  const date = dashboardDateInput?.value?.trim();
  if (!date) return;
  setStatus(dashboardStatusEl, "Rolling up…");
  try {
    const result = await fetchJson("/api/food/rollup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date }),
    });
    await loadDashboard();
    setStatus(dashboardStatusEl, result.applied ? "Rolled up." : "Skipped: daily log row already exists.");
  } catch (err) {
    setStatus(dashboardStatusEl, err instanceof Error ? err.message : String(err));
  }
});

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function renderFitnessWorkouts(week) {
  const workouts = Array.isArray(week?.workouts) ? week.workouts : [];
  const rows =
    workouts.length > 0
      ? workouts
          .map(
            (it, i) => `
            <tr data-workout-index="${i}">
              <td><input type="checkbox" class="fit-check" ${it.completed ? "checked" : ""} /></td>
              <td>${escapeHtml(it.name ?? "")}</td>
              <td>${escapeHtml(it.category ?? "General")}</td>
              <td><input type="text" class="fit-details" value="${escapeHtml(it.details ?? "")}" placeholder="Details…" /></td>
            </tr>
          `,
          )
          .join("")
      : `<tr><td colspan="4" class="muted">No workouts.</td></tr>`;

  return `
    <h3>Workouts</h3>
    <table>
      <thead><tr><th>Done</th><th>Workout</th><th>Category</th><th>Details</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function loadFitness() {
  setStatus(fitnessStatusEl, "Loading…");
  fitnessContentEl.classList.add("hidden");
  try {
    const json = await fetchJson("/api/fitness/current");
    const w = json.week ?? {};
    fitnessContentEl.innerHTML = `
      <p class="muted">Week: <code>${escapeHtml(w.week_label ?? "")}</code> • Starts: <code>${escapeHtml(
      w.week_start ?? "",
    )}</code></p>

      ${renderFitnessWorkouts(w)}

      <h3>Summary</h3>
      <textarea id="fitnessSummary" rows="3" placeholder="Weekly summary…">${escapeHtml(w.summary ?? "")}</textarea>
      <button id="fitnessSaveSummaryBtn" type="button">Save summary</button>
    `;

    const saveItem = async (row) => {
      const workoutIndex = Number(row.dataset.workoutIndex);
      const checked = row.querySelector(".fit-check")?.checked ?? false;
      const details = row.querySelector(".fit-details")?.value ?? "";

      await fetchJson("/api/fitness/current/item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workout_index: workoutIndex, checked, details }),
      });
    };

    const debouncedSave = debounce(async (row) => {
      try {
        await saveItem(row);
        setStatus(fitnessStatusEl, "Saved.");
      } catch (err) {
        setStatus(fitnessStatusEl, err instanceof Error ? err.message : String(err));
      }
    }, 500);

    for (const row of fitnessContentEl.querySelectorAll("tr[data-workout-index]")) {
      const check = row.querySelector(".fit-check");
      const details = row.querySelector(".fit-details");
      check?.addEventListener("change", () => debouncedSave(row));
      details?.addEventListener("input", () => debouncedSave(row));
    }

    fitnessContentEl.querySelector("#fitnessSaveSummaryBtn")?.addEventListener("click", async () => {
      const summary = fitnessContentEl.querySelector("#fitnessSummary")?.value ?? "";
      setStatus(fitnessStatusEl, "Saving…");
      try {
        await fetchJson("/api/fitness/current/summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ summary }),
        });
        setStatus(fitnessStatusEl, "Saved.");
      } catch (err) {
        setStatus(fitnessStatusEl, err instanceof Error ? err.message : String(err));
      }
    });

    fitnessContentEl.classList.remove("hidden");
    setStatus(fitnessStatusEl, "Loaded.");
  } catch (err) {
    setStatus(fitnessStatusEl, err instanceof Error ? err.message : String(err));
  }
}

for (const btn of tabs) {
  btn.addEventListener("click", () => {
    const name = btn.dataset.tab;
    showSection(name);
    if (name === "fitness") loadFitness().catch(() => {});
    if (name === "dashboard") loadDashboard().catch(() => {});
  });
}

showSection("photo");
loadContext()
  .then(() => Promise.all([loadFitness(), loadDashboard()]))
  .catch(() => {});
