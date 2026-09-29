from __future__ import annotations

from typing import Optional, Protocol

from paper_trading.contracts.models import AccountSnapshot, MarketQuote, Position, RiskDecision, TradeProposal


class RiskEvaluator(Protocol):
    policy_version: str

    def evaluate(
        self,
        proposal: TradeProposal,
        account: AccountSnapshot,
        position: Optional[Position],
        quote: MarketQuote,
        policy: dict,
    ) -> RiskDecision: ...
