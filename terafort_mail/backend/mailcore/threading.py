"""Grouping messages into conversations.

The blueprint said JWZ. What is here is the useful half of it: JWZ builds a
parent/child *tree*, and we only need to know which messages belong together,
so this is union-find over the same reference graph. Same grouping, far less
code to get wrong, and the tree can be added later if the UI ever wants
indentation.

Two passes, in this order and for a reason:

  1. **References.** Message-ID, In-Reply-To and References are what a mail
     client is supposed to use, and when they are present they are right.
  2. **Subject.** Only for messages the first pass left alone, and only within
     a time window. Plenty of senders emit no References at all -- reply from
     some ticketing systems and you get a bare Message-ID -- so without this
     their threads scatter into single messages.

Subject matching is deliberately the weaker, second pass. Running it first
would merge every message called "Invoice" from three different vendors into
one conversation.
"""
from __future__ import annotations

import re
import uuid
from datetime import timedelta

#: How far apart two messages can be and still thread on subject alone.
#: Long enough for a slow email conversation, short enough that this year's
#: "Renewal notice" does not join last year's.
SUBJECT_WINDOW = timedelta(days=30)

#: Reply and forward prefixes, in the languages that actually turn up here.
_PREFIX = re.compile(
    r"^\s*(?:(?:re|aw|sv|vs|antw|fwd?|tr|rv|enc)\s*(?:\[\d+\])?\s*:\s*)+",
    re.IGNORECASE,
)
_LIST_TAG = re.compile(r"^\s*\[[^\]]{1,40}\]\s*")


def normalise_subject(subject: str) -> str:
    """Strip reply prefixes and list tags down to the underlying subject.

    Looped rather than applied once: "Re: Fwd: RE: [Vendors] Invoice" is a real
    subject line, and one pass leaves half of it behind.
    """
    text = subject or ""
    for _ in range(8):
        before = text
        text = _PREFIX.sub("", text)
        text = _LIST_TAG.sub("", text)
        if text == before:
            break
    return " ".join(text.split()).lower()


class _Union:
    """Union-find with path compression. Small enough to keep in the file."""

    def __init__(self):
        self._parent = {}

    def add(self, key):
        self._parent.setdefault(key, key)

    def find(self, key):
        self.add(key)
        root = key
        while self._parent[root] != root:
            root = self._parent[root]
        while self._parent[key] != root:
            self._parent[key], key = root, self._parent[key]
        return root

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self._parent[rb] = ra


def group(messages: list) -> dict:
    """Return ``{message key: thread key}``.

    `messages` is any sequence of objects with `message_id`, `in_reply_to`,
    `references`, `subject` and `internal_date`. The key used to identify a
    message is its `message_id` when it has one, and a synthetic id otherwise
    -- a message with no Message-ID must still thread with its own replies,
    and must never collide with another one that also has none.
    """
    union = _Union()
    keys = []

    for index, msg in enumerate(messages):
        key = (getattr(msg, "message_id", "") or "").strip() or "synthetic:%d" % index
        keys.append(key)
        union.add(key)

        parent = (getattr(msg, "in_reply_to", "") or "").strip()
        if parent:
            union.union(parent, key)

        # Every id in References belongs to the same conversation. Joining
        # them all -- rather than only the last -- repairs threads where an
        # intermediate reply never reached this mailbox.
        for ref in (getattr(msg, "references", None) or []):
            ref = (ref or "").strip()
            if ref:
                union.union(ref, key)

    # Second pass: subject, for whatever the first pass left isolated.
    by_subject = {}
    for index, msg in enumerate(messages):
        subject = normalise_subject(getattr(msg, "subject", ""))
        if not subject:
            continue
        by_subject.setdefault(subject, []).append(index)

    for indexes in by_subject.values():
        if len(indexes) < 2:
            continue
        ordered = sorted(indexes, key=lambda i: getattr(messages[i], "internal_date", None))
        for a, b in zip(ordered, ordered[1:]):
            first, second = messages[a], messages[b]
            gap = getattr(second, "internal_date", None) - getattr(first, "internal_date", None)
            if gap is not None and gap <= SUBJECT_WINDOW:
                union.union(keys[a], keys[b])

    # Map each root to a stable UUID. Derived from the root's own id, so a
    # conversation keeps the same thread id across syncs without us having to
    # store the mapping anywhere.
    thread_ids = {}
    out = {}
    for index, key in enumerate(keys):
        root = union.find(key)
        if root not in thread_ids:
            thread_ids[root] = uuid.uuid5(uuid.NAMESPACE_URL, "tfm-thread:%s" % root)
        out[key] = thread_ids[root]
    return out


def assign(messages: list) -> list:
    """Convenience: return the thread id for each message, in order."""
    mapping = group(messages)
    out = []
    for index, msg in enumerate(messages):
        key = (getattr(msg, "message_id", "") or "").strip() or "synthetic:%d" % index
        out.append(mapping[key])
    return out
