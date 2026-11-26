# ScholarMatch

ScholarMatch is a Node.js and SQLite scholarship finder with student accounts, eligibility matching, application tracking, private document uploads, and an administrator review desk.

## Requirements

- Node.js 22.20 or newer
- npm

## Run locally on Windows

1. Copy `.env.example` to `.env`.
2. Edit `.env` and set a unique `SESSION_SECRET` (at least 32 characters), plus a valid `ADMIN_EMAIL` and an `ADMIN_PASSWORD` of at least 12 characters.
3. Install packages and start the server:

   ```powershell
   npm install
   npm start
   ```

4. Open [http://127.0.0.1:3000](http://127.0.0.1:3000).
5. Students create their own account from the sign-in page. Sign in to the verification desk with the configured administrator email and password.

For a quick random session secret, run this in PowerShell and copy the result into `.env`:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

The administrator account is created the first time the server starts with `ADMIN_EMAIL` and `ADMIN_PASSWORD` set. Changing those variables does not automatically replace an existing administrator's password; account recovery should be performed through a deliberate, secure administrative process.

## Student workflow

1. Create an account with an email address and a password of at least 12 characters.
2. Complete personal details, family details, annual household income, and education details in **Student profile**.
3. Upload the documents requested by a scholarship. The app accepts PDF, JPEG, and PNG files up to 5 MB each.
4. Open **Find scholarships** to review eligibility, document requirements, award values, and deadlines. Applications require a complete profile, a matching eligibility profile, and the required documents.
5. Follow application and document-verification status in the dashboard.

Required profile details include contact/address information, student and guardian names, household size and annual income, institution, course, education level, study year, and marks. Additional enrollment/graduation years and guardian occupation can be entered when available.

## Administrator workflow

- Review submitted applications and record status changes.
- Open a student's uploaded documents and mark each as **Verified**, **More information**, or **Rejected**.
- Add a note whenever more information or a replacement document is needed.
- Download access is restricted to the document owner and signed-in administrators.

The administrator account is never created through public student registration. The admin role is assigned only during the initial environment-based setup.

## Data and privacy

- SQLite database, session records, and uploaded files are stored in `~/.scholarmatch` (the current user's home directory), outside the public web root. Set `DATA_DIR` to a secure, non-public path to change it.
- Uploaded files are size-limited, type-checked against their file signatures, assigned random storage names, and never served as static public assets.
- Passwords are hashed with bcrypt. Sessions are stored server-side in SQLite and use HttpOnly, SameSite cookies; production cookies require HTTPS.
- Student and administrator API access is role-checked. Document downloads are restricted by owner/admin. State-changing requests use a session-bound CSRF token and same-origin check.
- `.env` and local `data/` files are excluded from Git. Do not commit credentials, uploaded documents, database files, or real student information.
- Deadline reminders are stored and shown in the app; email and push notifications are not configured.
- The included scholarship list and criteria are sample data. Confirm all details with scholarship providers before relying on them.

## Production deployment

This is a secure-development foundation, not a fully deployment-certified service. Before handling real student information or publishing it to the internet, use HTTPS, a strong unique production secret, protected and encrypted database/file backups, account email verification and recovery, administrator MFA, operational monitoring, retention/deletion policies, and a reviewed privacy notice. Restrict server and backup access, test recovery procedures, and obtain a security review appropriate to the data and jurisdiction. Do not expose the development server directly to the internet.
