"""Account revision (SPEC.md clarification 6).

Incremented exactly once per committed operation that changes cash, position
holdings, or cash/contract reservations:

  order acceptance (reservation)   broker.paper.submit
  fill (cash, holdings, release)   accounting.fills.apply_fill
  cancellation / expiration        broker.paper._close_order (release)

Valuation-only changes are deliberately EXCLUDED: ``mark_positions`` (new bid
mark) and ``refresh_staleness`` (CURRENT -> STALE label) never call this.

Why that is valid for risk_v1: the revision exists so an approval cannot be
used after the inputs it relied on changed. The inputs that acceptance rechecks
are available cash (ledger cash minus reserved cash) and unreserved contracts
(position quantity minus reserved contracts). Neither depends on market value,
unrealized P&L, equity, or valuation status. risk_v1 never reads those. The
quote it does read is pinned by id: the proposal's quote must be the contract's
latest accepted quote, and approval and acceptance happen in the same
transaction, so no new quote can arrive in between. If a later policy starts
using equity or marks, this rule must change with it.
"""

from __future__ import annotations

import sqlite3


def bump_account_revision(conn: sqlite3.Connection, account_id: str) -> int:
    conn.execute("UPDATE accounts SET account_revision = account_revision + 1 WHERE account_id = ?", (account_id,))
    return conn.execute("SELECT account_revision FROM accounts WHERE account_id = ?", (account_id,)).fetchone()[0]
