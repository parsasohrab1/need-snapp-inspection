from fastapi.testclient import TestClient

from app.db import reset_engine
from app.main import app

TEST_SIGNATURE_PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"


def test_login_board_and_health():
    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["trl"] == 5
        denied = client.get("/api/board")
        assert denied.status_code == 401
        logged = client.post("/api/auth/login", json={"username": "coordinator", "password": "demo1234"})
        assert logged.status_code == 200
        assert logged.json()["role"] == "coordinator"
        board = client.get("/api/board")
        assert board.status_code == 200
        assert len(board.json()) == 41
        dash = client.get("/api/dashboard").json()
        assert dash["points_total"] == 41
        assert {item["id"] for item in dash["modes"]} == {"project", "case"}
        assert client.get("/api/board?kind=project").json().__len__() == 40
        cases = client.get("/api/board?kind=case").json()
        assert len(cases) == 1
        assert cases[0]["tag"] == "PSV-12"
        assert cases[0]["kind"] == "case"
        assert cases[0]["status"] == "ready"
        assert client.get("/api/board?kind=other").status_code == 400
        assert dash["by_status"]["accepted"] >= 1
        rows = board.json()
        en_route = next(row for row in rows if row["status"] == "en_route")
        assert en_route["assignee"] == "حسین مرادی"
        assert en_route["dispatch_method"] == "manual"
        assert "اعزام" in en_route["dispatch_sentence"]
        accepted = next(row for row in rows if row["status"] == "accepted")
        assert accepted["assignee"]
        assert accepted["dispatch_method"] == "first_accept"
        assert "انتخاب و اعزام" in accepted["dispatch_sentence"]
        offering = next(row for row in rows if row["status"] == "offering")
        assert offering["offered"]
        assert offering["assignee"] == ""
        detail = client.get(f"/api/points/{en_route['id']}").json()
        assert detail["selection"]["inspector"] == "حسین مرادی"


def test_project_archive_contains_inspector_signatures_documents_and_photos():
    reset_engine()
    with TestClient(app) as client:
        client.post("/api/auth/login", json={"username": "coordinator", "password": "demo1234"})
        response = client.get("/api/archive/projects")
        assert response.status_code == 200
        archive = response.json()
        assert archive
        project = archive[0]
        assert project["purchase_orders"]
        report = next(
            report
            for item in project["equipment"]
            for point in item["completed_points"]
            for report in point["reports"]
        )
        assert report["inspector"]
        assert report["signature_verified"] is True
        assert report["signed_by"] == report["inspector"]
        assert report["photos"]
        document = next(doc for item in project["equipment"] for doc in item["documents"])
        assert document["filename"]
        assert document["download_url"] == ""


def test_uploaded_documents_are_downloadable_in_project_archive(tmp_path, monkeypatch):
    from app.services import files

    reset_engine()
    monkeypatch.setattr(files, "DOCUMENT_DIR", tmp_path)
    with TestClient(app) as client:
        client.post("/api/auth/login", json={"username": "vendor", "password": "demo1234"})
        board = client.get("/api/board?kind=project").json()
        upload = client.post(
            "/api/documents/upload",
            data={"equipment_id": board[0]["equipment_id"], "doc_type": "drawing"},
            files={"file": ("drawing.pdf", b"%PDF-1.4 archive test", "application/pdf")},
        )
        assert upload.status_code == 200
        document_id = upload.json()["id"]
        downloaded = client.get(f"/api/documents/{document_id}/file")
        assert downloaded.status_code == 200
        assert downloaded.content == b"%PDF-1.4 archive test"
        project = client.get("/api/archive/projects").json()[0]
        archived_document = next(
            doc
            for item in project["equipment"]
            for doc in item["documents"]
            if doc["id"] == document_id
        )
        assert archived_document["download_url"] == f"/api/documents/{document_id}/file"


def test_project_manager_and_executive_manager_have_distinct_roles():
    with TestClient(app) as client:
        response = client.post("/api/auth/login", json={"username": "manager", "password": "demo1234"})
        assert response.status_code == 200
        assert response.json()["role"] == "manager"
        assert "مدیر پروژه" in response.json()["name"]
        executive = client.post("/api/auth/login", json={"username": "executive", "password": "demo1234"})
        assert executive.status_code == 200
        assert executive.json()["role"] == "executive_manager"


