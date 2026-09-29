"""Shared record contracts (SPEC.md Section 5, records A-J plus Run/Account).

Every model rejects unknown fields, requires ``schema_version == "1.0"``, and
uses strict types, so floats or numeric strings are never coerced into cents.
Cross-field invariants from the specification are enforced here; invariants
that need other records (e.g. quote-vs-run reference price) belong to the
module that owns that check.
"""

from __future__ import annotations

from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from paper_trading.contracts.types import (
    BasisPoints,
    Bool,
    Cents,
    Count,
    Id,
    IsoDate,
    NonPositiveCents,
    PositiveCents,
    PositiveInt,
    SchemaVersion,
    SignedCents,
    UtcTimestamp,
    parse_utc,
)


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    schema_version: SchemaVersion


# --- Enumerations ----------------------------------------------------------

Mode = Literal["SAMPLE_PAPER"]
RunStatus = Literal["READY", "RUNNING", "PAUSED", "COMPLETED", "INCOMPLETE"]
OptionType = Literal["CALL", "PUT"]
Intent = Literal["BUY_TO_OPEN", "SELL_TO_CLOSE"]
ReasonCode = Literal[
    "ENTRY_SIGNAL", "PROFIT_TARGET", "LOSS_THRESHOLD", "TIME_EXIT", "MANUAL_CLOSE", "EXIT_RETRY"
]
ExitReason = Literal["PROFIT_TARGET", "LOSS_THRESHOLD", "TIME_EXIT", "MANUAL_CLOSE", "EXIT_RETRY"]
RiskDecisionValue = Literal["APPROVED", "REJECTED"]
RiskReasonCode = Literal[
    "INSUFFICIENT_CASH",
    "RISK_LIMIT",
    "POSITION_LIMIT",
    "INVALID_QUOTE",
    "UNSUPPORTED_CONTRACT",
    "INSUFFICIENT_POSITION",
    "STALE_ACCOUNT_REVISION",
]
OrderStatus = Literal["PENDING", "OPEN", "FILLED", "REJECTED", "CANCELED", "EXPIRED"]
TERMINAL_ORDER_STATUSES = frozenset({"FILLED", "REJECTED", "CANCELED", "EXPIRED"})
PositionStatus = Literal["OPEN", "CLOSED"]
ValuationStatus = Literal["CURRENT", "STALE", "UNAVAILABLE"]
LedgerEntryType = Literal["INITIAL_FUNDING", "BUY_FILL", "SELL_FILL"]


# --- Supporting records ----------------------------------------------------


class Run(Record):
    """A sample paper-trading run. Pins versions and parameters at creation.

    Fixture fields and the session reference price are nullable only while the
    run is READY (the fixture is attached in Step 4); see SPEC.md 11.2.
    """

    run_id: Id
    init_key: Id
    mode: Mode
    is_sample: Literal[True]
    status: RunStatus
    created_at: UtcTimestamp
    currency: Literal["USD"]
    starting_cash_cents: PositiveCents
    watchlist: list[Literal["SPY"]] = Field(min_length=1)
    strategy_id: Id
    strategy_version: Id
    risk_policy_version: Id
    execution_model_version: Id
    fee_schedule_version: Id
    fee_per_contract_cents: Cents
    entry_risk_limit_cents: PositiveCents
    session_timezone: Literal["America/New_York"]
    session_start: UtcTimestamp
    session_end: UtcTimestamp
    simulated_clock: UtcTimestamp
    session_reference_cents: Optional[PositiveCents]
    fixture_id: Optional[Id]
    fixture_version: Optional[Id]
    fixture_checksum: Optional[Id]
    checkpoint_event_sequence: Count
    # Step 5: trading-enabled runs run the trading workflow; replay-only runs stay READY.
    trading_enabled: Bool = False
    status_reason: Optional[str] = None

    @model_validator(mode="after")
    def _check(self) -> "Run":
        if parse_utc(self.session_end) <= parse_utc(self.session_start):
            raise ValueError("session_end must be after session_start")
        if len(set(self.watchlist)) != len(self.watchlist):
            raise ValueError("watchlist contains duplicates")
        if self.status != "READY" and None in (
            self.session_reference_cents,
            self.fixture_id,
            self.fixture_version,
            self.fixture_checksum,
        ):
            raise ValueError("a run past READY must pin fixture metadata and session reference")
        return self


