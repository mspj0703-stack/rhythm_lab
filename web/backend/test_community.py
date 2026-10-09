from __future__ import annotations

import copy
import json
import sys
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "analyzer"))

from app import app  # noqa: E402
import community  # noqa: E402

client = TestClient(app)
AUTHOR = str(uuid.uuid4())
SECRET = str(uuid.uuid4())


@pytest.fixture(autouse=True)
def fresh_store(tmp_path):
    community.store.use(tmp_path / "community.sqlite3")
    yield


def payload(**overrides):
    body = {
        "authorId": AUTHOR, "authorSecret": SECRET, "origin": "human-edited",
        "editSummary": {"added": 1, "removed": 0, "unchanged": 3},
        "title": "HARD 편집본", "description": "손 교대 수정", "chartVersion": 1,
        "song": {"title": "My Song", "originalTitle": "My Song (Official)", "durationSec": 30.0, "bpm": 120.0,
                 "fingerprint": "v2:" + "a" * 64},
        "chart": {"version": 5, "platformProfile": "mobile", "scoringVersion": 2, "title": "My Song", "artist": "",
                  "bpm": 120, "offset": 0, "difficulty": "Hard", "level": 10,
                  "notes": [{"time": 1, "lane": 0, "type": "tap"}, {"time": 1.5, "lane": 1, "type": "hold", "duration": 0.5},
                            {"time": 2, "lane": 2, "type": "flick"}, {"time": 3, "lane": 3, "type": "tap"}]},
    }
    for key, value in overrides.items():
        body[key] = value
    return body


def upload(body=None):
    return client.post("/api/community/charts", content=json.dumps(body or payload()), headers={"Content-Type": "application/json"})


def test_human_edited_upload_and_fetch():
    r = upload()
    assert r.status_code == 200, r.text
    item = r.json()
    assert item["difficulty"] == "hard" and item["platformProfile"] == "mobile" and item["downloadCount"] == 0
    assert item["noteCount"] == 4 and item["lastNoteSec"] == 3 and item["authorId"] == AUTHOR
    assert "authorSecret" not in json.dumps(item)
    detail = client.get(f"/api/community/charts/{item['cloudChartId']}").json()
    assert detail["chartData"]["notes"][1] == {"time": 1.5, "lane": 1, "type": "hold", "duration": 0.5}
    assert detail["chartData"]["platformProfile"] == "mobile" and detail["chartData"]["difficulty"] == "hard"


@pytest.mark.parametrize("mutate,status", [
    (lambda b: b.update(origin="ai"), 422),
    (lambda b: b.update(editSummary={"added": 0, "removed": 0, "unchanged": 4}), 422),
    (lambda b: b["chart"].update(version=6), 422),
    (lambda b: b.update(authorId="not-a-uuid"), 400),
    (lambda b: b["chart"].update(platformProfile="legacy"), 400),
    (lambda b: b["chart"].update(difficulty="insane"), 400),
    (lambda b: b["chart"]["notes"].append({"time": 4, "lane": 4, "type": "tap"}), 400),
    (lambda b: b["chart"]["notes"].append({"time": 4, "lane": True, "type": "tap"}), 400),
    (lambda b: b["chart"]["notes"].append({"time": -1, "lane": 0, "type": "tap"}), 400),
    (lambda b: b["chart"]["notes"].append({"time": 40, "lane": 0, "type": "tap"}), 400),
    (lambda b: b["chart"]["notes"].append({"time": 5, "lane": 0, "type": "slide"}), 400),
    (lambda b: b["chart"]["notes"].append({"time": 5, "lane": 0, "type": "hold", "duration": 0}), 400),
    (lambda b: b["chart"]["notes"].append({"time": 5, "lane": 0, "type": "hold"}), 400),
    (lambda b: b["chart"]["notes"].append({"time": 1, "lane": 0, "type": "tap"}), 400),
    (lambda b: b["chart"]["notes"].append({"time": 1.75, "lane": 1, "type": "tap"}), 400),
    (lambda b: b["chart"]["notes"].append({"time": 3.02, "lane": 3, "type": "tap"}), 400),
    (lambda b: b["chart"].update(notes=[{"time": 1, "lane": i, "type": "tap"} for i in range(4)]), 400),
    (lambda b: b["chart"].update(notes=[{"time": 1 + i * 0.03, "lane": i % 4, "type": "tap"} for i in range(30)]), 400),
    (lambda b: b["chart"].update(notes=[]), 400),
    (lambda b: b["song"].update(durationSec=float("nan")), 400),
    (lambda b: b["song"].update(fingerprint="sha1:abc"), 400),
])
def test_rejects_invalid_or_untouched_charts(mutate, status):
    body = copy.deepcopy(payload())
    mutate(body)
    r = client.post("/api/community/charts", content=json.dumps(body, allow_nan=True), headers={"Content-Type": "application/json"})
    assert r.status_code == status, r.text


