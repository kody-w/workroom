# The Workroom

A board for a team, where the board is not the record.

Every change — a card added, moved, edited, removed — is one **rapp/1 frame**
appended to a chain in this browser's localStorage. The board you look at is a
*projection* of that chain. Press **Rebuild from frames** and it is thrown away
and replayed, which is the only reason to believe the chain is the truth rather
than a log written beside it.

Open `index.html`. There is no server, no build, no dependency.

## It opens on work already in progress

A blank board explains nothing, so a fresh browser opens on a worked example —
a week mid-flight, with **people and agents both writing to the same record**.
An author whose name starts with `@` is an agent; the board and the ledger show
the difference, because "an AI did this" is worth being able to see at a glance.

Three examples ship, and you can flip between them from the header while you
work: shipping a demo, an incident at hour two, and a customer week. Press
**agents idle** to let the agents carry on while you watch — every move they
make is an ordinary append, verified and chained exactly like anything you type.

None of it is mocked. The app verifies every frame it loads, so a fake seed
would be refused by its own front door: `build-seeds.mjs` pulls the hash
primitives out of the shipped `index.html` and mints each example as a real
chain. Each is its own stream, so switching between them is not a rollback of
anything.

## Watch the world be rebuilt

Press **Replay from frame 0** and the board is thrown away and re-derived one
frame at a time, from the genesis forward — the card each frame touches lights
up, a line says who did what, and the ledger follows along. Or drag the scrubber
and stand anywhere in the history you like.

This is the claim being demonstrated rather than asserted. If the chain really is
the record and the board really is only a projection of it, then every earlier
board is still in there. Rewind far enough and you get an empty world; walk
forward and you watch it fill, including a note being revised in place when the
edit frame lands.

While you are looking at an earlier frame the board is read-only — writing there
would append to the head while showing you the past, and the card would appear to
go somewhere it did not.

    node build-seeds.mjs      # regenerate and re-inject them

## Watch it do the work, and take the outputs out

Press **▶ Dry run** and the agents work the board in front of you: they pick a
card up out of Next, log what they did to it, and move it to Done — three real
appended frames per card, at reading speed, with the card being worked lit up.

Every card they finish **ejects a file out of the browser**. A work product per
card, and a run receipt at the end, land in your downloads folder and in the
**Outbox** pane, each with the sha256 of the bytes as written — so

```
shasum -a 256 ~/Downloads/workroom-presence-relay.md
```

has to print what the Outbox says. The work product names the exact frames that
produced it and how to recompute their hashes; the receipt carries the run's
whole chain plus every artifact and its hash, which is enough to re-verify the
run without this page. It states the verdict honestly, including when the
verdict is bad.

Nothing invents itself at runtime and nothing leaves the machine. That is what
makes it a *dry* run — but the frames, the files and the hashes are real
production output, which is the only kind worth reviewing.

Press it again to stop. The stop is final: the run holds a session object, not a
flag, so a stopped run cannot be resurrected by a later one.

## Start a new dimension from any frame

Stand anywhere in the history and press **⑂ Fork from here**. That mints a *new*
stream — a fresh rappid from random octets, never a hash of a name — whose
genesis records exactly where it came from: the parent stream, the seq, and that
frame's wave hash. The world at that frame is then **re-derived** as fresh
frames rather than copied, so the new dimension is a first-class chain that
verifies on its own terms.

The dimension you left is not destroyed. It goes into the picker under
*Dimensions you left*, and hopping back verifies it again before it is loaded —
having been ours once is not a reason to trust it now.

## Why the frames are real

Claiming rapp/1 is easy; the hashes have to agree with the reference or the
word is decoration.

```
node verify_parity.mjs
```

pulls the canonicalizer and hash functions **out of the shipped `index.html`**
— not a copy — runs them over eight payloads including unicode keys and a full
nine-key wave pre-image, and compares every result with `rapp.py` from
`kody-w/rapp-1`. All eight agree byte for byte, and an object written with its
keys in two different orders hashes identically, which is what JCS is for.

Conformance, SPEC.md rev-6:

| § | what |
|---|---|
| 4 | RFC 8785 JCS canonicalization over the I-JSON domain — no floats |
| 5 | `H(space, v) = sha256( utf8(space) ‖ 0x0A ‖ canonical(v) )` |
| 6 | the rappid is minted once from 16 random octets — **never** a hash of a name |
| 7 | exactly eleven keys; particle (`payload_hash`) then wave (`frame_hash`) |

`kind` is `memory.save`, which is registered. Nothing here invents one.

## Proof it works

```
node drive.mjs        # needs playwright; node_modules is symlinked from ~/nexus-tour
```

drives a real browser through the whole flow and then through the failures that
matter, because those are what a record has to survive:

| | |
|---|---|
| tampering | a stored frame is altered — both hashes are reported |
| a dead store | `setItem` throws; the change is **refused**, not kept in memory and lost on reload, and the warning is sticky |
| a poison import | frames that cannot be canonicalized at all — the live chain is untouched and the next edit is still yours |
| an unpaired surrogate | outside the I-JSON domain (§4), refused rather than escaped into a hash the reference cannot reproduce |
| a lane that does not exist | refused at import instead of bricking the board on every future load |

`shot.png` is the tampered state: the ledger shows the altered frame and the
status bar names it.

Five more drivers cover the rest, and each one asserts against something outside
the app rather than against the app's own report:

```
node seedcheck.mjs     # the seeded boot and the switcher
node replaycheck.mjs   # the scrubber, the read-only past, return to now
node playcheck.mjs     # the animated replay, frame by frame
node runcheck.mjs      # the dry run — sha256s the files that reached the DISK
node forkcheck.mjs     # a fork is a new stream that knows its parent
node studiocheck.mjs   # the studio's wire, and a watcher rebuilding from it
node gatecheck.mjs     # every door enforces the rule the door beside it does
```

`gatecheck.mjs` takes the file under test as `argv[2]`, so each case can be run against
the revision its bug lived in — which is the only thing that makes a new test worth
having. Five of its eight assertions fail on the previous commit and all pass on this
one.

`runcheck.mjs` catches every download the page starts, hashes the bytes that
landed, and requires them to equal what the Outbox printed. A file the app
described but did not write, or wrote differently, fails there.

## Watch it, broadcast it, record it

Open `broadcast.html`. The board runs in a frame and every frame it commits lands
on **the wire** beside it, in real time, as it is written.

**Go live** hands you a link. What crosses it is not a picture of the board: it is
the **frames**. The watcher verifies every one — hashes recomputed, links followed —
and re-derives the board with its own projection code. So what is shared is the
record, and a watcher's copy is as good as the original rather than a video of it.
A frame that does not verify is refused at the watcher's door and named on screen.

**Record** captures the tab to a `.webm` and writes it out when you stop, together
with a `.frames.json` of exactly what was on the wire while it was rolling — so the
film can be checked against something instead of believed.

The studio holds its own copy of the canonicalizer, because two readers of the same
wire must canonicalize identically. `verify_parity.mjs` fails if that copy drifts
from the app's by a single byte.

## Import / export

Export hands you the whole stream as JSON. Paste it into another browser and it
rebuilds exactly this board — after verifying every hash. An import that fails
verification is refused and the current stream is left untouched.
