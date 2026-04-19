import json
import math
import re
from pathlib import Path

import pandas as pd


def infer_type(series: pd.Series) -> str:
    if pd.api.types.is_datetime64_any_dtype(series):
        return "date"
    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if pd.api.types.is_numeric_dtype(series):
        return "number"
    return "string"


def clean_value(value):
    if pd.isna(value):
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        return float(value)
    if isinstance(value, str):
        return value.strip()[:100]
    return str(value)


def compact_number(value: float, currency: bool = False) -> str:
    absolute = abs(value)
    suffixes = [(1_000_000_000_000, "T"), (1_000_000_000, "B"), (1_000_000, "M"), (1_000, "K")]
    sign = "-" if value < 0 else ""
    for threshold, suffix in suffixes:
        if absolute >= threshold:
            scaled = absolute / threshold
            return f"{sign}{'$' if currency else ''}{scaled:.1f}{suffix}"
    if currency:
        return f"{sign}${absolute:,.0f}"
    if absolute >= 100:
        return f"{sign}{absolute:,.0f}"
    if absolute >= 1:
        return f"{sign}{absolute:,.1f}"
    return f"{sign}{absolute:.2f}"


def pick_semantic_role(column: str, series: pd.Series) -> str:
    normalized_name = column.lower()
    normalized_tokens = normalized_name.replace("_", " ").replace("-", " ")
    non_null = series.dropna()
    distinct = int(non_null.nunique()) if len(non_null) else 0
    uniqueness_ratio = round(distinct / max(len(non_null), 1), 4)

    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"
    if re.search(r"\b(id|uuid|slug|code)\b", normalized_tokens) or normalized_name.endswith("_id"):
        return "identifier"
    if pd.api.types.is_numeric_dtype(series):
        return "measure" if distinct > 8 else "dimension"
    if re.search(r"\b(name|title|agency|department|segment|group|category|type|status)\b", normalized_tokens):
        return "label" if distinct > 1 else "text"
    if 1 < distinct <= 20 and uniqueness_ratio <= 0.5:
        return "dimension"
    if uniqueness_ratio >= 0.95 and distinct > 20:
        return "identifier"
    return "text"


def top_values(series: pd.Series, limit: int = 5):
    if series.dropna().empty:
        return []
    counts = series.dropna().astype(str).value_counts().head(limit)
    return [{"value": key, "count": int(value)} for key, value in counts.items()]


def numeric_summary(series: pd.Series):
    cleaned = pd.to_numeric(series, errors="coerce").dropna()
    if cleaned.empty:
        return None
    return {
        "min": float(cleaned.min()),
        "max": float(cleaned.max()),
        "mean": float(cleaned.mean()),
        "median": float(cleaned.median()),
        "std": float(cleaned.std(ddof=0)) if len(cleaned) > 1 else 0.0,
    }


csv_path = Path("/home/user/data.csv")
source_name_path = Path("/home/user/viewpilot/source-name.txt")
filename = source_name_path.read_text().strip() if source_name_path.exists() else csv_path.name

df = pd.read_csv(csv_path)
df = df.dropna(axis=1, how="all")

datetime_columns = []
for column in df.columns:
    if df[column].dtype == object:
        parsed = pd.to_datetime(df[column], errors="coerce")
        if parsed.notna().mean() > 0.8:
            df[column] = parsed
            datetime_columns.append(column)

numeric_columns = [column for column in df.columns if pd.api.types.is_numeric_dtype(df[column])]
boolean_columns = [column for column in df.columns if pd.api.types.is_bool_dtype(df[column])]

column_memories = []
for column in df.columns:
    series = df[column]
    non_null = series.dropna()
    distinct = int(non_null.nunique()) if len(non_null) else 0
    uniqueness_ratio = round(distinct / max(len(non_null), 1), 4)
    role = pick_semantic_role(column, series)
    column_memories.append(
        {
            "name": column,
            "inferredType": infer_type(series),
            "semanticRole": role,
            "nullRate": round(float(series.isna().mean()), 4),
            "distinctCount": distinct,
            "uniquenessRatio": uniqueness_ratio,
            "topValues": top_values(series),
            "numericSummary": numeric_summary(series) if pd.api.types.is_numeric_dtype(series) else None,
            "isRecommendedDimension": role in {"dimension", "label"} and 1 < distinct <= 150,
            "isRecommendedMeasure": role == "measure" and distinct > 8,
        }
    )

