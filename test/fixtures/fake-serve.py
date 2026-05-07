# Minimal stub of graphify/serve.py used as a test fixture for the
# repo-filter patcher. Mirrors the 5 find-anchors that PATCHES looks for.
def _query_graph_text(
    G,
    question: str,
    mode: str = "auto",
    depth: int = 2,
    token_budget: int = 8000,
    context_filters: list[str] | None = None,
) -> str:
    terms = [t.lower() for t in question.split() if len(t) > 2]
    return ""


def _tool_query_graph(arguments, G):
    question = arguments.get("question")
    mode = arguments.get("mode")
    depth = arguments.get("depth")
    budget = arguments.get("token_budget")
    context_filter = arguments.get("context_filter")
    return _query_graph_text(
        G,
        question,
        mode=mode,
        depth=depth,
        token_budget=budget,
        context_filters=context_filter,
    )


TOOLS_QUERY_GRAPH_SCHEMA = {
    "type": "object",
    "properties": {
        "question": {"type": "string"},
        "context_filter": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Optional explicit edge-context filter, e.g. ['call', 'field']",
        },
    },
    "required": ["question"],
}


TOOLS_GET_NEIGHBORS = dict(
    inputSchema={
        "type": "object",
        "properties": {
            "label": {"type": "string"},
            "relation_filter": {"type": "string", "description": "Optional: filter by relation type"},
        },
        "required": ["label"],
    },
)
TOOLS_GET_COMMUNITY = dict(name="get_community")


TOOLS_SHORTEST_PATH_SCHEMA = {
    "type": "object",
    "properties": {
        "source": {"type": "string", "description": "Source concept label or keyword"},
        "target": {"type": "string", "description": "Target concept label or keyword"},
        "max_hops": {"type": "integer", "default": 8, "description": "Maximum hops to consider"},
    },
    "required": ["source", "target"],
}
