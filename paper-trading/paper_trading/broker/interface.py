from __future__ import annotations

from typing import Protocol

from paper_trading.contracts.models import Fill, Order

ORDER_TTL_SECONDS = 60


class PaperBroker(Protocol):
    def submit(self, proposal_id: str, idempotency_key: str) -> Order: ...

    def on_quote(self, quote_id: str) -> list[Fill]: ...

    def cancel(self, order_id: str, idempotency_key: str) -> Order: ...
