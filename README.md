# SecureShare &bull; Personal Encrypted Vault &amp; Secure Ephemeral Sharing

> **Semester 5 Capstone Project**  
> A production-grade, privacy-centric personal file vault and tokenized ephemeral file sharing platform.

---

## 1. Project Overview &amp; Architecture

SecureShare provides end-to-end encrypted personal storage and secure tokenized file sharing. It is built under a strict **Zero-Local-Disk Architecture**:

- **Binary File Storage:** Uploaded files stream directly into a private **Supabase Storage** bucket named `vault`. Binary files are **never** written to local server disk or container storage.
- **Database &amp; Metadata:** File metadata (filename, size, MIME type, storage path, user ownership, timestamps) is persisted in a relational **Supabase PostgreSQL** database.
- **Authentication:** Custom email OTP verification flow. 6-digit numeric passcodes are dispatched in real-time via **Nodemailer** using **Gmail SMTP**, hashed with `bcrypt` (10 rounds), and expire in 10 minutes.
- **Session Security:** Cryptographically signed **JSON Web Tokens (JWT)** with HS256 algorithm and 7-day expiration.
- **Ephemeral Sharing:** Cryptographically random UUID share tokens (`/share/:token`), optional `bcrypt` password protection, configurable expiration (1h, 24h, 7d, 30d, custom), max download thresholds, and instant one-click revocation.
- **Signed URL Delivery:** Downloads utilize ephemeral, time-limited Supabase signed URLs (`createSignedUrl`) with 1-hour expiration.

---

## 2. Directory Structure

```
secureshare/
├── netlify/
│   └── functions/
│       ├── _supabase.js          # Supabase service_role server client & dev fallback
│       ├── _mailer.js            # Nodemailer Gmail SMTP transport & connection verification
│       ├── _templates.js         # Responsive HTML email templates with 10-minute expiry notice
│       ├── send-otp.js           # Registration & OTP dispatch with 30s cooldown and 5/hr rate limits
│       ├── verify-otp.js         # 6-digit bcrypt OTP verification & JWT issuance
│       ├── resend-otp.js         # Rate-limited OTP resend handler
│       ├── login.js              # Bcrypt password authentication & JWT session generation
│       ├── create-share.js       # Tokenized share link generation (/share/:token) with optional password
│       ├── access-share.js       # Public share access validator, password gate & signed URL generator
│       ├── revoke-share.js       # Instant share revocation handler
│       ├── save-file.js          # File metadata recorder in PostgreSQL "files" table
│       ├── list-files.js         # Vault file listing & aggregated storage metrics
│       ├── delete-file.js        # Supabase Storage + PostgreSQL cascading deletion
│       ├── rename-file.js        # Display filename updater
│       ├── download-file.js      # Vault owner 1-hour signed URL generator
│       └── list-shares.js        # Active shares dashboard tracker with live countdowns
├── public/
│   ├── index.html                # Landing page & feature showcase
│   ├── register.html             # User registration page
│   ├── verify-otp.html           # 6-box OTP entry with auto-advance, paste & live timer
│   ├── login.html                # Sign-in page
│   ├── dashboard.html            # "My Files" personal vault dashboard
│   ├── shares.html               # "Active Shares" management dashboard
│   ├── storage.html              # Storage quota & categorization breakdown
│   ├── share.html                # Public share viewer & password-protected downloader
│   ├── css/
│   │   ├── tokens.css            # Design system CSS variables & light theme tokens
│   │   └── style.css             # Component styling, navbar, cards, tables, modals & responsive rules
│   └── js/
│       ├── supabase-client.js    # Browser Supabase client (publishable/anon key ONLY)
│       ├── auth.js               # Auth state manager, session storage & toast alerts
│       ├── verify-otp.js         # 6-box auto-focus, paste, and cooldown logic
│       ├── upload.js             # Drag-and-drop vault uploader with progress indicators
│       ├── dashboard.js          # Vault file table, search filter, rename & delete actions
│       └── share.js              # Share modal creator, live countdowns, and public downloader
├── sql/
│   └── migration.sql             # Complete PostgreSQL schema, indexes, and RLS policies
├── netlify.toml                  # Netlify build and redirect routing rules
├── package.json                  # Dependencies & scripts
├── server.ts                     # Local full-stack development & testing server
├── .env.example                  # Environment template
└── README.md                     # Comprehensive documentation
```

---

## 3. Step-by-Step Setup Guide

### STEP 1: Supabase Database & Storage Setup

1. Open your [Supabase Dashboard](https://supabase.com/dashboard) and select your project (`nlqdkbowymyrlotmpinh`).
2. Navigate to the **SQL Editor** in the left sidebar.
3. Open `sql/migration.sql` from this repository, copy its entire contents, paste it into the SQL Editor, and click **Run**.
   - This creates the 4 core tables: `profiles`, `otp_codes`, `files`, and `shares`.
   - Sets up performance indexes on emails, foreign keys, and share tokens.
   - Enables **Row Level Security (RLS)** on all tables.
4. Set up the **Storage Bucket**:
   - Go to **Storage** in the left menu.
   - Click **New Bucket**.
   - Name: `vault`
   - Public bucket: **OFF** (Keep it private!).
   - File size limit: `52428800` bytes (50 MB).
   - Click **Save**.

### STEP 2: Configure Environment Variables

Create a `.env` file in the root directory:

```env

> **Security Reminder:** The `SUPABASE_SERVICE_ROLE_KEY` has administrative privileges to bypass RLS for server-side operations and should **never** be exposed to frontend JavaScript.

---

## 4. Running Locally

Install dependencies and start the full-stack server:

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` in your browser.

---

## 5. Netlify Deployment Guide

1. **Push to GitHub:**
   ```bash
   git add .
   git commit -m "feat: complete SecureShare vault and file sharing platform"
   git push origin main
   ```
2. **Connect to Netlify:**
   - Go to [Netlify App](https://app.netlify.com) and click **Add new site &rarr; Import an existing project**.
   - Select your GitHub repository.
   - Build command: `npm run build`
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
3. **Configure Environment Variables in Netlify:**
   - In your Netlify site dashboard, navigate to **Site configuration &rarr; Environment variables**.
   - Add all environment variables from `.env` (including `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, and `SMTP_*` credentials).
4. **Trigger Deploy:**
   - Netlify will build the static frontend and deploy the 10 serverless functions.

---

## 6. End-to-End Testing Checklist

1. [x] **Registration:** Go to `/register.html`, enter Full Name, Email, and Password.
2. [x] **Live OTP Dispatch:** Check your Gmail inbox for the branded 6-digit OTP email (and check terminal logs in dev).
3. [x] **Verification:** Input the 6 digits on `/verify-otp.html`. Test paste support and backspace navigation.
4. [x] **Vault Upload:** Drag-and-drop a file (PDF, image, document) up to 50 MB. Watch the progress bar fill as bytes stream to the `vault` bucket.
5. [x] **Signed Download:** Click the download icon in the file table. Verify that an ephemeral signed URL is generated.
6. [x] **Share Creation:** Click the share icon on a file. Select 24-hour expiration and toggle password protection. Click "Generate Secure Link" and copy the link.
7. [x] **Public Access:** Open the share link in an Incognito/Private window. Notice that no account login is required.
8. [x] **Password Protection:** Enter the password to unlock the download card.
9. [x] **Download & Count:** Click "Download File Securely". Verify the download count increments.
10. [x] **Revocation:** In your dashboard under "Shares", click the red **Revoke** button. Refresh the Incognito window and verify the "Link Revoked" security screen appears immediately.