def test_project_manager_desk_shows_only_operational_lists_and_accounting_status():
    reset_engine()
    with TestClient(app) as client:
        client.post("/api/auth/login", json={"username": "manager", "password": "demo1234"})
        waiting_reports = client.get("/api/reports/inbox").json()
        accepted_report = next((row for row in waiting_reports if row["result"] == "accept"), None)
        if accepted_report:
            approved = client.post(
                f"/api/visits/{accepted_report['visit_id']}/review",
                json={"decision": "approve"},
            )
            assert approved.status_code == 200
            client.post("/api/auth/login", json={"username": "buyer", "password": "demo1234"})
            client.post(f"/api/visits/{accepted_report['visit_id']}/confirm")
            client.post("/api/auth/login", json={"username": "manager", "password": "demo1234"})
        desk = client.get("/api/manager/desk")
        assert desk.status_code == 200
        body = desk.json()
        assert body["clients"]
        assert body["projects"]
        assert all(project["itp_count"] == project["equipment_count"] for project in body["projects"])
        assert all(project["itp_point_count"] == project["inspection_count"] for project in body["projects"])
        assert "selected_for_dispatch" in body
        assert body["inspectors"]
        assert "incomplete_inspections" in body
        assert "not_done_inspections" in body
        assert "performed_reports" in body
        assert "approved_reports" in body
        assert "rejected_reports" in body
        assert "missing_documents" in body
        assert "awaiting_report_review" in body
        assert "statements" in body
        assert all("accounting_status" in statement for statement in body["statements"])
        assert client.get("/api/bills").status_code == 200

        assert body["statements"]
        statement = body["statements"][0]
        returned_without_reason = client.post(
            f"/api/bills/{statement['id']}/accounting-status",
            json={"status": "returned"},
        )
        assert returned_without_reason.status_code == 400
        returned = client.post(
            f"/api/bills/{statement['id']}/accounting-status",
            json={"status": "returned", "note": "پیوست‌های مالی ناقص است"},
        )
        assert returned.status_code == 200
        assert returned.json()["accounting_status"] == "returned"
        refreshed = client.get("/api/manager/desk").json()
        updated = next(row for row in refreshed["statements"] if row["id"] == statement["id"])
        assert updated["accounting_note"] == "پیوست‌های مالی ناقص است"

        client.post("/api/auth/login", json={"username": "buyer", "password": "demo1234"})
        assert client.get("/api/manager/desk").status_code == 403
        assert client.get("/api/bills").status_code == 200
        assert all(
            not row["assignee"] and not row["dispatch_sentence"]
            for row in client.get("/api/board").json()
        )


def test_benchmark_cites_sources_and_technology_lists_clients():
    with TestClient(app) as client:
        client.post("/api/auth/login", json={"username": "coordinator", "password": "demo1234"})
        benchmark = client.get("/api/benchmark")
        assert benchmark.status_code == 200
        body = benchmark.json()
        names = {item["name"] for item in body["systems"]}
        assert "QIMA / myQIMA" in names
        assert "Hexagon Smart Completions" in names
        for system in body["systems"]:
            assert system["sources"]
            for source in system["sources"]:
                assert source["url"].startswith("http") or source["url"].startswith("docs/")
        assert body["institutional"]["sources"][0]["url"].startswith("https://www.iso.org/")
        technology = client.get("/api/technology").json()
        layers = {item["id"]: item["status"] for item in technology["layers"]}
        assert layers["backend"] == "running"
        assert layers["frontend"] == "running"
        assert layers["windows"] == "host"
        assert layers["android"] == "absent"
        assert layers["ios"] == "absent"


