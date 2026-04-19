from __future__ import annotations

from typing import Any
import json

import pandas as pd


def ensure_json_value(value: Any):
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def load_data(path: str = "/home/user/data.csv") -> pd.DataFrame:
    return pd.read_csv(path)


def read_data(path: str = "/home/user/data.csv", **_: Any) -> pd.DataFrame:
    return load_data(path)


def save_result(result: dict[str, Any], path: str = "/home/user/viewpilot/query-result.json") -> str:
    with open(path, "w") as handle:
        json.dump(result, handle)
    return path


def write_json(result: dict[str, Any], path: str = "/home/user/viewpilot/query-result.json", **_: Any) -> str:
    return save_result(result, path)


def format_currency(value: Any) -> str:
    numeric = ensure_json_value(value)
    if numeric is None:
        return "$0"
    try:
        numeric = float(numeric)
    except Exception:
        return str(numeric)

    absolute = abs(numeric)
    suffixes = [(1_000_000_000_000, "T"), (1_000_000_000, "B"), (1_000_000, "M"), (1_000, "K")]
    for threshold, suffix in suffixes:
        if absolute >= threshold:
            return f"${numeric / threshold:.1f}{suffix}"
    return f"${numeric:,.0f}"


def format_percentage(value: Any) -> str:
    numeric = ensure_json_value(value)
    if numeric is None:
      return "0%"
    try:
        numeric = float(numeric)
    except Exception:
        return str(numeric)
    if abs(numeric) <= 1:
        numeric *= 100
    return f"{numeric:.1f}%"


def create_kpi_panel(label: str, value: Any, value_type: str | None = None, precision: int | None = None):
    resolved = ensure_json_value(value)
    if value_type == "currency":
        display = format_currency(resolved)
    elif value_type == "percent":
        display = format_percentage(resolved)
    elif isinstance(resolved, float) and precision is not None:
        display = f"{resolved:.{precision}f}"
    else:
        display = ensure_json_value(resolved)

    return {
        "label": label,
        "value": display,
        "tone": "neutral",
    }


def top_n_by_measure(df: pd.DataFrame, dimension: str, measure: str, n: int = 10) -> pd.DataFrame:
    grouped = (
        df[[dimension, measure]]
        .dropna()
        .groupby(dimension, as_index=False)[measure]
        .sum()
        .sort_values(measure, ascending=False)
        .head(n)
    )
    return grouped


def get_top_n(data: pd.DataFrame, dimension: str, measure: str, n: int = 10, ascending: bool = False, **_: Any) -> pd.DataFrame:
    grouped = top_n_by_measure(data, dimension, measure, n=max(n, len(data) if ascending else n))
    if ascending:
        return grouped.sort_values(measure, ascending=True).head(n)
    return grouped.head(n)


def get_top_n_agencies_by_percentage(data: pd.DataFrame, n: int = 10, **_: Any) -> pd.DataFrame:
    return data.sort_values("percentage_of_total_budget_authority", ascending=False).head(n)


def safe_plotly_bar(title: str, description: str, dimension: str, measure: str | list[str], data: pd.DataFrame):
    if isinstance(measure, list):
        traces = [
            {
                "type": "bar",
                "x": [ensure_json_value(value) for value in data[dimension].tolist()],
                "y": [ensure_json_value(value) for value in data[current].tolist()],
                "name": current,
            }
            for current in measure
        ]
        y_title = ", ".join(measure)
    else:
        traces = [
            {
                "type": "bar",
                "x": [ensure_json_value(value) for value in data[dimension].tolist()],
                "y": [ensure_json_value(value) for value in data[measure].tolist()],
                "name": measure,
            }
        ]
        y_title = measure

    return {
        "kind": "plotly",
        "title": title,
        "description": description,
        "spec": {
            "data": traces,
            "layout": {
                "xaxis": {"title": dimension.replace("_", " ").title()},
                "yaxis": {"title": y_title.replace("_", " ").title()},
            },
            "config": {"displayModeBar": False, "responsive": True},
        },
    }


def safe_plotly_histogram(title: str, description: str, values: list[Any], x_label: str):
    return {
        "kind": "plotly",
        "title": title,
        "description": description,
        "spec": {
            "data": [
                {
                    "type": "histogram",
                    "x": [ensure_json_value(value) for value in values],
                    "name": x_label,
                }
            ],
            "layout": {"xaxis": {"title": x_label}},
            "config": {"displayModeBar": False, "responsive": True},
        },
    }


def safe_plotly_pie(title: str, description: str, dimension: str, measure: str, data: pd.DataFrame):
    return {
        "kind": "plotly",
        "title": title,
        "description": description,
        "spec": {
            "data": [
                {
                    "type": "pie",
                    "labels": [ensure_json_value(value) for value in data[dimension].tolist()],
                    "values": [ensure_json_value(value) for value in data[measure].tolist()],
                    "hole": 0.45,
                }
            ],
            "layout": {},
            "config": {"displayModeBar": False, "responsive": True},
        },
    }


