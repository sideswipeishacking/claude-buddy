---
description: Summon a desktop buddy for this session (/buddy off to dismiss)
argument-hint: "[off | take [name] | custom | helpers on|off | annoy on|off | name <nickname> | hat <name> | size [laptop|external] <1-12>]"
disable-model-invocation: true
---
The Claude Buddy hook normally handles `/buddy` before it reaches you, so if you are reading this the hook did not run.
Reply with one short sentence telling the user that the Claude Buddy plugin isn't active in this session yet, and that
running `/reload-plugins` and then `/buddy` again fixes it (or starting a new session). Do nothing else.
