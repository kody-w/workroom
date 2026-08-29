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

    node build-seeds.mjs      # regenerate and re-inject them

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

## Import / export

Export hands you the whole stream as JSON. Paste it into another browser and it
rebuilds exactly this board — after verifying every hash. An import that fails
verification is refused and the current stream is left untouched.
