"""
Pre-Signing Bitcoin Privacy Planner - Privacy & Analysis Engine.

Exposes candidate analysis, cluster evaluation, change detection,
optionality checks, and candidate comparison functions.
"""

from .analyzer import analyze_candidate, compare_candidates
from .change import analyze_address_reuse, analyze_change
from .cluster import analyze_clusters_and_inputs
from .models import (
    CandidateAnalysisResult,
    CandidateInput,
    CandidateOutput,
    CandidateTradeoff,
    CandidateTransaction,
    ComparisonResult,
    Finding,
    FutureOptionalityAnalysis,
    PrivacyAnalysis,
    TransactionAnalysis,
    UTXOMetadata,
)
from .optionality import analyze_optionality

__all__ = [
    "analyze_candidate",
    "compare_candidates",
    "analyze_clusters_and_inputs",
    "analyze_change",
    "analyze_address_reuse",
    "analyze_optionality",
    "CandidateInput",
    "CandidateOutput",
    "CandidateTransaction",
    "UTXOMetadata",
    "Finding",
    "TransactionAnalysis",
    "PrivacyAnalysis",
    "FutureOptionalityAnalysis",
    "CandidateAnalysisResult",
    "CandidateTradeoff",
    "ComparisonResult",
]
