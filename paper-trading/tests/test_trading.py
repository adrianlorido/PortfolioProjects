"""Step 5 trading workflow, end to end through the replay engine.

Every scenario reconciles after every event (TradingRun.step(check=True)).
"""

from __future__ import annotations

import sqlite3

import pytest

from paper_trading.accounting import reconcile
from paper_trading.accounting.fills import DuplicateFillError, apply_fill
from paper_trading.app import queries, replay, trading
from paper_trading.app.coordinator import IdempotencyConflictError, init_sample
from paper_trading.broker import paper as broker
from paper_trading.broker.paper import OrderNotOpenError
from paper_trading.contracts.types import parse_utc
from paper_trading.storage.db import connect, transaction

from conftest import WORKED_FIXTURE
from trading_helpers import DAY, TradingRun, build_fixture, q

Q1 = q("14:00:00", 1, 390, 400)                 # entry signal: SPY 600 vs 597 reference
Q2 = q("14:00:01", 2, 390, 400)                 # entry fill at 4.00
Q3_PROFIT = q("14:10:00", 3, 480, 490, 60150)   # profit target: bid 4.80 >= 120% of 4.00


def run_with(conn, settings, tmp_path, quotes, **kw) -> TradingRun:
    return TradingRun(conn, settings, build_fixture(tmp_path, quotes), **kw)


# --- the worked example ------------------------------------------------------


def test_worked_example_reconciles_exactly(conn, settings):
    t = TradingRun(conn, settings, WORKED_FIXTURE)
    checkpoints = {}
    for ref in ("open", "q1", "q2", "q3", "q4", "close"):
        t.step_to(ref)
        s = t.snap()
        checkpoints[ref] = (s.cash_cents, s.reserved_cash_cents, s.available_cash_cents, s.equity_cents,
                            s.unrealized_pnl_cents, s.realized_pnl_cents, s.account_revision)
    assert checkpoints == {
        "open":  (10_000_000, 0, 10_000_000, 10_000_000, 0, 0, 1),
        "q1":    (10_000_000, 40_065, 9_959_935, 10_000_000, 0, 0, 2),       # order accepted, cash reserved
        "q2":    (9_959_935, 0, 9_959_935, 9_998_935, -1_065, 0, 3),         # bought 1 @ 4.00 + 0.65; marked at 3.90
        "q3":    (9_959_935, 0, 9_959_935, 10_007_935, 7_935, 0, 4),         # closing order accepted (contracts reserved)
        "q4":    (10_007_870, 0, 10_007_870, 10_007_870, 0, 7_870, 5),       # sold 1 @ 4.80 - 0.65
        "close": (10_007_870, 0, 10_007_870, 10_007_870, 0, 7_870, 5),
    }
    (trade,) = t.trades()
    assert (trade.entry_cost_cents, trade.exit_net_proceeds_cents, trade.total_fees_cents,
            trade.realized_pnl_cents, trade.exit_reason) == (40_065, 47_935, 130, 7_870, "PROFIT_TARGET")
    assert [(f["intent"], f["price_cents"], f["fee_cents"], f["quote_source_sequence"]) for f in t.fills()] == [
        ("BUY_TO_OPEN", 400, 65, 2), ("SELL_TO_CLOSE", 480, 65, 4)]
    (pos,) = t.positions()
    assert pos.status == "CLOSED" and pos.quantity == pos.reserved_contracts == 0
    assert all(o["reserved_cash_cents"] == o["reserved_contracts"] == 0 for o in t.orders())
    assert t.run()["status"] == "COMPLETED"
    props = t.proposals()
    assert [(p["intent"], p["reason_code"], p["limit_cents"], p["decision"], p["account_revision"],
             p["order_status"], p["after_source_sequence"]) for p in props] == [
        ("BUY_TO_OPEN", "ENTRY_SIGNAL", 400, "APPROVED", 1, "FILLED", 1),
        ("SELL_TO_CLOSE", "PROFIT_TARGET", 480, "APPROVED", 3, "FILLED", 3)]
    assert props[0]["required_cash_cents"] == props[0]["entry_risk_cents"] == 40_065
    assert props[1]["required_cash_cents"] == props[1]["entry_risk_cents"] == 0


