"""Command-line entry point for the shop demo."""

import sys

from shop.models import Book, Toy
from shop.orders import OrderService


def main(argv=None):
    args = argv if argv is not None else sys.argv[1:]
    service = OrderService(args[0] if args else "orders.json")
    for item in (Book("Dune", 12.5), Toy("Kite", 7.0)):
        print(service.place(item))


if __name__ == "__main__":
    main()
