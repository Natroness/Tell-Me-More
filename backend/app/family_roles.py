"""The selected person relative to an anchor; canonical edges never change direction."""

from typing import Literal
from uuid import UUID

Kind = Literal[
    "parent",
    "father",
    "mother",
    "child",
    "son",
    "daughter",
    "grandparent",
    "grandfather",
    "grandmother",
    "grandchild",
    "grandson",
    "granddaughter",
    "spouse",
    "sibling",
    "brother",
    "sister",
    "friend",
]

# Canonical edge kind, selected person's role, anchor's role, selected is descendant.
ROLES = {
    "parent": ("parent", "parent", "child", False),
    "father": ("parent", "dad", "child", False),
    "mother": ("parent", "mom", "child", False),
    "child": ("parent", "child", "parent", True),
    "son": ("parent", "son", "parent", True),
    "daughter": ("parent", "daughter", "parent", True),
    "grandparent": ("grandparent", "grandparent", "grandchild", False),
    "grandfather": ("grandparent", "grandpa", "grandchild", False),
    "grandmother": ("grandparent", "grandma", "grandchild", False),
    "grandchild": ("grandparent", "grandchild", "grandparent", True),
    "grandson": ("grandparent", "grandson", "grandparent", True),
    "granddaughter": ("grandparent", "granddaughter", "grandparent", True),
    "spouse": ("spouse", "partner", "partner", False),
    "sibling": ("sibling", "sibling", "sibling", False),
    "brother": ("sibling", "brother", "sibling", False),
    "sister": ("sibling", "sister", "sibling", False),
    "friend": ("friend", "friend", "friend", False),
}


def relationship(kind: str, anchor: UUID, person: UUID):
    edge_kind, person_role, anchor_role, descendant = ROLES[kind]
    if descendant:
        return anchor, person, edge_kind, anchor_role, person_role
    return person, anchor, edge_kind, person_role, anchor_role