columns_by_type = [
    {
        "name": item["name"],
        "inferredType": item["inferredType"],
        "nullRate": item["nullRate"],
    }
    for item in column_memories
]

sample_rows = [
    {column: clean_value(value) for column, value in row.items()}
    for row in df.head(5).to_dict(orient="records")
]

primary_dimensions = [
    item["name"]
    for item in sorted(
        [item for item in column_memories if item["isRecommendedDimension"]],
        key=lambda item: (item["nullRate"], -item["distinctCount"]),
    )
][:3]

primary_measures = [
    item["name"]
    for item in sorted(
        [item for item in column_memories if item["isRecommendedMeasure"]],
        key=lambda item: (
            item["nullRate"],
            -abs(item.get("numericSummary", {}).get("std", 0) or 0),
            item["name"],
        ),
    )
][:3]

categorical_columns = [
    item["name"]
    for item in column_memories
    if item["semanticRole"] in {"dimension", "label"} and item["name"] not in datetime_columns
]

warnings = []
if not datetime_columns:
    warnings.append("No reliable date axis was detected, so the first pass prioritizes ranking, distribution, and data quality views.")
if not primary_dimensions:
    warnings.append("No strong grouping dimension was detected yet, so comparisons may stay high level.")
if not primary_measures:
    warnings.append("No strong quantitative measure was detected for KPI or chart generation.")

missing_columns = [item for item in column_memories if item["nullRate"] >= 0.05]
if missing_columns:
    warnings.append(
        f"{len(missing_columns)} columns have at least 5% missing values and may need cleanup-aware analysis."
    )

opportunities = [
    {
        "id": "overview",
        "kind": "overview",
        "title": "Executive overview",
        "chartFamily": "bar",
        "confidence": 0.75,
        "rationale": "Summarize the strongest metrics and most decision-useful groupings.",
    }
]

best_dimension = primary_dimensions[0] if primary_dimensions else None
best_measure = primary_measures[0] if primary_measures else None
best_date = datetime_columns[0] if datetime_columns else None

if best_dimension and best_measure:
    opportunities.append(
        {
            "id": "ranking-primary",
            "kind": "ranking",
            "title": f"Top {best_dimension} by {best_measure}",
            "chartFamily": "bar",
            "confidence": 0.92,
            "rationale": "A ranked comparison is the clearest first chart for this dataset.",
            "dimension": best_dimension,
            "measure": best_measure,
        }
    )
    opportunities.append(
        {
            "id": "composition-primary",
            "kind": "composition",
            "title": f"Share of {best_measure} across {best_dimension}",
            "chartFamily": "pie",
            "confidence": 0.68,
            "rationale": "Useful when a small number of categories dominates the measure.",
            "dimension": best_dimension,
            "measure": best_measure,
        }
    )

if best_date and best_measure:
    opportunities.append(
        {
            "id": "trend-primary",
            "kind": "time_trend",
            "title": f"Trend of {best_measure} over {best_date}",
            "chartFamily": "line",
            "confidence": 0.9,
            "rationale": "The dataset supports time-based rollups for a trend view.",
            "measure": best_measure,
            "dateColumn": best_date,
        }
    )

if best_measure:
    opportunities.append(
        {
            "id": "distribution-primary",
            "kind": "distribution",
            "title": f"Distribution of {best_measure}",
            "chartFamily": "histogram",
            "confidence": 0.82,
            "rationale": "Distribution analysis helps reveal skew and outliers.",
            "measure": best_measure,
        }
    )

if missing_columns:
    opportunities.append(
        {
            "id": "data-quality",
            "kind": "data_quality",
            "title": "Missing data review",
            "chartFamily": "table",
            "confidence": 0.8,
            "rationale": "The dataset has meaningful missingness that may affect downstream analysis.",
        }
    )

analysis_memory = {
    "columns": column_memories,
    "primaryDimensions": primary_dimensions,
    "primaryMeasures": primary_measures,
    "dateCandidates": datetime_columns[:3],
    "dataQualityWarnings": warnings[:4],
    "opportunities": opportunities[:6],
    "metricHighlights": [],
}

kpis = [
    {"id": "rows", "label": "Rows", "value": f"{len(df):,}", "tone": "neutral"},
    {"id": "columns", "label": "Columns", "value": str(len(df.columns)), "tone": "neutral"},
]

