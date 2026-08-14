# Pure line framing for the Device Protocol (ADR-0003). No CircuitPython imports:
# runs under host python3 for tests and on-device alike.

MAX_LINE = 1024  # 1 KiB frame cap per ADR-0003


class LineReader:
    """Bounded JSONL framing: bytes in, complete lines out.

    Oversized input flips to discard-to-newline: everything up to the next
    newline is dropped, then framing resumes. Never grows past max_line.
    """

    def __init__(self, max_line=MAX_LINE):
        self.max_line = max_line
        self.buf = bytearray()
        self.discarding = False

    def feed(self, data):
        lines = []
        for b in data:
            if b == 10:  # \n
                if self.discarding:
                    self.discarding = False
                elif self.buf:
                    lines.append(bytes(self.buf))
                self.buf = bytearray()
            elif self.discarding:
                pass
            elif len(self.buf) >= self.max_line:
                self.buf = bytearray()
                self.discarding = True
            else:
                self.buf.append(b)
        return lines
