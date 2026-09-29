"""Initialization: idempotent, ledger-derived $100,000, reconciled, never reset."""

from __future__ import annotations

import pytest

from paper_trading.accounting import compute_snapshot, ledger_cash_cents, reconcile
from paper_trading.app import queries
from paper_trading.app.coordinator import IdempotencyConflictError, init_sample
from paper_trading.storage.db import connect

from conftest import make_settings


def counts(conn) -> dict:
    tables = ["runs", "accounts", "watchlist_items", "cash_ledger_entries", "run_events", "command_log"]
    return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables}


def test_init_twice_creates_nothing_new(conn, settings):
    first = init_sample(conn, settings)
    before = counts(conn)
    second = init_sample(conn, settings)
    assert first.created is True and second.created is False
    assert (second.run_id, second.account_id, second.funding_ledger_entry_id) == (
        first.run_id, first.account_id, first.funding_ledger_entry_id)
    assert counts(conn) == before == {
        "runs": 1, "accounts": 1, "watchlist_items": 1,
        "cash_ledger_entries": 1, "run_events": 3, "command_log": 1,
    }


def test_account_reconciles_to_100k(conn, initialized):
    assert ledger_cash_cents(conn, initialized.account_id) == 10_000_000
    snap = compute_snapshot(conn, initialized.account_id)
    assert snap.starting_cash_cents == snap.cash_cents == snap.available_cash_cents == 10_000_000
    assert snap.equity_cents == 10_000_000
    assert snap.reserved_cash_cents == snap.realized_pnl_cents == snap.unrealized_pnl_cents == 0
    assert snap.fees_paid_cents == 0
    result = reconcile(conn, initialized.run_id)
    assert result.ok, result.discrepancies
    assert result.cash_cents == 10_000_000


def test_cash_is_derived_from_ledger_not_stored(conn, initialized):
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(accounts)")}
    assert not any("cash" in c and c != "starting_cash_cents" for c in cols)
    funding = conn.execute("SELECT * FROM cash_ledger_entries").fetchone()
    assert funding["entry_type"] == "INITIAL_FUNDING"
    assert funding["ledger_sequence"] == 1
    assert funding["net_cash_delta_cents"] == funding["balance_after_cents"] == 10_000_000
    assert funding["recorded_at"] == "2026-09-29T13:30:00Z"  # simulated session start


def test_account_revision_starts_at_one_and_reinit_does_not_bump(conn, settings):
    # SPEC.md clarification 6: the revision moves only with committed changes to
    # cash, positions, or reservations. Initialization is the only such change
    # in Step 3; an idempotent re-run changes nothing, so the revision stays put.
    r = init_sample(conn, settings)
    assert queries.get_account(conn, r.run_id).account_revision == 1
    assert compute_snapshot(conn, r.account_id).account_revision == 1
    init_sample(conn, settings)
    assert queries.get_account(conn, r.run_id).account_revision == 1


def test_run_pins_versions_and_session(conn, initialized, settings):
    run = queries.get_run(conn, settings.sample_run_key)
    assert run.mode == "SAMPLE_PAPER" and run.is_sample is True and run.status == "READY"
    assert run.watchlist == ["SPY"]
    assert run.strategy_id == "sample_spy_long_call" and run.strategy_version == "1.0.0"
    assert run.fee_schedule_version == "flat_65c_v1" and run.fee_per_contract_cents == 65
    assert run.entry_risk_limit_cents == 100_000
    assert run.session_timezone == "America/New_York"
    assert queries.session_local_date(run) == "2026-09-29"


def test_session_local_date_uses_timezone_not_offset(tmp_path):
    # 03:30Z on Nov 2 is still Nov 1 in New York (EST, UTC-5, after DST ends).
    s = make_settings(tmp_path, session_start="2026-11-02T03:30:00Z", session_end="2026-11-02T04:00:00Z")
    c = connect(s.db_path, create=True)
    r = init_sample(c, s)
    run = queries.get_run(c, s.sample_run_key)
    assert run.run_id == r.run_id
    assert queries.session_local_date(run) == "2026-11-01"
    c.close()


def test_event_sequence_is_deterministic(conn, initialized):
    events = queries.list_run_events(conn, initialized.run_id)
    assert [(e["event_sequence"], e["event_type"]) for e in events] == [
        (1, "RUN_CREATED"), (2, "WATCHLIST_SET"), (3, "ACCOUNT_FUNDED")]


def test_same_inputs_same_economics_different_ids(tmp_path):
    results = []
    for name in ("a", "b"):
        s = make_settings(tmp_path / name)
        c = connect(s.db_path, create=True)
        r = init_sample(c, s)
        snap = compute_snapshot(c, r.account_id).model_dump()
        events = [(e["event_sequence"], e["event_type"]) for e in queries.list_run_events(c, r.run_id)]
        results.append((r, snap, events))
        c.close()
    (ra, sa, ea), (rb, sb, eb) = results
    assert ra.run_id != rb.run_id
    ignore = {"snapshot_id", "run_id", "account_id"}
    assert {k: v for k, v in sa.items() if k not in ignore} == {k: v for k, v in sb.items() if k not in ignore}
    assert ea == eb


def test_changed_parameters_same_key_is_conflict_and_changes_nothing(conn, initialized, tmp_path, settings):
    before = counts(conn)
    changed = make_settings(tmp_path, starting_cash_cents=5_000_000)
    with pytest.raises(IdempotencyConflictError, match="different parameters"):
        init_sample(conn, changed)
    assert counts(conn) == before
    assert ledger_cash_cents(conn, initialized.account_id) == 10_000_000


def test_new_key_creates_separate_run_preserving_original(conn, initialized, tmp_path):
    other = make_settings(tmp_path, sample_run_key="sample-run-002", starting_cash_cents=5_000_000)
    second = init_sample(conn, other)
    assert second.created and second.run_id != initialized.run_id
    assert ledger_cash_cents(conn, initialized.account_id) == 10_000_000
    assert ledger_cash_cents(conn, second.account_id) == 5_000_000
    assert reconcile(conn, initialized.run_id).ok and reconcile(conn, second.run_id).ok


def test_failed_init_rolls_back_completely(conn, settings, monkeypatch):
    from paper_trading.app import coordinator

    real = coordinator.new_id

    def explode(prefix):
        if prefix == "evt":
            raise RuntimeError("simulated crash before commit")
        return real(prefix)

    monkeypatch.setattr(coordinator, "new_id", explode)
    with pytest.raises(RuntimeError, match="simulated crash"):
        init_sample(conn, settings)
    assert all(v == 0 for v in counts(conn).values())
    monkeypatch.setattr(coordinator, "new_id", real)
    assert init_sample(conn, settings).created is True


@pytest.mark.parametrize("overrides", [
    {"watchlist": "SPY,QQQ"},
    {"starting_cash_cents": 0},
    {"starting_cash_cents": -1},
    {"currency": "EUR"},
    {"session_timezone": "Mars/Base"},
    {"session_start": "2026-09-29T13:30:00+00:00"},
    {"session_end": "2026-09-29T13:00:00Z"},
])
def test_invalid_configuration_rejected(tmp_path, overrides):
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        make_settings(tmp_path, **overrides)


def test_watchlist_env_string_parses(tmp_path, monkeypatch):
    monkeypatch.setenv("PAPER_WATCHLIST", "spy")
    assert make_settings(tmp_path).watchlist == ["SPY"]
