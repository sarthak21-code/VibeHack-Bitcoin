from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from planner import run_planner


app = FastAPI(
    title="VibeHack Bitcoin Privacy Planner",
    description="Pre-signing Bitcoin transaction candidate planner",
    version="0.1.0",
)


# Allow the future React frontend to call the API locally.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PlanRequest(BaseModel):
    destination: str = Field(
        ...,
        min_length=10,
        description="Signet destination address",
    )

    amount_sats: int = Field(
        ...,
        gt=0,
        description="Payment amount in satoshis",
    )

    fee_rate_sat_vb: int = Field(
        default=1,
        ge=1,
        description="Fee rate in sat/vB",
    )


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "vibehack-planner",
    }


@app.post("/plan")
def plan_transaction(request: PlanRequest):
    try:
        result = run_planner(
            destination=request.destination,
            amount_sats=request.amount_sats,
            fee_rate_sat_vb=request.fee_rate_sat_vb,
        )

        return result

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Planner error: {exc}",
        ) from exc
