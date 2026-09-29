"""Account revision (SPEC.md clarification 6).

Incremented once per committed operation that changes cash, position holdings,
or cash/contract reservations: order acceptance, fill, cancellation, and
expiration. Marking a position to market changes only its valuation, not
cash, holdings, or reservations, so it does not increment the revision.
"""

from __future__ import annotations

import sqlite3


def bump_account_revision(conn: sqlite3.Connection, account_id: str) -> int:
    conn.execute("UPDATE accounts SET account_revision = account_revision + 1 WHERE account_id = ?", (account_id,))
    return conn.execute("SELECT account_revision FROM accounts WHERE account_id = ?", (account_id,)).fetchone()[0]
