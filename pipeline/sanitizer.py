"""
Strict Artist Name Sanitization and Validation Module for Music Atlas.
Filters out dates (e.g. 'May 10, 2026', '2026'), curator handles,
view counts, channel metadata, and system bot strings while preserving
authentic global artists across all Unicode character sets (Latin, CJK, Cyrillic, Arabic, etc.).
"""

import re
import unicodedata
from typing import List, Optional

# Matches date strings like 'May 10, 2026', '17 May 2021', '2026-05-10', '2026'
DATE_REGEX = re.compile(
    r'^(?:'
    r'(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{2,4}'
    r'|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{2,4}'
    r'|\d{4}-\d{2}-\d{2}'
    r'|(?:19|20)\d{2}'
    r')$',
    re.IGNORECASE
)

# Relative dates and upload timestamps
RELATIVE_DATE_REGEX = re.compile(
    r'(?i)\b(?:updated\s+today|updated\s+yesterday|\d+\s+(?:days?|months?|years?|hours?|weeks?)\s+ago)\b'
)

# Video / playlist metadata terms
METADATA_REGEX = re.compile(
    r'(?i)\b(?:views|subscribers|updated|tracks|videos|full album|official video|official audio|lyrics video|hour mix|compilation|top songs|best songs|hit songs|playlist)\b'
)

# Curator handle patterns (e.g. maumau1968, DerrickB502222, HighFlyer186, Vovan105, ryanche33)
HANDLE_REGEX = re.compile(
    r'^(?:[A-Za-z]{3,}\d{3,}|[a-z]{3,}\d{2,})$'
)

BLACKLIST = {
    "various artists",
    "various artists - topic",
    "unknown",
    "unknown artist",
    "curator",
    "community curator",
    "spotify",
    "youtube",
    "youtube music",
    "music",
    "artist",
    "soundtrack",
    "va",
    "latinhype",
    "rockhype",
    "futurehype",
    "r&bhype",
    "cloudy hits",
    "classic hits studio",
    "new hits songs",
    "backtothehits",
    "bits & hits",
    "moonfloated",
    "1hit1ders",
    "runcosweeklymusic",
    "easymusic36",
    "homegrown television",
    "vovan105",
    "maumau1968"
}

def sanitize_artist_name(raw_name: Optional[str]) -> Optional[str]:
    """
    Sanitizes and validates an artist name.
    Returns cleaned canonical string if valid, or None if invalid/garbage.
    """
    if not raw_name or not isinstance(raw_name, str):
        return None

    # Normalize unicode (NFKC)
    name = unicodedata.normalize("NFKC", raw_name).strip()

    # Length constraints
    if len(name) < 2 or len(name) > 60:
        return None

    # Lowercase checks
    lowered = name.lower()
    if lowered in BLACKLIST:
        return None

    if lowered.endswith(" reviews") or lowered.endswith(" channel") or lowered.endswith(" records"):
        return None

    # Must contain at least one alphabetic character (Unicode safe: Latin, CJK, Cyrillic, etc.)
    if not any(c.isalpha() for c in name):
        return None

    # Reject dates and relative timestamps
    if DATE_REGEX.match(name):
        return None

    if RELATIVE_DATE_REGEX.search(name):
        return None

    # Reject modern year tokens like 2024, 2026 (e.g. PureHouseMusic 2024, Top Songs 2026)
    if re.search(r'\b20[12]\d\b', name):
        return None

    # Reject metadata strings
    if METADATA_REGEX.search(name):
        return None

    # Reject user handles like maumau1968, Vovan105, 1hit1ders
    if HANDLE_REGEX.match(name):
        return None

    return name

LEGITIMATE_COMMA_ARTISTS = {
    "tyler, the creator",
    "earth, wind & fire",
    "crosby, stills & nash",
    "crosby, stills, nash & young",
    "emerson, lake & palmer",
    "blood, sweat & tears",
    "bell, biv devoe",
    "isley, jasper, isley",
    "dream, ivory",
    "oh, sleeper",
    "grover washington, jr.",
    "hank williams, jr.",
    "10,000 maniacs",
    "peter, paul and mary",
    "tony, toni, toné",
    "tony, toni, tone"
}

def split_artist_names(raw_name: Optional[str]) -> List[str]:
    """
    Splits composite multi-artist strings (e.g. 'Arcangelo Corelli, The English Concert, Trevor Pinnock',
    'Jessie J, Ariana Grande, Nicki Minaj') into individual authentic artist names,
    while preserving genuine bands with commas like 'Tyler, The Creator' and 'Earth, Wind & Fire'.
    """
    if not raw_name or not isinstance(raw_name, str):
        return []

    clean = raw_name.strip()
    if not clean:
        return []

    if clean.lower() in LEGITIMATE_COMMA_ARTISTS:
        sanitized = sanitize_artist_name(clean)
        return [sanitized] if sanitized else []

    # Protect legitimate comma artists with placeholders in case they are part of a multi-artist collaboration
    placeholders = {}
    modified = clean
    for idx, band in enumerate(sorted(LEGITIMATE_COMMA_ARTISTS, key=len, reverse=True)):
        pattern = re.compile(re.escape(band), re.IGNORECASE)
        matches = pattern.findall(modified)
        for m in matches:
            ph = f"__COMMA_ARTIST_{idx}__"
            placeholders[ph] = m
            modified = pattern.sub(ph, modified, count=1)

    # Split on comma followed by whitespace (prevents splitting 10,000 Maniacs if not in placeholder set)
    if re.search(r',\s+', modified):
        parts = [p.strip() for p in re.split(r',\s+', modified) if p.strip()]
        results = []
        seen = set()
        gen_suffixes = {"jr", "sr", "ii", "iii", "iv", "v"}
        for p in parts:
            sub = p
            if sub.startswith("& "):
                sub = sub[2:].strip()
            elif sub.lower().startswith("and "):
                sub = sub[4:].strip()

            # Restore placeholders
            for ph, original in placeholders.items():
                if ph in sub:
                    sub = sub.replace(ph, original)

            # Merge generational suffixes (e.g. Jr., Sr., III) back to preceding artist
            if sub.lower().rstrip(".") in gen_suffixes and results:
                prev = results[-1]
                merged = f"{prev}, {p.strip()}"
                sanitized_merged = sanitize_artist_name(merged)
                if sanitized_merged:
                    results[-1] = sanitized_merged
                    seen.add(sanitized_merged.lower())
                continue

            sanitized = sanitize_artist_name(sub)
            if sanitized and sanitized.lower() not in seen:
                seen.add(sanitized.lower())
                results.append(sanitized)
        return results

    # Restore placeholders if no split happened
    for ph, original in placeholders.items():
        if ph in modified:
            modified = modified.replace(ph, original)

    sanitized = sanitize_artist_name(modified)
    return [sanitized] if sanitized else []

def is_valid_artist(raw_name: Optional[str]) -> bool:
    """Returns True if the name is a valid artist name."""
    return sanitize_artist_name(raw_name) is not None
