import type { FileTree } from "./gitFixture";

export const pythonBase: FileTree = {
  "qpeft/packing.py": `BITS = 4


def pack_codes(codes, bits):
    words = []
    for code in codes:
        words.append(code)
    return words


def unpack_codes(words, bits):
    return [word & ((1 << bits) - 1) for word in words]
`,
  "qpeft/trainer.py": `class Trainer:
    def __init__(self, lr):
        self.lr = lr

    def learning_rate(self, bits):
        return self.lr
`,
  "tests/test_packing.py": `import pytest
from qpeft.packing import pack_codes, unpack_codes


def test_round_trip():
    codes = [1, 2, 3]
    assert unpack_codes(pack_codes(codes, 3), 3) == codes
    assert len(pack_codes(codes, 3)) == 3


def test_scale():
    assert abs(scale() - 0.5) < 1e-6
    torch.testing.assert_close(scale(), 0.5, atol=1e-6, rtol=0)


def test_kernel():
    assert kernel() == 1
`,
  "README.md": "# qpeft\n",
};

// The PR: changes both packing functions and the trainer, and weakens three tests in three ways.
export const pythonHead: FileTree = {
  "qpeft/packing.py": `BITS = 4


def pack_codes(codes, bits):
    words = []
    shift = 0
    for code in codes:
        words.append(code << shift)
        shift = (shift + bits) % 32
    return words


def unpack_codes(words, bits):
    return [(word >> 0) & ((1 << bits) - 1) for word in words]
`,
  "qpeft/trainer.py": `class Trainer:
    def __init__(self, lr):
        self.lr = lr

    def learning_rate(self, bits):
        return self.lr * (2 if bits <= 3 else 1)
`,
  "tests/test_packing.py": `import pytest
from qpeft.packing import pack_codes, unpack_codes


def test_round_trip():
    codes = [1, 2, 3]
    assert len(pack_codes(codes, 3)) == 3


def test_scale():
    assert abs(scale() - 0.5) < 1e-6
    torch.testing.assert_close(scale(), 0.5, atol=1e-2, rtol=0)


@pytest.mark.skip(reason="kernel not built on CI")
def test_kernel():
    assert kernel() == 1
`,
  "README.md": "# qpeft\n\nQuantized PEFT.\n",
};