def test_blank_forms_start_empty_and_keep_filled_lines():
    with TestClient(app) as client:
        client.post("/api/auth/login", json={"username": "executive", "password": "demo1234"})
        for kind, code in (("in", "IN"), ("itp", "ITP"), ("ivr", "IVR"), ("mom", "MOM")):
            template = client.get(f"/api/forms/template/{kind}")
            assert template.status_code == 200
            body = template.json()
            assert body["code"] == code
            assert body["payload"]["number"] == ""
            if kind == "in":
                in_fields = {
                    field["key"]
                    for section in body["sections"]
                    for field in section["fields"]
                }
                assert {"customer_location", "client", "contractor", "vendor", "manufacturer", "pi", "inspection_date", "duration", "contact", "reference_documents", "materials", "scope", "advance_notice"} <= in_fields
            for table in body.get("tables") or []:
                assert table["rows"] >= 1
                assert all(value == "" for row in body["payload"][table["key"]] for value in row.values())
        international = client.post(
            "/api/forms",
            json={
                "kind": "in",
                "payload": {
                    "customer_location": "international",
                    "client": "Overseas client",
                    "number": "IN-OVERSEAS-1",
                    "date": "2026-11-11",
                    "project": "Project A",
                    "po": "PO-1",
                    "location": "Workshop",
                    "tag": "V-1",
                    "itp_item": "1",
                    "discipline": "mechanical",
                    "reference": "ASME",
                    "scope": "Material check",
                    "category": "inspection",
                },
            },
        )
        assert international.status_code == 200
        international_form = client.get(f"/api/forms/{international.json()['id']}").json()
        assert international_form["payload"]["customer_location"] == "international"
        assert international_form["payload"]["client"] == "Overseas client"
        saved = client.post(
            "/api/forms",
            json={
                "kind": "itp",
                "payload": {
                    "number": "ITP-1",
                    "date": "2026-11-11",
                    "client": "Client A",
                    "vendor": "Vendor A",
                    "project": "Project A",
                    "po": "PO-1",
                    "tag": "V-1",
                    "code": "ASME",
                    "lines": [{
                        "item": "1",
                        "activity": "Material check",
                        "reference": "ASME",
                        "criteria": "Approved",
                        "intervention": "H",
                    }],
                },
            },
        )
        assert saved.status_code == 200
        stored = client.get(f"/api/forms/{saved.json()['id']}").json()
        assert stored["payload"]["number"] == "ITP-1"
        assert stored["payload"]["lines"][0]["item"] == "1"
        assert stored["payload"]["lines"][0]["intervention"] == "H"
        assert stored["payload"]["lines"][1]["activity"] == ""
        assert stored["payload"]["client"] == "Client A"


def test_mobile_photos_of_item_place_and_marker():
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
    with TestClient(app) as client:
        client.post("/api/auth/login", json={"username": "coordinator", "password": "demo1234"})
        board = client.get("/api/board?kind=project").json()
        point = next(row for row in board if row["status"] == "ready" and row["point_type"] in {"H", "W"})
        assert client.post(f"/api/points/{point['id']}/broadcast").status_code == 200
        offer = None
        for username in ("inspector.reza", "inspector.kaveh", "inspector.maryam", "inspector.hossein", "inspector.sara", "inspector.elham"):
            client.post("/api/auth/login", json={"username": username, "password": "demo1234"})
            inbox = client.get("/api/offers/inbox").json()
            offer = next((row for row in inbox if row["point"]["id"] == point["id"]), None)
            if offer:
                break
        assert offer is not None
        accepted = client.post(f"/api/offers/{offer['offer']['id']}/accept")
        assert accepted.status_code == 200
        visit_id = accepted.json()["visit_id"]
        detail = client.get(f"/api/points/{point['id']}").json()
        assert client.post(f"/api/visits/{visit_id}/en-route").status_code == 200
        arrived = client.post(
            f"/api/visits/{visit_id}/arrive",
            json={"lat": detail["equipment"]["lat"], "lng": detail["equipment"]["lng"]},
        )
        assert arrived.status_code == 200
        answers = [{"item_id": item["id"], "value": "pass", "note": ""} for item in detail["point"]["checklist"]]
        assert client.post(f"/api/visits/{visit_id}/checklist", json={"answers": answers}).status_code == 200
        blocked = client.post(f"/api/visits/{visit_id}/submit", json={"result": "accept", "note": "بازدید حضوری ثبت شد."})
        assert blocked.status_code == 409
        assert "پیکان‌کار" in blocked.json()["message"]
        for kind in ("item", "environment", "marker"):
            uploaded = client.post(
                f"/api/visits/{visit_id}/photo",
                data={"kind": kind, "lat": detail["equipment"]["lat"], "lng": detail["equipment"]["lng"]},
                files={"file": ("shot.png", png, "image/png")},
            )
            assert uploaded.status_code == 200
        video = client.post(
            f"/api/visits/{visit_id}/attachments",
            data={"kind": "item", "caption": "ویدئوی آزمون"},
            files={"file": ("inspection.mp4", b"\x00\x00\x00\x18ftypisom", "video/mp4")},
        )
        assert video.status_code == 200
        sent = client.post(f"/api/visits/{visit_id}/submit", json={"result": "accept", "note": "بازدید حضوری ثبت شد."})
        assert sent.status_code == 200
        report = client.get(f"/api/visits/{visit_id}/ivr").json()
        assert {row["kind"] for row in report["photos"]} == {"item", "environment", "marker"}
        video_row = next(row for row in report["photos"] if row["filename"] == "inspection.mp4")
        downloaded_video = client.get(video_row["url"])
        assert downloaded_video.status_code == 200
        assert downloaded_video.content == b"\x00\x00\x00\x18ftypisom"
        photo = client.get(report["photos"][0]["url"])
        assert photo.status_code == 200
        assert photo.content.startswith(b"\x89PNG")


