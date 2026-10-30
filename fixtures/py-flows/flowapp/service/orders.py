from flowapp.domain.rules import validate
from flowapp.storage.events import on_saved


def submit(item):
    value = validate(item)
    handlers = {"saved": on_saved}
    handlers["saved"](value)
    return value
