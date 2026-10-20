# Code Assist — Build Starting Point

Code Assist is a standalone application deployed to a Mac mini. The UI, controller, both agent SDKs, PostgreSQL, working repositories, test services, browsers and artifacts run on that machine. No AWS infrastructure is part of this project.

- [Current requirements](standalone-brief.md): the source of truth for scope, lifecycle, recovery, approvals and local execution requirements.
- [Interactive prototype](index.html): the accepted Home and ticket-timeline design, showing the original single-repository design and observed merge → Done. The live intake now supports multiple repositories per Tim’s October 20 request.

Open `index.html` in a browser. Everything is simulated and saved in browser-local storage. ONE-5190 is a ticket snapshot used as an example; other tickets are fictional. Sample repository names are display data, not implementation dependencies or the configured repository manifest. No live polling, agent execution, GitHub writes or notifications occur in the prototype.

Build the local runtime proof first, then intake through plan approval, then implementation through PR completion. See [implementation and deployment plan v1](../plans/plan_v1.md) for the proposed build sequence. Use the brief's open decisions instead of inferring requirements from demo code.
