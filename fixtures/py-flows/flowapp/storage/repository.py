from flowapp.storage.driver import commit


def store(item):
    return commit(item)
