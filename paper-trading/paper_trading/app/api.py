"""FastAPI application: health, read-only JSON endpoints, and the dashboard.

There are no write endpoints in Step 3. Initialization is a CLI command, and
trading commands do not exist yet.
"""

from __future__ import annotations

import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Iterator, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from paper_trading import __version__
from paper_trading.accounting import compute_snapshot, reconcile
from paper_trading.app import queries
from paper_trading.config import Settings, get_settings
from paper_trading.contracts.versions import MODE
from paper_trading.storage.db import connect
from paper_trading.storage.migrator import require_current
from paper_trading.web.format import format_cents, format_signed_cents

WEB_DIR = Path(__file__).resolve().parent.parent / "web"


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

    @app.get("/", response_class=HTMLResponse)
    def dashboard(request: Request, conn: sqlite3.Connection = Depends(get_conn)):
        try:
            dash = queries.get_dashboard(conn, settings.sample_run_key)
        except queries.RunNotFoundError as exc:
            return templates.TemplateResponse(
                request, "not_initialized.html", {"message": str(exc)}, status_code=404
            )
        return templates.TemplateResponse(request, "dashboard.html", {"d": dash})

    return app
