"""In-memory cache that mirrors the store API."""


class Cache:
    def __init__(self):
        self.entries = {}

    @staticmethod
    def create():
        return Cache()

    def save(self, item):
        self.entries[item.name] = item

    def lookup(self, name):
        return self.entries.get(name)