def test_later_stage_sees_previous_reports_and_defects():
    with TestClient(app) as client:
        client.post("/api/auth/login", json={"username": "inspector.reza", "password": "demo1234"})
        board = client.get("/api/board").json()
        point = next(row for row in board if row["ncr_open"])
        detail = client.get(f"/api/points/{point['id']}").json()
        same = [row for row in detail["history"] if row["same_point"]]
        assert same
        assert same[0]["result"] == "reject"
        assert same[0]["defects"]
        assert "بریدگی" in same[0]["defects"][0]["note"]
        assert any(not row["same_point"] for row in detail["history"])


def test_project_manager_review_releases_or_returns_report():
    reset_engine()
    with TestClient(app) as client:
        client.post("/api/auth/login", json={"username": "manager", "password": "demo1234"})
        inbox = client.get("/api/reports/inbox")
        assert inbox.status_code == 200
        waiting = inbox.json()
        assert waiting
        report = waiting[0]
        assert report["ivr_no"].startswith("IVR-")
        assert report["result"] == "accept"
        client.post("/api/auth/login", json={"username": "buyer", "password": "demo1234"})
        assert client.get("/api/reports/inbox").status_code == 403
        before = client.get("/api/reports/client")
        assert before.status_code == 200
        assert all(row["visit_id"] != report["visit_id"] for row in before.json())
        blocked = client.post(f"/api/visits/{report['visit_id']}/review", json={"decision": "approve"})
        assert blocked.status_code == 403
        client.post("/api/auth/login", json={"username": "manager", "password": "demo1234"})
        approved = client.post(f"/api/visits/{report['visit_id']}/review", json={"decision": "approve"})
        assert approved.status_code == 200
        assert client.get("/api/reports/inbox").json() == []
        client.post("/api/auth/login", json={"username": "buyer", "password": "demo1234"})
        released = client.get("/api/reports/client").json()
        assert any(row["visit_id"] == report["visit_id"] for row in released)
        report_notification = next(
            row for row in client.get("/api/notifications").json()
            if row["title"] == "گزارش تأییدشده در کارتابل کارفرما"
        )
        assert report_notification["target"] == {"type": "ivr", "id": report["visit_id"]}
        client.post("/api/auth/login", json={"username": "vendor", "password": "demo1234"})
        assert client.get("/api/reports/client").status_code == 403


def test_project_manager_returns_report_when_discrepant():
    reset_engine()
    with TestClient(app) as client:
        client.post("/api/auth/login", json={"username": "manager", "password": "demo1234"})
        report = client.get("/api/reports/inbox").json()[0]
        returned = client.post(
            f"/api/visits/{report['visit_id']}/review",
            json={"decision": "return", "note": "مدارک گزارش باید توسط مدیر واحد دوباره بررسی شود"},
        )
        assert returned.status_code == 200
        assert returned.json()["visit"]["report_stage"] == "unit_review"
        detail = client.get(f"/api/points/{report['point_id']}").json()
        assert detail["point"]["status"] == "submitted"
        client.post("/api/auth/login", json={"username": "unit.manager", "password": "demo1234"})
        assert any(row["visit_id"] == report["visit_id"] for row in client.get("/api/unit-manager/desk").json()["reports"])
        client.post("/api/auth/login", json={"username": "buyer", "password": "demo1234"})
        released = client.get("/api/reports/client").json()
        assert all(row["visit_id"] != report["visit_id"] for row in released)


