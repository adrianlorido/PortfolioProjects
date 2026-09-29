"""Application coordinator: audited commands that change state.

Step 3 implements only ``init_sample``. The trading commands
(``start``, ``step``, ``pause``, ``request_close``) arrive with the trading
workflow; until then no code path can create orders, fills, or positions.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from paper_trading.config import Settings
from paper_trading.contracts import versions
from paper_trading.contracts.models import Account, CashLedgerEntry, Run, WatchlistItem
from paper_trading.contracts.types import SCHEMA_VERSION, format_utc
from paper_trading.storage.db import transaction
from paper_trading.storage.migrator import migrate

INIT_COMMAND = "INIT_SAMPLE_RUN"


class IdempotencyConflictError(RuntimeError):
    """Same idempotency key, different payload."""


@dataclass(frozen=True)
class InitResult:
    run_id: str
    account_id: str
    funding_ledger_entry_id: str
    created: bool


def new_id(prefix: str) -> str:
    """Globally unique, opaque record ID (SPEC.md clarification 4)."""
    return f"{prefix}_{uuid.uuid4().hex}"


def utc_now() -> str:
    return format_utc(datetime.now(timezone.utc).replace(microsecond=0))


def init_payload(settings: Settings) -> dict:
    """Parameters pinned by initialization. Any change is a different payload."""
    return {
        "mode": versions.MODE,
        "currency": settings.currency,
        "starting_cash_cents": settings.starting_cash_cents,
        "watchlist": list(settings.watchlist),
        "fee_per_contract_cents": settings.fee_per_contract_cents,
        "entry_risk_limit_cents": settings.entry_risk_limit_cents,
        "session_timezone": settings.session_timezone,
        "session_start": settings.session_start,
        "session_end": settings.session_end,
        "strategy_id": versions.STRATEGY_ID,
        "strategy_version": versions.STRATEGY_VERSION,
        "risk_policy_version": versions.RISK_POLICY_VERSION,
        "execution_model_version": versions.EXECUTION_MODEL_VERSION,
        "fee_schedule_version": versions.fee_schedule_version(settings.fee_per_contract_cents),
    }


def _hash(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def init_sample(conn: sqlite3.Connection, settings: Settings) -> InitResult:
    """Create the sample run, account, watchlist, and initial funding.

    Idempotent: keyed by ``settings.sample_run_key``. Re-running with the same
    parameters returns the existing run; different parameters under the same
    key raise ``IdempotencyConflictError``. Never deletes or resets data.
    """
    migrate(conn)
    payload = init_payload(settings)
    payload_hash = _hash(payload)
    key = f"init:{settings.sample_run_key}"

    with transaction(conn):
        prior = conn.execute(
            "SELECT payload_hash, result_json FROM command_log WHERE idempotency_key = ?", (key,)
        ).fetchone()
        if prior is not None:
            if prior["payload_hash"] != payload_hash:
                raise IdempotencyConflictError(
                    f"sample run key '{settings.sample_run_key}' already initialized with different "
                    "parameters; existing data was left unchanged. Set PAPER_SAMPLE_RUN_KEY to a new "
                    "value to create a separate run."
                )
            stored = json.loads(prior["result_json"])
            return InitResult(**{**stored, "created": False})

        now = utc_now()
        run = Run(
            schema_version=SCHEMA_VERSION,
            run_id=new_id("run"),
            init_key=settings.sample_run_key,
            mode=versions.MODE,
            is_sample=True,
            status="READY",
            created_at=now,
            currency=settings.currency,
            starting_cash_cents=settings.starting_cash_cents,
            watchlist=list(settings.watchlist),
            strategy_id=versions.STRATEGY_ID,
            strategy_version=versions.STRATEGY_VERSION,
            risk_policy_version=versions.RISK_POLICY_VERSION,
            execution_model_version=versions.EXECUTION_MODEL_VERSION,
            fee_schedule_version=payload["fee_schedule_version"],
            fee_per_contract_cents=settings.fee_per_contract_cents,
            entry_risk_limit_cents=settings.entry_risk_limit_cents,
            session_timezone=settings.session_timezone,
            session_start=settings.session_start,
            session_end=settings.session_end,
            simulated_clock=settings.session_start,
            session_reference_cents=None,
            fixture_id=None,
            fixture_version=None,
            fixture_checksum=None,
            checkpoint_event_sequence=0,
        )
        account = Account(
            schema_version=SCHEMA_VERSION,
            account_id=new_id("acct"),
            run_id=run.run_id,
            currency=run.currency,
            starting_cash_cents=run.starting_cash_cents,
            account_revision=1,
            created_at=now,
        )
        # Economic records use simulated time so replays are identical.
        funding = CashLedgerEntry(
            schema_version=SCHEMA_VERSION,
            ledger_entry_id=new_id("led"),
            run_id=run.run_id,
            account_id=account.account_id,
            ledger_sequence=1,
            recorded_at=run.simulated_clock,
            entry_type="INITIAL_FUNDING",
            fill_id=None,
            premium_cash_delta_cents=run.starting_cash_cents,
            fee_cash_delta_cents=0,
            net_cash_delta_cents=run.starting_cash_cents,
            balance_after_cents=run.starting_cash_cents,
        )
        watch = [
            WatchlistItem(schema_version=SCHEMA_VERSION, run_id=run.run_id, symbol=s, position=i)
            for i, s in enumerate(run.watchlist)
        ]

        conn.execute(
            """INSERT INTO runs (run_id, init_key, init_payload_hash, schema_version, mode, is_sample, status,
                   created_at, currency, starting_cash_cents, strategy_id, strategy_version,
                   risk_policy_version, execution_model_version, fee_schedule_version,
                   fee_per_contract_cents, entry_risk_limit_cents, session_timezone, session_start,
                   session_end, simulated_clock, session_reference_cents, fixture_id, fixture_version,
                   fixture_checksum, checkpoint_event_sequence)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                run.run_id, run.init_key, payload_hash, run.schema_version, run.mode, 1, run.status,
                run.created_at, run.currency, run.starting_cash_cents, run.strategy_id,
                run.strategy_version, run.risk_policy_version, run.execution_model_version,
                run.fee_schedule_version, run.fee_per_contract_cents, run.entry_risk_limit_cents,
                run.session_timezone, run.session_start, run.session_end, run.simulated_clock,
                run.session_reference_cents, run.fixture_id, run.fixture_version,
                run.fixture_checksum, run.checkpoint_event_sequence,
            ),
        )
        conn.execute(
            """INSERT INTO accounts (account_id, run_id, schema_version, currency, starting_cash_cents,
                   account_revision, created_at) VALUES (?,?,?,?,?,?,?)""",
            (
                account.account_id, account.run_id, account.schema_version, account.currency,
                account.starting_cash_cents, account.account_revision, account.created_at,
            ),
        )
        conn.executemany(
            "INSERT INTO watchlist_items (run_id, symbol, position) VALUES (?,?,?)",
            [(w.run_id, w.symbol, w.position) for w in watch],
        )
        conn.execute(
            """INSERT INTO cash_ledger_entries (ledger_entry_id, schema_version, run_id, account_id,
                   ledger_sequence, recorded_at, entry_type, fill_id, premium_cash_delta_cents,
                   fee_cash_delta_cents, net_cash_delta_cents, balance_after_cents)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                funding.ledger_entry_id, funding.schema_version, funding.run_id, funding.account_id,
                funding.ledger_sequence, funding.recorded_at, funding.entry_type, funding.fill_id,
                funding.premium_cash_delta_cents, funding.fee_cash_delta_cents,
                funding.net_cash_delta_cents, funding.balance_after_cents,
            ),
        )

        events = [
            ("RUN_CREATED", {"init_key": run.init_key, "payload_hash": payload_hash}),
            ("WATCHLIST_SET", {"symbols": list(run.watchlist)}),
            ("ACCOUNT_FUNDED", {"account_id": account.account_id, "amount_cents": run.starting_cash_cents}),
        ]
        for seq, (event_type, data) in enumerate(events, start=1):
            conn.execute(
                """INSERT INTO run_events (event_id, run_id, event_sequence, event_type, simulated_at,
                       recorded_at, payload_json) VALUES (?,?,?,?,?,?,?)""",
                (new_id("evt"), run.run_id, seq, event_type, run.simulated_clock, now,
                 json.dumps(data, sort_keys=True)),
            )
        conn.execute(
            "UPDATE runs SET checkpoint_event_sequence = ? WHERE run_id = ?", (len(events), run.run_id)
        )

        result = InitResult(run.run_id, account.account_id, funding.ledger_entry_id, created=True)
        stored = {k: v for k, v in asdict(result).items() if k != "created"}
        conn.execute(
            """INSERT INTO command_log (idempotency_key, run_id, command_type, payload_hash, result_json,
                   recorded_at) VALUES (?,?,?,?,?,?)""",
            (key, run.run_id, INIT_COMMAND, payload_hash, json.dumps(stored, sort_keys=True), now),
        )
        return result
