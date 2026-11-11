# New Day Church · Idea Library

A place for the church to share ideas, vote on them, talk them through, and see leadership respond.

## What it does

**Everyone (with an account)**
- Shares ideas: title, description, optional link, category, source, passion rating (1 *Ah, whatever* → 5 *Word of the Lord*), and optionally stays anonymous to other members.
- YouTube links open a **timestamp dialog**. Type times (`2:10`, `1:02:15`, `95`) or scrub the video and press *Use the video's current time*. The saved link opens at the first moment (`…watch?v=ID&t=<seconds>`), and each moment gets its own jump link.
- Website links get a **thumbnail automatically** (the page's `og:image`, saved locally on the NAS). No image means a colored "streak" card in the category color.
- Adds new categories while sharing.
- Gets warned about **similar ideas** while typing a title, to avoid duplicates.
- Edits or deletes their own ideas and comments, votes ideas up or down (never their own), comments, and reports anything inappropriate.
- Gets in-app **notifications** (the bell) when someone comments, leadership replies, or the status changes.
- **What's Happening** shows a board of ideas Under Review → Scheduled → In Progress → Done, plus "Not right now" ideas.

**Leadership**
- **Admins** can do everything. **Category leads** (set per person under *Dashboard → People & roles*) can manage ideas in their categories.
- **Status timeline:** New → Under Review → Scheduled (with date) → In Progress → Done, or **Not Right Now**. Not Right Now requires **the why**: a reason (timing, budget, capacity, vision, already happening, needs detail, other), an explanation, and an optional "we'll revisit on" date. Every change notifies the author, commenters, and upvoters.
- **Official replies** are highlighted in the conversation.
- **Combine** duplicate ideas (votes carry over), **hide** ideas or comments, and work through the **reports** queue.
- **Dashboard:** what needs a response (most loved first), ideas by status, category, passion and month, upcoming revisit dates, and **CSV export** for planning meetings.

## Asana sync (optional)

Ideas on **What's Happening** can mirror an Asana project, both ways.

- Each status is a **section**: Under Review, Scheduled, In Progress, Done, Not Right Now. Ideas still marked New stay out of Asana.
- **Changes here go to Asana right away.** That includes status, the scheduled date (as the due date), Done (task completed), title and description. Leadership replies and status notes are posted as task comments.
- **Changes in Asana come back within about a minute.** Drag a task to another section, tick it complete or change its due date. The NAS isn't reachable from the internet, so Asana can't notify it. Instead it checks Asana's change feed every `ASANA_POLL_SECONDS`.
- **Not Right Now from Asana:** set the **Why (Not Right Now)** dropdown on the task. If it's left empty, the idea is flagged under *Dashboard → Overview → Needs a why*, and the idea page says the why is coming instead of showing a blank.
- The title and description belong to the Idea Library, so edits to them in Asana get overwritten.

**Set it up**

1. In Asana, go to *profile photo → Settings → Apps → Developer apps* and create a **personal access token**. Make an empty test project too.
2. On the NAS, copy `.env.example` to `.env` next to `docker-compose.yml` and paste the token after `ASANA_TOKEN=`. Keep `.env` private. It isn't copied into the image.
3. Rebuild the project so it picks up the token: Container Manager → *Action → Build*, or `sudo docker compose up -d`.
4. In the Idea Library, open *Dashboard → Asana*, pick the project and click **Connect**. The sections and the dropdown are created, and existing ideas past New are added.

The dropdown is an Asana custom field, which needs a paid Asana plan. Without one, everything else still syncs. Not Right Now moves made in Asana just always get flagged for a why.

## Run it on the Synology (Container Manager)

1. Copy this whole folder to the NAS, e.g. `/volume1/docker/idea-library` (File Station or `scp`).
2. Open **Container Manager → Project → Create**.
   - Project name: `idea-library`
   - Path: the folder from step 1
   - Source: *Use existing docker-compose.yml*
3. Click through and **Build/Start**. The first build takes a few minutes.
4. Visit `http://<nas-ip>:8088`.
5. **Create your account first. The first account becomes an admin.** Then promote other staff under *Dashboard → People & roles*. Alternatively, put their emails in `ADMIN_EMAILS` in `docker-compose.yml` before they sign up.

Port `8088` and the timezone are set in `docker-compose.yml`.

### Moving from another computer

If you've been running it somewhere else first, such as a Mac:

1. **Stop the old copy first**: `docker compose down` in its folder. Two copies connected to the same Asana project would undo each other's changes.
2. Copy the whole folder, including `data/` and `.env`, to the NAS. You can skip the `node_modules` folders.
3. Build and start it on the NAS as described above.
4. Open *Dashboard → Asana* at the NAS address and click **Sync now** once, so task links point at the NAS instead of the old computer.

### Command line alternative (SSH into the NAS)

```bash
cd /volume1/docker/idea-library && sudo docker compose up -d --build
```

### Updating

Copy the new files over (keep the `data/` folder), then in Container Manager choose the project → **Action → Build**. Or over SSH:

```bash
sudo docker compose up -d --build
```

### Backups

Everything lives in `./data`: the SQLite database `idea-library.db` and `thumbnails/`. Include that folder in **Hyper Backup**. If you use Asana sync, also back up `.env`.

### Nice to have

- **Friendly address (ideas.newdaychurch.cc):**
  1. **DNS:** add an A record `ideas.newdaychurch.cc → 10.10.40.91` on your local DNS server (or in the public DNS for newdaychurch.cc; a private IP there only works inside the building).
  2. **Reverse proxy:** in DSM, *Control Panel → Login Portal → Advanced → Reverse Proxy → Create*. Source: HTTP, hostname `ideas.newdaychurch.cc`, port 80. Destination: HTTP, `localhost`, port 8088.
  3. Open `http://ideas.newdaychurch.cc`, then *Dashboard → Asana → Sync now* so Asana task links use the new address.
- **HTTPS:** add a certificate for the name under *Control Panel → Security → Certificate*, change the reverse proxy source to HTTPS port 443, and set `COOKIE_SECURE: "true"` in `docker-compose.yml`. Only turn that on once HTTPS works, or nobody can stay signed in.

## Local development

Requires Node 22.13+.

```bash
npm run install:all
```

```bash
npm run dev:server
```

```bash
npm run dev:client
```

The client runs at http://localhost:5173 and proxies `/api` to the server on port 3000.

## How it's built

| Piece | Choice |
|---|---|
| Server | Node 22 + Express 5, `server/src` |
| Database | SQLite built into Node (`node:sqlite`), no native modules, so it runs on Intel and ARM NAS models |
| Auth | Email + password (scrypt hashes), HTTP-only session cookies, login rate limiting |
| Client | React 18 + Vite, `client/src` |
| Brand | Arial, New Day blues and grays, the ND mark (vector taken from the brand guide), and the rounded "streak" pattern from the gradients page |

Thumbnail fetching refuses private and LAN addresses, so a submitted link can't be used to probe the church network.