def test_event_order_within_an_event(conn, settings):
    t = TradingRun(conn, settings, WORKED_FIXTURE)
    t.run_to_end()
    assert t.events()[4:] == [
        "RUN_STARTED", "SESSION_OPEN",
        "QUOTE_ACCEPTED", "PROPOSAL_CREATED", "RISK_APPROVED", "ORDER_ACCEPTED",       # q1
        "QUOTE_ACCEPTED", "ORDER_FILLED",                                              # q2
        "QUOTE_ACCEPTED", "EXIT_INTENT_CREATED", "PROPOSAL_CREATED", "RISK_APPROVED", "ORDER_ACCEPTED",  # q3
        "QUOTE_ACCEPTED", "ORDER_FILLED",                                              # q4
        "SESSION_CLOSE", "REPLAY_EXHAUSTED", "RUN_COMPLETED"]


# --- execution rules ---------------------------------------------------------


def test_buy_limit_enforced(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1, q("14:00:01", 2, 390, 401), q("14:00:02", 3, 390, 400)])
    t.step_to("s2@14:00:01")
    assert t.fills() == [] and t.orders()[0]["status"] == "OPEN"   # $4.01 ask > $4.00 limit
    t.step()
    assert [(f["price_cents"], f["quote_source_sequence"]) for f in t.fills()] == [(400, 3)]


def test_buy_fills_at_ask_when_below_limit(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1, q("14:00:01", 2, 385, 395)])
    t.run_to_end()
    assert t.fills()[0]["price_cents"] == 395 and t.positions()[0].remaining_cost_basis_cents == 39_565


def test_sell_limit_enforced(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1, Q2, Q3_PROFIT, q("14:10:01", 4, 479, 489, 60150),
                                            q("14:10:02", 5, 480, 490, 60150)])
    t.step_to("s4@14:10:01")
    assert len(t.fills()) == 1 and t.orders()[1]["status"] == "OPEN"   # $4.79 bid < $4.80 limit
    assert len(t.proposals()) == 2                                     # no duplicate closing proposal
    t.step()
    assert [f["price_cents"] for f in t.fills()] == [400, 480]


def test_no_fill_from_the_generating_quote(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1])
    t.step_to("s1@14:00:00")
    order = t.orders()[0]
    assert order["status"] == "OPEN" and order["after_source_sequence"] == 1   # q1's ask met the limit, no fill
    q1 = conn.execute("SELECT * FROM market_quotes WHERE source_sequence = 1").fetchone()
    with pytest.raises(sqlite3.IntegrityError, match="after the order's generating quote"):
        conn.execute(
            """INSERT INTO fills VALUES ('f','1.0',?,?,?,'2026-09-29T14:00:00Z',1,400,100,40000,65,
               'next_quote_touch_v1','flat_65c_v1')""", (t.run_id, order["order_id"], q1["quote_id"]))


def test_invalid_quotes_never_fill(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [
        Q1,
        q("14:00:01", 2, 410, 400, ref="crossed"),
        q("14:00:05", 3, 390, 400, observed=DAY + "14:00:00Z", ref="stale"),
        q("14:00:06", 1, 390, 399, ref="duplicate"),
        q("14:00:07", 9, 390, 398, observed=DAY + "14:00:09Z", ref="future"),
        q("14:00:08", 4, 390, 400, ref="missing_size", ask_size=None),
        q("14:00:09", 5, 390, 400, ref="valid"),
        q("14:00:10", 4, 390, 400, ref="out_of_order"),
    ])
    t.step_to("missing_size")
    assert t.fills() == []
    rejected = {e["fixture_ref"]: e["reason_codes"] for e in queries.list_replay_events(conn, t.run_id)
                if e["outcome"] == "REJECTED"}
    assert rejected == {"crossed": ["CROSSED_QUOTE"], "stale": ["STALE_QUOTE", "STALE_UNDERLYING"],
                        "duplicate": ["DUPLICATE_SEQUENCE"],
                        "future": ["FUTURE_OBSERVATION", "FUTURE_UNDERLYING_OBSERVATION"],
                        "missing_size": ["MISSING_SIZE"]}
    t.step_to("valid")
    assert [f["quote_source_sequence"] for f in t.fills()] == [5]
    t.step_to("out_of_order")
    assert len(t.fills()) == 1


