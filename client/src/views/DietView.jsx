import React from "react";

import { formatFoodEntries, getFoodEntriesFromDay } from "../utils/foodSummary.js";

function getTodayFoodEntries(day) {
  return getFoodEntriesFromDay(day, {
    fallbackSummary: typeof day?.ai_summary === "string" ? day.ai_summary : typeof day?.details === "string" ? day.details : "",
  });
}

function getStatusDotMeta(status) {
  const value = typeof status === "string" ? status.trim().toLowerCase() : "";
  switch (value) {
    case "green":
      return { key: "green", label: "Green" };
    case "yellow":
      return { key: "yellow", label: "Yellow" };
    case "red":
      return { key: "red", label: "Red" };
    default:
      return { key: "incomplete", label: "Incomplete" };
  }
}

function StatusDot({ status }) {
  const { key, label } = getStatusDotMeta(status);
  return <span className={`dietStatusDot dietStatusDot--${key}`} aria-label={label} title={label} />;
}

function isCompleteDay(row) {
  const status = typeof row?.status === "string" ? row.status.trim().toLowerCase() : "";
  return status !== "incomplete";
}

const CHART_WIDTH = 560;
const CHART_HEIGHT = 260;
const CHART_PADDING = { top: 18, right: 42, bottom: 36, left: 42 };
const NUTRITION_SERIES = [
  { key: "calories", label: "Calories", color: "#2d6cdf", axis: "left" },
  { key: "carbs_g", label: "Carbs (g)", color: "#16a34a", axis: "right" },
  { key: "fat_g", label: "Fat (g)", color: "#ef4444", axis: "right" },
  { key: "protein_g", label: "Protein (g)", color: "#8b5cf6", axis: "right" },
  { key: "fiber_g", label: "Fiber (g)", color: "#f59e0b", axis: "right" },
];

function toFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sortByDateAsc(rows) {
  return [...rows].sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")));
}

function formatShortDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(5) : String(value || "");
}

function computeDomain(values) {
  const finite = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!finite.length) return { min: 0, max: 1 };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.08);
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

function buildTicks(domain, count = 4) {
  if (!domain || !Number.isFinite(domain.min) || !Number.isFinite(domain.max) || domain.max <= domain.min) return [];
  const ticks = [];
  for (let idx = 0; idx < count; idx += 1) {
    const ratio = idx / (count - 1);
    ticks.push(domain.min + (domain.max - domain.min) * ratio);
  }
  return ticks;
}

