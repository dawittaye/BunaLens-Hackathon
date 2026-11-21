"""Inspect the candidate Kaggle datasets without training anything.

Reads public metadata and file listings from the Kaggle API and writes
ml/dataset_inspection.json. Class names and counts are derived from the
folder names in the listing, so they describe how the files are organised,
not verified label quality. No image is opened by this script.

    python ml/inspect_datasets.py
"""
import json
import os
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone

CANDIDATES = [
    "patopucho/lojano-arabica-coffee",
    "j4ckdev/green-coffee-beans-dataset",
    "sot2542/coffee-bean-dataset-v2",
    "gpiosenka/coffee-bean-dataset-resized-224-x-224",
    "harisyunanda/dataset-coffee-cherry",
    "asimmahmudov/top-rated-coffee",
]
API = "https://www.kaggle.com/api/v1/datasets/"
MAX_PAGES = 12
PAGE_SIZE = 200
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".bmp", ".webp")


def get(path):
    request = urllib.request.Request(API + path, headers={"User-Agent": "bunalens-sprint/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def inspect(ref):
    out = {"ref": ref, "url": "https://www.kaggle.com/datasets/" + ref}
    try:
        meta = get("view/" + ref)
        out.update({
            "title": meta.get("title"),
            "license": meta.get("licenseName"),
            "version": meta.get("currentVersionNumber"),
            "last_updated": meta.get("lastUpdated"),
            "total_bytes": meta.get("totalBytes"),
            "subtitle": meta.get("subtitle"),
        })
    except Exception as error:  # noqa: BLE001 - recorded as the blocker
        out["metadata_error"] = repr(error)
        return out
    names, token, pages = [], None, 0
    try:
        while pages < MAX_PAGES:
            query = "?pageSize=%d" % PAGE_SIZE + ("&pageToken=" + urllib.parse.quote(token) if token else "")
            page = get("list/" + ref + query)
            names += [f.get("name", "") for f in page.get("datasetFiles", [])]
            token = page.get("nextPageToken")
            pages += 1
            if not token:
                break
    except Exception as error:  # noqa: BLE001
        out["listing_error"] = repr(error)
    out["files_listed"] = len(names)
    out["listing_truncated"] = bool(token)
    images = [n for n in names if n.lower().endswith(IMAGE_EXT)]
    out["images_listed"] = len(images)
    out["other_files"] = sorted({n for n in names if not n.lower().endswith(IMAGE_EXT)})[:25]
    out["extension_counts"] = dict(Counter(os.path.splitext(n)[1].lower() for n in names))
    # Folder paths (without the file name) show how labels are encoded.
    out["folder_image_counts"] = dict(sorted(Counter(os.path.dirname(n) for n in images).items())[:60])
    out["sample_files"] = names[:5]
    return out


if __name__ == "__main__":
    report = {
        "inspected_at": datetime.now(timezone.utc).isoformat(),
        "method": "Kaggle public API metadata and file listings; listing capped at %d files per dataset" % (MAX_PAGES * PAGE_SIZE),
        "datasets": [inspect(ref) for ref in CANDIDATES],
    }
    target = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dataset_inspection.json")
    with open(target, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=1)
    for item in report["datasets"]:
        print(item["ref"], "|", item.get("license"), "| files", item.get("files_listed"), "| truncated", item.get("listing_truncated"))
