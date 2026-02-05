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
        <tr>
          <th>Potassium (mg)</th>
          <td>{fmt(nutrients.potassium_mg)}</td>
        </tr>
        <tr>
          <th>Magnesium (mg)</th>
          <td>{fmt(nutrients.magnesium_mg)}</td>
        </tr>
        <tr>
          <th>Omega‑3 (mg)</th>
          <td>{fmt(nutrients.omega3_mg)}</td>
        </tr>
        <tr>
          <th>Calcium (mg)</th>
          <td>{fmt(nutrients.calcium_mg)}</td>
        </tr>
        <tr>
          <th>Iron (mg)</th>
          <td>{fmt(nutrients.iron_mg)}</td>
        </tr>
      </tbody>
    </table>
  );
}

