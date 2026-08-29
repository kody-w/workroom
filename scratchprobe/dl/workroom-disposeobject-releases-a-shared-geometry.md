# disposeObject releases a shared geometry

worked by   @reviewer
run         dry run 2026-08-29T16:10:37Z
stream      rappid:@kody-w/workroom-demo-tour:84e3cf5a833f023bfdef5b1c0a474ac0c84445ed5e7b75eb2220468b2f65098c:3a89754fd9c7059d
lane        done

## The note as it stood when the work finished

tried to disprove it and could not

## What the run did

- logged the work    frame  28  wave 7c216419b21fb39b5c88ab046114cfdc7898ed7654a6da6de434df33314526be
- moved it to done   frame  29  wave 194e2c933333846ab23617478fedbb972da036e446e89e70605168f8f299222f

## How to check this file

Every frame named above is in the exported stream. For each one:

    payload_hash = sha256("rapp/1:particle" + 0x0A + JCS(payload))
    frame_hash   = sha256("rapp/1:wave"     + 0x0A + JCS(frame minus frame_hash and sig))

JCS is RFC 8785. The reference implementation is rapp.py in kody-w/rapp-1.
Nothing here is signed: this is evidence of a local run, not an attestation.
