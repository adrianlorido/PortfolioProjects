from __future__ import annotations

from typing import Optional, Protocol

from paper_trading.contracts.models import AccountSnapshot, MarketQuote, Position, TradeProposal

ENTRY_REJECTION_COOLDOWN_SECONDS = 60  # SPEC.md clarification 1


class Strategy(Protocol):
    strategy_id: str
    strategy_version: str

    def evaluate(
        self,
        event: MarketQuote,
        account: AccountSnapshot,
        position: Optional[Position],
        strategy_config: dict,
    ) -> Optional[TradeProposal]: ...
