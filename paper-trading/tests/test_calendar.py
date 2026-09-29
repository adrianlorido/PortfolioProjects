"""FA-1a: versioned exchange calendar and coverage (owner decision 6)."""

from datetime import date

import pytest

from paper_trading.market_data.calendar import (
    XNYS_2023_2026_V1 as CAL,
    CalendarError,
    CalendarRangeError,
    coverage_report,
    get_calendar,
    trading_days,
)


def test_regular_session_in_utc_follows_daylight_saving():
    summer = CAL.session(date(2026, 9, 29))
    assert (summer.open_utc, summer.close_utc, summer.early_close) == (
        "2026-09-29T13:30:00Z", "2026-09-29T20:00:00Z", False)
    winter = CAL.session(date(2026, 12, 1))
    assert (winter.open_utc, winter.close_utc) == ("2026-12-01T14:30:00Z", "2026-12-01T21:00:00Z")


@pytest.mark.parametrize("day, close_utc", [
    ("2023-07-03", "2023-07-03T17:00:00Z"), ("2023-11-24", "2023-11-24T18:00:00Z"),
    ("2024-07-03", "2024-07-03T17:00:00Z"), ("2024-11-29", "2024-11-29T18:00:00Z"),
    ("2024-12-24", "2024-12-24T18:00:00Z"), ("2025-07-03", "2025-07-03T17:00:00Z"),
    ("2025-11-28", "2025-11-28T18:00:00Z"), ("2025-12-24", "2025-12-24T18:00:00Z"),
    ("2026-11-27", "2026-11-27T18:00:00Z"), ("2026-12-24", "2026-12-24T18:00:00Z"),
])
def test_early_closes_at_1pm_eastern(day, close_utc):
    s = CAL.session(date.fromisoformat(day))
    assert s.early_close and s.close_utc == close_utc


@pytest.mark.parametrize("day", [
    "2023-01-02", "2023-04-07", "2024-03-29", "2024-06-19", "2025-01-09", "2025-04-18",
    "2026-04-03", "2026-07-03", "2026-11-26", "2026-12-25", "2026-10-03",  # last one: Saturday
])
def test_closed_days_have_no_session(day):
    assert CAL.session(date.fromisoformat(day)) is None


def test_unscheduled_2025_closure_is_recorded():
    assert "unscheduled" in CAL.holidays[date(2025, 1, 9)]
    assert CAL.session(date(2025, 1, 8)) is not None and CAL.session(date(2025, 1, 10)) is not None


def test_dates_outside_the_version_are_refused_not_guessed():
    with pytest.raises(CalendarRangeError, match="new calendar version"):
        CAL.session(date(2027, 1, 4))
    with pytest.raises(CalendarError, match="unknown calendar"):
        get_calendar("xnys_latest")


def test_validate_session_requires_the_exact_scheduled_boundaries():
    assert CAL.validate_session("2026-09-29T13:30:00Z", "2026-09-29T20:00:00Z").early_close is False
    with pytest.raises(CalendarError, match="does not match the scheduled session"):
        CAL.validate_session("2026-09-29T13:30:00Z", "2026-09-29T19:59:00Z")  # data ended early
    with pytest.raises(CalendarError, match="does not match"):
        CAL.validate_session("2026-11-27T14:30:00Z", "2026-11-27T21:00:00Z")  # early-close day
    with pytest.raises(CalendarError, match="not a trading day"):
        CAL.validate_session("2025-01-09T14:30:00Z", "2025-01-09T21:00:00Z")


def test_coverage_reports_gaps_without_redefining_the_session():
    s = CAL.session(date(2026, 9, 29))
    times = ["2026-09-29T13:30:01Z", "2026-09-29T13:30:02Z", "2026-09-29T14:00:00Z",
             "2026-09-29T19:00:00Z", "2026-09-29T20:05:00Z"]
    r = coverage_report(s, times, gap_threshold_seconds=5)
    assert (r.session_open, r.session_close) == (s.open_utc, s.close_utc)  # unchanged by the data
    assert r.observations == 4 and r.outside_session == 1
    assert r.leading_gap_seconds == 1 and r.trailing_gap_seconds == 3600
    assert r.gaps_over_threshold == 2 and r.max_gap_seconds == 5 * 3600
    assert not r.complete


def test_coverage_of_no_rows_is_one_full_gap():
    s = CAL.session(date(2026, 9, 29))
    r = coverage_report(s, [], gap_threshold_seconds=5)
    assert r.observations == 0 and r.leading_gap_seconds == r.trailing_gap_seconds == 6.5 * 3600
    assert not r.complete


def test_outcome_independent_date_set():
    days = trading_days(CAL, date(2025, 1, 1), date(2025, 1, 31))
    assert date(2025, 1, 9) not in days and date(2025, 1, 20) not in days and date(2025, 1, 1) not in days
    assert len(days) == 20
