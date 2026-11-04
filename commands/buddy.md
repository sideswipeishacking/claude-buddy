---
description: Summon a desktop buddy for this session (/buddy off to dismiss)
argument-hint: "[off | custom | helpers on|off | name <nickname> | hat <name> | size [laptop|external] <1-12>]"
disable-model-invocation: true
---
The Claude Buddy hook normally handles `/buddy` before it reaches you, so if you are reading this the hook did not run.
Reply with one short sentence telling the user that the Claude Buddy plugin's hooks are not active in this session
(they load when a session starts, so starting a new session usually fixes it) and do nothing else.
