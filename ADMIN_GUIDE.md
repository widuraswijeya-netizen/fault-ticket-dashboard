# ⚡ Fault Ticket Dashboard — Admin Guide

## Quick Start

1. Open the **Fault Ticket Dashboard** from the portal (`index.html`).
2. Log in with your **6-digit service number** and your individual password.
3. Upload a **CSV file** exported from the fault ticket system.
4. Click **"Update Cloud for Field"** to push data so field technicians get it automatically.

---

## CSV File Requirements

The dashboard expects a CSV export with the following columns:

| Column | Description | Required |
|--------|-------------|----------|
| `Priority` | Ticket priority level | Yes |
| `Circuit Display Name` | Circuit identifier | Yes |
| `Assigned WG` | Assigned workgroup | Yes |
| `Outage` | Duration in `HH:MM` format | Yes |
| `Customer Name` | Customer's name | Yes |
| `SA_ADDRESS` | Service address | Yes |
| `FA_CONTACT_NUMBER` | Contact phone number | Yes |
| `ID` | Ticket ID | Yes |
| `Status` | Ticket status (OPEN, ACKNOWLEDGED, etc.) | Yes |
| `SA_DP_LOOP` | DP Loop identifier | Yes |
| `SA_LEA` | LEA region code (GL, DU, UNW, HAR, UM, NF, IM) | Yes |
| `Description` | Fault description | Yes |
| `Reported On` | Date/time reported | Yes |
| `SA_SERVICE_TYPE` | Service type (e.g., V-VOICE COPPER, FTTH) | Yes |

> **Note:** Rows with `Assigned WG` containing "PM-SSU" are automatically filtered out.

---

## Ticket Categories

Tickets are automatically classified into 8 categories:

| Category | Criteria |
|----------|----------|
| **GL/DU FTTH** | FTTH service type in GL or DU regions |
| **UNW/HAR/IM FTTH** | FTTH service type in UNW, HAR, or IM regions |
| **GL/DU** | Copper service in GL/DU (non-underground, non-4G) |
| **UNW/HAR** | Copper with DP loop starting with UNW or HAR |
| **UM/NF** | Copper service in UM or NF regions |
| **IM** | Copper service in IM region |
| **4G** | Non-copper with LTE workgroup or 0913/94913 circuit |
| **UG Fault** | Assigned to CDM workgroup (underground) |

---

## Alarm Severity Levels

Alarms are based on the **Outage** duration for non-closed tickets:

| Duration | Level | Visual |
|----------|-------|--------|
| > 72 hours | 🔴 Critical | Red blinking bulb, red table row |
| > 48 hours | 🟠 Major | Orange-red blinking bulb, orange row |
| > 24 hours | 🟡 Minor | Amber blinking bulb, amber row |
| ≤ 24 hours | Normal | No alarm indicator |

---

## Cloud Sync and Daily Versions

The dashboard uses Supabase. Cloud credentials are stored in `config.js`:

```javascript
SUPABASE_URL: 'https://your-project.supabase.co',
SUPABASE_ANON_KEY: 'your-public-anon-key'
```

- **Upload:** Load a CSV, then click **Update Cloud for Field**. This updates the current ticket set and saves a timestamped version.
- **Auto-load:** Opening the dashboard retrieves the latest ticket set and today's saved versions.
- **Switch versions:** Use **Cloud version** to load an earlier sync from the current local calendar day. The label shows the CSV file's modified date/time, not its upload time. Versions created before this timestamp was stored show it as unavailable.
- **Workload trend:** Select a category card. The two-column chart shows that category's Open, Acknowledged, and Clear counts across today's saved versions. At least two versions are needed for a line chart; chart points use the cloud-save time.
- A version is saved on each manual cloud update, not on CSV selection alone.

### One-Time Snapshot Setup

Run [supabase_snapshots.sql](supabase_snapshots.sql) in the Supabase SQL Editor. It creates the `app_snapshots` table, timestamp columns/index, and browser access policies needed by the dashboard. If you already ran an earlier copy of this script, run the updated script again to add the CSV modified-time column.

**Data access:** Snapshot rows contain ticket/customer details. The updated SQL revokes anonymous access and grants access only to authenticated dashboard users. Run it after confirming that `public.app_state` exists. Existing public/anonymous policies are not a substitute for this migration.

### GitHub Pages Deployment

