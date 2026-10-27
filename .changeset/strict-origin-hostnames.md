---
'@editful/plugin-artifact': patch
---

Reject network, remote-media, and script origins whose hostname is not plain
lowercase DNS (letters, digits, hyphens, dots, punycode). URL parsing alone
accepted hosts such as `x;sandbox` or `x"y`, which hosts copy into their
content security policy.
