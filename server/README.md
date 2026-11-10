# StuHub API

## Database setup

StuHub stores accounts, support tickets, event bookings, and payment references in MySQL. Start MySQL from the
XAMPP Control Panel and make sure the `stuhub` database exists. The server
connects to `127.0.0.1:3306` as `root` with no password by default, then creates
the application tables if they do not exist. Override those defaults with the
`MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and
`MYSQL_DATABASE` settings in `server/.env`.

Set a private `JWT_SECRET` in `.env`; keep it out of source control. Optional
`JWT_EXPIRES` defaults to `7d`.

## Run locally

From this directory, install dependencies and start the API. In Windows
PowerShell:

```sh
npm.cmd install
npm.cmd run dev
```

In other shells, use `npm install` and `npm run dev`.

The website and API listen on `http://localhost:8080` by default. `GET /health`
checks the MySQL connection. The website itself still loads if MySQL is not
available.

## Routes

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me` (requires a Bearer token)
- `GET /api/tickets` (authenticated)
- `POST /api/tickets` (clients create their own support requests; admins can create for a client with `clientId`)
- `GET /api/tickets/:ticketNumber` (authenticated)
- `POST /api/tickets/:ticketNumber/messages` (authenticated)
- `PATCH /api/tickets/:ticketNumber/status` (admin)
- `GET /api/clients` (admin)
- `GET /api/accounts/pending` (admin; view new account requests)
- `PATCH /api/accounts/:accountId/approval` (admin; approve or reject an account request)
- `GET /api/events` (authenticated)
- `POST /api/events` (admin; multipart event details and optional `image` upload)
- `POST /api/events/:eventId/bookings` (reserve a place)
- `GET /api/events/bookings` (view your bookings; admins also see all bookings)
- `POST /api/events/bookings/:bookingId/payment-reference` (submit a transfer reference before the countdown expires)
- `PATCH /api/events/bookings/:bookingId/payment` (admin confirms or rejects a submitted transfer)

Paid reservations hold one seat for 15 minutes. A client must submit their
transfer reference before the countdown expires; the seat remains held while
an admin reviews the reference. Event organizers add their own transfer
instructions when publishing a paid event. Free event reservations are
confirmed immediately.

Clients can submit support requests from the **Support desk**. Their requests
appear in their own ticket list and the admin ticket queue, where the client's
name and email are available to the support team.

Admins can optionally attach one JPG, PNG, or WebP event image (up to 5 MB)
when publishing an event. New uploads are stored in MySQL so they remain
available across Vercel deployments and serverless function instances; events
without an uploaded image continue to use the built-in event photography.

Newly registered client accounts remain pending until an administrator
approves the request from the **Account approvals** dashboard. Existing
accounts remain approved. Approval requests stay in the local MySQL database;
no account details are sent to a messaging service.

Passwords use salted scrypt hashes. Legacy plaintext and HMAC-SHA-256 hashes
are upgraded to scrypt after a successful login.

To seed an admin locally, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`, then
run `npm run seed` (or `npm.cmd run seed` in PowerShell). In Vercel, add
`ADMIN_EMAIL`, `ADMIN_PASSWORD`, and optionally `ADMIN_NAME` as Production
environment variables. StuHub will create that admin automatically during the
next deployment's database initialization; an existing admin is never
overwritten.

## Photography

The local event photography in `public/images` is served from the StuHub site
and sourced from Unsplash: [hero image](https://images.unsplash.com/photo-1501386761578-eac5c94b800a),
[live event](https://images.unsplash.com/photo-1492684223066-81342ee5ff30),
[festival](https://images.unsplash.com/photo-1506157786151-b8491531f063),
and [concert crowd](https://images.unsplash.com/photo-1514525253161-7a46d19cd819).
See the [Unsplash License](https://unsplash.com/license).
