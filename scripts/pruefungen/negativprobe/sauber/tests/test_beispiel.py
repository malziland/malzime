def test_addition():
    assert berechne(2, 3) == 5

def test_fehlerfall():
    with pytest.raises(ValueError):
        berechne(None, 3)
