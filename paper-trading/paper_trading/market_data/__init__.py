"""Market data boundary (not implemented; arrives in Step 4).

Owns contract definitions, normalized quotes, and source metadata. Supplies
data; cannot place orders. Only the registered synthetic fixture provider
(``synthetic_fixture_v1``) will be accepted; there is no live data adapter.

Planned interface (SPEC.md Section 6)::

    next_event(run_id, checkpoint) -> quote | session boundary
    get_contract(contract_id) -> OptionContract

Quote ingestion must enforce SPEC.md Section 3 quote validation and
clarification 2: when a quote carries ``session_reference_cents`` it must equal
the run's stored reference exactly.
"""

from paper_trading.market_data.interface import MarketDataProvider  # noqa: F401