def test_insufficient_displayed_size(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1, q("14:00:01", 2, 390, 400, ask_size=0),
                                            q("14:00:02", 3, 390, 400, ask_size=1)])
    t.step_to("s2@14:00:01")
    assert t.fills() == []
    t.step()
    assert [f["quote_source_sequence"] for f in t.fills()] == [3]


def test_displayed_capacity_is_not_reused(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1, q("14:00:01", 2, 390, 400, ask_size=1)])
    t.step_to("s1@14:00:00")
    order = t.orders()[0]
    quote = queries.list_quotes(conn, t.run_id)[0].model_copy(update={"source_sequence": 2, "ask_size": 1})
    now = parse_utc(DAY + "14:00:01Z")
    assert broker.fill_price(order, quote, now, consumed=0) == 400
    assert broker.fill_price(order, quote, now, consumed=1) is None


# --- reservations, revisions, and acceptance ---------------------------------


def test_marks_do_not_bump_revision(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1, Q2, q("14:05:00", 3, 395, 405)])
    t.step_to("s2@14:00:01")
    rev = t.snap().account_revision
    t.step()
    s = t.snap()
    assert s.account_revision == rev and s.unrealized_pnl_cents == 39_500 - 40_065


def test_stale_account_revision_rejected_at_acceptance(conn, settings, tmp_path, monkeypatch):
    t = run_with(conn, settings, tmp_path, [Q1, q("14:00:30", 2, 390, 400), q("14:01:00", 3, 390, 400)])
    real = trading.evaluate_risk

    def approve_then_race(c, run, proposal, clock):
        decision = real(c, run, proposal, clock)
        # Simulate a committed account change between the risk decision and order acceptance.
        c.execute("UPDATE accounts SET account_revision = account_revision + 1 WHERE run_id = ?", (run["run_id"],))
        return decision

    monkeypatch.setattr(trading, "evaluate_risk", approve_then_race)
    t.step_to("s1@14:00:00")
    monkeypatch.setattr(trading, "evaluate_risk", real)
    (order,) = t.orders()
    assert (order["status"], order["terminal_reason"], order["reserved_cash_cents"]) == (
        "REJECTED", "STALE_ACCOUNT_REVISION", 0)
    assert t.proposals()[0]["decision"] == "APPROVED"
    s = t.snap()
    assert s.cash_cents == s.available_cash_cents == 10_000_000 and s.reserved_cash_cents == 0
    t.step()                                       # 30 s later: still inside the rejection cooldown
    assert len(t.proposals()) == 1
    t.step()                                       # 60 s later: cooldown over, entry retried and accepted
    assert len(t.proposals()) == 2 and t.orders()[1]["status"] == "OPEN"


def test_acceptance_rechecks_available_cash(conn, settings, tmp_path, monkeypatch):
    t = run_with(conn, settings, tmp_path, [Q1])
    real = trading.evaluate_risk

    def approve_then_spend(c, run, proposal, clock):
        decision = real(c, run, proposal, clock)
        monkeypatch.setattr(broker, "compute_snapshot", lambda *_: type("S", (), {"available_cash_cents": 40_064})())
        return decision

    monkeypatch.setattr(trading, "evaluate_risk", approve_then_spend)
    t.step_to("s1@14:00:00")
    assert (t.orders()[0]["status"], t.orders()[0]["terminal_reason"]) == ("REJECTED", "INSUFFICIENT_CASH")


