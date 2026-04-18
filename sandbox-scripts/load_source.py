import json
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import pandas as pd


CONFIG_PATH = Path("/home/user/viewpilot/source-config.json")
OUTPUT_PATH = Path("/home/user/data.csv")
SOURCE_NAME_PATH = Path("/home/user/viewpilot/source-name.txt")


def dig(payload, dotted_path):
    current = payload
    for part in dotted_path.split("."):
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def fetch_json(request_config):
    method = (request_config.get("method") or "GET").upper()
    headers = request_config.get("headers") or {}
    body = request_config.get("body")
    data = None

    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            **headers,
        }

    request = Request(
        request_config["url"],
        data=data,
        headers=headers,
        method=method,
    )

    try:
        with urlopen(request, timeout=60) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            return json.loads(response.read().decode(charset))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"API request failed with {error.code}: {detail}") from error
    except URLError as error:
        raise RuntimeError(f"API request failed: {error.reason}") from error


config = json.loads(CONFIG_PATH.read_text())
kind = config.get("kind")
label = config.get("label") or "API demo dataset"

if kind != "api":
    raise RuntimeError(f"Unsupported source kind: {kind}")

payload = fetch_json(config["request"])
records_path = (config.get("response") or {}).get("recordsPath")
records = dig(payload, records_path) if records_path else payload

if not isinstance(records, list):
    raise RuntimeError("The API source did not resolve to a list of records.")

df = pd.json_normalize(records)

if df.empty:
    raise RuntimeError("The API source returned no rows.")

df.to_csv(OUTPUT_PATH, index=False)
SOURCE_NAME_PATH.write_text(label)

summary = {
    "label": label,
    "rows": int(len(df)),
    "columns": int(len(df.columns)),
    "columnsPreview": df.columns.tolist()[:10],
}

print("SOURCE_JSON:" + json.dumps(summary))
