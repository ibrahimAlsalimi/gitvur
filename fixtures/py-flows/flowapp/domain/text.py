from flowapp.storage.repository import store


def normalize(item):
    return store(item.strip())
