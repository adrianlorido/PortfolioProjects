"""Builders for Step 5 trading scenarios: synthetic fixtures and trading runs."""

from __future__ import annotations

import itertools
import json
from pathlib import Path
from typing import Optional

from paper_trading.accounting import compute_snapshot, reconcile
from paper_trading.app import queries, replay
from paper_trading.app.coordinator import init_sample
from paper_trading.market_data.fixtures import compute_checksum, read_fixture_file

DAY = "2026-09-29T"
C600 = "SPY_20261030_C_60000"

_counter = itertools.count(1)


def contract(contract_id=C600, expiration="2026-10-30", strike=60000, **over) -> dict:
    c = {"schema_version": "1.0", "contract_id": contract_id, "underlying": "SPY", "expiration_date": expiration,
         "option_type": "CALL", "strike_cents": strike, "currency": "USD", "multiplier": 100,
         "deliverable": "100_SPY_SHARES", "exercise_style": "AMERICAN", "settlement_type": "PHYSICAL",
         "adjusted": False}
    c.update(over)
    return c


def q(t: str, seq: int, bid: int, ask: int, und: int = 60000, *, cid: str = C600, bid_size: int = 10,
      ask_size: int = 10, observed: Optional[str] = None, ref: Optional[str] = None, **extra) -> dict:
    """A QUOTE event at DAY+t (e.g. '14:00:00')."""
    at = DAY + t + "Z"
    inp = {"source": "synthetic_fixture_v1", "is_sample": True, "source_sequence": seq, "contract_id": cid,
           "observed_at": observed or at, "bid_cents": bid, "ask_cents": ask, "bid_size": bid_size,
           "ask_size": ask_size, "underlying_price_cents": und, "underlying_observed_at": observed or at}
    inp.update(extra)
    return {"event_type": "QUOTE", "at": at, "ref": ref or f"s{seq}@{t}", "input": inp}


def build_fixture(tmp_path: Path, quotes: list[dict], contracts: Optional[list[dict]] = None,
                  fixture_id: Optional[str] = None) -> Path:
    fid = fixture_id or f"scenario_{next(_counter)}"
    doc = {
        "fixture_schema_version": "1.0", "fixture_id": fid, "fixture_version": "1.0.0", "checksum": "",
        "source": "synthetic_fixture_v1", "is_sample": True,
        "data_label": "SYNTHETIC SAMPLE DATA - TEST SCENARIO", "description": "Step 5 test scenario.",
        "underlying": "SPY",
        "session": {"timezone": "America/New_York", "start": DAY + "13:30:00Z", "end": DAY + "20:00:00Z"},
        "session_reference_cents": 59700,
        "contracts": contracts or [contract()],
        "events": [{"event_type": "SESSION_OPEN", "at": DAY + "13:30:00Z", "ref": "open"}] + quotes
                  + [{"event_type": "SESSION_CLOSE", "at": DAY + "20:00:00Z", "ref": "close"}],
    }
    doc["checksum"] = compute_checksum(doc)
    path = tmp_path / f"{fid}.json"
    path.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    return path


class TradingRun:
    """A started trading run on ``conn`` with helpers for stepping and inspecting."""

    def __init__(self, conn, settings, fixture: Path, key: str = "trading-test", start: bool = True):
        self.conn = conn
        self.settings = settings.model_copy(update={"sample_run_key": key})
        init = init_sample(conn, self.settings, trading=True)
        self.run_id, self.account_id = init.run_id, init.account_id
        doc, content = read_fixture_file(fixture)
        replay.load_fixture(conn, self.run_id, doc, content)
        self._keys = itertools.count(1)
        if start:
            replay.start_trading(conn, self.run_id, self.key())

    def key(self) -> str:
        return f"{self.run_id}-k{next(self._keys)}"

    def step(self, n: int = 1, check: bool = True) -> list[dict]:
        out = []
        for _ in range(n):
            out.append(replay.step(self.conn, self.run_id, self.key()))
            if check:
                rec = reconcile(self.conn, self.run_id)
                assert rec.ok, rec.discrepancies
        return out

    def step_to(self, ref: str) -> dict:
        """Step until the event with fixture ref ``ref`` has been processed."""
        while True:
            r = self.step()[0]
            if r["fixture_ref"] == ref:
                return r

    def run_to_end(self) -> dict:
        return replay.run_to_end(self.conn, self.run_id, self.key())

    # inspection
    def snap(self):
        return compute_snapshot(self.conn, self.account_id)

    def orders(self):
        return self.conn.execute("SELECT * FROM orders WHERE run_id = ? ORDER BY rowid", (self.run_id,)).fetchall()

    def proposals(self):
        return queries.list_proposals(self.conn, self.run_id)

    def fills(self):
        return queries.list_fills(self.conn, self.run_id)

    def positions(self):
        return queries.list_positions(self.conn, self.run_id)

    def trades(self):
        return queries.list_closed_trades(self.conn, self.run_id)

    def run(self):
        return self.conn.execute("SELECT * FROM runs WHERE run_id = ?", (self.run_id,)).fetchone()

    def events(self):
        return [e["event_type"] for e in queries.list_run_events(self.conn, self.run_id)]

    def count(self, table: str) -> int:
        return self.conn.execute(f"SELECT COUNT(*) FROM {table} WHERE run_id = ?", (self.run_id,)).fetchone()[0]