def test_report_pipeline_reaches_buyer_and_creates_invoice_only_after_confirmation():
    reset_engine()
    with TestClient(app) as client:
        client.post("/api/auth/login", json={"username": "unit.manager", "password": "demo1234"})
        report = next(
            row for row in client.get("/api/unit-manager/desk").json()["reports"]
            if row["result"] == "accept"
        )
        before = client.post(f"/api/visits/{report['visit_id']}/review", json={"decision": "approve"})
        assert before.status_code == 200
        assert before.json()["visit"]["report_stage"] == "manager_review"
        client.post("/api/auth/login", json={"username": "manager", "password": "demo1234"})
        assert any(row["visit_id"] == report["visit_id"] for row in client.get("/api/reports/inbox").json())

        manager_approved = client.post(
            f"/api/visits/{report['visit_id']}/review",
            json={"decision": "approve"},
        )
        assert manager_approved.status_code == 200
        assert manager_approved.json()["visit"]["report_stage"] == "client_review"

        client.post("/api/auth/login", json={"username": "buyer", "password": "demo1234"})
        released = next(
            row for row in client.get("/api/reports/client").json()
            if row["visit_id"] == report["visit_id"]
        )
        assert released["evidence_count"] >= 0
        assert released["document_count"] >= 0
        ivr = client.get(f"/api/visits/{report['visit_id']}/ivr")
        assert ivr.status_code == 200
        report_detail = ivr.json()
        assert report_detail["visit"]["report_stage"] == "client_review"
        assert report_detail["answers"]
        assert all("download_url" in document for document in report_detail["context"]["documents"])
        assert all("url" in evidence for evidence in report_detail["photos"])
        assert all(row["visit_id"] != report["visit_id"] for row in client.get("/api/bills").json())
        confirmed = client.post(f"/api/visits/{report['visit_id']}/confirm")
        assert confirmed.status_code == 200
        assert confirmed.json()["visit"]["report_stage"] == "confirmed"
        assert any(row["visit_id"] == report["visit_id"] for row in client.get("/api/bills").json())


def test_unit_manager_returns_report_to_inspector_for_revision():
    reset_engine()
    with TestClient(app) as client:
        client.post("/api/auth/login", json={"username": "unit.manager", "password": "demo1234"})
        report = next(
            row for row in client.get("/api/unit-manager/desk").json()["reports"]
            if row["result"] == "reject"
        )
        returned = client.post(
            f"/api/visits/{report['visit_id']}/review",
            json={"decision": "return", "note": "پیوست‌های اصلاحی و نتیجه آزمون را تکمیل کنید"},
        )
        assert returned.status_code == 200
        assert returned.json()["visit"]["phase"] == "on_site"
        assert returned.json()["visit"]["report_stage"] == "inspector_revision"

        active_visit = None
        for username in (
            "inspector.reza",
            "inspector.maryam",
            "inspector.hossein",
            "inspector.sara",
            "inspector.kaveh",
            "inspector.elham",
            "inspector.payam",
            "inspector.nima",
        ):
            client.post("/api/auth/login", json={"username": username, "password": "demo1234"})
            current = client.get("/api/visits/active").json()
            if current and current["visit"]["id"] == report["visit_id"]:
                active_visit = current
                break
        assert active_visit is not None
        checklist = active_visit["context"]["point"]["checklist"]
        answers = [{"item_id": row["id"], "value": "pass", "note": ""} for row in checklist]
        assert client.post(
            f"/api/visits/{report['visit_id']}/checklist",
            json={"answers": answers},
        ).status_code == 200
        resubmitted = client.post(
            f"/api/visits/{report['visit_id']}/submit",
            json={"result": "accept", "note": "موارد اصلاح شد و بازرسی دوباره انجام شد"},
        )
        assert resubmitted.status_code == 200
        assert resubmitted.json()["visit"]["report_stage"] == "unit_review"


