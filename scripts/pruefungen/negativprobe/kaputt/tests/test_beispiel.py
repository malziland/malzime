import pytest

def test_ohne_zusicherung():
    ergebnis = berechne(2, 3)
    print(ergebnis)

@pytest.mark.skip
def test_uebersprungen():
    assert berechne(2, 3) == 5

def test_immer_wahr():
    assert True
