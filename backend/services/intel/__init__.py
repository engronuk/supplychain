"""Proactive Intelligence Layer — additive enhancement.

This layer never mutates the existing transactional collections. It reads
operational state, runs lightweight forecasting / anomaly / behaviour /
logistics analyses, narrates the results via LLM, and writes findings to
its own namespace of collections (insights, forecasts, alerts,
recommendations, executive_summaries, external_signals).
"""