def test_buyer_in_request_manager_unit_dispatch_and_form_access(monkeypatch, tmp_path):
    reset_engine()
    monkeypatch.setenv("NSI_DATABASE_URL", "sqlite://")
    monkeypatch.setattr("app.services.files.REQUEST_SIGNATURE_DIR", tmp_path)
    try:
        with TestClient(app) as client:
            assert client.post("/api/auth/login", json={"username": "manager", "password": "demo1234"}).status_code == 200
            board = client.get("/api/board?kind=project").json()
            point = next(
                row for row in board
                if row["request_status"] == "draft"
                and row["status"] in {"ready", "planned"}
            )
            point_detail = client.get(f"/api/points/{point['id']}").json()

            if point_detail["point"]["missing_docs"]:
                client.post("/api/auth/login", json={"username": "vendor", "password": "demo1234"})
                for missing in point_detail["point"]["missing_docs"]:
                    uploaded = client.post(
                        "/api/documents/upload",
                        data={"equipment_id": point_detail["equipment"]["id"], "doc_type": missing["type"]},
                        files={"file": (f"{missing['type']}.pdf", b"%PDF-1.4 workflow test", "application/pdf")},
                    )
                    assert uploaded.status_code == 200

            client.post("/api/auth/login", json={"username": "buyer", "password": "demo1234"})
            requested = client.post(
                f"/api/points/{point['id']}/request",
                json={
                    "in_payload": {"number": "IN-TEST-1", "project": point_detail["project"]["name"], "observation": "بازرسی برنامه‌ریزی‌شده"},
                    "note": "بازرسی طبق برنامه",
                },
            )
            assert requested.status_code == 200
            assert requested.json()["request_status"] == "manager_review"
            form_id = requested.json()["form_id"]

            client.post("/api/auth/login", json={"username": "manager", "password": "demo1234"})
            manager_desk = client.get("/api/manager/desk").json()
            assert any(row["form_id"] == form_id for row in manager_desk["in_forms"])
            viewed_in = client.get(f"/api/forms/{form_id}")
            assert viewed_in.status_code == 200
            assert viewed_in.json()["payload"]["number"] == "IN-TEST-1"
            assert client.get("/api/forms/template/itp").status_code == 403
            unit_manager_id = next(
                item["id"] for item in client.get("/api/unit-managers").json()
                if item["name"] == "مدیر واحد بازرسی"
            )
            assert client.post(
                f"/api/points/{point['id']}/manager-approval",
                data={"unit_manager_id": unit_manager_id, "department": "مواد"},
            ).status_code == 422
            manager_approved = client.post(
                f"/api/points/{point['id']}/manager-approval",
                data={"unit_manager_id": unit_manager_id, "department": "مواد", "note": "تأیید مدیر پروژه"},
                files={"file": ("project-manager-signature.png", TEST_SIGNATURE_PNG, "image/png")},
            )
            assert manager_approved.status_code == 200
            assert manager_approved.json()["request_status"] == "unit_review"

            client.post("/api/auth/login", json={"username": "unit.manager", "password": "demo1234"})
            detail = client.get(f"/api/points/{point['id']}").json()
            approvals = detail["point"]["request_approvals"]
            assert len(approvals) == 1
            assert approvals[0]["stage"] == "manager"
            signature = client.get(approvals[0]["url"])
            assert signature.status_code == 200
            assert signature.content == TEST_SIGNATURE_PNG
            unit_approved = client.post(
                f"/api/points/{point['id']}/unit-approval",
                data={"note": "تأیید مدیر واحد"},
                files={"file": ("unit-manager-signature.png", TEST_SIGNATURE_PNG, "image/png")},
            )
            assert unit_approved.status_code == 200
            assert unit_approved.json()["request_status"] in {"inspection_queue", "approved_no_inspector"}
            approvals = client.get(f"/api/points/{point['id']}").json()["point"]["request_approvals"]
            assert [approval["stage"] for approval in approvals] == ["manager", "unit_manager"]
            assert client.get(f"/api/points/{point['id']}").json()["point"]["request_form_id"] == form_id
    finally:
        reset_engine()


