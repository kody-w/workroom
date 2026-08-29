# Prove the tests are not theatre

worked by   @reviewer
run         dry run 2026-08-29T16:10:37Z
stream      rappid:@kody-w/workroom-demo-tour:84e3cf5a833f023bfdef5b1c0a474ac0c84445ed5e7b75eb2220468b2f65098c:3a89754fd9c7059d
lane        done

## The note as it stood when the work finished

read it against the spec, not against the comments

## What the run did

- picked it up       frame  19  wave 5ad91bc221239dd3cfb94de503fe6eec2bf80483dbdb63650a4977309193f104
- logged the work    frame  20  wave 69cbc0e6d9335ae49a191bd4e2f9e35711d027e146c253671ba6e02e4cb6657c
- moved it to done   frame  21  wave c423fd34cd81219643aab315f93a6c236e91ee1ca3d87a4954f517286dd2132a

## How to check this file

Every frame named above is in the exported stream. For each one:

    payload_hash = sha256("rapp/1:particle" + 0x0A + JCS(payload))
    frame_hash   = sha256("rapp/1:wave"     + 0x0A + JCS(frame minus frame_hash and sig))

JCS is RFC 8785. The reference implementation is rapp.py in kody-w/rapp-1.
Nothing here is signed: this is evidence of a local run, not an attestation.
