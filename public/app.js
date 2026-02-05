const statusEl = document.querySelector("#status");
const resultEl = document.querySelector("#result");
const dateInput = document.querySelector("#dateInput");
const form = document.querySelector("#photoForm");
const submitBtn = document.querySelector("#submitBtn");

function setStatus(msg) {
  statusEl.textContent = msg;
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

async function loadContext() {
  const res = await fetch("/api/context");
  const json = await res.json();
  if (json?.ok && json?.suggested_date && !dateInput.value) {
    dateInput.value = json.suggested_date;
  }
}

function renderResult(payload) {
  const { estimate, day_totals_from_events: dayTotals, event } = payload;

  const itemsHtml =
    estimate.items?.length > 0
      ? `
        <h3>Items</h3>
        <ul>
          ${estimate.items
            .map(
              (it) =>
                `<li><strong>${escapeHtml(it.name)}</strong> — ${escapeHtml(it.portion)}<br/>${nutrientsTable(
                  it.nutrients,
                )}</li>`,
            )
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

  resultEl.innerHTML = `
    <h2>Logged</h2>
    <p class="muted">Event: <code>${escapeHtml(event.id)}</code> • Date: <code>${escapeHtml(event.date)}</code></p>

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
  resultEl.classList.remove("hidden");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus("");
  resultEl.classList.add("hidden");

  const fd = new FormData(form);
  if (!fd.get("date")) fd.delete("date");

  submitBtn.disabled = true;
  setStatus("Analyzing…");

  try {
    const res = await fetch("/api/food/photo", { method: "POST", body: fd });
    const json = await res.json();
    if (!json?.ok) throw new Error(json?.error || "Request failed.");
    renderResult(json);
    setStatus("Done.");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
  } finally {
    submitBtn.disabled = false;
  }
});

loadContext().catch(() => {});
