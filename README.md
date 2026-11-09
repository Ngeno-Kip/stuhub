# StuHub

StuHub is an event booking and support desk application with a Node.js/Express
API and a browser-based frontend.

## Run locally

From the project root, in Windows PowerShell:

```powershell
npm.cmd --prefix server install
npm.cmd run dev
```

In other shells, use `npm --prefix server install` and `npm run dev`.

Open [http://localhost:8080](http://localhost:8080). MySQL must be running.
See [server/README.md](server/README.md) for database configuration, routes,
and admin setup.

Copy `server/.env.example` to `server/.env` and set private credentials before
running. Do not commit `.env` or generated files in `server/public/uploads`.
