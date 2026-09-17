import random

import pytest


@pytest.fixture
def rng_factory():
    def make(seed):
        return random.Random(seed)
    return make
