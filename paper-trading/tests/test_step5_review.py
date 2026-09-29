"""Regression tests for the Step 5 review findings.

1. Failed reconciliation blocks every trading mutation (start, resume, step,
   replay-to-end, manual close, cancel, order acceptance); reads stay available.
2. Display fallback for invalid stored records is labeled untrusted and never
   feeds strategy, risk, execution, or accounting.
3. Valuation-only changes (marks, STALE relabel) do not change the account revision.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from paper_trading.app import queries, replay, trading
from paper_trading.app.api import create_app
from paper_trading.storage.db import transaction

from conftest import WORKED_FIXTURE
from trading_helpers import DAY, TradingRun, build_fixture, q

Q1 = q("14:00:00", 1, 390, 400)
Q2 = q("14:00:01", 2, 390, 400)
MUTATION_TABLES = ("trade_proposals", "risk_decisions", "orders", "fills", "positions", "closed_trades",
                   "cash_ledger_entries", "exit_intents", "market_quotes", "replay_events", "command_log")


def counts(conn) -> dict:
    return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in MUTATION_TABLES}


def corrupt_position(conn):
    # Allowed by triggers (cost basis is not an entry fact), so this models silent corruption.
    conn.execute("UPDATE positions SET remaining_cost_basis_cents = 1 WHERE status = 'OPEN'")


def corrupt_open_order(conn):
    conn.execute("UPDATE orders SET reserved_cash_cents = 1 WHERE status = 'OPEN'")


def failures(t) -> int:
    return t.events().count("RECONCILIATION_FAILED")


@pytest.fixture
def holding(conn, settings, tmp_path):
    """RUNNING trading run holding 1 contract (bought at q2)."""
    t = TradingRun(conn, settings, build_fixture(tmp_path, [Q1, Q2, q("14:00:02", 3, 390, 400),
                                                            q("14:00:03", 4, 390, 400)]))
    t.step_to("s2@14:00:01")
    return t


# --- 1. reconciliation blocks every trading mutation ------------------------


def test_manual_close_blocked_and_run_paused(conn, holding):
    corrupt_position(conn)
    before = counts(conn)
    with pytest.raises(trading.ReconciliationFailedError):
        replay.request_close(conn, holding.run_id, "close")
    assert counts(conn) == before                      # no intent, proposal, order, or reservation
    assert holding.run()["status"] == "PAUSED" and failures(holding) == 1
    with pytest.raises(trading.ReconciliationFailedError):
        replay.request_close(conn, holding.run_id, "close-again")
    assert failures(holding) == 1                      # refusals on a paused run write nothing


def test_cancel_blocked(conn, settings, tmp_path):
    t = TradingRun(conn, settings, build_fixture(tmp_path, [Q1, q("14:00:01", 2, 390, 401)]))
    t.step_to("s1@14:00:00")
    corrupt_open_order(conn)
    before = counts(conn)
    with pytest.raises(trading.ReconciliationFailedError):
        replay.cancel_order(conn, t.run_id, t.orders()[0]["order_id"], "cancel")
    assert counts(conn) == before and t.orders()[0]["status"] == "OPEN"
    assert t.run()["status"] == "PAUSED"


def test_step_and_replay_to_end_blocked(conn, holding):
    corrupt_position(conn)
    before = counts(conn)
    position_before = queries.get_replay_state(conn, holding.run_id)["next_position"]
    with pytest.raises(trading.ReconciliationFailedError):
        replay.step(conn, holding.run_id, "step")
    with pytest.raises(trading.ReconciliationFailedError):
        replay.run_to_end(conn, holding.run_id, "all")
    assert counts(conn) == before
    assert queries.get_replay_state(conn, holding.run_id)["next_position"] == position_before


def test_resume_blocked_but_pause_allowed(conn, holding):
    replay.pause(conn, holding.run_id, "pause")
    corrupt_position(conn)
    with pytest.raises(trading.ReconciliationFailedError):
        replay.resume(conn, holding.run_id, "resume")
    assert holding.run()["status"] == "PAUSED" and failures(holding) == 0   # not RUNNING: nothing written


def test_start_blocked(conn, settings, tmp_path):
    t = TradingRun(conn, settings, build_fixture(tmp_path, [Q1]), start=False)
    conn.execute("DROP TRIGGER tr_ledger_no_update")
    conn.execute("UPDATE cash_ledger_entries SET balance_after_cents = 1")
    with pytest.raises(trading.ReconciliationFailedError):
        replay.start_trading(conn, t.run_id, "start")
    assert t.run()["status"] == "READY" and failures(t) == 0


def test_idempotent_retry_of_completed_command_is_blocked(conn, holding):
    replay.step(conn, holding.run_id, "done-step")
    corrupt_position(conn)
    with pytest.raises(trading.ReconciliationFailedError):
        replay.step(conn, holding.run_id, "done-step")


def test_order_acceptance_blocked_mid_event(conn, settings, tmp_path, monkeypatch):
    """Books that stop reconciling inside an event (after risk, before acceptance) block the order."""
    t = TradingRun(conn, settings, build_fixture(tmp_path, [Q1, Q2]))
    t.step()                                              # SESSION_OPEN
    before = counts(conn)
    real = trading.evaluate_risk

    def risk_then_corrupt(c, run, proposal, clock):
        decision = real(c, run, proposal, clock)
        c.execute("DROP TRIGGER IF EXISTS tr_ledger_no_update")
        c.execute("UPDATE cash_ledger_entries SET balance_after_cents = 1")
        return decision

    submitted = []
    real_submit = trading.broker.submit
    monkeypatch.setattr(trading, "evaluate_risk", risk_then_corrupt)
    monkeypatch.setattr(trading.broker, "submit", lambda *a, **k: submitted.append(1) or real_submit(*a, **k))
    with pytest.raises(trading.ReconciliationFailedError):
        replay.step(conn, t.run_id, "q1")
    assert submitted == []                                # refused before the broker saw the order
    assert counts(conn) == before                         # whole event rolled back: no quote, proposal, or order
    run = t.run()
    assert run["status"] == "PAUSED" and "rolled back" in run["status_reason"]


def test_reads_remain_available_when_books_fail(conn, settings, holding):
    corrupt_position(conn)
    with TestClient(create_app(settings)) as c:
        key = holding.settings.sample_run_key
        for path in ("/api/account", "/api/positions", "/api/orders", "/api/closed-trades", "/api/proposals",
                     "/api/fills", "/api/ledger", "/api/replay", "/api/market", "/api/run", "/health"):
            assert c.get(f"{path}?run={key}").status_code == 200, path
        acct = c.get(f"/api/account?run={key}").json()
        assert acct["trusted"] is False and acct["reconciliation"]["ok"] is False
        r = c.post(f"/api/trading/request-close?run={key}", json={"idempotency_key": "x"})
        assert r.status_code == 409 and r.json()["error"] == "RECONCILIATION_FAILED"


# --- 2. untrusted display fallback -----------------------------------------------


def test_display_fallback_is_labeled_and_strict_reads_refuse(conn, holding):
    corrupt_position(conn)
    (shown,) = queries.display_positions(conn, holding.run_id)
    assert shown["untrusted"] is True and "unrealized_pnl_cents" in shown["validation_error"]
    assert shown["remaining_cost_basis_cents"] == 1                  # stored value, as stored
    with pytest.raises(ValidationError):
        queries.list_positions(conn, holding.run_id)                 # authoritative read refuses
    assert all(o["untrusted"] is False for o in queries.display_orders(conn, holding.run_id))


def test_trading_paths_never_use_fallback_data(conn, holding):
    corrupt_position(conn)
    with pytest.raises(ValidationError):
        with transaction(conn):
            trading._evaluate_exit(conn, holding.run_id, DAY + "14:00:01Z")   # strict read raises
    package = Path(trading.__file__).resolve().parent.parent
    for rel in ("app/trading.py", "app/replay.py", "strategy", "risk", "broker", "accounting"):
        paths = [package / rel] if rel.endswith(".py") else list((package / rel).glob("*.py"))
        for path in paths:
            text = path.read_text(encoding="utf-8")
            assert "display_" not in text and "from paper_trading.app import queries" not in text, path


def test_dashboard_labels_untrusted_and_disables_commands(conn, settings, holding):
    replay.step(conn, holding.run_id, "q3")           # open a manual-close-able state with a quote
    corrupt_position(conn)
    with TestClient(create_app(settings)) as c:
        html = c.get(f"/?run={holding.settings.sample_run_key}").text
    assert "figures on this page are UNTRUSTED" in html and "Trading and replay commands are blocked" in html
    assert 'class="untrusted-row"' in html and "UNTRUSTED</span>" in html
    # Server startup reconciliation already paused the corrupted RUNNING run, so Resume is shown.
    assert "Run paused" in html and "Reconciliation failed at startup" in html
    for command in ("step", "run-to-end", "request-close", "resume"):
        tag = html.split(f'data-command="{command}"')[1].split(">")[0]
        assert "disabled" in tag, command


def test_cli_trades_labels_untrusted(conn, settings, holding, monkeypatch, capsys):
    from paper_trading import __main__ as cli
    from paper_trading.config import get_settings

    corrupt_position(conn)
    monkeypatch.setenv("PAPER_DB_PATH", str(settings.db_path))
    get_settings.cache_clear()
    try:
        assert cli.main(["--run-key", holding.settings.sample_run_key, "trades"]) == 0
    finally:
        get_settings.cache_clear()
    out = capsys.readouterr().out
    assert "books do not reconcile" in out and "[UNTRUSTED:" in out


# --- 3. valuation-only changes do not change the revision --------------------


def test_marks_and_stale_relabel_do_not_bump_revision(conn, settings, tmp_path):
    t = TradingRun(conn, settings, build_fixture(tmp_path, [
        Q1, Q2,
        q("14:00:10", 3, 395, 405, observed=DAY + "14:00:05Z", ref="rejected"),   # clock moves; mark ages out
        q("14:05:00", 4, 420, 430, ref="new_mark"),
    ]))
    t.step_to("s2@14:00:01")
    rev = t.snap().account_revision
    t.step_to("rejected")
    assert t.positions()[0].valuation_status == "STALE" and t.snap().account_revision == rev
    t.step_to("new_mark")
    (pos,) = t.positions()
    assert (pos.valuation_status, pos.market_value_cents) == ("CURRENT", 42_000)
    assert t.snap().account_revision == rev


def test_manual_close_note_when_close_already_open(conn, settings, tmp_path):
    t = TradingRun(conn, settings, WORKED_FIXTURE)
    t.step_to("q3")                                     # profit-target closing order is OPEN
    result = replay.request_close(conn, t.run_id, "close")
    assert result["proposal"] is None and "already open" in result["note"]
    assert result["exit_intent"] == "PROFIT_TARGET" and result["intent_created"] is False
    assert len(t.orders()) == 2


def test_healthy_books_are_not_blocked(conn, holding):
    replay.request_close(conn, holding.run_id, "close")
    holding.run_to_end()
    assert holding.run()["status"] == "COMPLETED" and failures(holding) == 0