def test_in_request_is_routed_to_unit_manager_and_can_be_returned(monkeypatch, tmp_path):
    reset_engine()
    monkeypatch.setenv("NSI_DATABASE_URL", "sqlite://")
    monkeypatch.setattr("app.services.files.REQUEST_SIGNATURE_DIR", tmp_path)
    try:
        with TestClient(app) as client:
            client.post("/api/auth/login", json={"username": "manager", "password": "demo1234"})
            board = client.get("/api/board?kind=project").json()
            point = next(row for row in board if row["request_status"] == "draft" and row["status"] in {"ready", "planned"})
            detail = client.get(f"/api/points/{point['id']}").json()
            if detail["point"]["missing_docs"]:
                client.post("/api/auth/login", json={"username": "vendor", "password": "demo1234"})
                for missing in detail["point"]["missing_docs"]:
                    response = client.post(
                        "/api/documents/upload",
                        data={"equipment_id": detail["equipment"]["id"], "doc_type": missing["type"]},
                        files={"file": (f"{missing['type']}.pdf", b"%PDF-1.4 workflow test", "application/pdf")},
                    )
                    assert response.status_code == 200

            client.post("/api/auth/login", json={"username": "buyer", "password": "demo1234"})
            requested = client.post(
                f"/api/points/{point['id']}/request",
                json={"in_payload": {"number": "IN-UNIT-1"}, "note": "آزمون مسیر مدیر واحد"},
            )
            assert requested.status_code == 200

            client.post("/api/auth/login", json={"username": "manager", "password": "demo1234"})
            manager_notifications = client.get("/api/notifications").json()
            assert any(row["title"] == "درخواست بازرسی کارفرما" for row in manager_notifications)
            managers = client.get("/api/unit-managers")
            unit_manager_id = next(item["id"] for item in managers.json() if item["name"] == "مدیر واحد بازرسی")
            routed = client.post(
                f"/api/points/{point['id']}/manager-approval",
                data={"unit_manager_id": unit_manager_id, "department": "جوش", "note": "ارجاع جهت بررسی تخصصی"},
                files={"file": ("project-manager-signature.png", TEST_SIGNATURE_PNG, "image/png")},
            )
            assert routed.status_code == 200
            assert routed.json()["request_status"] == "unit_review"

            client.post("/api/auth/login", json={"username": "unit.manager", "password": "demo1234"})
            unit_notifications = client.get("/api/notifications").json()
            assert any(row["title"] == "درخواست بازرسی نیازمند تأیید مدیر واحد" for row in unit_notifications)
            queue = client.get("/api/unit-manager/desk")
            assert queue.status_code == 200
            assert any(row["point_id"] == point["id"] for row in queue.json()["requests"])
            assert client.get(f"/api/forms/{requested.json()['form_id']}").status_code == 200
            comment = client.post(
                f"/api/points/{point['id']}/request-comments",
                json={"body": "مدارک بررسی شد"},
            )
            assert comment.status_code == 200
            returned = client.post(
                f"/api/points/{point['id']}/return",
                json={"reason": "نیازمند اصلاح مشخصات فنی"},
            )
            assert returned.status_code == 200
            assert returned.json()["request_status"] == "manager_review"

            client.post("/api/auth/login", json={"username": "manager", "password": "demo1234"})
            routed_again = client.post(
                f"/api/points/{point['id']}/manager-approval",
                data={"unit_manager_id": unit_manager_id, "department": "جوش"},
                files={"file": ("project-manager-signature.png", TEST_SIGNATURE_PNG, "image/png")},
            )
            assert routed_again.json()["request_status"] == "unit_review"
            client.post("/api/auth/login", json={"username": "unit.manager", "password": "demo1234"})
            approved = client.post(
                f"/api/points/{point['id']}/unit-approval",
                data={"note": "تأیید واحد"},
                files={"file": ("unit-manager-signature.png", TEST_SIGNATURE_PNG, "image/png")},
            )
            assert approved.status_code == 200
            assert approved.json()["request_status"] in {"inspection_queue", "approved_no_inspector"}
            client.post("/api/auth/login", json={"username": "manager", "password": "demo1234"})
            manager_notifications = client.get("/api/notifications").json()
            assert any(row["title"] == "درخواست IN وارد مرحله اعزام شد" for row in manager_notifications)
            if approved.json()["request_status"] == "inspection_queue":
                client.post("/api/auth/login", json={"username": "coordinator", "password": "demo1234"})
                returned_after_dispatch = client.post(
                    f"/api/points/{point['id']}/return",
                    json={"reason": "بازبینی مجدد پیش از پذیرش بازرس"},
                )
                assert returned_after_dispatch.status_code == 200
                assert returned_after_dispatch.json()["request_status"] == "unit_review"
                offers = client.get(f"/api/points/{point['id']}").json()["offers"]
                assert all(offer["status"] != "pending" for offer in offers)
    finally:
        reset_engine()


def test_client_can_reject_reviewed_report_with_reason_and_manager_sees_it():
    reset_engine()
    with TestClient(app) as client:
        client.post("/api/auth/login", json={"username": "manager", "password": "demo1234"})
        report = next(row for row in client.get("/api/reports/inbox").json() if row["result"] == "accept")
        approved = client.post(f"/api/visits/{report['visit_id']}/review", json={"decision": "approve"})
        assert approved.status_code == 200

        client.post("/api/auth/login", json={"username": "buyer", "password": "demo1234"})
        missing_reason = client.post(f"/api/visits/{report['visit_id']}/client-reject", json={"reason": ""})
        assert missing_reason.status_code == 422
        rejected = client.post(
            f"/api/visits/{report['visit_id']}/client-reject",
            json={"reason": "گواهی پیوست‌شده نیازمند اصلاح است"},
        )
        assert rejected.status_code == 200
        assert rejected.json()["phase"] == "submitted"
        company_record = client.get("/api/company/inspections")
        assert all(item["visit_id"] != report["visit_id"] for item in company_record.json())

        client.post("/api/auth/login", json={"username": "manager", "password": "demo1234"})
        assert any(row["visit_id"] == report["visit_id"] for row in client.get("/api/reports/inbox").json())
        desk = client.get("/api/manager/desk").json()
        rejected_row = next(row for row in desk["rejected_reports"] if row["visit_id"] == report["visit_id"])
        assert rejected_row["reason"] == "گواهی پیوست‌شده نیازمند اصلاح است"