if best_measure:
    measure_series = pd.to_numeric(df[best_measure], errors="coerce").dropna()
    if not measure_series.empty:
        total_value = float(measure_series.sum())
        kpis.append(
            {
                "id": f"total-{best_measure}",
                "label": f"Total {best_measure.replace('_', ' ')}",
                "value": compact_number(total_value, currency="amount" in best_measure.lower()),
                "tone": "neutral",
            }
        )

if best_dimension:
    kpis.append(
        {
            "id": f"distinct-{best_dimension}",
            "label": f"Active {best_dimension.replace('_', ' ')}",
            "value": str(int(df[best_dimension].dropna().nunique())),
            "tone": "positive",
        }
    )

kpis = kpis[:4]
analysis_memory["metricHighlights"] = [
    {"label": item["label"], "value": item["value"], "tone": item.get("tone", "neutral")}
    for item in kpis
]

panels = []
insights = []

if best_date and best_measure:
    trend_df = (
        df[[best_date, best_measure]]
        .dropna()
        .assign(_period=lambda frame: frame[best_date].dt.to_period("M").dt.to_timestamp())
        .groupby("_period", as_index=False)[best_measure]
        .sum()
        .sort_values("_period")
    )
    if len(trend_df) >= 2:
        panels.append(
            {
                "id": "trend-panel",
                "kind": "plotly",
                "title": f"{best_measure.replace('_', ' ').title()} over time",
                "description": "Monthly rollup from the strongest detected date field.",
                "insight": f"{best_measure.replace('_', ' ')} supports a time-based trend using {best_date}.",
                "spec": {
                    "data": [
                        {
                            "type": "scatter",
                            "mode": "lines+markers",
                            "x": [clean_value(value) for value in trend_df["_period"].tolist()],
                            "y": [clean_value(value) for value in trend_df[best_measure].tolist()],
                            "name": best_measure,
                            "line": {"color": "#6366f1", "width": 3},
                            "marker": {"color": "#a78bfa", "size": 6},
                        }
                    ],
                    "layout": {
                        "paper_bgcolor": "rgba(0,0,0,0)",
                        "plot_bgcolor": "rgba(0,0,0,0)",
                        "margin": {"t": 24, "r": 16, "b": 48, "l": 56},
                    },
                    "config": {"displayModeBar": False, "responsive": True},
                },
            }
        )
        insights.append(
            f"{best_date.replace('_', ' ').title()} supports a time-based view for {best_measure.replace('_', ' ')}."
        )

if best_dimension and best_measure:
    ranked = (
        df[[best_dimension, best_measure]]
        .dropna()
        .groupby(best_dimension, as_index=False)[best_measure]
        .sum()
        .sort_values(best_measure, ascending=False)
        .head(10)
    )
    if not ranked.empty:
        dimension_cardinality = int(df[best_dimension].dropna().nunique())
        share = float(ranked[best_measure].sum() / max(df[best_measure].dropna().sum(), 1))
        if dimension_cardinality <= 6 and share > 0.6:
            panels.append(
                {
                    "id": "composition-panel",
                    "kind": "plotly",
                    "title": f"Share of {best_measure.replace('_', ' ')} by {best_dimension.replace('_', ' ')}",
                    "description": "Composition view across the strongest low-cardinality dimension.",
                    "insight": f"A small number of {best_dimension.replace('_', ' ')} values accounts for most of the {best_measure.replace('_', ' ')}.",
                    "spec": {
                        "data": [
                            {
                                "type": "pie",
                                "labels": [clean_value(value) for value in ranked[best_dimension].tolist()],
                                "values": [clean_value(value) for value in ranked[best_measure].tolist()],
                                "hole": 0.45,
                            }
                        ],
                        "layout": {
                            "paper_bgcolor": "rgba(0,0,0,0)",
                            "plot_bgcolor": "rgba(0,0,0,0)",
                            "margin": {"t": 24, "r": 16, "b": 24, "l": 16},
                        },
                        "config": {"displayModeBar": False, "responsive": True},
                    },
                }
            )
        else:
            panels.append(
                {
                    "id": "ranking-panel",
                    "kind": "plotly",
                    "title": f"Top {best_dimension.replace('_', ' ').title()} by {best_measure.replace('_', ' ')}",
                    "description": "Ranked comparison across the most useful grouping dimension.",
                    "insight": f"The leading {best_dimension.replace('_', ' ')} values dominate total {best_measure.replace('_', ' ')}.",
                    "spec": {
                        "data": [
                            {
                                "type": "bar",
                                "x": [clean_value(value) for value in ranked[best_dimension].tolist()],
                                "y": [clean_value(value) for value in ranked[best_measure].tolist()],
                                "name": best_measure,
                                "marker": {"color": "#0ea5e9"},
                            }
                        ],
                        "layout": {
                            "paper_bgcolor": "rgba(0,0,0,0)",
                            "plot_bgcolor": "rgba(0,0,0,0)",
                            "margin": {"t": 24, "r": 16, "b": 72, "l": 56},
                        },
                        "config": {"displayModeBar": False, "responsive": True},
                    },
                }
            )
        insights.append(
            f"{best_dimension.replace('_', ' ').title()} is the strongest grouping field for explaining variation in {best_measure.replace('_', ' ')}."
        )

