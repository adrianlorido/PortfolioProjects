"""Accounting: cash ledger, position accounting, closed-trade results.

Implemented in Step 3 (read side only):
  - ``ledger_cash_cents``: cash = sum of ledger deltas.
  - ``compute_snapshot``: derived account snapshot (SPEC.md record H).
  - ``reconcile(conn, run_id)``: pass/fail with discrepancies.

Not yet implemented (Step 5):
  - ``apply_fill(fill, transaction)``: ledger entry, reservation release,
    position change, and closed-trade record inside the coordinator's
    atomic transaction.
"""

from paper_trading.accounting.ledger import (  # noqa: F401
    ReconciliationResult,
    compute_snapshot,
    ledger_cash_cents,
    reconcile,
)