def test_duplicate_submission_and_fill_are_refused(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1, Q2])
    t.step_to("s1@14:00:00")
    run = t.run()
    proposal = conn.execute("SELECT * FROM trade_proposals").fetchone()
    decision = conn.execute("SELECT * FROM risk_decisions").fetchone()
    with transaction(conn):
        again = broker.submit(conn, run, proposal, decision, DAY + "14:00:00Z", 1)
    assert again.created is False and again.order_id == t.orders()[0]["order_id"]
    assert len(t.orders()) == 1
    t.step()
    order = t.orders()[0]
    quote = queries.list_quotes(conn, t.run_id)[1]
    with pytest.raises(DuplicateFillError):
        with transaction(conn):
            apply_fill(conn, t.run(), order, quote, 400, DAY + "14:00:01Z")
    assert len(t.fills()) == 1 and conn.execute("SELECT COUNT(*) FROM cash_ledger_entries").fetchone()[0] == 2


def test_conflicting_idempotency_keys(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1, q("14:00:01", 2, 390, 401), Q2])
    replay.step(conn, t.run_id, "shared")
    with pytest.raises(IdempotencyConflictError):
        replay.request_close(conn, t.run_id, "shared")
    replay.step(conn, t.run_id, "s2")
    order_id = t.orders()[0]["order_id"]
    first = replay.cancel_order(conn, t.run_id, order_id, "cancel-1")
    again = replay.cancel_order(conn, t.run_id, order_id, "cancel-1")
    assert again["idempotent_replay"] is True and again["status"] == first["status"] == "CANCELED"
    with pytest.raises(IdempotencyConflictError):
        replay.cancel_order(conn, t.run_id, "some-other-order", "cancel-1")
    with pytest.raises(OrderNotOpenError):
        replay.cancel_order(conn, t.run_id, order_id, "cancel-2")


# --- cancellation, TTL, and exit retries ---------------------------------------


def test_cancel_entry_releases_reservation_without_cash_change(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1, q("14:00:01", 2, 390, 401), q("14:00:02", 3, 390, 400)])
    t.step_to("s2@14:00:01")
    rev = t.snap().account_revision
    replay.cancel_order(conn, t.run_id, t.orders()[0]["order_id"], t.key())
    s = t.snap()
    assert (s.cash_cents, s.reserved_cash_cents, s.available_cash_cents, s.account_revision) == (
        10_000_000, 0, 10_000_000, rev + 1)
    assert t.orders()[0]["terminal_reason"] == "USER_CANCELED"
    t.step()   # flat again and not a rejection, so a new entry is proposed
    assert [o["status"] for o in t.orders()] == ["CANCELED", "OPEN"]


def test_cancel_exit_keeps_intent_and_retries(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1, Q2, Q3_PROFIT, q("14:10:01", 4, 470, 480, 60150),
                                            q("14:10:02", 5, 470, 480, 60150)])
    t.step_to("s3@14:10:00")
    exit_order = t.orders()[1]
    replay.cancel_order(conn, t.run_id, exit_order["order_id"], t.key())
    assert t.positions()[0].reserved_contracts == 0
    assert queries.list_exit_intents(conn, t.run_id)[0]["reason_code"] == "PROFIT_TARGET"
    t.run_to_end()
    assert [p["reason_code"] for p in t.proposals()] == ["ENTRY_SIGNAL", "PROFIT_TARGET", "EXIT_RETRY"]
    assert t.proposals()[2]["limit_cents"] == 470
    (trade,) = t.trades()
    assert trade.exit_reason == "PROFIT_TARGET" and trade.realized_pnl_cents == 47_000 - 65 - 40_065


def test_fill_just_before_ttl(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1, q("14:00:59", 2, 390, 400)])
    t.run_to_end()
    assert len(t.fills()) == 1


def test_quote_at_exact_expiry_cannot_fill(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1, q("14:01:00", 2, 390, 400), q("14:01:01", 3, 390, 400)])
    t.step_to("s2@14:01:00")
    first, second = t.orders()
    assert (first["status"], first["terminal_reason"], first["updated_at"]) == (
        "EXPIRED", "TTL_ELAPSED", DAY + "14:01:00Z")
    assert second["status"] == "OPEN" and t.fills() == []   # the new entry was generated by this quote
    t.step()
    assert t.fills()[0]["order_id"] == second["order_id"]


