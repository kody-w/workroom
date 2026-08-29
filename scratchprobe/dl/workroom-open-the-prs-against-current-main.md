# Open the PRs against current main

worked by   @scout
run         dry run 2026-08-29T16:10:37Z
stream      rappid:@kody-w/workroom-demo-tour:84e3cf5a833f023bfdef5b1c0a474ac0c84445ed5e7b75eb2220468b2f65098c:3a89754fd9c7059d
lane        done

## The note as it stood when the work finished

pulled the sources and reconciled them

## What the run did

- picked it up       frame  16  wave 4ed5d6a281ce4be66128ca7ddfb59b6022fc077257feb2dd445777ad6422ce41
- logged the work    frame  17  wave 3040819fec55589e516c1835675703e0f68a42d7f34a3e20aa0423cc87b6661a
- moved it to done   frame  18  wave fa5ccf6dee8c8ffa0a96f59dc9af63b6db808214cd2e2ebdce1fe63a08d37274

## How to check this file

Every frame named above is in the exported stream. For each one:

    payload_hash = sha256("rapp/1:particle" + 0x0A + JCS(payload))
    frame_hash   = sha256("rapp/1:wave"     + 0x0A + JCS(frame minus frame_hash and sig))

JCS is RFC 8785. The reference implementation is rapp.py in kody-w/rapp-1.
Nothing here is signed: this is evidence of a local run, not an attestation.
