# VHS tape — renders docs/demo.gif (https://github.com/charmbracelet/vhs)
#
#   docker compose build           # pre-build so the GIF isn't dominated by image builds
#   vhs docs/demo.tape             # writes docs/demo.gif
#
# Shows the headline pitch: bring up a simulated Gree AC + Node-RED and run
# the end-to-end suite green — all without any hardware.

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

Type "# A full Gree HVAC stack — simulator + Node-RED — tested without hardware"
Enter
Sleep 1200ms

Type "npm run sim:up"
Enter
Wait+Screen@180s /Started|Healthy|done/
Sleep 1500ms

Type "# Dashboard on :8080, Node-RED on :1880. Now drive it end-to-end:"
Enter
Sleep 1000ms

Type "E2E_SKIP_BUILD=1 npm run test:e2e"
Enter
Wait+Screen@240s /pass 8/
Sleep 1200ms

Type "# 8/8 green against the simulated AC. Tear down:"
Enter
Sleep 800ms
Type "npm run sim:down"
Enter
Wait+Screen@60s /Removed/
Sleep 2500ms
