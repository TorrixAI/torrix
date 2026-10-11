"""Run context linkage, checked against a local capture server (stdlib only)."""

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, List

from torrix import run_context
from torrix._client import TorrixClient


class _Capture(BaseHTTPRequestHandler):
    records: List[Dict[str, Any]] = []

    def do_POST(self) -> None:  # noqa: N802 (http.server naming)
        length = int(self.headers.get("content-length", "0"))
        body = json.loads(self.rfile.read(length) or b"{}")
        batch = body.get("records", body if isinstance(body, list) else [])
        _Capture.records.extend(batch)
        payload = json.dumps({"accepted": len(batch), "ids": [r.get("id") for r in batch]}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_: Any) -> None:
        return


class RunContextTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = HTTPServer(("127.0.0.1", 0), _Capture)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.client = TorrixClient(f"http://127.0.0.1:{cls.server.server_port}", "trxk_test", background=False)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()

    def setUp(self) -> None:
        _Capture.records.clear()

    def test_sequential_calls_are_siblings(self) -> None:
        with run_context(session_id="ses_1", agent_name="planner", name="plan"):
            self.client.ingest({"id": "first"}, wait=True)
            self.client.ingest({"id": "second"}, wait=True)
        first, second = _Capture.records
        self.assertEqual(first["session_id"], "ses_1")
        self.assertEqual(first["agent_name"], "planner")
        self.assertEqual(first["name"], "plan")
        self.assertNotIn("parent_run_id", first)
        self.assertNotIn("parent_run_id", second)
        self.assertEqual(first["trace_id"], second["trace_id"])

    def test_nested_context_hangs_under_the_call_that_started_it(self) -> None:
        with run_context(agent_name="planner"):
            self.client.ingest({"id": "plan"}, wait=True)
            for agent in ("search", "write"):
                with run_context(agent_name=agent):
                    self.client.ingest({"id": f"{agent}-1"}, wait=True)
                    self.client.ingest({"id": f"{agent}-2"}, wait=True)
            self.client.ingest({}, wait=True)
        by_id = {r["id"]: r for r in _Capture.records}
        self.assertEqual(by_id["search-1"]["parent_run_id"], "plan")
        self.assertEqual(by_id["search-2"]["parent_run_id"], "plan")
        self.assertEqual(by_id["search-1"]["agent_name"], "search")
        # Each subagent context opens under the planner's latest call, not under its sibling.
        self.assertEqual(by_id["write-1"]["parent_run_id"], "plan")
        last = _Capture.records[-1]
        self.assertTrue(last["id"])
        self.assertNotIn("parent_run_id", last)
        self.assertEqual(len({r["trace_id"] for r in _Capture.records}), 1)


if __name__ == "__main__":
    unittest.main()
