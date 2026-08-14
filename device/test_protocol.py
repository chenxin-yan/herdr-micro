# Run: python3 device/test_protocol.py
from protocol import LineReader

r = LineReader(max_line=8)

# whole line
assert r.feed(b'{"a":1}\n') == [b'{"a":1}']
# split across feeds
assert r.feed(b'{"b"') == []
assert r.feed(b":2}\n") == [b'{"b":2}']
# multiple lines in one feed, empty lines skipped
assert r.feed(b"x\n\ny\n") == [b"x", b"y"]
# oversized line discarded to newline, next line survives
assert r.feed(b"0123456789ABCDEF\nok\n") == [b"ok"]
# discard state spans feeds
assert r.feed(b"0123456789") == []
assert r.feed(b"ABC\nz\n") == [b"z"]
# exactly max_line is accepted
assert r.feed(b"12345678\n") == [b"12345678"]

print("test_protocol: all assertions passed")