def test_desktop_flick_is_rejected_but_desktop_chords_allowed():
    body = payload()
    body["chart"]["platformProfile"] = "desktop"
    assert upload(body).status_code == 400
    body["chart"]["notes"] = [{"time": 1, "lane": 0, "type": "tap"}, {"time": 1, "lane": 3, "type": "tap"}, {"time": 2, "lane": 1, "type": "hold", "duration": 0.5}]
    assert upload(body).status_code == 200


def test_payload_size_limit_and_bad_json():
    huge = payload()
    huge["description"] = "x" * 400
    huge["chart"]["notes"] = [{"time": round(i * 0.3, 3), "lane": i % 4, "type": "tap", "pad": "y" * 200} for i in range(4000)]
    r = client.post("/api/community/charts", content=json.dumps(huge), headers={"Content-Type": "application/json"})
    assert r.status_code == 413
    r = client.post("/api/community/charts", content=b"{not json", headers={"Content-Type": "application/json"})
    assert r.status_code == 400


def test_unknown_fields_are_not_stored():
    body = payload()
    body["chart"]["evil"] = "<script>"
    body["chart"]["notes"][0]["extra"] = 1
    item = upload(body).json()
    detail = client.get(f"/api/community/charts/{item['cloudChartId']}").json()
    assert "evil" not in detail["chartData"] and "extra" not in detail["chartData"]["notes"][0]


def test_duplicate_upload_conflicts():
    assert upload().status_code == 200
    assert upload().status_code == 409


def _upload_variant(title, difficulty, platform, song_title, lane_shift=0):
    body = payload(title=title)
    body["song"]["title"] = song_title
    body["chart"].update(difficulty=difficulty, platformProfile=platform)
    body["chart"]["notes"] = [{"time": 1 + lane_shift * 0.1, "lane": lane_shift % 4, "type": "tap"}, {"time": 2, "lane": 1, "type": "tap"}]
    r = upload(body)
    assert r.status_code == 200, r.text
    return r.json()["cloudChartId"]


def test_search_filters_sort_and_download_count():
    a = _upload_variant("Alpha edit", "hard", "mobile", "Blue Sky", 0)
    b = _upload_variant("Beta edit", "extreme", "desktop", "Red Moon", 1)
    c = _upload_variant("Gamma edit", "hard", "desktop", "Blue Ocean", 2)
    ids = lambda r: [item["cloudChartId"] for item in r.json()["items"]]  # noqa: E731
    assert ids(client.get("/api/community/charts")) == [c, b, a]
    assert set(ids(client.get("/api/community/charts", params={"q": "blue"}))) == {a, c}
    assert ids(client.get("/api/community/charts", params={"q": "gamma"})) == [c]
    assert ids(client.get("/api/community/charts", params={"q": "100%_"})) == []
    assert ids(client.get("/api/community/charts", params={"platform": "desktop"})) == [c, b]
    assert ids(client.get("/api/community/charts", params={"platform": "mobile"})) == [a]
    assert ids(client.get("/api/community/charts", params={"difficulty": "hard"})) == [c, a]
    assert ids(client.get("/api/community/charts", params={"difficulty": "hard", "platform": "desktop"})) == [c]
    for _ in range(2):
        assert client.post(f"/api/community/charts/{a}/download").status_code == 200
    assert client.post(f"/api/community/charts/{b}/download").json()["downloadCount"] == 1
    r = client.get("/api/community/charts", params={"sort": "downloads"})
    assert ids(r) == [a, b, c] and r.json()["total"] == 3
    # Plain GET does not count a download.
    assert client.get(f"/api/community/charts/{a}").json()["downloadCount"] == 2
    assert client.get("/api/community/charts", params={"platform": "legacy"}).status_code == 400
    assert client.get("/api/community/charts", params={"sort": "random"}).status_code == 400
    assert client.get("/api/community/charts/not-a-valid-id").status_code == 404
    assert client.get("/api/community/charts/" + "0" * 32).status_code == 404


