from flowapp.service.orders import submit


def handle(item):
    return submit(item)


ROUTES = {"POST /orders": handle}
