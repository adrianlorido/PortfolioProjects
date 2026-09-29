from __future__ import annotations

from typing import Protocol, Union

from paper_trading.contracts.models import MarketQuote, OptionContract


class SessionBoundary(Protocol):
    kind: str  # "SESSION_START" | "SESSION_END"
    at: str


class MarketDataProvider(Protocol):
    def next_event(self, run_id: str, checkpoint: int) -> Union[MarketQuote, SessionBoundary, None]: ...

    def get_contract(self, contract_id: str) -> OptionContract: ...
