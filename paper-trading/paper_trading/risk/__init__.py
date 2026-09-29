"""Risk (Step 5): policy ``risk_v1``.

Checks proposals and records approval or rejection; cannot execute. See
``policy.py`` for the rules and reason codes. Approvals bind to an
``account_revision`` that the broker rechecks atomically at acceptance.
"""

from paper_trading.risk.interface import RiskEvaluator  # noqa: F401
from paper_trading.risk.policy import POLICY_VERSION, RiskInputs, RiskVerdict, evaluate  # noqa: F401
