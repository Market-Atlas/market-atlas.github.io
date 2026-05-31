"""Derive `tags` for a company from name, sector, industry, market cap, country.

Tags are lowercase kebab-case. Keep the rule set small and obvious — better
to under-tag than mislabel. Curated lists beat fuzzy matching for now.
"""
from __future__ import annotations

import re
from typing import Any

# (tag, list of substrings to match in lowercase haystack)
# Order doesn't matter — every matching rule contributes a tag.
# Categories are modelled after https://companiesmarketcap.com/ so the
# /tags/<slug>/ pages and Rankings category nav feel familiar.
KEYWORD_RULES: list[tuple[str, list[str]]] = [
    # ── Technology ─────────────────────────────────────────────────────────
    ("ai",              [" ai ", "artificial intelligence", "machine learning", "generative ai",
                         "nvidia", "openai", "anthropic", "palantir", "c3.ai"]),
    ("software",        ["software", "saas", "application software"]),
    ("cloud",           ["cloud", "data center", "datacenter", "hyperscaler",
                         "servicenow", "snowflake", "datadog", "cloudflare", "mongodb",
                         "atlassian", "workday", "salesforce"]),
    ("semiconductors",  ["semiconductor", "chip", "foundry", "fab", "wafer"]),
    ("consumer-electronics", ["consumer electronic", "smartphone", "personal computer", "pc maker"]),
    ("hardware",        ["computer hardware", "networking hardware", "storage device"]),
    ("cybersecurity",   ["cybersecurity", "cyber security", "infosec", "endpoint security",
                         "crowdstrike", "palo alto networks", "fortinet", "zscaler", "okta",
                         "sentinelone", "cloudflare"]),
    ("ecommerce",       ["e-commerce", "ecommerce", "internet retail", "online retail",
                         "marketplaces"]),
    ("search-engines",  ["search engine", "alphabet", "google", "baidu"]),
    ("social-media",    ["social media", "social network", "messaging app",
                         "meta platforms", "facebook", "snap inc", "pinterest", "reddit",
                         "tencent", "weibo", "line corp", "kakao"]),
    ("streaming",       ["streaming", "subscription video", "netflix", "spotify", "roku",
                         "warner bros", "disney", "iqiyi", "bilibili"]),
    ("gaming",          ["gaming", "video game", "interactive entertainment",
                         "activision", "electronic arts", "take-two", "roblox", "ubisoft",
                         "nintendo", "nexon", "konami", "bandai"]),
    ("fintech",         ["fintech", "digital payments", "neobank", "payment process",
                         "block, inc", "sofi", "affirm", "nubank", "wise plc", "revolut",
                         "robinhood"]),
    ("payments",        ["payment", "credit card network", "card network",
                         "visa", "mastercard", "paypal", "adyen"]),
    ("ev",              ["electric vehicle", "ev maker", "lithium battery", "battery cell",
                         "tesla", "rivian", "lucid", "byd company", "nio inc", "xpeng",
                         "li auto", "polestar"]),
    ("robotics",        ["robotic", "automation hardware", "industrial automation",
                         "fanuc", "abb ltd", "intuitive surgical"]),
    ("space",           ["spaceflight", "space technology", "satellite operator",
                         "aerospace launch", "spacex", "rocket lab", "iridium"]),
    ("media",           ["media", "broadcast", "entertainment", "publishing", "advertising"]),

    # ── Financials ─────────────────────────────────────────────────────────
    ("banks",           ["bank", "bancorp", "savings & loan", "diversified bank"]),
    ("insurance",       ["insurance", "insurer", "reinsurer"]),
    ("asset-management", ["asset management", "asset manager", "investment management"]),
    ("exchanges",       ["financial exchange", "stock exchange", "capital markets"]),
    ("crypto",          ["crypto", "bitcoin", "blockchain",
                         "coinbase", "marathon digital", "riot platforms", "microstrategy",
                         "galaxy digital"]),
    ("real-estate",     ["reit", "real estate"]),

    # ── Healthcare ─────────────────────────────────────────────────────────
    ("pharma",          ["pharma", "drug manufactur"]),
    ("biotech",         ["biotech", "therapeutic"]),
    ("medical-devices", ["medical device", "diagnostic"]),
    ("healthcare",      ["health", "hospital", "medical", "managed care"]),

    # ── Energy / Industrials / Materials ──────────────────────────────────
    ("oil-gas",         ["oil", "gas", "petroleum", "refining", "upstream", "downstream"]),
    ("renewables",      ["solar", "wind", "renewable"]),
    ("nuclear",         ["nuclear", "uranium"]),
    ("utilities",       ["utilit", "electric utility", "water utility", "power"]),
    ("coal",            ["coal"]),
    ("mining",          ["mining", "gold mining", "copper mining"]),
    ("steel",           ["steel", "iron and steel"]),
    ("metals",          ["aluminum", "copper", "nickel", "lithium producer", "rare earth"]),
    ("chemicals",       ["chemical"]),
    ("cement",          ["cement", "aggregates"]),
    ("construction",    ["construction", "engineering & construction", "building product"]),
    ("automakers",      ["auto manufactur", "automobile", "auto maker", "car manufactur"]),
    ("auto-parts",      ["auto parts", "auto components", "tires & rubber"]),
    ("aerospace-defense", ["aerospace", "defense", "defence", "weapon"]),
    ("airlines",        ["airline", "air carrier"]),
    ("ports",           [" port ", "marine terminal", "port operator", "container terminal",
                         "international container terminal", "adani ports", "dp world",
                         "hutchison port"]),
    ("shipping",        ["marine shipping", "maritime", "container shipping", "tanker",
                         "moller-maersk", "hapag-lloyd", "evergreen marine"]),
    ("logistics",       ["logistic", "freight", "trucking", "rail transport", "railway"]),
    ("agriculture",     ["agricultur", "farm", "fertili"]),

    # ── Consumer ───────────────────────────────────────────────────────────
    ("retail",          ["retail", "department store", "discount", "specialty retail", "apparel retail"]),
    ("luxury",          ["luxury", "lvmh", "hermes", "kering", "ferrari", "richemont",
                         "moncler", "burberry", "prada"]),
    ("apparel",         ["apparel", "footwear", "clothing"]),
    ("consumer-goods",  ["consumer", "household", "personal product"]),
    ("food-beverage",   ["food", "beverage"]),
    ("restaurants",     ["restaurant"]),
    ("alcohol",         ["alcohol", "brewer", "distiller", "winery", "spirits"]),
    ("tobacco",         ["tobacco"]),
    ("travel",          ["travel", "lodging", "hotel", "resort", "cruise"]),

    # ── Telecom ────────────────────────────────────────────────────────────
    ("telecom",         ["telecom", "wireless", "telecommunication"]),
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
