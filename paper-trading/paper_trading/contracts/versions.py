"""Version identifiers a run pins at creation (SPEC.md Sections 2 and 5)."""

MODE = "SAMPLE_PAPER"

STRATEGY_ID = "sample_spy_long_call"
STRATEGY_VERSION = "1.0.0"
RISK_POLICY_VERSION = "risk_v1"
EXECUTION_MODEL_VERSION = "next_quote_touch_v1"
FIXTURE_SOURCE = "synthetic_fixture_v1"


def fee_schedule_version(fee_per_contract_cents: int) -> str:
    """Name the flat per-contract fee schedule; 65 cents gives ``flat_65c_v1``.

    Derived from the configured fee so a run's pinned version always describes
    the fee it actually charges.
    """
    return f"flat_{fee_per_contract_cents}c_v1"

# FA-1a: run modes by data class. SAMPLE_PAPER (above) replays synthetic data;
# HISTORICAL_PAPER replays historical market data. Both are paper-only.
HISTORICAL_MODE = "HISTORICAL_PAPER"
MODES = (MODE, HISTORICAL_MODE)
