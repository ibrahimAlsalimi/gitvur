"""Order handling: pricing, persistence and receipts."""

import shop.utils
from shop.cache import Cache
from shop.utils import format_price as fmt

from .store import Store


class OrderService:
    def __init__(self, path):
        self.store = Store(path)
        self.cache = Cache()

    def place(self, item):
        self.remember(item)
        return self.receipt(item)

    def remember(self, item):
        backend = self.cache if item.price < 10 else self.store
        backend.save(item)

    def receipt(self, item):
        slug = shop.utils.slugify(item.name)
        price = fmt(item.price)
        return slug + ": " + price
