"""
Artist Name Sanitization and Normalization Module for Music Atlas.
Applies clean Unicode NFKC normalization and basic system entity filters.
Zero artificial overrides or hardcoded artist lists.
"""

import re
import unicodedata
from typing import List, Optional

# Generic non-artist system placeholder names
GENERIC_SYSTEM_NAMES = {
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
    "va"
}

DATE_PATTERN = re.compile(
    r'^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}$',
    re.IGNORECASE
)

def sanitize_artist_name(raw_name: Optional[str]) -> Optional[str]:
    """
    Sanitizes and normalizes an artist name using Unicode NFKC.
    Returns cleaned canonical string, or None if invalid/empty/system string.
    """
    if not raw_name or not isinstance(raw_name, str):
        return None

    # Normalize unicode (NFKC)
    name = unicodedata.normalize("NFKC", raw_name).strip()

    # Length constraints
    if len(name) < 1 or len(name) > 100:
        return None

    # Strip trailing " - Topic" or " Topic" suffix
    if name.lower().endswith(" - topic"):
        name = name[:-8].strip()
    elif name.lower().endswith(" topic"):
        name = name[:-6].strip()

    # Must contain at least one alphabetic character
    if not any(c.isalpha() for c in name):
        return None

    lowered = name.lower()
    if lowered in GENERIC_SYSTEM_NAMES:
        return None

    if DATE_PATTERN.match(name):
        return None

    return name

def split_artist_names(raw_name: Optional[str]) -> List[str]:
    """
    Splits composite multi-artist strings on collaboration markers (feat. / ft. / ,).
    """
    if not raw_name or not isinstance(raw_name, str):
        return []

    clean = raw_name.strip()
    if not clean:
        return []

    parts = re.split(r'(?i)\s+(?:ft\.?|feat\.?)\s+', clean)
    artists: List[str] = []
    seen = set()

    for part in parts:
        part = part.strip()
        if not part:
            continue
        # Split on comma unless part is an epithet/suffix like 'Tyler, The Creator' or 'Jr.'
        if ',' in part and not re.match(r'^[^,]+,\s*(?:the\s+\w+|jr\.?|sr\.?|ii|iii|iv)$', part, re.I):
            subparts = [p.strip() for p in part.split(',') if p.strip()]
            for sp in subparts:
                sanitized = sanitize_artist_name(sp)
                if sanitized and sanitized.lower() not in seen:
                    seen.add(sanitized.lower())
                    artists.append(sanitized)
        else:
            sanitized = sanitize_artist_name(part)
            if sanitized and sanitized.lower() not in seen:
                seen.add(sanitized.lower())
                artists.append(sanitized)

    return artists

def is_valid_artist(raw_name: Optional[str]) -> bool:
    """Returns True if raw_name is a valid artist name."""
    return sanitize_artist_name(raw_name) is not None
