"""Database constraints: foreign keys, uniqueness, CHECKs, immutability, lifecycle, migrations."""

from __future__ import annotations

import sqlite3

import pytest

from paper_trading.storage import migrator
from paper_trading.storage.db import DatabaseNotInitializedError, connect, transaction


def insert_ledger(conn, run_id, account_id, seq, net, balance, entry_type="INITIAL_FUNDING", fill_id=None,
                  premium=None, fee=0, entry_id=None):
    conn.execute(
        """INSERT INTO cash_ledger_entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (entry_id or f"led_{seq}_{net}", "1.0", run_id, account_id, seq, "2026-09-29T13:30:00Z", entry_type,
         fill_id, net if premium is None else premium, fee, net, balance),
    )


def insert_order_chain(conn, run_id, account_id):
    """Minimal contract -> quote -> proposal -> risk decision -> OPEN order."""
    conn.execute(
        """INSERT INTO option_contracts VALUES ('c1','1.0','SPY','2026-10-30','CALL',60000,'USD',100,
           '100_SPY_SHARES','AMERICAN','PHYSICAL',0)""")
    conn.execute(
        """INSERT INTO market_quotes VALUES ('q1','1.0',?,4,'c1','synthetic_fixture_v1',1,1,
           '2026-09-29T14:00:00Z','2026-09-29T14:00:00Z',390,400,10,10,60000,'2026-09-29T14:00:00Z',59700)""",
        (run_id,))
    conn.execute(
        """INSERT INTO trade_proposals VALUES ('p1','1.0',?,?,'c1',NULL,'q1','sample_spy_long_call','1.0.0',
           '2026-09-29T14:00:00Z','BUY_TO_OPEN',1,400,'ENTRY_SIGNAL','entry',2000,1000,1800,'k-p1')""",
        (run_id, account_id))
    conn.execute(
        """INSERT INTO risk_decisions VALUES ('rd1','1.0',?,'p1','2026-09-29T14:00:00Z','risk_v1',1,'APPROVED',
           '[]',40065,10000000,40065,100000)""", (run_id,))
    conn.execute(
        """INSERT INTO orders VALUES ('o1','1.0',?,?,'p1','rd1','c1',NULL,'BUY_TO_OPEN',1,400,'OPEN',
           '2026-09-29T14:00:00Z','2026-09-29T14:00:00Z','2026-09-29T14:01:00Z',1,40065,0,'k-o1',NULL)""",
        (run_id, account_id))


def test_foreign_keys_enforced(conn, initialized):
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        insert_ledger(conn, "run_missing", "acct_missing", 1, 100, 100)


def test_second_funding_entry_rejected(conn, initialized):
    with pytest.raises(sqlite3.IntegrityError):
        insert_ledger(conn, initialized.run_id, initialized.account_id, 2, 100, 10_000_100)


def test_ledger_sequence_must_be_contiguous(conn, initialized):
    with pytest.raises(sqlite3.IntegrityError, match="contiguous"):
        insert_ledger(conn, initialized.run_id, initialized.account_id, 5, -100, 9_999_900,
                      entry_type="BUY_FILL", fill_id=None)


def test_ledger_is_immutable(conn, initialized):
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        conn.execute("UPDATE cash_ledger_entries SET balance_after_cents = 1")
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        conn.execute("DELETE FROM cash_ledger_entries")


def test_ledger_net_check(conn, initialized):
    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        conn.execute(
            """INSERT INTO cash_ledger_entries VALUES ('x','1.0',?,?,2,'2026-09-29T14:00:00Z','BUY_FILL','f1',
               -40000,-65,-40000,9960000)""", (initialized.run_id, initialized.account_id))


def test_money_must_be_integer_storage(conn, initialized):
    # STRICT tables refuse REAL values for INTEGER cents.
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE accounts SET account_revision = 1.5")


def test_pinned_run_parameters_immutable(conn, initialized):
    with pytest.raises(sqlite3.IntegrityError, match="pinned"):
        conn.execute("UPDATE runs SET starting_cash_cents = 1")
    with pytest.raises(sqlite3.IntegrityError, match="pinned"):
        conn.execute("UPDATE runs SET fee_per_contract_cents = 0")
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        conn.execute("UPDATE accounts SET starting_cash_cents = 1")
    with pytest.raises(sqlite3.IntegrityError, match="cannot be deleted"):
        conn.execute("DELETE FROM runs")


def test_run_cannot_start_without_fixture_metadata(conn, initialized):
    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        conn.execute("UPDATE runs SET status = 'RUNNING'")


def test_account_revision_only_increases(conn, initialized):
    with pytest.raises(sqlite3.IntegrityError, match="increase"):
        conn.execute("UPDATE accounts SET account_revision = 1")


def test_crossed_quote_rejected_by_db(conn, initialized):
    insert_order_chain(conn, initialized.run_id, initialized.account_id)
    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        conn.execute(
            """INSERT INTO market_quotes VALUES ('q2','1.0',?,5,'c1','synthetic_fixture_v1',1,2,
               '2026-09-29T14:00:01Z','2026-09-29T14:00:01Z',401,400,10,10,60000,'2026-09-29T14:00:01Z',NULL)""",
            (initialized.run_id,))


def test_duplicate_source_sequence_rejected(conn, initialized):
    insert_order_chain(conn, initialized.run_id, initialized.account_id)
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
        conn.execute(
            """INSERT INTO market_quotes VALUES ('q9','1.0',?,6,'c1','synthetic_fixture_v1',1,1,
               '2026-09-29T14:00:01Z','2026-09-29T14:00:01Z',390,400,10,10,60000,'2026-09-29T14:00:01Z',NULL)""",
            (initialized.run_id,))


def test_duplicate_contract_identity_rejected(conn, initialized):
    insert_order_chain(conn, initialized.run_id, initialized.account_id)
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
        conn.execute(
            """INSERT INTO option_contracts VALUES ('c2','1.0','SPY','2026-10-30','CALL',60000,'USD',100,
               '100_SPY_SHARES','AMERICAN','PHYSICAL',0)""")


def test_order_lifecycle_enforced(conn, initialized):
    insert_order_chain(conn, initialized.run_id, initialized.account_id)
    with pytest.raises(sqlite3.IntegrityError, match="illegal order status transition"):
        conn.execute("UPDATE orders SET status = 'PENDING' WHERE order_id = 'o1'")
    # A terminal transition must release the reservation.
    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        conn.execute("UPDATE orders SET status = 'CANCELED', terminal_reason = 'user' WHERE order_id = 'o1'")
    conn.execute("""UPDATE orders SET status = 'CANCELED', terminal_reason = 'user', reserved_cash_cents = 0
                    WHERE order_id = 'o1'""")
    with pytest.raises(sqlite3.IntegrityError, match="terminal orders cannot change"):
        conn.execute("UPDATE orders SET status = 'FILLED', terminal_reason = NULL WHERE order_id = 'o1'")


def test_one_order_per_proposal(conn, initialized):
    insert_order_chain(conn, initialized.run_id, initialized.account_id)
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
        conn.execute(
            """INSERT INTO orders VALUES ('o2','1.0',?,?,'p1','rd1','c1',NULL,'BUY_TO_OPEN',1,400,'OPEN',
               '2026-09-29T14:00:00Z','2026-09-29T14:00:00Z','2026-09-29T14:01:00Z',1,40065,0,'k-o2',NULL)""",
            (initialized.run_id, initialized.account_id))


def test_rejected_risk_decision_needs_reason_in_db(conn, initialized):
    insert_order_chain(conn, initialized.run_id, initialized.account_id)
    conn.execute(
        """INSERT INTO trade_proposals VALUES ('p2','1.0',?,?,'c1',NULL,'q1','sample_spy_long_call','1.0.0',
           '2026-09-29T14:00:05Z','BUY_TO_OPEN',1,400,'ENTRY_SIGNAL','entry',2000,1000,1800,'k-p2')""",
        (initialized.run_id, initialized.account_id))
    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        conn.execute(
            """INSERT INTO risk_decisions VALUES ('rd2','1.0',?,'p2','2026-09-29T14:00:05Z','risk_v1',1,
               'REJECTED','[]',40065,10000000,40065,100000)""", (initialized.run_id,))


def test_reserved_cash_reduces_available_not_cash(conn, initialized):
    from paper_trading.accounting import compute_snapshot, reconcile

    insert_order_chain(conn, initialized.run_id, initialized.account_id)
    snap = compute_snapshot(conn, initialized.account_id)
    assert snap.cash_cents == 10_000_000
    assert snap.reserved_cash_cents == 40_065
    assert snap.available_cash_cents == 9_959_935
    assert reconcile(conn, initialized.run_id).ok


def test_transaction_rolls_back_on_error(conn, initialized):
    with pytest.raises(sqlite3.IntegrityError):
        with transaction(conn):
            conn.execute("UPDATE accounts SET account_revision = 2")
            insert_ledger(conn, initialized.run_id, initialized.account_id, 2, 100, 10_000_100)
    assert conn.execute("SELECT account_revision FROM accounts").fetchone()[0] == 1


def test_migrations_idempotent(conn, initialized):
    assert migrator.migrate(conn) == []
    version, pending = migrator.status(conn)
    assert version == 2 and pending == []


def test_edited_migration_detected(conn, initialized):
    conn.execute("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1")
    with pytest.raises(migrator.MigrationError, match="modified after being applied"):
        migrator.migrate(conn)


def test_newer_database_refused(conn, initialized):
    conn.execute("INSERT INTO schema_migrations VALUES (99, 'future', 'x', '2026-01-01T00:00:00Z')")
    with pytest.raises(migrator.MigrationError, match="does not know"):
        migrator.require_current(conn)


def test_read_path_never_creates_database(tmp_path):
    missing = tmp_path / "nope.sqlite3"
    with pytest.raises(DatabaseNotInitializedError):
        connect(missing)
    assert not missing.exists()
