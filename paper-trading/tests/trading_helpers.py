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


def assert_books(conn, run_id: str, account_id: str) -> None:
    """Independent accounting check from raw tables (does not call reconcile, which is under test).

    Verifies: cash = sum of ledger deltas; available = cash - reservations; cash and contract
    reservations match OPEN orders exactly; position quantity and cost basis match fills; fees and
    realized P&L match fills; equity = starting cash + realized + unrealized when valuation exists.
    """
    one = lambda sql, *a: conn.execute(sql, a).fetchone()[0]  # noqa: E731
    run = conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
    fee_rate, start = run["fee_per_contract_cents"], run["starting_cash_cents"]
    snap = compute_snapshot(conn, account_id)

    ledger_sum = one("SELECT COALESCE(SUM(net_cash_delta_cents),0) FROM cash_ledger_entries WHERE account_id = ?",
                     account_id)
    assert snap.cash_cents == ledger_sum
    fills = conn.execute(
        """SELECT f.*, o.intent, o.position_id AS order_position FROM fills f JOIN orders o USING (order_id)
            WHERE f.run_id = ?""", (run_id,)).fetchall()
    signed = sum((-1 if f["intent"] == "BUY_TO_OPEN" else 1) * f["gross_cents"] - f["fee_cents"] for f in fills)
    assert ledger_sum == start + signed, "cash must equal starting cash plus fill cash flows"
    assert snap.fees_paid_cents == sum(f["fee_cents"] for f in fills)
    assert all(f["fee_cents"] == fee_rate * f["quantity"] for f in fills)
    assert all(f["gross_cents"] == f["price_cents"] * 100 * f["quantity"] for f in fills)

    open_orders = conn.execute("SELECT * FROM orders WHERE run_id = ? AND status IN ('PENDING','OPEN')",
                               (run_id,)).fetchall()
    expected_cash_res = sum(o["limit_cents"] * 100 * o["quantity"] + fee_rate * o["quantity"]
                            for o in open_orders if o["intent"] == "BUY_TO_OPEN")
    assert all(o["reserved_cash_cents"] == (o["limit_cents"] * 100 * o["quantity"] + fee_rate * o["quantity"]
                                            if o["intent"] == "BUY_TO_OPEN" else 0) for o in open_orders)
    assert all(o["reserved_contracts"] == (o["quantity"] if o["intent"] == "SELL_TO_CLOSE" else 0)
               for o in open_orders)
    assert one("SELECT COUNT(*) FROM orders WHERE run_id = ? AND status NOT IN ('PENDING','OPEN') "
               "AND (reserved_cash_cents <> 0 OR reserved_contracts <> 0)", run_id) == 0
    assert snap.reserved_cash_cents == expected_cash_res
    assert snap.available_cash_cents == snap.cash_cents - expected_cash_res
    assert snap.available_cash_cents >= 0, "overspent"

    unrealized = 0
    valued = True
    for p in conn.execute("SELECT * FROM positions WHERE run_id = ?", (run_id,)).fetchall():
        bought = sum(f["quantity"] for f in fills if f["fill_id"] == p["entry_fill_id"])
        sold = sum(f["quantity"] for f in fills if f["intent"] == "SELL_TO_CLOSE" and f["order_position"] == p["position_id"])
        assert p["quantity"] == bought - sold >= 0, "position quantity must match fills (no overselling)"
        sell_reserved = sum(o["reserved_contracts"] for o in open_orders if o["position_id"] == p["position_id"])
        assert p["reserved_contracts"] == sell_reserved <= p["quantity"]
        entry = next(f for f in fills if f["fill_id"] == p["entry_fill_id"])
        if p["status"] == "OPEN":
            assert p["remaining_cost_basis_cents"] == entry["gross_cents"] + entry["fee_cents"]
            if p["market_value_cents"] is None:
                valued = False
            else:
                mark = conn.execute("SELECT bid_cents FROM market_quotes WHERE quote_id = ?",
                                    (p["mark_quote_id"],)).fetchone()[0]
                assert p["market_value_cents"] == mark * 100 * p["quantity"], "mark must be latest bid x 100 x qty"
                assert p["unrealized_pnl_cents"] == p["market_value_cents"] - p["remaining_cost_basis_cents"]
                unrealized += p["unrealized_pnl_cents"]

    realized = 0
    for t in conn.execute("SELECT * FROM closed_trades WHERE run_id = ?", (run_id,)).fetchall():
        ef = next(f for f in fills if f["fill_id"] == t["entry_fill_id"])
        xf = next(f for f in fills if f["fill_id"] == t["exit_fill_id"])
        assert t["entry_cost_cents"] == ef["gross_cents"] + ef["fee_cents"]
        assert t["exit_net_proceeds_cents"] == xf["gross_cents"] - xf["fee_cents"]
        assert t["total_fees_cents"] == ef["fee_cents"] + xf["fee_cents"]
        assert t["realized_pnl_cents"] == t["exit_net_proceeds_cents"] - t["entry_cost_cents"]
        realized += t["realized_pnl_cents"]
    assert snap.realized_pnl_cents == realized
    if valued:
        assert snap.unrealized_pnl_cents == unrealized
        assert snap.equity_cents == start + realized + unrealized == snap.cash_cents + snap.market_value_cents


class CheckedRun(TradingRun):
    """TradingRun that also runs the independent books check after every event."""

    def step(self, n: int = 1, check: bool = True) -> list[dict]:
        out = []
        for _ in range(n):
            out.extend(super().step(1, check))
            assert_books(self.conn, self.run_id, self.account_id)
        return out

    def run_to_end(self) -> dict:
        result = None
        while queries.get_replay_state(self.conn, self.run_id)["status"] == "ACTIVE":
            result = self.step()[0]
        return result