def test_fixture_time_jump_expires_before_quote(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1, q("14:05:00", 2, 390, 400)])
    t.step_to("s2@14:05:00")
    first = t.orders()[0]
    assert first["status"] == "EXPIRED" and first["updated_at"] == DAY + "14:01:00Z"   # effective TTL time
    assert conn.execute("SELECT COUNT(*) FROM fills").fetchone()[0] == 0              # not revived
    events = t.events()
    assert events.index("ORDER_EXPIRED") < len(events) - 1 - events[::-1].index("QUOTE_ACCEPTED")


def test_exit_order_expiry_retries_and_survives_restart(settings, tmp_path):
    fixture = build_fixture(tmp_path, [Q1, Q2, Q3_PROFIT, q("14:10:30", 4, 470, 480, 60150),
                                       q("14:11:30", 5, 470, 480, 60150), q("14:11:31", 6, 470, 480, 60150)])
    c1 = connect(settings.db_path, create=True)
    t = TradingRun(c1, settings, fixture)
    t.step_to("s5@14:11:30")
    orders = t.orders()
    assert (orders[1]["status"], orders[1]["terminal_reason"]) == ("EXPIRED", "TTL_ELAPSED")
    assert orders[2]["status"] == "OPEN"
    c1.close()                                           # restart
    replay._parse_stored.cache_clear()
    c2 = connect(settings.db_path)
    t.conn = c2
    t.run_to_end()
    assert [p["reason_code"] for p in t.proposals()] == ["ENTRY_SIGNAL", "PROFIT_TARGET", "EXIT_RETRY"]
    (trade,) = t.trades()
    assert trade.exit_reason == "PROFIT_TARGET" and trade.realized_pnl_cents == 6_870
    assert queries.list_exit_intents(c2, t.run_id)[0]["resolved_by_fill_id"] == t.fills()[1]["fill_id"]
    c2.close()


# --- strategy rules in the workflow ------------------------------------------


def test_rejection_cooldown_and_not_permanent(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [
        q("14:00:00", 1, 990, 1000),       # $10.00 ask: 100,065 > $1,000 ceiling -> RISK_LIMIT
        q("14:00:30", 2, 990, 1000),       # inside cooldown: no proposal
        q("14:01:00", 3, 990, 1000),       # 60 s later: proposed (and rejected) again
        q("14:02:00", 4, 390, 400),        # cheaper: approved
    ])
    t.run_to_end()
    props = t.proposals()
    assert [(p["created_at"][11:19], p["decision"], p["risk_reason_codes"]) for p in props] == [
        ("14:00:00", "REJECTED", ["RISK_LIMIT"]), ("14:01:00", "REJECTED", ["RISK_LIMIT"]),
        ("14:02:00", "APPROVED", [])]
    assert [o["proposal_id"] for o in t.orders()] == [props[2]["proposal_id"]]   # rejections create no orders


def test_no_reentry_after_completed_trade(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1, Q2, Q3_PROFIT, q("14:10:01", 4, 480, 490, 60150),
                                            q("14:20:00", 5, 390, 400), q("14:20:01", 6, 390, 400)])
    t.run_to_end()
    assert len(t.proposals()) == 2 and len(t.trades()) == 1 and t.run()["status"] == "COMPLETED"


def test_one_position_or_pending_entry(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1, q("14:00:01", 2, 390, 401), q("14:00:02", 3, 390, 401)])
    t.run_to_end()
    assert len(t.proposals()) == 1   # the pending entry blocks new entries


def test_loss_exit(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1, Q2, q("14:05:00", 3, 361, 371), q("14:06:00", 4, 360, 370),
                                            q("14:06:01", 5, 360, 370)])
    t.run_to_end()
    assert [p["reason_code"] for p in t.proposals()] == ["ENTRY_SIGNAL", "LOSS_THRESHOLD"]
    (trade,) = t.trades()
    assert (trade.exit_reason, trade.realized_pnl_cents) == ("LOSS_THRESHOLD", 36_000 - 65 - 40_065)
    s = t.snap()
    assert s.cash_cents == s.equity_cents == 10_000_000 - 4_130 and s.realized_pnl_cents == -4_130


