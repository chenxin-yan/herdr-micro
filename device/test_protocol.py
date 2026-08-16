# Run: python3 device/test_protocol.py
import json

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

# transient sound commands survive JSONL framing as separate named events
sound_reader = LineReader()
frames = sound_reader.feed(b'{"t":"sound","name":"attn"}\n{"t":"sound","name":"done"}\n')
assert [json.loads(frame) for frame in frames] == [
    {"t": "sound", "name": "attn"},
    {"t": "sound", "name": "done"},
]

print("test_protocol: all assertions passed")
