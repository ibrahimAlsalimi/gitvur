"""Formatting helpers shared across the shop package."""

SYMBOLS = {"EUR": "EUR", "USD": "$"}


def format_price(amount, currency="EUR"):
    def with_symbol(text):
        symbol = SYMBOLS.get(currency, currency)
        return symbol + " " + text

    return with_symbol("%.2f" % amount)


def slugify(text):
    return "-".join(text.lower().split())


def to_amount(value):
    return float(value)


# Rounded variant. This definition shadows the one above at import time.
def to_amount(value):
    return round(float(value), 2)
