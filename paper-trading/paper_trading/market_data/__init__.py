"""Market data (Step 4: sample-data mode).

Owns contract definitions, normalized quotes, and source metadata. Supplies
data; cannot place orders. Only the registered synthetic fixture provider
(``synthetic_fixture_v1``) is accepted; there is no live data adapter.

  - ``fixtures``: fixture format, canonical checksum, structure and contract
    scope validation, bundled fixture registry.
  - ``intake``: pure quote-input validation with ordered reason codes and the
    source-sequence rule.

Replay itself (clock, cursor, persistence) is coordinated by
``paper_trading.app.replay``.
"""

from paper_trading.market_data.interface import MarketDataProvider  # noqa: F401