def create_plotly_pie_chart(series: pd.Series | None = None, title: str = "", description: str = "", data: pd.DataFrame | None = None, dimension: str | None = None, measure: str | None = None, **_: Any):
    if data is not None and dimension and measure:
        frame = data[[dimension, measure]].copy()
        return safe_plotly_pie(title, description, dimension, measure, frame)
    if series is None:
        raise ValueError("series or data must be provided for create_plotly_pie_chart")
    frame = pd.DataFrame({"label": series.index.tolist(), "value": series.tolist()})
    return safe_plotly_pie(title, description, "label", "value", frame)


def create_plotly_bar_chart(frame: pd.DataFrame | None = None, dimension: str | None = None, measure: str | list[str] | None = None, title: str = "", description: str = "", data: pd.DataFrame | None = None, x: str | None = None, y: str | list[str] | None = None, *args: Any, **_: Any):
    if isinstance(frame, pd.DataFrame) and isinstance(dimension, str) and isinstance(measure, (str, list)):
        remaining = list(args)
        if isinstance(title, str) and title in {"ascending", "descending"}:
            if remaining:
                title = str(remaining.pop(0))
            if remaining:
                description = str(remaining.pop(0))

    if args:
        source = frame if frame is not None else data
        if source is None and isinstance(args[0], pd.DataFrame):
            source = args[0]
            args = args[1:]
        else:
            source = frame if frame is not None else data
        if len(args) >= 4:
            dimension = dimension or args[0]
            measure = measure or args[1]
            title = title or args[2]
            description = description or args[3]
        data = source

    source = data if data is not None else frame
    dimension = dimension or x
    measure = measure or y
    if source is None or dimension is None or measure is None:
        raise ValueError("frame/data, dimension/x, and measure/y must be provided for create_plotly_bar_chart")
    return safe_plotly_bar(title, description, dimension, measure, source)


def create_pie_chart(*args: Any, **kwargs: Any):
    return create_plotly_pie_chart(*args, **kwargs)


def create_bar_chart(*args: Any, **kwargs: Any):
    return create_plotly_bar_chart(*args, **kwargs)


def create_ranking_chart(*args: Any, **kwargs: Any):
    return create_plotly_bar_chart(*args, **kwargs)


def create_ranking_panel(*args: Any, **kwargs: Any):
    return create_plotly_bar_chart(*args, **kwargs)


def create_histogram_chart(title: str = "", description: str = "", values: list[Any] | None = None, measure: str | None = None, data: pd.DataFrame | None = None, column: str | None = None, **_: Any):
    if data is not None and (column or measure):
        metric = column or measure
        return safe_plotly_histogram(title, description, data[metric].tolist(), metric)
    return safe_plotly_histogram(title, description, values or [], measure or column or "value")


def create_distribution_chart(*args: Any, **kwargs: Any):
    return create_histogram_chart(*args, **kwargs)


def create_distribution_panel(*args: Any, **kwargs: Any):
    return create_histogram_chart(*args, **kwargs)


def create_line_chart(title: str = "", description: str = "", data: pd.DataFrame | None = None, x: str | None = None, y: str | None = None, **_: Any):
    if data is None or x is None or y is None:
        raise ValueError("data, x, and y are required for create_line_chart")
    return {
        "kind": "plotly",
        "title": title,
        "description": description,
        "spec": {
            "data": [
                {
                    "type": "scatter",
                    "mode": "lines+markers",
                    "x": [ensure_json_value(value) for value in data[x].tolist()],
                    "y": [ensure_json_value(value) for value in data[y].tolist()],
                    "name": y,
                }
            ],
            "layout": {"xaxis": {"title": x}, "yaxis": {"title": y}},
            "config": {"displayModeBar": False, "responsive": True},
        },
    }


def create_scatter_chart(title: str = "", description: str = "", data: pd.DataFrame | None = None, x: str | None = None, y: str | None = None, **_: Any):
    if data is None or x is None or y is None:
        raise ValueError("data, x, and y are required for create_scatter_chart")
    return {
        "kind": "plotly",
        "title": title,
        "description": description,
        "spec": {
            "data": [
                {
                    "type": "scatter",
                    "mode": "markers",
                    "x": [ensure_json_value(value) for value in data[x].tolist()],
                    "y": [ensure_json_value(value) for value in data[y].tolist()],
                    "name": y,
                }
            ],
            "layout": {"xaxis": {"title": x}, "yaxis": {"title": y}},
            "config": {"displayModeBar": False, "responsive": True},
        },
    }


def create_scatter_plot(data: pd.DataFrame | None = None, x: str | None = None, y: str | None = None, title: str = "", description: str = "", *args: Any, **_: Any):
    if isinstance(data, pd.DataFrame) and x and y and args:
        remaining = list(args)
        if remaining and isinstance(remaining[0], str) and not title:
            # Ignore optional color/group arg and use the next two strings as title/description when present.
            if len(remaining) >= 3:
                title = str(remaining[1])
                description = str(remaining[2])
    
    return create_scatter_chart(title=title, description=description, data=data, x=x, y=y)


