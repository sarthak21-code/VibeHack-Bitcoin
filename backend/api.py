from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import bdkpython as bdk

from backend.planner import load_wallet, plan_candidates, run_planner


# ============================================================
# CONFIG
# ============================================================

SIGNET_ESPLORA_URL = "https://blockstream.info/signet/api/"


# ============================================================
# FASTAPI APP
# ============================================================

app = FastAPI(
    title="CoinLens Bitcoin Privacy Planner",
    description=(
        "Pre-signing Bitcoin transaction candidate planner "
        "and external signing facilitator"
    ),
    version="0.2.0",
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# REQUEST MODELS
# ============================================================

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


class WhatIfRequest(BaseModel):
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

    exclude_utxo_ids: Optional[List[str]] = Field(
        default_factory=list,
        description="List of UTXO outpoint strings or 'reserve' to exclude",
    )

    max_inputs: Optional[int] = Field(
        default=None,
        ge=1,
        description="Maximum number of inputs constraint",
    )


class FinalizeRequest(BaseModel):
    psbt: str = Field(
        ...,
        min_length=10,
        description="Base64-encoded signed PSBT to finalize",
    )


class BroadcastRequest(BaseModel):
    raw_transaction_hex: str = Field(
        ...,
        min_length=10,
        description="Hex-encoded signed transaction to broadcast",
    )


# ============================================================
# HEALTH
# ============================================================

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "coinlens-planner",
    }


# ============================================================
# PLAN TRANSACTION
# ============================================================

@app.post("/plan")
def plan_transaction(request: PlanRequest):
    try:
        result = run_planner(
            destination=request.destination.strip(),
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


# ============================================================
# WHAT-IF SIMULATION
# ============================================================

@app.post("/what-if")
def what_if_simulation(request: WhatIfRequest):
    """
    Deterministic scenario simulator reusing the core planner engine.

    Simulates:
    - fee changes
    - amount changes
    - reserve UTXO exclusions
    - input constraints
    """

    try:
        result = plan_candidates(
            destination=request.destination.strip(),
            amount_sats=request.amount_sats,
            fee_rate_sat_vb=request.fee_rate_sat_vb,
            exclude_utxo_ids=request.exclude_utxo_ids,
            max_inputs=request.max_inputs,
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
            detail=f"What-If error: {exc}",
        ) from exc


# ============================================================
# FINALIZE TRANSACTION
# ============================================================

@app.post("/finalize")
def finalize_transaction(request: FinalizeRequest):
    """
    Finalize a signed PSBT using the BDK wallet finalizer.

    Only returns finalized=True when the transaction
    is genuinely finalized with complete signatures.
    """

    # --------------------------------------------------------
    # Decode PSBT
    # --------------------------------------------------------

    try:
        psbt = bdk.Psbt(request.psbt.strip())

    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid PSBT encoding: {exc}",
        ) from exc

    # --------------------------------------------------------
    # Finalize
    # --------------------------------------------------------

    try:
        wallet, _ = load_wallet()

        is_finalized = wallet.finalize_psbt(psbt)

        if not is_finalized:
            return {
                "success": False,
                "finalized": False,
                "error": (
                    "Transaction could not be finalized. "
                    "Required signatures are missing or incomplete."
                ),
            }

        # ----------------------------------------------------
        # Extract finalized transaction
        # ----------------------------------------------------

        extracted_tx = psbt.extract_tx()

        raw_tx_bytes = extracted_tx.serialize()
        raw_tx_hex = bytes(raw_tx_bytes).hex()

        txid = str(
            extracted_tx.compute_txid()
        )

        signed_psbt_b64 = psbt.serialize()

        return {
            "success": True,
            "finalized": True,
            "signed_psbt": signed_psbt_b64,
            "raw_transaction_hex": raw_tx_hex,
            "txid": txid,
        }

    except Exception as exc:
        return {
            "success": False,
            "finalized": False,
            "error": f"Finalization error: {exc}",
        }


# ============================================================
# BROADCAST TRANSACTION
# ============================================================

@app.post("/broadcast")
def broadcast_transaction(request: BroadcastRequest):
    """
    Broadcast an actual signed and finalized raw transaction
    to Bitcoin Signet.

    Main safety rule:
    ONLY SIGNET transactions are permitted.
    """

    hex_str = request.raw_transaction_hex.strip()

    if not hex_str:
        raise HTTPException(
            status_code=400,
            detail="Transaction hex cannot be empty.",
        )

    # --------------------------------------------------------
    # Decode transaction
    # --------------------------------------------------------

    try:
        tx_bytes = bytes.fromhex(hex_str)
        tx = bdk.Transaction(tx_bytes)

    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid transaction hex: {exc}",
        ) from exc

    # --------------------------------------------------------
    # Explicit Signet network guard
    # --------------------------------------------------------

    wallet, _ = load_wallet()

    network = wallet.network()

    if network != bdk.Network.SIGNET:
        raise HTTPException(
            status_code=500,
            detail=(
                "Network guard failed: only SIGNET is permitted "
                f"(got {network})"
            ),
        )

    # --------------------------------------------------------
    # Broadcast
    # --------------------------------------------------------

    try:
        client = bdk.EsploraClient(
            SIGNET_ESPLORA_URL
        )

        client.broadcast(tx)

        txid = str(
            tx.compute_txid()
        )

        return {
            "success": True,
            "txid": txid,
            "network": "signet",
        }

    except Exception as exc:
        return {
            "success": False,
            "error": f"Signet broadcast failed: {exc}",
        }