class Account(Record):
    """Virtual account. Holds no cash balance: cash is derived from the ledger."""

    account_id: Id
    run_id: Id
    currency: Literal["USD"]
    starting_cash_cents: PositiveCents
    account_revision: PositiveInt
    created_at: UtcTimestamp


class WatchlistItem(Record):
    run_id: Id
    symbol: Literal["SPY"]
    position: Count


# --- A. Option contract ----------------------------------------------------


class OptionContract(Record):
    contract_id: Id
    underlying: Id
    expiration_date: IsoDate
    option_type: OptionType
    strike_cents: PositiveCents
    currency: Literal["USD"]
    multiplier: PositiveInt
    deliverable: Id
    exercise_style: Literal["AMERICAN", "EUROPEAN"]
    settlement_type: Literal["PHYSICAL", "CASH"]
    adjusted: Bool


# --- B. Market quote -------------------------------------------------------


class MarketQuote(Record):
    quote_id: Id
    run_id: Id
    contract_id: Id
    source: Id
    is_sample: Literal[True]
    source_sequence: Count
    observed_at: UtcTimestamp
    received_at: UtcTimestamp
    bid_cents: Cents
    ask_cents: PositiveCents
    bid_size: Count
    ask_size: Count
    underlying_price_cents: PositiveCents
    underlying_observed_at: UtcTimestamp
    # Optional per SPEC.md clarification 2; must equal the run's reference when present.
    session_reference_cents: Optional[PositiveCents] = None

    @model_validator(mode="after")
    def _check(self) -> "MarketQuote":
        if self.bid_cents > self.ask_cents:
            raise ValueError("bid_cents must not exceed ask_cents")
        return self


# --- C. Trade proposal -----------------------------------------------------


