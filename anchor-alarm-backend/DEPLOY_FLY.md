# Déployer le backend sur Fly.io

Une seule machine `shared-cpu-1x` / 256 Mo, toujours allumée — cela tient
dans l'allocation gratuite de Fly.io, supporte les WebSockets (Socket.io)
et n'a pas de démarrage à froid.

> ⚠️ **Une seule machine, jamais deux.** Les sessions sont stockées en
> mémoire : une deuxième machine recevrait des connexions pour des
> sessions qu'elle ne connaît pas, et un redéploiement/redémarrage efface
> toutes les sessions actives (les téléphones retournent alors à l'écran
> d'accueil). Ne pas redéployer pendant une nuit au mouillage.

## Première mise en place

```bash
# 1. Installer flyctl : https://fly.io/docs/flyctl/install/
curl -L https://fly.io/install.sh | sh

# 2. Se connecter (crée un compte si besoin)
fly auth login

# 3. Depuis anchor-alarm-backend/ — créer l'app à partir du fly.toml existant
cd anchor-alarm-backend
fly launch --copy-config --no-deploy
#   - accepter le nom (ou en choisir un libre : il devient l'URL publique)
#   - ne PAS ajouter de base Postgres/Redis

# 4. Déployer
fly deploy

# 5. Vérifier qu'il n'y a bien qu'UNE machine
fly scale count 1
fly status
curl https://<votre-app>.fly.dev/health
```

## Brancher l'application Android

```bash
cd ../anchor-alarm-frontend
echo 'REACT_APP_BACKEND_URL=https://<votre-app>.fly.dev' > .env.production
npm run build && npx cap sync android
```

Puis recompiler l'APK. Le backend étant désormais en HTTPS, le trafic en
clair (`usesCleartextTraffic` / `androidScheme: http`) n'est plus
nécessaire que pour le développement local.

## Exploitation

```bash
fly logs            # journaux en direct
fly status          # état de la machine
fly deploy          # mettre à jour après modification de server.js
```

Le healthcheck interroge `GET /health` toutes les 30 s ; Fly redémarre la
machine s'il échoue.
