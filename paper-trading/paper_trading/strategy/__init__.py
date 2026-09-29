"""Strategy boundary (not implemented; arrives in Step 5).

Strategy ``sample_spy_long_call`` v1.0.0 (SPEC.md Section 2). Produces
proposals only; cannot change balances.

Planned interface::

    evaluate(event, account, position, strategy_config) -> TradeProposal | None

Must honor clarifications 1 (60-second per-contract cooldown after a
rejected entry, never a permanent disable) and 3 (no new closing proposal
while a closing order is PENDING or OPEN; exit intent survives cancellation
or expiration and retries with EXIT_RETRY).
"""

from paper_trading.strategy.interface import Strategy  # noqa: F401
