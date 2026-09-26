"""
Cluster and Common Input Ownership Heuristic analysis.

Evaluates:
1. Common-input ownership heuristic (when multiple inputs are co-spent).
2. Wallet-side metadata cluster merging (when inputs belong to multiple distinct clusters).

Note on heuristics:
- The common-input ownership heuristic is an observer inference, not cryptographic proof.
- Clusters represent wallet-side metadata / assumed labels, not objective on-chain identities.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from .models import CandidateInput, Finding, UTXOMetadata


def analyze_clusters_and_inputs(
    inputs: list[CandidateInput],
    utxo_metadata: Optional[dict[str, UTXOMetadata | dict[str, Any]]] = None,
) -> tuple[list[str], int, bool, bool, list[Finding]]:
    """
    Analyze input count heuristic and cluster relationships across selected inputs.

    Returns:
        (clusters_used, clusters_count, clusters_merged, multiple_inputs, findings)
    """
    utxo_metadata = utxo_metadata or {}
    findings: list[Finding] = []

    input_count = len(inputs)
    multiple_inputs = input_count > 1

    # 1. Common Input Ownership Heuristic
    if multiple_inputs:
        findings.append(
            Finding(
                type="common_input_heuristic",
                severity="info",
                message=(
                    f"Common-input ownership heuristic may link these {input_count} inputs. "
                    "Outside observers typically assume co-spent inputs are controlled by the same entity "
                    "(heuristic inference, not cryptographic proof)."
                ),
                details={"input_count": input_count},
            )
        )
    else:
        findings.append(
            Finding(
                type="common_input_heuristic",
                severity="info",
                message=(
                    "Single input transaction avoids the common-input ownership heuristic, "
                    "preventing input co-spend clustering."
                ),
                details={"input_count": input_count},
            )
        )

    # 2. Cluster Metadata Analysis
    clusters_seen: list[str] = []
    missing_cluster_count = 0

    for inp in inputs:
        meta = utxo_metadata.get(inp.outpoint)
        cluster_name: Optional[str] = None

        if meta is not None:
            if isinstance(meta, UTXOMetadata):
                cluster_name = meta.cluster
            elif isinstance(meta, dict):
                cluster_name = meta.get("cluster")

        if cluster_name:
            if cluster_name not in clusters_seen:
                clusters_seen.append(cluster_name)
        else:
            missing_cluster_count += 1

    clusters_count = len(clusters_seen)
    clusters_merged = clusters_count > 1

    if clusters_merged:
        formatted_clusters = ", ".join(f"'{c}'" for c in clusters_seen)
        findings.append(
            Finding(
                type="cluster_merge",
                severity="warning",
                message=(
                    f"Transaction merges inputs from {clusters_count} distinct wallet-side metadata clusters "
                    f"({formatted_clusters}). Outside observers may link these previously separate clusters."
                ),
                details={
                    "clusters_used": clusters_seen,
                    "clusters_count": clusters_count,
                },
            )
        )
    elif clusters_count == 1:
        findings.append(
            Finding(
                type="cluster_isolated",
                severity="info",
                message=(
                    f"All clustered inputs belong to the single wallet-side metadata cluster '{clusters_seen[0]}'. "
                    "No cluster merge detected."
                ),
                details={"cluster": clusters_seen[0]},
            )
        )
    elif input_count > 0:
        findings.append(
            Finding(
                type="cluster_metadata_missing",
                severity="info",
                message=(
                    "No wallet-side cluster metadata was found for the selected inputs; "
                    "cluster separation cannot be evaluated from metadata."
                ),
                details={"unlabeled_inputs": missing_cluster_count},
            )
        )

    return clusters_seen, clusters_count, clusters_merged, multiple_inputs, findings
