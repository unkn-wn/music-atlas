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
    r'^(?:[A-Za-z]{2,}\d{2,}|[a-z]{3,}\d+)$'
)

# Generic system and non-artist placeholder terms
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

GEN_SUFFIXES = {'jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v', 'esq', 'esq.'}

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
    if lowered in GENERIC_SYSTEM_NAMES:
        return None

    # Non-artist YouTube channel suffixes
    if lowered.endswith((" reviews", " channel", " topic", " official")):
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

def split_artist_names(raw_name: Optional[str]) -> List[str]:
    """
    Splits composite multi-artist strings (e.g. 'Jessie J, Ariana Grande, Nicki Minaj',
    'Calvin Harris ft. Rihanna') into individual authentic artist names,
    using structural and linguistic patterns (zero hardcoded artist names).
    """
    if not raw_name or not isinstance(raw_name, str):
        return []

    clean = raw_name.strip()
    if not clean:
        return []

    # Protect comma in numbers like '10,000 Maniacs'
    num_protected = re.sub(r'(\d),(\d)', r'\1__NUMCOMMA__\2', clean)

    # Split on collaboration markers (feat. / ft.)
    feat_parts = re.split(r'(?i)\s+(?:ft\.?|feat\.?)\s+', num_protected)

    all_artists: List[str] = []
    seen = set()

    for part in feat_parts:
        part = part.strip()
        if not part:
            continue

        if ',' in part:
            sub_segments = [s.strip() for s in part.split(',') if s.strip()]

            # 1. Structural epithet check (e.g. 'Tyler, The Creator', 'Alexander, The Great')
            if len(sub_segments) == 2 and re.match(r'^(?:the)\s+\w+$', sub_segments[1], re.IGNORECASE):
                sanitized = sanitize_artist_name(part.replace('__NUMCOMMA__', ','))
                if sanitized and sanitized.lower() not in seen:
                    seen.add(sanitized.lower())
                    all_artists.append(sanitized)
                continue

            # 2. Structural suffix check (e.g. 'Grover Washington, Jr.')
            if len(sub_segments) == 2 and sub_segments[1].lower().rstrip('.') in GEN_SUFFIXES:
                sanitized = sanitize_artist_name(part.replace('__NUMCOMMA__', ','))
                if sanitized and sanitized.lower() not in seen:
                    seen.add(sanitized.lower())
                    all_artists.append(sanitized)
                continue

            # 3. Structural band coordination check (e.g. 'Earth, Wind & Fire', 'Crosby, Stills, Nash & Young')
            # Coordinated series where final segment has '&' or 'and', and preceding segments are single words/nouns
            if any(conj in sub_segments[-1].lower() for conj in ['&', 'and']):
                leading_are_single = all(len(s.split()) == 1 for s in sub_segments[:-1])
                last_words = sub_segments[-1].replace('&', ' ').replace('and', ' ').split()
                if leading_are_single and len(last_words) <= 2:
                    sanitized = sanitize_artist_name(part.replace('__NUMCOMMA__', ','))
                    if sanitized and sanitized.lower() not in seen:
                        seen.add(sanitized.lower())
                        all_artists.append(sanitized)
                    continue

            # 4. Otherwise, treat as multi-artist list
            for s in sub_segments:
                # Merge trailing generational suffix back to previous artist
                if s.lower().rstrip('.') in GEN_SUFFIXES and all_artists:
                    merged = f"{all_artists[-1]}, {s}"
                    sanitized_merged = sanitize_artist_name(merged)
                    if sanitized_merged:
                        all_artists[-1] = sanitized_merged
                        seen.add(sanitized_merged.lower())
                    continue

                sub = s
                if sub.startswith("& "):
                    sub = sub[2:].strip()
                elif sub.lower().startswith("and "):
                    sub = sub[4:].strip()

                sanitized = sanitize_artist_name(sub.replace('__NUMCOMMA__', ','))
                if sanitized and sanitized.lower() not in seen:
                    seen.add(sanitized.lower())
                    all_artists.append(sanitized)
        else:
            sanitized = sanitize_artist_name(part.replace('__NUMCOMMA__', ','))
            if sanitized and sanitized.lower() not in seen:
                seen.add(sanitized.lower())
                all_artists.append(sanitized)

    return all_artists

def is_valid_artist(raw_name: Optional[str]) -> bool:
    """Returns True if the name is a valid artist name."""
    return sanitize_artist_name(raw_name) is not None