def test_client_approval_fills_inspector_record():
    reset_engine()
    with TestClient(app) as client:
        client.post("/api/auth/login", json={"username": "manager", "password": "demo1234"})
        report = client.get("/api/reports/inbox").json()[0]
        assert client.post(f"/api/visits/{report['visit_id']}/review", json={"decision": "approve"}).status_code == 200
        client.post("/api/auth/login", json={"username": "inspector.maryam", "password": "demo1234"})
        before = client.get("/api/inspector/record")
        assert before.status_code == 200
        assert all(row["visit_id"] != report["visit_id"] for row in before.json())
        client.post("/api/auth/login", json={"username": "manager", "password": "demo1234"})
        assert client.post(f"/api/visits/{report['visit_id']}/confirm").status_code == 403
        client.post("/api/auth/login", json={"username": "buyer", "password": "demo1234"})
        confirmed = client.post(f"/api/visits/{report['visit_id']}/confirm")
        assert confirmed.status_code == 200
        company_record = client.get("/api/company/inspections")
        company_row = next(row for row in company_record.json() if row["visit_id"] == report["visit_id"])
        assert company_row["client_approved"] is True
        assert company_row["inspector"]
        assert all(row["visit_id"] != report["visit_id"] for row in client.get("/api/reports/client").json())
        bills = client.get("/api/bills")
        assert bills.status_code == 200
        bill = next(row for row in bills.json() if row["visit_id"] == report["visit_id"])
        assert bill["kind"] == "project"
        assert bill["statement_no"].startswith("PS-")
        assert bill["invoice_no"].startswith("FA-")
        gross = bill["gross_irr"]
        assert gross > 0
        assert bill["vat_rate"] == 10
        assert bill["insurance_rate"] == 5
        assert bill["performance_rate"] == 10
        assert bill["tax_rate"] == 0
        assert bill["vat_irr"] == (gross * 10 + 50) // 100
        assert bill["insurance_irr"] == (gross * 5 + 50) // 100
        assert bill["performance_irr"] == (gross * 10 + 50) // 100
        assert bill["tax_irr"] == 0
        assert bill["net_irr"] == gross - bill["performance_irr"] - bill["insurance_irr"] + bill["vat_irr"]
        assert bill["claim_status"] == "unpaid"
        client.post("/api/auth/login", json={"username": "manager", "password": "demo1234"})
        no_reason = client.post(
            f"/api/bills/{bill['id']}/claim-status",
            json={"status": "needs_correction"},
        )
        assert no_reason.status_code == 400
        claim_update = client.post(
            f"/api/bills/{bill['id']}/claim-status",
            json={"status": "needs_correction", "note": "شماره حساب نیازمند اصلاح است"},
        )
        assert claim_update.status_code == 200
        client.post("/api/auth/login", json={"username": "buyer", "password": "demo1234"})
        buyer_bill = next(row for row in client.get("/api/bills").json() if row["id"] == bill["id"])
        assert buyer_bill["claim_status"] == "needs_correction"
        assert buyer_bill["claim_note"] == "شماره حساب نیازمند اصلاح است"
        client.post("/api/auth/login", json={"username": "inspector.maryam", "password": "demo1234"})
        rows = client.get("/api/inspector/record").json()
        match = next(row for row in rows if row["visit_id"] == report["visit_id"])
        assert match["company"] == "ماشین‌سازی البرز"
        assert match["client"] == "کارفرمای طرح فلامینگو"
        assert match["date"]
        assert match["time"]
        assert "تا" in match["window"]
        assert match["ivr_no"].startswith("IVR-")
        client.post("/api/auth/login", json={"username": "buyer", "password": "demo1234"})
        assert client.get("/api/inspector/record").status_code == 403


def test_vendor_cannot_broadcast():
    with TestClient(app) as client:
        client.post("/api/auth/login", json={"username": "vendor", "password": "demo1234"})
        assert client.get("/api/inspectors").status_code == 403
        assert client.get("/api/map").status_code == 403
        assert client.get("/api/benchmark").status_code == 403
        assert client.get("/api/technology").status_code == 403
        assert client.get("/api/forms/template/in").status_code == 403
        board = client.get("/api/board").json()
        assert all(not row["assignee"] and not row["dispatch_sentence"] for row in board)
        ready = next(row for row in board if row["status"] == "ready")
        response = client.post(f"/api/points/{ready['id']}/broadcast")
        assert response.status_code == 403
