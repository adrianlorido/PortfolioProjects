"""Centralized configuration.

Values come from environment variables prefixed ``PAPER_`` or from a ``.env``
file in the working directory (see ``.env.example``). Mode is deliberately not
configurable: this application only supports ``SAMPLE_PAPER``.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from paper_trading.contracts.types import parse_utc, validate_utc_timestamp

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Fixed by the specification; not user-configurable.
SUPPORTED_SYMBOLS = frozenset({"SPY"})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="PAPER_",
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="forbid",
    )

    # Storage
    db_path: Path = Field(default=PROJECT_ROOT / "data" / "paper_trading.sqlite3")

    # Web server
    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1, le=65535)

    # Sample run parameters. Pinned into the run when it is created; changing
    # them later requires a new sample_run_key (a new run).
    sample_run_key: str = Field(default="sample-run-001", min_length=1, max_length=100)
    starting_cash_cents: int = Field(default=10_000_000, gt=0, le=2**63 - 1)
    currency: str = "USD"
    watchlist: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["SPY"])
    fee_per_contract_cents: int = Field(default=65, ge=0)
    entry_risk_limit_bps: int = Field(default=100, gt=0, le=10_000)

    # Sample session (UTC instants) and the exchange timezone used to derive
    # local dates. Defaults: 2026-09-29 09:30-16:00 America/New_York.
    session_start: str = "2026-09-29T13:30:00Z"
    session_end: str = "2026-09-29T20:00:00Z"
    session_timezone: str = "America/New_York"

    @field_validator("db_path")
    @classmethod
    def _anchor_db_path(cls, v: Path) -> Path:
        # Relative paths are relative to the paper-trading/ folder, not the shell's cwd.
        return v if v.is_absolute() else PROJECT_ROOT / v

    @field_validator("currency")
    @classmethod
    def _usd_only(cls, v: str) -> str:
        if v != "USD":
            raise ValueError("only USD is supported")
        return v

    @field_validator("watchlist", mode="before")
    @classmethod
    def _split_watchlist(cls, v):
        if isinstance(v, str):
            v = [s for s in (p.strip() for p in v.split(",")) if s]
        return v

    @field_validator("watchlist")
    @classmethod
    def _supported_symbols(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("watchlist must not be empty")
        symbols = [s.upper() for s in v]
        unsupported = sorted(set(symbols) - SUPPORTED_SYMBOLS)
        if unsupported:
            raise ValueError(f"unsupported symbols for this MVP: {unsupported}; only SPY is allowed")
        if len(set(symbols)) != len(symbols):
            raise ValueError("watchlist contains duplicates")
        return symbols

    @field_validator("session_timezone")
    @classmethod
    def _valid_timezone(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(f"unknown IANA timezone: {v}") from exc
        return v

    @field_validator("session_start", "session_end")
    @classmethod
    def _utc_timestamp(cls, v: str) -> str:
        return validate_utc_timestamp(v)

    @model_validator(mode="after")
    def _session_order(self) -> "Settings":
        if parse_utc(self.session_end) <= parse_utc(self.session_start):
            raise ValueError("session_end must be after session_start")
        return self

    @property
    def entry_risk_limit_cents(self) -> int:
        # Integer arithmetic: floor(starting cash * bps / 10000).
        return self.starting_cash_cents * self.entry_risk_limit_bps // 10_000


@lru_cache
def get_settings() -> Settings:
    return Settings()