def test_time_exit(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1, Q2, q("14:30:00", 3, 400, 410), q("14:30:01", 4, 400, 410),
                                            q("14:30:02", 5, 400, 410)])
    t.step_to("s3@14:30:00")
    assert len(t.proposals()) == 1                     # 1799 s: not yet
    t.run_to_end()
    (trade,) = t.trades()
    assert (trade.exit_reason, trade.realized_pnl_cents) == ("TIME_EXIT", -130)   # flat price, fees only


def test_manual_close_with_current_quote(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1, Q2, q("14:00:02", 3, 390, 400)])
    t.step_to("s2@14:00:01")
    result = replay.request_close(conn, t.run_id, "close-1")
    assert result["intent_created"] and result["proposal"]["order"]["status"] == "OPEN"
    again = replay.request_close(conn, t.run_id, "close-1")
    assert again["idempotent_replay"] is True
    assert len(queries.list_exit_intents(conn, t.run_id)) == 1
    t.run_to_end()
    (trade,) = t.trades()
    assert (trade.exit_reason, trade.realized_pnl_cents) == ("MANUAL_CLOSE", 39_000 - 65 - 40_065)


def test_manual_close_waits_for_next_valid_quote(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [
        Q1, Q2,
        q("14:00:10", 3, 395, 405, observed=DAY + "14:00:05Z", ref="stale"),   # rejected; clock moves on
        q("14:00:11", 4, 395, 405), q("14:00:12", 5, 395, 405)])
    t.step_to("stale")
    result = replay.request_close(conn, t.run_id, t.key())
    assert result["proposal"] is None and "next valid quote" in result["note"]
    t.step()
    assert t.proposals()[-1]["reason_code"] == "MANUAL_CLOSE" and t.proposals()[-1]["limit_cents"] == 395
    t.run_to_end()
    assert t.trades()[0].exit_reason == "MANUAL_CLOSE"


def test_manual_close_requires_open_position_and_trading_run(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1])
    with pytest.raises(trading.NoOpenPositionError):
        replay.request_close(conn, t.run_id, t.key())
    replay_only = init_sample(conn, settings)
    with pytest.raises(trading.NotTradingRunError):
        replay.request_close(conn, replay_only.run_id, "x")


# --- session end ---------------------------------------------------------------


def test_session_end_with_open_exposure_is_incomplete(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1, Q2, Q3_PROFIT])
    t.run_to_end()
    run = t.run()
    assert run["status"] == "INCOMPLETE" and "open position" in run["status_reason"]
    (pos,) = t.positions()
    assert pos.status == "OPEN" and pos.quantity == 1 and pos.reserved_contracts == 0
    assert pos.valuation_status == "STALE" and pos.market_value_cents == 48_000   # last bid kept, not zeroed
    assert [(o["status"], o["terminal_reason"]) for o in t.orders()] == [
        ("FILLED", None), ("EXPIRED", "TTL_ELAPSED")]
    assert t.trades() == [] and t.count("closed_trades") == 0
    s = t.snap()
    assert (s.realized_pnl_cents, s.reserved_cash_cents, s.valuation_status) == (0, 0, "STALE")
    assert s.equity_cents == 9_959_935 + 48_000 and s.cash_cents == 9_959_935
    assert "RUN_INCOMPLETE" in t.events()


def test_session_end_expires_open_orders(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [q("19:59:30", 1, 390, 400)])
    t.run_to_end()
    (order,) = t.orders()
    assert (order["status"], order["terminal_reason"], order["reserved_cash_cents"]) == (
        "EXPIRED", "SESSION_END", 0)
    s = t.snap()
    assert s.cash_cents == s.available_cash_cents == 10_000_000
    assert t.run()["status"] == "COMPLETED"   # flat at the close


# --- atomicity, restart, reconciliation, determinism --------------------------


