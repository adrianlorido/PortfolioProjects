"""Versioned exchange calendar and coverage checks (FA-1a, owner decision 6).

A historical dataset's session boundaries come from this calendar, never from
the data: missing rows cannot shorten or move a session. ``coverage_report``
describes gaps against the scheduled session and changes nothing.

Calendar ``xnys_2023_2026_v1`` (NYSE equities schedule, America/New_York):
- regular session 09:30-16:00;
- early close 13:00 on the listed days;
- closed on weekends and the listed holidays, including the unscheduled
  closure of 2025-01-09 (National Day of Mourning for former President Carter).

Source: NYSE Group holiday and early-close announcements for 2023-2026 (checked
2026-09-29). Known limitation: on early-close days eligible index and ETF
options, including SPY options, may trade until 13:15, 15 minutes after the
equity close. This calendar schedules the equity session only. A dataset that
needs the options-only interval requires a new calendar version and an owner
decision. Dates outside 2023-2026 raise ``CalendarRangeError``; a new year
means a new calendar version, never an edit to this one.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Iterable, Optional
from zoneinfo import ZoneInfo

from paper_trading.contracts.types import format_utc, parse_utc

EXCHANGE_TZ = ZoneInfo("America/New_York")


class CalendarError(ValueError):
    pass


class CalendarRangeError(CalendarError):
    """The date is outside the years this calendar version covers."""


@dataclass(frozen=True)
class ScheduledSession:
    calendar_id: str
    session_date: date
    open_utc: str
    close_utc: str
    early_close: bool


@dataclass(frozen=True)
class ExchangeCalendar:
    calendar_id: str
    first_year: int
    last_year: int
    regular_open: time
    regular_close: time
    early_close_time: time
    holidays: dict[date, str]
    early_closes: dict[date, str]
    source_note: str

    def _check_range(self, d: date) -> None:
        if not self.first_year <= d.year <= self.last_year:
            raise CalendarRangeError(
                f"{d.isoformat()} is outside calendar {self.calendar_id} "
                f"({self.first_year}-{self.last_year}); a new calendar version is required"
            )

    def is_trading_day(self, d: date) -> bool:
        self._check_range(d)
        return d.weekday() < 5 and d not in self.holidays

    def session(self, d: date) -> Optional[ScheduledSession]:
        """The scheduled session for a local date, or None if the exchange is closed."""
        if not self.is_trading_day(d):
            return None
        early = d in self.early_closes
        close = self.early_close_time if early else self.regular_close
        open_utc = datetime.combine(d, self.regular_open, EXCHANGE_TZ).astimezone(timezone.utc)
        close_utc = datetime.combine(d, close, EXCHANGE_TZ).astimezone(timezone.utc)
        return ScheduledSession(self.calendar_id, d, format_utc(open_utc), format_utc(close_utc), early)

    def validate_session(self, start_utc: str, end_utc: str) -> ScheduledSession:
        """Require a dataset session to equal a scheduled session exactly."""
        local = parse_utc(start_utc).astimezone(EXCHANGE_TZ).date()
        scheduled = self.session(local)
        if scheduled is None:
            reason = self.holidays.get(local, "weekend")
            raise CalendarError(f"{local.isoformat()} is not a trading day in {self.calendar_id} ({reason})")
        if parse_utc(start_utc) != parse_utc(scheduled.open_utc) or \
                parse_utc(end_utc) != parse_utc(scheduled.close_utc):
            raise CalendarError(
                f"session {start_utc}..{end_utc} does not match the scheduled session "
                f"{scheduled.open_utc}..{scheduled.close_utc} for {local.isoformat()} in {self.calendar_id}"
            )
        return scheduled


def _d(s: str) -> date:
    return date.fromisoformat(s)


XNYS_2023_2026_V1 = ExchangeCalendar(
    calendar_id="xnys_2023_2026_v1",
    first_year=2023,
    last_year=2026,
    regular_open=time(9, 30),
    regular_close=time(16, 0),
    early_close_time=time(13, 0),
    holidays={
        # 2023
        _d("2023-01-02"): "New Year's Day (observed)", _d("2023-01-16"): "Martin Luther King Jr. Day",
        _d("2023-02-20"): "Washington's Birthday", _d("2023-04-07"): "Good Friday",
        _d("2023-05-29"): "Memorial Day", _d("2023-06-19"): "Juneteenth", _d("2023-07-04"): "Independence Day",
        _d("2023-09-04"): "Labor Day", _d("2023-11-23"): "Thanksgiving Day", _d("2023-12-25"): "Christmas Day",
        # 2024
        _d("2024-01-01"): "New Year's Day", _d("2024-01-15"): "Martin Luther King Jr. Day",
        _d("2024-02-19"): "Washington's Birthday", _d("2024-03-29"): "Good Friday",
        _d("2024-05-27"): "Memorial Day", _d("2024-06-19"): "Juneteenth", _d("2024-07-04"): "Independence Day",
        _d("2024-09-02"): "Labor Day", _d("2024-11-28"): "Thanksgiving Day", _d("2024-12-25"): "Christmas Day",
        # 2025
        _d("2025-01-01"): "New Year's Day",
        _d("2025-01-09"): "National Day of Mourning (unscheduled closure)",
        _d("2025-01-20"): "Martin Luther King Jr. Day", _d("2025-02-17"): "Washington's Birthday",
        _d("2025-04-18"): "Good Friday", _d("2025-05-26"): "Memorial Day", _d("2025-06-19"): "Juneteenth",
        _d("2025-07-04"): "Independence Day", _d("2025-09-01"): "Labor Day",
        _d("2025-11-27"): "Thanksgiving Day", _d("2025-12-25"): "Christmas Day",
        # 2026
        _d("2026-01-01"): "New Year's Day", _d("2026-01-19"): "Martin Luther King Jr. Day",
        _d("2026-02-16"): "Washington's Birthday", _d("2026-04-03"): "Good Friday",
        _d("2026-05-25"): "Memorial Day", _d("2026-06-19"): "Juneteenth",
        _d("2026-07-03"): "Independence Day (observed)", _d("2026-09-07"): "Labor Day",
        _d("2026-11-26"): "Thanksgiving Day", _d("2026-12-25"): "Christmas Day",
    },
    early_closes={
        _d("2023-07-03"): "day before Independence Day", _d("2023-11-24"): "day after Thanksgiving",
        _d("2024-07-03"): "day before Independence Day", _d("2024-11-29"): "day after Thanksgiving",
        _d("2024-12-24"): "Christmas Eve",
        _d("2025-07-03"): "day before Independence Day", _d("2025-11-28"): "day after Thanksgiving",
        _d("2025-12-24"): "Christmas Eve",
        _d("2026-11-27"): "day after Thanksgiving", _d("2026-12-24"): "Christmas Eve",
    },
    source_note="NYSE Group holiday and early-close announcements 2023-2026; equity session only.",
)

CALENDARS = {XNYS_2023_2026_V1.calendar_id: XNYS_2023_2026_V1}


def get_calendar(calendar_id: str) -> ExchangeCalendar:
    try:
        return CALENDARS[calendar_id]
    except KeyError:
        raise CalendarError(f"unknown calendar {calendar_id!r}; known: {sorted(CALENDARS)}") from None


# --- coverage ------------------------------------------------------------------


@dataclass
class CoverageReport:
    """How well observations cover a scheduled session. Descriptive only."""

    calendar_id: str
    session_open: str
    session_close: str
    observations: int = 0
    outside_session: int = 0
    first_observation: Optional[str] = None
    last_observation: Optional[str] = None
    leading_gap_seconds: Optional[float] = None
    trailing_gap_seconds: Optional[float] = None
    max_gap_seconds: float = 0.0
    gap_threshold_seconds: float = 0.0
    gaps_over_threshold: int = 0
    gap_examples: list[tuple[str, str, float]] = field(default_factory=list)

    @property
    def complete(self) -> bool:
        return self.observations > 0 and self.outside_session == 0 and self.gaps_over_threshold == 0 and \
            (self.leading_gap_seconds or 0) <= self.gap_threshold_seconds and \
            (self.trailing_gap_seconds or 0) <= self.gap_threshold_seconds


def coverage_report(session: ScheduledSession, observation_times: Iterable[str], *,
                    gap_threshold_seconds: float, max_examples: int = 20) -> CoverageReport:
    """Report gaps between consecutive observations inside the scheduled session.

    Streaming (constant memory apart from ``max_examples``). The scheduled
    session is an input and is never adjusted to fit the observations.
    """
    open_t, close_t = parse_utc(session.open_utc), parse_utc(session.close_utc)
    report = CoverageReport(session.calendar_id, session.open_utc, session.close_utc,
                            gap_threshold_seconds=gap_threshold_seconds)
    previous: Optional[datetime] = None
    for text in observation_times:
        t = parse_utc(text)
        if not open_t <= t <= close_t:
            report.outside_session += 1
            continue
        report.observations += 1
        if previous is None:
            report.first_observation = text
            report.leading_gap_seconds = (t - open_t).total_seconds()
        else:
            if t < previous:
                raise CalendarError("observation times must be non-decreasing")
            gap = (t - previous).total_seconds()
            report.max_gap_seconds = max(report.max_gap_seconds, gap)
            if gap > gap_threshold_seconds:
                report.gaps_over_threshold += 1
                if len(report.gap_examples) < max_examples:
                    report.gap_examples.append((format_utc(previous), text, gap))
        previous = t
        report.last_observation = text
    if previous is not None:
        report.trailing_gap_seconds = (close_t - previous).total_seconds()
    else:
        report.leading_gap_seconds = report.trailing_gap_seconds = (close_t - open_t).total_seconds()
    return report


def trading_days(calendar: ExchangeCalendar, first: date, last: date) -> list[date]:
    """Every scheduled trading day in [first, last]: an outcome-independent date set (decision 7)."""
    days, d = [], first
    while d <= last:
        if calendar.is_trading_day(d):
            days.append(d)
        d += timedelta(days=1)
    return days
