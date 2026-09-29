"""Risk boundary (not implemented; arrives in Step 5).

Policy ``risk_v1``. Checks proposals and records approval or rejection; cannot
execute. Approvals bind to an ``account_revision`` that the broker rechecks.

Planned interface::

    evaluate(proposal, account, position, quote, policy) -> RiskDecision
"""

from paper_trading.risk.interface import RiskEvaluator  # noqa: F401
