---
name: ship
description: Build, link, commit, and push to remote
allowed-tools: Bash(./ship.sh *)
---

Run the ship script to build, npm link, commit all changes, pull --rebase, and push.

```bash
./ship.sh $ARGUMENTS
```

If no argument is provided, a default timestamped commit message is used.
Report the output to the user when done.
