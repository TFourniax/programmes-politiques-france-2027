#!/usr/bin/env python3
from canonical_queue import CanonicalQueue
from common import ROOT


def main() -> None:
    queue = CanonicalQueue(ROOT)
    queue.restore_head()
    print("Canonical working tree restored to HEAD; pending queue preserved.")


if __name__ == "__main__":
    main()