def test_failure_mid_event_rolls_back_everything(conn, settings, tmp_path, monkeypatch):
    t = run_with(conn, settings, tmp_path, [Q1, Q2])
    t.step_to("s1@14:00:00")
    before = {tbl: conn.execute(f"SELECT COUNT(*) FROM {tbl}").fetchone()[0]
              for tbl in ("fills", "cash_ledger_entries", "positions", "market_quotes", "run_events")}
    snap_before = t.snap()

    def explode(*a, **k):
        real_apply(*a, **k)
        raise RuntimeError("crash after applying the fill, before commit")

    real_apply = trading.apply_fill
    monkeypatch.setattr(trading, "apply_fill", explode)
    with pytest.raises(RuntimeError, match="before commit"):
        replay.step(conn, t.run_id, "fill-step")
    after = {tbl: conn.execute(f"SELECT COUNT(*) FROM {tbl}").fetchone()[0] for tbl in before}
    assert after == before and t.snap() == snap_before
    assert t.orders()[0]["status"] == "OPEN" and t.run()["status"] == "RUNNING"
    monkeypatch.setattr(trading, "apply_fill", real_apply)
    replay.step(conn, t.run_id, "fill-step")
    assert len(t.fills()) == 1 and reconcile(conn, t.run_id).ok


def test_restart_does_not_double_execute(settings, tmp_path):
    c1 = connect(settings.db_path, create=True)
    t = TradingRun(c1, settings, WORKED_FIXTURE)
    t.step_to("q1")
    first = replay.step(c1, t.run_id, "q2-step")
    c1.close()
    replay._parse_stored.cache_clear()
    c2 = connect(settings.db_path)
    t.conn = c2
    again = replay.step(c2, t.run_id, "q2-step")        # retried after restart
    assert again["idempotent_replay"] is True and again["replay_position"] == first["replay_position"]
    assert len(t.fills()) == 1 and c2.execute("SELECT COUNT(*) FROM cash_ledger_entries").fetchone()[0] == 2
    t.run_to_end()
    assert t.snap().cash_cents == 10_007_870
    c2.close()


def test_reconciliation_failure_pauses_run(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1, Q2, q("14:05:00", 3, 395, 405)])
    t.step_to("s2@14:00:01")
    conn.execute("DROP TRIGGER tr_positions_entry_fixed")
    conn.execute("UPDATE positions SET remaining_cost_basis_cents = 1")     # corrupt the books
    with pytest.raises(trading.ReconciliationFailedError):
        replay.step(conn, t.run_id, t.key())
    run = t.run()
    assert run["status"] == "PAUSED" and "Reconciliation failed" in run["status_reason"]
    assert queries.get_replay_state(conn, t.run_id)["status"] == "PAUSED"
    assert "RECONCILIATION_FAILED" in t.events()
    with pytest.raises(trading.ReconciliationFailedError):
        replay.resume(conn, t.run_id, t.key())
    assert t.run()["status"] == "PAUSED"


def test_pause_and_resume_trading_run(conn, settings, tmp_path):
    t = run_with(conn, settings, tmp_path, [Q1, Q2])
    t.step()
    replay.pause(conn, t.run_id, t.key())
    assert t.run()["status"] == "PAUSED"
    with pytest.raises(replay.ReplayPausedError):
        replay.step(conn, t.run_id, t.key())
    replay.resume(conn, t.run_id, t.key())
    assert t.run()["status"] == "RUNNING"
    t.run_to_end()
    assert t.run()["status"] == "INCOMPLETE"   # bought, never closed


def _projection(conn, settings, name):
    t = TradingRun(conn, settings.model_copy(update={"sample_run_key": name}), WORKED_FIXTURE, key=name)
    t.run_to_end()

    def strip(d):
        return {k: v for k, v in dict(d).items()
                if not (k.endswith("_id") or k in ("idempotency_key", "recorded_at", "snapshot_id"))}

    return {
        "events": [(e["event_sequence"], e["event_type"], e["simulated_at"])
                   for e in queries.list_run_events(conn, t.run_id)],
        "proposals": [strip(p) for p in t.proposals()],
        "fills": [strip(f) for f in t.fills()],
        "ledger": [strip(e) for e in queries.list_ledger(conn, t.run_id)],
        "trades": [strip(x.model_dump()) for x in t.trades()],
        "positions": [strip(p.model_dump()) for p in t.positions()],
        "snapshot": strip(t.snap().model_dump()),
        "status": t.run()["status"],
    }


