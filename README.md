# Bestune Booking Railway Version

This version is for Railway shared data.

## Railway setup

1. Upload these files to the `Bestune-Booking` GitHub repository.
2. In Railway, deploy from that GitHub repository.
3. Add a PostgreSQL database in the same Railway project.
4. Railway will provide `DATABASE_URL` automatically.
5. Open the service `Settings` > `Networking`.
6. Generate a public domain.

The app listens on `process.env.PORT`, with fallback `8080`, so Railway can route traffic correctly.

## Public link

After Railway generates a domain, share the Railway URL with users. All users will read and save to the same database.