if best_measure:
    measure_values = pd.to_numeric(df[best_measure], errors="coerce").dropna()
    if len(measure_values) >= 8:
        panels.append(
            {
                "id": "distribution-panel",
                "kind": "plotly",
                "title": f"Distribution of {best_measure.replace('_', ' ').title()}",
                "description": "Distribution view for the primary quantitative measure.",
                "insight": f"This distribution helps spot skew and concentration in {best_measure.replace('_', ' ')}.",
                "spec": {
                    "data": [
                        {
                            "type": "histogram",
                            "x": [clean_value(value) for value in measure_values.tolist()],
                            "marker": {"color": "#14b8a6"},
                            "nbinsx": min(max(int(math.sqrt(len(measure_values))), 10), 24),
                            "name": best_measure,
                        }
                    ],
                    "layout": {
                        "paper_bgcolor": "rgba(0,0,0,0)",
                        "plot_bgcolor": "rgba(0,0,0,0)",
                        "margin": {"t": 24, "r": 16, "b": 48, "l": 56},
                    },
                    "config": {"displayModeBar": False, "responsive": True},
                },
            }
        )

if missing_columns:
    missing_rows = [
        {
            "column": item["name"],
            "nullRate": round(item["nullRate"] * 100, 1),
            "role": item["semanticRole"],
            "distinct": item["distinctCount"],
        }
        for item in sorted(missing_columns, key=lambda item: item["nullRate"], reverse=True)[:8]
    ]
    panels.append(
        {
            "id": "missingness-table",
            "kind": "table",
            "title": "Missing data watchlist",
            "description": "Fields with meaningful missingness that could affect analysis quality.",
            "insight": "Review these fields before relying on precise segment or trend conclusions.",
            "columns": ["column", "nullRate", "role", "distinct"],
            "rows": missing_rows,
        }
    )

if not panels and numeric_columns:
    numeric_summary = (
        df[primary_measures or numeric_columns[:6]]
        .describe()
        .transpose()[["mean", "std", "min", "max"]]
        .round(3)
        .reset_index()
        .rename(columns={"index": "metric"})
    )
    panels.append(
        {
            "id": "summary-table",
            "kind": "table",
            "title": "Priority numeric summary",
            "description": "Summary statistics for the strongest quantitative fields.",
            "insight": "This fallback table is used when the dataset lacks stronger visual candidates.",
            "columns": ["metric", "mean", "std", "min", "max"],
            "rows": [
                {column: clean_value(value) for column, value in row.items()}
                for row in numeric_summary.to_dict(orient="records")
            ],
        }
    )

if not insights:
    insights.append(
        "The first pass seeded the dashboard with the strongest grouping and distribution views available in the dataset."
    )

if best_measure:
    insights.append(
        f"{best_measure.replace('_', ' ').title()} is the primary quantitative signal driving the current dashboard views."
    )

insights = list(dict.fromkeys(insights + warnings))[:3]

payload = {
    "profile": {
        "filename": filename,
        "rows": int(len(df)),
        "columns": int(len(df.columns)),
        "numericColumns": numeric_columns,
        "categoricalColumns": categorical_columns,
        "datetimeColumns": datetime_columns,
        "booleanColumns": boolean_columns,
        "columnsByType": columns_by_type,
        "sampleRows": sample_rows,
    },
    "analysisMemory": analysis_memory,
    "kpis": kpis,
    "panels": panels[:4],
    "insights": insights,
}

print("EXPLORE_JSON:" + json.dumps(payload))
