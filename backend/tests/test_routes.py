"""Focused tests for route fallback persistence and public error boundaries."""

import json

from app import routes


def test_save_routes_file_replaces_target_without_leaving_temp_files(tmp_path, monkeypatch):
    target = tmp_path / "saved_routes.json"
    target.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(routes, "ROUTES_FILE", target)

    routes._save_routes_file([{"id": "route-1"}])

    assert json.loads(target.read_text(encoding="utf-8")) == [{"id": "route-1"}]
    assert list(tmp_path.glob("*.tmp")) == []
