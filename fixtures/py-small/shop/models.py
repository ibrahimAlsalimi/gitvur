"""Catalogue models."""


class Book:
    def __init__(self, name, price):
        self.name = name
        self.price = price

    def describe(self):
        return "Book: " + self.name


class Toy:
    def __init__(self, name, price):
        self.name = name
        self.price = price

    def label(self):
        return self.name.upper()

    def describe(self):
        label = self.label()
        return "Toy: " + label
