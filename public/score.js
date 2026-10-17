// Scores are 1-100 under the hood (what Gemini returns, and what's stored in
// links and the passport), but people see them out of 10: 85 -> "8.5".
export const formatScore = (pct) => (pct >= 100 ? "10" : (Math.round(pct) / 10).toFixed(1));
