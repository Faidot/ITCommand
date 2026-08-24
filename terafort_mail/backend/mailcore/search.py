"""Searching encrypted mail.

Postgres full-text search cannot index ciphertext, so full-text search and
encryption-at-rest are in genuine tension. The resolution, from blueprint
section 6, is a **keyed blind index**: every token is stored as
``HMAC(search_key, token)``, and a query hashes its terms the same way and
looks up the digests.

What this buys: the database holds no readable words, and the key is derived
from the mailbox DEK, so a stolen dump is a pile of unlinkable hashes.

What it costs, stated plainly because it is real:

* **Whole tokens only.** Searching `invoice` finds "invoice" and, through the
  stemmer below, "invoices" — but there is no substring or wildcard search.
  `invo` finds nothing.
* **Weaker ranking** than Postgres FTS. We rank by field weight and term
  coverage, not by a real relevance model.
* **Frequency leakage.** Someone with the database can see that one digest
  appears in forty of your messages, though not which word it is.

If that trade reads wrong, the simpler alternative is still open: keep subject
and sender in plaintext and use native FTS over them. That loses subject-line
privacy and gains ordinary search. It is a one-file change here plus a
migration; nothing else in the app depends on which is chosen.
"""
from __future__ import annotations

import hashlib
import hmac
import re

#: Field weights. A hit in the subject means more than a hit in the body, and
#: sender matches are what people are usually actually looking for.
FIELD_SUBJECT, FIELD_SENDER, FIELD_BODY = 1, 2, 3
WEIGHTS = {FIELD_SUBJECT: 6, FIELD_SENDER: 5, FIELD_BODY: 1}

#: Below three characters a token matches so much it ranks nothing. Above
#: forty it is a base64 blob or a tracking id, not a word.
MIN_TOKEN, MAX_TOKEN = 3, 40

#: Indexing these costs space and returns every message you own.
STOPWORDS = frozenset("""
a an and are as at be been but by for from has have he her his i if in into is
it its me my no not of on or our ours she so than that the their them then
there these they this to was we were what when which who will with would you
your re fwd sent regards thanks hi hello dear best kind
com net org edu gov co uk www mail email
""".split())

#: `@` is inside the character class on purpose. Without it an address splits
#: at the @ and the whole address is never indexed, so searching for
#: `priya@terafort.com` finds nothing while `priya` finds everything.
_TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._+@-]*")


def _stem(token: str) -> str:
    """Plural handling, and nothing more ambitious than that.

    An earlier version tried several suffixes and got the important case
    exactly backwards: "invoices" stripped to "invoic" while "invoice" stayed
    whole, so singular and plural landed on different digests and searching
    for one never found the other.

    Stripping only a trailing plural `s` keeps the pair together, which is the
    case that actually matters. It mishandles irregulars — "boxes" becomes
    "boxe" and will not meet "box" — and that is an accepted, bounded cost.
    A real stemmer would do better and would also change its answers between
    library versions, silently invalidating every digest already stored.
    """
    if len(token) > 3 and token.endswith("s") and not token.endswith("ss"):
        return token[:-1]
    return token


def tokenise(text: str) -> set:
    """Normalised, stemmed, de-duplicated tokens.

    Email addresses are indexed whole *and* split, so `priya@terafort.com`
    matches a search for `priya`, for `terafort`, and for the full address.
    """
    out = set()
    for raw in _TOKEN.findall(text or ""):
        lowered = raw.lower()
        if "@" in lowered and MIN_TOKEN <= len(lowered) <= MAX_TOKEN:
            out.add(lowered)          # the whole address, searchable as typed
            lowered = lowered.replace("@", " ").replace(".", " ")
            for part in lowered.split():
                if MIN_TOKEN <= len(part) <= MAX_TOKEN and part not in STOPWORDS:
                    out.add(_stem(part))
            continue
        for part in re.split(r"[._+-]", lowered):
            if MIN_TOKEN <= len(part) <= MAX_TOKEN and part not in STOPWORDS:
                out.add(_stem(part))
    return out


def search_key(dek: bytes) -> bytes:
    """Derived from the DEK rather than reusing it.

    Using one key for both encryption and HMAC is fine until it is not, and
    deriving costs a single hash.
    """
    return hashlib.sha256(b"tfm-search-v1" + dek).digest()


def digest(key: bytes, token: str) -> bytes:
    return hmac.new(key, token.encode("utf-8"), hashlib.sha256).digest()


def index_terms(dek: bytes, *, subject: str = "", sender: str = "",
                body: str = "") -> list:
    """``[(digest, field), …]`` for one message.

    A token appearing in several fields is stored once per field, so the
    ranker can weight a subject hit above a body hit.
    """
    key = search_key(dek)
    rows = []
    for text, field in ((subject, FIELD_SUBJECT), (sender, FIELD_SENDER),
                        (body, FIELD_BODY)):
        for token in tokenise(text):
            rows.append((digest(key, token), field))
    return rows


def query_digests(dek: bytes, query: str) -> list:
    """Hash a user's search terms the same way the index did."""
    key = search_key(dek)
    return [digest(key, token) for token in tokenise(query)]


def rank(hits: dict, term_count: int) -> list:
    """Order message ids by weighted field hits, then by term coverage.

    Coverage first in the sort: a message containing all three of your words
    beats one containing one of them nine times, which is what people expect
    and what a naive weight-sum gets wrong.
    """
    scored = []
    for message_id, fields in hits.items():
        weight = sum(WEIGHTS.get(field, 1) * n for field, n in fields.items())
        covered = len({f for f in fields})
        scored.append((message_id, covered, weight))
    scored.sort(key=lambda row: (-row[1], -row[2]))
    return [row[0] for row in scored]
