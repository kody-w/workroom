# Badges read 3 in every tab

worked by   @scout
run         dry run 2026-08-29T16:10:37Z
stream      rappid:@kody-w/workroom-demo-tour:84e3cf5a833f023bfdef5b1c0a474ac0c84445ed5e7b75eb2220468b2f65098c:3a89754fd9c7059d
lane        done

## The note as it stood when the work finished

pulled the sources and reconciled them

## What the run did

- logged the work    frame  24  wave c58c0b79ebee3cbfacd5818ad4ea9f32d3ff54c859c7262b8a9cb304bb564a13
- moved it to done   frame  25  wave f3ce0aec2d8f08e4be2d0b9d18af37976cd0dee62212fe018ae021290433aa3e

## How to check this file

Every frame named above is in the exported stream. For each one:

    payload_hash = sha256("rapp/1:particle" + 0x0A + JCS(payload))
    frame_hash   = sha256("rapp/1:wave"     + 0x0A + JCS(frame minus frame_hash and sig))

JCS is RFC 8785. The reference implementation is rapp.py in kody-w/rapp-1.
Nothing here is signed: this is evidence of a local run, not an attestation.