def test_update_and_delete_require_the_author_secret():
    item = upload().json()
    chart_id = item["cloudChartId"]
    body = payload(chartVersion=2)
    body["chart"]["notes"].append({"time": 4, "lane": 0, "type": "tap"})
    other = dict(body, authorSecret=str(uuid.uuid4()))
    assert client.put(f"/api/community/charts/{chart_id}", content=json.dumps(other)).status_code == 403
    r = client.put(f"/api/community/charts/{chart_id}", content=json.dumps(body))
    assert r.status_code == 200 and r.json()["chartVersion"] == 2 and r.json()["noteCount"] == 5
    assert client.request("DELETE", f"/api/community/charts/{chart_id}", content=json.dumps({"authorId": AUTHOR, "authorSecret": str(uuid.uuid4())})).status_code == 403
    assert client.request("DELETE", f"/api/community/charts/{chart_id}", content=json.dumps({"authorId": AUTHOR, "authorSecret": SECRET})).status_code == 200
    assert client.get(f"/api/community/charts/{chart_id}").status_code == 404
    assert client.get("/api/community/charts").json()["total"] == 0


def test_upload_rate_limit(monkeypatch):
    monkeypatch.setattr(community, "MAX_UPLOADS_PER_HOUR", 2)
    for shift in range(2):
        _upload_variant(f"t{shift}", "hard", "mobile", "s", shift)
    body = payload()
    body["chart"]["notes"] = [{"time": 9, "lane": 0, "type": "tap"}]
    assert upload(body).status_code == 429


def test_media_is_never_part_of_the_api():
    body = payload()
    body["mediaBlob"] = "data:audio/wav;base64,AAAA"
    item = upload(body).json()
    detail = client.get(f"/api/community/charts/{item['cloudChartId']}").json()
    assert "mediaBlob" not in json.dumps(detail)


FIXTURES = sorted((ROOT / "src/__tests__/fixtures/v5").glob("*.json"))


@pytest.mark.parametrize("fixture", FIXTURES, ids=[f.stem for f in FIXTURES])
def test_every_generated_profile_round_trips_through_the_server(fixture):
    chart = json.loads(fixture.read_text(encoding="utf-8"))
    last = max(n["time"] + n.get("duration", 0) for n in chart["notes"])
    body = payload()
    body["song"]["durationSec"] = float(int(last) + 5)
    body["chart"] = chart
    r = upload(body)
    assert r.status_code == 200, r.text
    detail = client.post(f"/api/community/charts/{r.json()['cloudChartId']}/download").json()
    assert detail["chartData"]["notes"] == sorted(chart["notes"], key=lambda n: (n["time"], n["lane"]))
    assert detail["platformProfile"] == chart["platformProfile"] and detail["scoringVersion"] == 2


def test_fixture_count():
    assert len(FIXTURES) == 10


def test_master_alias_maps_to_internal_extreme():
    body = payload()
    body["chart"]["difficulty"] = "MASTER"
    item = upload(body).json()
    assert item["difficulty"] == "extreme"
    assert [i["cloudChartId"] for i in client.get("/api/community/charts", params={"difficulty": "master"}).json()["items"]] == [item["cloudChartId"]]
    assert [i["cloudChartId"] for i in client.get("/api/community/charts", params={"difficulty": "extreme"}).json()["items"]] == [item["cloudChartId"]]
