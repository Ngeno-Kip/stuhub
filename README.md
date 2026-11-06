# StuHub

StuHub is an event booking and support desk application with a Node.js/Express
API and a browser-based frontend.

## Run locally

In Windows PowerShell:

```powershell
cd server
npm.cmd install
npm.cmd run dev
```

Open [http://localhost:8080](http://localhost:8080). MySQL must be running.
See [server/README.md](server/README.md) for database configuration, routes,
and admin setup.

Copy `server/.env.example` to `server/.env` and set private credentials before
running. Do not commit `.env` or generated files in `server/public/uploads`.
