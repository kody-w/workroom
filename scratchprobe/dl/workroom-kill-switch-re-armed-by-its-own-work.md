# Kill switch re-armed by its own work

worked by   @reviewer
run         dry run 2026-08-29T16:10:37Z
stream      rappid:@kody-w/workroom-demo-tour:84e3cf5a833f023bfdef5b1c0a474ac0c84445ed5e7b75eb2220468b2f65098c:3a89754fd9c7059d
lane        done

## The note as it stood when the work finished

read it against the spec, not against the comments

## What the run did

- logged the work    frame  26  wave 0a712185ee7a0c03af95e51260f8635dd0f9776c522b2771559e0595f9352b5a
- moved it to done   frame  27  wave 1455157c1a0e247a79d9c421368c1f2ca6e29b6274b0325b4ddf3e8c727197e9

## How to check this file

Every frame named above is in the exported stream. For each one:

    payload_hash = sha256("rapp/1:particle" + 0x0A + JCS(payload))
    frame_hash   = sha256("rapp/1:wave"     + 0x0A + JCS(frame minus frame_hash and sig))

JCS is RFC 8785. The reference implementation is rapp.py in kody-w/rapp-1.
Nothing here is signed: this is evidence of a local run, not an attestation.
