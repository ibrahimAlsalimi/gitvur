"""Persistent storage for catalogue items."""

import json


class Store:
    def __init__(self, path):
        self.path = path
        self.items = []

    def save(self, item):
        def encode(entry):
            return {"name": entry.name, "price": entry.price}

        self.items.append(item)
        payload = [encode(entry) for entry in self.items]
        with open(self.path, "w") as handle:
            json.dump(payload, handle)
