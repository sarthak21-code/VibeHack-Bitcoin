# VibeHack — Pre-Signing Bitcoin Privacy Planner

> **Don't just create a Bitcoin transaction. Compare it first.**

VibeHack is a pre-signing Bitcoin transaction planner that generates multiple valid transaction candidates for the same payment, analyzes their privacy-relevant trade-offs, and lets the user choose which PSBT to export and sign externally.

The key idea is simple:

**The transaction is not the only decision. Coin selection is a privacy decision too.**

---

## What VibeHack Does

A typical wallet selects UTXOs and builds a transaction.

VibeHack exposes that decision before signing:

```text
Wallet UTXOs
      ↓
Candidate Generator
      ↓
Candidate A / Candidate B / ...
      ↓
BDK transaction construction
      ↓
PSBT Analyzer
      ↓
Privacy Engine
      ↓
Candidate comparison
      ↓
User chooses a candidate
      ↓
Export PSBT
      ↓
Sign externally