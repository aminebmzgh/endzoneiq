# EndzoneIQ

Every NFL game, explained in 60 seconds: a pick, a win probability and three plain-English
reasons, with a public, verifiable track record. English, French and Spanish.

EndzoneIQ is an independent analysis service and is not affiliated with or endorsed by the
NFL or any team.

## Quick start

```bash
docker compose up -d                 # local MariaDB
cp .env.example .env.local
npm ci
npm run db:migrate
npm run dev                          # http://localhost:3000/en

cd pipeline && uv sync && uv run pytest
```

- Project conventions, commands and decisions: [CLAUDE.md](CLAUDE.md)
- Deploying to Hostinger: [docs/deployment.md](docs/deployment.md)
- Out of scope for now: [BACKLOG.md](BACKLOG.md)