def create_box_plot(title: str = "", description: str = "", data: pd.DataFrame | None = None, x: str | None = None, y: str | None = None, column: str | None = None, *args: Any, **_: Any):
    if isinstance(title, pd.DataFrame):
        data = title
        title = ""
        if isinstance(description, str):
            y = description
        if isinstance(data, pd.DataFrame) and isinstance(x, str):
            x = x

    if isinstance(data, str) and isinstance(title, pd.DataFrame):
        data = title

    if args and isinstance(args[0], pd.DataFrame):
        data = args[0]
        if len(args) >= 2 and isinstance(args[1], str):
            y = args[1]
        if len(args) >= 3 and isinstance(args[2], str):
            x = args[2]

    metric = y or x or column
    if data is None or metric is None:
        raise ValueError("data and a metric column are required for create_box_plot")
    return {
        "data": [
            {
                "type": "box",
                "y": [ensure_json_value(value) for value in data[metric].tolist()],
                "name": metric,
            }
        ],
        "layout": {"yaxis": {"title": metric}},
        "config": {"displayModeBar": False, "responsive": True},
    }


def create_boxplot(*args: Any, **kwargs: Any):
    return create_box_plot(*args, **kwargs)


def create_plotly_panel(kind: str = "plotly", title: str = "Generated Panel", description: str = "Generated panel", spec: dict[str, Any] | None = None, insight: str | None = None, data: list[dict[str, Any]] | None = None, layout: dict[str, Any] | None = None, config: dict[str, Any] | None = None, **_: Any):
    if not isinstance(kind, str):
        args = (kind, title, description, spec, insight, data, layout, config)
        source = args[0] if isinstance(args[0], pd.DataFrame) else None
        dimension = args[1] if isinstance(args[1], str) else None
        measure = args[2] if isinstance(args[2], (str, list)) else None
        panel_title = args[3] if isinstance(args[3], str) else "Generated Panel"
        panel_description = args[4] if isinstance(args[4], str) else "Generated panel"
        panel_kind = args[5] if isinstance(args[5], str) else "plotly"

        if panel_kind == "bar":
            return create_plotly_bar_chart(data=source, x=dimension, y=measure, title=panel_title, description=panel_description)
        if panel_kind == "box":
            return create_box_plot(data=source, x=dimension, y=measure if isinstance(measure, str) else None, title=panel_title, description=panel_description)

        kind = "plotly"
        title = panel_title
        description = panel_description

    chart_kind = kind
    if chart_kind == "box":
        return {
            "kind": "plotly",
            "title": title,
            "description": description,
            "insight": insight,
            "spec": create_box_plot(title=title, description=description, data=data, **_),
        }

    resolved_spec = spec or {
        "data": [] if data is None else data,
        "layout": {} if layout is None else layout,
        "config": {"displayModeBar": False, "responsive": True} if config is None else config,
    }
    return {
        "kind": "plotly",
        "title": title,
        "description": description,
        "insight": insight,
        "spec": resolved_spec,
    }


def create_table_panel(kind: str = "table", title: str = "Generated Table", description: str = "Generated table", columns: list[str] | None = None, rows: list[dict[str, Any]] | None = None, insight: str | None = None, **_: Any):
    if not isinstance(kind, str):
        source = kind if isinstance(kind, pd.DataFrame) else None
        cols = title if isinstance(title, list) else None
        sort_or_title = description if isinstance(description, str) else None
        extra_title = rows if isinstance(rows, str) else None
        extra_description = insight if isinstance(insight, str) else None
        panel_title = extra_title or sort_or_title or "Generated Table"
        panel_description = extra_description or "Generated table"
        if source is not None:
            if cols is None:
                cols = list(source.columns)
            rows = source[cols].to_dict("records")
            columns = cols
            kind = "table"
            title = panel_title
            description = panel_description

    columns = columns or []
    rows = rows or []
    normalized_rows = [
        {column: ensure_json_value(value) for column, value in row.items()}
        for row in rows
    ]
    return {
        "kind": kind,
        "title": title,
        "description": description,
        "insight": insight,
        "columns": columns,
        "rows": normalized_rows,
    }


def create_summary_table(title: str = "", description: str = "", rows: list[dict[str, Any]] | None = None, columns: list[str] | None = None, data: pd.DataFrame | None = None, **_: Any):
    if data is not None:
        rows = data.to_dict("records")
        columns = list(data.columns)
    return create_table_panel("table", title, description, columns or [], rows or [])


def create_data_table(*args: Any, **kwargs: Any):
    return create_summary_table(*args, **kwargs)


def create_table(*args: Any, **kwargs: Any):
    return create_summary_table(*args, **kwargs)


def create_comparison_table(*args: Any, **kwargs: Any):
    return create_summary_table(*args, **kwargs)


def safe_table(title: str, description: str, rows: list[dict[str, Any]]):
    if not rows:
        return None
    columns = list(rows[0].keys())
    normalized = [
        {key: ensure_json_value(value) for key, value in row.items()}
        for row in rows
    ]
    return {
        "kind": "table",
        "title": title,
        "description": description,
        "columns": columns,
        "rows": normalized,
    }
