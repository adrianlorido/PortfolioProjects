"""FastAPI application: health, read endpoints, replay commands, and the dashboard.

The only write endpoints are the Step 4 replay commands under /api/replay/.
They call the same coordinator functions as the CLI. Initialization is a CLI
command, and there are no trading endpoints.
"""

from __future__ import annotations

import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Iterator, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from paper_trading import __version__
from paper_trading.accounting import compute_snapshot, reconcile
from paper_trading.app import queries, replay
from paper_trading.app.coordinator import IdempotencyConflictError
from paper_trading.config import Settings, get_settings
from paper_trading.contracts.versions import MODE
from paper_trading.market_data.fixtures import (
    DEFAULT_FIXTURE_ID,
    FixtureValidationError,
    bundled_fixtures,
    read_fixture_file,
)
from paper_trading.storage.db import connect
from paper_trading.storage.migrator import require_current
from paper_trading.web.format import format_cents, format_signed_cents

WEB_DIR = Path(__file__).resolve().parent.parent / "web"

_ERROR_STATUS = {
    replay.ReplayNotLoadedError: 409,
    replay.ReplayPausedError: 409,
    replay.ReplayExhaustedError: 409,
    replay.FixtureConflictError: 409,
    IdempotencyConflictError: 409,
    FixtureValidationError: 422,
}


class CommandBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotency_key: str = Field(min_length=1, max_length=200)


class LoadBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fixture_id: str = Field(min_length=1, max_length=200)


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Fail fast: never create or migrate a database implicitly on startup.
        conn = connect(settings.db_path)
        try:
            app.state.schema_version = require_current(conn)
        finally:
            conn.close()
        yield

    app = FastAPI(
        title="Options Paper Trading (SAMPLE DATA — PAPER ONLY)",
        version=__version__,
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.mount("/static", StaticFiles(directory=WEB_DIR / "static"), name="static")
    templates = Jinja2Templates(directory=WEB_DIR / "templates")
    templates.env.filters["usd"] = format_cents
    templates.env.filters["usd_signed"] = format_signed_cents

    def get_conn() -> Iterator[sqlite3.Connection]:
        # One connection per request: SQLite connections are not shared across threads.
        conn = connect(settings.db_path)
        try:
            yield conn
        finally:
            conn.close()

    def current_run(conn: sqlite3.Connection = Depends(get_conn)):
        try:
            return queries.get_run(conn, settings.sample_run_key)
        except queries.RunNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/health")
    def health(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
        try:
            run = queries.get_run(conn, settings.sample_run_key)
        except queries.RunNotFoundError:
            run = None
        return {
            "status": "ok",
            "mode": MODE,
            "is_sample": True,
            "app_version": __version__,
            "db_schema_version": app.state.schema_version,
            "run_initialized": run is not None,
            "run_id": run.run_id if run else None,
        }

    @app.get("/api/run")
    def run_details(run=Depends(current_run)) -> dict:
        return {**run.model_dump(), "session_local_date": queries.session_local_date(run)}

    @app.get("/api/account")
    def account(run=Depends(current_run), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
        acct = queries.get_account(conn, run.run_id)
        rec = reconcile(conn, run.run_id)
        return {
            "snapshot": compute_snapshot(conn, acct.account_id).model_dump(),
            "unrealized_pnl_convention": "Marked at latest valid bid; excludes prospective exit fee.",
            "reconciliation": {"ok": rec.ok, "discrepancies": rec.discrepancies},
        }

    @app.get("/api/watchlist")
    def watchlist(run=Depends(current_run)) -> dict:
        return {"run_id": run.run_id, "symbols": list(run.watchlist)}

    @app.get("/api/positions")
    def positions(run=Depends(current_run), conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
        return [p.model_dump() for p in queries.list_positions(conn, run.run_id)]

    @app.get("/api/orders")
    def orders(run=Depends(current_run), conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
        return [o.model_dump() for o in queries.list_orders(conn, run.run_id)]

    @app.get("/api/closed-trades")
    def closed_trades(run=Depends(current_run), conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
        return [t.model_dump() for t in queries.list_closed_trades(conn, run.run_id)]

    # --- Step 4: sample-data replay -------------------------------------

    @app.exception_handler(replay.ReplayError)
    @app.exception_handler(IdempotencyConflictError)
    @app.exception_handler(FixtureValidationError)
    async def _command_error(request: Request, exc: Exception):
        code = getattr(exc, "code", type(exc).__name__)
        return JSONResponse(status_code=_ERROR_STATUS.get(type(exc), 409),
                            content={"error": code, "detail": str(exc)})

    @app.get("/api/replay")
    def replay_state(run=Depends(current_run), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
        return {
            "run_id": run.run_id,
            "run_status": run.status,
            "simulated_clock": conn.execute(
                "SELECT simulated_clock FROM runs WHERE run_id = ?", (run.run_id,)).fetchone()[0],
            "replay": queries.get_replay_state(conn, run.run_id),
            "available_fixtures": sorted(bundled_fixtures()),
        }

    @app.get("/api/replay/events")
    def replay_events(run=Depends(current_run), conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
        return queries.list_replay_events(conn, run.run_id)

    @app.get("/api/quotes")
    def quotes(run=Depends(current_run), conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
        return [q.model_dump() for q in queries.list_quotes(conn, run.run_id)]

    @app.get("/api/rejected-inputs")
    def rejected_inputs(run=Depends(current_run), conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
        return queries.list_rejected_inputs(conn, run.run_id)

    @app.get("/api/market")
    def market(run=Depends(current_run), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
        return queries.latest_market_state(conn, run.run_id)

    @app.post("/api/replay/load")
    def replay_load(body: LoadBody, run=Depends(current_run), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
        # Only fixtures bundled in paper-trading/fixtures/ can be loaded over HTTP; no arbitrary paths.
        path = bundled_fixtures().get(body.fixture_id)
        if path is None:
            raise HTTPException(status_code=404, detail=f"no bundled fixture {body.fixture_id!r}")
        doc, content = read_fixture_file(path)
        result = replay.load_fixture(conn, run.run_id, doc, content)
        return {**result.__dict__}

    @app.post("/api/replay/step")
    def replay_step(body: CommandBody, run=Depends(current_run), conn: sqlite3.Connection = Depends(get_conn)):
        return replay.step(conn, run.run_id, body.idempotency_key)

    @app.post("/api/replay/pause")
    def replay_pause(body: CommandBody, run=Depends(current_run), conn: sqlite3.Connection = Depends(get_conn)):
        return replay.pause(conn, run.run_id, body.idempotency_key)

    @app.post("/api/replay/resume")
    def replay_resume(body: CommandBody, run=Depends(current_run), conn: sqlite3.Connection = Depends(get_conn)):
        return replay.resume(conn, run.run_id, body.idempotency_key)

    @app.post("/api/replay/run-to-end")
    def replay_run_to_end(body: CommandBody, run=Depends(current_run),
                          conn: sqlite3.Connection = Depends(get_conn)):
        return replay.run_to_end(conn, run.run_id, body.idempotency_key)

    @app.get("/", response_class=HTMLResponse)
    def dashboard(request: Request, conn: sqlite3.Connection = Depends(get_conn)):
        try:
            dash = queries.get_dashboard(conn, settings.sample_run_key)
        except queries.RunNotFoundError as exc:
            return templates.TemplateResponse(
                request, "not_initialized.html", {"message": str(exc)}, status_code=404
            )
        return templates.TemplateResponse(
            request, "dashboard.html",
            {"d": dash, "bundled_fixtures": sorted(bundled_fixtures()), "default_fixture": DEFAULT_FIXTURE_ID},
        )

    return app
