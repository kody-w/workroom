# Presence relay

worked by   @triage
run         dry run 2026-08-29T16:10:37Z
stream      rappid:@kody-w/workroom-demo-tour:84e3cf5a833f023bfdef5b1c0a474ac0c84445ed5e7b75eb2220468b2f65098c:3a89754fd9c7059d
lane        done

## The note as it stood when the work finished

ruled out the two easy explanations

## What the run did

- logged the work    frame  22  wave 8c85c2cc115457945936bd5f065cfb4bc5f20a859bacbc68f9c050c31afac31b
- moved it to done   frame  23  wave bf28b5356b7898c7a28d7cf520a29ed984c0a5b82ac441e793d2ec5e66f19ec9

## How to check this file

Every frame named above is in the exported stream. For each one:

    payload_hash = sha256("rapp/1:particle" + 0x0A + JCS(payload))
    frame_hash   = sha256("rapp/1:wave"     + 0x0A + JCS(frame minus frame_hash and sig))

JCS is RFC 8785. The reference implementation is rapp.py in kody-w/rapp-1.
Nothing here is signed: this is evidence of a local run, not an attestation.
