# VHS tape — renders docs/demo.gif (https://github.com/charmbracelet/vhs)
#
#   docker compose build           # pre-build so the GIF isn't dominated by image builds
#   vhs docs/demo.tape             # writes docs/demo.gif
#
# Headline pitch: stand up a full simulated Gree AC + Node-RED stack and prove
# the UDP/AES protocol green — all without any hardware. Deliberately uses the
# fast in-process simulator tests (`npm run test:sim`), not the long docker
# e2e, so it records reliably and stays short.

Output docs/demo.gif

Require npm
Require docker

Set Shell "bash"
Set FontSize 16
Set Width 1120
Set Height 660
Set Padding 22
Set Theme "Catppuccin Mocha"
Set TypingSpeed 55ms

Hide
Type "clear" Enter
Show

Type "# A full Gree HVAC stack — simulator + Node-RED — no hardware needed"
Enter
Sleep 1200ms

Type "npm run sim:up"
Enter
# Match the compose up-phase summary. Covers a cold start ("Started"/"Healthy")
# AND a warm stack where containers already exist ("Running"). Avoid "done",
# which falsely matches build-layer output during --build.
Wait+Screen@180s /Started|Healthy|Running/
Sleep 1500ms

Type "# Sim dashboard on :8080, Node-RED on :1880 are live. Now prove the"
Enter
Type "# Gree UDP/AES protocol — discover, bind, status, cmd, fault injection:"
Enter
Sleep 1000ms

Type "npm run test:sim"
Enter
Wait+Screen@60s /fail 0/
Sleep 1500ms

Type "# All green against the simulated AC — no hardware involved. Tear down:"
Enter
Sleep 800ms
Type "npm run sim:down"
Enter
Wait+Screen@60s /Removed/
Sleep 2500ms