def test_deterministic_trading_replay(tmp_path):
    from conftest import make_settings

    results = []
    for name in ("a", "b"):
        s = make_settings(tmp_path / name)
        c = connect(s.db_path, create=True)
        results.append(_projection(c, s, "det"))
        c.close()
    assert results[0] == results[1]
    assert results[0]["snapshot"]["cash_cents"] == 10_007_870


# --- run lifecycle guards ------------------------------------------------------


def test_trading_run_must_start_before_stepping(conn, settings, tmp_path):
    t = TradingRun(conn, settings, build_fixture(tmp_path, [Q1]), start=False)
    with pytest.raises(trading.RunStateError, match="start it"):
        replay.step(conn, t.run_id, t.key())
    assert queries.get_replay_state(conn, t.run_id)["processed_events"] == 0
    replay.start_trading(conn, t.run_id, "start")
    assert replay.start_trading(conn, t.run_id, "start")["idempotent_replay"] is True
    with pytest.raises(trading.RunStateError):
        replay.start_trading(conn, t.run_id, "start-again")


def test_replay_only_runs_cannot_trade(conn, worked):
    with pytest.raises(trading.NotTradingRunError):
        replay.start_trading(conn, worked.run_id, "start")
    replay.run_to_end(conn, worked.run_id, "all")
    assert queries.trading_activity_counts(conn, worked.run_id) == {
        "trade_proposals": 0, "risk_decisions": 0, "orders": 0, "fills": 0, "positions": 0,
        "closed_trades": 0, "non_funding_ledger_entries": 0}


def test_run_status_transitions_guarded(conn, settings, tmp_path):
    t = TradingRun(conn, settings, WORKED_FIXTURE)
    t.run_to_end()
    with pytest.raises(sqlite3.IntegrityError, match="illegal run status transition"):
        conn.execute("UPDATE runs SET status = 'RUNNING' WHERE run_id = ?", (t.run_id,))
    with pytest.raises(sqlite3.IntegrityError, match="fixed"):
        conn.execute("UPDATE runs SET trading_enabled = 0 WHERE run_id = ?", (t.run_id,))
    for sql in ("UPDATE trade_proposals SET limit_cents = 1", "UPDATE risk_decisions SET decision = 'REJECTED'",
                "UPDATE orders SET limit_cents = 1 WHERE status = 'FILLED'"):
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(sql)


def test_existing_replay_only_run_unaffected_by_trading_run(conn, worked, settings):
    from paper_trading.accounting import compute_snapshot

    replay.run_to_end(conn, worked.run_id, "replay-only")
    t = TradingRun(conn, settings, WORKED_FIXTURE, key="trading-demo")
    t.run_to_end()
    assert queries.get_run(conn, "sample-run-001").status == "READY"
    assert compute_snapshot(conn, worked.account_id).cash_cents == 10_000_000
    assert queries.trading_activity_counts(conn, worked.run_id)["orders"] == 0
    assert t.run()["status"] == "COMPLETED" and t.snap().cash_cents == 10_007_870


def test_fill_price_refuses_at_or_after_expiry(conn, settings, tmp_path):
    """Second layer: even if an order were still OPEN at its expiry time, it cannot fill."""
    t = run_with(conn, settings, tmp_path, [Q1])
    t.step_to("s1@14:00:00")
    order = t.orders()[0]
    quote = queries.list_quotes(conn, t.run_id)[0].model_copy(update={"source_sequence": 2})
    for at, expected in (("14:00:59", 400), ("14:01:00", None)):
        clock = parse_utc(DAY + at + "Z")
        fresh = quote.model_copy(update={"observed_at": DAY + at + "Z", "underlying_observed_at": DAY + at + "Z"})
        assert broker.fill_price(order, fresh, clock, consumed=0) == expected
