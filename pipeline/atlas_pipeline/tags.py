"""Derive `tags` for a company from name, sector, industry, market cap, country.

Tags are lowercase kebab-case. Keep the rule set small and obvious — better
to under-tag than mislabel. Curated lists beat fuzzy matching for now.
"""
from __future__ import annotations

import re
from typing import Any

# (tag, list of substrings to match in lowercase haystack)
# Order doesn't matter — every matching rule contributes a tag.
KEYWORD_RULES: list[tuple[str, list[str]]] = [
    ("software",       ["software", "saas"]),
    ("semiconductors", ["semiconductor", "chip", "foundry"]),
    ("cloud",          ["cloud", "data center", "datacenter"]),
    ("ai",             [" ai ", "artificial intelligence", "machine learning"]),
    ("ecommerce",      ["e-commerce", "ecommerce", "internet retail", "online retail"]),
    ("social-media",   ["social media", "social network"]),
    ("payments",       ["payment", "fintech"]),
    ("banks",          ["bank"]),
    ("insurance",      ["insurance", "insurer", "reinsurer"]),
    ("asset-management", ["asset management", "asset manager", "investment management"]),
    ("real-estate",    ["reit", "real estate"]),
    ("pharma",         ["pharma", "drug", "biotech", "therapeutic"]),
    ("medical-devices", ["medical device", "diagnostic"]),
    ("healthcare",     ["health", "hospital", "medical"]),
    ("oil-gas",        ["oil", "gas", "petroleum", "refining"]),
    ("renewables",     ["solar", "wind", "renewable"]),
    ("utilities",      ["utilit", "electric", "power"]),
    ("ev",             ["electric vehicle", "ev maker"]),
    ("automakers",     ["auto manufactur", "automobile"]),
    ("aerospace-defense", ["aerospace", "defense", "defence"]),
    ("retail",         ["retail", "department store", "discount"]),
    ("consumer-goods", ["consumer", "household", "personal product"]),
    ("food-beverage",  ["food", "beverage", "restaurant"]),
    ("luxury",         ["luxury"]),
    ("media",          ["media", "broadcast", "entertainment", "publishing"]),
    ("gaming",         ["gaming", "video game"]),
    ("telecom",        ["telecom", "wireless"]),
    ("logistics",      ["logistic", "freight", "shipping", "airline"]),
    ("mining",         ["mining", "metal", "steel"]),
    ("chemicals",      ["chemical"]),
    ("agriculture",    ["agricultur", "farm"]),
]

# Sector → simplified tag (lowercased, hyphenated).
SECTOR_TAGS = {
    "Technology":               "tech",
    "Communication Services":   "comms",
    "Financial Services":       "financials",
    "Healthcare":               "healthcare",
    "Consumer Cyclical":        "consumer-cyclical",
    "Consumer Defensive":       "consumer-defensive",
    "Industrials":              "industrials",
    "Energy":                   "energy",
    "Basic Materials":          "materials",
    "Real Estate":              "real-estate",
    "Utilities":                "utilities",
}


def _cap_bucket(market_cap_usd: float | None) -> str | None:
    if market_cap_usd is None:
        return None
    if market_cap_usd >= 200e9: return "mega-cap"
    if market_cap_usd >=  10e9: return "large-cap"
    if market_cap_usd >=   2e9: return "mid-cap"
    if market_cap_usd >= 300e6: return "small-cap"
    return "micro-cap"


def derive_tags(doc: dict[str, Any], market_cap_usd: float | None = None) -> list[str]:
    tags: set[str] = set()

    sector = doc.get("sector") or ""
    industry = doc.get("industry") or ""
    name = doc.get("name") or ""

    if t := SECTOR_TAGS.get(sector):
        tags.add(t)

    haystack = f" {name} {industry} ".lower()
    for tag, keywords in KEYWORD_RULES:
        if any(k in haystack for k in keywords):
            tags.add(tag)

    if country := doc.get("country"):
        tags.add(f"country-{country.lower()}")

    if bucket := _cap_bucket(market_cap_usd):
        tags.add(bucket)

    return sorted(tags)
