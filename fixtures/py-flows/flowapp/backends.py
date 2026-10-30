class Cache:
    def save(self, item):
        return item


class Disk:
    def save(self, item):
        return item


def persist_unknown(backend, item):
    return backend.save(item)


def countdown(n):
    if n <= 0:
        return 0
    return countdown(n - 1)


sink = Cache()
if __name__ == "__main__":
    sink.save("example")