function buildPathFromPoints(points) {
  let current = [];
  const paths = [];
  for (const point of points) {
    if (point === null) {
      if (current.length >= 2) paths.push(current);
      current = [];
      continue;
    }
    current.push(point);
  }
  if (current.length >= 2) paths.push(current);
  return paths
    .map((segment) =>
      segment
        .map((point, idx) => `${idx === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
        .join(" "),
    )
    .join(" ");
}

function renderSharedXAxisLabels(rows, xForIndex, y = CHART_HEIGHT - 12) {
  if (!rows.length) return null;
  const first = 0;
  const last = rows.length - 1;
  const mid = Math.floor((first + last) / 2);
  const indexes = Array.from(new Set([first, mid, last]));
  return indexes.map((index) => (
    <text key={index} x={xForIndex(index)} y={y} textAnchor="middle" className="dietChartAxisLabel">
      {formatShortDate(rows[index]?.date)}
    </text>
  ));
}

function WeightTrendChart({ rows, fmt }) {
  const plotWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const xForIndex = (index) =>
    rows.length <= 1
      ? CHART_PADDING.left + plotWidth / 2
      : CHART_PADDING.left + (plotWidth * index) / (rows.length - 1);

  const weights = rows.map((row) => toFiniteNumber(row?.weight_lb));
  const hasData = weights.some((value) => value !== null);
  if (!hasData) return <p className="muted">No weight entries yet.</p>;

  const domain = computeDomain(weights);
  const yForValue = (value) =>
    CHART_PADDING.top + ((domain.max - value) / (domain.max - domain.min || 1)) * plotHeight;
  const weightPoints = rows.map((row, index) => {
    const value = toFiniteNumber(row?.weight_lb);
    return value === null ? null : { x: xForIndex(index), y: yForValue(value), value, date: row?.date };
  });
  const linePath = buildPathFromPoints(weightPoints);
  const ticks = buildTicks(domain);

  return (
    <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="dietChartSvg" role="img" aria-label="Weight trend">
      <rect x={CHART_PADDING.left} y={CHART_PADDING.top} width={plotWidth} height={plotHeight} className="dietChartPlot" />
      {ticks.map((tick) => {
        const y = yForValue(tick);
        return (
          <g key={tick}>
            <line x1={CHART_PADDING.left} y1={y} x2={CHART_WIDTH - CHART_PADDING.right} y2={y} className="dietChartGridLine" />
            <text x={CHART_PADDING.left - 10} y={y + 4} textAnchor="end" className="dietChartAxisLabel">
              {fmt(Math.round(tick * 10) / 10)}
            </text>
          </g>
        );
      })}
      <line x1={CHART_PADDING.left} y1={CHART_PADDING.top} x2={CHART_PADDING.left} y2={CHART_HEIGHT - CHART_PADDING.bottom} className="dietChartAxisLine" />
      <line
        x1={CHART_PADDING.left}
        y1={CHART_HEIGHT - CHART_PADDING.bottom}
        x2={CHART_WIDTH - CHART_PADDING.right}
        y2={CHART_HEIGHT - CHART_PADDING.bottom}
        className="dietChartAxisLine"
      />
      <path d={linePath} className="dietChartLine dietChartLineWeight" />
      {weightPoints.map((point, idx) =>
        point ? (
          <circle key={rows[idx]?.date || idx} cx={point.x} cy={point.y} r="3" className="dietChartPoint dietChartPointWeight">
            <title>{`${rows[idx]?.date || ""}: ${fmt(point.value)} lb`}</title>
          </circle>
        ) : null,
      )}
      {renderSharedXAxisLabels(rows, xForIndex)}
    </svg>
  );
}

function NutritionTrendChart({ rows, fmt }) {
  const chartHeight = 356;
  const plotGap = 18;
  const xAxisGap = 12;
  const xAxisLabelGap = 18;
  const caloriesSeries = NUTRITION_SERIES.find((series) => series.key === "calories") ?? {
    key: "calories",
    label: "Calories",
    color: "#2d6cdf",
  };
  const macroSeries = NUTRITION_SERIES.filter((series) => series.axis === "right");
  const plotLeft = CHART_PADDING.left + 16;
  const plotRight = CHART_WIDTH - CHART_PADDING.right;
  const plotWidth = plotRight - plotLeft;
  const xAxisY = chartHeight - CHART_PADDING.bottom;
  const xAxisLabelY = xAxisY + xAxisLabelGap;
  const plotsBottom = xAxisY - xAxisGap;
  const combinedPlotHeight = plotsBottom - CHART_PADDING.top - plotGap;
  const splitPlotHeight = combinedPlotHeight / 2;
  const caloriesPlotTop = CHART_PADDING.top;
  const caloriesPlotBottom = caloriesPlotTop + splitPlotHeight;
  const macrosPlotTop = caloriesPlotBottom + plotGap;
  const macrosPlotBottom = plotsBottom;
  const xForIndex = (index) =>
    rows.length <= 1
      ? plotLeft + plotWidth / 2
      : plotLeft + (plotWidth * index) / (rows.length - 1);

  const caloriesValues = rows.map((row) => toFiniteNumber(row?.calories));
  const macrosValues = rows.flatMap((row) => macroSeries.map((series) => toFiniteNumber(row?.[series.key])));
  const hasData = [...caloriesValues, ...macrosValues].some((value) => value !== null);
  if (!hasData) return <p className="muted">No nutrition entries yet.</p>;

  const caloriesDomain = computeDomain(caloriesValues);
  const macrosDomainRaw = computeDomain(macrosValues);
  const macrosDomain = {
    min: 0,
    max: Number.isFinite(macrosDomainRaw.max) ? Math.max(1, macrosDomainRaw.max) : 1,
  };
  const yForCalories = (value) =>
    caloriesPlotTop +
    ((caloriesDomain.max - value) / (caloriesDomain.max - caloriesDomain.min || 1)) *
      (caloriesPlotBottom - caloriesPlotTop);
  const yForMacros = (value) =>
    macrosPlotTop + ((macrosDomain.max - value) / (macrosDomain.max - macrosDomain.min || 1)) * (macrosPlotBottom - macrosPlotTop);
  const caloriesTicks = buildTicks(caloriesDomain);
  const macrosTicks = buildTicks(macrosDomain);
  const caloriesPoints = rows.map((row, index) => {
    const value = toFiniteNumber(row?.calories);
    return value === null ? null : { x: xForIndex(index), y: yForCalories(value), value, date: row?.date };
  });
  const caloriesPath = buildPathFromPoints(caloriesPoints);

  return (
    <svg viewBox={`0 0 ${CHART_WIDTH} ${chartHeight}`} className="dietChartSvg" role="img" aria-label="Calories and macros trend">
      <rect
        x={plotLeft}
        y={caloriesPlotTop}
        width={plotWidth}
        height={caloriesPlotBottom - caloriesPlotTop}
        className="dietChartPlot"
      />
      <rect
        x={plotLeft}
        y={macrosPlotTop}
        width={plotWidth}
        height={macrosPlotBottom - macrosPlotTop}
        className="dietChartPlot"
      />

      {caloriesTicks.map((tick) => {
        const y = yForCalories(tick);
        return (
          <g key={`calories_${tick}`}>
            <line x1={plotLeft} y1={y} x2={plotRight} y2={y} className="dietChartGridLine" />
            <text x={plotLeft - 10} y={y + 4} textAnchor="end" className="dietChartAxisLabel">
              {fmt(Math.round(tick))}
            </text>
          </g>
        );
      })}
      {macrosTicks.map((tick) => {
        const y = yForMacros(tick);
        return (
          <g key={`macros_${tick}`}>
            <line x1={plotLeft} y1={y} x2={plotRight} y2={y} className="dietChartGridLine" />
            <text x={plotLeft - 10} y={y + 4} textAnchor="end" className="dietChartAxisLabel">
              {fmt(Math.round(tick * 10) / 10)}
            </text>
          </g>
        );
      })}

      <line
        x1={plotLeft}
        y1={caloriesPlotTop}
        x2={plotLeft}
        y2={caloriesPlotBottom}
        className="dietChartAxisLine"
      />
      <line
        x1={plotLeft}
        y1={macrosPlotTop}
        x2={plotLeft}
        y2={macrosPlotBottom}
        className="dietChartAxisLine"
      />
      <line
        x1={plotLeft}
        y1={caloriesPlotBottom}
        x2={plotRight}
        y2={caloriesPlotBottom}
        className="dietChartAxisLine"
      />
      <line
        x1={plotRight}
        y1={xAxisY}
        x2={plotRight}
        y2={xAxisY + 8}
        className="dietChartAxisLine"
      />
      <line
        x1={plotLeft}
        y1={xAxisY}
        x2={plotLeft}
        y2={xAxisY + 8}
        className="dietChartAxisLine"
      />
      <line
        x1={plotLeft}
        y1={xAxisY}
        x2={plotRight}
        y2={xAxisY}
        className="dietChartAxisLine"
      />

      <g>
        {caloriesPath ? <path d={caloriesPath} className="dietChartLine" style={{ stroke: caloriesSeries.color }} /> : null}
        {caloriesPoints.map((point, idx) =>
          point ? (
            <circle
              key={`calories_${rows[idx]?.date || idx}`}
              cx={point.x}
              cy={point.y}
              r="2.5"
              className="dietChartPoint"
              style={{ fill: caloriesSeries.color }}
            >
              <title>{`${rows[idx]?.date || ""}: ${caloriesSeries.label} ${fmt(point.value)}`}</title>
            </circle>
          ) : null,
        )}
      </g>

      {macroSeries.map((series) => {
        const points = rows.map((row, index) => {
          const value = toFiniteNumber(row?.[series.key]);
          return value === null ? null : { x: xForIndex(index), y: yForMacros(value), value, date: row?.date };
        });
        const path = buildPathFromPoints(points);
        return (
          <g key={series.key}>
            {path ? <path d={path} className="dietChartLine" style={{ stroke: series.color }} /> : null}
            {points.map((point, idx) =>
              point ? (
                <circle key={`${series.key}_${rows[idx]?.date || idx}`} cx={point.x} cy={point.y} r="2.5" className="dietChartPoint" style={{ fill: series.color }}>
                  <title>{`${rows[idx]?.date || ""}: ${series.label} ${fmt(point.value)}`}</title>
                </circle>
              ) : null,
            )}
          </g>
        );
      })}

      {renderSharedXAxisLabels(rows, xForIndex, xAxisLabelY)}
    </svg>
  );
}

export default function DietView({
  dashError,
  dashLoading,
  dashDay,
  dashDayTotals,
  dashFoodLogRows,
  fmt,
}) {
  const historyRows = sortByDateAsc(Array.isArray(dashFoodLogRows) ? dashFoodLogRows : []);
  const chartRows = historyRows.filter((row) => isCompleteDay(row));

  const totals = {
    calories: typeof dashDayTotals?.calories === "number" ? dashDayTotals.calories : null,
    fat_g: typeof dashDayTotals?.fat_g === "number" ? dashDayTotals.fat_g : null,
    carbs_g: typeof dashDayTotals?.carbs_g === "number" ? dashDayTotals.carbs_g : null,
    protein_g: typeof dashDayTotals?.protein_g === "number" ? dashDayTotals.protein_g : null,
    fiber_g: typeof dashDayTotals?.fiber_g === "number" ? dashDayTotals.fiber_g : null,
  };

  const dayFoodEntries = getTodayFoodEntries(dashDay);
  const dayFoodsText = formatFoodEntries(dayFoodEntries);
  const dayStats = [
    { label: "Calories", value: fmt(totals.calories) },
    { label: "Fat (g)", value: fmt(totals.fat_g) },
    { label: "Carbs (g)", value: fmt(totals.carbs_g) },
    { label: "Protein (g)", value: fmt(totals.protein_g) },
    { label: "Fiber (g)", value: fmt(totals.fiber_g) },
  ];

  return (
    <div className="mainScroll foodLogView">
      <section className="card fitnessCard dietCard">
        <h2>Food log</h2>

        {dashError ? (
          <div className="status dietErrorStatus">
            <span className="error">{dashError}</span>
          </div>
        ) : null}

        <section className="dietTopRow">
          <section className="dietRecentSection">
            <h3>Today</h3>
            <blockquote className="fitnessSummary dietTodaySummary">
              {dayFoodsText || "No foods logged yet."}
            </blockquote>
            {dashLoading ? <p className="muted">Loading…</p> : null}

            {!dashLoading ? (
              <section className="dietDayStatsCard" aria-label="Day stats">
                <h4>Day stats</h4>
                <dl className="dietDayStatsList">
                  {dayStats.map((item) => (
                    <div key={item.label} className="dietDayStatRow">
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}
          </section>

          <section className="dietChartsSection">
            <h3>Trends</h3>
            <div className="dietChartGrid">
              <article className="dietChartCard">
                <div className="dietChartHeader">
                  <h4>Weight (lb)</h4>
                  <span className="muted">From daily log entries</span>
                </div>
                <div className="dietChartSurface">
                  <WeightTrendChart rows={chartRows} fmt={fmt} />
                </div>
              </article>
              <article className="dietChartCard">
                <div className="dietChartHeader">
                  <h4>Calories / Macros / Fiber</h4>
                  <div className="dietChartLegend">
                    {NUTRITION_SERIES.map((series) => (
                      <span key={series.key} className="dietChartLegendItem">
                        <span className="dietChartLegendSwatch" style={{ background: series.color }} />
                        {series.label}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="dietChartSurface">
                  <NutritionTrendChart rows={chartRows} fmt={fmt} />
                </div>
              </article>
            </div>
          </section>
        </section>

        <section className="dietHistorySection">
          <h3>Full history</h3>
          {historyRows.length ? (
            <div className="tableScroll">
              <table className="dietHistoryTable">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Calories</th>
                    <th>Fat</th>
                    <th>Carbs</th>
                    <th>Protein</th>
                    <th>Fiber</th>
                    <th>Status</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((row) => {
                    const rowFoodEntries = getFoodEntriesFromDay(row, {
                      fallbackSummary: typeof row?.ai_summary === "string" ? row.ai_summary : "",
                    });
                    const rowFoodsText = formatFoodEntries(rowFoodEntries);

                    return (
                      <tr key={row.date}>
                        <td>{row.date}</td>
                        <td>{fmt(row.calories)}</td>
                        <td>{fmt(row.fat_g)}</td>
                        <td>{fmt(row.carbs_g)}</td>
                        <td>{fmt(row.protein_g)}</td>
                        <td>{fmt(row.fiber_g)}</td>
                        <td className="dietStatusCell">
                          <StatusDot status={row.status} />
                        </td>
                        <td className="notesCell" title={rowFoodsText}>
                          <div>{rowFoodsText || "No foods logged yet."}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No daily log rows found.</p>
          )}
        </section>
      </section>
    </div>
  );
}
