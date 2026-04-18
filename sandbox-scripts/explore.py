import json
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
    if isinstance(value, (int, float, str, bool)):
        return value
    return str(value)


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
categorical_columns = [
    column
    for column in df.columns
    if column not in numeric_columns and column not in datetime_columns and df[column].nunique(dropna=True) <= 20
]
boolean_columns = [column for column in df.columns if pd.api.types.is_bool_dtype(df[column])]

columns_by_type = []
for column in df.columns:
    columns_by_type.append(
        {
            "name": column,
            "inferredType": infer_type(df[column]),
            "nullRate": round(float(df[column].isna().mean()), 4),
        }
    )

sample_rows = [
    {column: clean_value(value) for column, value in row.items()}
    for row in df.head(5).to_dict(orient="records")
]

kpis = [
    {
        "id": "rows",
        "label": "Rows",
        "value": f"{len(df):,}",
        "tone": "neutral",
    },
    {
        "id": "columns",
        "label": "Columns",
        "value": str(len(df.columns)),
        "tone": "neutral",
    },
    {
        "id": "numeric",
        "label": "Numeric Fields",
        "value": str(len(numeric_columns)),
        "tone": "neutral",
    },
    {
        "id": "categories",
        "label": "Categorical Fields",
        "value": str(len(categorical_columns)),
        "tone": "positive" if categorical_columns else "neutral",
    },
]

panels = []
insights = []

if datetime_columns and numeric_columns:
    date_column = datetime_columns[0]
    value_column = numeric_columns[0]
    trend_df = (
        df[[date_column, value_column]]
        .dropna()
        .assign(_period=lambda frame: frame[date_column].dt.to_period("M").dt.to_timestamp())
        .groupby("_period", as_index=False)[value_column]
        .sum()
        .sort_values("_period")
    )

    panels.append(
        {
            "id": "trend-panel",
            "kind": "plotly",
            "title": f"{value_column} over time",
            "description": "Monthly trend from the first inferred date field",
            "insight": f"The time series spans {len(trend_df)} monthly points.",
            "spec": {
                "data": [
                    {
                        "type": "scatter",
                        "mode": "lines+markers",
                        "x": [clean_value(value) for value in trend_df["_period"].tolist()],
                        "y": [clean_value(value) for value in trend_df[value_column].tolist()],
                        "line": {"color": "#2563eb", "width": 3},
                        "marker": {"color": "#111827", "size": 6},
                        "name": value_column,
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
        f"{value_column} has a natural time axis through {date_column}, so the dashboard starts with a monthly trend view."
    )

if categorical_columns and numeric_columns:
    category_column = categorical_columns[0]
    value_column = numeric_columns[0]
    category_df = (
        df[[category_column, value_column]]
        .dropna()
        .groupby(category_column, as_index=False)[value_column]
        .sum()
        .sort_values(value_column, ascending=False)
        .head(8)
    )
    panels.append(
        {
            "id": "category-panel",
            "kind": "plotly",
            "title": f"Top {category_column} by {value_column}",
            "description": "Aggregated comparison across the leading category values",
            "insight": f"The leading {category_column} values account for the highest total {value_column}.",
            "spec": {
                "data": [
                    {
                        "type": "bar",
                        "x": [clean_value(value) for value in category_df[category_column].tolist()],
                        "y": [clean_value(value) for value in category_df[value_column].tolist()],
                        "marker": {"color": "#0f766e"},
                        "name": value_column,
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

if numeric_columns:
    numeric_summary = (
        df[numeric_columns]
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
            "title": "Numeric field summary",
            "description": "Mean, spread, and range for numeric columns",
            "insight": "This table helps spot wide ranges and unstable metrics quickly.",
            "columns": ["metric", "mean", "std", "min", "max"],
            "rows": [
                {column: clean_value(value) for column, value in row.items()}
                for row in numeric_summary.to_dict(orient="records")
            ],
        }
    )

if not insights:
    insights.append(
        "The dataset does not expose a clear date axis yet, so the first pass emphasizes structure and descriptive statistics."
    )

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
    "kpis": kpis,
    "panels": panels[:4],
    "insights": insights[:3],
}

print("EXPLORE_JSON:" + json.dumps(payload))
