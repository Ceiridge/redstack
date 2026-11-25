# Sicherheit und Abhängigkeiten

Viele Bibliotheken in diesem Umfeld sind klein und von Einzelpersonen gepflegt. Deshalb gilt:

## npm-Pakete
- **Exakte Versionen**, kein `^`/`~` (`save-exact=true` in `.npmrc`).
- **Lockfile** (`pnpm-lock.yaml`) ist im Repo; CI installiert mit `--frozen-lockfile`.
- **Keine Install-Skripte**: `ignore-scripts=true` und `onlyBuiltDependencies: []` mit `strictDepBuilds`. Ein Paket, das Skripte braucht, muss bewusst freigeschaltet werden.
- **Karenzzeit**: `minimumReleaseAge` = 7 Tage. Frisch veröffentlichte (evtl. kompromittierte) Versionen werden nicht installiert.
- **Updates nur manuell** mit Blick auf den Diff des Pakets. Keine automatischen Merges.
- So wenige Abhängigkeiten wie möglich. Aktuell zur Laufzeit: nur `nucleation`.

| Paket | Version | Grund |
|---|---|---|
| nucleation | 0.12.3 | Schematic-Export (0.12.4 war beim Einrichten jünger als 7 Tage) |
| typescript | 6.0.3 | Build (dev) |
| @types/node | 22.20.5 | Typen (dev) |

## Git-Submodules
- `vendor/nucleation` ist auf den Commit von Tag `v0.12.3` festgenagelt (`81a57e3`), passend zur npm-Version.
- `update = none`: wird bei normalem Klonen **nicht** ausgecheckt. Nur bei Bedarf (Simulations-Build, Phase 3):
  `git -c submodule.vendor/nucleation.update=checkout submodule update --init vendor/nucleation`
- Neue Commits nur nach Durchsicht des Diffs übernehmen.

## GitHub Actions
- Auf Commit-SHAs festgenagelt, der Tag steht im Kommentar.
- Minimale Rechte (`contents: read`), keine Credentials im Checkout.

## Server, Mods, Testwelten
- Nie im Repo. Download über `packages/backend-fabric/scripts/fetch-server.mjs` mit SHA-256 aus dem Manifest; ohne Hash bricht das Skript ab.
- Testserver laufen im Container ohne Netzwerkzugang – Mods sind beliebiger Java-Code.
- Ungeprüfte Mods (z. B. FarmBench) höchstens dort.

## Geheimnisse
- API-Keys, RCON-Passwörter nur in `.env` (in `.gitignore`). Vorlage: `.env.example`.