class ExitRules(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    profit_target_bps: BasisPoints
    loss_threshold_bps: BasisPoints
    max_hold_seconds: PositiveInt


class TradeProposal(Record):
    proposal_id: Id
    run_id: Id
    account_id: Id
    contract_id: Id
    position_id: Optional[Id]
    quote_id: Id
    strategy_id: Id
    strategy_version: Id
    created_at: UtcTimestamp
    intent: Intent
    quantity: PositiveInt
    limit_cents: PositiveCents
    reason_code: ReasonCode
    reason: str = Field(min_length=1)
    exit_rules: ExitRules
    idempotency_key: Id

    @model_validator(mode="after")
    def _check(self) -> "TradeProposal":
        if self.intent == "BUY_TO_OPEN":
            if self.position_id is not None:
                raise ValueError("entry proposals must have position_id null")
            if self.reason_code != "ENTRY_SIGNAL":
                raise ValueError("entry proposals must use reason_code ENTRY_SIGNAL")
        else:
            if self.position_id is None:
                raise ValueError("closing proposals require position_id")
            if self.reason_code == "ENTRY_SIGNAL":
                raise ValueError("closing proposals cannot use ENTRY_SIGNAL")
        return self


# --- D. Risk decision ------------------------------------------------------


class RiskDecision(Record):
    risk_decision_id: Id
    run_id: Id
    proposal_id: Id
    evaluated_at: UtcTimestamp
    policy_version: Id
    account_revision: PositiveInt
    decision: RiskDecisionValue
    reason_codes: list[RiskReasonCode]
    required_cash_cents: Cents
    available_cash_cents: SignedCents
    entry_risk_cents: Cents
    entry_risk_limit_cents: Cents

    @model_validator(mode="after")
    def _check(self) -> "RiskDecision":
        if self.decision == "REJECTED" and not self.reason_codes:
            raise ValueError("rejected decisions require at least one reason code")
        if self.decision == "APPROVED" and self.reason_codes:
            raise ValueError("approved decisions must not carry rejection reasons")
        if len(set(self.reason_codes)) != len(self.reason_codes):
            raise ValueError("reason_codes contains duplicates")
        return self


# --- E. Order --------------------------------------------------------------


class Order(Record):
    order_id: Id
    run_id: Id
    account_id: Id
    proposal_id: Id
    risk_decision_id: Id
    contract_id: Id
    position_id: Optional[Id]
    intent: Intent
    quantity: PositiveInt
    limit_cents: PositiveCents
    status: OrderStatus
    submitted_at: UtcTimestamp
    updated_at: UtcTimestamp
    expires_at: UtcTimestamp
    after_source_sequence: Count
    reserved_cash_cents: Cents
    reserved_contracts: Count
    idempotency_key: Id
    terminal_reason: Optional[Annotated[str, Field(min_length=1)]]

    @model_validator(mode="after")
    def _check(self) -> "Order":
        if self.intent == "BUY_TO_OPEN":
            if self.position_id is not None:
                raise ValueError("buy-to-open orders must have position_id null")
            if self.reserved_contracts != 0:
                raise ValueError("buy orders reserve cash, not contracts")
        else:
            if self.position_id is None:
                raise ValueError("sell-to-close orders require position_id")
            if self.reserved_cash_cents != 0:
                raise ValueError("sell orders reserve contracts, not cash")
        if self.status in TERMINAL_ORDER_STATUSES:
            if self.reserved_cash_cents or self.reserved_contracts:
                raise ValueError("terminal orders retain no reservations")
        if self.status in {"REJECTED", "CANCELED", "EXPIRED"} and self.terminal_reason is None:
            raise ValueError(f"{self.status} orders require terminal_reason")
        if self.status in {"PENDING", "OPEN"} and self.terminal_reason is not None:
            raise ValueError("non-terminal orders cannot have terminal_reason")
        if parse_utc(self.expires_at) <= parse_utc(self.submitted_at):
            raise ValueError("expires_at must be after submitted_at")
        return self


# --- F. Fill ---------------------------------------------------------------


class Fill(Record):
    fill_id: Id
    run_id: Id
    order_id: Id
    quote_id: Id
    filled_at: UtcTimestamp
    quantity: PositiveInt
    price_cents: PositiveCents
    multiplier: PositiveInt
    gross_cents: Cents
    fee_cents: Cents
    execution_model_version: Id
    fee_schedule_version: Id

    @model_validator(mode="after")
    def _check(self) -> "Fill":
        if self.gross_cents != self.price_cents * self.multiplier * self.quantity:
            raise ValueError("gross_cents must equal price_cents * multiplier * quantity")
        return self


# --- G. Position -----------------------------------------------------------


class Position(Record):
    position_id: Id
    run_id: Id
    account_id: Id
    contract_id: Id
    entry_fill_id: Id
    opened_at: UtcTimestamp
    closed_at: Optional[UtcTimestamp]
    status: PositionStatus
    quantity: Count
    reserved_contracts: Count
    entry_price_cents: PositiveCents
    remaining_cost_basis_cents: Cents
    mark_quote_id: Optional[Id]
    market_value_cents: Optional[Cents]
    unrealized_pnl_cents: Optional[SignedCents]
    valuation_status: ValuationStatus

    @model_validator(mode="after")
    def _check(self) -> "Position":
        if self.reserved_contracts > self.quantity:
            raise ValueError("reserved_contracts cannot exceed quantity")
        if self.status == "CLOSED":
            if self.closed_at is None:
                raise ValueError("closed positions require closed_at")
            if any(
                (
                    self.quantity,
                    self.reserved_contracts,
                    self.remaining_cost_basis_cents,
                    self.market_value_cents,
                    self.unrealized_pnl_cents,
                )
            ):
                raise ValueError("closed positions must have zero quantity, reservations, basis, value, and P&L")
        else:
            if self.closed_at is not None:
                raise ValueError("open positions cannot have closed_at")
            if self.quantity == 0:
                raise ValueError("open positions require positive quantity")
        if self.market_value_cents is not None and self.unrealized_pnl_cents is not None:
            if self.unrealized_pnl_cents != self.market_value_cents - self.remaining_cost_basis_cents:
                raise ValueError("unrealized_pnl_cents must equal market value minus cost basis")
        if self.status == "OPEN" and self.valuation_status == "UNAVAILABLE":
            if self.market_value_cents is not None or self.unrealized_pnl_cents is not None:
                raise ValueError("unavailable valuations must have null value and P&L")
        if self.status == "OPEN" and self.valuation_status != "UNAVAILABLE":
            if self.market_value_cents is None or self.mark_quote_id is None:
                raise ValueError("current or stale valuations require a mark and market value")
        return self


# --- H. Account snapshot ---------------------------------------------------


class AccountSnapshot(Record):
    snapshot_id: Id
    run_id: Id
    account_id: Id
    account_revision: PositiveInt
    as_of: UtcTimestamp
    currency: Literal["USD"]
    starting_cash_cents: PositiveCents
    cash_cents: SignedCents
    reserved_cash_cents: Cents
    available_cash_cents: SignedCents
    market_value_cents: Optional[Cents]
    equity_cents: Optional[SignedCents]
    realized_pnl_cents: SignedCents
    unrealized_pnl_cents: Optional[SignedCents]
    fees_paid_cents: Cents
    valuation_status: ValuationStatus

    @model_validator(mode="after")
    def _check(self) -> "AccountSnapshot":
        if self.available_cash_cents != self.cash_cents - self.reserved_cash_cents:
            raise ValueError("available_cash_cents must equal cash minus reserved cash")
        valued = (self.market_value_cents, self.equity_cents, self.unrealized_pnl_cents)
        if self.valuation_status == "UNAVAILABLE":
            if any(v is not None for v in valued):
                raise ValueError("unavailable valuation requires null market value, equity, and unrealized P&L")
        else:
            if any(v is None for v in valued):
                raise ValueError("current or stale valuation requires market value, equity, and unrealized P&L")
            if self.equity_cents != self.cash_cents + self.market_value_cents:
                raise ValueError("equity_cents must equal cash plus market value")
        return self


# --- I. Cash ledger entry --------------------------------------------------


class CashLedgerEntry(Record):
    ledger_entry_id: Id
    run_id: Id
    account_id: Id
    ledger_sequence: PositiveInt
    recorded_at: UtcTimestamp
    entry_type: LedgerEntryType
    fill_id: Optional[Id]
    premium_cash_delta_cents: SignedCents
    fee_cash_delta_cents: NonPositiveCents
    net_cash_delta_cents: SignedCents
    balance_after_cents: SignedCents

    @model_validator(mode="after")
    def _check(self) -> "CashLedgerEntry":
        if self.net_cash_delta_cents != self.premium_cash_delta_cents + self.fee_cash_delta_cents:
            raise ValueError("net_cash_delta_cents must equal premium delta plus fee delta")
        if self.entry_type == "INITIAL_FUNDING":
            if self.fill_id is not None:
                raise ValueError("initial funding has no fill")
            if self.fee_cash_delta_cents != 0 or self.premium_cash_delta_cents <= 0:
                raise ValueError("initial funding must be a positive, fee-free credit")
        else:
            if self.fill_id is None:
                raise ValueError("fill ledger entries require fill_id")
            if self.entry_type == "BUY_FILL" and self.premium_cash_delta_cents >= 0:
                raise ValueError("buy fills debit premium")
            if self.entry_type == "SELL_FILL" and self.premium_cash_delta_cents <= 0:
                raise ValueError("sell fills credit premium")
        return self


# --- J. Closed-trade record ------------------------------------------------


class ClosedTrade(Record):
    closed_trade_id: Id
    run_id: Id
    position_id: Id
    entry_fill_id: Id
    exit_fill_id: Id
    strategy_id: Id
    strategy_version: Id
    opened_at: UtcTimestamp
    closed_at: UtcTimestamp
    quantity: PositiveInt
    entry_cost_cents: PositiveCents
    exit_net_proceeds_cents: SignedCents
    total_fees_cents: Cents
    realized_pnl_cents: SignedCents
    exit_reason: ExitReason

    @model_validator(mode="after")
    def _check(self) -> "ClosedTrade":
        if self.realized_pnl_cents != self.exit_net_proceeds_cents - self.entry_cost_cents:
            raise ValueError("realized_pnl_cents must equal net proceeds minus entry cost")
        if self.entry_fill_id == self.exit_fill_id:
            raise ValueError("entry and exit fills must differ")
        if parse_utc(self.closed_at) < parse_utc(self.opened_at):
            raise ValueError("closed_at cannot precede opened_at")
        return self
