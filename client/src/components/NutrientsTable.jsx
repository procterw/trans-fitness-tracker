import React from "react";

function fmt(n) {
  if (n === null || n === undefined) return "—";
  if (typeof n !== "number") return String(n);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export default function NutrientsTable({ nutrients }) {
  if (!nutrients) return null;
  return (
    <table>
      <tbody>
        <tr>
          <th>Calories</th>
          <td>{fmt(nutrients.calories)}</td>
        </tr>
        <tr>
          <th>Protein (g)</th>
          <td>{fmt(nutrients.protein_g)}</td>
        </tr>
        <tr>
          <th>Carbs (g)</th>
          <td>{fmt(nutrients.carbs_g)}</td>
        </tr>
        <tr>
          <th>Fat (g)</th>
          <td>{fmt(nutrients.fat_g)}</td>
        </tr>
        <tr>
          <th>Fiber (g)</th>
          <td>{fmt(nutrients.fiber_g)}</td>
        </tr>
      </tbody>
    </table>
  );
}