The manual Pages workflow publishes only the dashboard HTML, JavaScript, styles, and CSV parser. It generates `config.js` during the build, so the ignored local config and ticket CSV exports are not uploaded.

1. Push the project to the GitHub repository and enable **Settings → Pages → Build and deployment → GitHub Actions**.
2. In **Settings → Secrets and variables → Actions → Variables**, add:
   - `SUPABASE_URL`: the Supabase project URL.
   - `SUPABASE_ANON_KEY`: the Supabase publishable key. This key is public in a browser app; database access must be protected by RLS.
   - `SERVICE_EMAILS_JSON`: `{"013633":"013633@intranet.slt.com.lk"}`
3. In **Actions**, select **Deploy dashboard to GitHub Pages** and choose **Run workflow**.

The workflow is manual so a push alone does not publish the site. Before running it, verify the live project has the authenticated-only policies from [supabase_snapshots.sql](supabase_snapshots.sql).

---

## Authentication and Technician Accounts

Authentication is handled by Supabase Auth. The browser does not contain technician passwords or the service-role key. Technicians sign in using their service number and password. By default, service numbers map to `<6-digit-number>@fault-dashboard.example.com`; `SERVICE_EMAILS` in the ignored local `config.js` can override this for accounts using work email addresses.

### One-Time Setup

1. In Supabase Authentication settings, disable public sign-ups and set the minimum password length to 10. Only the server-verified user creation function should provision technician accounts.
2. In Supabase Authentication, create or update a confirmed user with the email `013633@intranet.slt.com.lk`. Enter a new admin password directly in the Supabase dashboard; do not put it in `config.js`, SQL, or website code.
3. In the Supabase SQL Editor, assign that account the admin role:

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
       || jsonb_build_object('service_number', '013633', 'role', 'admin')
   where email = '013633@intranet.slt.com.lk';
   ```

4. Run the updated [supabase_snapshots.sql](supabase_snapshots.sql) to enable provisioned-user access to the ticket and history tables and revoke anonymous access.
5. From a Supabase CLI project linked to this Supabase project, deploy the account-creation function:

   ```powershell
   supabase functions deploy create-user
   ```

   The function uses Supabase's server-side `SUPABASE_SERVICE_ROLE_KEY` environment variable. Never add that key to `config.js` or any browser code.

After setup, sign out and back in so Supabase issues a token with the admin role. The **Add Technician Account** panel is visible only to accounts with the server-issued `admin` role. Enter a unique 6-digit service number and a password of at least 10 characters containing an uppercase letter, lowercase letter, number, and special character. Share the temporary password with that technician through a separate secure channel.

Technician accounts created by the panel receive the `technician` role and cannot create other accounts. Supabase Auth hashes passwords; the dashboard never stores them in its own database.

The password previously shared in chat should be treated as exposed. Set a new admin password directly in Supabase before enabling production access.

---

## Saving & Loading Results

- **Save Result:** Saves the current table state to browser local storage with a custom name.
- **Load Selected:** Restores a previously saved result from the dropdown.
- **Clear Saved:** Removes all saved results for the current day.

> Saved results are stored per-day and only accessible on the same browser/device.

---

## Print Support

Click **"Print Table"** to open a print-friendly view with key columns:
- Priority, Circuit Display Name, Customer Name, Address, Contact Number, ID, DP Loop, Description

The print layout is formatted for **A4 landscape**.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Dashboard shows no data | Upload a CSV file or check cloud connectivity |
| "Cloud sync failed" | Check Supabase connectivity and authenticated table permissions |
| Login not working | Confirm the user exists in Supabase Auth and its `service_number` metadata matches the 6-digit number |
| Add User is unavailable | Confirm the signed-in account has `app_metadata.role = admin` and deploy the `create-user` Edge Function |
| Alarm bulbs not blinking | Ensure tickets have valid `Outage` values in `HH:MM` format |
| Wrong category counts | Verify `SA_SERVICE_TYPE`, `SA_LEA`, and `SA_DP_LOOP` columns in CSV |

---

## File Structure

```
├── index.html              Landing portal
├── Copper Dashboard.html   Main dashboard
├── script.js               Application logic
├── styles.css              Dashboard styling
├── config.js               Supabase URL and publishable key (git-ignored)
├── config.example.js       Config template (safe to commit)
├── supabase/functions/     Server-side account creation function
├── papaparse.min.js        CSV parsing library
├── ADMIN_GUIDE.md          This guide
└── .gitignore              Git ignore rules
```
