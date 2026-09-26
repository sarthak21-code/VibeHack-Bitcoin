"""
Future optionality and rare/important UTXO preservation analysis.

Evaluates:
1. Whether candidate inputs consume rare or important UTXOs (e.g., large reserves,
   special privacy denominations, or labeled coins).
2. Impact on remaining wallet UTXOs and available cluster choices for future transactions.

Note:
- Deterministic heuristic analysis answering:
  "What useful wallet option am I giving up by spending this UTXO now?"
- No arbitrary numerical scoring is used.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from .models import (
    CandidateInput,
    Finding,
    FutureOptionalityAnalysis,
    UTXOMetadata,
)


def analyze_optionality(
    inputs: list[CandidateInput],
    utxo_metadata: Optional[dict[str, UTXOMetadata | dict[str, Any]]] = None,
    wallet_utxos: Optional[list[Any]] = None,
    change_created: bool = False,
) -> tuple[FutureOptionalityAnalysis, list[Finding]]:
    """
    Evaluate future optionality impact when spending selected inputs.

    Returns:
        (FutureOptionalityAnalysis, findings)
    """
    utxo_metadata = utxo_metadata or {}
    findings: list[Finding] = []

    consumed_rare_outpoints: list[str] = []

    for inp in inputs:
        meta = utxo_metadata.get(inp.outpoint)
        if meta is None:
            continue

        is_rare = False
        label = None
        if isinstance(meta, UTXOMetadata):
            is_rare = meta.rare or (meta.label is not None and "important" in meta.label.lower())
            label = meta.label
        elif isinstance(meta, dict):
            is_rare = bool(meta.get("rare", False)) or (
                meta.get("label") is not None and "important" in str(meta.get("label")).lower()
            )
            label = meta.get("label")

        if is_rare:
            consumed_rare_outpoints.append(inp.outpoint)

    rare_utxo_consumed = len(consumed_rare_outpoints) > 0

    # Calculate remaining UTXO count if wallet context is provided
    remaining_utxo_count: Optional[int] = None
    unique_cluster_consumed = False

    if wallet_utxos is not None:
        total_wallet = len(wallet_utxos)
        # Remaining is wallet UTXOs minus spent inputs plus new change output if created
        net_remaining = total_wallet - len(inputs) + (1 if change_created else 0)
        remaining_utxo_count = max(0, net_remaining)

        # Check if this spend exhausts a unique cluster in the wallet
        spent_outpoints = {inp.outpoint for inp in inputs}
        wallet_cluster_counts: dict[str, int] = {}
        for u in wallet_utxos:
            outpoint = u.get("outpoint") if isinstance(u, dict) else getattr(u, "outpoint", None)
            if outpoint:
                meta = utxo_metadata.get(str(outpoint))
                cluster = None
                if isinstance(meta, UTXOMetadata):
                    cluster = meta.cluster
                elif isinstance(meta, dict):
                    cluster = meta.get("cluster")
                if cluster:
                    wallet_cluster_counts[cluster] = wallet_cluster_counts.get(cluster, 0) + 1

        spent_clusters: dict[str, int] = {}
        for inp in inputs:
            meta = utxo_metadata.get(inp.outpoint)
            cluster = None
            if isinstance(meta, UTXOMetadata):
                cluster = meta.cluster
            elif isinstance(meta, dict):
                cluster = meta.get("cluster")
            if cluster:
                spent_clusters[cluster] = spent_clusters.get(cluster, 0) + 1

        for c, spent_cnt in spent_clusters.items():
            if wallet_cluster_counts.get(c, 0) <= spent_cnt:
                unique_cluster_consumed = True
                break

    warning: Optional[str] = None
    if rare_utxo_consumed:
        warning = "This candidate consumes a tagged rare/important UTXO."
        findings.append(
            Finding(
                type="rare_utxo_consumed",
                severity="warning",
                message=(
                    f"Candidate consumes {len(consumed_rare_outpoints)} tagged rare or important UTXO(s). "
                    "Spending this UTXO now relinquishes a valuable coin for future high-value payments or specific wallet groupings."
                ),
                details={"consumed_rare_outpoints": consumed_rare_outpoints},
            )
        )
    else:
        findings.append(
            Finding(
                type="rare_utxo_preserved",
                severity="info",
                message="No rare or important UTXOs consumed. Special wallet reserves remain intact.",
            )
        )

    if unique_cluster_consumed:
        findings.append(
            Finding(
                type="unique_cluster_consumed",
                severity="info",
                message=(
                    "This transaction consumes all remaining UTXOs belonging to an identified metadata cluster, "
                    "closing out that cluster branch in the wallet."
                ),
            )
        )

    optionality_analysis = FutureOptionalityAnalysis(
        rare_utxo_consumed=rare_utxo_consumed,
        unique_cluster_consumed=unique_cluster_consumed,
        remaining_utxo_count=remaining_utxo_count,
        warning=warning,
    )

    return optionality_analysis, findings
